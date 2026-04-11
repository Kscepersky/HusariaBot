import {
    ChannelType,
    type Client,
    type Guild,
    type GuildBasedChannel,
    type GuildMember,
    type VoiceBasedChannel,
    type VoiceState,
} from 'discord.js';
import { getTemporaryVoiceConfig } from './constants.js';
import {
    deleteTemporaryVoiceChannelRecord,
    findTemporaryVoiceChannelByOwner,
    getTemporaryVoiceChannelRecord,
    listTemporaryVoiceChannelRecords,
    upsertTemporaryVoiceChannelRecord,
} from './store.js';
import type { TemporaryVoiceChannelRecord } from './types.js';

const memberOperationLocks = new Map<string, Promise<unknown>>();
const channelOperationLocks = new Map<string, Promise<unknown>>();
const pendingEmptyChannelDeletionTimers = new Map<string, ReturnType<typeof setTimeout>>();
const EMPTY_CHANNEL_DELETE_DELAY_MS = 10_000;

function sanitizeVoiceChannelOwnerName(input: string): string {
    const sanitized = input
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9_-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '');

    if (!sanitized) {
        return 'uzytkownik';
    }

    return sanitized.slice(0, 90);
}

export function buildTemporaryVoiceChannelName(ownerName: string): string {
    return `${sanitizeVoiceChannelOwnerName(ownerName)}-voice`;
}

function isVoiceChannel(channel: GuildBasedChannel | null): channel is VoiceBasedChannel {
    return Boolean(channel && channel.type === ChannelType.GuildVoice);
}

async function withMapLock<T>(
    lockMap: Map<string, Promise<unknown>>,
    key: string,
    operation: () => Promise<T>,
): Promise<T> {
    const previous = lockMap.get(key) ?? Promise.resolve();

    let operationResult: T;
    const current = previous
        .catch(() => undefined)
        .then(async () => {
            operationResult = await operation();
            return operationResult;
        });

    lockMap.set(key, current);

    try {
        const resolved = await current;
        return resolved as T;
    } finally {
        if (lockMap.get(key) === current) {
            lockMap.delete(key);
        }
    }
}

async function fetchGuildChannel(guild: Guild, channelId: string): Promise<GuildBasedChannel | null> {
    const cachedChannel = guild.channels.cache.get(channelId);
    if (cachedChannel) {
        return cachedChannel;
    }

    return guild.channels.fetch(channelId).catch(() => null);
}

async function moveMemberToChannel(member: GuildMember, channel: VoiceBasedChannel): Promise<void> {
    if (member.voice.channelId === channel.id) {
        return;
    }

    await member.voice.setChannel(channel, 'Przeniesienie do tymczasowego kanalu voice');
}

async function resolveExistingManagedVoiceChannel(
    guild: Guild,
    record: TemporaryVoiceChannelRecord,
): Promise<VoiceBasedChannel | null> {
    const channel = await fetchGuildChannel(guild, record.channelId);

    if (!isVoiceChannel(channel)) {
        return null;
    }

    return channel;
}

function clearPendingEmptyChannelDeletion(channelId: string): void {
    const timeout = pendingEmptyChannelDeletionTimers.get(channelId);
    if (!timeout) {
        return;
    }

    clearTimeout(timeout);
    pendingEmptyChannelDeletionTimers.delete(channelId);
}

function getManageChannelOverwriteTargets(ownerId: string, managerRoleIds: readonly string[]): string[] {
    return [...new Set([ownerId, ...managerRoleIds])];
}

async function deleteTemporaryVoiceChannelIfStillEmpty(guild: Guild, channelId: string): Promise<void> {
    const record = await getTemporaryVoiceChannelRecord(channelId);
    if (!record) {
        return;
    }

    const channel = await fetchGuildChannel(guild, channelId);

    if (!isVoiceChannel(channel)) {
        await deleteTemporaryVoiceChannelRecord(channelId);
        return;
    }

    if (channel.members.size > 0) {
        return;
    }

    try {
        await channel.delete('Usuniecie pustego tymczasowego kanalu voice po opoznieniu');
    } catch (error: unknown) {
        const errorCode = (error as { code?: number })?.code;
        if (errorCode !== 10003) {
            throw error;
        }
    }

    await deleteTemporaryVoiceChannelRecord(channelId);
}

