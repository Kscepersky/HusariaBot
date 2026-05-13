import { Router, type NextFunction, type Request, type Response } from 'express';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { requireAuth } from '../middleware/require-auth.js';
import {
    createExternalGuildScheduledEvent,
    deleteGuildScheduledEvent,
    getGuildTextChannels,
    getGuildRoles,
    getGuildEmojis,
    getGuildMember,
    getDiscordUserById,
    addGuildMemberRole,
    removeGuildMemberRole,
    updateGuildMemberRoles,
    listGuildScheduledEvents,
    hasDevRole,
    hasRequiredRole,
    searchGuildMembers,
    listImages,
    sendImageToChannel,
    sendDirectMessage,
    updateGuildScheduledEvent,
    getGuildAllChannels,
    DiscordRateLimitedError,
    type DiscordScheduledEvent,
} from '../discord-api.js';
import {
    validateEmbedForm,
    type EmbedFormData,
    type EventDraftFormData,
    type MatchInfoSnapshot,
    type WatchpartyDraftFormData,
} from '../embed-handlers.js';
import {
    dashboardEventSchema,
    economyCsvImportSchema,
    economyConfigSchema,
    economyLevelRoleMappingsSchema,
    economyUserMutationSchema,
    embedPayloadSchema,
    imageLibraryRenameSchema,
    imageLibraryUploadSchema,
    sendImageSchema,
    timeoutCreateSchema,
    timeoutRemoveSchema,
    zodErrorToMessage,
} from '../validation/request-schemas.js';
import { publishDashboardPost } from '../publish-flow.js';
import { tryCreateDiscordEventFromPayload } from '../event-publisher.js';
import { registerWatchpartyLifecycle } from '../watchparty-lifecycle.js';
import { deleteWatchpartyChannel, tryCreateWatchpartyChannelFromPayload } from '../watchparty-publisher.js';
import { insertScheduledPost, updateScheduledPost } from '../scheduler/store.js';
import { parseWarsawDateTimeToTimestamp } from '../scheduler/warsaw-time.js';
import type { ScheduledPost } from '../scheduler/types.js';
import {
    EconomyCsvImportValidationError,
    EconomyInputValidationError,
    addCoinsByAdmin,
    addLevelsByAdmin,
    addXpByAdmin,
    createEconomyTimeout,
    getActiveEconomyTimeoutForUser,
    getEconomyConfig,
    getEconomyLeaderboardPage,
    getEconomyLevelRoleMappings,
    getEconomyTimeoutById,
    importEconomyCsvSnapshot,
    listActiveEconomyTimeouts,
    releaseEconomyTimeout,
    replaceEconomyLevelRoleMappings,
    resetEconomyUsers,
    updateEconomyConfig,
} from '../../economy/repository.js';
import type { EconomyLeaderboardPage, EconomyLeaderboardSortBy } from '../../economy/types.js';
import {
    getServerStatsByDateRange,
    getServerStatsDailyTimeSeries,
    getServerStatsTopUsers,
    getStatsExcludedChannelIds,
    setStatsExcludedChannelIds,
    getMessageSummary,
    getMessageTimeSeries,
    getTopMessageUsers,
    getTopMessageChannels,
    getVoiceSummary,
    getVoiceTimeSeries,
    getTopVoiceUsers,
    getTopVoiceChannels,
    getMemberTimeSeries,
    getMemberSummary,
    getActiveUsersInPeriod,
    getAllUserStatsForExport,
    getAllChannelStatsForExport,
    getAllMemberCountsForExport,
    resetAllStats,
} from '../../economy/stats-store.js';
import archiver from 'archiver';
import { parseTimeoutDurationParts } from '../../timeouts/duration.js';
import { clearTicketHistory, listTicketHistoryEntries, resolveTicketTranscriptFilePath } from '../../tickets/history-store.js';
import { createLogger } from '../../utils/logger.js';
import { listDashboardLogs } from '../../utils/log-reader.js';
import { enrichWithDiscordUser } from '../../utils/discord-user-cache.js';
import { listSessionActivity } from '../session/session-events.js';
import type { SessionUser } from '../types.js';
import {
    getStoredLeaderboardProfile,
    pruneStoredLeaderboardProfiles,
    upsertStoredLeaderboardProfile,
} from '../leaderboard-profile-cache-store.js';

config();

export const apiRouter = Router();

function buildActorContext(user: SessionUser | undefined): { actorUserId?: string; actorUserName?: string; actorUserRole?: string } {
    if (!user) return {};
    return {
        actorUserId: user.id,
        actorUserName: user.globalName ?? user.username,
        actorUserRole: user.dashboardRole,
    };
}

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
const IMAGE_LIBRARY_PAGE_SIZE_DEFAULT = 8;
const IMAGE_LIBRARY_PAGE_SIZE_MAX = 64;
const IMAGE_LIBRARY_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const TICKET_HISTORY_PAGE_SIZE_DEFAULT = 20;
const TICKET_HISTORY_PAGE_SIZE_MAX = 100;
const apiLogger = createLogger('dashboard:api');

const IMAGE_LIBRARY_ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const IMAGE_LIBRARY_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
};

class ImageLibraryValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ImageLibraryValidationError';
    }
}

interface LeaderboardProfileCacheEntry {
    displayName: string;
    avatarUrl: string | null;
    expiresAt: number;
}

const leaderboardProfileCache = new Map<string, LeaderboardProfileCacheEntry>();
const leaderboardProfileInFlight = new Map<string, Promise<{ displayName: string; avatarUrl: string | null }>>();
let leaderboardProfileStoreLastPruneAtMs = 0;

function isClientValidationError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    if (error instanceof ImageLibraryValidationError) {
        return true;
    }

    return [
        'nie istnieje',
        'nieobslugiwany format',
        'nieobsługiwany format',
        'nieprawidlowy format',
        'nieprawidłowy format',
        'za duzy',
        'za duży',
        'zawartosc pliku nie zgadza sie',
        'zawartość pliku nie zgadza się',
        'niedozwolone',
    ].some((messagePart) => error.message.toLowerCase().includes(messagePart));
}

function normalizeTrimmedString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function parsePositiveIntQuery(value: unknown, fallback: number): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }

    return parsed;
}

function formatDiscordTimestamp(valueMs: number): string {
    const timestamp = Math.floor(valueMs / 1000);
    return `<t:${timestamp}:F> (<t:${timestamp}:R>)`;
}

function resolveMuteNotificationGuildName(): string {
    const fromEnv = normalizeTrimmedString(process.env.MUTE_DM_GUILD_NAME);
    if (fromEnv.length > 0) {
        return fromEnv;
    }

    return 'G2 Hussars';
}

function formatMuteDmMessage(guildName: string, expiresAtMs: number, adminUserId: string, reason: string): string {
    return `Zostales zmutowany na serwerze **${guildName}** do **${formatDiscordTimestamp(expiresAtMs)}** przez **<@${adminUserId}>** z powodu: **${reason}**`;
}

function resolveImageLibraryDirectoryPath(): string {
    return join(__dirname, '..', '..', '..', 'img');
}

function normalizeUploadMimeType(rawMimeType: string): string {
    const normalized = rawMimeType.trim().toLowerCase();
    return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

function resolveSafeImageFilename(rawValue: string): string | null {
    const normalized = rawValue.trim();
    if (!normalized || normalized === '.' || normalized === '..' || normalized.length > 255) {
        return null;
    }

    if (/[\\/]/.test(normalized)) {
        return null;
    }

    if (/[<>:"|?*\x00-\x1F]/.test(normalized)) {
        return null;
    }

    return normalized;
}

function resolveImageLibraryExtension(filename: string): string {
    return extname(filename).toLowerCase();
}

function parseUploadData(uploadBase64: string): Buffer | null {
    const trimmed = uploadBase64.trim();
    const dataUrlMatch = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(trimmed);

    let base64Data = trimmed;
    if (dataUrlMatch) {
        base64Data = dataUrlMatch[2] ?? '';
    }

    const normalized = base64Data.replace(/\s+/g, '');
    if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+=*$/.test(normalized)) {
        return null;
    }

    return Buffer.from(normalized, 'base64');
}

function detectImageMime(buffer: Buffer): string | null {
    if (
        buffer.length >= 8
        && buffer[0] === 0x89
        && buffer[1] === 0x50
        && buffer[2] === 0x4e
        && buffer[3] === 0x47
        && buffer[4] === 0x0d
        && buffer[5] === 0x0a
        && buffer[6] === 0x1a
        && buffer[7] === 0x0a
    ) {
        return 'image/png';
    }

    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'image/jpeg';
    }

    if (buffer.length >= 6) {
        const gifHeader = buffer.toString('ascii', 0, 6);
        if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
            return 'image/gif';
        }
    }

    if (buffer.length >= 12) {
        const riffHeader = buffer.toString('ascii', 0, 4);
        const webpHeader = buffer.toString('ascii', 8, 12);
        if (riffHeader === 'RIFF' && webpHeader === 'WEBP') {
            return 'image/webp';
        }
    }

    const svgProbe = buffer.toString('utf8', 0, Math.min(buffer.length, 4096)).trimStart();
    if (svgProbe.startsWith('<?xml') || svgProbe.startsWith('<svg') || svgProbe.includes('<svg')) {
        return 'image/svg+xml';
    }

    return null;
}

function validateSvgSafety(buffer: Buffer): void {
    const svgContent = buffer.toString('utf8');
    if (/<script[\s>]/i.test(svgContent) || /\son[a-z]+\s*=\s*/i.test(svgContent)) {
        throw new ImageLibraryValidationError('Plik SVG zawiera niedozwolone skrypty.');
    }

    if (/xlink:href\s*=\s*['"]\s*javascript:/i.test(svgContent)) {
        throw new ImageLibraryValidationError('Plik SVG zawiera niedozwolone odwolania JavaScript.');
    }
}

function listImageLibraryEntries(searchQuery: string, sortBy: ImageLibrarySortBy): ImageLibraryEntry[] {
    const imageDirectoryPath = resolveImageLibraryDirectoryPath();
    if (!existsSync(imageDirectoryPath)) {
        return [];
    }

    const normalizedSearch = searchQuery.trim().toLowerCase();

    const entries = readdirSync(imageDirectoryPath, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
            const extension = resolveImageLibraryExtension(entry.name);
            if (!IMAGE_LIBRARY_ALLOWED_EXTENSIONS.has(extension)) {
                return null;
            }

            if (normalizedSearch && !entry.name.toLowerCase().includes(normalizedSearch)) {
                return null;
            }

            const stats = statSync(join(imageDirectoryPath, entry.name));
            return {
                name: entry.name,
                sizeBytes: stats.size,
                modifiedAt: stats.mtimeMs,
                mimeType: IMAGE_LIBRARY_MIME_BY_EXTENSION[extension] ?? 'application/octet-stream',
            } satisfies ImageLibraryEntry;
        })
        .filter((entry): entry is ImageLibraryEntry => entry !== null);

    if (sortBy === 'name_asc') {
        return entries.sort((left, right) => left.name.localeCompare(right.name, 'pl', { sensitivity: 'base' }));
    }

    return entries.sort((left, right) => {
        if (left.modifiedAt !== right.modifiedAt) {
            return right.modifiedAt - left.modifiedAt;
        }

        return left.name.localeCompare(right.name, 'pl', { sensitivity: 'base' });
    });
}

interface EconomyCsvImportedUserRow {
    userId: string;
    level: number;
}

interface EconomyImportRoleSyncStats {
    attemptedUsers: number;
    updatedUsers: number;
    skippedUsers: number;
    failedUsers: number;
}

interface ImageLibraryEntry {
    name: string;
    sizeBytes: number;
    modifiedAt: number;
    mimeType: string;
}

type ImageLibrarySortBy = 'newest' | 'name_asc';

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

function resolveServerMuteRoleId(): string | null {
    const roleId = String(process.env.SERVER_MUTE_ROLE_ID ?? '').trim();
    if (!/^\d{17,20}$/.test(roleId)) {
        return null;
    }

    return roleId;
}

