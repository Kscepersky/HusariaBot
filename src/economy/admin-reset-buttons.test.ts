import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ADMIN_ROLE_ID } from '../utils/role-access.js';
import { addCoinsByAdmin, getEconomyUserState } from './repository.js';
import { resetEconomyDatabaseForTests } from './database.js';
import { buildEconomyResetCustomId, handleEconomyResetButton } from './admin-reset-buttons.js';
import { logEconomyAdminMutation } from './admin-log.js';

vi.mock('./admin-log.js', () => ({
    logEconomyAdminMutation: vi.fn().mockResolvedValue(undefined),
}));

const mockedLogEconomyAdminMutation = vi.mocked(logEconomyAdminMutation);

const GUILD_ID = '123456789012345678';
const USER_ID = '223456789012345678';

async function withTempEconomyDb(testFn: () => Promise<void>): Promise<void> {
    const directoryPath = await mkdtemp(join(tmpdir(), 'husaria-reset-buttons-test-'));
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
    mockedLogEconomyAdminMutation.mockReset();
    mockedLogEconomyAdminMutation.mockResolvedValue(undefined);
    await resetEconomyDatabaseForTests();
});

describe('handleEconomyResetButton', () => {
    it('resetuje coinsy po potwierdzeniu', async () => {
        await withTempEconomyDb(async () => {
            await addCoinsByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Setup',
                amount: 500,
                nowTimestamp: Date.now(),
            });

            const interaction = {
                customId: buildEconomyResetCustomId('coins', 'confirm', USER_ID),
                guildId: GUILD_ID,
                user: { id: 'admin-1' },
                member: { roles: [ADMIN_ROLE_ID] },
                deferUpdate: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                update: vi.fn().mockResolvedValue(undefined),
                replied: false,
                deferred: false,
                reply: vi.fn().mockResolvedValue(undefined),
                followUp: vi.fn().mockResolvedValue(undefined),
            } as any;

            const handled = await handleEconomyResetButton(interaction);

            expect(handled).toBe(true);
            expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
            expect(interaction.editReply).toHaveBeenCalledTimes(1);

            const state = await getEconomyUserState(GUILD_ID, USER_ID, Date.now());
            expect(state.coins).toBe(0);
        });
    });

    it('anuluje reset i nie wykonuje mutacji', async () => {
        await withTempEconomyDb(async () => {
            await addCoinsByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Setup',
                amount: 100,
                nowTimestamp: Date.now(),
            });

            const interaction = {
                customId: buildEconomyResetCustomId('coins', 'cancel', USER_ID),
                guildId: GUILD_ID,
                user: { id: 'admin-1' },
                member: { roles: [ADMIN_ROLE_ID] },
                update: vi.fn().mockResolvedValue(undefined),
                replied: false,
                deferred: false,
                reply: vi.fn().mockResolvedValue(undefined),
                followUp: vi.fn().mockResolvedValue(undefined),
            } as any;

            const handled = await handleEconomyResetButton(interaction);

            expect(handled).toBe(true);
            expect(interaction.update).toHaveBeenCalledTimes(1);

            const state = await getEconomyUserState(GUILD_ID, USER_ID, Date.now());
            expect(state.coins).toBe(100);
        });
    });

    it('odrzuca brak uprawnien', async () => {
        await withTempEconomyDb(async () => {
            const interaction = {
                customId: buildEconomyResetCustomId('coins', 'confirm', USER_ID),
                guildId: GUILD_ID,
                user: { id: 'random-user' },
                member: { roles: [] },
                replied: false,
                deferred: false,
                reply: vi.fn().mockResolvedValue(undefined),
                followUp: vi.fn().mockResolvedValue(undefined),
            } as any;

            const handled = await handleEconomyResetButton(interaction);

            expect(handled).toBe(true);
            expect(interaction.reply).toHaveBeenCalledTimes(1);
        });
    });

    it('zwraca blad gdy brak guildId', async () => {
        await withTempEconomyDb(async () => {
            const interaction = {
                customId: buildEconomyResetCustomId('coins', 'confirm', USER_ID),
                guildId: null,
                user: { id: 'admin-1' },
                member: { roles: [ADMIN_ROLE_ID] },
                update: vi.fn().mockResolvedValue(undefined),
                replied: false,
                deferred: false,
                reply: vi.fn().mockResolvedValue(undefined),
                followUp: vi.fn().mockResolvedValue(undefined),
            } as any;

            const handled = await handleEconomyResetButton(interaction);

            expect(handled).toBe(true);
            expect(interaction.update).toHaveBeenCalledTimes(1);
        });
    });

    it('zachowuje sukces resetu nawet gdy logowanie sie nie powiedzie', async () => {
        await withTempEconomyDb(async () => {
            mockedLogEconomyAdminMutation.mockRejectedValueOnce(new Error('log failure'));

            await addCoinsByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Setup',
                amount: 77,
                nowTimestamp: Date.now(),
            });

            const interaction = {
                customId: buildEconomyResetCustomId('coins', 'confirm', USER_ID),
                guildId: GUILD_ID,
                user: { id: 'admin-1' },
                member: { roles: [ADMIN_ROLE_ID] },
                deferUpdate: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                update: vi.fn().mockResolvedValue(undefined),
                replied: false,
                deferred: false,
                reply: vi.fn().mockResolvedValue(undefined),
                followUp: vi.fn().mockResolvedValue(undefined),
            } as any;

            const handled = await handleEconomyResetButton(interaction);
            expect(handled).toBe(true);

            const payload = interaction.editReply.mock.calls[0]?.[0];
            const embed = payload.embeds?.[0]?.toJSON?.() ?? payload.embeds?.[0];
            const fields = embed.fields ?? [];
            expect(fields.some((field: { name: string }) => field.name === 'Uwaga')).toBe(true);
        });
    });
});
