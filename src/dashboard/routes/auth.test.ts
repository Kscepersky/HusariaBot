import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPermissionStore, type PermissionStore } from '../../permissions/permission-store.js';

let store: PermissionStore;
vi.mock('../../permissions/permission-store.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../permissions/permission-store.js')>()),
    getPermissionStore: vi.fn(async () => store),
}));

vi.mock('../discord-api.js', () => ({
    exchangeCode: vi.fn(),
    getDiscordUser: vi.fn(),
    getGuildMember: vi.fn(),
}));

vi.mock('../session/session-events.js', () => ({
    recordSessionEvent: vi.fn(async () => undefined),
    forceLogoutAllActiveSessions: vi.fn(async () => 0),
}));

vi.mock('../../utils/discord-user-cache.js', () => ({
    cacheDiscordUser: vi.fn(),
}));

import { exchangeCode, getDiscordUser, getGuildMember } from '../discord-api.js';

const OWNER = '111111111111111111';
const STAFF = '222222222222222222';
const STRANGER = '333333333333333333';
const VALID_STATE = 'valid-state';

interface FakeSession {
    oauthState?: string;
    user?: { id: string; dashboardRole?: string };
    regenerate: (callback: (error?: Error) => void) => void;
    destroy: (callback: (error?: Error) => void) => void;
}

let server: Server;
let baseUrl: string;
let session: FakeSession;
let sessionStore: { clear: (callback: (error?: unknown) => void) => void };

function discordUser(id: string) {
    return { id, username: `user-${id}`, global_name: null, avatar: null, discriminator: '0' };
}

async function login(query: string): Promise<{ status: number; location: string | null }> {
    const response = await fetch(`${baseUrl}/auth/discord/callback?${query}`, { redirect: 'manual' });
    return { status: response.status, location: response.headers.get('location') };
}

beforeAll(async () => {
    process.env.GUILD_ID = '999999999999999999';
    const { authRouter } = await import('./auth.js');

    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
        const reqWithSession = req as unknown as { session: FakeSession; sessionStore: unknown };
        reqWithSession.session = session;
        reqWithSession.sessionStore = sessionStore;
        next();
    });
    app.use('/auth', authRouter);

    await new Promise<void>((resolve) => {
        server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
    vi.resetAllMocks();
    process.env.OWNER_ID = OWNER;
    process.env.DISCORD_REDIRECT_URI = 'http://localhost/cb';
    store = await createPermissionStore(':memory:');
    await store.setSections(STAFF, ['events'], OWNER);

    session = {
        oauthState: VALID_STATE,
        regenerate: (callback) => callback(),
        destroy: (callback) => callback(),
    };
    sessionStore = { clear: (callback) => callback() };

    vi.mocked(exchangeCode).mockResolvedValue('token');
    vi.mocked(getGuildMember).mockResolvedValue({ roles: ['admin', 'moderator', 'dev'] } as never);
});