function parseEconomyImportUserRows(csvContent: string): EconomyCsvImportedUserRow[] {
    const rows = csvContent
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const seenUserIds = new Set<string>();
    const parsedRows: EconomyCsvImportedUserRow[] = [];

    for (const row of rows) {
        const columns = row.split(',').map((column) => column.trim());
        if (columns.length !== 5) {
            continue;
        }

        const userId = columns[0] ?? '';
        const parsedLevel = Number.parseInt(columns[1] ?? '', 10);

        if (!/^\d{17,20}$/.test(userId)) {
            continue;
        }

        if (!Number.isFinite(parsedLevel) || parsedLevel < 1) {
            continue;
        }

        if (seenUserIds.has(userId)) {
            continue;
        }

        seenUserIds.add(userId);
        parsedRows.push({
            userId,
            level: parsedLevel,
        });
    }

    return parsedRows;
}

function resolveTargetRoleIdForLevel(
    level: number,
    mappings: Awaited<ReturnType<typeof getEconomyLevelRoleMappings>>,
): string | null {
    const sortedMappings = [...mappings].sort((left, right) => {
        if (left.minLevel !== right.minLevel) {
            return right.minLevel - left.minLevel;
        }

        return String(left.roleId).localeCompare(String(right.roleId), 'pl');
    });

    const matchingRole = sortedMappings.find((mapping) => mapping.minLevel <= level);
    return matchingRole ? String(matchingRole.roleId) : null;
}

function hasSameRoles(currentRoles: string[], nextRoles: string[]): boolean {
    if (currentRoles.length !== nextRoles.length) {
        return false;
    }

    const currentRoleSet = new Set(currentRoles);
    return nextRoles.every((roleId) => currentRoleSet.has(roleId));
}

async function syncLevelRolesAfterCsvImport(guildId: string, csvContent: string): Promise<EconomyImportRoleSyncStats> {
    const mappings = await getEconomyLevelRoleMappings(guildId);
    const protectedRoleIds = resolveProtectedStaffRoleIds();
    const automationSafeMappings = mappings.filter((mapping) => !protectedRoleIds.has(String(mapping.roleId)));
    const importedUsers = parseEconomyImportUserRows(csvContent);

    if (!Array.isArray(automationSafeMappings) || automationSafeMappings.length === 0 || importedUsers.length === 0) {
        return {
            attemptedUsers: importedUsers.length,
            updatedUsers: 0,
            skippedUsers: importedUsers.length,
            failedUsers: 0,
        };
    }

    const mappedRoleIds = new Set(automationSafeMappings.map((mapping) => String(mapping.roleId)));
    let updatedUsers = 0;
    let skippedUsers = 0;
    let failedUsers = 0;

    for (const importedUser of importedUsers) {
        try {
            const member = await getGuildMember(importedUser.userId, guildId);
            if (!member || !Array.isArray(member.roles)) {
                skippedUsers += 1;
                continue;
            }

            const currentRoles = member.roles
                .map((roleId) => String(roleId).trim())
                .filter((roleId) => /^\d{17,20}$/.test(roleId));
            const targetRoleId = resolveTargetRoleIdForLevel(importedUser.level, automationSafeMappings);
            const rolesWithoutMapped = currentRoles.filter((roleId) => !mappedRoleIds.has(roleId));
            const nextRoles = targetRoleId
                ? [...new Set([...rolesWithoutMapped, targetRoleId])]
                : [...new Set(rolesWithoutMapped)];

            if (hasSameRoles(currentRoles, nextRoles)) {
                skippedUsers += 1;
                continue;
            }

            const outcome = await updateGuildMemberRoles(guildId, importedUser.userId, nextRoles);
            if (outcome === 'not_found') {
                skippedUsers += 1;
                continue;
            }

            updatedUsers += 1;
        } catch (error) {
            failedUsers += 1;
            apiLogger.warn('LEVEL_ROLE_SYNC_USER_FAILED', 'Failed to sync imported economy role mapping for user.', {
                guildId,
                userId: importedUser.userId,
            }, error);
        }
    }

    return {
        attemptedUsers: importedUsers.length,
        updatedUsers,
        skippedUsers,
        failedUsers,
    };
}

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

function resolveDiscordAvatarUrl(userId: string, avatarHash: string | null | undefined): string | null {
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

async function resolveLeaderboardProfilesWithLimit(
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

async function enrichEconomyLeaderboard(
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

async function requireCurrentDashboardRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    const userId = req.session.user?.id;
    if (!userId) {
        res.status(401).json({ error: 'Brak autoryzacji.' });
        return;
    }

    try {
        const member = await getGuildMember(userId, guildId);
        if (!member || !hasRequiredRole(member)) {
            res.status(403).json({ error: 'Brak uprawnień do wykonania tej operacji.' });
            return;
        }

        next();
    } catch (error) {
        apiLogger.error('DASHBOARD_ROLE_VERIFY_FAILED', 'Failed to verify dashboard role.', { userId }, error);
        res.status(502).json({ error: 'Nie udało się zweryfikować uprawnień użytkownika.' });
    }
}

async function requireCurrentDashboardDevRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    const userId = req.session.user?.id;
    if (!userId) {
        res.status(401).json({ error: 'Brak autoryzacji.' });
        return;
    }

    try {
        const member = await getGuildMember(userId, guildId);
        if (!member || !hasDevRole(member)) {
            res.status(403).json({ error: 'Brak uprawnień do wykonania tej operacji.' });
            return;
        }

        next();
    } catch (error) {
        apiLogger.error('DASHBOARD_DEV_ROLE_VERIFY_FAILED', 'Failed to verify dashboard dev role.', { userId }, error);
        res.status(502).json({ error: 'Nie udało się zweryfikować uprawnień użytkownika.' });
    }
}

function normalizeBoolean(value: unknown): boolean {
    return value === true || value === 'true';
}

function sanitizeMatchInfo(input: unknown): MatchInfoSnapshot | undefined {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return undefined;
    }

    const raw = input as Partial<MatchInfoSnapshot>;
    const matchId = normalizeTrimmedString(raw.matchId);

    if (!matchId) {
        return undefined;
    }

    return {
        matchId,
        game: normalizeTrimmedString(raw.game),
        g2TeamName: normalizeTrimmedString(raw.g2TeamName),
        opponent: normalizeTrimmedString(raw.opponent),
        tournament: normalizeTrimmedString(raw.tournament),
        matchType: normalizeTrimmedString(raw.matchType),
        beginAtUtc: normalizeTrimmedString(raw.beginAtUtc),
        date: normalizeTrimmedString(raw.date),
        time: normalizeTrimmedString(raw.time),
    };
}

function sanitizeEventDraft(input: unknown): EventDraftFormData | undefined {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return undefined;
    }

    const raw = input as Partial<EventDraftFormData>;

    return {
        enabled: normalizeBoolean(raw.enabled),
        title: normalizeTrimmedString(raw.title),
        description: normalizeTrimmedString(raw.description),
        location: normalizeTrimmedString(raw.location),
        startAtLocal: normalizeTrimmedString(raw.startAtLocal),
        endAtLocal: normalizeTrimmedString(raw.endAtLocal),
    };
}

function sanitizeWatchpartyDraft(input: unknown): WatchpartyDraftFormData | undefined {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return undefined;
    }

    const raw = input as Partial<WatchpartyDraftFormData>;

    return {
        enabled: normalizeBoolean(raw.enabled),
        channelName: normalizeTrimmedString(raw.channelName),
        startAtLocal: normalizeTrimmedString(raw.startAtLocal),
        endAtLocal: normalizeTrimmedString(raw.endAtLocal),
    };
}

function sanitizeEmbedPayload(rawBody: unknown): EmbedFormData {
    const body = (rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody))
        ? rawBody as Record<string, unknown>
        : {};

    const mentionRoleEnabled = normalizeBoolean(body.mentionRoleEnabled);

    return {
        mode: normalizeTrimmedString(body.mode) as EmbedFormData['mode'],
        channelId: normalizeTrimmedString(body.channelId),
        title: normalizeTrimmedString(body.title),
        content: normalizeTrimmedString(body.content),
        colorName: normalizeTrimmedString(body.colorName),
        mentionRoleEnabled,
        mentionRoleId: mentionRoleEnabled ? normalizeTrimmedString(body.mentionRoleId) : '',
        imageMode: normalizeTrimmedString(body.imageMode) as EmbedFormData['imageMode'],
        imageFilename: normalizeTrimmedString(body.imageFilename),
        uploadFileName: normalizeTrimmedString(body.uploadFileName),
        uploadMimeType: normalizeTrimmedString(body.uploadMimeType),
        uploadBase64: normalizeTrimmedString(body.uploadBase64),
        matchInfo: sanitizeMatchInfo(body.matchInfo),
        eventDraft: sanitizeEventDraft(body.eventDraft),
        watchpartyDraft: sanitizeWatchpartyDraft(body.watchpartyDraft),
    };
}

interface DashboardEventFormData {
    title: string;
    description: string;
    location: string;
    startAtLocal: string;
    endAtLocal: string;
}

class EventValidationError extends Error {}

const DISCORD_EVENT_TITLE_MAX_LENGTH = 100;
const DISCORD_EVENT_DESCRIPTION_MAX_LENGTH = 1000;
const DISCORD_EVENT_LOCATION_MAX_LENGTH = 100;

function sanitizeEventForm(rawBody: unknown): DashboardEventFormData {
    const body = (rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody))
        ? rawBody as Record<string, unknown>
        : {};

    return {
        title: normalizeTrimmedString(body.title),
        description: normalizeTrimmedString(body.description),
        location: normalizeTrimmedString(body.location),
        startAtLocal: normalizeTrimmedString(body.startAtLocal),
        endAtLocal: normalizeTrimmedString(body.endAtLocal),
    };
}

function mapDiscordEventToDashboardEvent(event: DiscordScheduledEvent): Record<string, unknown> {
    return {
        id: event.id,
        name: event.name,
        description: event.description ?? '',
        location: event.entity_metadata?.location ?? 'Online',
        status: event.status,
        scheduledStartTimeIso: event.scheduled_start_time,
        scheduledEndTimeIso: event.scheduled_end_time ?? null,
    };
}

function isDiscordEventOperationError(error: unknown): boolean {
    return error instanceof Error && (
        error.message.startsWith('Failed to create Discord event:')
        || error.message.startsWith('Failed to list Discord events:')
        || error.message.startsWith('Failed to update Discord event:')
        || error.message.startsWith('Failed to delete Discord event:')
    );
}

function handleDashboardEventMutationError(
    res: Response,
    error: unknown,
    operation: 'create' | 'update' | 'delete',
): void {
    if (error instanceof EventValidationError) {
        res.status(400).json({ error: error.message });
        return;
    }

    if (isDiscordEventOperationError(error)) {
        apiLogger.error('DISCORD_EVENT_OP_UPSTREAM_FAILED', `Failed to ${operation} Discord event (upstream).`, { operation }, error);
        res.status(502).json({ error: `Nie udało się ${operation === 'create' ? 'utworzyć' : (operation === 'update' ? 'zaktualizować' : 'usunąć')} wydarzenia Discord (błąd usługi zewnętrznej).` });
        return;
    }

    apiLogger.error('DISCORD_EVENT_OP_FAILED', `Failed to ${operation} Discord event.`, { operation }, error);
    res.status(500).json({ error: `Nie udało się ${operation === 'create' ? 'utworzyć' : (operation === 'update' ? 'zaktualizować' : 'usunąć')} wydarzenia Discord.` });
}

