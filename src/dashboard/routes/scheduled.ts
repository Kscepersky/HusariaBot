import { randomUUID } from 'crypto';
import { Router } from 'express';
import { deleteChannelMessage, deleteGuildScheduledEvent } from '../discord-api.js';
import { validateEmbedForm, type EmbedFormData, type EventDraftFormData, type MatchInfoSnapshot } from '../embed-handlers.js';
import { tryCreateDiscordEventFromPayload } from '../event-publisher.js';
import { requireAuth } from '../middleware/require-auth.js';
import { publishDashboardPost } from '../publish-flow.js';
import { parseWarsawDateTimeToTimestamp } from '../scheduler/warsaw-time.js';
import {
    scheduledPayloadSchema,
    scheduledSentEditPayloadSchema,
    zodErrorToMessage,
} from '../validation/request-schemas.js';
import {
    deleteScheduledPostById,
    getScheduledPostById,
    insertScheduledPost,
    listScheduledPosts,
    updateScheduledPost,
} from '../scheduler/store.js';
import { registerScheduledPost, unregisterScheduledPost } from '../scheduler/service.js';
import type { ScheduledPost } from '../scheduler/types.js';

export const scheduledRouter = Router();

interface ScheduledPostRequestBody extends Omit<EmbedFormData, 'mentionRoleEnabled'> {
    mentionRoleEnabled?: boolean | string;
    scheduleAtLocal?: string;
}

interface ScheduledPostEditRequestBody extends ScheduledPostRequestBody {}

function normalizeTrimmedString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeBoolean(value: unknown): boolean {
    return value === true || value === 'true';
}

function isValidChannelId(channelId: string): boolean {
    return /^\d{17,20}$/.test(channelId);
}

