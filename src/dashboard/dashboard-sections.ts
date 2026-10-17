/**
 * Jedyne zrodlo prawdy o tym, ktora rola dashboardu widzi ktora sekcje.
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
] as const;

export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number];

export const DASHBOARD_ROLES = [
    'dev',
    'admin',
    'moderator',
    'community_manager',
    'g2staff',
    'member',
] as const;

export type DashboardRole = (typeof DASHBOARD_ROLES)[number];

export type DashboardLanguage = 'pl' | 'en';

/** Sekcje zarezerwowane dla roli dev. */
const DEV_ONLY_SECTIONS: readonly DashboardSection[] = [
    'economy-settings',
    'system-logs',
    'session-activity',
];

/** Pelny zakres roli support (admin / moderator / community_manager). */
const SUPPORT_SECTIONS: readonly DashboardSection[] = DASHBOARD_SECTIONS
    .filter((section) => !DEV_ONLY_SECTIONS.includes(section));

/** Wezszy zakres roli g2staff - wylacznie zakladki contentowe i read-only. */
const G2STAFF_SECTIONS: readonly DashboardSection[] = [
    'embed-creator',
    'scheduled-posts',
    'sent-posts',
    'events',
    'g2-matches',
    'economy-leaderboard',
    'image-library',
    'server-stats',
];

export const SECTION_ACCESS_BY_ROLE: Readonly<Record<DashboardRole, readonly DashboardSection[]>> = {
    dev: DASHBOARD_SECTIONS,
    admin: SUPPORT_SECTIONS,
    moderator: SUPPORT_SECTIONS,
    community_manager: SUPPORT_SECTIONS,
    g2staff: G2STAFF_SECTIONS,
    member: [],
};

/** Domyslny jezyk dashboardu, gdy uzytkownik nie wybral wlasnego. */
const DEFAULT_LANGUAGE_BY_ROLE: Readonly<Record<DashboardRole, DashboardLanguage>> = {
    dev: 'pl',
    admin: 'pl',
    moderator: 'pl',
    community_manager: 'pl',
    g2staff: 'en',
    member: 'pl',
};

export function isDashboardRole(value: unknown): value is DashboardRole {
    return typeof value === 'string' && (DASHBOARD_ROLES as readonly string[]).includes(value);
}

export function isDashboardSection(value: unknown): value is DashboardSection {
    return typeof value === 'string' && (DASHBOARD_SECTIONS as readonly string[]).includes(value);
}

export function isDashboardLanguage(value: unknown): value is DashboardLanguage {
    return value === 'pl' || value === 'en';
}

/** Sekcje dostepne dla roli. Nieznana rola nie dostaje niczego. */
export function resolveAllowedSections(role: unknown): readonly DashboardSection[] {
    return isDashboardRole(role) ? SECTION_ACCESS_BY_ROLE[role] : [];
}

export function canAccessSection(role: unknown, section: DashboardSection): boolean {
    return resolveAllowedSections(role).includes(section);
}

export function resolveDefaultLanguage(role: unknown): DashboardLanguage {
    return isDashboardRole(role) ? DEFAULT_LANGUAGE_BY_ROLE[role] : 'pl';
}
