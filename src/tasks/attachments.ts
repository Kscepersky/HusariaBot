import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { detectImageMime, normalizeUploadMimeType, parseUploadData } from '../dashboard/image-upload.js';
import type { NewAttachmentRecord, TaskAttachmentKind } from './types.js';

/**
 * Screenshoty tasków. Pliki leżą poza katalogami serwowanymi statycznie
 * (`/public`, `/img`) i są dostępne wyłącznie przez uwierzytelnioną trasę API.
 * Nazwa pliku na dysku jest zawsze generowana po stronie serwera.
 */

/** SVG celowo nieobsługiwane - może zawierać skrypty. */
export const TASK_ATTACHMENT_MIME_EXTENSIONS: Readonly<Record<string, string>> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
};

export const MAX_TASK_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_TASK_ATTACHMENTS_PER_UPLOAD = 5;
/** Suma surowych bajtów w jednym żądaniu - base64 musi zmieścić się w limicie body (32 MB). */
export const MAX_TASK_UPLOAD_TOTAL_BYTES = 20 * 1024 * 1024;

const DEFAULT_STORAGE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

/** Łączny sufit miejsca na screenshoty (`TASKS_ATTACHMENTS_MAX_MB`, domyślnie 2 GB). */
export function resolveAttachmentStorageLimitBytes(): number {
    const configured = Number.parseInt(process.env.TASKS_ATTACHMENTS_MAX_MB ?? '', 10);
    return Number.isFinite(configured) && configured > 0 ? configured * 1024 * 1024 : DEFAULT_STORAGE_LIMIT_BYTES;
}

export function assertStorageAvailable(prepared: readonly PreparedAttachment[], usedBytes: number): void {
    const incoming = prepared.reduce((sum, item) => sum + item.buffer.length, 0);
    if (incoming > 0 && usedBytes + incoming > resolveAttachmentStorageLimitBytes()) {
        throw new TaskAttachmentValidationError('Brak miejsca na nowe zdjęcia - limit zrzutów ekranu został wyczerpany. Skontaktuj się z ownerem.');
    }
}

const STORED_NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|gif|webp)$/;

export class TaskAttachmentValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TaskAttachmentValidationError';
    }
}

export interface AttachmentUpload {
    mimeType: string;
    dataBase64: string;
}

export interface PreparedAttachment {
    buffer: Buffer;
    mimeType: string;
    extension: string;
}

export function validateAttachmentUploads(uploads: readonly AttachmentUpload[]): PreparedAttachment[] {
    if (uploads.length > MAX_TASK_ATTACHMENTS_PER_UPLOAD) {
        throw new TaskAttachmentValidationError(`Możesz dodać maksymalnie ${MAX_TASK_ATTACHMENTS_PER_UPLOAD} zdjęć.`);
    }

    const prepared = uploads.map((upload) => {
        const declaredMime = normalizeUploadMimeType(upload.mimeType);
        const extension = TASK_ATTACHMENT_MIME_EXTENSIONS[declaredMime];
        if (!extension) {
            throw new TaskAttachmentValidationError('Dozwolone są tylko obrazy PNG, JPG, GIF i WebP.');
        }

        const buffer = parseUploadData(upload.dataBase64);
        if (!buffer || buffer.length === 0) {
            throw new TaskAttachmentValidationError('Wgrany plik ma nieprawidłowy format.');
        }

        if (buffer.length > MAX_TASK_ATTACHMENT_BYTES) {
            throw new TaskAttachmentValidationError('Zdjęcie jest za duże (max 8 MB).');
        }

        // Zawartość musi faktycznie być deklarowanym obrazem - nie ufamy MIME od klienta.
        if (detectImageMime(buffer) !== declaredMime) {
            throw new TaskAttachmentValidationError('Zawartość pliku nie zgadza się z typem obrazu.');
        }

        return { buffer, mimeType: declaredMime, extension };
    });

    const totalBytes = prepared.reduce((sum, item) => sum + item.buffer.length, 0);
    if (totalBytes > MAX_TASK_UPLOAD_TOTAL_BYTES) {
        throw new TaskAttachmentValidationError('Łączny rozmiar zdjęć jest za duży (max 20 MB).');
    }

    return prepared;
}

export function resolveTaskAttachmentsDir(): string {
    const configured = process.env.TASKS_ATTACHMENTS_DIR?.trim();
    if (!configured) {
        return join(process.cwd(), 'data', 'task-attachments');
    }
    return isAbsolute(configured) ? configured : join(process.cwd(), configured);
}

export function isSafeStoredName(storedName: string): boolean {
    return STORED_NAME_PATTERN.test(storedName);
}

/** Ścieżka do pliku na dysku. Rzuca dla nazw, których serwer nie mógł wygenerować. */
export function resolveAttachmentPath(storedName: string, directory: string = resolveTaskAttachmentsDir()): string {
    if (!isSafeStoredName(storedName)) {
        throw new Error('Niepoprawna nazwa zalacznika.');
    }

    const root = resolve(directory);
    const fullPath = resolve(root, storedName);
    if (!fullPath.startsWith(root + sep)) {
        throw new Error('Niepoprawna sciezka zalacznika.');
    }
    return fullPath;
}

export async function removeAttachmentFiles(
    storedNames: readonly string[],
    directory: string = resolveTaskAttachmentsDir(),
): Promise<void> {
    await Promise.all(storedNames.map(async (storedName) => {
        try {
            await unlink(resolveAttachmentPath(storedName, directory));
        } catch {
            // Brak pliku przy sprzataniu nie jest bledem.
        }
    }));
}

/**
 * Zapisuje pliki i zwraca rekordy do bazy. Przy błędzie usuwa to, co zdążyło się
 * zapisać, żeby nie zostawiać osieroconych plików.
 */
export async function storeAttachmentFiles(
    prepared: readonly PreparedAttachment[],
    kind: TaskAttachmentKind,
    directory: string = resolveTaskAttachmentsDir(),
): Promise<NewAttachmentRecord[]> {
    if (prepared.length === 0) return [];

    await mkdir(directory, { recursive: true, mode: 0o700 });
    const records: NewAttachmentRecord[] = [];

    try {
        for (const item of prepared) {
            const id = randomUUID();
            const storedName = `${id}${item.extension}`;
            await writeFile(resolveAttachmentPath(storedName, directory), item.buffer, { flag: 'wx', mode: 0o600 });
            records.push({ id, kind, storedName, mimeType: item.mimeType, sizeBytes: item.buffer.length });
        }
    } catch (error) {
        await removeAttachmentFiles(records.map((record) => record.storedName), directory);
        throw error;
    }

    return records;
}
