import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, type VoiceState } from 'discord.js';

const {
    findTemporaryVoiceChannelByOwnerMock,
    getTemporaryVoiceChannelRecordMock,
    listTemporaryVoiceChannelRecordsMock,
    upsertTemporaryVoiceChannelRecordMock,
    deleteTemporaryVoiceChannelRecordMock,
} = vi.hoisted(() => ({
    findTemporaryVoiceChannelByOwnerMock: vi.fn(),
    getTemporaryVoiceChannelRecordMock: vi.fn(),
    listTemporaryVoiceChannelRecordsMock: vi.fn(),
    upsertTemporaryVoiceChannelRecordMock: vi.fn(),
    deleteTemporaryVoiceChannelRecordMock: vi.fn(),
}));

vi.mock('./constants.js', () => ({
    getTemporaryVoiceConfig: vi.fn(() => ({
        triggerChannelId: 'trigger-channel',
        categoryId: 'voice-category',
        managerRoleIds: ['admin-role', 'moderator-role', 'community-manager-role', 'dev-role'],
    })),
}));

vi.mock('./store.js', () => ({
    findTemporaryVoiceChannelByOwner: findTemporaryVoiceChannelByOwnerMock,
    getTemporaryVoiceChannelRecord: getTemporaryVoiceChannelRecordMock,
    listTemporaryVoiceChannelRecords: listTemporaryVoiceChannelRecordsMock,
    upsertTemporaryVoiceChannelRecord: upsertTemporaryVoiceChannelRecordMock,
    deleteTemporaryVoiceChannelRecord: deleteTemporaryVoiceChannelRecordMock,
}));

import {
    buildTemporaryVoiceChannelName,
    cleanupOrphanedTemporaryVoiceRecords,
    cleanupTemporaryVoiceChannelIfEmpty,
    ensureTemporaryVoiceChannelForMember,
} from './service.js';

function createVoiceState(overrides: Record<string, unknown> = {}): VoiceState {
    const setChannel = vi.fn(async () => undefined);
    const fetchChannel = vi.fn(async () => null);
    const editChannelOverwrites = vi.fn(async () => undefined);
    const createChannel = vi.fn(async () => ({
        id: 'created-channel',
        type: ChannelType.GuildVoice,
        members: new Map(),
        permissionOverwrites: {
            edit: editChannelOverwrites,
        },
        delete: vi.fn(async () => undefined),
    }));

    return {
        id: 'user-1',
        channelId: 'trigger-channel',
        guild: {
            id: 'guild-1',
            channels: {
                cache: new Map(),
                fetch: fetchChannel,
                create: createChannel,
            },
        },
        member: {
            id: 'user-1',
            displayName: 'Test User',
            user: {
                bot: false,
                username: 'Test User',
                tag: 'TestUser#0001',
            },
            voice: {
                channelId: 'trigger-channel',
                setChannel,
            },
        },
        ...overrides,
    } as unknown as VoiceState;
}

