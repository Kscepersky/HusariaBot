import { describe, expect, it } from 'vitest';
import { MAX_TIMEOUT_DURATION_MS, parseTimeoutDuration, parseTimeoutDurationParts } from './duration.js';

describe('timeout duration parser', () => {
    it('parsuje poprawny czas we wszystkich wspieranych jednostkach', () => {
        expect(parseTimeoutDuration('45s').durationMs).toBe(45 * 1000);
        expect(parseTimeoutDuration('30m').durationMs).toBe(30 * 60 * 1000);
        expect(parseTimeoutDuration('1h').durationMs).toBe(60 * 60 * 1000);
        expect(parseTimeoutDuration('2d').durationMs).toBe(2 * 24 * 60 * 60 * 1000);
        expect(parseTimeoutDuration('3mo').durationMs).toBe(3 * 30 * 24 * 60 * 60 * 1000);
        expect(parseTimeoutDuration('1y').durationMs).toBe(365 * 24 * 60 * 60 * 1000);
    });

    it('parsuje czas na podstawie ilosci i jednostki', () => {
        const parsed = parseTimeoutDurationParts(12, 'h');
        expect(parsed.durationMs).toBe(12 * 60 * 60 * 1000);
        expect(parsed.normalized).toBe('12h');
    });

    it('odrzuca bledny format', () => {
        expect(() => parseTimeoutDuration('15')).toThrow();
        expect(() => parseTimeoutDuration('abc')).toThrow();
        expect(() => parseTimeoutDuration('1w')).toThrow();
        expect(() => parseTimeoutDurationParts(0, 'm')).toThrow();
        expect(() => parseTimeoutDurationParts(1, 'week')).toThrow();
    });

    it('odrzuca timeout dluzszy niz 10 lat', () => {
        const tooLongYears = Math.floor(MAX_TIMEOUT_DURATION_MS / (365 * 24 * 60 * 60 * 1000)) + 1;
        expect(() => parseTimeoutDuration(`${tooLongYears}y`)).toThrow('Maksymalny timeout to 10y.');
    });
});
