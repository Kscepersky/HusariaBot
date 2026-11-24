import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
    TaskAttachmentValidationError,
    removeAttachmentFiles,
    resolveAttachmentPath,
    storeAttachmentFiles,
    validateAttachmentUploads,
    type AttachmentUpload,
} from '../tasks/attachments.js';
import type { QuestionImage } from './types.js';

/**
 * Obrazki pytan Husariady. Walidacja (PNG/JPG/GIF/WebP, max 8 MB, zgodnosc tresci z MIME)
 * i bezpieczne nazwy plikow sa wspolne z zalacznikami taskow; pliki leza w osobnym katalogu.
 */

export function resolveHusariadaImagesDir(): string {
    const configured = process.env.HUSARIADA_IMAGES_DIR?.trim();
    if (!configured) {
        return join(process.cwd(), 'data', 'husariada-images');
    }
    return isAbsolute(configured) ? configured : join(process.cwd(), configured);
}

const DEFAULT_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;

/** Laczny sufit miejsca na obrazki pytan (`HUSARIADA_IMAGES_MAX_MB`, domyslnie 1 GB). */
export function resolveImagesStorageLimitBytes(): number {
    const configured = Number.parseInt(process.env.HUSARIADA_IMAGES_MAX_MB ?? '', 10);
    return Number.isFinite(configured) && configured > 0 ? configured * 1024 * 1024 : DEFAULT_STORAGE_LIMIT_BYTES;
}

async function directorySizeBytes(directory: string): Promise<number> {
    try {
        const entries = await readdir(directory, { withFileTypes: true });
        const sizes = await Promise.all(entries
            .filter((entry) => entry.isFile())
            .map(async (entry) => (await stat(join(directory, entry.name))).size));
        return sizes.reduce((sum, size) => sum + size, 0);
    } catch {
        // Brak katalogu = nic jeszcze nie zapisano.
        return 0;
    }
}

export async function storeQuestionImage(upload: AttachmentUpload, directory: string = resolveHusariadaImagesDir()): Promise<QuestionImage> {
    const prepared = validateAttachmentUploads([upload]);
    const incoming = prepared.reduce((sum, item) => sum + item.buffer.length, 0);
    if ((await directorySizeBytes(directory)) + incoming > resolveImagesStorageLimitBytes()) {
        throw new TaskAttachmentValidationError('Brak miejsca na nowe obrazki pytań - limit został wyczerpany. Usuń nieużywane quizy lub skontaktuj się z ownerem.');
    }
    const [record] = await storeAttachmentFiles(prepared, 'description', directory);
    return { storedName: record.storedName, mimeType: record.mimeType };
}

export async function removeQuestionImages(images: readonly (QuestionImage | null)[], directory: string = resolveHusariadaImagesDir()): Promise<void> {
    const names = images.filter((image): image is QuestionImage => image !== null).map((image) => image.storedName);
    await removeAttachmentFiles(names, directory);
}

/** Sciezka na dysku; rzuca dla nazw, ktorych serwer nie mogl wygenerowac. */
export function resolveQuestionImagePath(image: QuestionImage, directory: string = resolveHusariadaImagesDir()): string {
    return resolveAttachmentPath(image.storedName, directory);
}

/** Nazwa zalacznika na Discordzie (`attachment://...`). */
export function questionImageAttachmentName(image: QuestionImage): string {
    const extension = image.storedName.slice(image.storedName.lastIndexOf('.'));
    return `husariada-pytanie${extension}`;
}