describe('temporary voice service', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        findTemporaryVoiceChannelByOwnerMock.mockResolvedValue(null);
        getTemporaryVoiceChannelRecordMock.mockResolvedValue(null);
        listTemporaryVoiceChannelRecordsMock.mockResolvedValue([]);
        upsertTemporaryVoiceChannelRecordMock.mockResolvedValue(undefined);
        deleteTemporaryVoiceChannelRecordMock.mockResolvedValue(true);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('buduje nazwe kanalu voice z nickname', () => {
        expect(buildTemporaryVoiceChannelName('NiCk Discord!')).toBe('nick-discord-voice');
    });

    it('tworzy kanal i przenosi użytkownika gdy brak istniejącego', async () => {
        const newState = createVoiceState();

        await ensureTemporaryVoiceChannelForMember(newState);

        const createMock = newState.guild.channels.create as ReturnType<typeof vi.fn>;
        const setChannelMock = newState.member!.voice.setChannel as ReturnType<typeof vi.fn>;

        expect(createMock).toHaveBeenCalledTimes(1);
        const createPayload = createMock.mock.calls[0]?.[0] as { userLimit?: number };
        const createdChannel = await createMock.mock.results[0]?.value as {
            permissionOverwrites: { edit: ReturnType<typeof vi.fn> };
        };
        expect(createPayload.userLimit).toBeUndefined();
        expect(createdChannel.permissionOverwrites.edit).toHaveBeenCalledTimes(5);
        expect(createdChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
            'user-1',
            { ManageChannels: true },
            { reason: 'Nadanie zarzadzania kanalem dla TestUser#0001' },
        );
        expect(createdChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
            'admin-role',
            { ManageChannels: true },
            { reason: 'Nadanie zarzadzania kanalem dla TestUser#0001' },
        );
        expect(createdChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
            'moderator-role',
            { ManageChannels: true },
            { reason: 'Nadanie zarzadzania kanalem dla TestUser#0001' },
        );
        expect(createdChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
            'community-manager-role',
            { ManageChannels: true },
            { reason: 'Nadanie zarzadzania kanalem dla TestUser#0001' },
        );
        expect(createdChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
            'dev-role',
            { ManageChannels: true },
            { reason: 'Nadanie zarzadzania kanalem dla TestUser#0001' },
        );
        expect(upsertTemporaryVoiceChannelRecordMock).toHaveBeenCalledTimes(1);
        expect(setChannelMock).toHaveBeenCalledTimes(1);
    });

    it('usuwa kanal gdy nadanie uprawnien ownerowi sie nie powiedzie', async () => {
        const deleteCreatedChannelMock = vi.fn(async () => undefined);
        const newState = createVoiceState({
            guild: {
                id: 'guild-1',
                channels: {
                    cache: new Map(),
                    fetch: vi.fn(async () => null),
                    create: vi.fn(async () => ({
                        id: 'created-channel',
                        type: ChannelType.GuildVoice,
                        members: new Map(),
                        permissionOverwrites: {
                            edit: vi.fn(async () => {
                                throw new Error('Brak uprawnien');
                            }),
                        },
                        delete: deleteCreatedChannelMock,
                    })),
                },
            },
        });

        await expect(ensureTemporaryVoiceChannelForMember(newState)).rejects.toThrow('Brak uprawnien');

        expect(deleteCreatedChannelMock).toHaveBeenCalledWith('Nie udalo sie nadac uprawnien wlascicielowi kanalu');
        expect(upsertTemporaryVoiceChannelRecordMock).not.toHaveBeenCalled();
    });

    it('nie usuwa kanalu gdy nadanie uprawnien staffowi sie nie powiedzie', async () => {
        const deleteCreatedChannelMock = vi.fn(async () => undefined);
        const setChannelMock = vi.fn(async () => undefined);
        const editMock = vi.fn(async (targetId: string) => {
            if (targetId === 'dev-role') {
                throw new Error('Brak uprawnien dla roli dev');
            }
        });

        const newState = createVoiceState({
            guild: {
                id: 'guild-1',
                channels: {
                    cache: new Map(),
                    fetch: vi.fn(async () => null),
                    create: vi.fn(async () => ({
                        id: 'created-channel',
                        type: ChannelType.GuildVoice,
                        members: new Map(),
                        permissionOverwrites: {
                            edit: editMock,
                        },
                        delete: deleteCreatedChannelMock,
                    })),
                },
            },
            member: {
                id: 'user-1',
                displayName: 'Test User',
                user: {
                    bot: false,
                    username: 'Test User',
                    tag: 'TestUser#0001',
                },
                voice: {
                    channelId: 'trigger-channel',
                    setChannel: setChannelMock,
                },
            },
        });

        await expect(ensureTemporaryVoiceChannelForMember(newState)).resolves.toBeUndefined();

        expect(editMock).toHaveBeenCalledWith(
            'user-1',
            { ManageChannels: true },
            { reason: 'Nadanie zarzadzania kanalem dla TestUser#0001' },
        );
        expect(deleteCreatedChannelMock).not.toHaveBeenCalled();
        expect(upsertTemporaryVoiceChannelRecordMock).toHaveBeenCalledTimes(1);
        expect(setChannelMock).toHaveBeenCalledTimes(1);
    });

    it('nie tworzy kanalu gdy użytkownik opuści trigger przed wykonaniem locka', async () => {
        const newState = createVoiceState({
            member: {
                id: 'user-1',
                displayName: 'Test User',
                user: {
                    bot: false,
                    username: 'Test User',
                    tag: 'TestUser#0001',
                },
                voice: {
                    channelId: 'other-channel',
                    setChannel: vi.fn(async () => undefined),
                },
            },
        });

        await ensureTemporaryVoiceChannelForMember(newState);

        const createMock = newState.guild.channels.create as ReturnType<typeof vi.fn>;
        expect(createMock).not.toHaveBeenCalled();
        expect(upsertTemporaryVoiceChannelRecordMock).not.toHaveBeenCalled();
    });

    it('uzywa istniejącego kanalu jeśli owner ma już rekord', async () => {
        const existingChannel = {
            id: 'existing-channel',
            type: ChannelType.GuildVoice,
            members: new Map(),
            delete: vi.fn(async () => undefined),
        };

        const newState = createVoiceState({
            guild: {
                id: 'guild-1',
                channels: {
                    cache: new Map(),
                    fetch: vi.fn(async () => existingChannel),
                    create: vi.fn(async () => existingChannel),
                },
            },
        });

        findTemporaryVoiceChannelByOwnerMock.mockResolvedValue({
            channelId: 'existing-channel',
            guildId: 'guild-1',
            ownerId: 'user-1',
            createdAt: Date.now(),
        });

        await ensureTemporaryVoiceChannelForMember(newState);

        const createMock = newState.guild.channels.create as ReturnType<typeof vi.fn>;
        const setChannelMock = newState.member!.voice.setChannel as ReturnType<typeof vi.fn>;

        expect(createMock).not.toHaveBeenCalled();
        expect(setChannelMock).toHaveBeenCalledWith(existingChannel, 'Przeniesienie do tymczasowego kanalu voice');
    });

    it('usuwa pusty zarządzany kanal', async () => {
        const emptyChannel = {
            id: 'managed-channel',
            type: ChannelType.GuildVoice,
            members: new Map(),
            delete: vi.fn(async () => undefined),
        };

        const guild = {
            id: 'guild-1',
            channels: {
                cache: new Map(),
                fetch: vi.fn(async () => emptyChannel),
            },
        };

        getTemporaryVoiceChannelRecordMock.mockResolvedValue({
            channelId: 'managed-channel',
            guildId: 'guild-1',
            ownerId: 'user-1',
            createdAt: Date.now(),
        });

        await cleanupTemporaryVoiceChannelIfEmpty(guild as any, 'managed-channel');

        expect(emptyChannel.delete).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(10_000);

        expect(emptyChannel.delete).toHaveBeenCalledTimes(1);
        expect(deleteTemporaryVoiceChannelRecordMock).toHaveBeenCalledWith('managed-channel');
    });

    it('nie usuwa kanalu jesli ktos wroci w ciagu 10 sekund', async () => {
        const members = new Map<string, { id: string }>();
        const emptyChannel = {
            id: 'managed-channel',
            type: ChannelType.GuildVoice,
            members,
            delete: vi.fn(async () => undefined),
        };

        const guild = {
            id: 'guild-1',
            channels: {
                cache: new Map(),
                fetch: vi.fn(async () => emptyChannel),
            },
        };

        getTemporaryVoiceChannelRecordMock.mockResolvedValue({
            channelId: 'managed-channel',
            guildId: 'guild-1',
            ownerId: 'user-1',
            createdAt: Date.now(),
        });

        await cleanupTemporaryVoiceChannelIfEmpty(guild as any, 'managed-channel');

        members.set('user-back', { id: 'user-back' });
        await vi.advanceTimersByTimeAsync(10_000);

        expect(emptyChannel.delete).not.toHaveBeenCalled();
        expect(deleteTemporaryVoiceChannelRecordMock).not.toHaveBeenCalledWith('managed-channel');
    });

    it('nie usuwa kanalow niezarządzanych przez store', async () => {
        const channelDeleteMock = vi.fn(async () => undefined);
        const guild = {
            id: 'guild-1',
            channels: {
                cache: new Map(),
                fetch: vi.fn(async () => ({
                    id: 'unmanaged-channel',
                    type: ChannelType.GuildVoice,
                    members: new Map(),
                    delete: channelDeleteMock,
                })),
            },
        };

        getTemporaryVoiceChannelRecordMock.mockResolvedValue(null);

        await cleanupTemporaryVoiceChannelIfEmpty(guild as any, 'unmanaged-channel');

        expect(channelDeleteMock).not.toHaveBeenCalled();
    });

    it('czyści osierocone rekordy i puste kanały przy starcie', async () => {
        const deleteMock = vi.fn(async () => undefined);
        const guild = {
            id: 'guild-1',
            channels: {
                cache: new Map(),
                fetch: vi.fn(async (channelId: string) => {
                    if (channelId === 'empty-channel') {
                        return {
                            id: 'empty-channel',
                            type: ChannelType.GuildVoice,
                            members: new Map(),
                            delete: deleteMock,
                        };
                    }

                    if (channelId === 'active-channel') {
                        return {
                            id: 'active-channel',
                            type: ChannelType.GuildVoice,
                            members: new Map([['member-1', { id: 'member-1' }]]),
                            delete: vi.fn(async () => undefined),
                        };
                    }

                    return null;
                }),
            },
        };

        const client = {
            guilds: {
                cache: new Map([['guild-1', guild]]),
                fetch: vi.fn(async () => null),
            },
        };

        listTemporaryVoiceChannelRecordsMock.mockResolvedValue([
            { channelId: 'missing-channel', guildId: 'guild-1', ownerId: 'user-1', createdAt: Date.now() },
            { channelId: 'empty-channel', guildId: 'guild-1', ownerId: 'user-2', createdAt: Date.now() },
            { channelId: 'active-channel', guildId: 'guild-1', ownerId: 'user-3', createdAt: Date.now() },
            { channelId: 'unknown-guild-channel', guildId: 'guild-2', ownerId: 'user-4', createdAt: Date.now() },
        ]);

        await cleanupOrphanedTemporaryVoiceRecords(client as any);

        expect(deleteMock).toHaveBeenCalledTimes(1);
        expect(deleteTemporaryVoiceChannelRecordMock).toHaveBeenCalledWith('missing-channel');
        expect(deleteTemporaryVoiceChannelRecordMock).toHaveBeenCalledWith('empty-channel');
        expect(deleteTemporaryVoiceChannelRecordMock).toHaveBeenCalledWith('unknown-guild-channel');
    });

    it('zachowuje rekord startup cleanup gdy usuniecie kanalu sie nie powiedzie', async () => {
        const guild = {
            id: 'guild-1',
            channels: {
                cache: new Map(),
                fetch: vi.fn(async () => ({
                    id: 'delete-fails',
                    type: ChannelType.GuildVoice,
                    members: new Map(),
                    delete: vi.fn(async () => {
                        throw new Error('Brak uprawnien');
                    }),
                })),
            },
        };

        const client = {
            guilds: {
                cache: new Map([['guild-1', guild]]),
                fetch: vi.fn(async () => null),
            },
        };

        listTemporaryVoiceChannelRecordsMock.mockResolvedValue([
            { channelId: 'delete-fails', guildId: 'guild-1', ownerId: 'user-2', createdAt: Date.now() },
        ]);

        await cleanupOrphanedTemporaryVoiceRecords(client as any);

        expect(deleteTemporaryVoiceChannelRecordMock).not.toHaveBeenCalledWith('delete-fails');
    });
});
