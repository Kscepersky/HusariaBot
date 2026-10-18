import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
    process.env.DASHBOARD_ENABLE_RATE_LIMIT_TESTS = '1';
    process.env.DASHBOARD_RATE_LIMIT_WINDOW_MS = '10000';
    process.env.DASHBOARD_RATE_LIMIT_MAX = '3';
    process.env.DASHBOARD_MUTATION_RATE_LIMIT_WINDOW_MS = '10000';
    process.env.DASHBOARD_MUTATION_RATE_LIMIT_MAX = '2';
    process.env.DASHBOARD_USER_RATE_LIMIT_MAX = '10';
    process.env.DASHBOARD_USER_MUTATION_RATE_LIMIT_MAX = '5';
    delete process.env.DASHBOARD_DISABLE_RATE_LIMIT;

    vi.resetModules();
    const { globalRateLimiter, mutationRateLimiter } = await import('./rate-limit.js');

    const app = express();
    app.use(express.json());
    // Symulacja sesji: naglowek x-test-user udaje zalogowanego uzytkownika dashboardu.
    app.use((req, _res, next) => {
        const userId = req.get('x-test-user');
        (req as unknown as { session: { user?: { id: string } } }).session = userId ? { user: { id: userId } } : {};
        next();
    });
    app.use(globalRateLimiter);
    app.use('/api', mutationRateLimiter);

    app.get('/api/read', (_req, res) => {
        res.json({ success: true });
    });

    app.post('/api/mutate', (_req, res) => {
        res.json({ success: true });
    });

    const server = await new Promise<Server>((resolve) => {
        const started = app.listen(0, () => resolve(started));
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });
        throw new Error('Nie udało się uruchomić serwera testowego.');
    }

    const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;

    try {
        await run(baseUrl);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });
    }
}

afterEach(() => {
    delete process.env.DASHBOARD_ENABLE_RATE_LIMIT_TESTS;
    delete process.env.DASHBOARD_RATE_LIMIT_WINDOW_MS;
    delete process.env.DASHBOARD_RATE_LIMIT_MAX;
    delete process.env.DASHBOARD_MUTATION_RATE_LIMIT_WINDOW_MS;
    delete process.env.DASHBOARD_MUTATION_RATE_LIMIT_MAX;
    delete process.env.DASHBOARD_USER_RATE_LIMIT_MAX;
    delete process.env.DASHBOARD_USER_MUTATION_RATE_LIMIT_MAX;
});

describe('rate limit middleware', () => {
    it('nakłada limit na mutujące requesty API', async () => {
        await withServer(async (baseUrl) => {
            const first = await fetch(`${baseUrl}/api/mutate`, { method: 'POST' });
            const second = await fetch(`${baseUrl}/api/mutate`, { method: 'POST' });
            const third = await fetch(`${baseUrl}/api/mutate`, { method: 'POST' });

            expect(first.status).toBe(200);
            expect(second.status).toBe(200);
            expect(third.status).toBe(429);
        });
    });

    it('nie traktuje GET jako mutacji', async () => {
        await withServer(async (baseUrl) => {
            const first = await fetch(`${baseUrl}/api/read`);
            const second = await fetch(`${baseUrl}/api/read`);

            expect(first.status).toBe(200);
            expect(second.status).toBe(200);
        });
    });

    it('nakłada globalny limit zapytań', async () => {
        await withServer(async (baseUrl) => {
            const first = await fetch(`${baseUrl}/api/read`);
            const second = await fetch(`${baseUrl}/api/read`);
            const third = await fetch(`${baseUrl}/api/read`);
            const fourth = await fetch(`${baseUrl}/api/read`);

            expect(first.status).toBe(200);
            expect(second.status).toBe(200);
            expect(third.status).toBe(200);
            expect(fourth.status).toBe(429);
        });
    });

    it('zalogowany uzytkownik ma wyzszy, osobny limit niz anonim', async () => {
        await withServer(async (baseUrl) => {
            const headers = { 'x-test-user': '111111111111111111' };
            const statuses: number[] = [];
            for (let i = 0; i < 10; i += 1) {
                statuses.push((await fetch(`${baseUrl}/api/read`, { headers })).status);
            }
            const eleventh = await fetch(`${baseUrl}/api/read`, { headers });
            const anonymous = await fetch(`${baseUrl}/api/read`);

            expect(statuses.every((status) => status === 200)).toBe(true);
            expect(eleventh.status).toBe(429);
            // Zuzycie limitu przez uzytkownika nie wplywa na anonimowy bucket tego samego IP.
            expect(anonymous.status).toBe(200);
        });
    });

    it('anonimowe requesty z tego samego IP nie zuzywaja limitu zalogowanego', async () => {
        await withServer(async (baseUrl) => {
            for (let i = 0; i < 5; i += 1) {
                await fetch(`${baseUrl}/api/read`);
            }

            const loggedIn = await fetch(`${baseUrl}/api/read`, { headers: { 'x-test-user': '222222222222222222' } });
            expect(loggedIn.status).toBe(200);
        });
    });

    it('zalogowany uzytkownik ma wyzszy limit mutacji, ale nadal ograniczony', async () => {
        await withServer(async (baseUrl) => {
            const headers = { 'x-test-user': '333333333333333333' };
            const statuses: number[] = [];
            for (let i = 0; i < 6; i += 1) {
                statuses.push((await fetch(`${baseUrl}/api/mutate`, { method: 'POST', headers })).status);
            }

            expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
        });
    });
});
