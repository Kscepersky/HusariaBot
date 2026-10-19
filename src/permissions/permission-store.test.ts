import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPermissionStore, type PermissionStore } from './permission-store.js';

const ACTOR = '100000000000000001';
const USER_A = '200000000000000001';
const USER_B = '200000000000000002';

describe('permission store', () => {
    let store: PermissionStore;

    beforeEach(async () => {
        store = await createPermissionStore(':memory:');
    });

    afterEach(async () => {
        await store.close();
    });

    it('zwraca pusta liste sekcji dla nieznanego uzytkownika', async () => {
        expect(await store.getSections(USER_A)).toEqual([]);
    });

    it('zapisuje sekcje i zwraca je w stalej kolejnosci bez duplikatow', async () => {
        await store.setSections(USER_A, ['events', 'embed-creator', 'events'], ACTOR);
        expect(await store.getSections(USER_A)).toEqual(['embed-creator', 'events']);
    });

    it('odrzuca nieznane sekcje i sekcje tylko dla ownera', async () => {
        await expect(store.setSections(USER_A, ['nie-ma-takiej' as never], ACTOR)).rejects.toThrow();
        await expect(store.setSections(USER_A, ['system-logs'], ACTOR)).rejects.toThrow();
        await expect(store.setSections(USER_A, ['permissions'], ACTOR)).rejects.toThrow();
        expect(await store.getSections(USER_A)).toEqual([]);
    });

    it('odrzuca niepoprawne ID uzytkownika', async () => {
        await expect(store.setSections('abc', ['events'], ACTOR)).rejects.toThrow();
        await expect(store.setSections(USER_A, ['events'], 'abc')).rejects.toThrow();
    });

    it('pusta lista sekcji odbiera dostep i usuwa wpis', async () => {
        await store.setSections(USER_A, ['events'], ACTOR);
        await store.setSections(USER_A, [], ACTOR);

        expect(await store.getSections(USER_A)).toEqual([]);
        expect(await store.list()).toEqual([]);
    });

    it('list zwraca wpisy ze wszystkimi uzytkownikami', async () => {
        await store.setSections(USER_A, ['events'], ACTOR);
        await store.setSections(USER_B, ['shop', 'embed-creator'], ACTOR);

        const entries = await store.list();
        expect(entries.map((entry) => entry.userId).sort()).toEqual([USER_A, USER_B]);
        expect(entries.find((entry) => entry.userId === USER_B)?.sections).toEqual(['embed-creator', 'shop']);
        expect(entries.find((entry) => entry.userId === USER_B)?.grantedBy).toBe(ACTOR);
    });

    it('kazda zmiana trafia do logu audytowego ze stanem przed i po', async () => {
        await store.setSections(USER_A, ['events'], ACTOR);
        await store.setSections(USER_A, ['events', 'shop'], ACTOR);
        await store.setSections(USER_A, [], ACTOR);

        const audit = await store.listAudit(1, 50);
        expect(audit.total).toBe(3);

        const [revoke, update, grant] = audit.entries;
        expect(grant).toMatchObject({ action: 'grant', actorId: ACTOR, targetId: USER_A, before: [], after: ['events'] });
        expect(update).toMatchObject({ action: 'update', before: ['events'], after: ['events', 'shop'] });
        expect(revoke).toMatchObject({ action: 'revoke', before: ['events', 'shop'], after: [] });
    });

    it('nie zapisuje audytu, gdy nic sie nie zmienilo', async () => {
        await store.setSections(USER_A, ['events'], ACTOR);
        await store.setSections(USER_A, ['events'], ACTOR);
        await store.setSections(USER_B, [], ACTOR);

        expect((await store.listAudit(1, 50)).total).toBe(1);
    });

    it('audyt jest stronicowany od najnowszych', async () => {
        await store.setSections(USER_A, ['events'], ACTOR);
        await store.setSections(USER_A, ['shop'], ACTOR);
        await store.setSections(USER_A, ['embed-creator'], ACTOR);

        const page = await store.listAudit(2, 2);
        expect(page.total).toBe(3);
        expect(page.totalPages).toBe(2);
        expect(page.entries).toHaveLength(1);
        expect(page.entries[0]?.action).toBe('grant');
    });

    it('ustawienia zapisuja wartosc i loguja zmiane w audycie', async () => {
        expect(await store.getSetting('support_role_id')).toBeNull();

        await store.setSetting('support_role_id', '300000000000000001', ACTOR);
        expect(await store.getSetting('support_role_id')).toBe('300000000000000001');

        await store.setSetting('support_role_id', null, ACTOR);
        expect(await store.getSetting('support_role_id')).toBeNull();

        const audit = await store.listAudit(1, 50);
        expect(audit.entries.map((entry) => entry.action)).toEqual(['setting', 'setting']);
        expect(audit.entries[1]).toMatchObject({ targetId: 'support_role_id', after: ['300000000000000001'] });
    });

    it('odrzuca nieznany klucz ustawienia', async () => {
        await expect(store.setSetting('cokolwiek' as never, 'x', ACTOR)).rejects.toThrow();
    });
});
