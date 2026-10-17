import {
    getGuildMember,
    getDiscordUserById,
    DiscordRateLimitedError,
} from '../discord-api.js';
import {
    normalizeTrimmedString,
} from '../payload-sanitizer.js';
import type { EconomyLeaderboardPage } from '../../economy/types.js';
import { createLogger } from '../../utils/logger.js';
import {
    getStoredLeaderboardProfile,
    pruneStoredLeaderboardProfiles,
    upsertStoredLeaderboardProfile,
} from '../leaderboard-profile-cache-store.js';



const apiLogger = createLogger('dashboard:api');

const LEADERBOARD_PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const LEADERBOARD_PROFILE_FAILURE_CACHE_TTL_MS = 30 * 1000;
const LEADERBOARD_PROFILE_STALE_GRACE_MS = 60 * 60 * 1000;
const LEADERBOARD_PROFILE_PERSISTED_TTL_MS = 24 * 60 * 60 * 1000;
const LEADERBOARD_PROFILE_STORE_PRUNE_INTERVAL_MS = 30 * 60 * 1000;
const LEADERBOARD_PROFILE_CACHE_MAX_ENTRIES = 1500;
const LEADERBOARD_PROFILE_CONCURRENCY_LIMIT = 2;
const LEADERBOARD_PROFILE_LOOKUP_TIMEOUT_MS = 3_000;
const LEADERBOARD_PROFILE_FALLBACK_LOOKUP_TIMEOUT_MS = 1_000;
const LEADERBOARD_PROFILE_RATE_LIMIT_MIN_BACKOFF_MS = 2 * 60 * 1000;
interface LeaderboardProfileCacheEntry {
    displayName: string;
    avatarUrl: string | null;
    expiresAt: number;
}
const leaderboardProfileCache = new Map<string, LeaderboardProfileCacheEntry>();
const leaderboardProfileInFlight = new Map<string, Promise<{ displayName: string; avatarUrl: string | null }>>();
let leaderboardProfileStoreLastPruneAtMs = 0;
function getLeaderboardProfileCacheKey(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
}
function cleanupLeaderboardProfileCache(now: number): void {
    for (const [cacheKey, cacheEntry] of leaderboardProfileCache.entries()) {
        if (cacheEntry.expiresAt + LEADERBOARD_PROFILE_STALE_GRACE_MS <= now) {
            leaderboardProfileCache.delete(cacheKey);
        }
    }

    if (leaderboardProfileCache.size <= LEADERBOARD_PROFILE_CACHE_MAX_ENTRIES) {
        return;
    }

    const overflowEntries = [...leaderboardProfileCache.entries()]
        .sort((left, right) => left[1].expiresAt - right[1].expiresAt)
        .slice(0, leaderboardProfileCache.size - LEADERBOARD_PROFILE_CACHE_MAX_ENTRIES);

    for (const [cacheKey] of overflowEntries) {
        leaderboardProfileCache.delete(cacheKey);
    }
}
function getLeaderboardProfileRateLimitBackoffMs(error: unknown): number | null {
    if (error instanceof DiscordRateLimitedError) {
        return Math.max(
            LEADERBOARD_PROFILE_RATE_LIMIT_MIN_BACKOFF_MS,
            Math.ceil(error.retryAfterSeconds * 1000),
        );
    }

    if (!(error instanceof Error)) {
        return null;
    }

    const guildMemberStatusMatch = /failed to fetch guild member:\s*(\d{3})/i.exec(error.message);
    if (!guildMemberStatusMatch) {
        return null;
    }

    const statusCode = Number.parseInt(guildMemberStatusMatch[1] ?? '', 10);
    if (!Number.isFinite(statusCode) || statusCode !== 429) {
        return null;
    }

    return LEADERBOARD_PROFILE_RATE_LIMIT_MIN_BACKOFF_MS;
}
export function resolveDiscordAvatarUrl(userId: string, avatarHash: string | null | undefined): string | null {
    const safeAvatarHash = normalizeTrimmedString(avatarHash);
    if (!safeAvatarHash) {
        return null;
    }

    return `https://cdn.discordapp.com/avatars/${encodeURIComponent(userId)}/${encodeURIComponent(safeAvatarHash)}.png?size=64`;
}
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(timeoutMessage));
        }, timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}
