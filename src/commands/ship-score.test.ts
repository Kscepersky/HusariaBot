import { describe, expect, it } from 'vitest';
import { resolveShipVerdict, rollShipPercent, SHIP_VERDICTS } from './ship-score.js';

describe('rollShipPercent', () => {
    it('zwraca 0 dla najnizszej wartosci losowej i 100 dla najwyzszej', () => {
        expect(rollShipPercent(() => 0)).toBe(0);
        expect(rollShipPercent(() => 0.999999)).toBe(100);
    });

    it('zawsze zwraca liczbe calkowita z zakresu 0-100', () => {
        for (let index = 0; index < 500; index += 1) {
            const percent = rollShipPercent();
            expect(Number.isInteger(percent)).toBe(true);
            expect(percent).toBeGreaterThanOrEqual(0);
            expect(percent).toBeLessThanOrEqual(100);
        }
    });
});

describe('resolveShipVerdict', () => {
    it('dobiera werdykt dla kazdego procentu 0-100', () => {
        for (let percent = 0; percent <= 100; percent += 1) {
            expect(resolveShipVerdict(percent).text.length).toBeGreaterThan(0);
        }
    });

    it('zwraca rozne werdykty dla skrajnych wynikow', () => {
        expect(resolveShipVerdict(0)).not.toEqual(resolveShipVerdict(100));
    });

    it('przycina wartosci spoza zakresu', () => {
        expect(resolveShipVerdict(-50)).toEqual(resolveShipVerdict(0));
        expect(resolveShipVerdict(500)).toEqual(resolveShipVerdict(100));
    });

    it('przedzialy werdyktow pokrywaja caly zakres bez dziur', () => {
        const sorted = [...SHIP_VERDICTS].sort((left, right) => left.min - right.min);
        expect(sorted[0]?.min).toBe(0);
        expect(sorted.at(-1)?.max).toBe(100);
        sorted.slice(1).forEach((verdict, index) => {
            expect(verdict.min).toBe((sorted[index]?.max ?? -1) + 1);
        });
    });
});
