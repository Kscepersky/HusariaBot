import {
    DASHBOARD_SECTIONS,
    type DashboardRole,
    type DashboardSection,
} from '../dashboard/dashboard-sections.js';
import { getPermissionStore, isSnowflake, type PermissionStore } from './permission-store.js';

export interface UserAccess {
    role: DashboardRole | null;
    sections: readonly DashboardSection[];
}

const NO_ACCESS: UserAccess = Object.freeze({ role: null, sections: Object.freeze([]) });

/**
 * ID ownera z `OWNER_ID`. Rzuca, gdy brakuje go lub nie jest poprawnym
 * snowflake'iem - bot nie ma startowac w stanie, w ktorym nikt nie jest ownerem.
 */
export function getOwnerId(): string {
    const value = process.env.OWNER_ID?.trim();
    if (!value || !isSnowflake(value)) {
        throw new Error('Brakujaca lub niepoprawna zmienna srodowiskowa OWNER_ID (oczekiwano Discord ID uzytkownika).');
    }
    return value;
}

/** Bezpieczna wersja dla sciezek autoryzacji: zla konfiguracja = nikt nie jest ownerem. */
export function isOwner(userId: string | undefined | null): boolean {
    if (!userId) return false;
    try {
        return userId === getOwnerId();
    } catch {
        return false;
    }
}

export async function resolveUserAccess(
    userId: string | undefined | null,
    store?: PermissionStore,
): Promise<UserAccess> {
    if (!userId || !isSnowflake(userId)) {
        return NO_ACCESS;
    }

    if (isOwner(userId)) {
        return { role: 'owner', sections: DASHBOARD_SECTIONS };
    }

    const sections = await (store ?? await getPermissionStore()).getSections(userId);
    return sections.length > 0 ? { role: 'staff', sections } : NO_ACCESS;
}

export function canAccess(access: UserAccess, section: DashboardSection): boolean {
    return access.sections.includes(section);
}
