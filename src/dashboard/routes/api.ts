import { Router } from 'express';
import { config } from 'dotenv';
import { requireAuth } from '../middleware/require-auth.js';
import {
    getGuildTextChannels,
    getGuildRoles,
    getGuildEmojis,
    searchGuildMembers,
    listImages,
    sendImageToChannel,
} from '../discord-api.js';
import {
    validateEmbedForm,
    type EmbedFormData,
} from '../embed-handlers.js';
import { publishDashboardPost } from '../publish-flow.js';

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
    const data = {
        ...(req.body as EmbedFormData),
        mode: req.body?.mode,
        imageMode: req.body?.imageMode,
        mentionRoleEnabled: req.body?.mentionRoleEnabled === true || req.body?.mentionRoleEnabled === 'true',
    } as EmbedFormData;

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

        res.json({
            success: true,
            messageId: publishResult.messageId,
            pingMessageId: publishResult.pingMessageId,
            imageMessageId: publishResult.imageMessageId,
            warnings: publishResult.warnings,
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
