import { describe, expect, it } from 'vitest';
import { PKN_MOVES, isPknMove, resolveRound } from './pkn-logic.js';

describe('resolveRound', () => {
    it.each([
        ['rock', 'scissors', 'first'],
        ['scissors', 'paper', 'first'],
        ['paper', 'rock', 'first'],
        ['scissors', 'rock', 'second'],
        ['paper', 'scissors', 'second'],
        ['rock', 'paper', 'second'],
    ] as const)('%s vs %s => %s', (first, second, expected) => {
        expect(resolveRound(first, second)).toBe(expected);
    });

    it('zwraca remis dla identycznych ruchow', () => {
        for (const move of PKN_MOVES) {
            expect(resolveRound(move, move)).toBe('draw');
        }
    });
});

describe('isPknMove', () => {
    it('akceptuje tylko znane ruchy', () => {
        expect(isPknMove('rock')).toBe(true);
        expect(isPknMove('lizard')).toBe(false);
        expect(isPknMove('')).toBe(false);
    });
});
