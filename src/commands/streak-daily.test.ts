import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { streakDailyCommand } from './streak-daily.js';
import { dailyCommand } from './daily.js';
import { resetEconomyDatabaseForTests } from '../economy/database.js';

async function withTempEconomyDb(testFn: () => Promise<void>): Promise<void> {
    const directoryPath = await mkdtemp(join(tmpdir(), 'husaria-streak-command-test-'));
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

describe('streakDailyCommand', () => {
    it('pokazuje aktualny streak i mnoznik', async () => {
        await withTempEconomyDb(async () => {
            const dailyDeferReply = vi.fn().mockResolvedValue(undefined);
            const dailyEditReply = vi.fn().mockResolvedValue(undefined);
            const streakDeferReply = vi.fn().mockResolvedValue(undefined);
            const streakEditReply = vi.fn().mockResolvedValue(undefined);

            const interactionBase = {
                guildId: 'guild-1',
                user: { id: 'user-1' },
            };

            await dailyCommand.execute({
                ...interactionBase,
                deferReply: dailyDeferReply,
                editReply: dailyEditReply,
            } as any);

            await streakDailyCommand.execute({
                ...interactionBase,
                deferReply: streakDeferReply,
                editReply: streakEditReply,
            } as any);

            expect(streakDeferReply).toHaveBeenCalledTimes(1);
            expect(streakDeferReply.mock.calls[0]?.[0]?.flags).toBe(64);
            expect(streakEditReply).toHaveBeenCalledTimes(1);

            const payload = streakEditReply.mock.calls[0]?.[0];
            const embed = payload.embeds[0].toJSON();
            expect(embed.title).toContain('streak /daily');

            const fields = embed.fields ?? [];
            const streakField = fields.find((field: { name: string }) => field.name === 'Obecny streak');
            expect(streakField?.value).toBe('1');
        });
    });
});
