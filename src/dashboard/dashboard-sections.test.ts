import { describe, expect, it } from 'vitest';
import {
    DASHBOARD_ROLES,
    DASHBOARD_SECTIONS,
    canAccessSection,
    isDashboardLanguage,
    resolveAllowedSections,
    resolveDefaultLanguage,
    type DashboardSection,
} from './dashboard-sections.js';

const G2STAFF_ALLOWED: DashboardSection[] = [
    'embed-creator',
    'scheduled-posts',
    'sent-posts',
    'events',
    'g2-matches',
    'economy-leaderboard',
    'image-library',
    'server-stats',
];

const G2STAFF_DENIED: DashboardSection[] = [
    'economy-settings',
    'shop',
    'timeouts-system',
    'ticket-history',
    'system-logs',
    'session-activity',
];

describe('canAccessSection', () => {
    it('rozstrzyga kazda pare rola x sekcja bez wyjatku', () => {
        for (const role of DASHBOARD_ROLES) {
            for (const section of DASHBOARD_SECTIONS) {
                expect(typeof canAccessSection(role, section)).toBe('boolean');
            }
        }
    });

    it('dev widzi wszystkie sekcje', () => {
        for (const section of DASHBOARD_SECTIONS) {
            expect(canAccessSection('dev', section)).toBe(true);
        }
    });

    it.each(['admin', 'moderator', 'community_manager'] as const)('%s widzi wszystko poza sekcjami dev-only', (role) => {
        expect(canAccessSection(role, 'economy-settings')).toBe(false);
        expect(canAccessSection(role, 'system-logs')).toBe(false);
        expect(canAccessSection(role, 'session-activity')).toBe(false);
        expect(canAccessSection(role, 'shop')).toBe(true);
        expect(canAccessSection(role, 'timeouts-system')).toBe(true);
        expect(canAccessSection(role, 'ticket-history')).toBe(true);
    });

    it.each(G2STAFF_ALLOWED)('g2staff ma dostep do sekcji %s', (section) => {
        expect(canAccessSection('g2staff', section)).toBe(true);
    });

    it.each(G2STAFF_DENIED)('g2staff nie ma dostepu do sekcji %s', (section) => {
        expect(canAccessSection('g2staff', section)).toBe(false);
    });

    it('g2staff ma dokladnie 8 dozwolonych sekcji', () => {
        expect([...resolveAllowedSections('g2staff')].sort()).toEqual([...G2STAFF_ALLOWED].sort());
    });

    it('member i nieznane role nie dostaja zadnej sekcji', () => {
        for (const section of DASHBOARD_SECTIONS) {
            expect(canAccessSection('member', section)).toBe(false);
            expect(canAccessSection('nieznana-rola', section)).toBe(false);
            expect(canAccessSection(undefined, section)).toBe(false);
            expect(canAccessSection(null, section)).toBe(false);
        }
    });
});

describe('resolveDefaultLanguage', () => {
    it('zwraca angielski dla g2staff', () => {
        expect(resolveDefaultLanguage('g2staff')).toBe('en');
    });

    it.each(['dev', 'admin', 'moderator', 'community_manager'] as const)('zwraca polski dla %s', (role) => {
        expect(resolveDefaultLanguage(role)).toBe('pl');
    });

    it('domyslnie zwraca polski dla nieznanej roli', () => {
        expect(resolveDefaultLanguage('cokolwiek')).toBe('pl');
    });
});

describe('isDashboardLanguage', () => {
    it('akceptuje wylacznie pl i en', () => {
        expect(isDashboardLanguage('pl')).toBe(true);
        expect(isDashboardLanguage('en')).toBe(true);
        expect(isDashboardLanguage('de')).toBe(false);
        expect(isDashboardLanguage('')).toBe(false);
        expect(isDashboardLanguage('PL')).toBe(false);
        expect(isDashboardLanguage({})).toBe(false);
        expect(isDashboardLanguage(null)).toBe(false);
    });
});