function validateAndResolveEventForm(form: DashboardEventFormData): {
    startAtIso: string;
    endAtIso: string;
} {
    if (!form.title) {
        throw new EventValidationError('Tytuł wydarzenia jest wymagany.');
    }

    if (form.title.length > DISCORD_EVENT_TITLE_MAX_LENGTH) {
        throw new EventValidationError(`Tytuł wydarzenia może mieć maksymalnie ${DISCORD_EVENT_TITLE_MAX_LENGTH} znaków.`);
    }

    if (!form.description) {
        throw new EventValidationError('Opis wydarzenia jest wymagany.');
    }

    if (form.description.length > DISCORD_EVENT_DESCRIPTION_MAX_LENGTH) {
        throw new EventValidationError(`Opis wydarzenia może mieć maksymalnie ${DISCORD_EVENT_DESCRIPTION_MAX_LENGTH} znaków.`);
    }

    if (!form.location) {
        throw new EventValidationError('Miejsce wydarzenia jest wymagane.');
    }

    if (form.location.length > DISCORD_EVENT_LOCATION_MAX_LENGTH) {
        throw new EventValidationError(`Miejsce wydarzenia może mieć maksymalnie ${DISCORD_EVENT_LOCATION_MAX_LENGTH} znaków.`);
    }

    const startAtTimestamp = parseWarsawDateTimeToTimestamp(form.startAtLocal);
    const endAtTimestamp = parseWarsawDateTimeToTimestamp(form.endAtLocal);

    if (!startAtTimestamp || !endAtTimestamp) {
        throw new EventValidationError('Podaj poprawną datę startu i końca wydarzenia (Europe/Warsaw).');
    }

    if (endAtTimestamp <= startAtTimestamp) {
        throw new EventValidationError('Data zakończenia wydarzenia musi być późniejsza od startu.');
    }

    return {
        startAtIso: new Date(startAtTimestamp).toISOString(),
        endAtIso: new Date(endAtTimestamp).toISOString(),
    };
}

apiRouter.use(requireAuth);

// GET /api/me — current user info
apiRouter.get('/me', (req, res) => {
    res.json({ user: req.session.user });
});

// GET /api/channels — live channel list from Discord
apiRouter.get('/channels', requireCurrentDashboardRole, async (_req, res) => {
    const guildId = process.env.GUILD_ID!;
    try {
        const channels = await getGuildTextChannels(guildId);
        res.json({ channels });
    } catch (err) {
        apiLogger.error('CHANNELS_FETCH_FAILED', 'Failed to fetch channels.', {}, err);
        res.status(500).json({ error: 'Nie udało się pobrać listy kanałów.' });
    }
});

// GET /api/channels/search — search channels for mention picker
apiRouter.get('/channels/search', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID!;
    const query = typeof req.query.query === 'string' ? req.query.query.trim().toLowerCase() : '';

    if (query.length < 2) {
        res.json({ channels: [] });
        return;
    }

    const rawLimit = Number.parseInt(String(req.query.limit ?? '20'), 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, rawLimit)) : 20;

    try {
        const channels = await getGuildTextChannels(guildId);
        const filteredChannels = channels
            .filter((channel) => channel.name.toLowerCase().includes(query))
            .slice(0, limit);

        res.json({ channels: filteredChannels });
    } catch (err) {
        apiLogger.error('CHANNELS_SEARCH_FAILED', 'Failed to search channels.', {}, err);
        res.status(500).json({ error: 'Nie udało się wyszukać kanałów.' });
    }
});

// GET /api/roles — live role list from Discord
apiRouter.get('/roles', requireCurrentDashboardRole, async (_req, res) => {
    const guildId = process.env.GUILD_ID!;

    try {
        const roles = await getGuildRoles(guildId);
        res.json({ roles });
    } catch (err) {
        apiLogger.error('ROLES_FETCH_FAILED', 'Failed to fetch roles.', {}, err);
        res.status(500).json({ error: 'Nie udało się pobrać listy ról.' });
    }
});

// GET /api/roles/search — search roles for mention picker
apiRouter.get('/roles/search', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID!;
    const query = typeof req.query.query === 'string' ? req.query.query.trim().toLowerCase() : '';

    if (query.length < 2) {
        res.json({ roles: [] });
        return;
    }

    const rawLimit = Number.parseInt(String(req.query.limit ?? '20'), 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, rawLimit)) : 20;

    try {
        const roles = await getGuildRoles(guildId);
        const filteredRoles = roles
            .filter((role) => role.name.toLowerCase().includes(query))
            .slice(0, limit);

        res.json({ roles: filteredRoles });
    } catch (err) {
        apiLogger.error('ROLES_SEARCH_FAILED', 'Failed to search roles.', {}, err);
        res.status(500).json({ error: 'Nie udało się wyszukać ról.' });
    }
});

// GET /api/emojis — live emoji list from Discord
apiRouter.get('/emojis', requireCurrentDashboardRole, async (_req, res) => {
    const guildId = process.env.GUILD_ID!;

    try {
        const emojis = await getGuildEmojis(guildId);
        res.json({ emojis });
    } catch (err) {
        apiLogger.error('EMOJIS_FETCH_FAILED', 'Failed to fetch emojis.', {}, err);
        res.status(500).json({ error: 'Nie udało się pobrać listy emotek.' });
    }
});

// GET /api/members/search — search guild members for mention picker
apiRouter.get('/members/search', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID!;
    const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';

    if (query.length < 2) {
        res.json({ members: [] });
        return;
    }

    const rawLimit = Number.parseInt(String(req.query.limit ?? '8'), 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(20, rawLimit)) : 8;

    try {
        const members = await searchGuildMembers(guildId, query, limit);
        res.json({ members });
    } catch (err) {
        apiLogger.error('MEMBERS_SEARCH_FAILED', 'Failed to search members.', {}, err);
        res.status(500).json({ error: 'Nie udało się wyszukać użytkowników.' });
    }
});

// GET /api/members/by-ids — resolve display names for a list of Discord user IDs
apiRouter.get('/members/by-ids', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID!;
    const idsRaw = typeof req.query.ids === 'string' ? req.query.ids.trim() : '';

    if (!idsRaw) {
        res.json({ members: [] });
        return;
    }

    const ids = idsRaw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => /^\d{17,20}$/.test(id))
        .slice(0, 25);

    if (ids.length === 0) {
        res.json({ members: [] });
        return;
    }

    try {
        const memberResults = await Promise.all(
            ids.map(async (id) => {
                const member = await getGuildMember(id, guildId);
                if (!member) return null;
                const displayName = member.nick ?? member.user?.global_name ?? member.user?.username ?? id;
                return { id, displayName };
            }),
        );

        res.json({ members: memberResults.filter(Boolean) });
    } catch (err) {
        apiLogger.error('MEMBERS_BY_IDS_FETCH_FAILED', 'Nie udalo sie pobrac czlonkow serwera po ID.', {
            requestedCount: ids.length,
        }, err);
        res.status(500).json({ error: 'Nie udało się pobrać danych użytkowników.' });
    }
});

// GET /api/timeouts — list active timeouts in current guild
apiRouter.get('/timeouts', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    const userIdRaw = normalizeTrimmedString(req.query.userId);
    if (userIdRaw && !/^\d{17,20}$/.test(userIdRaw)) {
        res.status(400).json({ error: 'Nieprawidlowy parametr userId.' });
        return;
    }

    const limit = Math.max(1, Math.min(250, parsePositiveIntQuery(req.query.limit, 100)));

    try {
        const timeouts = await listActiveEconomyTimeouts(guildId, {
            userId: userIdRaw.length > 0 ? userIdRaw : undefined,
            limit,
        });

        res.json({ success: true, timeouts });
    } catch (error) {
        apiLogger.error('TIMEOUTS_LIST_FAILED', 'Failed to list active timeouts.', {}, error);
        res.status(500).json({ error: 'Nie udalo sie pobrac listy timeoutow.' });
    }
});

// POST /api/timeouts — create timeout and assign Server Mute role
apiRouter.post('/timeouts', requireCurrentDashboardRole, async (req, res) => {
    const parsedBody = timeoutCreateSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    const muteRoleId = resolveServerMuteRoleId();
    if (!muteRoleId) {
        res.status(500).json({ error: 'Brakuje poprawnej zmiennej SERVER_MUTE_ROLE_ID.' });
        return;
    }

    const adminUserId = req.session.user?.id;
    if (!adminUserId) {
        res.status(401).json({ error: 'Brak autoryzacji.' });
        return;
    }

    const targetUserId = parsedBody.data.targetUserId;
    const reason = parsedBody.data.reason;
    const warnings: string[] = [];

    let duration;
    try {
        duration = parseTimeoutDurationParts(parsedBody.data.durationAmount, parsedBody.data.durationUnit);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Nieprawidlowy czas timeoutu.';
        res.status(400).json({ error: message });
        return;
    }

    let createdTimeoutId: number | null = null;
    let muteRoleAssigned = false;

    try {
        const activeTimeout = await getActiveEconomyTimeoutForUser(guildId, targetUserId);
        if (activeTimeout && activeTimeout.isActive) {
            res.status(409).json({
                error: 'Uzytkownik ma juz aktywny timeout.',
                timeout: activeTimeout,
            });
            return;
        }

        const member = await getGuildMember(targetUserId, guildId);
        if (!member) {
            res.status(404).json({ error: 'Nie znaleziono uzytkownika na serwerze.' });
            return;
        }

        if (member.user?.bot) {
            res.status(400).json({ error: 'Nie mozna nalozyc timeoutu na boty.' });
            return;
        }

        if (member.roles.includes(muteRoleId)) {
            res.status(409).json({ error: 'Uzytkownik ma juz role Server Mute.' });
            return;
        }

        const nowTimestamp = Date.now();
        const createdTimeout = await createEconomyTimeout({
            guildId,
            userId: targetUserId,
            reason,
            muteRoleId,
            createdByUserId: adminUserId,
            createdAt: nowTimestamp,
            expiresAt: nowTimestamp + duration.durationMs,
        });
        createdTimeoutId = createdTimeout.id;

        const updateOutcome = await addGuildMemberRole(guildId, targetUserId, muteRoleId);
        if (updateOutcome === 'not_found') {
            await releaseEconomyTimeout({
                guildId,
                timeoutId: createdTimeout.id,
                releasedAt: Date.now(),
                releasedByUserId: adminUserId,
                releaseReason: 'Uzytkownik zniknal z serwera podczas nakladania timeoutu',
            });

            res.status(404).json({ error: 'Nie znaleziono uzytkownika na serwerze.' });
            return;
        }

        muteRoleAssigned = true;

        const muteGuildName = resolveMuteNotificationGuildName();
        try {
            await sendDirectMessage(
                targetUserId,
                formatMuteDmMessage(muteGuildName, createdTimeout.expiresAt, adminUserId, reason),
            );
        } catch (error) {
            warnings.push('Nie udalo sie wyslac DM do uzytkownika.');
            apiLogger.warn('MUTE_DM_SEND_FAILED', 'Nie udalo sie wyslac DM o timeoutcie z dashboardu.', {
                guildId,
                actorUserId: adminUserId,
                targetUserId,
                timeoutId: createdTimeout.id,
            }, error);
        }

        apiLogger.info('MUTE_APPLIED_DASHBOARD', 'Timeout zostal pomyslnie nalozony z dashboardu.', {
            guildId,
            actorUserId: adminUserId,
            targetUserId,
            timeoutId: createdTimeout.id,
            muteRoleId,
            expiresAt: createdTimeout.expiresAt,
        });

        res.json({
            success: true,
            timeout: createdTimeout,
            duration: duration.normalized,
            warnings,
        });
    } catch (error) {
        if (createdTimeoutId !== null && !muteRoleAssigned) {
            const rollbackTimeoutId = createdTimeoutId;
            await releaseEconomyTimeout({
                guildId,
                timeoutId: rollbackTimeoutId,
                releasedAt: Date.now(),
                releasedByUserId: adminUserId,
                releaseReason: 'Rollback timeoutu po bledzie API Discorda',
            }).catch((releaseError) => {
                apiLogger.error('MUTE_TIMEOUT_ROLLBACK_FAILED', 'Nie udalo sie wycofac timeoutu po bledzie API Discorda.', {
                    guildId,
                    actorUserId: adminUserId,
                    targetUserId,
                    timeoutId: rollbackTimeoutId,
                }, releaseError);
            });
        }

        if (error instanceof EconomyInputValidationError) {
            const isActiveTimeoutConflict = error.message.toLowerCase().includes('aktywny timeout');
            res.status(isActiveTimeoutConflict ? 409 : 400).json({ error: error.message });
            return;
        }

        apiLogger.error('MUTE_APPLY_FAILED_DASHBOARD', 'Nie udalo sie nalozyc timeoutu z dashboardu.', {
            guildId,
            actorUserId: adminUserId,
            targetUserId,
        }, error);
        res.status(500).json({ error: 'Nie udalo sie nalozyc timeoutu.' });
    }
});

