import { Router, type NextFunction, type Request, type Response } from 'express';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { existsSync,  } from 'node:fs';
import { buildActorContext } from './actor-context.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requireSectionAccess, resolveCurrentDashboardRole } from '../middleware/require-section-access.js';
import { isDashboardLanguage, resolveAllowedSections, resolveDefaultLanguage } from '../dashboard-sections.js';
import {
    createExternalGuildScheduledEvent,
    deleteGuildScheduledEvent,
    getGuildTextChannels,
    getGuildRoles,
    getGuildEmojis,
    getGuildMember,
    addGuildMemberRole,
    removeGuildMemberRole,
    listGuildScheduledEvents,
    hasDevRole,
    hasRequiredRole,
    searchGuildMembers,
    sendImageToChannel,
    sendDirectMessage,
    updateGuildScheduledEvent,
    DiscordRateLimitedError,
    type DiscordScheduledEvent,
} from '../discord-api.js';
import {
    validateEmbedForm,
} from '../embed-handlers.js';
import {
    dashboardEventSchema,
    embedPayloadSchema,
    sendImageSchema,
    timeoutCreateSchema,
    timeoutRemoveSchema,
    zodErrorToMessage,
} from '../validation/request-schemas.js';
import { verifyTargetChannel } from '../channel-guard.js';
import { parsePositiveIntQuery } from './query-utils.js';
import { economyRouter } from './api.economy.js';
import { imagesRouter, isClientValidationError } from './api.images.js';
import { statsRouter } from './api.stats.js';
import { publishDashboardPost } from '../publish-flow.js';
import {
    normalizeTrimmedString,
    sanitizeEmbedPayload,
} from '../payload-sanitizer.js';
import { tryCreateDiscordEventFromPayload } from '../event-publisher.js';
import { insertScheduledPost } from '../scheduler/store.js';
import { parseWarsawDateTimeToTimestamp } from '../scheduler/warsaw-time.js';
import type { ScheduledPost } from '../scheduler/types.js';
import {
    EconomyInputValidationError,
    createEconomyTimeout,
    getActiveEconomyTimeoutForUser,
    getEconomyTimeoutById,
    listActiveEconomyTimeouts,
    releaseEconomyTimeout,
} from '../../economy/repository.js';
import { parseTimeoutDurationParts } from '../../timeouts/duration.js';
import { clearTicketHistory, listTicketHistoryEntries, resolveTicketTranscriptFilePath } from '../../tickets/history-store.js';
import { createLogger } from '../../utils/logger.js';
import { listDashboardLogs } from '../../utils/log-reader.js';
import { LOG_CATEGORIES, type LogCategory } from '../../utils/log-categories.js';

const LOG_RANGE_MS: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
};
import { enrichWithDiscordUser } from '../../utils/discord-user-cache.js';
import { listSessionActivity } from '../session/session-events.js';

config();

export const apiRouter = Router();

const TICKET_HISTORY_PAGE_SIZE_DEFAULT = 20;
const TICKET_HISTORY_PAGE_SIZE_MAX = 100;
const apiLogger = createLogger('dashboard:api');




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