export async function ensureTemporaryVoiceChannelForMember(state: VoiceState): Promise<void> {
    if (!state.member || state.member.user.bot) {
        return;
    }

    const guild = state.guild;
    const member = state.member;
    const memberLockKey = `${guild.id}:${member.id}`;

    await withMapLock(memberOperationLocks, memberLockKey, async () => {
        const config = getTemporaryVoiceConfig();

        if (member.voice.channelId !== config.triggerChannelId) {
            return;
        }

        const existingRecord = await findTemporaryVoiceChannelByOwner(guild.id, member.id);

        if (existingRecord) {
            const existingChannel = await resolveExistingManagedVoiceChannel(guild, existingRecord);

            if (existingChannel) {
                if (member.voice.channelId !== config.triggerChannelId) {
                    return;
                }

                await moveMemberToChannel(member, existingChannel);
                return;
            }

            await deleteTemporaryVoiceChannelRecord(existingRecord.channelId);
        }

        if (member.voice.channelId !== config.triggerChannelId) {
            return;
        }

        const createdChannel = await guild.channels.create({
            name: buildTemporaryVoiceChannelName(member.displayName || member.user.username),
            type: ChannelType.GuildVoice,
            parent: config.categoryId,
            reason: `Tymczasowy kanal voice dla ${member.user.tag}`,
        });

        const overwriteTargets = getManageChannelOverwriteTargets(member.id, config.managerRoleIds);
        const manageChannelReason = `Nadanie zarzadzania kanalem dla ${member.user.tag}`;
        const managerRoleIds = overwriteTargets.filter((targetId) => targetId !== member.id);

        try {
            await createdChannel.permissionOverwrites.edit(
                member.id,
                { ManageChannels: true },
                { reason: manageChannelReason },
            );
        } catch (error: unknown) {
            await createdChannel.delete('Nie udalo sie nadac uprawnien wlascicielowi kanalu').catch(() => undefined);
            throw error;
        }

        const managerOverwriteResults = await Promise.allSettled(managerRoleIds.map((roleId) => createdChannel.permissionOverwrites.edit(
            roleId,
            { ManageChannels: true },
            { reason: manageChannelReason },
        )));

        managerOverwriteResults.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                return;
            }

            const roleId = managerRoleIds[index] ?? 'unknown-role';
            console.warn('⚠️  [BOT] Nie udalo sie nadac staff overwrite dla tymczasowego kanalu voice.', {
                roleId,
                channelId: createdChannel.id,
                guildId: guild.id,
            }, result.reason);
        });

        const createdRecord: TemporaryVoiceChannelRecord = {
            channelId: createdChannel.id,
            guildId: guild.id,
            ownerId: member.id,
            createdAt: Date.now(),
        };

        await upsertTemporaryVoiceChannelRecord(createdRecord);

        try {
            await moveMemberToChannel(member, createdChannel);
        } catch (error: unknown) {
            await deleteTemporaryVoiceChannelRecord(createdChannel.id);
            await createdChannel.delete('Nie udalo sie przeniesc wlasciciela kanalu').catch(() => undefined);
            throw error;
        }
    });
}

export async function cleanupTemporaryVoiceChannelIfEmpty(guild: Guild, channelId: string): Promise<void> {
    const channelLockKey = `${guild.id}:${channelId}`;

    await withMapLock(channelOperationLocks, channelLockKey, async () => {
        const record = await getTemporaryVoiceChannelRecord(channelId);
        if (!record) {
            clearPendingEmptyChannelDeletion(channelId);
            return;
        }

        const channel = await fetchGuildChannel(guild, channelId);

        if (!isVoiceChannel(channel)) {
            clearPendingEmptyChannelDeletion(channelId);
            await deleteTemporaryVoiceChannelRecord(channelId);
            return;
        }

        if (channel.members.size > 0) {
            clearPendingEmptyChannelDeletion(channelId);
            return;
        }

        if (pendingEmptyChannelDeletionTimers.has(channelId)) {
            return;
        }

        const timeout = setTimeout(() => {
            void withMapLock(channelOperationLocks, channelLockKey, async () => {
                try {
                    await deleteTemporaryVoiceChannelIfStillEmpty(guild, channelId);
                } finally {
                    clearPendingEmptyChannelDeletion(channelId);
                }
            }).catch((error) => {
                console.error('❌  [BOT] Nie udalo sie usunac pustego tymczasowego kanalu voice:', error);
            });
        }, EMPTY_CHANNEL_DELETE_DELAY_MS);

        if (typeof timeout.unref === 'function') {
            timeout.unref();
        }

        pendingEmptyChannelDeletionTimers.set(channelId, timeout);
    });
}

export async function cleanupOrphanedTemporaryVoiceRecords(client: Client): Promise<void> {
    const records = await listTemporaryVoiceChannelRecords();

    await Promise.all(records.map(async (record) => {
        const guild = client.guilds.cache.get(record.guildId) ?? await client.guilds.fetch(record.guildId).catch(() => null);

        if (!guild) {
            await deleteTemporaryVoiceChannelRecord(record.channelId);
            return;
        }

        const channel = await fetchGuildChannel(guild, record.channelId);
        if (!isVoiceChannel(channel)) {
            await deleteTemporaryVoiceChannelRecord(record.channelId);
            return;
        }

        if (channel.members.size > 0) {
            return;
        }

        let shouldDeleteRecord = false;

        try {
            await channel.delete('Usuniecie pustego tymczasowego kanalu voice przy starcie');
            shouldDeleteRecord = true;
        } catch (error: unknown) {
            const errorCode = (error as { code?: number })?.code;
            shouldDeleteRecord = errorCode === 10003;
        }

        if (shouldDeleteRecord) {
            await deleteTemporaryVoiceChannelRecord(record.channelId);
        }
    }));
}
