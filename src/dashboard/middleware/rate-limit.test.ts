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
    delete process.env.DASHBOARD_DISABLE_RATE_LIMIT;

    vi.resetModules();
    const { globalRateLimiter, mutationRateLimiter } = await import('./rate-limit.js');

    const app = express();
    app.use(express.json());
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
});