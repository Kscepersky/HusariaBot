import { randomUUID } from 'crypto';
import { Router } from 'express';
import { deleteChannelMessage, deleteGuildScheduledEvent, editChannelMessage } from '../discord-api.js';
import {
    buildDashboardAllowedMentions,
    buildDashboardMessagePayload,
    buildEmbedJson,
    validateEmbedForm,
    type EmbedFormData,
} from '../embed-handlers.js';
import {
    STORED_UPLOAD_ERROR,
    STORED_UPLOAD_PLACEHOLDER,
    areEventDraftsEqual,
    normalizeTrimmedString,
    resolveStoredUpload,
    sanitizeEmbedPayload,
} from '../payload-sanitizer.js';
import { verifyTargetChannel } from '../channel-guard.js';
import { tryCreateDiscordEventFromPayload } from '../event-publisher.js';
import { buildActorContext } from './actor-context.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requireSectionAccess } from '../middleware/require-section-access.js';
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
import { createLogger } from '../../utils/logger.js';

export const scheduledRouter = Router();
const scheduledLogger = createLogger('dashboard:scheduled-routes');

interface ScheduledPostRequestBody extends Omit<EmbedFormData, 'mentionRoleEnabled'> {
    mentionRoleEnabled?: boolean | string;
    scheduleAtLocal?: string;
}

interface ScheduledPostEditRequestBody extends ScheduledPostRequestBody {}


function isValidChannelId(channelId: string): boolean {
    return /^\d{17,20}$/.test(channelId);
}