// POST /api/timeouts/:timeoutId/remove — remove timeout and Server Mute role
apiRouter.post('/timeouts/:timeoutId/remove', requireCurrentDashboardRole, async (req, res) => {
    const timeoutId = Number.parseInt(String(req.params.timeoutId ?? ''), 10);
    if (!Number.isFinite(timeoutId) || timeoutId <= 0) {
        res.status(400).json({ error: 'Nieprawidlowe timeoutId.' });
        return;
    }

    const parsedBody = timeoutRemoveSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    const adminUserId = req.session.user?.id;
    if (!adminUserId) {
        res.status(401).json({ error: 'Brak autoryzacji.' });
        return;
    }

    try {
        const timeoutRecord = await getEconomyTimeoutById(guildId, timeoutId);
        if (!timeoutRecord) {
            res.status(404).json({ error: 'Nie znaleziono timeoutu.' });
            return;
        }

        if (!timeoutRecord.isActive) {
            res.status(409).json({ error: 'Timeout jest juz nieaktywny.', timeout: timeoutRecord });
            return;
        }

        const member = await getGuildMember(timeoutRecord.userId, guildId);
        if (member && member.roles.includes(timeoutRecord.muteRoleId)) {
            await removeGuildMemberRole(guildId, timeoutRecord.userId, timeoutRecord.muteRoleId);
        }

        const releasedTimeout = await releaseEconomyTimeout({
            guildId,
            timeoutId,
            releasedAt: Date.now(),
            releasedByUserId: adminUserId,
            releaseReason: parsedBody.data.reason ?? 'Timeout zdjety recznie z dashboardu',
        });

        if (!releasedTimeout) {
            res.status(404).json({ error: 'Nie znaleziono timeoutu.' });
            return;
        }

        res.json({ success: true, timeout: releasedTimeout });
    } catch (error) {
        if (error instanceof EconomyInputValidationError) {
            res.status(400).json({ error: error.message });
            return;
        }

        apiLogger.error('TIMEOUT_REMOVE_FAILED', 'Failed to remove timeout from dashboard.', {}, error);
        res.status(500).json({ error: 'Nie udalo sie zdjac timeoutu.' });
    }
});

// GET /api/images — list available images from /img directory with pagination/search/sort
apiRouter.get('/images', requireCurrentDashboardRole, (req, res) => {
    try {
        const search = normalizeTrimmedString(req.query.search);
        const sortByRaw = normalizeTrimmedString(req.query.sortBy);
        const sortBy: ImageLibrarySortBy = sortByRaw === 'name_asc' ? 'name_asc' : 'newest';

        const pageSizeRequested = parsePositiveIntQuery(req.query.pageSize, IMAGE_LIBRARY_PAGE_SIZE_DEFAULT);
        const pageSize = Math.max(1, Math.min(IMAGE_LIBRARY_PAGE_SIZE_MAX, pageSizeRequested));

        const allEntries = listImageLibraryEntries(search, sortBy);
        const totalItems = allEntries.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

        const requestedPage = parsePositiveIntQuery(req.query.page, 1);
        const page = Math.min(requestedPage, totalPages);
        const startIndex = (page - 1) * pageSize;
        const pageEntries = allEntries.slice(startIndex, startIndex + pageSize);

        res.json({
            success: true,
            images: pageEntries.map((entry) => entry.name),
            entries: pageEntries.map((entry) => ({
                ...entry,
                url: `/img/${encodeURIComponent(entry.name)}`,
            })),
            pagination: {
                page,
                pageSize,
                totalItems,
                totalPages,
            },
            search,
            sortBy,
        });
    } catch (error) {
        apiLogger.error('IMAGE_LIBRARY_LIST_FAILED', 'Nie udalo sie pobrac listy obrazow.', {
            ...buildActorContext(req.session.user),
        }, error);
        res.status(500).json({ error: 'Nie udało się pobrać listy obrazów.' });
    }
});

// POST /api/images/upload — upload image into /img library
apiRouter.post('/images/upload', requireCurrentDashboardRole, async (req, res) => {
    const parsedBody = imageLibraryUploadSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const actorUserId = req.session.user?.id;
    if (!actorUserId) {
        res.status(401).json({ error: 'Brak autoryzacji.' });
        return;
    }

    try {
        const normalizedFilename = resolveSafeImageFilename(parsedBody.data.filename);
        if (!normalizedFilename) {
            res.status(400).json({ error: 'Nieprawidlowa nazwa pliku.' });
            return;
        }

        const extension = resolveImageLibraryExtension(normalizedFilename);
        if (!IMAGE_LIBRARY_ALLOWED_EXTENSIONS.has(extension)) {
            res.status(400).json({ error: 'Nieobslugiwany format pliku graficznego.' });
            return;
        }

        const expectedMimeType = IMAGE_LIBRARY_MIME_BY_EXTENSION[extension];
        const normalizedMimeType = normalizeUploadMimeType(parsedBody.data.uploadMimeType);
        if (!expectedMimeType || normalizedMimeType !== expectedMimeType) {
            res.status(400).json({ error: 'Typ MIME nie zgadza sie z rozszerzeniem pliku.' });
            return;
        }

        const imageBuffer = parseUploadData(parsedBody.data.uploadBase64);
        if (!imageBuffer || imageBuffer.length === 0) {
            res.status(400).json({ error: 'Wgrany plik ma nieprawidlowy format.' });
            return;
        }

        if (imageBuffer.length > IMAGE_LIBRARY_MAX_UPLOAD_BYTES) {
            res.status(400).json({ error: 'Wgrany plik jest za duzy (max 20 MB).' });
            return;
        }

        const detectedMimeType = detectImageMime(imageBuffer);
        if (!detectedMimeType || detectedMimeType !== expectedMimeType) {
            res.status(400).json({ error: 'Zawartosc pliku nie zgadza sie z deklarowanym typem obrazu.' });
            return;
        }

        if (expectedMimeType === 'image/svg+xml') {
            validateSvgSafety(imageBuffer);
        }

        const imageDirectoryPath = resolveImageLibraryDirectoryPath();
        await mkdir(imageDirectoryPath, { recursive: true });

        const targetFilePath = join(imageDirectoryPath, normalizedFilename);
        if (existsSync(targetFilePath)) {
            res.status(409).json({ error: 'Plik o tej nazwie juz istnieje w bibliotece.' });
            return;
        }

        await writeFile(targetFilePath, imageBuffer, { flag: 'wx' });
        const fileStats = statSync(targetFilePath);

        apiLogger.info('IMAGE_LIBRARY_UPLOAD_SUCCESS', 'Dodano obraz do biblioteki grafik.', {
            actorUserId,
            imageFilename: normalizedFilename,
            sizeBytes: fileStats.size,
        });

        res.json({
            success: true,
            entry: {
                name: normalizedFilename,
                sizeBytes: fileStats.size,
                modifiedAt: fileStats.mtimeMs,
                mimeType: expectedMimeType,
                url: `/img/${encodeURIComponent(normalizedFilename)}`,
            },
        });
    } catch (error) {
        if (isClientValidationError(error)) {
            res.status(400).json({
                error: error instanceof Error ? error.message : 'Nieprawidlowe dane obrazu.',
            });
            return;
        }

        apiLogger.error('IMAGE_LIBRARY_UPLOAD_FAILED', 'Nie udalo sie dodac obrazu do biblioteki.', {
            actorUserId,
        }, error);
        res.status(500).json({ error: 'Nie udalo sie dodac obrazu do biblioteki.' });
    }
});

// PATCH /api/images/rename — rename image in /img library
apiRouter.patch('/images/rename', requireCurrentDashboardRole, async (req, res) => {
    const parsedBody = imageLibraryRenameSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const actorUserId = req.session.user?.id;
    if (!actorUserId) {
        res.status(401).json({ error: 'Brak autoryzacji.' });
        return;
    }

    try {
        const normalizedFilename = resolveSafeImageFilename(parsedBody.data.filename);
        if (!normalizedFilename) {
            res.status(400).json({ error: 'Nieprawidlowa nazwa pliku.' });
            return;
        }

        const normalizedNewFilenameBase = resolveSafeImageFilename(parsedBody.data.newFilename);
        if (!normalizedNewFilenameBase) {
            res.status(400).json({ error: 'Nieprawidlowa nowa nazwa pliku.' });
            return;
        }

        const oldExtension = resolveImageLibraryExtension(normalizedFilename);
        const newExtension = resolveImageLibraryExtension(normalizedNewFilenameBase);
        const normalizedNewFilename = newExtension
            ? normalizedNewFilenameBase
            : `${normalizedNewFilenameBase}${oldExtension}`;

        const finalExtension = resolveImageLibraryExtension(normalizedNewFilename);
        if (!IMAGE_LIBRARY_ALLOWED_EXTENSIONS.has(finalExtension)) {
            res.status(400).json({ error: 'Nieobslugiwany format pliku graficznego.' });
            return;
        }

        if (normalizedFilename === normalizedNewFilename) {
            res.status(400).json({ error: 'Nowa nazwa pliku musi byc inna niz obecna.' });
            return;
        }

        const imageDirectoryPath = resolveImageLibraryDirectoryPath();
        const sourcePath = join(imageDirectoryPath, normalizedFilename);
        const destinationPath = join(imageDirectoryPath, normalizedNewFilename);

        if (!existsSync(sourcePath)) {
            res.status(404).json({ error: 'Nie znaleziono pliku do zmiany nazwy.' });
            return;
        }

        if (existsSync(destinationPath)) {
            res.status(409).json({ error: 'Plik o docelowej nazwie juz istnieje.' });
            return;
        }

        await rename(sourcePath, destinationPath);
        const fileStats = statSync(destinationPath);

        apiLogger.info('IMAGE_LIBRARY_RENAME_SUCCESS', 'Zmieniono nazwe obrazu w bibliotece grafik.', {
            actorUserId,
            previousFilename: normalizedFilename,
            nextFilename: normalizedNewFilename,
        });

        res.json({
            success: true,
            entry: {
                name: normalizedNewFilename,
                sizeBytes: fileStats.size,
                modifiedAt: fileStats.mtimeMs,
                mimeType: IMAGE_LIBRARY_MIME_BY_EXTENSION[finalExtension] ?? 'application/octet-stream',
                url: `/img/${encodeURIComponent(normalizedNewFilename)}`,
            },
        });
    } catch (error) {
        apiLogger.error('IMAGE_LIBRARY_RENAME_FAILED', 'Nie udalo sie zmienic nazwy obrazu.', {
            actorUserId,
            filename: parsedBody.data.filename,
            newFilename: parsedBody.data.newFilename,
        }, error);
        res.status(500).json({ error: 'Nie udalo sie zmienic nazwy obrazu.' });
    }
});

// DELETE /api/images/:filename — delete image from /img library
apiRouter.delete('/images/:filename', requireCurrentDashboardRole, async (req, res) => {
    const actorUserId = req.session.user?.id;
    if (!actorUserId) {
        res.status(401).json({ error: 'Brak autoryzacji.' });
        return;
    }

    try {
        const normalizedFilename = resolveSafeImageFilename(String(req.params.filename ?? ''));
        if (!normalizedFilename) {
            res.status(400).json({ error: 'Nieprawidlowa nazwa pliku.' });
            return;
        }

        const extension = resolveImageLibraryExtension(normalizedFilename);
        if (!IMAGE_LIBRARY_ALLOWED_EXTENSIONS.has(extension)) {
            res.status(400).json({ error: 'Nieobslugiwany format pliku graficznego.' });
            return;
        }

        const imageDirectoryPath = resolveImageLibraryDirectoryPath();
        const targetFilePath = join(imageDirectoryPath, normalizedFilename);

        if (!existsSync(targetFilePath)) {
            res.status(404).json({ error: 'Nie znaleziono pliku do usuniecia.' });
            return;
        }

        await unlink(targetFilePath);

        apiLogger.info('IMAGE_LIBRARY_DELETE_SUCCESS', 'Usunieto obraz z biblioteki grafik.', {
            actorUserId,
            imageFilename: normalizedFilename,
        });

        res.json({ success: true, deletedFilename: normalizedFilename });
    } catch (error) {
        apiLogger.error('IMAGE_LIBRARY_DELETE_FAILED', 'Nie udalo sie usunac obrazu z biblioteki.', {
            actorUserId,
            filename: req.params.filename,
        }, error);
        res.status(500).json({ error: 'Nie udalo sie usunac obrazu z biblioteki.' });
    }
});

