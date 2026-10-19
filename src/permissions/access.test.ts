import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPermissionStore, type PermissionStore } from './permission-store.js';
import { canAccess, getOwnerId, isOwner, resolveUserAccess } from './access.js';
import { ASSIGNABLE_SECTIONS, DASHBOARD_SECTIONS } from '../dashboard/dashboard-sections.js';

const OWNER = '111111111111111111';
const STAFF = '222222222222222222';
const STRANGER = '333333333333333333';

describe('access', () => {
    let store: PermissionStore;
    const originalOwner = process.env.OWNER_ID;

    beforeEach(async () => {
        process.env.OWNER_ID = OWNER;
        store = await createPermissionStore(':memory:');
    });

    afterEach(async () => {
        await store.close();
        if (originalOwner === undefined) delete process.env.OWNER_ID;
        else process.env.OWNER_ID = originalOwner;
    });

    describe('getOwnerId', () => {
        it('zwraca OWNER_ID z env', () => {
            expect(getOwnerId()).toBe(OWNER);
        });

        it('rzuca przy braku lub niepoprawnym OWNER_ID', () => {
            delete process.env.OWNER_ID;
            expect(() => getOwnerId()).toThrow(/OWNER_ID/);
            process.env.OWNER_ID = 'nie-snowflake';
            expect(() => getOwnerId()).toThrow(/OWNER_ID/);
            process.env.OWNER_ID = '  ';
            expect(() => getOwnerId()).toThrow(/OWNER_ID/);
        });

        it('przycina biale znaki', () => {
            process.env.OWNER_ID = ` ${OWNER} `;
            expect(getOwnerId()).toBe(OWNER);
        });
    });

    describe('isOwner', () => {
        it('rozpoznaje tylko dokladnie to ID', () => {
            expect(isOwner(OWNER)).toBe(true);
            expect(isOwner(STAFF)).toBe(false);
            expect(isOwner('')).toBe(false);
            expect(isOwner(undefined)).toBe(false);
        });

        it('zwraca false (nie rzuca) gdy OWNER_ID jest zle skonfigurowany', () => {
            delete process.env.OWNER_ID;
            expect(isOwner(OWNER)).toBe(false);
        });
    });

    describe('resolveUserAccess', () => {
        it('owner ma wszystkie sekcje, nawet bez wpisu w bazie', async () => {
            const access = await resolveUserAccess(OWNER, store);
            expect(access.role).toBe('owner');
            expect(access.sections).toEqual(DASHBOARD_SECTIONS);
        });

        it('staff dostaje dokladnie nadane sekcje', async () => {
            await store.setSections(STAFF, ['embed-creator', 'shop'], OWNER);
            const access = await resolveUserAccess(STAFF, store);
            expect(access.role).toBe('staff');
            expect(access.sections).toEqual(['embed-creator', 'shop']);
            expect(canAccess(access, 'shop')).toBe(true);
            expect(canAccess(access, 'events')).toBe(false);
        });

        it('uzytkownik bez wpisu nie ma roli ani sekcji', async () => {
            const access = await resolveUserAccess(STRANGER, store);
            expect(access).toEqual({ role: null, sections: [] });
            for (const section of DASHBOARD_SECTIONS) {
                expect(canAccess(access, section)).toBe(false);
            }
        });

        it('staff nigdy nie dostaje sekcji owner-only', async () => {
            await store.setSections(STAFF, [...ASSIGNABLE_SECTIONS], OWNER);
            const access = await resolveUserAccess(STAFF, store);
            for (const section of ['economy-settings', 'system-logs', 'session-activity', 'permissions'] as const) {
                expect(canAccess(access, section)).toBe(false);
            }
        });

        it('pusty lub niepoprawny userId nie daje dostepu', async () => {
            expect(await resolveUserAccess('', store)).toEqual({ role: null, sections: [] });
            expect(await resolveUserAccess('abc', store)).toEqual({ role: null, sections: [] });
        });

        it('odebranie uprawnien dziala od razu', async () => {
            await store.setSections(STAFF, ['events'], OWNER);
            expect((await resolveUserAccess(STAFF, store)).role).toBe('staff');
            await store.setSections(STAFF, [], OWNER);
            expect((await resolveUserAccess(STAFF, store)).role).toBeNull();
        });
    });
});
