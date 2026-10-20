export const PKN_MOVES = ['rock', 'paper', 'scissors'] as const;

export type PknMove = (typeof PKN_MOVES)[number];
export type PknOutcome = 'first' | 'second' | 'draw';

export const PKN_MOVE_EMOJI: Readonly<Record<PknMove, string>> = {
    rock: '🪨',
    paper: '📄',
    scissors: '✂️',
};

export const PKN_MOVE_LABEL: Readonly<Record<PknMove, string>> = {
    rock: 'Kamien',
    paper: 'Papier',
    scissors: 'Nozyce',
};

const BEATS: Readonly<Record<PknMove, PknMove>> = {
    rock: 'scissors',
    paper: 'rock',
    scissors: 'paper',
};

export function isPknMove(value: string): value is PknMove {
    return (PKN_MOVES as readonly string[]).includes(value);
}

export function resolveRound(first: PknMove, second: PknMove): PknOutcome {
    if (first === second) {
        return 'draw';
    }

    return BEATS[first] === second ? 'first' : 'second';
}
