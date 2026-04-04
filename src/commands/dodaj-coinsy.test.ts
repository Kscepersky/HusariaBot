import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dodajCoinsyCommand } from './dodaj-coinsy.js';
import { resetEconomyDatabaseForTests } from '../economy/database.js';
import { ADMIN_ROLE_ID } from '../utils/role-access.js';

async function withTempEconomyDb(testFn: () => Promise<void>): Promise<void> {
    const directoryPath = await mkdtemp(join(tmpdir(), 'husaria-dodaj-coinsy-test-'));
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
});

describe('dodajCoinsyCommand', () => {
    it('dodaje coinsy wskazanemu uzytkownikowi', async () => {
        await withTempEconomyDb(async () => {
            const deferReply = vi.fn().mockResolvedValue(undefined);
            const editReply = vi.fn().mockResolvedValue(undefined);

            const interaction = {
                guildId: 'guild-1',
                user: { id: 'admin-1' },
                member: { roles: [ADMIN_ROLE_ID] },
                options: {
                    getUser: () => ({ id: 'user-1' }),
                    getInteger: () => 200,
                    getString: () => 'Konkurs',
                },
                deferReply,
                editReply,
            } as any;

            await dodajCoinsyCommand.execute(interaction);

            expect(deferReply).toHaveBeenCalledTimes(1);
            expect(editReply).toHaveBeenCalledTimes(1);

            const payload = editReply.mock.calls[0]?.[0];
            const embed = payload.embeds[0].toJSON();
            expect(embed.title).toContain('Dodano coinsy');
        });
    });
});
