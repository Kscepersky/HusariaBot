import { isAbsolute, join } from 'node:path';
import {
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

export async function storeQuestionImage(upload: AttachmentUpload, directory: string = resolveHusariadaImagesDir()): Promise<QuestionImage> {
    const prepared = validateAttachmentUploads([upload]);
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
