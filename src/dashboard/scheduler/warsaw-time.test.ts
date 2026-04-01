import { describe, expect, it } from 'vitest';
import { parseWarsawDateTimeToTimestamp } from './warsaw-time.js';

describe('parseWarsawDateTimeToTimestamp', () => {
    it('parsuje poprawny datetime-local Europe/Warsaw', () => {
        const timestamp = parseWarsawDateTimeToTimestamp('2026-04-01T12:30');
        expect(typeof timestamp).toBe('number');
        expect(timestamp).not.toBeNull();
    });

    it('odrzuca niepoprawny format', () => {
        const timestamp = parseWarsawDateTimeToTimestamp('2026/04/01 12:30');
        expect(timestamp).toBeNull();
    });

    it('odrzuca nieistniejaca date', () => {
        const timestamp = parseWarsawDateTimeToTimestamp('2026-02-31T12:30');
        expect(timestamp).toBeNull();
    });
});