function resolveLeaderboardDisplayName(member: Awaited<ReturnType<typeof getGuildMember>>, userId: string): string {
    const fallbackName = `Uzytkownik ${userId}`;

    if (!member) {
        return fallbackName;
    }

    const normalizedNick = normalizeTrimmedString(member.nick);
    if (normalizedNick) {
        return normalizedNick;
    }

    const normalizedGlobalName = normalizeTrimmedString(member.user?.global_name);
    if (normalizedGlobalName) {
        return normalizedGlobalName;
    }

    const normalizedUsername = normalizeTrimmedString(member.user?.username);
    if (normalizedUsername) {
        return normalizedUsername;
    }

    return fallbackName;
}
function resolveLeaderboardDisplayNameFromUser(user: Awaited<ReturnType<typeof getDiscordUserById>>, userId: string): string {
    const fallbackName = `Uzytkownik ${userId}`;

    if (!user) {
        return fallbackName;
    }

    const normalizedGlobalName = normalizeTrimmedString(user.global_name);
    if (normalizedGlobalName) {
        return normalizedGlobalName;
    }

    const normalizedUsername = normalizeTrimmedString(user.username);
    if (normalizedUsername) {
        return normalizedUsername;
    }

    return fallbackName;
}
async function resolveFallbackDiscordUserProfile(userId: string): Promise<{ displayName: string; avatarUrl: string | null } | null> {
    const fallbackUser = await withTimeout(
        getDiscordUserById(userId),
        LEADERBOARD_PROFILE_FALLBACK_LOOKUP_TIMEOUT_MS,
        `Timeout while loading fallback leaderboard profile for user ${userId}`,
    );

    if (!fallbackUser) {
        return null;
    }

    return {
        displayName: resolveLeaderboardDisplayNameFromUser(fallbackUser, userId),
        avatarUrl: resolveDiscordAvatarUrl(fallbackUser.id, fallbackUser.avatar),
    };
}
function shouldSkipLeaderboardGlobalFallback(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const errorMessage = error.message.toLowerCase();
    if (errorMessage.includes('timeout while loading leaderboard profile')) {
        return true;
    }

    const guildMemberStatusMatch = /failed to fetch guild member:\s*(\d{3})/.exec(errorMessage);
    if (!guildMemberStatusMatch) {
        return false;
    }

    const parsedStatus = Number.parseInt(guildMemberStatusMatch[1] ?? '', 10);
    if (!Number.isFinite(parsedStatus)) {
        return false;
    }

    return parsedStatus === 429 || parsedStatus >= 500;
}
function persistLeaderboardProfileToStore(
    guildId: string,
    userId: string,
    profile: { displayName: string; avatarUrl: string | null },
): void {
    const expiresAt = Date.now() + LEADERBOARD_PROFILE_PERSISTED_TTL_MS;

    void upsertStoredLeaderboardProfile({
        guildId,
        userId,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        expiresAt,
    }).catch((error) => {
        apiLogger.debug('LEADERBOARD_PROFILE_STORE_UPSERT_FAILED', 'Nie udalo sie zapisac profilu leaderboardu do trwałego cache SQLite.', {
            guildId,
            userId,
            errorMessage: error instanceof Error ? error.message : String(error),
        });
    });
}
function pruneLeaderboardProfileStoreIfNeeded(now: number): void {
    if (now - leaderboardProfileStoreLastPruneAtMs < LEADERBOARD_PROFILE_STORE_PRUNE_INTERVAL_MS) {
        return;
    }

    leaderboardProfileStoreLastPruneAtMs = now;
    const staleThreshold = now - LEADERBOARD_PROFILE_STALE_GRACE_MS;

    void pruneStoredLeaderboardProfiles(staleThreshold).catch((error) => {
        apiLogger.debug('LEADERBOARD_PROFILE_STORE_PRUNE_FAILED', 'Nie udalo sie wyczyscic starych wpisow cache profili leaderboardu.', {
            staleThreshold,
            errorMessage: error instanceof Error ? error.message : String(error),
        });
    });
}
async function resolveLeaderboardProfile(guildId: string, userId: string): Promise<{ displayName: string; avatarUrl: string | null }> {
    const cacheKey = getLeaderboardProfileCacheKey(guildId, userId);
    const now = Date.now();
    const cachedEntry = leaderboardProfileCache.get(cacheKey);
    let staleCachedProfile = cachedEntry
        ? {
            displayName: cachedEntry.displayName,
            avatarUrl: cachedEntry.avatarUrl,
        }
        : null;

    if (cachedEntry && cachedEntry.expiresAt > now) {
        return {
            displayName: cachedEntry.displayName,
            avatarUrl: cachedEntry.avatarUrl,
        };
    }

    const fallbackProfile = {
        displayName: `Uzytkownik ${userId}`,
        avatarUrl: null,
    };

    const inflight = leaderboardProfileInFlight.get(cacheKey);
    if (inflight) {
        return inflight;
    }
    const resolutionPromise = (async () => {
        const resolveFallbackProfileSafe = async (): Promise<{ displayName: string; avatarUrl: string | null } | null> => {
            try {
                return await resolveFallbackDiscordUserProfile(userId);
            } catch (fallbackError) {
                apiLogger.debug('LEADERBOARD_PROFILE_FALLBACK_RESOLVE_FAILED', 'Nie udalo sie pobrac fallback profilu z endpointu globalnego Discord.', {
                    guildId,
                    userId,
                    errorMessage: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
                });
                return null;
            }
        };

        try {
            try {
                const storedProfile = await getStoredLeaderboardProfile(guildId, userId);
                if (storedProfile) {
                    const normalizedStoredProfile = {
                        displayName: storedProfile.displayName,
                        avatarUrl: storedProfile.avatarUrl,
                    };

                    if (storedProfile.expiresAt > now) {
                        leaderboardProfileCache.set(cacheKey, {
                            ...normalizedStoredProfile,
                            expiresAt: storedProfile.expiresAt,
                        });

                        return normalizedStoredProfile;
                    }

                    if (!staleCachedProfile) {
                        staleCachedProfile = normalizedStoredProfile;
                    }
                }
            } catch (error) {
                apiLogger.debug('LEADERBOARD_PROFILE_STORE_READ_FAILED', 'Nie udalo sie odczytac profilu leaderboardu z trwałego cache SQLite.', {
                    guildId,
                    userId,
                    errorMessage: error instanceof Error ? error.message : String(error),
                });
            }

            const member = await withTimeout(
                getGuildMember(userId, guildId),
                LEADERBOARD_PROFILE_LOOKUP_TIMEOUT_MS,
                `Timeout while loading leaderboard profile for user ${userId}`,
            );

            if (member) {
                const resolvedProfile = {
                    displayName: resolveLeaderboardDisplayName(member, userId),
                    avatarUrl: resolveDiscordAvatarUrl(member.user?.id ?? userId, member.user?.avatar),
                };

                leaderboardProfileCache.set(cacheKey, {
                    ...resolvedProfile,
                    expiresAt: Date.now() + LEADERBOARD_PROFILE_CACHE_TTL_MS,
                });
                persistLeaderboardProfileToStore(guildId, userId, resolvedProfile);

                return resolvedProfile;
            }

            const resolvedFallbackProfile = await resolveFallbackProfileSafe();
            if (resolvedFallbackProfile) {
                leaderboardProfileCache.set(cacheKey, {
                    ...resolvedFallbackProfile,
                    expiresAt: Date.now() + LEADERBOARD_PROFILE_CACHE_TTL_MS,
                });
                persistLeaderboardProfileToStore(guildId, userId, resolvedFallbackProfile);

                return resolvedFallbackProfile;
            }

            leaderboardProfileCache.set(cacheKey, {
                ...fallbackProfile,
                expiresAt: Date.now() + LEADERBOARD_PROFILE_FAILURE_CACHE_TTL_MS,
            });

            return fallbackProfile;
        } catch (error) {
            const rateLimitBackoffMs = getLeaderboardProfileRateLimitBackoffMs(error);
            if (rateLimitBackoffMs !== null) {
                const rateLimitedUntil = Date.now() + rateLimitBackoffMs;
                const profileDuringBackoff = staleCachedProfile ?? fallbackProfile;

                leaderboardProfileCache.set(cacheKey, {
                    ...profileDuringBackoff,
                    expiresAt: rateLimitedUntil,
                });

                apiLogger.debug('LEADERBOARD_PROFILE_RATE_LIMITED', 'Discord rate limit dla lookupu czlonka leaderboardu; aktywowany backoff.', {
                    guildId,
                    userId,
                    retryAfterMs: rateLimitBackoffMs,
                    usingStaleCache: Boolean(staleCachedProfile),
                });

                return profileDuringBackoff;
            }

            apiLogger.warn('LEADERBOARD_PROFILE_RESOLVE_FAILED', 'Nie udalo sie pobrac profilu leaderboardu z endpointu guild member.', {
                guildId,
                userId,
            }, error);

            const shouldSkipFallback = shouldSkipLeaderboardGlobalFallback(error);
            const resolvedFallbackProfile = shouldSkipFallback
                ? null
                : await resolveFallbackProfileSafe();
            if (resolvedFallbackProfile) {
                leaderboardProfileCache.set(cacheKey, {
                    ...resolvedFallbackProfile,
                    expiresAt: Date.now() + LEADERBOARD_PROFILE_FAILURE_CACHE_TTL_MS,
                });
                persistLeaderboardProfileToStore(guildId, userId, resolvedFallbackProfile);

                return resolvedFallbackProfile;
            }

            leaderboardProfileCache.set(cacheKey, {
                ...fallbackProfile,
                expiresAt: Date.now() + LEADERBOARD_PROFILE_FAILURE_CACHE_TTL_MS,
            });

            return fallbackProfile;
        } finally {
            leaderboardProfileInFlight.delete(cacheKey);
        }
    })();

    leaderboardProfileInFlight.set(cacheKey, resolutionPromise);

    return resolutionPromise;
}
export async function resolveLeaderboardProfilesWithLimit(
    guildId: string,
    userIds: string[],
): Promise<Array<readonly [string, { displayName: string; avatarUrl: string | null }]>> {
    const now = Date.now();
    cleanupLeaderboardProfileCache(now);
    pruneLeaderboardProfileStoreIfNeeded(now);

    const limitedConcurrency = Math.max(1, LEADERBOARD_PROFILE_CONCURRENCY_LIMIT);
    const pairs: Array<readonly [string, { displayName: string; avatarUrl: string | null }]> = [];

    for (let index = 0; index < userIds.length; index += limitedConcurrency) {
        const chunk = userIds.slice(index, index + limitedConcurrency);
        const chunkPairs = await Promise.all(chunk.map(async (userId) => {
            const profile = await resolveLeaderboardProfile(guildId, userId);
            return [userId, profile] as const;
        }));

        pairs.push(...chunkPairs);
    }

    return pairs;
}
export async function enrichEconomyLeaderboard(
    guildId: string,
    leaderboard: EconomyLeaderboardPage,
): Promise<EconomyLeaderboardPage> {
    const uniqueUserIds = [...new Set(
        leaderboard.entries
            .map((entry) => normalizeTrimmedString(entry.userId))
            .filter((userId) => userId.length > 0),
    )];
    const profilePairs = await resolveLeaderboardProfilesWithLimit(guildId, uniqueUserIds);

    const profileByUserId = new Map(profilePairs);
    const enrichedEntries = leaderboard.entries.map((entry) => {
        const normalizedUserId = normalizeTrimmedString(entry.userId) || String(entry.userId ?? '');
        const profile = profileByUserId.get(normalizedUserId);

        return {
            ...entry,
            userId: normalizedUserId,
            displayName: profile?.displayName ?? `Uzytkownik ${normalizedUserId}`,
            avatarUrl: profile?.avatarUrl ?? null,
        };
    });

    return {
        ...leaderboard,
        entries: enrichedEntries,
    };
}