// GET /api/tickets/history — list closed ticket history records
apiRouter.get('/tickets/history', requireCurrentDashboardRole, async (req, res) => {
    try {
        const search = normalizeTrimmedString(req.query.search);
        const pageRequested = parsePositiveIntQuery(req.query.page, 1);
        const pageSizeRequested = parsePositiveIntQuery(req.query.pageSize, TICKET_HISTORY_PAGE_SIZE_DEFAULT);
        const pageSize = Math.max(1, Math.min(TICKET_HISTORY_PAGE_SIZE_MAX, pageSizeRequested));

        const result = await listTicketHistoryEntries({
            page: pageRequested,
            pageSize,
            search,
        });

        res.json({
            success: true,
            entries: result.entries,
            pagination: {
                page: result.page,
                pageSize: result.pageSize,
                totalItems: result.totalItems,
                totalPages: result.totalPages,
            },
            search,
        });
    } catch (error) {
        apiLogger.error('TICKET_HISTORY_LIST_FAILED', 'Nie udalo sie pobrac historii ticketow.', {
            ...buildActorContext(req.session.user),
        }, error);
        res.status(500).json({ error: 'Nie udalo sie pobrac historii ticketow.' });
    }
});

// DELETE /api/tickets/history — clear all ticket history (Dev only)
apiRouter.delete('/tickets/history', requireCurrentDashboardRole, async (req, res) => {
    try {
        const guildId = process.env.GUILD_ID;
        if (!guildId) {
            res.status(500).json({ error: 'Brakuje GUILD_ID.' });
            return;
        }

        const member = await getGuildMember(req.session.user!.id, guildId);
        if (!member || !hasDevRole(member)) {
            res.status(403).json({ error: 'Brak uprawnien. Wymagana rola Dev.' });
            return;
        }

        await clearTicketHistory();

        apiLogger.info('TICKET_HISTORY_CLEARED', 'Wyczyszczono historie ticketow.', {
            ...buildActorContext(req.session.user),
        });
        res.json({ success: true });
    } catch (error) {
        apiLogger.error('TICKET_HISTORY_CLEAR_FAILED', 'Nie udalo sie wyczyscic historii ticketow.', {
            ...buildActorContext(req.session.user),
        }, error);
        res.status(500).json({ error: 'Nie udalo sie wyczyscic historii ticketow.' });
    }
});

// GET /api/tickets/transcripts/:fileName — download saved ticket transcript
apiRouter.get('/tickets/transcripts/:fileName', requireCurrentDashboardRole, (req, res) => {
    try {
        const fileName = normalizeTrimmedString(req.params.fileName);
        const transcriptPath = resolveTicketTranscriptFilePath(fileName);
        if (!transcriptPath) {
            res.status(400).json({ error: 'Nieprawidlowa nazwa transkryptu.' });
            return;
        }

        if (!existsSync(transcriptPath)) {
            res.status(404).json({ error: 'Nie znaleziono transkryptu ticketu.' });
            return;
        }

        res.sendFile(transcriptPath);
    } catch (error) {
        apiLogger.error('TICKET_TRANSCRIPT_DOWNLOAD_FAILED', 'Nie udalo sie pobrac transkryptu ticketu.', {
            ...buildActorContext(req.session.user),
            transcriptFileName: req.params.fileName,
        }, error);
        res.status(500).json({ error: 'Nie udalo sie pobrac transkryptu ticketu.' });
    }
});

// GET /api/logs — list structured dashboard/system logs (Dev-only)
apiRouter.get('/logs', requireCurrentDashboardDevRole, async (req, res) => {
    const page = parsePositiveIntQuery(req.query.page, 1);
    const pageSize = Math.max(1, Math.min(100, parsePositiveIntQuery(req.query.pageSize, 25)));
    const search = normalizeTrimmedString(req.query.search);
    const levelRaw = normalizeTrimmedString(req.query.level).toLowerCase();
    const allowedLogLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
    const level = (allowedLogLevels as readonly string[]).includes(levelRaw)
        ? levelRaw as (typeof allowedLogLevels)[number]
        : 'all';

    try {
        const result = await listDashboardLogs({
            page,
            pageSize,
            search,
            level,
        });

        const enrichedEntries = result.entries.map((entry) => {
            const actorId = typeof entry.context?.actorUserId === 'string' ? entry.context.actorUserId : undefined;
            const targetId = typeof entry.context?.targetUserId === 'string' ? entry.context.targetUserId : undefined;
            const cachedActor = enrichWithDiscordUser(actorId);
            const storedActorName = typeof entry.context?.actorUserName === 'string' ? entry.context.actorUserName : null;
            const storedActorRole = typeof entry.context?.actorUserRole === 'string' ? entry.context.actorUserRole : null;
            return {
                ...entry,
                actorUser: {
                    displayName: cachedActor.displayName ?? storedActorName,
                    avatarUrl: cachedActor.avatarUrl,
                    role: cachedActor.role ?? storedActorRole,
                },
                targetUser: enrichWithDiscordUser(targetId),
            };
        });

        res.json({
            success: true,
            logs: enrichedEntries,
            pagination: {
                page: result.page,
                pageSize: result.pageSize,
                totalRows: result.totalRows,
                totalPages: result.totalPages,
            },
            filters: {
                level,
                search,
            },
        });
    } catch (error) {
        apiLogger.error('DASHBOARD_LOGS_LIST_FAILED', 'Nie udalo sie pobrac logow systemowych.', {
            ...buildActorContext(req.session.user),
            level,
            search,
        }, error);
        res.status(500).json({ error: 'Nie udalo sie pobrac logow systemowych.' });
    }
});

// GET /api/sessions/activity — session activity panel (Dev-only)
apiRouter.get('/sessions/activity', requireCurrentDashboardDevRole, async (req, res) => {
    const page = parsePositiveIntQuery(req.query.page, 1);
    const pageSize = Math.max(1, Math.min(100, parsePositiveIntQuery(req.query.pageSize, 50)));

    try {
        const result = await listSessionActivity(page, pageSize);
        res.json({ success: true, ...result });
    } catch (error) {
        apiLogger.error('SESSION_ACTIVITY_LIST_FAILED', 'Nie udalo sie pobrac aktywnosci sesji.', {
            ...buildActorContext(req.session.user),
        }, error);
        res.status(500).json({ error: 'Nie udalo sie pobrac aktywnosci sesji.' });
    }
});

// GET /api/economy/settings — load economy configuration for dashboard
apiRouter.get('/economy/settings', requireCurrentDashboardDevRole, async (_req, res) => {
    try {
        const config = await getEconomyConfig();
        res.json({ config });
    } catch (error) {
        apiLogger.error('ECONOMY_SETTINGS_LOAD_FAILED', 'Failed to load economy settings.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać ustawień ekonomii.' });
    }
});

// PATCH /api/economy/settings — update economy configuration from dashboard
apiRouter.patch('/economy/settings', requireCurrentDashboardDevRole, async (req, res) => {
    const parsedBody = economyConfigSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    try {
        const updatedConfig = await updateEconomyConfig(parsedBody.data, Date.now());
        res.json({ success: true, config: updatedConfig });
    } catch (error) {
        apiLogger.error('ECONOMY_SETTINGS_UPDATE_FAILED', 'Failed to update economy settings.', {}, error);
        res.status(500).json({ error: 'Nie udało się zapisać ustawień ekonomii.' });
    }
});

// POST /api/economy/reset-users — reset economy state for all users in current guild
apiRouter.post('/economy/reset-users', requireCurrentDashboardDevRole, async (_req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    try {
        const resetCount = await resetEconomyUsers(guildId);
        res.json({ success: true, resetCount });
    } catch (error) {
        apiLogger.error('ECONOMY_RESET_USERS_FAILED', 'Failed to reset economy users.', {}, error);
        res.status(500).json({ error: 'Nie udało się zresetować danych ekonomii.' });
    }
});

// POST /api/economy/user-mutation — apply manual economy mutation for one user
apiRouter.post('/economy/user-mutation', requireCurrentDashboardDevRole, async (req, res) => {
    const parsedBody = economyUserMutationSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    const adminUserId = req.session.user?.id;
    if (!adminUserId) {
        res.status(401).json({ error: 'Brak autoryzacji.' });
        return;
    }

    try {
        let mutation;
        if (parsedBody.data.operation === 'add_coins') {
            mutation = await addCoinsByAdmin({
                guildId,
                targetUserId: parsedBody.data.targetUserId,
                adminUserId,
                amount: parsedBody.data.amount,
                nowTimestamp: Date.now(),
            });
        } else if (parsedBody.data.operation === 'add_levels') {
            mutation = await addLevelsByAdmin({
                guildId,
                targetUserId: parsedBody.data.targetUserId,
                adminUserId,
                amount: parsedBody.data.amount,
                nowTimestamp: Date.now(),
            });
        } else {
            mutation = await addXpByAdmin({
                guildId,
                targetUserId: parsedBody.data.targetUserId,
                adminUserId,
                amount: parsedBody.data.amount,
                nowTimestamp: Date.now(),
            });
        }

        res.json({ success: true, mutation });
    } catch (error) {
        apiLogger.error('ECONOMY_USER_MUTATION_FAILED', 'Failed to apply manual economy mutation.', {}, error);
        res.status(500).json({ error: 'Nie udało się wykonać ręcznej mutacji użytkownika.' });
    }
});

// GET /api/economy/level-roles — load level->role mappings
apiRouter.get('/economy/level-roles', requireCurrentDashboardDevRole, async (_req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    try {
        const mappings = await getEconomyLevelRoleMappings(guildId);
        res.json({ mappings });
    } catch (error) {
        apiLogger.error('ECONOMY_LEVEL_ROLES_LOAD_FAILED', 'Failed to load economy level-role mappings.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać mapowań ról levelowych.' });
    }
});

// PUT /api/economy/level-roles — replace level->role mappings
apiRouter.put('/economy/level-roles', requireCurrentDashboardDevRole, async (req, res) => {
    const parsedBody = economyLevelRoleMappingsSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    const protectedRoleIds = resolveProtectedStaffRoleIds();
    const hasProtectedRole = parsedBody.data.mappings.some((mapping) => protectedRoleIds.has(mapping.roleId));
    if (hasProtectedRole) {
        res.status(400).json({
            error: 'Mapowania leveli nie moga zawierac ról staff (Admin, Moderator, Community Manager, Dev).',
        });
        return;
    }

    try {
        const mappings = await replaceEconomyLevelRoleMappings(guildId, parsedBody.data.mappings, Date.now());
        res.json({ success: true, mappings });
    } catch (error) {
        if (error instanceof EconomyInputValidationError) {
            res.status(400).json({ error: error.message });
            return;
        }

        apiLogger.error('ECONOMY_LEVEL_ROLES_UPDATE_FAILED', 'Failed to update economy level-role mappings.', {}, error);
        res.status(500).json({ error: 'Nie udało się zapisać mapowań ról levelowych.' });
    }
});

// POST /api/economy/import-csv — strict snapshot import (userId,level,xp,messages,voiceMinutes)
apiRouter.post('/economy/import-csv', requireCurrentDashboardDevRole, async (req, res) => {
    const parsedBody = economyCsvImportSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    try {
        const result = await importEconomyCsvSnapshot({
            guildId,
            csvContent: parsedBody.data.csvContent,
            nowTimestamp: Date.now(),
        });

        let roleSync: EconomyImportRoleSyncStats = {
            attemptedUsers: 0,
            updatedUsers: 0,
            skippedUsers: 0,
            failedUsers: 0,
        };

        try {
            roleSync = await syncLevelRolesAfterCsvImport(guildId, parsedBody.data.csvContent);
        } catch (roleSyncError) {
            apiLogger.warn('ECONOMY_CSV_ROLE_SYNC_FAILED', 'Failed to sync level roles after economy CSV import.', {}, roleSyncError);
        }

        res.json({ success: true, result, roleSync });
    } catch (error) {
        if (error instanceof EconomyCsvImportValidationError) {
            res.status(400).json({ error: error.message });
            return;
        }

        apiLogger.error('ECONOMY_CSV_IMPORT_FAILED', 'Failed to import economy CSV snapshot.', {}, error);
        res.status(500).json({ error: 'Nie udało się zaimportować danych CSV ekonomii.' });
    }
});

