import { Router, type Response } from 'express';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middleware/require-auth.js';
import {
    createExternalGuildScheduledEvent,
    deleteGuildScheduledEvent,
    getGuildTextChannels,
    getGuildRoles,
    getGuildEmojis,
    listGuildScheduledEvents,
    searchGuildMembers,
    listImages,
    sendImageToChannel,
    updateGuildScheduledEvent,
    type DiscordScheduledEvent,
} from '../discord-api.js';
import {
    validateEmbedForm,
    type EmbedFormData,
    type EventDraftFormData,
    type MatchInfoSnapshot,
} from '../embed-handlers.js';
import { publishDashboardPost } from '../publish-flow.js';
import { tryCreateDiscordEventFromPayload } from '../event-publisher.js';
import { insertScheduledPost } from '../scheduler/store.js';
import { parseWarsawDateTimeToTimestamp } from '../scheduler/warsaw-time.js';
import type { ScheduledPost } from '../scheduler/types.js';

config();

export const apiRouter = Router();

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
apiRouter.get('/members/search', async (req, res) => {
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

    const form = sanitizeEventForm(req.body);

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

    const form = sanitizeEventForm(req.body);

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
    const { filename, channelId } = req.body as { filename?: string; channelId?: string };

    if (!filename || typeof filename !== 'string') {
        res.status(400).json({ error: 'Nazwa pliku jest wymagana.' });
        return;
    }
    if (!channelId || typeof channelId !== 'string' || !/^\d{17,20}$/.test(channelId)) {
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
    const data = sanitizeEmbedPayload(req.body);

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

        try {
            await insertScheduledPost(sentPost);
        } catch (persistError) {
            console.error('Failed to persist sent post history:', persistError);
            warnings.push('Post został wysłany, ale nie udało się zapisać go w historii wysłanych postów.');
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

        console.error('Failed to publish message:', err);
        res.status(500).json({ error: 'Nie udało się opublikować wiadomości.' });
    }
});
