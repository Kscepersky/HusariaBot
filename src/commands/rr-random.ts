import { randomInt } from 'node:crypto';

/** Losowa liczba z zakresu [0, maxExclusive) - wydzielone, zeby testy mogly ja podmienic. */
export function randomBelow(maxExclusive: number): number {
    return randomInt(maxExclusive);
}
