import { getEconomyDatabase } from './database.js';
import type {
    ServerStatsDailyPoint,
    ServerStatsSummary,
    ServerStatsTopUser,
} from './types.js';

interface DailyStatsAggRow {
    messages: number;
    voice_minutes: number;
}

interface TopUserRow {
    user_id: string;
    messages: number;
    voice_minutes: number;
}

interface DailyPointRow {
    date: string;
    messages: number;
    voice_minutes: number;
}

interface ExcludedChannelsRow {
    stats_excluded_channel_ids: string;
}

function buildSummary(row: DailyStatsAggRow | undefined): ServerStatsSummary {
    const messages = Number(row?.messages ?? 0);
    const voiceMinutes = Number(row?.voice_minutes ?? 0);
    return {
        messages,
        voiceMinutes,
        voiceHours: Math.floor(voiceMinutes / 60),
    };
}

export async function getStatsExcludedChannelIds(): Promise<string[]> {
    const db = await getEconomyDatabase();
    const row = await db.get<ExcludedChannelsRow>(
        'SELECT stats_excluded_channel_ids FROM economy_config WHERE id = 1 LIMIT 1',
    );
    if (!row) return [];
    try {
        const parsed: unknown = JSON.parse(row.stats_excluded_channel_ids);
        return Array.isArray(parsed)
            ? parsed.filter((id): id is string => typeof id === 'string')
            : [];
    } catch {
        return [];
    }
}

export async function setStatsExcludedChannelIds(channelIds: string[]): Promise<void> {
    const db = await getEconomyDatabase();
    await db.run(
        'UPDATE economy_config SET stats_excluded_channel_ids = ?, updated_at = ? WHERE id = 1',
        JSON.stringify(channelIds),
        Date.now(),
    );
}

export async function getServerStatsByDateRange(
    guildId: string,
    startDate: string,
    endDate: string,
): Promise<ServerStatsSummary> {
    const db = await getEconomyDatabase();

    const row = await db.get<DailyStatsAggRow>(
        `SELECT SUM(messages) AS messages, SUM(voice_minutes) AS voice_minutes
         FROM daily_user_stats
         WHERE guild_id = ? AND date >= ? AND date <= ?`,
        guildId,
        startDate,
        endDate,
    );

    return buildSummary(row);
}

export async function getServerStatsTopUsers(
    guildId: string,
    startDate: string,
    endDate: string,
    limit: number,
): Promise<ServerStatsTopUser[]> {
    const db = await getEconomyDatabase();
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));

    const rows = await db.all<TopUserRow[]>(
        `SELECT user_id,
                SUM(messages) AS messages,
                SUM(voice_minutes) AS voice_minutes
         FROM daily_user_stats
         WHERE guild_id = ? AND date >= ? AND date <= ?
         GROUP BY user_id
         ORDER BY (SUM(messages) + SUM(voice_minutes)) DESC
         LIMIT ?`,
        guildId,
        startDate,
        endDate,
        safeLimit,
    );

    return rows.map((row) => ({
        userId: row.user_id,
        messages: Number(row.messages),
        voiceMinutes: Number(row.voice_minutes),
        score: Number(row.messages) + Number(row.voice_minutes),
    }));
}

export async function getServerStatsDailyTimeSeries(
    guildId: string,
    startDate: string,
    endDate: string,
): Promise<ServerStatsDailyPoint[]> {
    const db = await getEconomyDatabase();

    const rows = await db.all<DailyPointRow[]>(
        `SELECT date,
                SUM(messages) AS messages,
                SUM(voice_minutes) AS voice_minutes
         FROM daily_user_stats
         WHERE guild_id = ? AND date >= ? AND date <= ?
         GROUP BY date
         ORDER BY date ASC`,
        guildId,
        startDate,
        endDate,
    );

    const rowsByDate = new Map(rows.map((row) => [row.date, row]));
    const result: ServerStatsDailyPoint[] = [];
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);

    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86_400_000)) {
        const dateStr = d.toISOString().slice(0, 10);
        const row = rowsByDate.get(dateStr);
        result.push({
            date: dateStr,
            messages: Number(row?.messages ?? 0),
            voiceMinutes: Number(row?.voice_minutes ?? 0),
        });
    }

    return result;
}
