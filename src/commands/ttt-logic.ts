export type TttMark = 'X' | 'O';
export type TttCell = TttMark | null;
export type TttBoard = readonly TttCell[];
/** Wynik partii z perspektywy graczy: first = wyzywajacy, second = wyzwany. */
export type TttMatchOutcome = 'first' | 'second' | 'draw';

export const TTT_BOARD_SIZE = 9;
export const EMPTY_BOARD: TttBoard = Array.from({ length: TTT_BOARD_SIZE }, () => null);

export const WIN_LINES: readonly (readonly [number, number, number])[] = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
];

export type TttResult =
    | { kind: 'win'; mark: TttMark; line: readonly [number, number, number] }
    | { kind: 'draw' };

export function otherMark(mark: TttMark): TttMark {
    return mark === 'X' ? 'O' : 'X';
}

/** Zwraca nowa plansze albo null, gdy ruch jest niedozwolony (zle pole lub zajete). */
export function applyMove(board: TttBoard, index: number, mark: TttMark): TttBoard | null {
    if (!Number.isInteger(index) || index < 0 || index >= TTT_BOARD_SIZE || board[index] !== null) {
        return null;
    }

    return board.map((cell, cellIndex) => (cellIndex === index ? mark : cell));
}

/** Wygrana, remis albo null, gdy partia trwa dalej. */
export function getResult(board: TttBoard): TttResult | null {
    for (const line of WIN_LINES) {
        const [a, b, c] = line;
        const mark = board[a];
        if (mark !== null && mark !== undefined && mark === board[b] && mark === board[c]) {
            return { kind: 'win', mark, line };
        }
    }

    return board.every((cell) => cell !== null) ? { kind: 'draw' } : null;
}
