import type { Standing } from './types.js';

export interface PointsInput {
    correct: boolean;
    responseMs: number;
    timeLimitMs: number;
    maxPoints: number;
}

/**
 * Punktacja jak w Kahoot: maxPoints * (1 - (czas / limit) / 2).
 * Natychmiast = 100%, na koniec czasu = 50%, bledna lub brak odpowiedzi = 0.
 */
export function computePoints(input: PointsInput): number {
    if (!input.correct || input.timeLimitMs <= 0) {
        return 0;
    }
    const ratio = Math.min(1, Math.max(0, input.responseMs / input.timeLimitMs));
    return Math.round(input.maxPoints * (1 - ratio / 2));
}

export type UnrankedStanding = Omit<Standing, 'place'>;

function compareStandings(left: UnrankedStanding, right: UnrankedStanding): number {
    return right.points - left.points
        || right.correctCount - left.correctCount
        || left.correctResponseMs - right.correctResponseMs;
}

/** Ranking z remisami (1, 1, 3) - miejsce dzielone tylko przy identycznym wyniku i czasie. */
export function rankStandings(entries: readonly UnrankedStanding[]): Standing[] {
    const sorted = [...entries].sort((left, right) => compareStandings(left, right) || left.userId.localeCompare(right.userId));
    return sorted.map((entry, index) => {
        let place = index + 1;
        for (let previous = index - 1; previous >= 0 && compareStandings(sorted[previous], entry) === 0; previous -= 1) {
            place = previous + 1;
        }
        return { ...entry, place };
    });
}

/** Ranking posredni po co N-tym pytaniu (indeks od 0), nigdy po ostatnim - wtedy sa wyniki koncowe. */
export function shouldShowLeaderboard(questionIndex: number, questionCount: number, every: number): boolean {
    if (every <= 0) {
        return false;
    }
    const answered = questionIndex + 1;
    return answered % every === 0 && answered < questionCount;
}
