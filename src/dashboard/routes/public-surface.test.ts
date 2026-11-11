import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Router } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Powierzchnia dostepna BEZ logowania. Test uderza w prawdziwa aplikacje
 * (`createDashboardApp`), wiec nowy publiczny plik albo trasa, o ktorej
 * nikt nie pomyslal, wywali go zamiast po cichu trafic na produkcje.
 */

const IMG_DIR = join(process.cwd(), 'img');
const PUBLIC_IMAGE = 'DNA.png';

let server: Server;
let port: number;
let tempDir: string;
let authRouter: Router;
let pagesRouter: Router;

interface RouterLayer {
    route?: { path: string; methods: Record<string, boolean> };
    handle?: { stack?: RouterLayer[] };
}

function listRoutes(router: Router, mount: string): string[] {
    const routes: string[] = [];
    for (const layer of (router as unknown as { stack: RouterLayer[] }).stack) {
        if (!layer.route) continue;
        for (const method of Object.keys(layer.route.methods)) {
            routes.push(`${method.toUpperCase()} ${mount}${layer.route.path}`.replace(/\/$/, '') || '/');
        }
    }
    return routes.sort();
}

/** Surowe zadanie HTTP - `fetch` normalizuje `..` i `%2e` w sciezce, a tu chcemy wyslac ja dokladnie tak, jak jest. */
function rawGet(path: string): Promise<{ status: number; location: string | undefined; contentType: string | undefined }> {
    return new Promise((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
            res.resume();
            res.on('end', () => resolve({
                status: res.statusCode ?? 0,
                location: res.headers.location,
                contentType: res.headers['content-type'],
            }));
        });
        req.on('error', reject);
        req.end();
    });
}

beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'public-surface-'));
    Object.assign(process.env, {
        DISCORD_TOKEN: 'test-token',
        CLIENT_ID: '123456789012345678',
        DISCORD_CLIENT_SECRET: 'test-secret',
        DISCORD_REDIRECT_URI: 'http://localhost/auth/discord/callback',
        GUILD_ID: '999999999999999999',
        OWNER_ID: '111111111111111111',
        DASHBOARD_SESSION_SECRET: 'x'.repeat(40),
        PANDASCORE_API_KEY: 'test-key',
        DASHBOARD_SESSION_DB_PATH: join(tempDir, 'sessions.sqlite'),
    });

    // Dynamiczne importy: auth.ts odczytuje GUILD_ID w momencie zaladowania modulu.
    const { createDashboardApp } = await import('../server.js');
    ({ authRouter } = await import('./auth.js'));
    ({ pagesRouter } = await import('./pages.js'));

    const app = createDashboardApp();
    await new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => resolve());
    });
    port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('trasy poza /api - lista jest zamknieta', () => {
    it('authRouter i pagesRouter maja dokladnie te trasy (nowa trasa wymaga swiadomej decyzji i aktualizacji listy)', () => {
        expect([...listRoutes(authRouter, '/auth'), ...listRoutes(pagesRouter, '/')].sort()).toEqual([
            'GET /',
            'GET /auth/discord',
            'GET /auth/discord/callback',
            'GET /auth/error',
            'GET /auth/login',
            'POST /auth/killswitch',
            'POST /auth/logout',
        ].sort());
    });
});

describe('dostepne bez logowania (swiadomie)', () => {
    it('logo ze strony logowania', async () => {
        const result = await rawGet(`/img/${PUBLIC_IMAGE}`);
        expect(result.status).toBe(200);
        expect(result.contentType).toContain('image/png');
    });

    it.each(['/public/css/style.css', '/public/js/tasks.js', '/auth/login'])('%s', async (path) => {
        expect((await rawGet(path)).status).toBe(200);
    });

    it('strona bledu logowania zwraca 403 ze stalym komunikatem', async () => {
        expect((await rawGet('/auth/error?msg=no_access')).status).toBe(403);
    });

    it('start OAuth przekierowuje do Discorda, a callback bez poprawnego state odsyla do bledu', async () => {
        const start = await rawGet('/auth/discord');
        expect(start.status).toBe(302);
        expect(start.location).toMatch(/^https:\/\/discord\.com\/oauth2\/authorize\?/);

        const callback = await rawGet('/auth/discord/callback?code=x&state=zly');
        expect(callback.status).toBe(302);
        expect(callback.location).toBe('/auth/error?msg=invalid_state');
    });
});

describe('wymagaja logowania', () => {
    it('strona dashboardu przekierowuje do logowania', async () => {
        const result = await rawGet('/');
        expect(result.status).toBe(302);
        expect(result.location).toBe('/auth/login');
    });

    it.each(['/api/me', '/api/me/access', '/api/csrf-token', '/api/tasks', '/api/tasks/meta', '/api/images', '/api/permissions', '/api/logs'])('%s daje 401', async (path) => {
        expect((await rawGet(path)).status).toBe(401);
    });

    it('kazdy plik biblioteki grafik poza logo daje 401', async () => {
        const files = readdirSync(IMG_DIR).filter((name) => name !== PUBLIC_IMAGE);
        expect(files.length).toBeGreaterThan(5);

        const results = await Promise.all(files.map(async (name) => [name, (await rawGet(`/img/${encodeURIComponent(name)}`)).status] as const));
        expect(results.filter(([, status]) => status !== 401)).toEqual([]);
    });

    it.each([
        '/img/dna.png',
        '/img/DNA.png/',
        '/img/./DNA.png',
        '/img/%2e%2e/package.json',
        '/img/..%2fpackage.json',
        '/img/DNA.png%00.png',
        '/img/%E0%A4%A',
    ])('dziwny wariant sciezki %s nie omija logowania', async (path) => {
        const result = await rawGet(path);
        expect(result.status, `${path} zwrocil ${result.status}`).not.toBe(200);
    });
});

describe('nic poza /public i /img nie jest serwowane statycznie', () => {
    it.each([
        '/views/dashboard.html',
        '/public/../views/dashboard.html',
        '/data/tasks.sqlite',
        '/data/permissions.sqlite',
        '/data/dashboard-sessions.sqlite',
        '/data/task-attachments/',
        '/logs/system.jsonl',
        '/.env',
        '/.git/config',
        '/package.json',
        '/src/index.ts',
        '/api/tasks/attachments/0b5e1a8e-2f6c-4f43-9c0f-111111111111',
    ])('%s nie zwraca 200', async (path) => {
        const result = await rawGet(path);
        expect(result.status, `${path} zwrocil ${result.status}`).not.toBe(200);
    });
});