function resolveServerMuteRoleId(): string | null {
    const roleId = String(process.env.SERVER_MUTE_ROLE_ID ?? '').trim();
    if (!/^\d{17,20}$/.test(roleId)) {
        return null;
    }

    return roleId;
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

// GET /api/me/access — rola, dozwolone sekcje i jezyk dashboardu.
// Front buduje na tym nawigacje zamiast zgadywac uprawnienia z kodow 403.
apiRouter.get('/me/access', async (req, res) => {
    try {
        const role = await resolveCurrentDashboardRole(req);
        if (!role || role === 'member') {
            res.status(403).json({ error: 'Brak uprawnień do panelu.' });
            return;
        }

        // Rola w Discordzie mogla sie zmienic po zalogowaniu — odswiez sesje.
        if (req.session.user && req.session.user.dashboardRole !== role) {
            req.session.user = { ...req.session.user, dashboardRole: role };
        }

        res.json({
            role,
            allowedSections: resolveAllowedSections(role),
            language: req.session.language ?? resolveDefaultLanguage(role),
            languageSource: req.session.language ? 'user' : 'default',
        });
    } catch (error) {
        apiLogger.error('DASHBOARD_ACCESS_RESOLVE_FAILED', 'Failed to resolve dashboard access.', {
            actorUserId: req.session.user?.id,
        }, error);
        res.status(502).json({ error: 'Nie udało się zweryfikować uprawnień użytkownika.' });
    }
});

// PATCH /api/me/language — zapisuje recznie wybrany jezyk dashboardu.
apiRouter.patch('/me/language', (req, res) => {
    const language = (req.body as { language?: unknown } | undefined)?.language;

    if (!isDashboardLanguage(language)) {
        res.status(400).json({ error: 'Nieprawidłowy język. Dozwolone wartości: pl, en.' });
        return;
    }

    req.session.language = language;
    res.json({ language });
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

    const settled = await Promise.allSettled(
        ids.map(async (id) => {
            const member = await getGuildMember(id, guildId);
            if (!member) return null;
            const displayName = member.nick ?? member.user?.global_name ?? member.user?.username ?? id;
            const avatarHash = member.user?.avatar ?? null;
            const avatarUrl = avatarHash
                ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(id)}/${encodeURIComponent(avatarHash)}.png?size=64`
                : null;
            return { id, displayName, avatarUrl };
        }),
    );

    const members = settled.flatMap((result) => (result.status === 'fulfilled' && result.value ? [result.value] : []));
    const failures = settled.flatMap((result) => (result.status === 'rejected' ? [result.reason as unknown] : []));

    if (failures.length === 0) {
        res.json({ members });
        return;
    }

    // Czesciowy wynik jest lepszy niz blad: front pokaze ID dla brakujacych i dociagnie je przy kolejnym odswiezeniu.
    if (members.length > 0) {
        apiLogger.warn('MEMBERS_BY_IDS_PARTIAL', 'Pobrano tylko czesc czlonkow serwera po ID.', {
            requestedCount: ids.length,
            failedCount: failures.length,
        });
        res.json({ members, partial: true });
        return;
    }

    const rateLimited = failures.find((failure): failure is DiscordRateLimitedError => failure instanceof DiscordRateLimitedError);
    if (rateLimited) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(rateLimited.retryAfterSeconds))));
        res.status(503).json({ error: 'Discord chwilowo ogranicza zapytania. Spróbuj ponownie za chwilę.' });
        return;
    }

    apiLogger.error('MEMBERS_BY_IDS_FETCH_FAILED', 'Nie udalo sie pobrac czlonkow serwera po ID.', {
        requestedCount: ids.length,
    }, failures[0]);
    res.status(500).json({ error: 'Nie udało się pobrać danych użytkowników.' });
});

// GET /api/timeouts — list active timeouts in current guild
apiRouter.get('/timeouts', requireSectionAccess('timeouts-system'), async (req, res) => {
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
apiRouter.post('/timeouts', requireSectionAccess('timeouts-system'), async (req, res) => {
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
apiRouter.post('/timeouts/:timeoutId/remove', requireSectionAccess('timeouts-system'), async (req, res) => {
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

// GET /api/tickets/history — list closed ticket history records
apiRouter.get('/tickets/history', requireSectionAccess('ticket-history'), async (req, res) => {
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
apiRouter.delete('/tickets/history', requireSectionAccess('ticket-history'), async (req, res) => {
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
apiRouter.get('/tickets/transcripts/:fileName', requireSectionAccess('ticket-history'), (req, res) => {
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
apiRouter.get('/logs', requireSectionAccess('system-logs'), async (req, res) => {
    const page = parsePositiveIntQuery(req.query.page, 1);
    const pageSize = Math.max(1, Math.min(100, parsePositiveIntQuery(req.query.pageSize, 25)));
    const search = normalizeTrimmedString(req.query.search);
    const levelRaw = normalizeTrimmedString(req.query.level).toLowerCase();
    const allowedLogLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
    const level = (allowedLogLevels as readonly string[]).includes(levelRaw)
        ? levelRaw as (typeof allowedLogLevels)[number]
        : 'all';

    const scopeRaw = normalizeTrimmedString(req.query.scope);
    const scope = /^[\w:.-]{1,64}$/.test(scopeRaw) ? scopeRaw : 'all';
    const hideNoise = normalizeTrimmedString(req.query.hideNoise) !== '0';
    const categoryRaw = normalizeTrimmedString(req.query.category).toLowerCase();
    const category = (LOG_CATEGORIES as readonly string[]).includes(categoryRaw) ? categoryRaw as LogCategory : 'all';
    const rangeMs = LOG_RANGE_MS[normalizeTrimmedString(req.query.range)] ?? 0;
    const sinceMs = rangeMs > 0 ? Date.now() - rangeMs : 0;

    try {
        const result = await listDashboardLogs({
            page,
            pageSize,
            search,
            level,
            scope,
            hideNoise,
            category,
            sinceMs,
        });

        const enrichedEntries = result.entries.map((entry) => {
            const actorId = typeof entry.context?.actorUserId === 'string' ? entry.context.actorUserId : undefined;
            const targetId = typeof entry.context?.targetUserId === 'string'
                ? entry.context.targetUserId
                : (typeof entry.context?.userId === 'string' ? entry.context.userId : undefined);
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
            hiddenNoiseCount: result.hiddenNoiseCount,
            scopes: result.scopes,
            summary: result.summary,
            filters: {
                level,
                search,
                scope,
                hideNoise,
                category,
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
apiRouter.get('/sessions/activity', requireSectionAccess('session-activity'), async (req, res) => {
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

// GET /api/events — list Discord scheduled events
apiRouter.get('/events', requireSectionAccess('events'), async (_req, res) => {
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
apiRouter.post('/events', requireSectionAccess('events'), async (req, res) => {
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
apiRouter.patch('/events/:id', requireSectionAccess('events'), async (req, res) => {
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
apiRouter.delete('/events/:id', requireSectionAccess('events'), async (req, res) => {
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
apiRouter.post('/send-image', requireSectionAccess('embed-creator'), async (req, res) => {
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

    if (!await verifyTargetChannel(channelId, res)) {
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
apiRouter.post('/embed', requireSectionAccess('embed-creator'), async (req, res) => {
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

    if (!await verifyTargetChannel(data.channelId, res)) {
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

        res.json({
            success: true,
            messageId: publishResult.messageId,
            pingMessageId: publishResult.pingMessageId,
            imageMessageId: publishResult.imageMessageId,
            warnings,
            eventStatus: eventResult.status,
            eventError: eventResult.eventError,
            discordEventId: eventResult.eventId,
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



apiRouter.use(statsRouter);
apiRouter.use(imagesRouter);
apiRouter.use(economyRouter);
