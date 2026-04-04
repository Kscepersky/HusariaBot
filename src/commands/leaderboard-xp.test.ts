import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { leaderboardXpCommand } from './leaderboard-xp.js';
import { addCoinsByAdmin } from '../economy/repository.js';
import { resetEconomyDatabaseForTests } from '../economy/database.js';

async function withTempEconomyDb(testFn: () => Promise<void>): Promise<void> {
    const directoryPath = await mkdtemp(join(tmpdir(), 'husaria-lb-xp-test-'));
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

describe('leaderboardXpCommand', () => {
    it('wyswietla leaderboard levela', async () => {
        await withTempEconomyDb(async () => {
            await addCoinsByAdmin({
                guildId: 'guild-1',
                targetUserId: 'user-1',
                adminUserId: 'admin-1',
                reason: 'Seed',
                amount: 120,
                nowTimestamp: Date.now(),
            });

            const deferReply = vi.fn().mockResolvedValue(undefined);
            const editReply = vi.fn().mockResolvedValue(undefined);
            const interaction = {
                guildId: 'guild-1',
                deferReply,
                editReply,
            } as any;

            await leaderboardXpCommand.execute(interaction);

            expect(deferReply).toHaveBeenCalledTimes(1);
            expect(editReply).toHaveBeenCalledTimes(1);
            const payload = editReply.mock.calls[0]?.[0];
            const embed = payload.embeds[0].toJSON();
            expect(embed.title).toContain('Topka Levela');
        });
    });
});
