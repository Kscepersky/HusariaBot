import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dailyCommand } from './daily.js';
import { resetEconomyDatabaseForTests } from '../economy/database.js';

async function withTempEconomyDb(testFn: () => Promise<void>): Promise<void> {
    const directoryPath = await mkdtemp(join(tmpdir(), 'husaria-daily-command-test-'));
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

describe('dailyCommand', () => {
    it('odrzuca wywolanie poza serwerem', async () => {
        await withTempEconomyDb(async () => {
            const reply = vi.fn().mockResolvedValue(undefined);
            const deferReply = vi.fn().mockResolvedValue(undefined);
            const editReply = vi.fn().mockResolvedValue(undefined);

            const interaction = {
                guildId: null,
                user: { id: 'user-1' },
                reply,
                deferReply,
                editReply,
            } as any;

            await dailyCommand.execute(interaction);

            expect(reply).toHaveBeenCalledTimes(1);
            expect(deferReply).not.toHaveBeenCalled();
            expect(editReply).not.toHaveBeenCalled();

            const payload = reply.mock.calls[0]?.[0];
            expect(payload.content).toContain('Nie mozna ustalic serwera');
            expect(payload.flags).toBe(64);
        });
    });

    it('wysyla embed z nagroda daily', async () => {
        await withTempEconomyDb(async () => {
            const deferReply = vi.fn().mockResolvedValue(undefined);
            const editReply = vi.fn().mockResolvedValue(undefined);
            const interaction = {
                guildId: 'guild-1',
                user: { id: 'user-1' },
                deferReply,
                editReply,
            } as any;

            await dailyCommand.execute(interaction);

            expect(deferReply).toHaveBeenCalledTimes(1);
            expect(deferReply.mock.calls[0]?.[0]).toBeUndefined();
            expect(editReply).toHaveBeenCalledTimes(1);
            const payload = editReply.mock.calls[0]?.[0];
            expect(payload.embeds).toHaveLength(1);

            const embed = payload.embeds[0].toJSON();
            expect(embed.title).toContain('Daily odebrane');
            const fieldNames = (embed.fields ?? []).map((field: { name: string }) => field.name);
            expect(fieldNames).toContain('Przyznano');
            expect(fieldNames).toContain('Streak');
            expect(fieldNames).not.toContain('Wylosowano');
            expect(fieldNames).not.toContain('Aktualne coinsy');
            expect(fieldNames).not.toContain('Kolejny /daily');
        });
    });

    it('zwraca cooldown przy drugim szybkim wywolaniu', async () => {
        await withTempEconomyDb(async () => {
            const deferReply = vi.fn().mockResolvedValue(undefined);
            const editReply = vi.fn().mockResolvedValue(undefined);
            const interaction = {
                guildId: 'guild-1',
                user: { id: 'user-1' },
                deferReply,
                editReply,
            } as any;

            await dailyCommand.execute(interaction);
            await dailyCommand.execute(interaction);

            expect(deferReply).toHaveBeenCalledTimes(2);
            expect(deferReply.mock.calls[0]?.[0]).toBeUndefined();
            expect(deferReply.mock.calls[1]?.[0]).toBeUndefined();
            expect(editReply).toHaveBeenCalledTimes(2);
            const secondPayload = editReply.mock.calls[1]?.[0];
            const embed = secondPayload.embeds[0].toJSON();
            expect(embed.title).toContain('cooldown');
        });
    });
});
