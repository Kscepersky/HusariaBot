import type { Client, GuildMember, Message, VoiceBasedChannel } from 'discord.js';
import { listScheduledPosts } from '../dashboard/scheduler/store.js';
import { awardMessageXp, awardVoiceXp, awardWatchpartyVoiceActivity, getEconomyConfig } from './repository.js';
import type { EconomyConfig } from './types.js';

const VOICE_TICK_INTERVAL_MS = 60_000;
const CONFIG_CACHE_TTL_MS = 60_000;

const messageCooldownByUser = new Map<string, number>();

let cachedConfig: EconomyConfig | null = null;
let cachedConfigAt = 0;

interface VoiceEligibilityInput {
    isBot: boolean;
    selfMute: boolean;
    selfDeaf: boolean;
    isAfk: boolean;
    eligibleMemberCount: number;
}

function pruneMessageCooldowns(nowTimestamp: number, cooldownWindowMs: number): void {
    if (messageCooldownByUser.size < 5_000) {
        return;
    }

    for (const [key, lastAwardAt] of messageCooldownByUser.entries()) {
        if ((nowTimestamp - lastAwardAt) > (cooldownWindowMs * 2)) {
            messageCooldownByUser.delete(key);
        }
    }
}

function resolveMessageCooldownKey(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
}

async function getCachedEconomyConfig(nowTimestamp: number): Promise<EconomyConfig> {
    if (cachedConfig && (nowTimestamp - cachedConfigAt) <= CONFIG_CACHE_TTL_MS) {
        return cachedConfig;
    }

    const config = await getEconomyConfig();
    cachedConfig = config;
    cachedConfigAt = nowTimestamp;
    return config;
}

function isVoiceChannelMemberEligible(member: GuildMember, config: EconomyConfig, afkChannelId: string | null): boolean {
    if (member.user.bot) {
        return false;
    }

    if (!config.xpVoiceAllowSelfMute && member.voice.selfMute) {
        return false;
    }

    if (!config.xpVoiceAllowSelfDeaf && member.voice.selfDeaf) {
        return false;
    }

    if (!config.xpVoiceAllowAfk && afkChannelId && member.voice.channelId === afkChannelId) {
        return false;
    }

    return true;
}

async function getOpenWatchpartyChannelIds(): Promise<Set<string>> {
    try {
        const posts = await listScheduledPosts();
        const openWatchpartyChannelIds = posts
            .filter((post) => post.status === 'sent' && post.watchpartyStatus === 'open')
            .map((post) => post.watchpartyChannelId)
            .filter((channelId): channelId is string => typeof channelId === 'string' && channelId.trim().length > 0);

        return new Set(openWatchpartyChannelIds);
    } catch (error) {
        console.error('❌  Nie udalo sie pobrac aktywnych kanalow watchparty:', error);
        return new Set();
    }
}

export function shouldAwardVoiceXpByRule(config: EconomyConfig, input: VoiceEligibilityInput): boolean {
    if (input.isBot) {
        return false;
    }

    if (!config.xpVoiceAllowSelfMute && input.selfMute) {
        return false;
    }

    if (!config.xpVoiceAllowSelfDeaf && input.selfDeaf) {
        return false;
    }

    if (!config.xpVoiceAllowAfk && input.isAfk) {
        return false;
    }

    if (config.xpVoiceRequireTwoUsers && input.eligibleMemberCount < 2) {
        return false;
    }

    return true;
}

export async function handleEconomyMessageCreate(message: Message): Promise<void> {
    if (!message.inGuild() || message.author.bot) {
        return;
    }

    const nowTimestamp = Date.now();
    const config = await getCachedEconomyConfig(nowTimestamp);
    const cooldownKey = resolveMessageCooldownKey(message.guildId, message.author.id);
    const previousTimestamp = messageCooldownByUser.get(cooldownKey) ?? 0;
    const cooldownWindowMs = config.xpTextCooldownSeconds * 1000;

    pruneMessageCooldowns(nowTimestamp, cooldownWindowMs);

    if ((nowTimestamp - previousTimestamp) < cooldownWindowMs) {
        return;
    }

    messageCooldownByUser.set(cooldownKey, nowTimestamp);

    try {
        await awardMessageXp(message.guildId, message.author.id, nowTimestamp);
    } catch (error) {
        messageCooldownByUser.delete(cooldownKey);
        console.error('❌  Nie udalo sie naliczyc XP za wiadomosc:', error);
    }
}

async function processVoiceChannelXpTick(client: Client): Promise<void> {
    const nowTimestamp = Date.now();
    const config = await getCachedEconomyConfig(nowTimestamp);
    const openWatchpartyChannelIds = await getOpenWatchpartyChannelIds();

    for (const guild of client.guilds.cache.values()) {
        const afkChannelId = guild.afkChannelId;

        for (const channel of guild.channels.cache.values()) {
            if (!channel.isVoiceBased()) {
                continue;
            }

            const voiceChannel = channel as VoiceBasedChannel;
            if (voiceChannel.members.size === 0) {
                continue;
            }

            const isOpenWatchpartyChannel = openWatchpartyChannelIds.has(voiceChannel.id);

            const eligibleMembers = voiceChannel.members.filter((member) => {
                return isVoiceChannelMemberEligible(member, config, afkChannelId);
            });

            const eligibleCount = eligibleMembers.size;
            if (config.xpVoiceRequireTwoUsers && eligibleCount < 2) {
                continue;
            }

            await Promise.all(eligibleMembers.map(async (member) => {
                const shouldAward = shouldAwardVoiceXpByRule(config, {
                    isBot: member.user.bot,
                    selfMute: Boolean(member.voice.selfMute),
                    selfDeaf: Boolean(member.voice.selfDeaf),
                    isAfk: Boolean(afkChannelId && member.voice.channelId === afkChannelId),
                    eligibleMemberCount: eligibleCount,
                });

                if (!shouldAward) {
                    return;
                }

                try {
                    if (isOpenWatchpartyChannel) {
                        await awardWatchpartyVoiceActivity(guild.id, member.id, nowTimestamp, config);
                    } else {
                        await awardVoiceXp(guild.id, member.id, nowTimestamp);
                    }
                } catch (error) {
                    console.error(`❌  Nie udalo sie naliczyc XP VC dla ${member.id}:`, error);
                }
            }));
        }
    }
}

export function startEconomyVoiceXpTicker(client: Client): () => void {
    let isTickInProgress = false;

    const interval = setInterval(() => {
        if (isTickInProgress) {
            return;
        }

        isTickInProgress = true;
        void processVoiceChannelXpTick(client).catch((error) => {
            console.error('❌  Blad ticka XP VC:', error);
        }).finally(() => {
            isTickInProgress = false;
        });
    }, VOICE_TICK_INTERVAL_MS);

    interval.unref();

    return () => {
        clearInterval(interval);
    };
}

export function resetEconomyRuntimeForTests(): void {
    messageCooldownByUser.clear();
    cachedConfig = null;
    cachedConfigAt = 0;
}
