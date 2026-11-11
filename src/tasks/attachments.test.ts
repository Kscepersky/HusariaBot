import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    MAX_TASK_ATTACHMENTS_PER_UPLOAD,
    TaskAttachmentValidationError,
    isSafeStoredName,
    removeAttachmentFiles,
    resolveAttachmentPath,
    storeAttachmentFiles,
    validateAttachmentUploads,
} from './attachments.js';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

function upload(bytes: Buffer, mimeType: string) {
    return { mimeType, dataBase64: `data:${mimeType};base64,${bytes.toString('base64')}` };
}

describe('validateAttachmentUploads', () => {
    it('akceptuje PNG i JPG z poprawna zawartoscia', () => {
        const prepared = validateAttachmentUploads([upload(PNG_BYTES, 'image/png'), upload(JPEG_BYTES, 'image/jpg')]);
        expect(prepared.map((item) => item.extension)).toEqual(['.png', '.jpg']);
    });

    it('odrzuca SVG', () => {
        expect(() => validateAttachmentUploads([upload(SVG_BYTES, 'image/svg+xml')])).toThrow(TaskAttachmentValidationError);
    });

    it('odrzuca plik, ktorego zawartosc nie zgadza sie z MIME', () => {
        expect(() => validateAttachmentUploads([upload(SVG_BYTES, 'image/png')])).toThrow(/nie zgadza/);
        expect(() => validateAttachmentUploads([upload(Buffer.from('<html>'), 'image/png')])).toThrow(TaskAttachmentValidationError);
    });

    it('odrzuca zepsuty base64 i za duzo plikow', () => {
        expect(() => validateAttachmentUploads([{ mimeType: 'image/png', dataBase64: '###' }])).toThrow(TaskAttachmentValidationError);
        const tooMany = Array.from({ length: MAX_TASK_ATTACHMENTS_PER_UPLOAD + 1 }, () => upload(PNG_BYTES, 'image/png'));
        expect(() => validateAttachmentUploads(tooMany)).toThrow(/maksymalnie/);
    });

    it('odrzuca plik wiekszy niz 8 MB', () => {
        const big = Buffer.concat([PNG_BYTES, Buffer.alloc(8 * 1024 * 1024)]);
        expect(() => validateAttachmentUploads([upload(big, 'image/png')])).toThrow(/za duże/);
    });
});

describe('sciezki zalacznikow', () => {
    it('przepuszcza tylko nazwy w formacie uuid.ext', () => {
        expect(isSafeStoredName('0b5e1a8e-2f6c-4f43-9c0f-111111111111.png')).toBe(true);
        expect(isSafeStoredName('../../etc/passwd')).toBe(false);
        expect(isSafeStoredName('0b5e1a8e-2f6c-4f43-9c0f-111111111111.svg')).toBe(false);
        expect(() => resolveAttachmentPath('../secret.png', '/tmp/x')).toThrow();
    });
});

describe('storeAttachmentFiles', () => {
    let directory: string;

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'task-attachments-'));
    });

    afterEach(async () => {
        await rm(directory, { recursive: true, force: true });
    });

    it('zapisuje pliki pod nazwami wygenerowanymi przez serwer', async () => {
        const prepared = validateAttachmentUploads([upload(PNG_BYTES, 'image/png')]);
        const [record] = await storeAttachmentFiles(prepared, 'description', directory);

        expect(record?.kind).toBe('description');
        expect(isSafeStoredName(record!.storedName)).toBe(true);
        expect(await readFile(join(directory, record!.storedName))).toEqual(PNG_BYTES);

        await removeAttachmentFiles([record!.storedName], directory);
        expect(await readdir(directory)).toEqual([]);
    });

    it('bez plikow nic nie robi', async () => {
        expect(await storeAttachmentFiles([], 'completion', directory)).toEqual([]);
    });
});
