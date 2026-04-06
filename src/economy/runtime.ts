import type { Client, Guild, GuildMember, Message, VoiceBasedChannel } from 'discord.js';
import { listScheduledPosts } from '../dashboard/scheduler/store.js';
import {
    awardMessageXp,
    awardVoiceXp,
    awardWatchpartyVoiceActivity,
    getEconomyConfig,
    getEconomyLevelRoleMappings,
    incrementMessageCount,
    incrementVoiceMinutes,
} from './repository.js';
import type { EconomyConfig, EconomyLevelRoleMapping, EconomyXpAwardResult } from './types.js';

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

function resolveLevelUpAnnouncementChannelId(): string | null {
    const channelId = process.env.LEVEL_UP_ANNOUNCE_CHANNEL_ID?.trim();
    return channelId && channelId.length > 0 ? channelId : null;
}

function resolveProtectedStaffRoleIds(): Set<string> {
    const roleIds = [
        process.env.ADMIN_ROLE_ID,
        process.env.MODERATOR_ROLE_ID,
        process.env.COMMUNITY_MANAGER_ROLE_ID,
        process.env.DEV_ROLE_ID,
    ];

    return new Set(
        roleIds
            .map((roleId) => String(roleId ?? '').trim())
            .filter((roleId) => /^\d{17,20}$/.test(roleId)),
    );
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

async function applyLevelRoleForMember(
    guild: Guild,
    userId: string,
    level: number,
    mappings: EconomyLevelRoleMapping[],
): Promise<void> {
    if (mappings.length === 0) {
        return;
    }

    let member: GuildMember | null = null;
    try {
        member = await guild.members.fetch(userId);
    } catch (error) {
        console.warn('Nie udalo sie pobrac czlonka do mapowania roli levelowej:', {
            guildId: guild.id,
            userId,
            error,
        });
        return;
    }

    const mappedRoleIds = new Set(mappings.map((mapping) => mapping.roleId));
    const matchingMappings = mappings
        .filter((mapping) => mapping.minLevel <= level)
        .sort((left, right) => right.minLevel - left.minLevel || left.roleId.localeCompare(right.roleId));

    const targetRoleId = matchingMappings[0]?.roleId ?? null;
    const rolesToRemove = member.roles.cache
        .filter((role) => mappedRoleIds.has(role.id) && role.id !== targetRoleId)
        .map((role) => role.id);

    if (rolesToRemove.length > 0) {
        try {
            await member.roles.remove(rolesToRemove, 'Economy level role remap');
        } catch (error) {
            console.warn('Nie udalo sie usunac starych ról levelowych:', {
                guildId: guild.id,
                userId,
                rolesToRemove,
                error,
            });
        }
    }

    if (!targetRoleId || member.roles.cache.has(targetRoleId)) {
        return;
    }

    try {
        await member.roles.add(targetRoleId, 'Economy level reward');
    } catch (error) {
        console.warn('Nie udalo sie nadac roli levelowej:', {
            guildId: guild.id,
            userId,
            roleId: targetRoleId,
            error,
        });
    }
}

async function announceNaturalLevelUp(
    guild: Guild,
    awardResult: EconomyXpAwardResult,
): Promise<void> {
    const channelId = resolveLevelUpAnnouncementChannelId();
    if (!channelId || awardResult.levelsGained <= 0) {
        return;
    }

    try {
        const channel = await guild.channels.fetch(channelId);
        if (!channel?.isTextBased()) {
            return;
        }

        await channel.send({
            content: `<@${awardResult.userId}> wbija level **${awardResult.currentLevel}**!`,
        });
    } catch (error) {
        console.warn('Nie udalo sie wyslac ogloszenia level-up:', {
            guildId: guild.id,
            userId: awardResult.userId,
            channelId,
            error,
        });
    }
}

async function applyNaturalLevelUpSideEffects(
    guild: Guild,
    awardResult: EconomyXpAwardResult,
    mappingsOverride?: EconomyLevelRoleMapping[],
): Promise<void> {
    if (!awardResult || !Number.isFinite(Number(awardResult.levelsGained)) || awardResult.levelsGained <= 0) {
        return;
    }

    try {
        const mappings = mappingsOverride ?? await getEconomyLevelRoleMappings(guild.id);
        const protectedRoleIds = resolveProtectedStaffRoleIds();
        const safeMappings = mappings.filter((mapping) => !protectedRoleIds.has(mapping.roleId));

        if (safeMappings.length === 0) {
            await announceNaturalLevelUp(guild, awardResult);
            return;
        }

        await Promise.all([
            applyLevelRoleForMember(guild, awardResult.userId, awardResult.currentLevel, safeMappings),
            announceNaturalLevelUp(guild, awardResult),
        ]);
    } catch (error) {
        console.warn('Nie udalo sie wykonac side-effectow level-up:', {
            guildId: guild.id,
            userId: awardResult.userId,
            currentLevel: awardResult.currentLevel,
            error,
        });
    }
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

    try {
        await incrementMessageCount(message.guildId, message.author.id, nowTimestamp);
    } catch (error) {
        console.error('❌  Nie udalo sie zwiekszyc licznika wiadomosci:', error);
    }

    const cooldownKey = resolveMessageCooldownKey(message.guildId, message.author.id);
    const previousTimestamp = messageCooldownByUser.get(cooldownKey) ?? 0;
    const cooldownWindowMs = config.xpTextCooldownSeconds * 1000;

    pruneMessageCooldowns(nowTimestamp, cooldownWindowMs);

    if ((nowTimestamp - previousTimestamp) < cooldownWindowMs) {
        return;
    }

    messageCooldownByUser.set(cooldownKey, nowTimestamp);

    try {
        const awardResult = await awardMessageXp(message.guildId, message.author.id, nowTimestamp);
        await applyNaturalLevelUpSideEffects(message.guild, awardResult);
    } catch (error) {
        messageCooldownByUser.delete(cooldownKey);
        console.error('❌  Nie udalo sie naliczyc XP za wiadomosc:', error);
    }
}

async function processVoiceChannelXpTick(client: Client): Promise<void> {
    const nowTimestamp = Date.now();
    const config = await getCachedEconomyConfig(nowTimestamp);
    const openWatchpartyChannelIds = await getOpenWatchpartyChannelIds();
    const levelRoleMappingsByGuild = new Map<string, Promise<EconomyLevelRoleMapping[]>>();

    const getLevelRoleMappingsForGuild = (guildId: string): Promise<EconomyLevelRoleMapping[]> => {
        const existingPromise = levelRoleMappingsByGuild.get(guildId);
        if (existingPromise) {
            return existingPromise;
        }

        const mappingPromise = getEconomyLevelRoleMappings(guildId);
        levelRoleMappingsByGuild.set(guildId, mappingPromise);
        return mappingPromise;
    };

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

            const activeMembers = voiceChannel.members.filter((member) => !member.user.bot);
            await Promise.all(activeMembers.map(async (member) => {
                try {
                    await incrementVoiceMinutes(guild.id, member.id, 1, nowTimestamp);
                } catch (error) {
                    console.error(`❌  Nie udalo sie zwiekszyc liczby minut VC dla ${member.id}:`, error);
                }
            }));

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
                    const awardResult = isOpenWatchpartyChannel
                        ? await awardWatchpartyVoiceActivity(guild.id, member.id, nowTimestamp, config)
                        : await awardVoiceXp(guild.id, member.id, nowTimestamp);

                    try {
                        const levelRoleMappings = await getLevelRoleMappingsForGuild(guild.id);
                        await applyNaturalLevelUpSideEffects(guild, awardResult, levelRoleMappings);
                    } catch (sideEffectError) {
                        console.warn(`⚠️  Nie udalo sie wykonac side-effectow level-up VC dla ${member.id}:`, sideEffectError);
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