function isValidPingTarget(value: string): boolean {
    return value === 'everyone' || value === 'here' || /^\d{17,20}$/.test(value);
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

scheduledRouter.get('/', requireSectionAccess('scheduled-posts'), async (_req, res) => {
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

scheduledRouter.get('/sent', requireSectionAccess('sent-posts'), async (_req, res) => {
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

scheduledRouter.get('/sent/:id', requireSectionAccess('sent-posts'), async (req, res) => {
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

scheduledRouter.get('/:id', requireSectionAccess('scheduled-posts'), async (req, res) => {
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

scheduledRouter.post('/', requireSectionAccess('scheduled-posts'), async (req, res) => {
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

    const payload = resolveStoredUpload(sanitizeEmbedPayload(body));
    if (!payload) {
        res.status(400).json({ error: STORED_UPLOAD_ERROR });
        return;
    }

    const validationError = validateEmbedForm(payload);
    if (validationError) {
        res.status(400).json({ error: validationError });
        return;
    }

    if (!isValidChannelId(payload.channelId)) {
        res.status(400).json({ error: 'Wybierz kanał docelowy.' });
        return;
    }

    if (!await verifyTargetChannel(payload.channelId, res)) {
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
        publisherAvatar: req.session.user?.avatar ?? undefined,
        source: 'scheduled',
        eventStatus: payload.eventDraft?.enabled ? 'pending' : 'not_requested',
    };

    try {
        const inserted = await insertScheduledPost(scheduledPost);
        registerScheduledPost(inserted);

        scheduledLogger.info('SCHEDULED_POST_CREATED', 'Utworzono zaplanowany post z dashboardu.', {
            ...buildActorContext(req.session.user),
            postId: inserted.id,
            channelId: inserted.payload.channelId,
            scheduledFor: inserted.scheduledFor,
            mode: inserted.payload.mode,
        });

        res.json({
            success: true,
            post: toListResponsePost(inserted),
        });
    } catch (error) {
        console.error('Failed to create scheduled post:', error);
        res.status(500).json({ error: 'Nie udało się zaplanować publikacji.' });
    }
});

scheduledRouter.patch('/:id', requireSectionAccess('scheduled-posts'), async (req, res) => {
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

    const payload = sanitizeEmbedPayload(body);

    const validationError = validateEmbedForm(payload);
    if (validationError) {
        res.status(400).json({ error: validationError });
        return;
    }

    if (!isValidChannelId(payload.channelId)) {
        res.status(400).json({ error: 'Wybierz kanał docelowy.' });
        return;
    }

    if (!await verifyTargetChannel(payload.channelId, res)) {
        return;
    }

    const pingTarget = normalizeTrimmedString(payload.mentionRoleId);
    if (payload.mentionRoleEnabled && !isValidPingTarget(pingTarget)) {
        res.status(400).json({ error: 'Wybrany target pingu ma nieprawidłową wartość.' });
        return;
    }

    try {
        // Placeholder uploadu rozwiązujemy w atomowym callbacku, na aktualnym stanie posta.
        let storedUploadMissing = false;
        const updated = await updateScheduledPost(postId, (post) => {
            if (post.status !== 'pending') {
                return post;
            }

            const resolvedPayload = resolveStoredUpload(payload, post.payload);
            if (!resolvedPayload) {
                storedUploadMissing = true;
                return post;
            }

            return {
                ...post,
                payload: resolvedPayload,
                scheduledFor,
                updatedAt: Date.now(),
                eventStatus: payload.eventDraft?.enabled ? 'pending' : 'not_requested',
                discordEventId: undefined,
                eventLastError: undefined,
            };
        });

        if (storedUploadMissing) {
            res.status(400).json({ error: STORED_UPLOAD_ERROR });
            return;
        }

        if (!updated || updated.status !== 'pending') {
            res.status(404).json({ error: 'Nie znaleziono zaplanowanego posta do edycji.' });
            return;
        }

        registerScheduledPost(updated);

        scheduledLogger.info('SCHEDULED_POST_UPDATED', 'Zaktualizowano zaplanowany post z dashboardu.', {
            ...buildActorContext(req.session.user),
            postId: updated.id,
            channelId: updated.payload.channelId,
            scheduledFor: updated.scheduledFor,
            mode: updated.payload.mode,
        });

        res.json({
            success: true,
            post: toListResponsePost(updated),
        });
    } catch (error) {
        console.error('Failed to update scheduled post:', error);
        res.status(500).json({ error: 'Nie udało się zaktualizować zaplanowanego posta.' });
    }
});

scheduledRouter.delete('/:id', requireSectionAccess('scheduled-posts'), async (req, res) => {
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

        scheduledLogger.info('SCHEDULED_POST_DELETED', 'Usunieto zaplanowany post z dashboardu.', {
            ...buildActorContext(req.session.user),
            postId,
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to delete scheduled post:', error);
        res.status(500).json({ error: 'Nie udało się usunąć zaplanowanego posta.' });
    }
});

scheduledRouter.patch('/sent/:id', requireSectionAccess('sent-posts'), async (req, res) => {
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
    const payload = sanitizeEmbedPayload(body);

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

        if (payload.channelId !== existingPost.payload.channelId) {
            res.status(400).json({ error: 'Nie można zmienić kanału dla opublikowanego posta.' });
            return;
        }

        if (!existingPost.messageId) {
            res.status(409).json({ error: 'Nie można edytować posta bez identyfikatora wiadomości.' });
            return;
        }

        const hasPingSettingsChanged = Boolean(payload.mentionRoleEnabled) !== Boolean(existingPost.payload.mentionRoleEnabled)
            || normalizeTrimmedString(payload.mentionRoleId) !== normalizeTrimmedString(existingPost.payload.mentionRoleId);
        const normalizedIncomingUploadBase64 = normalizeTrimmedString(payload.uploadBase64);
        const normalizedExistingUploadBase64 = normalizeTrimmedString(existingPost.payload.uploadBase64);
        const preservesStoredUpload = normalizedIncomingUploadBase64 === STORED_UPLOAD_PLACEHOLDER
            && normalizedExistingUploadBase64.length > 0;
        const hasImageSettingsChanged = (payload.imageMode ?? 'none') !== (existingPost.payload.imageMode ?? 'none')
            || normalizeTrimmedString(payload.imageFilename) !== normalizeTrimmedString(existingPost.payload.imageFilename)
            || normalizeTrimmedString(payload.uploadFileName) !== normalizeTrimmedString(existingPost.payload.uploadFileName)
            || normalizeTrimmedString(payload.uploadMimeType) !== normalizeTrimmedString(existingPost.payload.uploadMimeType)
            || (!preservesStoredUpload && normalizedIncomingUploadBase64 !== normalizedExistingUploadBase64);

        if (hasPingSettingsChanged || hasImageSettingsChanged) {
            res.status(400).json({
                error: 'W edycji opublikowanego posta nie można zmieniać ustawień pingu ani grafiki.',
            });
            return;
        }

        const editedBy = req.session.user?.globalName ?? req.session.user?.username ?? 'Administrator';
        const editedAt = Date.now();

        if (payload.mode === 'embedded') {
            const embedJson = buildEmbedJson(payload, {
                publishedBy: existingPost.publisherName,
                publishedByUserId: existingPost.publisherUserId,
                editedAtTimestamp: editedAt,
                editedBy,
                editedByUserId: req.session.user?.id,
            });

            await editChannelMessage(payload.channelId, existingPost.messageId, {
                content: '',
                embeds: [embedJson],
                allowed_mentions: buildDashboardAllowedMentions(normalizeTrimmedString(payload.content)),
            });
        } else {
            const messagePayload = buildDashboardMessagePayload(payload, {
                publishedBy: existingPost.publisherName,
                publishedByUserId: existingPost.publisherUserId,
                editedAtTimestamp: editedAt,
                editedBy,
                editedByUserId: req.session.user?.id,
            });

            await editChannelMessage(payload.channelId, existingPost.messageId, {
                ...messagePayload,
                embeds: [],
            });
        }

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
            ...eventResult.warnings,
            ...lifecycleWarnings,
        ];

        const updatedPost = await updateScheduledPost(postId, (post) => ({
            ...post,
            payload,
            status: 'sent',
            updatedAt: editedAt,
            sentAt: editedAt,
            messageId: existingPost.messageId,
            pingMessageId: existingPost.pingMessageId,
            imageMessageId: existingPost.imageMessageId,
            eventStatus: eventResult.status,
            discordEventId: eventResult.eventId,
            eventLastError: eventResult.eventError,
            editedAt,
            editedBy,
            editedByUserId: req.session.user?.id,
            lastError: warnings.length > 0 ? warnings.join(' | ') : undefined,
        }));

        if (!updatedPost) {
            res.status(404).json({ error: 'Nie znaleziono wysłanego posta po zapisie.' });
            return;
        }

        scheduledLogger.info('SENT_POST_EDITED', 'Zedytowano opublikowany post z dashboardu.', {
            ...buildActorContext(req.session.user),
            postId,
            channelId: updatedPost.payload.channelId,
            messageId: updatedPost.messageId,
            mode: updatedPost.payload.mode,
        });

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

scheduledRouter.post('/sent/:id/retry-event', requireSectionAccess('sent-posts'), async (req, res) => {
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

scheduledRouter.delete('/sent/:id', requireSectionAccess('sent-posts'), async (req, res) => {
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

        const channelId = post.payload.channelId;
        const discordDeleteWarnings: string[] = [];

        const messagesToDelete = [
            { key: 'messageId', id: post.messageId },
            { key: 'pingMessageId', id: post.pingMessageId },
            { key: 'imageMessageId', id: post.imageMessageId },
        ] as const;

        for (const { key, id } of messagesToDelete) {
            if (!id) continue;
            try {
                await deleteChannelMessage(channelId, id);
            } catch (discordError) {
                const msg = discordError instanceof Error ? discordError.message : String(discordError);
                discordDeleteWarnings.push(`${key}: ${msg}`);
                scheduledLogger.warn('SENT_POST_DISCORD_DELETE_FAILED', 'Nie udalo sie usunac wiadomosci z Discorda przy usuwaniu posta.', {
                    ...buildActorContext(req.session.user),
                    postId,
                    channelId,
                    [key]: id,
                }, discordError);
            }
        }

        const deleted = await deleteScheduledPostById(postId);
        if (!deleted) {
            res.status(404).json({ error: 'Nie znaleziono wysłanego posta.' });
            return;
        }

        scheduledLogger.info('SENT_POST_DELETED', 'Usunieto opublikowany post z dashboardu.', {
            ...buildActorContext(req.session.user),
            postId,
            channelId,
            messageId: post.messageId,
            mode: post.payload.mode,
            discordDeleteWarnings: discordDeleteWarnings.length > 0 ? discordDeleteWarnings : undefined,
        });

        res.json({
            success: true,
            warnings: discordDeleteWarnings.length > 0 ? discordDeleteWarnings : undefined,
        });
    } catch (error) {
        scheduledLogger.error('SENT_POST_DELETE_FAILED', 'Nie udalo sie usunac opublikowanego posta.', {
            ...buildActorContext(req.session.user),
            postId,
        }, error);
        res.status(500).json({ error: 'Nie udało się usunąć wysłanego posta.' });
    }
});
