import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { validateEmbedForm, type EmbedFormData } from '../embed-handlers.js';
import { requireAuth } from '../middleware/require-auth.js';
import { publishMatchAnnouncement, retryMatchAnnouncementEvent } from '../match-announcements/publisher.js';
import { getG2MatchById } from '../g2-matches/repository.js';
import {
    deleteMatchAnnouncementById,
    getMatchAnnouncementById,
    insertMatchAnnouncement,
    listMatchAnnouncements,
    updateMatchAnnouncement,
} from '../match-announcements/store.js';
import { registerMatchAnnouncement, unregisterMatchAnnouncement } from '../match-announcements/service.js';
import type { MatchAnnouncement, MatchSnapshot } from '../match-announcements/types.js';
import { parseWarsawDateTimeToTimestamp } from '../scheduler/warsaw-time.js';

export const matchAnnouncementsRouter = Router();

interface MatchAnnouncementRequestBody extends Omit<EmbedFormData, 'mentionRoleEnabled'> {
    mentionRoleEnabled?: boolean | string;
    scheduleAtLocal?: string;
    match?: Partial<MatchSnapshot>;
}

const CLIENT_FIXABLE_PUBLISH_ERRORS = [
    'Wybrany obraz z biblioteki nie istnieje.',
    'Nieobsługiwany format pliku graficznego.',
    'Wgrany plik graficzny ma nieprawidłowy format.',
    'Wgrany plik jest za duży (max 8 MB).',
    'Zawartość pliku nie zgadza się z typem obrazu.',
];

function normalizeTrimmedString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function isValidChannelId(channelId: string): boolean {
    return /^\d{17,20}$/.test(channelId);
}

