import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import session from 'express-session';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureCsrfTokenForSession, requireCsrfToken } from './csrf.js';

function extractSessionCookie(response: globalThis.Response): string {
    const setCookie = response.headers.get('set-cookie') ?? '';
    return setCookie.split(';')[0] ?? '';
}

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use(session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: false,
    }));

    app.use((req, _res, next) => {
        req.session.user = {
            id: 'user-1',
            username: 'Tester',
            globalName: 'Tester',
            avatar: null,
        };
        next();
    });

    app.use(ensureCsrfTokenForSession);
    app.use(requireCsrfToken);

    app.get('/api/csrf-token', (req, res) => {
        res.json({ csrfToken: req.session.csrfToken });
    });

    app.post('/api/mutate', (_req, res) => {
        res.json({ success: true });
    });

    app.post('/auth/logout', (_req, res) => {
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
    delete process.env.DASHBOARD_DISABLE_RATE_LIMIT;
});

describe('csrf middleware', () => {
    it('generuje token CSRF dla sesji', async () => {
        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/csrf-token`);
            const body = await response.json() as { csrfToken?: string };

            expect(response.status).toBe(200);
            expect(typeof body.csrfToken).toBe('string');
            expect(body.csrfToken?.length).toBeGreaterThan(10);
        });
    });

    it('odrzuca mutację bez tokenu CSRF', async () => {
        await withServer(async (baseUrl) => {
            const tokenResponse = await fetch(`${baseUrl}/api/csrf-token`);
            const sessionCookie = extractSessionCookie(tokenResponse);

            const response = await fetch(`${baseUrl}/api/mutate`, {
                method: 'POST',
                headers: {
                    Cookie: sessionCookie,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ value: 'test' }),
            });

            expect(response.status).toBe(403);
        });
    });

    it('odrzuca mutację z nieprawidłowym tokenem CSRF', async () => {
        await withServer(async (baseUrl) => {
            const tokenResponse = await fetch(`${baseUrl}/api/csrf-token`);
            const sessionCookie = extractSessionCookie(tokenResponse);

            const response = await fetch(`${baseUrl}/api/mutate`, {
                method: 'POST',
                headers: {
                    Cookie: sessionCookie,
                    'Content-Type': 'application/json',
                    'x-csrf-token': 'invalid-token',
                },
                body: JSON.stringify({ value: 'test' }),
            });

            expect(response.status).toBe(403);
        });
    });

    it('odrzuca mutację pod /API bez tokenu CSRF', async () => {
        await withServer(async (baseUrl) => {
            const tokenResponse = await fetch(`${baseUrl}/api/csrf-token`);
            const sessionCookie = extractSessionCookie(tokenResponse);

            const response = await fetch(`${baseUrl}/API/mutate`, {
                method: 'POST',
                headers: {
                    Cookie: sessionCookie,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ value: 'test' }),
            });

            expect(response.status).toBe(403);
        });
    });

    it('akceptuje mutację z poprawnym tokenem CSRF', async () => {
        await withServer(async (baseUrl) => {
            const tokenResponse = await fetch(`${baseUrl}/api/csrf-token`);
            const sessionCookie = extractSessionCookie(tokenResponse);
            const tokenPayload = await tokenResponse.json() as { csrfToken: string };

            const response = await fetch(`${baseUrl}/api/mutate`, {
                method: 'POST',
                headers: {
                    Cookie: sessionCookie,
                    'Content-Type': 'application/json',
                    'x-csrf-token': tokenPayload.csrfToken,
                },
                body: JSON.stringify({ value: 'test' }),
            });

            expect(response.status).toBe(200);
        });
    });

    it('wymaga tokenu CSRF dla POST /auth/logout/ (trailing slash)', async () => {
        await withServer(async (baseUrl) => {
            const tokenResponse = await fetch(`${baseUrl}/api/csrf-token`);
            const sessionCookie = extractSessionCookie(tokenResponse);

            const response = await fetch(`${baseUrl}/auth/logout/`, {
                method: 'POST',
                headers: {
                    Cookie: sessionCookie,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            });

            expect(response.status).toBe(403);
        });
    });
});