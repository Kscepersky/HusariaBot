import { describe, expect, it } from 'vitest';
import { EMPTY_BOARD, WIN_LINES, applyMove, getResult, otherMark, type TttBoard } from './ttt-logic.js';

function board(layout: string): TttBoard {
    return [...layout.replace(/\s/g, '')].map((char) => (char === 'X' || char === 'O' ? char : null));
}

describe('applyMove', () => {
    it('zwraca nowa plansze bez mutowania starej', () => {
        const next = applyMove(EMPTY_BOARD, 4, 'X');

        expect(next?.[4]).toBe('X');
        expect(EMPTY_BOARD[4]).toBeNull();
    });

    it('odrzuca zajete pole i indeksy spoza planszy', () => {
        const taken = applyMove(EMPTY_BOARD, 0, 'X')!;

        expect(applyMove(taken, 0, 'O')).toBeNull();
        expect(applyMove(EMPTY_BOARD, -1, 'X')).toBeNull();
        expect(applyMove(EMPTY_BOARD, 9, 'X')).toBeNull();
        expect(applyMove(EMPTY_BOARD, 1.5, 'X')).toBeNull();
    });
});

describe('getResult', () => {
    it('partia w toku zwraca null', () => {
        expect(getResult(EMPTY_BOARD)).toBeNull();
        expect(getResult(board('XO. .X. ...'))).toBeNull();
    });

    it.each(WIN_LINES.map((line) => [line]))('wykrywa wygrana w linii %j', (line) => {
        const cells = EMPTY_BOARD.map((_, index) => (line.includes(index) ? 'O' : null));

        expect(getResult(cells)).toEqual({ kind: 'win', mark: 'O', line });
    });

    it('wykrywa remis na pelnej planszy bez zwyciezcy', () => {
        expect(getResult(board('XOX XOO OXX'))).toEqual({ kind: 'draw' });
    });

    it('wygrana na ostatnim polu wygrywa z remisem', () => {
        expect(getResult(board('XOX OXO OXX'))).toMatchObject({ kind: 'win', mark: 'X' });
    });
});

describe('otherMark', () => {
    it('zamienia znaki', () => {
        expect(otherMark('X')).toBe('O');
        expect(otherMark('O')).toBe('X');
    });
});
