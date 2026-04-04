import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { levelCommand } from './level.js';
import { awardMessageXp } from '../economy/repository.js';
import { resetEconomyDatabaseForTests } from '../economy/database.js';

async function withTempEconomyDb(testFn: () => Promise<void>): Promise<void> {
    const directoryPath = await mkdtemp(join(tmpdir(), 'husaria-level-command-test-'));
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

describe('levelCommand', () => {
    it('wyswietla publiczny embed z levelem, xp i postepem', async () => {
        await withTempEconomyDb(async () => {
            const now = Date.now();
            for (let index = 0; index < 120; index += 1) {
                await awardMessageXp('guild-1', 'user-1', now + index);
            }

            const deferReply = vi.fn().mockResolvedValue(undefined);
            const editReply = vi.fn().mockResolvedValue(undefined);
            const interaction = {
                guildId: 'guild-1',
                user: { id: 'user-1' },
                deferReply,
                editReply,
            } as any;

            await levelCommand.execute(interaction);

            expect(deferReply).toHaveBeenCalledTimes(1);
            expect(deferReply.mock.calls[0]?.[0]).toBeUndefined();
            expect(editReply).toHaveBeenCalledTimes(1);

            const payload = editReply.mock.calls[0]?.[0];
            const embed = payload.embeds[0].toJSON();
            expect(embed.title).toContain('Twoj level');
            expect((embed.fields ?? []).some((field: { name: string }) => field.name === 'Postep')).toBe(true);
        });
    });
});