function isValidPingTarget(value: string): boolean {
    return value === 'everyone' || value === 'here' || /^\d{17,20}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isClientFixablePublishError(error: unknown): error is Error {
    if (!(error instanceof Error)) {
        return false;
    }

    return CLIENT_FIXABLE_PUBLISH_ERRORS.some((message) => error.message.includes(message));
}

function sanitizePayload(input: MatchAnnouncementRequestBody): EmbedFormData {
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

function extractMatchId(input: unknown): string {
    if (!input || typeof input !== 'object') {
        return '';
    }

    const raw = input as Partial<MatchSnapshot>;
    return normalizeTrimmedString(raw.matchId);
}

async function resolveMatchSnapshot(input: unknown): Promise<MatchSnapshot | null> {
    const matchId = extractMatchId(input);
    if (!matchId) {
        return null;
    }

    const record = await getG2MatchById(matchId);
    if (!record) {
        return null;
    }

    return {
        matchId: record.matchId,
        game: record.game,
        g2TeamName: record.g2TeamName,
        opponent: record.opponent,
        tournament: record.tournament,
        matchType: record.matchType,
        beginAtUtc: record.beginAtUtc,
        date: record.date,
        time: record.time,
    };
}

function toListResponseAnnouncement(announcement: MatchAnnouncement): MatchAnnouncement {
    return {
        ...announcement,
        payload: {
            ...announcement.payload,
            uploadBase64: announcement.payload.uploadBase64 ? '[stored]' : '',
        },
    };
}

function validatePayload(payload: EmbedFormData): string | null {
    const validationError = validateEmbedForm(payload);
    if (validationError) {
        return validationError;
    }

    if (!isValidChannelId(payload.channelId)) {
        return 'Wybierz kanał docelowy.';
    }

    const pingTarget = normalizeTrimmedString(payload.mentionRoleId);
    if (payload.mentionRoleEnabled && !isValidPingTarget(pingTarget)) {
        return 'Wybrany target pingu ma nieprawidłową wartość.';
    }

    return null;
}

matchAnnouncementsRouter.use(requireAuth);

matchAnnouncementsRouter.get('/', async (_req, res) => {
    try {
        const announcements = await listMatchAnnouncements();
        const visibleAnnouncements = announcements
            .filter((announcement) => {
                return announcement.status === 'pending'
                    || announcement.status === 'failed'
                    || announcement.status === 'skipped'
                    || (announcement.status === 'sent' && announcement.eventStatus !== 'created');
            })
            .sort((left, right) => left.scheduledFor - right.scheduledFor)
            .map(toListResponseAnnouncement);

        res.json({ announcements: visibleAnnouncements });
    } catch (error) {
        console.error('Failed to load match announcements:', error);
        res.status(500).json({ error: 'Nie udało się pobrać zaplanowanych ogłoszeń meczów.' });
    }
});

matchAnnouncementsRouter.get('/:id', async (req, res) => {
    const announcementId = normalizeTrimmedString(req.params.id);
    if (!announcementId) {
        res.status(400).json({ error: 'Brakuje identyfikatora ogłoszenia.' });
        return;
    }

    try {
        const announcement = await getMatchAnnouncementById(announcementId);
        if (!announcement || announcement.status !== 'pending') {
            res.status(404).json({ error: 'Nie znaleziono zaplanowanego ogłoszenia meczowego.' });
            return;
        }

        res.json({ announcement });
    } catch (error) {
        console.error('Failed to load match announcement by id:', error);
        res.status(500).json({ error: 'Nie udało się pobrać zaplanowanego ogłoszenia meczowego.' });
    }
});

matchAnnouncementsRouter.post('/publish', async (req, res) => {
    if (!isRecord(req.body)) {
        res.status(400).json({ error: 'Nieprawidłowy format danych żądania.' });
        return;
    }

    const body = req.body as unknown as MatchAnnouncementRequestBody;
    const payload = sanitizePayload(body);

    const validationError = validatePayload(payload);
    if (validationError) {
        res.status(400).json({ error: validationError });
        return;
    }

    let match: MatchSnapshot | null;

    try {
        match = await resolveMatchSnapshot(body.match);
    } catch (error) {
        console.error('Failed to resolve match snapshot for publish:', error);
        res.status(500).json({ error: 'Nie udało się zweryfikować wybranego meczu.' });
        return;
    }

    if (!match) {
        res.status(400).json({ error: 'Wybierz poprawny mecz z bazy danych.' });
        return;
    }

    const now = Date.now();
    const tempAnnouncement: MatchAnnouncement = {
        id: randomUUID(),
        payload,
        match,
        scheduledFor: now,
        status: 'sent',
        eventStatus: 'pending',
        createdAt: now,
        updatedAt: now,
        publisherName: req.session.user?.globalName ?? req.session.user?.username ?? 'Administrator',
        publisherUserId: req.session.user?.id,
    };

    try {
        const result = await publishMatchAnnouncement(tempAnnouncement);

        res.json({
            success: true,
            messageId: result.messageId,
            pingMessageId: result.pingMessageId,
            imageMessageId: result.imageMessageId,
            warnings: result.warnings,
            eventStatus: result.eventStatus,
            discordEventId: result.discordEventId,
            eventError: result.eventError,
        });
    } catch (error) {
        console.error('Failed to publish match announcement:', error);

        if (isClientFixablePublishError(error)) {
            res.status(400).json({ error: error.message });
            return;
        }

        res.status(500).json({ error: 'Nie udało się opublikować ogłoszenia meczowego.' });
    }
});

matchAnnouncementsRouter.post('/', async (req, res) => {
    if (!isRecord(req.body)) {
        res.status(400).json({ error: 'Nieprawidłowy format danych żądania.' });
        return;
    }

    const body = req.body as unknown as MatchAnnouncementRequestBody;
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
    const validationError = validatePayload(payload);
    if (validationError) {
        res.status(400).json({ error: validationError });
        return;
    }

    let match: MatchSnapshot | null;

    try {
        match = await resolveMatchSnapshot(body.match);
    } catch (error) {
        console.error('Failed to resolve match snapshot for schedule create:', error);
        res.status(500).json({ error: 'Nie udało się zweryfikować wybranego meczu.' });
        return;
    }

    if (!match) {
        res.status(400).json({ error: 'Wybierz poprawny mecz z bazy danych.' });
        return;
    }

    const now = Date.now();
    const announcement: MatchAnnouncement = {
        id: randomUUID(),
        payload,
        match,
        scheduledFor,
        status: 'pending',
        eventStatus: 'pending',
        createdAt: now,
        updatedAt: now,
        publisherName: req.session.user?.globalName ?? req.session.user?.username ?? 'Administrator',
        publisherUserId: req.session.user?.id,
    };

    try {
        const inserted = await insertMatchAnnouncement(announcement);
        registerMatchAnnouncement(inserted);

        res.json({
            success: true,
            announcement: toListResponseAnnouncement(inserted),
        });
    } catch (error) {
        console.error('Failed to create match announcement:', error);
        res.status(500).json({ error: 'Nie udało się zaplanować ogłoszenia meczowego.' });
    }
});

matchAnnouncementsRouter.patch('/:id', async (req, res) => {
    const announcementId = normalizeTrimmedString(req.params.id);
    if (!announcementId) {
        res.status(400).json({ error: 'Brakuje identyfikatora ogłoszenia.' });
        return;
    }

    if (!isRecord(req.body)) {
        res.status(400).json({ error: 'Nieprawidłowy format danych żądania.' });
        return;
    }

    const body = req.body as unknown as MatchAnnouncementRequestBody;
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
    const validationError = validatePayload(payload);
    if (validationError) {
        res.status(400).json({ error: validationError });
        return;
    }

    let match: MatchSnapshot | null;

    try {
        match = await resolveMatchSnapshot(body.match);
    } catch (error) {
        console.error('Failed to resolve match snapshot for schedule update:', error);
        res.status(500).json({ error: 'Nie udało się zweryfikować wybranego meczu.' });
        return;
    }

    if (!match) {
        res.status(400).json({ error: 'Wybierz poprawny mecz z bazy danych.' });
        return;
    }

    try {
        const updated = await updateMatchAnnouncement(announcementId, (announcement) => {
            if (announcement.status !== 'pending') {
                return announcement;
            }

            return {
                ...announcement,
                payload,
                match,
                scheduledFor,
                updatedAt: Date.now(),
            };
        });

        if (!updated || updated.status !== 'pending') {
            res.status(404).json({ error: 'Nie znaleziono zaplanowanego ogłoszenia meczowego do edycji.' });
            return;
        }

        registerMatchAnnouncement(updated);
        res.json({ success: true, announcement: toListResponseAnnouncement(updated) });
    } catch (error) {
        console.error('Failed to update match announcement:', error);
        res.status(500).json({ error: 'Nie udało się zaktualizować zaplanowanego ogłoszenia meczowego.' });
    }
});

matchAnnouncementsRouter.delete('/:id', async (req, res) => {
    const announcementId = normalizeTrimmedString(req.params.id);
    if (!announcementId) {
        res.status(400).json({ error: 'Brakuje identyfikatora ogłoszenia.' });
        return;
    }

    try {
        const deleted = await deleteMatchAnnouncementById(announcementId);
        if (!deleted) {
            res.status(404).json({ error: 'Nie znaleziono zaplanowanego ogłoszenia meczowego.' });
            return;
        }

        unregisterMatchAnnouncement(announcementId);
        res.json({ success: true });
    } catch (error) {
        console.error('Failed to delete match announcement:', error);
        res.status(500).json({ error: 'Nie udało się usunąć zaplanowanego ogłoszenia meczowego.' });
    }
});

matchAnnouncementsRouter.post('/:id/retry-event', async (req, res) => {
    const announcementId = normalizeTrimmedString(req.params.id);
    if (!announcementId) {
        res.status(400).json({ error: 'Brakuje identyfikatora ogłoszenia.' });
        return;
    }

    try {
        let retryClaimed = false;
        const claimed = await updateMatchAnnouncement(announcementId, (existing) => {
            if (existing.status !== 'sent' || existing.eventStatus !== 'failed') {
                return existing;
            }

            retryClaimed = true;
            return {
                ...existing,
                eventStatus: 'pending',
                eventLastError: undefined,
                updatedAt: Date.now(),
            };
        });

        if (!claimed) {
            res.status(404).json({ error: 'Nie znaleziono ogłoszenia meczowego.' });
            return;
        }

        if (!retryClaimed) {
            res.status(409).json({ error: 'To ogłoszenie nie jest gotowe do ponownego tworzenia wydarzenia.' });
            return;
        }

        let eventResult: { eventId?: string; eventError?: string };

        try {
            eventResult = await retryMatchAnnouncementEvent(claimed);
        } catch (error) {
            const eventError = error instanceof Error
                ? error.message
                : 'Nieznany błąd podczas ponownego tworzenia wydarzenia Discord.';

            eventResult = { eventError };
        }

        const updated = await updateMatchAnnouncement(announcementId, (existing) => ({
            ...existing,
            eventStatus: eventResult.eventError ? 'failed' : 'created',
            discordEventId: eventResult.eventId,
            eventLastError: eventResult.eventError,
            updatedAt: Date.now(),
            lastError: eventResult.eventError ?? undefined,
        }));

        if (!updated) {
            res.status(404).json({ error: 'Nie znaleziono ogłoszenia meczowego po retry.' });
            return;
        }

        if (eventResult.eventError) {
            res.status(502).json({
                error: 'Nie udało się utworzyć wydarzenia Discord. Spróbuj ponownie później.',
            });
            return;
        }

        res.json({ success: true, announcement: toListResponseAnnouncement(updated) });
    } catch (error) {
        console.error('Failed to retry match announcement event:', error);
        res.status(500).json({ error: 'Nie udało się ponowić tworzenia wydarzenia Discord.' });
    }
});
