import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    formatTicketNumber,
    getNextTicketNumber,
    sanitizeTicketUsername,
} from './counter-store.js';

describe('formatTicketNumber', () => {
    it('formatuje jednocyfrowe numery jako 01, 02...', () => {
        expect(formatTicketNumber(1)).toBe('01');
        expect(formatTicketNumber(9)).toBe('09');
    });

    it('zostawia wielocyfrowe numery bez obcinania', () => {
        expect(formatTicketNumber(12)).toBe('12');
        expect(formatTicketNumber(123)).toBe('123');
    });
});

describe('sanitizeTicketUsername', () => {
    it('czyści nickname do bezpiecznej nazwy kanału', () => {
        expect(sanitizeTicketUsername('NiCk Discord_123!')).toBe('nickdiscord_123');
    });

    it('zwraca fallback gdy nick nie ma wspieranych znaków', () => {
        expect(sanitizeTicketUsername('!!!')).toBe('uzytkownik');
    });
});

describe('getNextTicketNumber', () => {
    it('inkrementuje licznik i zapisuje wynik do pliku', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'husaria-ticket-counter-'));
        const counterPath = join(tempDir, 'ticket-counter.json');

        const first = await getNextTicketNumber(counterPath);
        const second = await getNextTicketNumber(counterPath);

        const content = JSON.parse(await readFile(counterPath, 'utf8')) as { lastNumber: number };

        expect(first).toBe(1);
        expect(second).toBe(2);
        expect(content.lastNumber).toBe(2);
    });
});
