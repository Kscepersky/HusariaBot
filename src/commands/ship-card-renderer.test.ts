import { describe, expect, it } from 'vitest';
import { renderShipCard } from './ship-card-renderer.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

describe('renderShipCard', () => {
    it('zwraca poprawny bufor PNG dla standardowych danych', async () => {
        const result = await renderShipCard({ firstName: 'Ala', secondName: 'Ola', percent: 73 });

        expect(result.byteLength).toBeGreaterThan(1000);
        expect(result.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    });

    it('radzi sobie ze skrajnymi procentami i bardzo dlugimi nickami', async () => {
        const longName = 'BardzoDlugiNickKtoryPowinienZostacPrzyciety';

        for (const percent of [-10, 0, 100, 250]) {
            const result = await renderShipCard({ firstName: longName, secondName: '', percent });
            expect(result.subarray(0, 8)).toEqual(PNG_SIGNATURE);
        }
    });

    it('uzywa fallbacku gdy URL awatara jest niepoprawny', async () => {
        const result = await renderShipCard({
            firstName: 'Ala',
            secondName: 'Ola',
            firstAvatarUrl: 'not-a-valid-avatar-url',
            secondAvatarUrl: 'also-invalid',
            percent: 42,
        });

        expect(result.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    });
});
