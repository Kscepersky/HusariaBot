import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPermissionStore, type PermissionStore } from '../../permissions/permission-store.js';

vi.mock('../discord-api.js', () => ({
    getGuildMember: vi.fn(),
}));

let store: PermissionStore;
vi.mock('../../permissions/permission-store.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../permissions/permission-store.js')>()),
    getPermissionStore: vi.fn(async () => store),
}));

import { getGuildMember } from '../discord-api.js';
import { requireOwner, requireSectionAccess } from './require-section-access.js';

const OWNER = '111111111111111111';
const STAFF = '222222222222222222';
const STRANGER = '333333333333333333';

interface Outcome {
    status?: number;
    nextCalled: boolean;
}

function run(handler: ReturnType<typeof requireOwner>, userId: string | undefined): Promise<Outcome> {
    return new Promise((resolve) => {
        const outcome: Outcome = { nextCalled: false };
        const req = {
            session: { user: userId ? { id: userId } : undefined },
            originalUrl: '/api/test',
            method: 'POST',
        } as unknown as Request;
        const res = {
            status(code: number) {
                outcome.status = code;
                return this;
            },
            json() {
                resolve(outcome);
                return this;
            },
        } as unknown as Response;
        const next: NextFunction = () => {
            outcome.nextCalled = true;
            resolve(outcome);
        };

        void handler(req, res, next);
    });
}

describe('dashboard authorization middleware', () => {
    beforeEach(async () => {
        vi.resetAllMocks();
        process.env.OWNER_ID = OWNER;
        process.env.GUILD_ID = '999999999999999999';
        store = await createPermissionStore(':memory:');
        await store.setSections(STAFF, ['embed-creator', 'shop'], OWNER);
        vi.mocked(getGuildMember).mockResolvedValue({ roles: [] } as never);
    });

    afterEach(async () => {
        await store.close();
    });

    describe('requireSectionAccess', () => {
        it('przepuszcza staff z nadana sekcja', async () => {
            expect(await run(requireSectionAccess('shop'), STAFF)).toEqual({ nextCalled: true });
        });

        it('odrzuca staff bez tej sekcji kodem 403', async () => {
            expect(await run(requireSectionAccess('events'), STAFF)).toEqual({ status: 403, nextCalled: false });
        });

        it('odrzuca uzytkownika bez wpisu w bazie', async () => {
            expect(await run(requireSectionAccess('shop'), STRANGER)).toEqual({ status: 403, nextCalled: false });
        });

        it('owner ma kazda sekcje, takze owner-only, bez sprawdzania Discorda', async () => {
            expect(await run(requireSectionAccess('permissions'), OWNER)).toEqual({ nextCalled: true });
            expect(await run(requireSectionAccess('system-logs'), OWNER)).toEqual({ nextCalled: true });
            expect(getGuildMember).not.toHaveBeenCalled();
        });

        it('staff nie wejdzie do sekcji owner-only', async () => {
            expect(await run(requireSectionAccess('permissions'), STAFF)).toEqual({ status: 403, nextCalled: false });
            expect(await run(requireSectionAccess('economy-settings'), STAFF)).toEqual({ status: 403, nextCalled: false });
        });

        it('odrzuca staff, ktory nie jest juz czlonkiem guildii', async () => {
            vi.mocked(getGuildMember).mockResolvedValue(null);
            expect(await run(requireSectionAccess('shop'), STAFF)).toEqual({ status: 403, nextCalled: false });
        });

        it('odebranie uprawnien w bazie dziala od razu', async () => {
            expect((await run(requireSectionAccess('shop'), STAFF)).nextCalled).toBe(true);
            await store.setSections(STAFF, [], OWNER);
            expect(await run(requireSectionAccess('shop'), STAFF)).toEqual({ status: 403, nextCalled: false });
        });

        it('zwraca 401 bez sesji', async () => {
            expect((await run(requireSectionAccess('shop'), undefined)).status).toBe(401);
        });

        it('zwraca 502 (fail closed) gdy Discord nie odpowiada', async () => {
            vi.mocked(getGuildMember).mockRejectedValue(new Error('discord down'));
            expect(await run(requireSectionAccess('shop'), STAFF)).toEqual({ status: 502, nextCalled: false });
        });

        it('odrzuca wszystkich, gdy OWNER_ID jest zle skonfigurowany, ale nie nadaje dostepu "z zalozenia"', async () => {
            delete process.env.OWNER_ID;
            expect(await run(requireSectionAccess('permissions'), OWNER)).toEqual({ status: 403, nextCalled: false });
        });
    });

    describe('requireOwner', () => {
        it('przepuszcza ownera', async () => {
            expect(await run(requireOwner(), OWNER)).toEqual({ nextCalled: true });
        });

        it.each([STAFF, STRANGER])('odrzuca %s kodem 403', async (userId) => {
            expect(await run(requireOwner(), userId)).toEqual({ status: 403, nextCalled: false });
        });

        it('zwraca 401 bez sesji', async () => {
            expect((await run(requireOwner(), undefined)).status).toBe(401);
        });
    });
});
