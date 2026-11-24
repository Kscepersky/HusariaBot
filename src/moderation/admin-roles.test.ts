import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_ROLE_ENV_KEYS, getAdminRoleIds, isModerationExempt } from './admin-roles.js';

const OWNER = '111111111111111111';
const ADMIN_ROLE_A = '200000000000000001';
const ADMIN_ROLE_B = '200000000000000002';

function clearAdminRoleEnv(): void {
    for (const key of ADMIN_ROLE_ENV_KEYS) {
        delete process.env[key];
    }
}

afterEach(() => {
    clearAdminRoleEnv();
    delete process.env.OWNER_ID;
});

describe('getAdminRoleIds', () => {
    it('zwraca pusta liste, gdy zadna zmienna nie jest ustawiona', () => {
        clearAdminRoleEnv();
        expect(getAdminRoleIds()).toEqual([]);
    });

    it('czyta 4 zmienne, pomija puste i niepoprawne oraz duplikaty', () => {
        process.env.ADMIN_ROLE_1_ID = ADMIN_ROLE_A;
        process.env.ADMIN_ROLE_2_ID = ' ';
        process.env.ADMIN_ROLE_3_ID = 'not-a-snowflake';
        process.env.ADMIN_ROLE_4_ID = ` ${ADMIN_ROLE_A} `;

        expect(getAdminRoleIds()).toEqual([ADMIN_ROLE_A]);
    });

    it('zachowuje kolejnosc zmiennych', () => {
        process.env.ADMIN_ROLE_1_ID = ADMIN_ROLE_B;
        process.env.ADMIN_ROLE_2_ID = ADMIN_ROLE_A;

        expect(getAdminRoleIds()).toEqual([ADMIN_ROLE_B, ADMIN_ROLE_A]);
    });
});

describe('isModerationExempt', () => {
    const adminRoleIds = [ADMIN_ROLE_A];

    it('chroni ownera', () => {
        process.env.OWNER_ID = OWNER;
        expect(isModerationExempt({ userId: OWNER, roleIds: [], hasAdministratorPermission: false }, adminRoleIds)).toBe(true);
    });

    it('chroni osoby z ranga administracyjna', () => {
        expect(isModerationExempt({ userId: '3'.repeat(18), roleIds: [ADMIN_ROLE_A], hasAdministratorPermission: false }, adminRoleIds)).toBe(true);
    });

    it('chroni osoby z uprawnieniem Administrator', () => {
        expect(isModerationExempt({ userId: '3'.repeat(18), roleIds: [], hasAdministratorPermission: true }, adminRoleIds)).toBe(true);
    });

    it('nie chroni zwyklego uzytkownika', () => {
        process.env.OWNER_ID = OWNER;
        expect(isModerationExempt({ userId: '3'.repeat(18), roleIds: [ADMIN_ROLE_B], hasAdministratorPermission: false }, adminRoleIds)).toBe(false);
    });
});
