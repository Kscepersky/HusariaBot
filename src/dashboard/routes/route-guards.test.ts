import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPermissionStore, type PermissionStore } from '../../permissions/permission-store.js';
import { ASSIGNABLE_SECTIONS } from '../dashboard-sections.js';

/**
 * Test strukturalny: uderza w KAZDA zarejestrowana trase API i sprawdza, ze
 * uzytkownik z zywa sesja, ale bez uprawnien (np. odebrano mu dostep po
 * zalogowaniu), nigdzie nie dostaje danych. Zapomniany guard na nowej trasie
 * wywali ten test.
 */

let store: PermissionStore;
vi.mock('../../permissions/permission-store.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../permissions/permission-store.js')>()),
    getPermissionStore: vi.fn(async () => store),
}));

vi.mock('../discord-api.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../discord-api.js')>()),
    getGuildMember: vi.fn(async () => ({ roles: [], user: { id: '1' } })),
}));

import { apiRouter } from './api.js';
import { scheduledRouter } from './scheduled.js';
import { g2MatchesRouter } from './g2-matches.js';
import { shopApiRouter } from './api.shop.js';

const OWNER = '111111111111111111';
const NOBODY = '333333333333333333';
const STAFF_ALL = '222222222222222222';

interface RouteSpec {
    method: string;
    path: string;
}

interface RouterLayer {
    route?: { path: string; methods: Record<string, boolean> };
    handle?: { stack?: RouterLayer[] };
}

function collectRoutes(router: Router, mountPath: string): RouteSpec[] {
    const specs: RouteSpec[] = [];

    function walk(layers: RouterLayer[]): void {
        for (const layer of layers) {
            if (layer.route) {
                for (const method of Object.keys(layer.route.methods)) {
                    specs.push({ method: method.toUpperCase(), path: `${mountPath}${layer.route.path}`.replace(/\/$/, '') || '/' });
                }
            } else if (layer.handle?.stack) {
                // Zagniezdzone routery sa montowane bez prefiksu (apiRouter.use(statsRouter) itd.).
                walk(layer.handle.stack);
            }
        }
    }

    walk((router as unknown as { stack: RouterLayer[] }).stack);
    return specs;
}

const ALL_ROUTES: RouteSpec[] = [
    ...collectRoutes(apiRouter, '/api'),
    ...collectRoutes(scheduledRouter, '/api/scheduled'),
    ...collectRoutes(g2MatchesRouter, '/api/g2-matches'),
    ...collectRoutes(shopApiRouter, '/api/shop'),
];

/** Trasy dostepne dla kazdej zalogowanej sesji - nie zwracaja danych poza wlasnymi. */
const SESSION_ONLY_ROUTES = new Set(['GET /api/me', 'PATCH /api/me/language']);

/** Trasy, ktorych NIE moze dostac nawet staff z kompletem przydzielalnych sekcji. */
const OWNER_ONLY_ROUTES: RouteSpec[] = [
    { method: 'GET', path: '/api/permissions' },
    { method: 'GET', path: '/api/permissions/members' },
    { method: 'PUT', path: '/api/permissions/users/:userId' },
    { method: 'DELETE', path: '/api/permissions/users/:userId' },
    { method: 'GET', path: '/api/permissions/audit' },
    { method: 'GET', path: '/api/permissions/settings' },
    { method: 'PUT', path: '/api/permissions/settings/support-role' },
    { method: 'GET', path: '/api/economy/settings' },
    { method: 'PATCH', path: '/api/economy/settings' },
    { method: 'POST', path: '/api/economy/reset-users' },
    { method: 'POST', path: '/api/economy/level-roles/audit' },
    { method: 'POST', path: '/api/economy/level-roles/fix-user' },
    { method: 'GET', path: '/api/logs' },
    { method: 'GET', path: '/api/sessions/activity' },
    { method: 'DELETE', path: '/api/tickets/history' },
    { method: 'POST', path: '/api/stats/reset' },
    { method: 'PUT', path: '/api/stats/server/config' },
    { method: 'DELETE', path: '/api/shop/orders/all' },
];

let server: Server;
let baseUrl: string;
let sessionUserId: string | undefined;

function concretePath(path: string): string {
    return path.replace(/:[A-Za-z]+/g, '1');
}

async function call(spec: RouteSpec): Promise<number> {
    const response = await fetch(`${baseUrl}${concretePath(spec.path)}`, {
        method: spec.method,
        headers: { 'Content-Type': 'application/json' },
        body: ['GET', 'HEAD'].includes(spec.method) ? undefined : JSON.stringify({}),
    });
    return response.status;
}

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
        (req as unknown as { session: unknown }).session = {
            user: sessionUserId ? { id: sessionUserId, username: 'tester' } : undefined,
        };
        next();
    });
    app.use('/api', apiRouter);
    app.use('/api/scheduled', scheduledRouter);
    app.use('/api/g2-matches', g2MatchesRouter);
    app.use('/api/shop', shopApiRouter);

    await new Promise<void>((resolve) => {
        server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
    process.env.OWNER_ID = OWNER;
    process.env.GUILD_ID = '999999999999999999';
    store = await createPermissionStore(':memory:');
    await store.setSections(STAFF_ALL, [...ASSIGNABLE_SECTIONS], OWNER);
    sessionUserId = NOBODY;
});

describe('pokrycie tras', () => {
    it('znajduje sensowna liczbe tras (zabezpieczenie przed pustym skanem)', () => {
        expect(ALL_ROUTES.length).toBeGreaterThan(80);
    });
});

describe('uzytkownik bez uprawnien z zywa sesja', () => {
    const guarded = ALL_ROUTES.filter((spec) => !SESSION_ONLY_ROUTES.has(`${spec.method} ${spec.path}`));

    it.each(guarded.map((spec) => [spec.method, spec.path] as const))('%s %s odpowiada 401/403', async (method, path) => {
        const status = await call({ method, path });
        expect([401, 403], `${method} ${path} zwrocil ${status}`).toContain(status);
    });
});

describe('niezalogowany', () => {
    it.each(ALL_ROUTES.map((spec) => [spec.method, spec.path] as const))('%s %s odpowiada 401', async (method, path) => {
        sessionUserId = undefined;
        expect(await call({ method, path })).toBe(401);
    });
});

describe('staff z kompletem przydzielalnych sekcji', () => {
    it.each(OWNER_ONLY_ROUTES.map((spec) => [spec.method, spec.path] as const))('%s %s nadal odpowiada 403', async (method, path) => {
        sessionUserId = STAFF_ALL;
        expect(ALL_ROUTES.some((spec) => spec.method === method && spec.path === path), 'trasa nie istnieje - zaktualizuj liste').toBe(true);
        expect(await call({ method, path })).toBe(403);
    });
});
