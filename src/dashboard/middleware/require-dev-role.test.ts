import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../discord-api.js', () => ({
    getGuildMember: vi.fn(),
    resolveDashboardRole: vi.fn(),
}));

import { getGuildMember, resolveDashboardRole } from '../discord-api.js';
import { requireDevRole } from './require-section-access.js';

function runMiddleware(userId: string | undefined): Promise<{ status?: number; nextCalled: boolean }> {
    return new Promise((resolve) => {
        const result: { status?: number; nextCalled: boolean } = { nextCalled: false };
        const req = { session: { user: userId ? { id: userId } : undefined }, originalUrl: '/api/stats/reset', method: 'POST' } as unknown as Request;
        const res = {
            status(code: number) {
                result.status = code;
                return this;
            },
            json() {
                resolve(result);
                return this;
            },
        } as unknown as Response;
        const next: NextFunction = () => {
            result.nextCalled = true;
            resolve(result);
        };

        void requireDevRole()(req, res, next);
    });
}

describe('requireDevRole', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        process.env.GUILD_ID = '123456789012345678';
        vi.mocked(getGuildMember).mockResolvedValue({ roles: [] } as never);
    });

    it('przepuszcza rolę dev', async () => {
        vi.mocked(resolveDashboardRole).mockReturnValue('dev');
        expect(await runMiddleware('u1')).toEqual({ nextCalled: true });
    });

    it.each(['admin', 'g2staff', 'moderator'] as const)('odrzuca rolę %s kodem 403', async (role) => {
        vi.mocked(resolveDashboardRole).mockReturnValue(role);
        expect(await runMiddleware('u1')).toEqual({ status: 403, nextCalled: false });
    });

    it('zwraca 401 bez sesji i 502 przy błędzie Discorda', async () => {
        expect((await runMiddleware(undefined)).status).toBe(401);
        vi.mocked(getGuildMember).mockRejectedValue(new Error('discord down'));
        expect((await runMiddleware('u1')).status).toBe(502);
    });
});
