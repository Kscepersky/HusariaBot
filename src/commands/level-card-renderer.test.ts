import { describe, expect, it } from 'vitest';
import { renderLevelCard } from './level-card-renderer.js';

describe('renderLevelCard', () => {
    it('zwraca poprawny bufor PNG dla standardowych danych', async () => {
        const result = await renderLevelCard({
            username: 'HusariaUser',
            level: 7,
            totalXp: 1840,
            xpIntoCurrentLevel: 90,
            xpForNextLevel: 140,
            xpToNextLevel: 50,
        });

        expect(result.byteLength).toBeGreaterThan(1000);
        expect(result.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    });

    it('normalizuje skrajne wartosci i nie rzuca dla bardzo dlugiego nicku', async () => {
        const result = await renderLevelCard({
            username: 'BardzoDlugiNickKtoryPowinienZostacPrzycietyWLevelCardzie',
            level: -2,
            totalXp: -1,
            xpIntoCurrentLevel: 9999,
            xpForNextLevel: 0,
            xpToNextLevel: -20,
        });

        expect(result.byteLength).toBeGreaterThan(1000);
        expect(result.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    });

    it('uzywa fallback avatara gdy URL jest niepoprawny', async () => {
        const result = await renderLevelCard({
            username: 'FallbackAvatarUser',
            avatarUrl: 'not-a-valid-avatar-url',
            rank: 3,
            level: 5,
            totalXp: 920,
            xpIntoCurrentLevel: 20,
            xpForNextLevel: 100,
            xpToNextLevel: 80,
        });

        expect(result.byteLength).toBeGreaterThan(1000);
        expect(result.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    });

    it('renderuje karte dla wysokiego levela i pozycji rankingu', async () => {
        const result = await renderLevelCard({
            username: 'HighLevelUser',
            rank: 12,
            level: 128,
            totalXp: 999_999,
            xpIntoCurrentLevel: 410,
            xpForNextLevel: 900,
            xpToNextLevel: 490,
        });

        expect(result.byteLength).toBeGreaterThan(1000);
        expect(result.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    });
});
