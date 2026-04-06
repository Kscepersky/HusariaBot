import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttachmentBuilder } from 'discord.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { levelCommand } from './level.js';
import { awardMessageXp } from '../economy/repository.js';
import { resetEconomyDatabaseForTests } from '../economy/database.js';

const { renderLevelCardMock } = vi.hoisted(() => ({
    renderLevelCardMock: vi.fn(),
}));

vi.mock('./level-card-renderer.js', () => ({
    renderLevelCard: renderLevelCardMock,
}));

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
    vi.clearAllMocks();
    await resetEconomyDatabaseForTests();
});

describe('levelCommand', () => {
    it('wyswietla publiczna grafike level card jako zalacznik', async () => {
        await withTempEconomyDb(async () => {
            const now = Date.now();
            for (let index = 0; index < 120; index += 1) {
                await awardMessageXp('guild-1', 'user-1', now + index);
            }

            renderLevelCardMock.mockResolvedValueOnce(Buffer.from('png-binary-data'));

            const deferReply = vi.fn().mockResolvedValue(undefined);
            const editReply = vi.fn().mockResolvedValue(undefined);
            const interaction = {
                guildId: 'guild-1',
                user: {
                    id: 'user-1',
                    username: 'TestowyUser',
                    displayAvatarURL: vi.fn().mockReturnValue('https://cdn.example.com/avatar.png'),
                },
                deferReply,
                editReply,
            } as any;

            await levelCommand.execute(interaction);

            expect(deferReply).toHaveBeenCalledTimes(1);
            expect(deferReply.mock.calls[0]?.[0]).toBeUndefined();
            expect(editReply).toHaveBeenCalledTimes(1);
            expect(renderLevelCardMock).toHaveBeenCalledTimes(1);
            expect(interaction.user.displayAvatarURL).toHaveBeenCalledWith({
                extension: 'png',
                forceStatic: true,
                size: 256,
            });

            const rendererPayload = renderLevelCardMock.mock.calls[0]?.[0];
            expect(rendererPayload).toMatchObject({
                username: 'TestowyUser',
                avatarUrl: 'https://cdn.example.com/avatar.png',
            });
            expect(typeof rendererPayload.rank).toBe('number');
            expect(typeof rendererPayload.xpForNextLevel).toBe('number');
            expect(typeof rendererPayload.xpIntoCurrentLevel).toBe('number');
            expect(typeof rendererPayload.xpToNextLevel).toBe('number');

            const payload = editReply.mock.calls[0]?.[0];
            expect(payload.content).toBe('');
            expect(payload.files).toHaveLength(1);
            expect(payload.files[0]).toBeInstanceOf(AttachmentBuilder);
            expect(payload.files[0].name).toBe('level-card.png');
            expect(payload.embeds).toBeUndefined();
        });
    });

    it('gdy render grafiki nie powiedzie sie wyswietla fallback embed', async () => {
        await withTempEconomyDb(async () => {
            renderLevelCardMock.mockRejectedValueOnce(new Error('render-failed'));

            const deferReply = vi.fn().mockResolvedValue(undefined);
            const editReply = vi.fn().mockResolvedValue(undefined);
            const interaction = {
                guildId: 'guild-1',
                user: {
                    id: 'user-1',
                    username: 'TestowyUser',
                    displayAvatarURL: vi.fn().mockReturnValue('https://cdn.example.com/avatar.png'),
                },
                deferReply,
                editReply,
            } as any;

            await levelCommand.execute(interaction);

            expect(deferReply).toHaveBeenCalledTimes(1);
            expect(editReply).toHaveBeenCalledTimes(1);

            const payload = editReply.mock.calls[0]?.[0];
            expect(payload.files).toBeUndefined();
            expect(payload.embeds).toHaveLength(1);

            const fallbackEmbed = payload.embeds[0].toJSON();
            expect(fallbackEmbed.title).toContain('Twoj level');
            expect((fallbackEmbed.fields ?? []).some((field: { name: string }) => field.name === 'Ranga')).toBe(true);
            expect((fallbackEmbed.fields ?? []).some((field: { name: string }) => field.name === 'Postep')).toBe(true);
        });
    });
});
