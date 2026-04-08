import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { muteCommand } from './mute.js';
import { resetEconomyDatabaseForTests } from '../economy/database.js';
import { getActiveEconomyTimeoutForUser } from '../economy/repository.js';
import { ADMIN_ROLE_ID } from '../utils/role-access.js';

async function withTempEconomyDb(testFn: () => Promise<void>): Promise<void> {
    const directoryPath = await mkdtemp(join(tmpdir(), 'husaria-mute-test-'));
    const dbPath = join(directoryPath, 'economy.sqlite');
    const previousDbPath = process.env.ECONOMY_DB_PATH;

    process.env.ECONOMY_DB_PATH = dbPath;
    await resetEconomyDatabaseForTests();

    try {
        await testFn();
    } finally {
        await resetEconomyDatabaseForTests();
        if (typeof previousDbPath === 'string') {
            process.env.ECONOMY_DB_PATH = previousDbPath;
        } else {
            delete process.env.ECONOMY_DB_PATH;
        }

        await rm(directoryPath, { recursive: true, force: true });
    }
}

afterEach(async () => {
    await resetEconomyDatabaseForTests();
    delete process.env.SERVER_MUTE_ROLE_ID;
});

describe('muteCommand', () => {
    it('odrzuca wywolanie gdy brakuje SERVER_MUTE_ROLE_ID', async () => {
        delete process.env.SERVER_MUTE_ROLE_ID;
        const reply = vi.fn().mockResolvedValue(undefined);

        const interaction = {
            guildId: 'guild-1',
            guild: {
                members: {
                    fetch: vi.fn(),
                },
            },
            user: { id: 'admin-1' },
            member: { roles: [ADMIN_ROLE_ID] },
            options: {
                getUser: () => ({ id: '111111111111111111', bot: false }),
                getInteger: () => 1,
                getString: (name: string) => (name === 'jednostka' ? 'h' : 'test'),
            },
            reply,
        } as any;

        await muteCommand.execute(interaction);

        expect(reply).toHaveBeenCalledTimes(1);
        const payload = reply.mock.calls[0]?.[0];
        expect(payload.content).toContain('SERVER_MUTE_ROLE_ID');
    });

    it('naklada timeout i zapisuje aktywna kare', async () => {
        await withTempEconomyDb(async () => {
            process.env.SERVER_MUTE_ROLE_ID = '999999999999999999';

            const memberRolesCache = new Map<string, { id: string }>();
            const addRole = vi.fn().mockImplementation(async (roleId: string) => {
                memberRolesCache.set(roleId, { id: roleId });
            });

            const deferReply = vi.fn().mockResolvedValue(undefined);
            const editReply = vi.fn().mockResolvedValue(undefined);

            const interaction = {
                guildId: 'guild-1',
                guild: {
                    members: {
                        fetch: vi.fn().mockResolvedValue({
                            roles: {
                                cache: memberRolesCache,
                                add: addRole,
                            },
                        }),
                    },
                },
                user: { id: 'admin-1' },
                member: { roles: [ADMIN_ROLE_ID] },
                options: {
                    getUser: () => ({ id: '111111111111111111', bot: false }),
                    getInteger: () => 1,
                    getString: (name: string) => {
                        if (name === 'jednostka') {
                            return 'h';
                        }

                        return 'Spam na chacie';
                    },
                },
                deferReply,
                editReply,
            } as any;

            await muteCommand.execute(interaction);

            expect(deferReply).toHaveBeenCalledTimes(1);
            expect(addRole).toHaveBeenCalledWith('999999999999999999', expect.any(String));
            expect(editReply).toHaveBeenCalledTimes(1);

            const timeout = await getActiveEconomyTimeoutForUser('guild-1', '111111111111111111');
            expect(timeout).not.toBeNull();
            expect(timeout?.isActive).toBe(true);
            expect(timeout?.reason).toContain('Spam na chacie');
        });
    });

    it('odrzuca timeout dla czlonka staffu', async () => {
        await withTempEconomyDb(async () => {
            process.env.SERVER_MUTE_ROLE_ID = '999999999999999999';
            process.env.ADMIN_ROLE_ID = '910000000000000001';

            const deferReply = vi.fn().mockResolvedValue(undefined);
            const editReply = vi.fn().mockResolvedValue(undefined);

            const interaction = {
                guildId: 'guild-1',
                guild: {
                    members: {
                        fetch: vi.fn().mockResolvedValue({
                            roles: {
                                cache: {
                                    has: (roleId: string) => roleId === '910000000000000001',
                                },
                            },
                        }),
                    },
                },
                user: { id: 'admin-1' },
                member: { roles: [ADMIN_ROLE_ID] },
                options: {
                    getUser: () => ({ id: '111111111111111111', bot: false }),
                    getInteger: () => 1,
                    getString: (name: string) => {
                        if (name === 'jednostka') {
                            return 'h';
                        }

                        return 'Test';
                    },
                },
                deferReply,
                editReply,
            } as any;

            await muteCommand.execute(interaction);

            expect(deferReply).toHaveBeenCalledTimes(1);
            expect(editReply).toHaveBeenCalledTimes(1);
            const payload = editReply.mock.calls[0]?.[0];
            expect(payload.content).toContain('czlonka staffu');

            const timeout = await getActiveEconomyTimeoutForUser('guild-1', '111111111111111111');
            expect(timeout).toBeNull();
        });
    });
});