// GET /api/economy/leaderboard — load paginated economy leaderboard for dashboard
apiRouter.get('/economy/leaderboard', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    const sortByRaw = normalizeTrimmedString(req.query.sortBy).toLowerCase();
    const sortBy: EconomyLeaderboardSortBy = sortByRaw === 'coins' ? 'coins' : 'xp';

    if (sortByRaw && sortByRaw !== 'xp' && sortByRaw !== 'coins') {
        res.status(400).json({ error: 'Nieprawidłowy parametr sortBy. Dozwolone: xp, coins.' });
        return;
    }

    const page = parsePositiveIntQuery(req.query.page, 1);
    const pageSize = Math.max(1, Math.min(25, parsePositiveIntQuery(req.query.pageSize, 10)));

    try {
        const rawLeaderboard = await getEconomyLeaderboardPage(guildId, sortBy, page, pageSize);
        const leaderboard = await enrichEconomyLeaderboard(guildId, rawLeaderboard);
        res.json({ leaderboard });
    } catch (error) {
        apiLogger.error('ECONOMY_LEADERBOARD_LOAD_FAILED', 'Failed to load economy leaderboard.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać leaderboardu ekonomii.' });
    }
});

// GET /api/events — list Discord scheduled events
apiRouter.get('/events', async (_req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    try {
        const events = await listGuildScheduledEvents(guildId);
        const mapped = events
            .map(mapDiscordEventToDashboardEvent)
            .sort((left, right) => {
                const leftTimestamp = Date.parse(String(left.scheduledStartTimeIso ?? ''));
                const rightTimestamp = Date.parse(String(right.scheduledStartTimeIso ?? ''));
                return leftTimestamp - rightTimestamp;
            });

        res.json({ events: mapped });
    } catch (error) {
        if (error instanceof DiscordRateLimitedError) {
            const retryAfterSeconds = Math.max(1, Math.ceil(error.retryAfterSeconds));
            res.setHeader('Retry-After', String(retryAfterSeconds));
            res.status(503).json({
                error: 'Discord chwilowo ogranicza zapytania o wydarzenia. Spróbuj ponownie za chwilę.',
            });
            return;
        }

        if (isDiscordEventOperationError(error)) {
            apiLogger.error('DISCORD_EVENTS_FETCH_UPSTREAM_FAILED', 'Failed to load Discord events (upstream).', {}, error);
            res.status(502).json({ error: 'Nie udało się pobrać listy wydarzeń Discord (błąd usługi zewnętrznej).' });
            return;
        }

        apiLogger.error('DISCORD_EVENTS_FETCH_FAILED', 'Failed to load Discord events.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać listy wydarzeń Discord.' });
    }
});

// POST /api/events — create Discord scheduled event
apiRouter.post('/events', async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    const parsedBody = dashboardEventSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const form = sanitizeEventForm(parsedBody.data);

    try {
        const { startAtIso, endAtIso } = validateAndResolveEventForm(form);
        const eventId = await createExternalGuildScheduledEvent(guildId, {
            name: form.title,
            description: form.description,
            location: form.location,
            scheduledStartTimeIso: startAtIso,
            scheduledEndTimeIso: endAtIso,
        });

        res.json({ success: true, eventId });
        apiLogger.info('DISCORD_EVENT_CREATED', 'Utworzono wydarzenie Discord.', {
            ...buildActorContext(req.session.user),
            discordEventId: eventId,
        });
    } catch (error) {
        handleDashboardEventMutationError(res, error, 'create');
    }
});

// PATCH /api/events/:id — update Discord scheduled event
apiRouter.patch('/events/:id', async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    const eventId = normalizeTrimmedString(req.params.id);
    if (!/^\d{17,20}$/.test(eventId)) {
        res.status(400).json({ error: 'Nieprawidłowy identyfikator wydarzenia.' });
        return;
    }

    const parsedBody = dashboardEventSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const form = sanitizeEventForm(parsedBody.data);

    try {
        const { startAtIso, endAtIso } = validateAndResolveEventForm(form);
        const updated = await updateGuildScheduledEvent(guildId, eventId, {
            name: form.title,
            description: form.description,
            location: form.location,
            scheduledStartTimeIso: startAtIso,
            scheduledEndTimeIso: endAtIso,
        });

        res.json({
            success: true,
            event: mapDiscordEventToDashboardEvent(updated),
        });
        apiLogger.info('DISCORD_EVENT_UPDATED', 'Zaktualizowano wydarzenie Discord.', {
            ...buildActorContext(req.session.user),
            discordEventId: eventId,
        });
    } catch (error) {
        handleDashboardEventMutationError(res, error, 'update');
    }
});

// DELETE /api/events/:id — delete Discord scheduled event
apiRouter.delete('/events/:id', async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    const eventId = normalizeTrimmedString(req.params.id);
    if (!/^\d{17,20}$/.test(eventId)) {
        res.status(400).json({ error: 'Nieprawidłowy identyfikator wydarzenia.' });
        return;
    }

    try {
        await deleteGuildScheduledEvent(guildId, eventId);
        res.json({ success: true });
        apiLogger.info('DISCORD_EVENT_DELETED', 'Usunięto wydarzenie Discord.', {
            ...buildActorContext(req.session.user),
            discordEventId: eventId,
        });
    } catch (error) {
        handleDashboardEventMutationError(res, error, 'delete');
    }
});

// POST /api/send-image — send an image file to a Discord channel
apiRouter.post('/send-image', async (req, res) => {
    const parsedBody = sendImageSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const { filename, channelId } = parsedBody.data;
    if (!/^\d{17,20}$/.test(channelId)) {
        res.status(400).json({ error: 'Wybierz kanał docelowy.' });
        return;
    }

    try {
        const messageId = await sendImageToChannel(channelId, filename);
        res.json({ success: true, messageId });
    } catch (err) {
        if (err instanceof Error && err.message === 'Invalid filename') {
            res.status(400).json({ error: 'Wybrany obraz nie istnieje.' });
            return;
        }

        apiLogger.error('IMAGE_SEND_FAILED', 'Failed to send image.', {}, err);
        res.status(500).json({ error: 'Nie udało się wysłać obrazu.' });
    }
});

// POST /api/embed — build & send embed
apiRouter.post('/embed', async (req, res) => {
    const parsedBody = embedPayloadSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const data = sanitizeEmbedPayload(parsedBody.data);

    const validationError = validateEmbedForm(data);
    if (validationError) {
        res.status(400).json({ error: validationError });
        return;
    }

    if (!/^\d{17,20}$/.test(data.channelId)) {
        res.status(400).json({ error: 'Wybierz kanał docelowy.' });
        return;
    }

    try {
        const publisherName = req.session.user?.globalName
            ?? req.session.user?.username
            ?? 'Administrator';
        const publisherId = req.session.user?.id;
        const publishResult = await publishDashboardPost(data, {
            publishedBy: publisherName,
            publishedByUserId: publisherId,
        });

        const eventResult = await tryCreateDiscordEventFromPayload(data);
        const initialWatchpartyStatus: ScheduledPost['watchpartyStatus'] = data.watchpartyDraft?.enabled
            ? 'pending'
            : 'not_requested';
        let watchpartyResult: {
            status: 'not_requested' | 'scheduled' | 'open' | 'closed' | 'failed';
            channelId?: string;
            watchpartyError?: string;
            warnings: string[];
        } = {
            status: 'not_requested',
            channelId: undefined,
            watchpartyError: undefined,
            warnings: [],
        };
        const warnings = [...publishResult.warnings, ...eventResult.warnings];

        const now = Date.now();
        const sentPost: ScheduledPost = {
            id: randomUUID(),
            payload: data,
            scheduledFor: now,
            status: 'sent',
            createdAt: now,
            updatedAt: now,
            sentAt: now,
            publisherName,
            publisherUserId: publisherId,
            messageId: publishResult.messageId,
            pingMessageId: publishResult.pingMessageId,
            imageMessageId: publishResult.imageMessageId,
            source: 'immediate',
            eventStatus: eventResult.status,
            discordEventId: eventResult.eventId,
            eventLastError: eventResult.eventError,
            watchpartyStatus: initialWatchpartyStatus,
            watchpartyChannelId: watchpartyResult.channelId,
            watchpartyLastError: watchpartyResult.watchpartyError,
            lastError: warnings.length > 0 ? warnings.join(' | ') : undefined,
        };

        apiLogger.info('EMBED_PUBLISHED_IMMEDIATE', 'Wyslano publikacje z dashboardu (tryb natychmiastowy).', {
            actorUserId: publisherId,
            channelId: data.channelId,
            mode: data.mode,
            messageId: publishResult.messageId,
            postId: sentPost.id,
        });

        let insertedPost: ScheduledPost | null = null;
        try {
            insertedPost = await insertScheduledPost(sentPost);
            apiLogger.info('SENT_POST_HISTORY_PERSISTED', 'Zapisano wpis historii wyslanego posta.', {
                actorUserId: publisherId,
                postId: insertedPost.id,
                channelId: data.channelId,
                source: sentPost.source,
            });
        } catch (persistError) {
            warnings.push('Post został wysłany, ale nie udało się zapisać go w historii wysłanych postów.');
            apiLogger.warn('SENT_POST_HISTORY_PERSIST_FAILED', 'Nie udalo sie zapisac historii wyslanego posta.', {
                actorUserId: publisherId,
                postId: sentPost.id,
                channelId: data.channelId,
            }, persistError);
        }

        if (insertedPost && data.watchpartyDraft?.enabled) {
            watchpartyResult = await tryCreateWatchpartyChannelFromPayload(data);
            warnings.push(...watchpartyResult.warnings);

            let updatedPost: ScheduledPost | null = null;
            try {
                updatedPost = await updateScheduledPost(insertedPost.id, (post) => ({
                    ...post,
                    updatedAt: Date.now(),
                    watchpartyStatus: watchpartyResult.status,
                    watchpartyChannelId: watchpartyResult.channelId,
                    watchpartyLastError: watchpartyResult.watchpartyError,
                    lastError: warnings.length > 0 ? warnings.join(' | ') : undefined,
                }));
            } catch (persistWatchpartyError) {
                apiLogger.warn('WATCHPARTY_STATUS_PERSIST_FAILED', 'Failed to persist watchparty status for sent post.', {}, persistWatchpartyError);
            }

            if (updatedPost) {
                registerWatchpartyLifecycle(updatedPost);
            } else {
                warnings.push('Nie udało się zaktualizować statusu watchparty w historii wysłanych postów. Uruchomiono rollback kanału.');

                if (watchpartyResult.channelId) {
                    try {
                        await deleteWatchpartyChannel(watchpartyResult.channelId);
                    } catch (watchpartyCleanupError) {
                        apiLogger.warn('WATCHPARTY_CHANNEL_ROLLBACK_FAILED', 'Failed to rollback watchparty channel after persist error.', {}, watchpartyCleanupError);
                        warnings.push('Rollback kanału watchparty po błędzie zapisu nie powiódł się. Wymagane ręczne sprzątanie kanału.');
                    }
                }

                watchpartyResult = {
                    status: 'failed',
                    channelId: undefined,
                    watchpartyError: 'Nie utworzono kanału watchparty, bo nie udało się zapisać jego statusu.',
                    warnings: [],
                };
            }
        }

        if (!insertedPost && data.watchpartyDraft?.enabled) {
            watchpartyResult = {
                status: 'failed',
                channelId: undefined,
                watchpartyError: 'Nie utworzono kanału watchparty, bo nie udało się zapisać wpisu historii.',
                warnings: [],
            };
        }

        res.json({
            success: true,
            messageId: publishResult.messageId,
            pingMessageId: publishResult.pingMessageId,
            imageMessageId: publishResult.imageMessageId,
            warnings,
            eventStatus: eventResult.status,
            eventError: eventResult.eventError,
            discordEventId: eventResult.eventId,
            watchpartyStatus: watchpartyResult.status,
            watchpartyError: watchpartyResult.watchpartyError,
            watchpartyChannelId: watchpartyResult.channelId,
            postId: sentPost.id,
        });
    } catch (err) {
        if (isClientValidationError(err)) {
            res.status(400).json({ error: (err as Error).message });
            return;
        }

        apiLogger.error('EMBED_PUBLISH_FAILED', 'Krytyczny blad podczas publikowania posta z dashboardu.', {
            ...buildActorContext(req.session.user),
            channelId: req.body?.channelId,
            mode: req.body?.mode,
        }, err);
        res.status(500).json({ error: 'Nie udało się opublikować wiadomości.' });
    }
});

