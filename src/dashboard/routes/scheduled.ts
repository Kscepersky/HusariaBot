import { randomUUID } from 'crypto';
import { Router } from 'express';
import { requireAuth } from '../middleware/require-auth.js';
import { validateEmbedForm, type EmbedFormData } from '../embed-handlers.js';
import { parseWarsawDateTimeToTimestamp } from '../scheduler/warsaw-time.js';
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

function normalizeTrimmedString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function isValidChannelId(channelId: string): boolean {
    return /^\d{17,20}$/.test(channelId);
}

function isValidPingTarget(value: string): boolean {
    return value === 'everyone' || value === 'here' || /^\d{17,20}$/.test(value);
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
    };
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

        res.json({ post });
    } catch (error) {
        console.error('Failed to load scheduled post:', error);
        res.status(500).json({ error: 'Nie udało się pobrać zaplanowanego posta.' });
    }
});

scheduledRouter.post('/', async (req, res) => {
    const body = req.body as ScheduledPostRequestBody;
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

    const body = req.body as ScheduledPostRequestBody;
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
