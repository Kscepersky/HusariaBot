import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPermissionStore, type PermissionStore } from '../../permissions/permission-store.js';

vi.mock('../discord-api.js', () => ({
    getDiscordUserById: vi.fn(),
    getGuildMember: vi.fn(),
    getGuildRoles: vi.fn(),
    searchGuildMembers: vi.fn(),
}));

let store: PermissionStore;
vi.mock('../../permissions/permission-store.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../permissions/permission-store.js')>()),
    getPermissionStore: vi.fn(async () => store),
}));

import { getDiscordUserById, getGuildMember, getGuildRoles, searchGuildMembers } from '../discord-api.js';
import { permissionsRouter } from './api.permissions.js';

const OWNER = '111111111111111111';
const STAFF = '222222222222222222';
const TARGET = '444444444444444444';
const ROLE = '555555555555555555';

let server: Server;
let baseUrl: string;
let sessionUserId: string | undefined;

async function startServer(): Promise<void> {
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
        (req as unknown as { session: unknown }).session = { user: sessionUserId ? { id: sessionUserId, username: 'u' } : undefined };
        next();
    });
    app.use('/api', permissionsRouter);

    await new Promise<void>((resolve) => {
        server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function send(path: string, method = 'GET', body?: unknown): Promise<globalThis.Response> {
    return fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

describe('permissions API', () => {
    beforeEach(async () => {
        vi.resetAllMocks();
        process.env.OWNER_ID = OWNER;
        process.env.GUILD_ID = '999999999999999999';
        sessionUserId = OWNER;
        store = await createPermissionStore(':memory:');
        vi.mocked(getGuildMember).mockResolvedValue({ roles: [] } as never);
        vi.mocked(getDiscordUserById).mockResolvedValue({ id: TARGET, username: 'target', global_name: 'Target', avatar: null, discriminator: '0' });
        vi.mocked(getGuildRoles).mockResolvedValue([{ id: ROLE, name: 'Support', position: 1, managed: false, permissions: '0' }]);
        await startServer();
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await store.close();
    });

    describe('autoryzacja', () => {
        const endpoints: Array<[string, string, unknown?]> = [
            ['/api/permissions', 'GET'],
            ['/api/permissions/members?q=ab', 'GET'],
            ['/api/permissions/audit', 'GET'],
            ['/api/permissions/settings', 'GET'],
            [`/api/permissions/users/${TARGET}`, 'PUT', { sections: ['events'] }],
            [`/api/permissions/users/${TARGET}`, 'DELETE'],
            ['/api/permissions/settings/support-role', 'PUT', { roleId: ROLE }],
        ];

        it.each(endpoints)('%s %s odrzuca staff nawet z szerokimi uprawnieniami', async (path, method, body) => {
            await store.setSections(STAFF, ['embed-creator', 'shop', 'ticket-history'], OWNER);
            sessionUserId = STAFF;

            const response = await send(path, method, body);
            expect(response.status).toBe(403);
            expect(await store.getSections(TARGET)).toEqual([]);
            expect(await store.getSetting('support_role_id')).toBeNull();
        });

        it.each(endpoints)('%s %s odrzuca niezalogowanego', async (path, method, body) => {
            sessionUserId = undefined;
            expect((await send(path, method, body)).status).toBe(401);
        });
    });

    describe('nadawanie uprawnien', () => {
        it('owner nadaje sekcje i widzi je na liscie', async () => {
            const response = await send(`/api/permissions/users/${TARGET}`, 'PUT', { sections: ['shop', 'embed-creator'] });
            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({ success: true, sections: ['embed-creator', 'shop'] });

            const list = await (await send('/api/permissions')).json() as { entries: Array<{ userId: string; user: { username: string } }> };
            expect(list.entries).toHaveLength(1);
            expect(list.entries[0]).toMatchObject({ userId: TARGET, user: { username: 'target' } });
        });

        it('odrzuca sekcje owner-only i nieznane', async () => {
            for (const sections of [['permissions'], ['system-logs'], ['economy-settings'], ['session-activity'], ['nie-ma']]) {
                const response = await send(`/api/permissions/users/${TARGET}`, 'PUT', { sections });
                expect(response.status).toBe(400);
            }
            expect(await store.getSections(TARGET)).toEqual([]);
        });

        it('nie pozwala zmieniac uprawnien ownera', async () => {
            expect((await send(`/api/permissions/users/${OWNER}`, 'PUT', { sections: [] })).status).toBe(400);
            expect((await send(`/api/permissions/users/${OWNER}`, 'DELETE')).status).toBe(400);
            expect(await store.list()).toEqual([]);
        });

        it('waliduje ID uzytkownika i ksztalt body', async () => {
            expect((await send('/api/permissions/users/abc', 'PUT', { sections: ['events'] })).status).toBe(400);
            expect((await send(`/api/permissions/users/${TARGET}`, 'PUT', { sections: 'events' })).status).toBe(400);
            expect((await send(`/api/permissions/users/${TARGET}`, 'PUT', {})).status).toBe(400);
        });

        it('nie nadaje dostepu osobie spoza serwera', async () => {
            vi.mocked(getGuildMember).mockResolvedValue(null);
            const response = await send(`/api/permissions/users/${TARGET}`, 'PUT', { sections: ['events'] });
            expect(response.status).toBe(404);
            expect(await store.getSections(TARGET)).toEqual([]);
        });

        it('DELETE odbiera caly dostep', async () => {
            await store.setSections(TARGET, ['events'], OWNER);
            expect((await send(`/api/permissions/users/${TARGET}`, 'DELETE')).status).toBe(200);
            expect(await store.getSections(TARGET)).toEqual([]);
        });
    });

    describe('audyt', () => {
        it('zapisuje kazda zmiane z wykonawca i stanem przed/po', async () => {
            await send(`/api/permissions/users/${TARGET}`, 'PUT', { sections: ['events'] });
            await send(`/api/permissions/users/${TARGET}`, 'PUT', { sections: ['events', 'shop'] });
            await send(`/api/permissions/users/${TARGET}`, 'DELETE');

            const audit = await (await send('/api/permissions/audit')).json() as {
                total: number;
                entries: Array<{ action: string; actorId: string; targetId: string; before: string[]; after: string[] }>;
            };
            expect(audit.total).toBe(3);
            expect(audit.entries.map((entry) => entry.action)).toEqual(['revoke', 'update', 'grant']);
            expect(audit.entries.every((entry) => entry.actorId === OWNER && entry.targetId === TARGET)).toBe(true);
        });

        it('nieudana lub nieprawidlowa zmiana nie trafia do audytu', async () => {
            await send(`/api/permissions/users/${TARGET}`, 'PUT', { sections: ['permissions'] });
            expect((await store.listAudit(1, 10)).total).toBe(0);
        });
    });

    describe('wyszukiwarka czlonkow', () => {
        it('zwraca wyniki z oznaczeniem ownera i posiadaczy dostepu', async () => {
            await store.setSections(TARGET, ['events'], OWNER);
            vi.mocked(searchGuildMembers).mockResolvedValue([
                { id: TARGET, username: 'target', globalName: null, nick: null },
                { id: OWNER, username: 'owner', globalName: null, nick: null },
            ]);

            const body = await (await send('/api/permissions/members?q=ta')).json() as { members: Array<{ id: string; isOwner: boolean; hasAccess: boolean }> };
            expect(body.members).toEqual([
                expect.objectContaining({ id: TARGET, isOwner: false, hasAccess: true }),
                expect.objectContaining({ id: OWNER, isOwner: true, hasAccess: false }),
            ]);
        });

        it('nie odpytuje Discorda dla zbyt krotkiej frazy', async () => {
            const body = await (await send('/api/permissions/members?q=a')).json();
            expect(body).toEqual({ members: [] });
            expect(searchGuildMembers).not.toHaveBeenCalled();
        });
    });

    describe('rola supportu', () => {
        it('zapisuje istniejaca role i loguje zmiane w audycie', async () => {
            expect((await send('/api/permissions/settings/support-role', 'PUT', { roleId: ROLE })).status).toBe(200);
            expect(await store.getSetting('support_role_id')).toBe(ROLE);

            const settings = await (await send('/api/permissions/settings')).json() as { supportRoleId: string };
            expect(settings.supportRoleId).toBe(ROLE);
            expect((await store.listAudit(1, 10)).entries[0]?.action).toBe('setting');
        });

        it('odrzuca nieistniejaca i niepoprawna role, pozwala wyczyscic', async () => {
            expect((await send('/api/permissions/settings/support-role', 'PUT', { roleId: '666666666666666666' })).status).toBe(404);
            expect((await send('/api/permissions/settings/support-role', 'PUT', { roleId: 'abc' })).status).toBe(400);
            expect((await send('/api/permissions/settings/support-role', 'PUT', {})).status).toBe(400);

            await store.setSetting('support_role_id', ROLE, OWNER);
            expect((await send('/api/permissions/settings/support-role', 'PUT', { roleId: null })).status).toBe(200);
            expect(await store.getSetting('support_role_id')).toBeNull();
        });
    });
});
