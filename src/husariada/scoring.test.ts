import { describe, expect, it } from 'vitest';
import { computePoints, rankStandings, shouldShowLeaderboard } from './scoring.js';

describe('computePoints (Kahoot)', () => {
    const base = { timeLimitMs: 15_000, maxPoints: 400 };

    it('natychmiastowa poprawna odpowiedz daje maksimum', () => {
        expect(computePoints({ ...base, correct: true, responseMs: 0 })).toBe(400);
    });

    it('poprawna odpowiedz w ostatniej chwili daje polowe', () => {
        expect(computePoints({ ...base, correct: true, responseMs: 15_000 })).toBe(200);
    });

    it('punkty spadaja liniowo z czasem', () => {
        expect(computePoints({ ...base, correct: true, responseMs: 7_500 })).toBe(300);
        expect(computePoints({ ...base, correct: true, responseMs: 3_000 })).toBe(360);
    });

    it('bledna odpowiedz daje 0', () => {
        expect(computePoints({ ...base, correct: false, responseMs: 100 })).toBe(0);
    });

    it('przycina czas spoza zakresu', () => {
        expect(computePoints({ ...base, correct: true, responseMs: -500 })).toBe(400);
        expect(computePoints({ ...base, correct: true, responseMs: 99_000 })).toBe(200);
    });
});

describe('rankStandings', () => {
    const player = (userId: string, points: number, correctResponseMs = 0, correctCount = 1) => ({
        userId,
        displayName: userId,
        avatarUrl: null,
        points,
        correctCount,
        answeredCount: correctCount,
        correctResponseMs,
    });

    it('sortuje po punktach malejaco i nadaje miejsca', () => {
        const ranked = rankStandings([player('a', 100), player('b', 300), player('c', 200)]);
        expect(ranked.map((entry) => [entry.userId, entry.place])).toEqual([['b', 1], ['c', 2], ['a', 3]]);
    });

    it('przy remisie wygrywa wiecej poprawnych, potem szybszy', () => {
        const ranked = rankStandings([
            player('wolny', 300, 9000, 2),
            player('szybki', 300, 4000, 2),
            player('celny', 300, 9999, 3),
        ]);
        expect(ranked.map((entry) => entry.userId)).toEqual(['celny', 'szybki', 'wolny']);
    });

    it('identyczne wyniki dziela miejsce', () => {
        const ranked = rankStandings([player('a', 300, 1000), player('b', 300, 1000), player('c', 100)]);
        expect(ranked.map((entry) => entry.place)).toEqual([1, 1, 3]);
    });

    it('nie modyfikuje wejscia', () => {
        const input = [player('a', 1), player('b', 2)];
        rankStandings(input);
        expect(input.map((entry) => entry.userId)).toEqual(['a', 'b']);
    });
});

describe('shouldShowLeaderboard', () => {
    it('pokazuje co N pytan, ale nie po ostatnim', () => {
        expect(shouldShowLeaderboard(4, 12, 5)).toBe(true);
        expect(shouldShowLeaderboard(9, 12, 5)).toBe(true);
        expect(shouldShowLeaderboard(3, 12, 5)).toBe(false);
        expect(shouldShowLeaderboard(9, 10, 5)).toBe(false);
    });

    it('0 wylacza ranking posredni', () => {
        expect(shouldShowLeaderboard(4, 12, 0)).toBe(false);
    });
});
