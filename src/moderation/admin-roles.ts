import { isOwner } from '../permissions/access.js';
import { isSnowflake } from '../permissions/permission-store.js';

/** Zmienne z ID 4 rang administracyjnych (weryfikacja, honeypot). */
export const ADMIN_ROLE_ENV_KEYS = [
    'ADMIN_ROLE_1_ID',
    'ADMIN_ROLE_2_ID',
    'ADMIN_ROLE_3_ID',
    'ADMIN_ROLE_4_ID',
] as const;

export interface ModerationSubject {
    userId: string;
    roleIds: readonly string[];
    hasAdministratorPermission: boolean;
}

/** Poprawne, unikalne ID rang administracyjnych w kolejnosci zmiennych. Puste/niepoprawne sa pomijane. */
export function getAdminRoleIds(): string[] {
    const ids = ADMIN_ROLE_ENV_KEYS
        .map((key) => process.env[key]?.trim() ?? '')
        .filter((value): value is string => isSnowflake(value));
    return [...new Set(ids)];
}

export function hasAdminRole(roleIds: readonly string[], adminRoleIds: readonly string[] = getAdminRoleIds()): boolean {
    return roleIds.some((roleId) => adminRoleIds.includes(roleId));
}

/** Owner, rangi administracyjne i uprawnienie Administrator nigdy nie sa celem automatycznej moderacji. */
export function isModerationExempt(subject: ModerationSubject, adminRoleIds: readonly string[] = getAdminRoleIds()): boolean {
    return isOwner(subject.userId)
        || subject.hasAdministratorPermission
        || hasAdminRole(subject.roleIds, adminRoleIds);
}
