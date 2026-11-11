import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const resolveCurrentAccess = vi.fn();
vi.mock('./require-section-access.js', () => ({
    resolveCurrentAccess: (...args: unknown[]) => resolveCurrentAccess(...args),
}));

import { PUBLIC_IMAGE_PATHS, requireImageAccess } from './protect-images.js';

function run(path: string, userId?: string) {
    const headers: Record<string, string> = {};
    const res = {
        statusCode: 200,
        body: undefined as unknown,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(payload: unknown) {
            this.body = payload;
            return this;
        },
        setHeader(name: string, value: string) {
            headers[name] = value;
        },
    };
    const next = vi.fn();
    const req = { path, session: { user: userId ? { id: userId } : undefined } } as unknown as Request;
    return requireImageAccess(req, res as unknown as Response, next).then(() => ({ res, next, headers }));
}

beforeEach(() => {
    resolveCurrentAccess.mockReset();
});

describe('requireImageAccess', () => {
    it('tylko logo ze strony logowania jest publiczne', () => {
        expect([...PUBLIC_IMAGE_PATHS]).toEqual(['/DNA.png']);
    });

    it('przepuszcza logo bez sesji i bez sprawdzania uprawnien', async () => {
        const { next, res, headers } = await run('/DNA.png');

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBe(200);
        expect(resolveCurrentAccess).not.toHaveBeenCalled();
        expect(headers['Cache-Control']).toBeUndefined();
    });

    it.each(['/hussars_logo_80x80.png', '/01a93cfb-ce6f-4910-9ac6-4a6f790e5ac3.png', '/dna.png', '/DNA.png/', '/./DNA.png', '/../package.json', '/%2e%2e/x', '/DNA.png%00', '/%E0%A4%A'])('%s bez sesji daje 401', async (path) => {
        const { next, res } = await run(path);

        expect(res.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
        expect(resolveCurrentAccess).not.toHaveBeenCalled();
    });

    it('zalogowany bez dostepu do panelu dostaje 403', async () => {
        resolveCurrentAccess.mockResolvedValue({ role: null, sections: [] });
        const { next, res } = await run('/hussars_logo_80x80.png', '222222222222222222');

        expect(res.statusCode).toBe(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('uzytkownik z dostepem dostaje plik z prywatnym cache', async () => {
        resolveCurrentAccess.mockResolvedValue({ role: 'staff', sections: ['tasks'] });
        const { next, res, headers } = await run('/hussars_logo_80x80.png', '222222222222222222');

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBe(200);
        expect(headers['Cache-Control']).toBe('private, max-age=300');
        expect(headers['Vary']).toBe('Cookie');
    });

    it('blad weryfikacji uprawnien = odmowa (fail closed)', async () => {
        resolveCurrentAccess.mockRejectedValue(new Error('Discord pada'));
        const { next, res } = await run('/hussars_logo_80x80.png', '222222222222222222');

        expect(res.statusCode).toBe(502);
        expect(next).not.toHaveBeenCalled();
    });
});
