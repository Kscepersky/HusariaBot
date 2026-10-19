import { Router } from 'express';
import { parsePositiveIntQuery } from './query-utils.js';
import { resolveLeaderboardProfilesWithLimit } from './leaderboard-profiles.js';
import { requireOwner, requireSectionAccess } from '../middleware/require-section-access.js';
import {
    getGuildAllChannels,
} from '../discord-api.js';
import {
    normalizeTrimmedString,
} from '../payload-sanitizer.js';
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
import { createLogger } from '../../utils/logger.js';


export const statsRouter = Router();
const apiLogger = createLogger('dashboard:api');

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
statsRouter.get('/stats/server', requireSectionAccess('server-stats'), async (req, res) => {
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
statsRouter.get('/stats/server/config', requireSectionAccess('server-stats'), async (_req, res) => {
    try {
        const excludedChannelIds = await getStatsExcludedChannelIds();
        res.json({ excludedChannelIds });
    } catch (error) {
        apiLogger.error('STATS_CONFIG_LOAD_FAILED', 'Failed to load stats config.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać konfiguracji statystyk.' });
    }
});

const MAX_EXCLUDED_CHANNELS = 500;

// PUT /api/stats/server/config — update excluded channel IDs for stats
statsRouter.put('/stats/server/config', requireSectionAccess('server-stats'), requireOwner(), async (req, res) => {
    const body: unknown = req.body;
    if (
        typeof body !== 'object'
        || body === null
        || !Array.isArray((body as Record<string, unknown>).excludedChannelIds)
        || (body as Record<string, unknown[]>).excludedChannelIds.length > MAX_EXCLUDED_CHANNELS
        || !(body as Record<string, unknown[]>).excludedChannelIds.every((id) => typeof id === 'string' && /^\d{17,20}$/.test(id))
    ) {
        res.status(400).json({ error: 'Pole excludedChannelIds musi być tablicą identyfikatorów kanałów (maks. 500).' });
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
statsRouter.get('/stats/server/top-users', requireSectionAccess('server-stats'), async (req, res) => {
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
statsRouter.get('/stats/server/timeseries', requireSectionAccess('server-stats'), async (req, res) => {
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
statsRouter.get('/stats/messages/summary', requireSectionAccess('server-stats'), async (req, res) => {
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
statsRouter.get('/stats/messages/timeseries', requireSectionAccess('server-stats'), async (req, res) => {
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
statsRouter.get('/stats/messages/top-users', requireSectionAccess('server-stats'), async (req, res) => {
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
statsRouter.get('/stats/messages/top-channels', requireSectionAccess('server-stats'), async (req, res) => {
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
statsRouter.get('/stats/voice/summary', requireSectionAccess('server-stats'), async (req, res) => {
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
statsRouter.get('/stats/voice/timeseries', requireSectionAccess('server-stats'), async (req, res) => {
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
statsRouter.get('/stats/voice/top-users', requireSectionAccess('server-stats'), async (req, res) => {
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
statsRouter.get('/stats/voice/top-channels', requireSectionAccess('server-stats'), async (req, res) => {
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
statsRouter.get('/stats/members/summary', requireSectionAccess('server-stats'), async (req, res) => {
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
statsRouter.get('/stats/members/timeseries', requireSectionAccess('server-stats'), async (req, res) => {
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
statsRouter.get('/stats/members/active-users', requireSectionAccess('server-stats'), async (req, res) => {
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
statsRouter.get('/stats/export/messages', requireSectionAccess('server-stats'), async (req, res) => {
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
statsRouter.get('/stats/export/voice', requireSectionAccess('server-stats'), async (req, res) => {
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
statsRouter.get('/stats/export/members', requireSectionAccess('server-stats'), async (req, res) => {
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
statsRouter.get('/stats/export/all', requireSectionAccess('server-stats'), async (_req, res) => {
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
statsRouter.post('/stats/reset', requireSectionAccess('server-stats'), requireOwner(), async (_req, res) => {
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