function isValidPingTarget(value: string): boolean {
    return value === 'everyone' || value === 'here' || /^\d{17,20}$/.test(value);
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

function normalizeEventDraftForCompare(input: EventDraftFormData | undefined): {
    enabled: boolean;
    title: string;
    description: string;
    location: string;
    startAtLocal: string;
    endAtLocal: string;
} | null {
    if (!input || input.enabled !== true) {
        return null;
    }

    return {
        enabled: true,
        title: normalizeTrimmedString(input.title),
        description: normalizeTrimmedString(input.description),
        location: normalizeTrimmedString(input.location),
        startAtLocal: normalizeTrimmedString(input.startAtLocal),
        endAtLocal: normalizeTrimmedString(input.endAtLocal),
    };
}

function areEventDraftsEqual(left: EventDraftFormData | undefined, right: EventDraftFormData | undefined): boolean {
    const normalizedLeft = normalizeEventDraftForCompare(left);
    const normalizedRight = normalizeEventDraftForCompare(right);

    if (!normalizedLeft || !normalizedRight) {
        return false;
    }

    return normalizedLeft.title === normalizedRight.title
        && normalizedLeft.description === normalizedRight.description
        && normalizedLeft.location === normalizedRight.location
        && normalizedLeft.startAtLocal === normalizedRight.startAtLocal
        && normalizedLeft.endAtLocal === normalizedRight.endAtLocal;
}

function sanitizePayload(input: ScheduledPostRequestBody): EmbedFormData {
    const mentionRoleId = normalizeTrimmedString(input.mentionRoleId);
    const mentionRoleEnabled = input.mentionRoleEnabled === true || input.mentionRoleEnabled === 'true';

    return {
        mode: input.mode,
        channelId: normalizeTrimmedString(input.channelId),
        title: normalizeTrimmedString(input.title),
        content: normalizeTrimmedString(input.content),
        colorName: normalizeTrimmedString(input.colorName),
        mentionRoleEnabled,
        mentionRoleId: mentionRoleEnabled ? mentionRoleId : '',
        imageMode: input.imageMode,
        imageFilename: normalizeTrimmedString(input.imageFilename),
        uploadFileName: normalizeTrimmedString(input.uploadFileName),
        uploadMimeType: normalizeTrimmedString(input.uploadMimeType),
        uploadBase64: normalizeTrimmedString(input.uploadBase64),
        matchInfo: sanitizeMatchInfo(input.matchInfo),
        eventDraft: sanitizeEventDraft(input.eventDraft),
    };
}

async function deletePostMessages(post: ScheduledPost): Promise<string[]> {
    const warnings: string[] = [];
    const messageIds: Array<{ id?: string; label: string }> = [
        { id: post.messageId, label: 'główna wiadomość' },
        { id: post.pingMessageId, label: 'wiadomość z pingiem' },
        { id: post.imageMessageId, label: 'wiadomość z grafiką' },
    ];

    await Promise.all(messageIds.map(async ({ id, label }) => {
        if (!id) {
            return;
        }

        try {
            await deleteChannelMessage(post.payload.channelId, id);
        } catch {
            warnings.push(`Nie udało się usunąć poprzedniej wiadomości: ${label}.`);
        }
    }));

    return warnings;
}

function toListResponsePost(post: ScheduledPost): ScheduledPost {
    return {
        ...post,
        payload: {
            ...post.payload,
            uploadBase64: post.payload.uploadBase64 ? '[stored]' : '',
        },
    };
}

scheduledRouter.use(requireAuth);

scheduledRouter.get('/', async (_req, res) => {
    try {
        const posts = await listScheduledPosts();
        const pendingPosts = posts
            .filter((post) => post.status === 'pending')
            .sort((left, right) => left.scheduledFor - right.scheduledFor)
            .map(toListResponsePost);

        res.json({ posts: pendingPosts });
    } catch (error) {
        console.error('Failed to load scheduled posts:', error);
        res.status(500).json({ error: 'Nie udało się pobrać zaplanowanych postów.' });
    }
});

scheduledRouter.get('/sent', async (_req, res) => {
    try {
        const posts = await listScheduledPosts();
        const sentPosts = posts
            .filter((post) => post.status === 'sent')
            .sort((left, right) => (right.sentAt ?? right.updatedAt) - (left.sentAt ?? left.updatedAt))
            .map(toListResponsePost);

        res.json({ posts: sentPosts });
    } catch (error) {
        console.error('Failed to load sent posts:', error);
        res.status(500).json({ error: 'Nie udało się pobrać wysłanych postów.' });
    }
});

scheduledRouter.get('/sent/:id', async (req, res) => {
    const postId = normalizeTrimmedString(req.params.id);
    if (!postId) {
        res.status(400).json({ error: 'Brakuje identyfikatora posta.' });
        return;
    }

    try {
        const post = await getScheduledPostById(postId);
        if (!post || post.status !== 'sent') {
            res.status(404).json({ error: 'Nie znaleziono wysłanego posta.' });
            return;
        }

        res.json({ post: toListResponsePost(post) });
    } catch (error) {
        console.error('Failed to load sent post:', error);
        res.status(500).json({ error: 'Nie udało się pobrać wysłanego posta.' });
    }
});

scheduledRouter.get('/:id', async (req, res) => {
    const postId = normalizeTrimmedString(req.params.id);
    if (!postId) {
        res.status(400).json({ error: 'Brakuje identyfikatora posta.' });
        return;
    }

    try {
        const post = await getScheduledPostById(postId);
        if (!post || post.status !== 'pending') {
            res.status(404).json({ error: 'Nie znaleziono zaplanowanego posta.' });
            return;
        }

        res.json({ post: toListResponsePost(post) });
    } catch (error) {
        console.error('Failed to load scheduled post:', error);
        res.status(500).json({ error: 'Nie udało się pobrać zaplanowanego posta.' });
    }
});

scheduledRouter.post('/', async (req, res) => {
    const parsedBody = scheduledPayloadSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const body = parsedBody.data as ScheduledPostRequestBody;
    const scheduleAtLocal = normalizeTrimmedString(body.scheduleAtLocal);

    if (!scheduleAtLocal) {
        res.status(400).json({ error: 'Wybierz datę i godzinę publikacji.' });
        return;
    }

    const scheduledFor = parseWarsawDateTimeToTimestamp(scheduleAtLocal);
    if (!scheduledFor) {
        res.status(400).json({ error: 'Podana data publikacji ma nieprawidłowy format.' });
        return;
    }

    if (scheduledFor <= Date.now()) {
        res.status(400).json({ error: 'Data publikacji musi być w przyszłości.' });
        return;
    }

    const payload = sanitizePayload(body);
    const validationError = validateEmbedForm(payload);
    if (validationError) {
        res.status(400).json({ error: validationError });
        return;
    }

    if (!isValidChannelId(payload.channelId)) {
        res.status(400).json({ error: 'Wybierz kanał docelowy.' });
        return;
    }

    const pingTarget = normalizeTrimmedString(payload.mentionRoleId);
    if (payload.mentionRoleEnabled && !isValidPingTarget(pingTarget)) {
        res.status(400).json({ error: 'Wybrany target pingu ma nieprawidłową wartość.' });
        return;
    }

    const now = Date.now();
    const scheduledPost: ScheduledPost = {
        id: randomUUID(),
        payload,
        scheduledFor,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        publisherName: req.session.user?.globalName ?? req.session.user?.username ?? 'Administrator',
        publisherUserId: req.session.user?.id,
        source: 'scheduled',
        eventStatus: payload.eventDraft?.enabled ? 'pending' : 'not_requested',
    };

    try {
        const inserted = await insertScheduledPost(scheduledPost);
        registerScheduledPost(inserted);

        res.json({
            success: true,
            post: toListResponsePost(inserted),
        });
    } catch (error) {
        console.error('Failed to create scheduled post:', error);
        res.status(500).json({ error: 'Nie udało się zaplanować publikacji.' });
    }
});

scheduledRouter.patch('/:id', async (req, res) => {
    const postId = normalizeTrimmedString(req.params.id);
    if (!postId) {
        res.status(400).json({ error: 'Brakuje identyfikatora posta.' });
        return;
    }

    const parsedBody = scheduledPayloadSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const body = parsedBody.data as ScheduledPostRequestBody;
    const scheduleAtLocal = normalizeTrimmedString(body.scheduleAtLocal);

    if (!scheduleAtLocal) {
        res.status(400).json({ error: 'Wybierz datę i godzinę publikacji.' });
        return;
    }

    const scheduledFor = parseWarsawDateTimeToTimestamp(scheduleAtLocal);
    if (!scheduledFor || scheduledFor <= Date.now()) {
        res.status(400).json({ error: 'Data publikacji musi być w przyszłości (Europe/Warsaw).' });
        return;
    }

    const payload = sanitizePayload(body);
    const validationError = validateEmbedForm(payload);
    if (validationError) {
        res.status(400).json({ error: validationError });
        return;
    }

    if (!isValidChannelId(payload.channelId)) {
        res.status(400).json({ error: 'Wybierz kanał docelowy.' });
        return;
    }

    const pingTarget = normalizeTrimmedString(payload.mentionRoleId);
    if (payload.mentionRoleEnabled && !isValidPingTarget(pingTarget)) {
        res.status(400).json({ error: 'Wybrany target pingu ma nieprawidłową wartość.' });
        return;
    }

    try {
        const updated = await updateScheduledPost(postId, (post) => {
            if (post.status !== 'pending') {
                return post;
            }

            return {
                ...post,
                payload,
                scheduledFor,
                updatedAt: Date.now(),
                eventStatus: payload.eventDraft?.enabled ? 'pending' : 'not_requested',
                discordEventId: undefined,
                eventLastError: undefined,
            };
        });

        if (!updated || updated.status !== 'pending') {
            res.status(404).json({ error: 'Nie znaleziono zaplanowanego posta do edycji.' });
            return;
        }

        registerScheduledPost(updated);

        res.json({
            success: true,
            post: toListResponsePost(updated),
        });
    } catch (error) {
        console.error('Failed to update scheduled post:', error);
        res.status(500).json({ error: 'Nie udało się zaktualizować zaplanowanego posta.' });
    }
});

scheduledRouter.delete('/:id', async (req, res) => {
    const postId = normalizeTrimmedString(req.params.id);
    if (!postId) {
        res.status(400).json({ error: 'Brakuje identyfikatora posta.' });
        return;
    }

    try {
        const deleted = await deleteScheduledPostById(postId);
        if (!deleted) {
            res.status(404).json({ error: 'Nie znaleziono zaplanowanego posta.' });
            return;
        }

        unregisterScheduledPost(postId);
        res.json({ success: true });
    } catch (error) {
        console.error('Failed to delete scheduled post:', error);
        res.status(500).json({ error: 'Nie udało się usunąć zaplanowanego posta.' });
    }
});

scheduledRouter.patch('/sent/:id', async (req, res) => {
    const postId = normalizeTrimmedString(req.params.id);
    if (!postId) {
        res.status(400).json({ error: 'Brakuje identyfikatora posta.' });
        return;
    }

    const parsedBody = scheduledSentEditPayloadSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const body = parsedBody.data as ScheduledPostEditRequestBody;
    const payload = sanitizePayload(body);

    const validationError = validateEmbedForm(payload);
    if (validationError) {
        res.status(400).json({ error: validationError });
        return;
    }

    if (!isValidChannelId(payload.channelId)) {
        res.status(400).json({ error: 'Wybierz kanał docelowy.' });
        return;
    }

    const pingTarget = normalizeTrimmedString(payload.mentionRoleId);
    if (payload.mentionRoleEnabled && !isValidPingTarget(pingTarget)) {
        res.status(400).json({ error: 'Wybrany target pingu ma nieprawidłową wartość.' });
        return;
    }

    try {
        const existingPost = await getScheduledPostById(postId);
        if (!existingPost || existingPost.status !== 'sent') {
            res.status(404).json({ error: 'Nie znaleziono wysłanego posta do edycji.' });
            return;
        }
        const editedAt = Date.now();

        const publishResult = await publishDashboardPost(payload, {
            publishedBy: existingPost.publisherName,
            publishedByUserId: existingPost.publisherUserId,
            editedAtTimestamp: editedAt,
        });

        const deletionWarnings = await deletePostMessages(existingPost);

        const eventEnabled = payload.eventDraft?.enabled === true;
        const hasExistingCreatedEvent = existingPost.eventStatus === 'created' && Boolean(existingPost.discordEventId);
        const eventChanged = !areEventDraftsEqual(existingPost.payload.eventDraft, payload.eventDraft);
        const lifecycleWarnings: string[] = [];

        let eventResult: {
            status: 'not_requested' | 'created' | 'failed';
            eventId?: string;
            eventError?: string;
            warnings: string[];
        };

        if (!eventEnabled) {
            let disableCleanupFailed = false;

            if (hasExistingCreatedEvent && existingPost.discordEventId) {
                const guildId = process.env.GUILD_ID;
                if (guildId) {
                    try {
                        await deleteGuildScheduledEvent(guildId, existingPost.discordEventId);
                    } catch {
                        disableCleanupFailed = true;
                        lifecycleWarnings.push('Nie udało się usunąć poprzedniego wydarzenia Discord po wyłączeniu opcji eventu.');
                    }
                } else {
                    disableCleanupFailed = true;
                    lifecycleWarnings.push('Brakuje GUILD_ID, więc nie można usunąć poprzedniego wydarzenia Discord.');
                }
            }

            if (disableCleanupFailed && hasExistingCreatedEvent && existingPost.discordEventId) {
                eventResult = {
                    status: 'created',
                    eventId: existingPost.discordEventId,
                    eventError: 'Nie udało się usunąć poprzedniego wydarzenia Discord po wyłączeniu opcji eventu.',
                    warnings: [],
                };
            } else {
                eventResult = {
                    status: 'not_requested',
                    eventId: undefined,
                    eventError: undefined,
                    warnings: [],
                };
            }
        } else if (hasExistingCreatedEvent && !eventChanged) {
            eventResult = {
                status: 'created',
                eventId: existingPost.discordEventId,
                eventError: undefined,
                warnings: [],
            };
        } else {
            const creationResult = await tryCreateDiscordEventFromPayload(payload);

            if (creationResult.status === 'created') {
                if (hasExistingCreatedEvent && existingPost.discordEventId && existingPost.discordEventId !== creationResult.eventId) {
                    const guildId = process.env.GUILD_ID;
                    if (guildId) {
                        try {
                            await deleteGuildScheduledEvent(guildId, existingPost.discordEventId);
                        } catch {
                            lifecycleWarnings.push('Utworzono nowe wydarzenie, ale nie udało się usunąć poprzedniego wydarzenia Discord.');
                        }
                    } else {
                        lifecycleWarnings.push('Brakuje GUILD_ID, więc nie można usunąć poprzedniego wydarzenia Discord.');
                    }
                }

                eventResult = creationResult;
            } else if (hasExistingCreatedEvent) {
                eventResult = {
                    status: 'created',
                    eventId: existingPost.discordEventId,
                    eventError: undefined,
                    warnings: [
                        ...creationResult.warnings,
                        'Nie udało się zaktualizować wydarzenia Discord. Zachowano poprzednie wydarzenie.',
                    ],
                };
            } else {
                eventResult = creationResult;
            }
        }

        const warnings = [
            ...deletionWarnings,
            ...publishResult.warnings,
            ...eventResult.warnings,
            ...lifecycleWarnings,
        ];

        const updatedPost = await updateScheduledPost(postId, (post) => ({
            ...post,
            payload,
            status: 'sent',
            updatedAt: editedAt,
            sentAt: editedAt,
            messageId: publishResult.messageId,
            pingMessageId: publishResult.pingMessageId,
            imageMessageId: publishResult.imageMessageId,
            eventStatus: eventResult.status,
            discordEventId: eventResult.eventId,
            eventLastError: eventResult.eventError,
            editedAt,
            editedBy: req.session.user?.globalName ?? req.session.user?.username ?? 'Administrator',
            editedByUserId: req.session.user?.id,
            lastError: warnings.length > 0 ? warnings.join(' | ') : undefined,
        }));

        if (!updatedPost) {
            res.status(404).json({ error: 'Nie znaleziono wysłanego posta po zapisie.' });
            return;
        }

        res.json({
            success: true,
            post: toListResponsePost(updatedPost),
            warnings,
            eventStatus: eventResult.status,
            eventError: eventResult.eventError,
        });
    } catch (error) {
        console.error('Failed to edit sent post:', error);
        res.status(500).json({ error: 'Nie udało się zaktualizować wysłanego posta.' });
    }
});

scheduledRouter.post('/sent/:id/retry-event', async (req, res) => {
    const postId = normalizeTrimmedString(req.params.id);
    if (!postId) {
        res.status(400).json({ error: 'Brakuje identyfikatora posta.' });
        return;
    }

    try {
        const existing = await getScheduledPostById(postId);
        if (!existing || existing.status !== 'sent') {
            res.status(404).json({ error: 'Nie znaleziono wysłanego posta.' });
            return;
        }

        if (existing.eventStatus !== 'failed') {
            res.status(409).json({ error: 'To wydarzenie nie wymaga ponowienia.' });
            return;
        }

        const eventResult = await tryCreateDiscordEventFromPayload(existing.payload);

        const updated = await updateScheduledPost(postId, (post) => ({
            ...post,
            updatedAt: Date.now(),
            eventStatus: eventResult.status,
            discordEventId: eventResult.eventId,
            eventLastError: eventResult.eventError,
            lastError: eventResult.warnings.length > 0
                ? eventResult.warnings.join(' | ')
                : undefined,
        }));

        if (!updated) {
            res.status(404).json({ error: 'Nie znaleziono wysłanego posta po retry.' });
            return;
        }

        if (eventResult.status !== 'created') {
            res.status(502).json({
                error: 'Nie udało się utworzyć wydarzenia Discord. Spróbuj ponownie później.',
            });
            return;
        }

        res.json({
            success: true,
            post: toListResponsePost(updated),
        });
    } catch (error) {
        console.error('Failed to retry sent post event:', error);
        res.status(500).json({ error: 'Nie udało się ponowić tworzenia wydarzenia.' });
    }
});

scheduledRouter.delete('/sent/:id', async (req, res) => {
    const postId = normalizeTrimmedString(req.params.id);
    if (!postId) {
        res.status(400).json({ error: 'Brakuje identyfikatora posta.' });
        return;
    }

    try {
        const post = await getScheduledPostById(postId);
        if (!post || post.status !== 'sent') {
            res.status(404).json({ error: 'Nie znaleziono wysłanego posta.' });
            return;
        }

        const deleted = await deleteScheduledPostById(postId);
        if (!deleted) {
            res.status(404).json({ error: 'Nie znaleziono wysłanego posta.' });
            return;
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to delete sent post:', error);
        res.status(500).json({ error: 'Nie udało się usunąć wysłanego posta.' });
    }
});
