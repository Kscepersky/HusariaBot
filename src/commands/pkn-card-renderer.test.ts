import { describe, expect, it } from 'vitest';
import { renderPknCard } from './pkn-card-renderer.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

describe('renderPknCard', () => {
    it('zwraca poprawny PNG dla kazdego wyniku', async () => {
        for (const outcome of ['first', 'second', 'draw'] as const) {
            const result = await renderPknCard({
                firstName: 'Ala',
                secondName: 'Ola',
                firstMove: 'rock',
                secondMove: outcome === 'draw' ? 'rock' : 'scissors',
                outcome,
            });

            expect(result.byteLength).toBeGreaterThan(1000);
            expect(result.subarray(0, 8)).toEqual(PNG_SIGNATURE);
        }
    });

    it('radzi sobie z pustym i bardzo dlugim nickiem oraz zlym URL awatara', async () => {
        const result = await renderPknCard({
            firstName: 'BardzoDlugiNickKtoryPowinienZostacPrzyciety',
            secondName: '',
            firstAvatarUrl: 'not-a-valid-avatar-url',
            firstMove: 'paper',
            secondMove: 'rock',
            outcome: 'first',
        });

        expect(result.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    });
});
