import { describe, expect, it } from 'vitest';
import {
    ASSIGNABLE_SECTIONS,
    DASHBOARD_SECTIONS,
    OWNER_ONLY_SECTIONS,
    isAssignableSection,
    isDashboardLanguage,
    isDashboardSection,
    normalizeSections,
} from './dashboard-sections.js';

describe('podzial sekcji', () => {
    it('owner-only i przydzielane sa rozlaczne i razem daja wszystkie sekcje', () => {
        expect(ASSIGNABLE_SECTIONS.filter((section) => OWNER_ONLY_SECTIONS.includes(section))).toEqual([]);
        expect([...ASSIGNABLE_SECTIONS, ...OWNER_ONLY_SECTIONS].sort()).toEqual([...DASHBOARD_SECTIONS].sort());
    });

    it.each(['economy-settings', 'system-logs', 'session-activity', 'permissions'])('%s jest tylko dla ownera', (section) => {
        expect(OWNER_ONLY_SECTIONS).toContain(section);
        expect(isAssignableSection(section)).toBe(false);
    });

    it.each(['embed-creator', 'shop', 'timeouts-system', 'ticket-history', 'economy-leaderboard'])('%s mozna przydzielic', (section) => {
        expect(isAssignableSection(section)).toBe(true);
    });
});

describe('walidatory', () => {
    it('isDashboardSection odrzuca nieznane wartosci i nie-stringi', () => {
        expect(isDashboardSection('shop')).toBe(true);
        expect(isDashboardSection('nope')).toBe(false);
        expect(isDashboardSection(null)).toBe(false);
        expect(isDashboardSection(42)).toBe(false);
    });

    it('isAssignableSection odrzuca nieznane wartosci', () => {
        expect(isAssignableSection('__proto__')).toBe(false);
        expect(isAssignableSection(undefined)).toBe(false);
    });

    it('isDashboardLanguage przyjmuje tylko pl i en', () => {
        expect(isDashboardLanguage('pl')).toBe(true);
        expect(isDashboardLanguage('en')).toBe(true);
        expect(isDashboardLanguage('de')).toBe(false);
    });
});

describe('normalizeSections', () => {
    it('sortuje wg kolejnosci dashboardu i usuwa duplikaty', () => {
        expect(normalizeSections(['shop', 'embed-creator', 'shop'])).toEqual(['embed-creator', 'shop']);
    });

    it('nie mutuje wejscia', () => {
        const input = Object.freeze(['shop', 'embed-creator'] as const);
        expect(() => normalizeSections(input)).not.toThrow();
        expect(input).toEqual(['shop', 'embed-creator']);
    });
});
