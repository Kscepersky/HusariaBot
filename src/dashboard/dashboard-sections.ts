/**
 * Jedyne zrodlo prawdy o sekcjach dashboardu i ich podziale na przydzielane
 * uzytkownikom oraz zarezerwowane dla ownera.
 *
 * Wartosci `DashboardSection` odpowiadaja atrybutom `data-section` w
 * `views/dashboard.html` - dzieki temu ta sama lista steruje ukrywaniem
 * zakladek we froncie i autoryzacja endpointow w API.
 */

export const DASHBOARD_SECTIONS = [
    'embed-creator',
    'scheduled-posts',
    'sent-posts',
    'events',
    'g2-matches',
    'economy-settings',
    'economy-leaderboard',
    'shop',
    'timeouts-system',
    'ticket-history',
    'image-library',
    'server-stats',
    'system-logs',
    'session-activity',
    'permissions',
] as const;

export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number];

/** `owner` ma pelny dostep, `staff` tylko sekcje nadane w panelu uprawnien. */
export const DASHBOARD_ROLES = ['owner', 'staff'] as const;

export type DashboardRole = (typeof DASHBOARD_ROLES)[number];

export type DashboardLanguage = 'pl' | 'en';

/** Sekcje, ktorych nie da sie nikomu nadac - widzi je wylacznie owner. */
export const OWNER_ONLY_SECTIONS: readonly DashboardSection[] = [
    'economy-settings',
    'system-logs',
    'session-activity',
    'permissions',
];

/** Sekcje, ktore owner moze przydzielac innym uzytkownikom. */
export const ASSIGNABLE_SECTIONS: readonly DashboardSection[] = DASHBOARD_SECTIONS
    .filter((section) => !OWNER_ONLY_SECTIONS.includes(section));

/** Domyslny jezyk dashboardu, gdy uzytkownik nie wybral wlasnego. */
export const DEFAULT_DASHBOARD_LANGUAGE: DashboardLanguage = 'pl';

export function isDashboardSection(value: unknown): value is DashboardSection {
    return typeof value === 'string' && (DASHBOARD_SECTIONS as readonly string[]).includes(value);
}

export function isAssignableSection(value: unknown): value is DashboardSection {
    return isDashboardSection(value) && ASSIGNABLE_SECTIONS.includes(value);
}

export function isDashboardLanguage(value: unknown): value is DashboardLanguage {
    return value === 'pl' || value === 'en';
}

/** Sortuje wg kolejnosci z `DASHBOARD_SECTIONS` i usuwa duplikaty. */
export function normalizeSections(sections: readonly DashboardSection[]): DashboardSection[] {
    return DASHBOARD_SECTIONS.filter((section) => sections.includes(section));
}
