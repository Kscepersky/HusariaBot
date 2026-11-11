import { describe, expect, it } from 'vitest';
import { TITLE_CARD_HEIGHT, TITLE_CARD_WIDTH, renderTitleCard } from './title-card-renderer.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(buffer: Buffer): { width: number; height: number } {
    // IHDR: szerokosc i wysokosc to dwa 32-bitowe big-endian zaraz po sygnaturze i naglowku chunka.
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('renderTitleCard', () => {
    it('zwraca PNG o wymiarach karty /level (1200x400)', async () => {
        const output = await renderTitleCard({ title: 'REGULAMIN' });

        expect(output.subarray(0, 8)).toEqual(PNG_SIGNATURE);
        expect(pngSize(output)).toEqual({ width: TITLE_CARD_WIDTH, height: TITLE_CARD_HEIGHT });
        expect(TITLE_CARD_WIDTH).toBe(1200);
        expect(TITLE_CARD_HEIGHT).toBe(400);
        expect(output.byteLength).toBeLessThan(8 * 1024 * 1024);
    });

    it('rozny tytul daje inny obrazek, a ten sam - identyczny', async () => {
        const [first, second, again] = await Promise.all([
            renderTitleCard({ title: 'REGULAMIN' }),
            renderTitleCard({ title: 'FAQ' }),
            renderTitleCard({ title: 'REGULAMIN' }),
        ]);

        expect(first.equals(second)).toBe(false);
        expect(first.equals(again)).toBe(true);
    });

    it('radzi sobie z pustym, bardzo dlugim i dziwnym tytulem', async () => {
        for (const title of ['', '   ', 'x'.repeat(500), 'Zażółć gęślą jaźń\nlinia 2', '<b>@everyone</b>']) {
            const output = await renderTitleCard({ title });
            expect(output.subarray(0, 8)).toEqual(PNG_SIGNATURE);
            expect(pngSize(output)).toEqual({ width: TITLE_CARD_WIDTH, height: TITLE_CARD_HEIGHT });
        }
    });
});
