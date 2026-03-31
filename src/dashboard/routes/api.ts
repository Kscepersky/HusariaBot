import { Router } from 'express';
import { config } from 'dotenv';
import { requireAuth } from '../middleware/require-auth.js';
import { getGuildTextChannels, sendEmbedToChannel, listImages, sendImageToChannel } from '../discord-api.js';
import { buildEmbedJson, validateEmbedForm, type EmbedFormData } from '../embed-handlers.js';

config();

export const apiRouter = Router();

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
    const data = req.body as EmbedFormData;

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
        const embedJson = buildEmbedJson(data);
        const messageId = await sendEmbedToChannel(data.channelId, embedJson);
        res.json({ success: true, messageId });
    } catch (err) {
        console.error('Failed to send embed:', err);
        res.status(500).json({ error: 'Nie udało się wysłać embeda.' });
    }
});
