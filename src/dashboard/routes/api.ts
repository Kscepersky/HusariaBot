import { Router, type NextFunction, type Request, type Response } from 'express';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middleware/require-auth.js';
import {
    createExternalGuildScheduledEvent,
    deleteGuildScheduledEvent,
    getGuildTextChannels,
    getGuildRoles,
    getGuildEmojis,
    getGuildMember,
    addGuildMemberRole,
    removeGuildMemberRole,
    updateGuildMemberRoles,
    listGuildScheduledEvents,
    hasDevRole,
    hasRequiredRole,
    searchGuildMembers,
    listImages,
    sendImageToChannel,
    updateGuildScheduledEvent,
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
import { parseTimeoutDurationParts } from '../../timeouts/duration.js';

config();

export const apiRouter = Router();

const LEADERBOARD_PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const LEADERBOARD_PROFILE_FAILURE_CACHE_TTL_MS = 30 * 1000;
const LEADERBOARD_PROFILE_CACHE_MAX_ENTRIES = 1500;
const LEADERBOARD_PROFILE_CONCURRENCY_LIMIT = 5;
const LEADERBOARD_PROFILE_LOOKUP_TIMEOUT_MS = 3_000;

interface LeaderboardProfileCacheEntry {
    displayName: string;
    avatarUrl: string | null;
    expiresAt: number;
}

const leaderboardProfileCache = new Map<string, LeaderboardProfileCacheEntry>();
const leaderboardProfileInFlight = new Map<string, Promise<{ displayName: string; avatarUrl: string | null }>>();

function isClientValidationError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    return [
        'nie istnieje',
        'nieobsługiwany format',
        'nieprawidłowy format',
        'za duży',
        'zawartość pliku nie zgadza się',
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
            console.warn('Failed to sync imported economy role mapping for user:', {
                guildId,
                userId: importedUser.userId,
                error,
            });
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
        if (cacheEntry.expiresAt <= now) {
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

async function resolveLeaderboardProfile(guildId: string, userId: string): Promise<{ displayName: string; avatarUrl: string | null }> {
    const cacheKey = getLeaderboardProfileCacheKey(guildId, userId);
    const now = Date.now();
    const cachedEntry = leaderboardProfileCache.get(cacheKey);

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
        try {
            const member = await withTimeout(
                getGuildMember(userId, guildId),
                LEADERBOARD_PROFILE_LOOKUP_TIMEOUT_MS,
                `Timeout while loading leaderboard profile for user ${userId}`,
            );
            const resolvedProfile = {
                displayName: resolveLeaderboardDisplayName(member, userId),
                avatarUrl: resolveDiscordAvatarUrl(member?.user?.id ?? userId, member?.user?.avatar),
            };

            leaderboardProfileCache.set(cacheKey, {
                ...resolvedProfile,
                expiresAt: Date.now() + LEADERBOARD_PROFILE_CACHE_TTL_MS,
            });

            return resolvedProfile;
        } catch (error) {
            console.warn('Failed to resolve leaderboard profile:', {
                guildId,
                userId,
                error,
            });

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
    cleanupLeaderboardProfileCache(Date.now());

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
    const uniqueUserIds = [...new Set(leaderboard.entries.map((entry) => entry.userId).filter((userId) => userId.length > 0))];
    const profilePairs = await resolveLeaderboardProfilesWithLimit(guildId, uniqueUserIds);

    const profileByUserId = new Map(profilePairs);
    const enrichedEntries = leaderboard.entries.map((entry) => {
        const profile = profileByUserId.get(entry.userId);

        return {
            ...entry,
            displayName: profile?.displayName ?? `Uzytkownik ${entry.userId}`,
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
        console.error('Failed to verify dashboard role:', error);
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
        console.error('Failed to verify dashboard role:', error);
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
        console.error(`Failed to ${operation} Discord event (upstream):`, error);
        res.status(502).json({ error: `Nie udało się ${operation === 'create' ? 'utworzyć' : (operation === 'update' ? 'zaktualizować' : 'usunąć')} wydarzenia Discord (błąd usługi zewnętrznej).` });
        return;
    }

    console.error(`Failed to ${operation} Discord event:`, error);
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
apiRouter.get('/channels', async (_req, res) => {
    const guildId = process.env.GUILD_ID!;
    try {
        const channels = await getGuildTextChannels(guildId);
        res.json({ channels });
    } catch (err) {
        console.error('Failed to fetch channels:', err);
        res.status(500).json({ error: 'Nie udało się pobrać listy kanałów.' });
    }
});

// GET /api/channels/search — search channels for mention picker
apiRouter.get('/channels/search', async (req, res) => {
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
        console.error('Failed to search channels:', err);
        res.status(500).json({ error: 'Nie udało się wyszukać kanałów.' });
    }
});

// GET /api/roles — live role list from Discord
apiRouter.get('/roles', async (_req, res) => {
    const guildId = process.env.GUILD_ID!;

    try {
        const roles = await getGuildRoles(guildId);
        res.json({ roles });
    } catch (err) {
        console.error('Failed to fetch roles:', err);
        res.status(500).json({ error: 'Nie udało się pobrać listy ról.' });
    }
});

// GET /api/roles/search — search roles for mention picker
apiRouter.get('/roles/search', async (req, res) => {
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
        console.error('Failed to search roles:', err);
        res.status(500).json({ error: 'Nie udało się wyszukać ról.' });
    }
});

// GET /api/emojis — live emoji list from Discord
apiRouter.get('/emojis', async (_req, res) => {
    const guildId = process.env.GUILD_ID!;

    try {
        const emojis = await getGuildEmojis(guildId);
        res.json({ emojis });
    } catch (err) {
        console.error('Failed to fetch emojis:', err);
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
        console.error('Failed to search members:', err);
        res.status(500).json({ error: 'Nie udało się wyszukać użytkowników.' });
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
        console.error('Failed to list active timeouts:', error);
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

        const protectedStaffRoleIds = resolveProtectedStaffRoleIds();
        if (member.roles.some((roleId) => protectedStaffRoleIds.has(roleId))) {
            res.status(403).json({ error: 'Nie mozna nalozyc timeoutu na czlonka staffu.' });
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

        res.json({
            success: true,
            timeout: createdTimeout,
            duration: duration.normalized,
        });
    } catch (error) {
        if (createdTimeoutId !== null && !muteRoleAssigned) {
            await releaseEconomyTimeout({
                guildId,
                timeoutId: createdTimeoutId,
                releasedAt: Date.now(),
                releasedByUserId: adminUserId,
                releaseReason: 'Rollback timeoutu po bledzie API Discorda',
            }).catch((releaseError) => {
                console.error('Failed to rollback timeout after API error:', releaseError);
            });
        }

        if (error instanceof EconomyInputValidationError) {
            const isActiveTimeoutConflict = error.message.toLowerCase().includes('aktywny timeout');
            res.status(isActiveTimeoutConflict ? 409 : 400).json({ error: error.message });
            return;
        }

        console.error('Failed to create timeout from dashboard:', error);
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

        console.error('Failed to remove timeout from dashboard:', error);
        res.status(500).json({ error: 'Nie udalo sie zdjac timeoutu.' });
    }
});

// GET /api/images — list available images from /img directory
apiRouter.get('/images', (_req, res) => {
    try {
        const images = listImages();
        res.json({ images });
    } catch (err) {
        console.error('Failed to list images:', err);
        res.status(500).json({ error: 'Nie udało się pobrać listy obrazów.' });
    }
});

// GET /api/economy/settings — load economy configuration for dashboard
apiRouter.get('/economy/settings', requireCurrentDashboardDevRole, async (_req, res) => {
    try {
        const config = await getEconomyConfig();
        res.json({ config });
    } catch (error) {
        console.error('Failed to load economy settings:', error);
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
        console.error('Failed to update economy settings:', error);
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
        console.error('Failed to reset economy users:', error);
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
        console.error('Failed to apply manual economy mutation:', error);
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
        console.error('Failed to load economy level-role mappings:', error);
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

        console.error('Failed to update economy level-role mappings:', error);
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
            console.warn('Failed to sync level roles after economy CSV import:', roleSyncError);
        }

        res.json({ success: true, result, roleSync });
    } catch (error) {
        if (error instanceof EconomyCsvImportValidationError) {
            res.status(400).json({ error: error.message });
            return;
        }

        console.error('Failed to import economy CSV snapshot:', error);
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
        console.error('Failed to load economy leaderboard:', error);
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
            console.error('Failed to load Discord events (upstream):', error);
            res.status(502).json({ error: 'Nie udało się pobrać listy wydarzeń Discord (błąd usługi zewnętrznej).' });
            return;
        }

        console.error('Failed to load Discord events:', error);
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

        console.error('Failed to send image:', err);
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

        let insertedPost: ScheduledPost | null = null;
        try {
            insertedPost = await insertScheduledPost(sentPost);
        } catch (persistError) {
            console.error('Failed to persist sent post history:', persistError);
            warnings.push('Post został wysłany, ale nie udało się zapisać go w historii wysłanych postów.');
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
                console.error('Failed to persist watchparty status for sent post:', persistWatchpartyError);
            }

            if (updatedPost) {
                registerWatchpartyLifecycle(updatedPost);
            } else {
                warnings.push('Nie udało się zaktualizować statusu watchparty w historii wysłanych postów. Uruchomiono rollback kanału.');

                if (watchpartyResult.channelId) {
                    try {
                        await deleteWatchpartyChannel(watchpartyResult.channelId);
                    } catch (watchpartyCleanupError) {
                        console.error('Failed to rollback watchparty channel after persist error:', watchpartyCleanupError);
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

        console.error('Failed to publish message:', err);
        res.status(500).json({ error: 'Nie udało się opublikować wiadomości.' });
    }
});