const SERVER_STATS_TOP_USERS_LIMIT_DEFAULT = 10;
const SERVER_STATS_TOP_USERS_LIMIT_MAX = 50;
const SERVER_STATS_DATE_RANGE_MAX_DAYS = 365;
const STATS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseStatsDateRange(
    rawStart: unknown,
    rawEnd: unknown,
): { startDate: string; endDate: string } | null {
    const startDate = normalizeTrimmedString(rawStart);
    const endDate = normalizeTrimmedString(rawEnd);
    if (!STATS_DATE_RE.test(startDate) || !STATS_DATE_RE.test(endDate)) return null;
    if (startDate > endDate) return null;
    const msPerDay = 86_400_000;
    const diffDays = (new Date(endDate).getTime() - new Date(startDate).getTime()) / msPerDay;
    if (diffDays > SERVER_STATS_DATE_RANGE_MAX_DAYS) return null;
    return { startDate, endDate };
}

// GET /api/stats/server?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD — summary for a date range
apiRouter.get('/stats/server', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    const range = parseStatsDateRange(req.query.startDate, req.query.endDate);
    if (!range) {
        res.status(400).json({ error: 'Wymagane parametry startDate i endDate w formacie YYYY-MM-DD (max 365 dni).' });
        return;
    }

    try {
        const summary = await getServerStatsByDateRange(guildId, range.startDate, range.endDate);
        res.json({ summary });
    } catch (error) {
        apiLogger.error('SERVER_STATS_LOAD_FAILED', 'Failed to load server stats.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać statystyk serwera.' });
    }
});

// GET /api/stats/server/config — read excluded channel IDs for stats
apiRouter.get('/stats/server/config', requireCurrentDashboardRole, async (_req, res) => {
    try {
        const excludedChannelIds = await getStatsExcludedChannelIds();
        res.json({ excludedChannelIds });
    } catch (error) {
        apiLogger.error('STATS_CONFIG_LOAD_FAILED', 'Failed to load stats config.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać konfiguracji statystyk.' });
    }
});

// PUT /api/stats/server/config — update excluded channel IDs for stats
apiRouter.put('/stats/server/config', requireCurrentDashboardRole, async (req, res) => {
    const body: unknown = req.body;
    if (
        typeof body !== 'object'
        || body === null
        || !Array.isArray((body as Record<string, unknown>).excludedChannelIds)
        || !(body as Record<string, unknown[]>).excludedChannelIds.every((id) => typeof id === 'string')
    ) {
        res.status(400).json({ error: 'Pole excludedChannelIds musi być tablicą stringów.' });
        return;
    }

    const channelIds: string[] = (body as { excludedChannelIds: string[] }).excludedChannelIds;

    try {
        await setStatsExcludedChannelIds(channelIds);
        res.json({ success: true, excludedChannelIds: channelIds });
    } catch (error) {
        apiLogger.error('STATS_CONFIG_UPDATE_FAILED', 'Failed to update stats config.', {}, error);
        res.status(500).json({ error: 'Nie udało się zaktualizować konfiguracji statystyk.' });
    }
});

// GET /api/stats/server/top-users?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&limit=10
apiRouter.get('/stats/server/top-users', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    const range = parseStatsDateRange(req.query.startDate, req.query.endDate);
    if (!range) {
        res.status(400).json({ error: 'Wymagane parametry startDate i endDate w formacie YYYY-MM-DD (max 365 dni).' });
        return;
    }

    const limit = Math.max(1, Math.min(
        SERVER_STATS_TOP_USERS_LIMIT_MAX,
        parsePositiveIntQuery(req.query.limit, SERVER_STATS_TOP_USERS_LIMIT_DEFAULT),
    ));

    try {
        const rawTopUsers = await getServerStatsTopUsers(guildId, range.startDate, range.endDate, limit);
        const uniqueUserIds = [...new Set(rawTopUsers.map((u) => u.userId).filter((id) => id.length > 0))];
        const profilePairs = await resolveLeaderboardProfilesWithLimit(guildId, uniqueUserIds);
        const profileByUserId = new Map(profilePairs);

        const topUsers = rawTopUsers.map((user) => {
            const profile = profileByUserId.get(user.userId);
            return {
                ...user,
                displayName: profile?.displayName ?? `Uzytkownik ${user.userId}`,
                avatarUrl: profile?.avatarUrl ?? null,
            };
        });

        res.json({ topUsers });
    } catch (error) {
        apiLogger.error('SERVER_STATS_TOP_USERS_FAILED', 'Failed to load server stats top users.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać najaktywniejszych użytkowników.' });
    }
});

// GET /api/stats/server/timeseries?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD — daily time series
apiRouter.get('/stats/server/timeseries', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    const range = parseStatsDateRange(req.query.startDate, req.query.endDate);
    if (!range) {
        res.status(400).json({ error: 'Wymagane parametry startDate i endDate w formacie YYYY-MM-DD (max 365 dni).' });
        return;
    }

    try {
        const timeSeries = await getServerStatsDailyTimeSeries(guildId, range.startDate, range.endDate);
        res.json({ timeSeries });
    } catch (error) {
        apiLogger.error('SERVER_STATS_TIMESERIES_FAILED', 'Failed to load server stats time series.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać szeregu czasowego statystyk serwera.' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// New stats endpoints: Messages, Voice, Members, Export
// ─────────────────────────────────────────────────────────────────────────────

const STATS_TOP_LIMIT_DEFAULT = 10;
const STATS_TOP_LIMIT_MAX = 100;

const VOICE_CHANNEL_TYPES = new Set([2, 13]); // GUILD_VOICE, GUILD_STAGE_VOICE

async function resolveChannelsMap(guildId: string): Promise<Map<string, { name: string; type: number }>> {
    try {
        const channels = await getGuildAllChannels(guildId);
        return new Map(channels.map((ch) => [ch.id, { name: ch.name, type: ch.type }]));
    } catch {
        return new Map();
    }
}

// ── Messages tab ──────────────────────────────────────────────────────────────

// GET /api/stats/messages/summary?startDate=&endDate=
apiRouter.get('/stats/messages/summary', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) { res.status(500).json({ error: 'Brakuje GUILD_ID.' }); return; }
    const range = parseStatsDateRange(req.query.startDate, req.query.endDate);
    if (!range) { res.status(400).json({ error: 'Wymagane startDate i endDate (YYYY-MM-DD, max 365 dni).' }); return; }
    try {
        const summary = await getMessageSummary(guildId, range.startDate, range.endDate);
        res.json({ summary });
    } catch (error) {
        apiLogger.error('STATS_MESSAGES_SUMMARY_FAILED', 'Nie udalo sie pobrac podsumowania wiadomosci.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać podsumowania wiadomości.' });
    }
});

// GET /api/stats/messages/timeseries?startDate=&endDate=
apiRouter.get('/stats/messages/timeseries', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) { res.status(500).json({ error: 'Brakuje GUILD_ID.' }); return; }
    const range = parseStatsDateRange(req.query.startDate, req.query.endDate);
    if (!range) { res.status(400).json({ error: 'Wymagane startDate i endDate (YYYY-MM-DD, max 365 dni).' }); return; }
    try {
        const timeSeries = await getMessageTimeSeries(guildId, range.startDate, range.endDate);
        res.json({ timeSeries });
    } catch (error) {
        apiLogger.error('STATS_MESSAGES_TIMESERIES_FAILED', 'Nie udalo sie pobrac szeregu wiadomosci.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać szeregu czasowego wiadomości.' });
    }
});

// GET /api/stats/messages/top-users?startDate=&endDate=&limit=10
apiRouter.get('/stats/messages/top-users', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) { res.status(500).json({ error: 'Brakuje GUILD_ID.' }); return; }
    const range = parseStatsDateRange(req.query.startDate, req.query.endDate);
    if (!range) { res.status(400).json({ error: 'Wymagane startDate i endDate (YYYY-MM-DD, max 365 dni).' }); return; }
    const limit = Math.max(1, Math.min(STATS_TOP_LIMIT_MAX, parsePositiveIntQuery(req.query.limit, STATS_TOP_LIMIT_DEFAULT)));
    try {
        const rawUsers = await getTopMessageUsers(guildId, range.startDate, range.endDate, limit);
        const uniqueUserIds = [...new Set(rawUsers.map((u) => u.userId))];
        const profilePairs = await resolveLeaderboardProfilesWithLimit(guildId, uniqueUserIds);
        const profileByUserId = new Map(profilePairs);
        const topUsers = rawUsers.map((u) => ({
            ...u,
            displayName: profileByUserId.get(u.userId)?.displayName ?? `Użytkownik ${u.userId}`,
            avatarUrl: profileByUserId.get(u.userId)?.avatarUrl ?? null,
        }));
        res.json({ topUsers });
    } catch (error) {
        apiLogger.error('STATS_MESSAGES_TOP_USERS_FAILED', 'Nie udalo sie pobrac top uzytkownikow wiadomosci.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać rankingu użytkowników.' });
    }
});

// GET /api/stats/messages/top-channels?startDate=&endDate=&limit=10
apiRouter.get('/stats/messages/top-channels', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) { res.status(500).json({ error: 'Brakuje GUILD_ID.' }); return; }
    const range = parseStatsDateRange(req.query.startDate, req.query.endDate);
    if (!range) { res.status(400).json({ error: 'Wymagane startDate i endDate (YYYY-MM-DD, max 365 dni).' }); return; }
    const limit = Math.max(1, Math.min(STATS_TOP_LIMIT_MAX, parsePositiveIntQuery(req.query.limit, STATS_TOP_LIMIT_DEFAULT)));
    try {
        const [rawChannels, channelInfo] = await Promise.all([
            getTopMessageChannels(guildId, range.startDate, range.endDate, limit),
            resolveChannelsMap(guildId),
        ]);
        const topChannels = rawChannels
            .filter((ch) => !VOICE_CHANNEL_TYPES.has(channelInfo.get(ch.channelId)?.type ?? 0))
            .map((ch) => ({
                ...ch,
                channelName: channelInfo.get(ch.channelId)?.name ?? `#${ch.channelId}`,
            }));
        res.json({ topChannels });
    } catch (error) {
        apiLogger.error('STATS_MESSAGES_TOP_CHANNELS_FAILED', 'Nie udalo sie pobrac top kanalow wiadomosci.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać rankingu kanałów.' });
    }
});

// ── Voice tab ─────────────────────────────────────────────────────────────────

// GET /api/stats/voice/summary?startDate=&endDate=
apiRouter.get('/stats/voice/summary', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) { res.status(500).json({ error: 'Brakuje GUILD_ID.' }); return; }
    const range = parseStatsDateRange(req.query.startDate, req.query.endDate);
    if (!range) { res.status(400).json({ error: 'Wymagane startDate i endDate (YYYY-MM-DD, max 365 dni).' }); return; }
    try {
        const summary = await getVoiceSummary(guildId, range.startDate, range.endDate);
        res.json({ summary });
    } catch (error) {
        apiLogger.error('STATS_VOICE_SUMMARY_FAILED', 'Nie udalo sie pobrac podsumowania voice.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać podsumowania voice.' });
    }
});

// GET /api/stats/voice/timeseries?startDate=&endDate=
apiRouter.get('/stats/voice/timeseries', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) { res.status(500).json({ error: 'Brakuje GUILD_ID.' }); return; }
    const range = parseStatsDateRange(req.query.startDate, req.query.endDate);
    if (!range) { res.status(400).json({ error: 'Wymagane startDate i endDate (YYYY-MM-DD, max 365 dni).' }); return; }
    try {
        const timeSeries = await getVoiceTimeSeries(guildId, range.startDate, range.endDate);
        res.json({ timeSeries });
    } catch (error) {
        apiLogger.error('STATS_VOICE_TIMESERIES_FAILED', 'Nie udalo sie pobrac szeregu voice.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać szeregu czasowego voice.' });
    }
});

