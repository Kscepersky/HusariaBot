import { describe, expect, it } from 'vitest';
import { formatDuration, formatPoints, renderStatyLolCard } from './statylol-card-renderer.js';
import type { LolProfile } from './lol-profile.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function match(overrides: Partial<LolProfile['matches'][number]> = {}): LolProfile['matches'][number] {
    return {
        championName: 'Viego', iconUrl: 'invalid', win: true, remake: false,
        kills: 5, deaths: 0, assists: 9, cs: 180, durationSec: 1800, queueLabel: 'Solo/Duo', ...overrides,
    };
}

const PROFILE: LolProfile = {
    gameName: 'Nick', tagLine: 'EUNE', regionLabel: 'EUNE', level: 321, profileIconUrl: 'invalid',
    rank: { tier: 'GOLD', division: 'II', lp: 54, wins: 10, losses: 8 },
    mains: [{ name: 'Viego', iconUrl: 'invalid', level: 7, points: 100000 }],
    matches: [match(), match({ win: false, deaths: 7 }), match({ remake: true })],
};

describe('renderStatyLolCard', () => {
    it('zwraca poprawny PNG nawet gdy obrazy sie nie zaladuja', async () => {
        const result = await renderStatyLolCard(PROFILE);

        expect(result.byteLength).toBeGreaterThan(1000);
        expect(result.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    });

    it('radzi sobie z brakiem rangi, mainow i meczow', async () => {
        const result = await renderStatyLolCard({ ...PROFILE, rank: null, mains: [], matches: [] });

        expect(result.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    });

    it('radzi sobie z rangami apex, zerowa liczba gier i dlugim nickiem', async () => {
        for (const rank of [
            { tier: 'CHALLENGER', division: 'I', lp: 1200, wins: 0, losses: 0 },
            { tier: 'NIEZNANY', division: 'I', lp: 0, wins: 3, losses: 0 },
        ]) {
            const result = await renderStatyLolCard({ ...PROFILE, gameName: 'BardzoDlugiNickKtoryPowinienZostacPrzyciety', rank });
            expect(result.subarray(0, 8)).toEqual(PNG_SIGNATURE);
        }
    });
});

describe('formatery', () => {
    it('formatuje punkty mastery', () => {
        expect(formatPoints(950)).toBe('950');
        expect(formatPoints(100_400)).toBe('100k');
        expect(formatPoints(1_250_000)).toBe('1.25M');
    });

    it('formatuje czas gry', () => {
        expect(formatDuration(1805)).toBe('30:05');
        expect(formatDuration(-3)).toBe('0:00');
    });
});
