import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { usunCoinsyCommand } from './usun-coinsy.js';
import { dodajCoinsyCommand } from './dodaj-coinsy.js';
import { resetEconomyDatabaseForTests } from '../economy/database.js';
import { ADMIN_ROLE_ID } from '../utils/role-access.js';

async function withTempEconomyDb(testFn: () => Promise<void>): Promise<void> {
    const directoryPath = await mkdtemp(join(tmpdir(), 'husaria-usun-coinsy-test-'));
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

function createInteraction(amount: number) {
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);

    const interaction = {
        guildId: 'guild-1',
        user: { id: 'admin-1' },
        member: { roles: [ADMIN_ROLE_ID] },
        options: {
            getUser: () => ({ id: 'user-1' }),
            getInteger: () => amount,
            getString: () => 'Korekta',
        },
        deferReply,
        editReply,
    } as any;

    return { interaction, deferReply, editReply };
}

describe('usunCoinsyCommand', () => {
    it('odejmuje coinsy wskazanemu uzytkownikowi', async () => {
        await withTempEconomyDb(async () => {
            const add = createInteraction(250);
            await dodajCoinsyCommand.execute(add.interaction);

            const remove = createInteraction(100);
            await usunCoinsyCommand.execute(remove.interaction);

            expect(remove.deferReply).toHaveBeenCalledTimes(1);
            expect(remove.editReply).toHaveBeenCalledTimes(1);

            const payload = remove.editReply.mock.calls[0]?.[0];
            const embed = payload.embeds[0].toJSON();
            expect(embed.title).toContain('Usunieto coinsy');
        });
    });
});
