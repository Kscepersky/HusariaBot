import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskAttachmentValidationError } from '../tasks/attachments.js';
import { resolveImagesStorageLimitBytes, storeQuestionImage } from './images.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const UPLOAD = { mimeType: 'image/png', dataBase64: PNG.toString('base64') };

let directory: string;

beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'husariada-images-'));
});

afterEach(async () => {
    delete process.env.HUSARIADA_IMAGES_MAX_MB;
    await rm(directory, { recursive: true, force: true });
});

describe('limit miejsca na obrazki', () => {
    it('domyslnie 1 GB, konfigurowalny w MB', () => {
        expect(resolveImagesStorageLimitBytes()).toBe(1024 * 1024 * 1024);
        process.env.HUSARIADA_IMAGES_MAX_MB = '5';
        expect(resolveImagesStorageLimitBytes()).toBe(5 * 1024 * 1024);
        process.env.HUSARIADA_IMAGES_MAX_MB = 'abc';
        expect(resolveImagesStorageLimitBytes()).toBe(1024 * 1024 * 1024);
    });

    it('zapisuje obrazek, gdy jest miejsce', async () => {
        const image = await storeQuestionImage(UPLOAD, directory);
        expect(await readdir(directory)).toEqual([image.storedName]);
    });

    it('odrzuca obrazek po przekroczeniu limitu', async () => {
        process.env.HUSARIADA_IMAGES_MAX_MB = '1';
        await writeFile(join(directory, 'zajete.bin'), Buffer.alloc(1024 * 1024));

        await expect(storeQuestionImage(UPLOAD, directory)).rejects.toBeInstanceOf(TaskAttachmentValidationError);
        expect(await readdir(directory)).toEqual(['zajete.bin']);
    });
});