describe('logowanie przez OAuth', () => {
    it('wpuszcza ownera i ustawia role owner, nawet gdy nie ma go w bazie', async () => {
        vi.mocked(getDiscordUser).mockResolvedValue(discordUser(OWNER));

        const result = await login(`code=c&state=${VALID_STATE}`);

        expect(result.location).toBe('/');
        expect(session.user).toMatchObject({ id: OWNER, dashboardRole: 'owner' });
    });

    it('wpuszcza staff z wpisem w bazie jako staff', async () => {
        vi.mocked(getDiscordUser).mockResolvedValue(discordUser(STAFF));

        const result = await login(`code=c&state=${VALID_STATE}`);

        expect(result.location).toBe('/');
        expect(session.user).toMatchObject({ id: STAFF, dashboardRole: 'staff' });
    });

    it('odrzuca czlonka serwera bez wpisu w bazie, nawet z rolami administracyjnymi na Discordzie', async () => {
        vi.mocked(getDiscordUser).mockResolvedValue(discordUser(STRANGER));

        const result = await login(`code=c&state=${VALID_STATE}`);

        expect(result.location).toBe('/auth/error?msg=no_access');
        expect(session.user).toBeUndefined();
    });

    it('odrzuca nie-czlonka serwera (nie-ownera) jako not_member', async () => {
        vi.mocked(getDiscordUser).mockResolvedValue(discordUser(STAFF));
        vi.mocked(getGuildMember).mockResolvedValue(null);

        const result = await login(`code=c&state=${VALID_STATE}`);

        expect(result.location).toBe('/auth/error?msg=not_member');
        expect(session.user).toBeUndefined();
    });

    it('odrzuca uzytkownika, ktoremu odebrano dostep (pusta lista sekcji)', async () => {
        await store.setSections(STAFF, [], OWNER);
        vi.mocked(getDiscordUser).mockResolvedValue(discordUser(STAFF));

        expect((await login(`code=c&state=${VALID_STATE}`)).location).toBe('/auth/error?msg=no_access');
        expect(session.user).toBeUndefined();
    });

    it('odrzuca zly lub brakujacy state OAuth (CSRF logowania) bez kontaktu z Discordem', async () => {
        expect((await login('code=c&state=podrobiony')).location).toBe('/auth/error?msg=invalid_state');
        expect((await login('code=c')).location).toBe('/auth/error?msg=invalid_state');
        expect((await login(`state=${VALID_STATE}`)).location).toBe('/auth/error?msg=invalid_state');
        expect(exchangeCode).not.toHaveBeenCalled();
        expect(session.user).toBeUndefined();
    });

    it('state jest jednorazowy - ponowne uzycie jest odrzucane', async () => {
        vi.mocked(getDiscordUser).mockResolvedValue(discordUser(OWNER));

        expect((await login(`code=c&state=${VALID_STATE}`)).location).toBe('/');
        session.user = undefined;
        expect((await login(`code=c&state=${VALID_STATE}`)).location).toBe('/auth/error?msg=invalid_state');
    });

    it('przy bledzie wymiany kodu / Discorda nie loguje nikogo (fail closed)', async () => {
        vi.mocked(exchangeCode).mockRejectedValue(new Error('discord down'));

        const result = await login(`code=c&state=${VALID_STATE}`);

        expect(result.location).toBe('/auth/error?msg=auth_failed');
        expect(session.user).toBeUndefined();
    });

    it('przy awarii bazy uprawnien nie loguje nikogo', async () => {
        vi.mocked(getDiscordUser).mockResolvedValue(discordUser(STAFF));
        await store.close();

        const result = await login(`code=c&state=${VALID_STATE}`);

        expect(result.location).toBe('/auth/error?msg=auth_failed');
        expect(session.user).toBeUndefined();
    });

    it('przy zle skonfigurowanym OWNER_ID nikt nie jest ownerem', async () => {
        process.env.OWNER_ID = 'zepsute';
        vi.mocked(getDiscordUser).mockResolvedValue(discordUser(OWNER));

        const result = await login(`code=c&state=${VALID_STATE}`);

        expect(result.location).toBe('/auth/error?msg=no_access');
    });
});

describe('killswitch', () => {
    async function killswitch(): Promise<number> {
        return (await fetch(`${baseUrl}/auth/killswitch`, { method: 'POST' })).status;
    }

    it('dziala tylko dla ownera', async () => {
        session.user = { id: OWNER };
        expect(await killswitch()).toBe(200);
    });

    it.each([STAFF, STRANGER])('odrzuca %s kodem 403', async (userId) => {
        session.user = { id: userId };
        expect(await killswitch()).toBe(403);
    });

    it('odrzuca niezalogowanego kodem 401', async () => {
        session.user = undefined;
        expect(await killswitch()).toBe(401);
    });
});

describe('strona bledu', () => {
    it('nie wywala sie na kluczach z prototypu i nie odbija wejscia', async () => {
        for (const msg of ['__proto__', 'constructor', 'toString', '<script>alert(1)</script>']) {
            const response = await fetch(`${baseUrl}/auth/error?msg=${encodeURIComponent(msg)}`);
            const html = await response.text();
            expect(response.status).toBe(403);
            expect(html).toContain('Wystąpił nieznany błąd.');
            expect(html).not.toContain('<script>alert');
        }
    });
});
