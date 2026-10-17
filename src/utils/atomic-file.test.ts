import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupCorruptFile, writeFileAtomic } from './atomic-file.js';

describe('atomic-file', () => {
    let dir = '';

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'atomic-file-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('zapisuje zawartość i nie zostawia plików tymczasowych', async () => {
        const target = join(dir, 'data.json');
        await writeFileAtomic(target, '{"a":1}');
        await writeFileAtomic(target, '{"a":2}');

        expect(await readFile(target, 'utf8')).toBe('{"a":2}');
        expect(await readdir(dir)).toEqual(['data.json']);
    });

    it('robi kopię uszkodzonego pliku', async () => {
        const target = join(dir, 'broken.json');
        await writeFile(target, '{ucięty');

        const backup = await backupCorruptFile(target);

        expect(backup).not.toBeNull();
        expect(await readFile(backup as string, 'utf8')).toBe('{ucięty');
    });

    it('zwraca null, gdy nie ma czego kopiować', async () => {
        expect(await backupCorruptFile(join(dir, 'missing.json'))).toBeNull();
    });
});