// GET /api/stats/voice/top-users?startDate=&endDate=&limit=10
apiRouter.get('/stats/voice/top-users', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) { res.status(500).json({ error: 'Brakuje GUILD_ID.' }); return; }
    const range = parseStatsDateRange(req.query.startDate, req.query.endDate);
    if (!range) { res.status(400).json({ error: 'Wymagane startDate i endDate (YYYY-MM-DD, max 365 dni).' }); return; }
    const limit = Math.max(1, Math.min(STATS_TOP_LIMIT_MAX, parsePositiveIntQuery(req.query.limit, STATS_TOP_LIMIT_DEFAULT)));
    try {
        const rawUsers = await getTopVoiceUsers(guildId, range.startDate, range.endDate, limit);
        const uniqueUserIds = [...new Set(rawUsers.map((u) => u.userId))];
        const profilePairs = await resolveLeaderboardProfilesWithLimit(guildId, uniqueUserIds);
        const profileByUserId = new Map(profilePairs);
        const topUsers = rawUsers.map((u) => ({
            ...u,
            displayName: profileByUserId.get(u.userId)?.displayName ?? `Użytkownik ${u.userId}`,
            avatarUrl: profileByUserId.get(u.userId)?.avatarUrl ?? null,
        }));
        res.json({ topUsers });
    } catch (error) {
        apiLogger.error('STATS_VOICE_TOP_USERS_FAILED', 'Nie udalo sie pobrac top uzytkownikow voice.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać rankingu użytkowników voice.' });
    }
});

// GET /api/stats/voice/top-channels?startDate=&endDate=&limit=10
apiRouter.get('/stats/voice/top-channels', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) { res.status(500).json({ error: 'Brakuje GUILD_ID.' }); return; }
    const range = parseStatsDateRange(req.query.startDate, req.query.endDate);
    if (!range) { res.status(400).json({ error: 'Wymagane startDate i endDate (YYYY-MM-DD, max 365 dni).' }); return; }
    const limit = Math.max(1, Math.min(STATS_TOP_LIMIT_MAX, parsePositiveIntQuery(req.query.limit, STATS_TOP_LIMIT_DEFAULT)));
    try {
        const [rawChannels, channelInfo] = await Promise.all([
            getTopVoiceChannels(guildId, range.startDate, range.endDate, limit),
            resolveChannelsMap(guildId),
        ]);
        const topChannels = rawChannels
            .filter((ch) => VOICE_CHANNEL_TYPES.has(channelInfo.get(ch.channelId)?.type ?? 0))
            .map((ch) => ({
                ...ch,
                channelName: channelInfo.get(ch.channelId)?.name ?? `#${ch.channelId}`,
            }));
        res.json({ topChannels });
    } catch (error) {
        apiLogger.error('STATS_VOICE_TOP_CHANNELS_FAILED', 'Nie udalo sie pobrac top kanalow voice.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać rankingu kanałów voice.' });
    }
});

// ── Members tab ───────────────────────────────────────────────────────────────

// GET /api/stats/members/summary?startDate=&endDate=
apiRouter.get('/stats/members/summary', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) { res.status(500).json({ error: 'Brakuje GUILD_ID.' }); return; }
    const range = parseStatsDateRange(req.query.startDate, req.query.endDate);
    if (!range) { res.status(400).json({ error: 'Wymagane startDate i endDate (YYYY-MM-DD, max 365 dni).' }); return; }
    try {
        const summary = await getMemberSummary(guildId, range.startDate, range.endDate);
        res.json({ summary });
    } catch (error) {
        apiLogger.error('STATS_MEMBERS_SUMMARY_FAILED', 'Nie udalo sie pobrac podsumowania czlonkow.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać podsumowania członków.' });
    }
});

// GET /api/stats/members/timeseries?startDate=&endDate=
apiRouter.get('/stats/members/timeseries', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) { res.status(500).json({ error: 'Brakuje GUILD_ID.' }); return; }
    const range = parseStatsDateRange(req.query.startDate, req.query.endDate);
    if (!range) { res.status(400).json({ error: 'Wymagane startDate i endDate (YYYY-MM-DD, max 365 dni).' }); return; }
    try {
        const timeSeries = await getMemberTimeSeries(guildId, range.startDate, range.endDate);
        res.json({ timeSeries });
    } catch (error) {
        apiLogger.error('STATS_MEMBERS_TIMESERIES_FAILED', 'Nie udalo sie pobrac szeregu czlonkow.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać szeregu czasowego członków.' });
    }
});

// GET /api/stats/members/active-users?startDate=&endDate=
apiRouter.get('/stats/members/active-users', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) { res.status(500).json({ error: 'Brakuje GUILD_ID.' }); return; }
    const range = parseStatsDateRange(req.query.startDate, req.query.endDate);
    if (!range) { res.status(400).json({ error: 'Wymagane startDate i endDate (YYYY-MM-DD, max 365 dni).' }); return; }
    try {
        const rawUsers = await getActiveUsersInPeriod(guildId, range.startDate, range.endDate);
        const uniqueUserIds = [...new Set(rawUsers.map((u) => u.userId))];
        const profilePairs = await resolveLeaderboardProfilesWithLimit(guildId, uniqueUserIds);
        const profileByUserId = new Map(profilePairs);
        const activeUsers = rawUsers.map((u) => ({
            ...u,
            displayName: profileByUserId.get(u.userId)?.displayName ?? `Użytkownik ${u.userId}`,
            avatarUrl: profileByUserId.get(u.userId)?.avatarUrl ?? null,
        }));
        res.json({ activeUsers });
    } catch (error) {
        apiLogger.error('STATS_MEMBERS_ACTIVE_FAILED', 'Nie udalo sie pobrac aktywnych uzytkownikow.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać aktywnych użytkowników.' });
    }
});

// ── Per-tab CSV exports ───────────────────────────────────────────────────────

function rowsToCsv(headers: string[], rows: string[][]): string {
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [headers.map(escape).join(',')];
    for (const row of rows) {
        lines.push(row.map(escape).join(','));
    }
    return lines.join('\r\n');
}

// GET /api/stats/export/messages?startDate=&endDate=
apiRouter.get('/stats/export/messages', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) { res.status(500).json({ error: 'Brakuje GUILD_ID.' }); return; }
    const range = parseStatsDateRange(req.query.startDate, req.query.endDate);
    if (!range) { res.status(400).json({ error: 'Wymagane startDate i endDate (YYYY-MM-DD, max 365 dni).' }); return; }
    try {
        const rows = await getAllUserStatsForExport(guildId);
        const filtered = rows.filter((r) => r.date >= range.startDate && r.date <= range.endDate && r.messages > 0);
        const csv = rowsToCsv(
            ['date', 'user_id', 'messages'],
            filtered.map((r) => [r.date, r.userId, String(r.messages)]),
        );
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="messages_${range.startDate}_${range.endDate}.csv"`);
        res.send(csv);
    } catch (error) {
        apiLogger.error('STATS_EXPORT_MESSAGES_FAILED', 'Nie udalo sie eksportowac wiadomosci CSV.', {}, error);
        res.status(500).json({ error: 'Nie udało się wygenerować eksportu.' });
    }
});

// GET /api/stats/export/voice?startDate=&endDate=
apiRouter.get('/stats/export/voice', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) { res.status(500).json({ error: 'Brakuje GUILD_ID.' }); return; }
    const range = parseStatsDateRange(req.query.startDate, req.query.endDate);
    if (!range) { res.status(400).json({ error: 'Wymagane startDate i endDate (YYYY-MM-DD, max 365 dni).' }); return; }
    try {
        const rows = await getAllUserStatsForExport(guildId);
        const filtered = rows.filter((r) => r.date >= range.startDate && r.date <= range.endDate && r.voiceMinutes > 0);
        const csv = rowsToCsv(
            ['date', 'user_id', 'voice_minutes'],
            filtered.map((r) => [r.date, r.userId, String(r.voiceMinutes)]),
        );
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="voice_${range.startDate}_${range.endDate}.csv"`);
        res.send(csv);
    } catch (error) {
        apiLogger.error('STATS_EXPORT_VOICE_FAILED', 'Nie udalo sie eksportowac voice CSV.', {}, error);
        res.status(500).json({ error: 'Nie udało się wygenerować eksportu.' });
    }
});

// GET /api/stats/export/members?startDate=&endDate=
apiRouter.get('/stats/export/members', requireCurrentDashboardRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) { res.status(500).json({ error: 'Brakuje GUILD_ID.' }); return; }
    const range = parseStatsDateRange(req.query.startDate, req.query.endDate);
    if (!range) { res.status(400).json({ error: 'Wymagane startDate i endDate (YYYY-MM-DD, max 365 dni).' }); return; }
    try {
        const rows = await getAllMemberCountsForExport(guildId);
        const filtered = rows.filter((r) => r.date >= range.startDate && r.date <= range.endDate);
        const csv = rowsToCsv(
            ['date', 'member_count', 'joins', 'leaves'],
            filtered.map((r) => [r.date, String(r.memberCount), String(r.joins), String(r.leaves)]),
        );
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="members_${range.startDate}_${range.endDate}.csv"`);
        res.send(csv);
    } catch (error) {
        apiLogger.error('STATS_EXPORT_MEMBERS_FAILED', 'Nie udalo sie eksportowac czlonkow CSV.', {}, error);
        res.status(500).json({ error: 'Nie udało się wygenerować eksportu.' });
    }
});

// GET /api/stats/export/all — ZIP with all historical data
apiRouter.get('/stats/export/all', requireCurrentDashboardRole, async (_req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) { res.status(500).json({ error: 'Brakuje GUILD_ID.' }); return; }
    try {
        const [userRows, channelRows, memberRows] = await Promise.all([
            getAllUserStatsForExport(guildId),
            getAllChannelStatsForExport(guildId),
            getAllMemberCountsForExport(guildId),
        ]);

        const usersCsv = rowsToCsv(
            ['date', 'user_id', 'messages', 'voice_minutes'],
            userRows.map((r) => [r.date, r.userId, String(r.messages), String(r.voiceMinutes)]),
        );
        const channelsCsv = rowsToCsv(
            ['date', 'channel_id', 'messages', 'voice_minutes'],
            channelRows.map((r) => [r.date, r.channelId, String(r.messages), String(r.voiceMinutes)]),
        );
        const membersCsv = rowsToCsv(
            ['date', 'member_count', 'joins', 'leaves'],
            memberRows.map((r) => [r.date, String(r.memberCount), String(r.joins), String(r.leaves)]),
        );

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="stats_export_all.zip"');

        const archive = archiver('zip', { zlib: { level: 6 } });
        archive.on('error', (err: Error) => {
            apiLogger.error('STATS_EXPORT_ALL_ARCHIVE_ERROR', 'Blad archiwum ZIP.', {}, err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Nie udało się wygenerować archiwum.' });
            }
        });
        archive.pipe(res);
        archive.append(usersCsv, { name: 'users_daily.csv' });
        archive.append(channelsCsv, { name: 'channels_daily.csv' });
        archive.append(membersCsv, { name: 'member_counts.csv' });
        await archive.finalize();
    } catch (error) {
        apiLogger.error('STATS_EXPORT_ALL_FAILED', 'Nie udalo sie eksportowac wszystkich danych.', {}, error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Nie udało się wygenerować eksportu.' });
        }
    }
});

// POST /api/stats/reset — usuwa wszystkie statystyki serwera
apiRouter.post('/stats/reset', requireCurrentDashboardRole, async (_req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) { res.status(500).json({ error: 'Brakuje GUILD_ID.' }); return; }
    try {
        await resetAllStats(guildId);
        res.json({ ok: true });
    } catch (error) {
        apiLogger.error('STATS_RESET_FAILED', 'Nie udalo sie zresetowac statystyk.', {}, error);
        res.status(500).json({ error: 'Nie udało się zresetować statystyk.' });
    }
});
