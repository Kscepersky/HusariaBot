import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addCoinsByAdmin } from './repository.js';
import { resetEconomyDatabaseForTests } from './database.js';
import { buildLeaderboardCustomId } from './leaderboard-ui.js';
import { handleEconomyLeaderboardButton } from './leaderboard-buttons.js';

async function withTempEconomyDb(testFn: () => Promise<void>): Promise<void> {
    const directoryPath = await mkdtemp(join(tmpdir(), 'husaria-lb-buttons-test-'));
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

describe('handleEconomyLeaderboardButton', () => {
    it('aktualizuje leaderboard po kliknieciu przycisku', async () => {
        await withTempEconomyDb(async () => {
            await addCoinsByAdmin({
                guildId: 'guild-1',
                targetUserId: 'user-1',
                adminUserId: 'admin-1',
                reason: 'Seed',
                amount: 99,
                nowTimestamp: Date.now(),
            });

            const update = vi.fn().mockResolvedValue(undefined);
            const interaction = {
                customId: buildLeaderboardCustomId('coins', 1),
                guildId: 'guild-1',
                update,
            } as any;

            const handled = await handleEconomyLeaderboardButton(interaction);

            expect(handled).toBe(true);
            expect(update).toHaveBeenCalledTimes(1);
        });
    });

    it('ignoruje nieznane customId', async () => {
        const interaction = {
            customId: 'other-prefix:coins:1',
        } as any;

        const handled = await handleEconomyLeaderboardButton(interaction);
        expect(handled).toBe(false);
    });
});
