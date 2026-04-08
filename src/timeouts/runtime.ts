import type { Client, Guild, GuildMember } from 'discord.js';
import { listExpiredActiveEconomyTimeouts, releaseEconomyTimeout } from '../economy/repository.js';

const TIMEOUT_TICK_INTERVAL_MS = 30_000;
const SYSTEM_TIMEOUT_RELEASE_USER_ID = 'system-timeout-worker';

function isUnknownGuildError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const maybeErrorCode = (error as { code?: number }).code;
    return maybeErrorCode === 10004;
}

function isUnknownMemberError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const maybeErrorCode = (error as { code?: number }).code;
    return maybeErrorCode === 10007;
}

async function resolveGuild(client: Client, guildId: string): Promise<Guild | null> {
    const cached = client.guilds.cache.get(guildId);
    if (cached) {
        return cached;
    }

    try {
        return await client.guilds.fetch(guildId);
    } catch (error) {
        if (isUnknownGuildError(error)) {
            return null;
        }

        throw error;
    }
}

async function resolveMember(guild: Guild, userId: string): Promise<GuildMember | null> {
    try {
        return await guild.members.fetch(userId);
    } catch (error) {
        if (isUnknownMemberError(error)) {
            return null;
        }

        console.warn('⚠️ Nie udalo sie pobrac czlonka do timeoutu:', {
            guildId: guild.id,
            userId,
            error,
        });
        throw error;
    }
}

async function releaseExpiredTimeout(client: Client, timeoutRecord: {
    id: number;
    guildId: string;
    userId: string;
    muteRoleId: string;
}): Promise<void> {
    let guild: Guild | null = null;
    try {
        guild = await resolveGuild(client, timeoutRecord.guildId);
    } catch (error) {
        console.warn('⚠️ Nie udalo sie pobrac guild do timeoutu:', {
            guildId: timeoutRecord.guildId,
            timeoutId: timeoutRecord.id,
            error,
        });
        return;
    }

    if (guild) {
        const member = await resolveMember(guild, timeoutRecord.userId);
        if (member && member.roles.cache.has(timeoutRecord.muteRoleId)) {
            try {
                await member.roles.remove(timeoutRecord.muteRoleId, 'Timeout wygasl automatycznie');
            } catch (error) {
                console.error('❌ Nie udalo sie zdjac roli mute po wygasnieciu timeoutu:', {
                    guildId: timeoutRecord.guildId,
                    userId: timeoutRecord.userId,
                    timeoutId: timeoutRecord.id,
                    error,
                });
                return;
            }
        }
    }

    await releaseEconomyTimeout({
        guildId: timeoutRecord.guildId,
        timeoutId: timeoutRecord.id,
        releasedAt: Date.now(),
        releasedByUserId: SYSTEM_TIMEOUT_RELEASE_USER_ID,
        releaseReason: 'Timeout wygasl automatycznie',
    });
}

async function processTimeoutExpiryTick(client: Client): Promise<void> {
    const expiredTimeouts = await listExpiredActiveEconomyTimeouts(Date.now(), 200);

    for (const timeoutRecord of expiredTimeouts) {
        try {
            await releaseExpiredTimeout(client, {
                id: timeoutRecord.id,
                guildId: timeoutRecord.guildId,
                userId: timeoutRecord.userId,
                muteRoleId: timeoutRecord.muteRoleId,
            });
        } catch (error) {
            console.error('❌ Blad obslugi wygasajacego timeoutu:', {
                timeoutId: timeoutRecord.id,
                guildId: timeoutRecord.guildId,
                userId: timeoutRecord.userId,
                error,
            });
        }
    }
}

export function startTimeoutExpiryTicker(client: Client): () => void {
    let isTickInProgress = false;

    const interval = setInterval(() => {
        if (isTickInProgress) {
            return;
        }

        isTickInProgress = true;
        void processTimeoutExpiryTick(client)
            .catch((error) => {
                console.error('❌ Blad ticka timeoutow:', error);
            })
            .finally(() => {
                isTickInProgress = false;
            });
    }, TIMEOUT_TICK_INTERVAL_MS);

    interval.unref();

    return () => {
        clearInterval(interval);
    };
}
