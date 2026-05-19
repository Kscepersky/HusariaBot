import { getEconomyDatabase } from './database.js';
import type {
    ServerStatsDailyPoint,
    ServerStatsSummary,
    ServerStatsTopUser,
    ServerStatsTopChannel,
    ServerStatsMemberPoint,
    ServerStatsMemberSummary,
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

interface TopChannelRow {
    channel_id: string;
    messages: number;
    voice_minutes: number;
}

interface DailyPointRow {
    date: string;
    messages: number;
    voice_minutes: number;
}

interface DailyMemberRow {
    date: string;
    member_count: number;
    joins: number;
    leaves: number;
}

interface CountRow {
    count: number;
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

function fillDateRange(startDate: string, endDate: string): string[] {
    const result: string[] = [];
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86_400_000)) {
        result.push(d.toISOString().slice(0, 10));
    }
    return result;
}

// ─── Excluded channels ────────────────────────────────────────────────────────

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

// ─── Channel stats recording ───────────────────────────────────────────────────

export async function incrementChannelMessageStats(
    guildId: string,
    channelId: string,
    nowTimestamp: number,
): Promise<void> {
    const db = await getEconomyDatabase();
    const dateStr = new Date(nowTimestamp).toISOString().slice(0, 10);
    await db.run(
        `INSERT INTO daily_channel_stats (guild_id, channel_id, date, messages, voice_minutes)
         VALUES (?, ?, ?, 1, 0)
         ON CONFLICT (guild_id, channel_id, date) DO UPDATE SET messages = messages + 1`,
        guildId,
        channelId,
        dateStr,
    );
}

export async function incrementChannelVoiceStats(
    guildId: string,
    channelId: string,
    minutes: number,
    nowTimestamp: number,
): Promise<void> {
    const db = await getEconomyDatabase();
    const safeMinutes = Math.max(1, Math.floor(minutes));
    const dateStr = new Date(nowTimestamp).toISOString().slice(0, 10);
    await db.run(
        `INSERT INTO daily_channel_stats (guild_id, channel_id, date, messages, voice_minutes)
         VALUES (?, ?, ?, 0, ?)
         ON CONFLICT (guild_id, channel_id, date) DO UPDATE SET voice_minutes = voice_minutes + ?`,
        guildId,
        channelId,
        dateStr,
        safeMinutes,
        safeMinutes,
    );
}

// ─── Member count recording ────────────────────────────────────────────────────

export async function recordMemberJoin(
    guildId: string,
    memberCount: number,
    nowTimestamp: number,
): Promise<void> {
    const db = await getEconomyDatabase();
    const dateStr = new Date(nowTimestamp).toISOString().slice(0, 10);
    await db.run(
        `INSERT INTO daily_member_counts (guild_id, date, member_count, joins, leaves)
         VALUES (?, ?, ?, 1, 0)
         ON CONFLICT (guild_id, date) DO UPDATE SET
             member_count = ?,
             joins = joins + 1`,
        guildId,
        dateStr,
        memberCount,
        memberCount,
    );
}

export async function recordMemberLeave(
    guildId: string,
    memberCount: number,
    nowTimestamp: number,
): Promise<void> {
    const db = await getEconomyDatabase();
    const dateStr = new Date(nowTimestamp).toISOString().slice(0, 10);
    await db.run(
        `INSERT INTO daily_member_counts (guild_id, date, member_count, joins, leaves)
         VALUES (?, ?, ?, 0, 1)
         ON CONFLICT (guild_id, date) DO UPDATE SET
             member_count = ?,
             leaves = leaves + 1`,
        guildId,
        dateStr,
        memberCount,
        memberCount,
    );
}

export async function recordMemberSnapshot(
    guildId: string,
    memberCount: number,
    nowTimestamp: number,
): Promise<void> {
    if (memberCount <= 0) return;
    const db = await getEconomyDatabase();
    const dateStr = new Date(nowTimestamp).toISOString().slice(0, 10);
    await db.run(
        `INSERT INTO daily_member_counts (guild_id, date, member_count, joins, leaves)
         VALUES (?, ?, ?, 0, 0)
         ON CONFLICT (guild_id, date) DO UPDATE SET member_count = ?`,
        guildId,
        dateStr,
        memberCount,
        memberCount,
    );
}

// ─── Legacy summary (all-in-one, kept for backward compat) ────────────────────

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

// ─── Messages tab ─────────────────────────────────────────────────────────────

export async function getMessageSummary(
    guildId: string,
    startDate: string,
    endDate: string,
): Promise<{ messages: number; uniqueUsers: number }> {
    const db = await getEconomyDatabase();

    const [aggRow, countRow] = await Promise.all([
        db.get<{ messages: number }>(
            `SELECT SUM(messages) AS messages FROM daily_user_stats
             WHERE guild_id = ? AND date >= ? AND date <= ? AND messages > 0`,
            guildId, startDate, endDate,
        ),
        db.get<CountRow>(
            `SELECT COUNT(DISTINCT user_id) AS count FROM daily_user_stats
             WHERE guild_id = ? AND date >= ? AND date <= ? AND messages > 0`,
            guildId, startDate, endDate,
        ),
    ]);

    return {
        messages: Number(aggRow?.messages ?? 0),
        uniqueUsers: Number(countRow?.count ?? 0),
    };
}

export async function getMessageTimeSeries(
    guildId: string,
    startDate: string,
    endDate: string,
): Promise<Array<{ date: string; messages: number }>> {
    const db = await getEconomyDatabase();

    const rows = await db.all<DailyPointRow[]>(
        `SELECT date, SUM(messages) AS messages
         FROM daily_user_stats
         WHERE guild_id = ? AND date >= ? AND date <= ?
         GROUP BY date ORDER BY date ASC`,
        guildId, startDate, endDate,
    );

    const byDate = new Map(rows.map((r) => [r.date, Number(r.messages)]));
    return fillDateRange(startDate, endDate).map((date) => ({
        date,
        messages: byDate.get(date) ?? 0,
    }));
}

export async function getTopMessageUsers(
    guildId: string,
    startDate: string,
    endDate: string,
    limit: number,
): Promise<ServerStatsTopUser[]> {
    const db = await getEconomyDatabase();
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));

    const rows = await db.all<TopUserRow[]>(
        `SELECT user_id, SUM(messages) AS messages, 0 AS voice_minutes
         FROM daily_user_stats
         WHERE guild_id = ? AND date >= ? AND date <= ?
         GROUP BY user_id
         ORDER BY SUM(messages) DESC
         LIMIT ?`,
        guildId, startDate, endDate, safeLimit,
    );

    return rows.map((row) => ({
        userId: row.user_id,
        messages: Number(row.messages),
        voiceMinutes: 0,
        score: Number(row.messages),
    }));
}

export async function getTopMessageChannels(
    guildId: string,
    startDate: string,
    endDate: string,
    limit: number,
): Promise<ServerStatsTopChannel[]> {
    const db = await getEconomyDatabase();
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));

    const rows = await db.all<TopChannelRow[]>(
        `SELECT channel_id, SUM(messages) AS messages, 0 AS voice_minutes
         FROM daily_channel_stats
         WHERE guild_id = ? AND date >= ? AND date <= ?
         GROUP BY channel_id
         ORDER BY SUM(messages) DESC
         LIMIT ?`,
        guildId, startDate, endDate, safeLimit,
    );

    return rows.map((row) => ({
        channelId: row.channel_id,
        messages: Number(row.messages),
        voiceMinutes: 0,
    }));
}

// ─── Voice tab ────────────────────────────────────────────────────────────────

export async function getVoiceSummary(
    guildId: string,
    startDate: string,
    endDate: string,
): Promise<{ voiceMinutes: number; voiceHours: number; uniqueUsers: number }> {
    const db = await getEconomyDatabase();

    const [aggRow, countRow] = await Promise.all([
        db.get<{ voice_minutes: number }>(
            `SELECT SUM(voice_minutes) AS voice_minutes FROM daily_user_stats
             WHERE guild_id = ? AND date >= ? AND date <= ? AND voice_minutes > 0`,
            guildId, startDate, endDate,
        ),
        db.get<CountRow>(
            `SELECT COUNT(DISTINCT user_id) AS count FROM daily_user_stats
             WHERE guild_id = ? AND date >= ? AND date <= ? AND voice_minutes > 0`,
            guildId, startDate, endDate,
        ),
    ]);

    const voiceMinutes = Number(aggRow?.voice_minutes ?? 0);
    return {
        voiceMinutes,
        voiceHours: Math.floor(voiceMinutes / 60),
        uniqueUsers: Number(countRow?.count ?? 0),
    };
}

export async function getVoiceTimeSeries(
    guildId: string,
    startDate: string,
    endDate: string,
): Promise<Array<{ date: string; voiceMinutes: number }>> {
    const db = await getEconomyDatabase();

    const rows = await db.all<DailyPointRow[]>(
        `SELECT date, SUM(voice_minutes) AS voice_minutes
         FROM daily_user_stats
         WHERE guild_id = ? AND date >= ? AND date <= ?
         GROUP BY date ORDER BY date ASC`,
        guildId, startDate, endDate,
    );

    const byDate = new Map(rows.map((r) => [r.date, Number(r.voice_minutes)]));
    return fillDateRange(startDate, endDate).map((date) => ({
        date,
        voiceMinutes: byDate.get(date) ?? 0,
    }));
}

export async function getTopVoiceUsers(
    guildId: string,
    startDate: string,
    endDate: string,
    limit: number,
): Promise<ServerStatsTopUser[]> {
    const db = await getEconomyDatabase();
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));

    const rows = await db.all<TopUserRow[]>(
        `SELECT user_id, 0 AS messages, SUM(voice_minutes) AS voice_minutes
         FROM daily_user_stats
         WHERE guild_id = ? AND date >= ? AND date <= ?
         GROUP BY user_id
         ORDER BY SUM(voice_minutes) DESC
         LIMIT ?`,
        guildId, startDate, endDate, safeLimit,
    );

    return rows.map((row) => ({
        userId: row.user_id,
        messages: 0,
        voiceMinutes: Number(row.voice_minutes),
        score: Number(row.voice_minutes),
    }));
}

export async function getTopVoiceChannels(
    guildId: string,
    startDate: string,
    endDate: string,
    limit: number,
): Promise<ServerStatsTopChannel[]> {
    const db = await getEconomyDatabase();
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));

    const rows = await db.all<TopChannelRow[]>(
        `SELECT channel_id, 0 AS messages, SUM(voice_minutes) AS voice_minutes
         FROM daily_channel_stats
         WHERE guild_id = ? AND date >= ? AND date <= ?
         GROUP BY channel_id
         ORDER BY SUM(voice_minutes) DESC
         LIMIT ?`,
        guildId, startDate, endDate, safeLimit,
    );

    return rows.map((row) => ({
        channelId: row.channel_id,
        messages: 0,
        voiceMinutes: Number(row.voice_minutes),
    }));
}

// ─── Users / members tab ──────────────────────────────────────────────────────

export async function getMemberTimeSeries(
    guildId: string,
    startDate: string,
    endDate: string,
): Promise<ServerStatsMemberPoint[]> {
    const db = await getEconomyDatabase();

    const rows = await db.all<DailyMemberRow[]>(
        `SELECT date, member_count, joins, leaves
         FROM daily_member_counts
         WHERE guild_id = ? AND date >= ? AND date <= ?
         ORDER BY date ASC`,
        guildId, startDate, endDate,
    );

    const byDate = new Map(rows.map((r) => [r.date, r]));
    return fillDateRange(startDate, endDate).map((date) => {
        const row = byDate.get(date);
        return {
            date,
            memberCount: Number(row?.member_count ?? 0),
            joins: Number(row?.joins ?? 0),
            leaves: Number(row?.leaves ?? 0),
        };
    });
}

export async function getMemberSummary(
    guildId: string,
    startDate: string,
    endDate: string,
): Promise<ServerStatsMemberSummary> {
    const db = await getEconomyDatabase();

    const [activityRow, countRow] = await Promise.all([
        db.get<{ joins: number; leaves: number }>(
            `SELECT SUM(joins) AS joins, SUM(leaves) AS leaves
             FROM daily_member_counts
             WHERE guild_id = ? AND date >= ? AND date <= ?`,
            guildId, startDate, endDate,
        ),
        db.get<{ member_count: number }>(
            `SELECT member_count
             FROM daily_member_counts
             WHERE guild_id = ? AND member_count > 0
             ORDER BY date DESC
             LIMIT 1`,
            guildId,
        ),
    ]);

    return {
        totalJoins: Number(activityRow?.joins ?? 0),
        totalLeaves: Number(activityRow?.leaves ?? 0),
        latestMemberCount: Number(countRow?.member_count ?? 0),
    };
}

export async function getActiveUsersInPeriod(
    guildId: string,
    startDate: string,
    endDate: string,
): Promise<ServerStatsTopUser[]> {
    const db = await getEconomyDatabase();

    const rows = await db.all<TopUserRow[]>(
        `SELECT user_id, SUM(messages) AS messages, SUM(voice_minutes) AS voice_minutes
         FROM daily_user_stats
         WHERE guild_id = ? AND date >= ? AND date <= ?
         GROUP BY user_id
         HAVING (SUM(messages) + SUM(voice_minutes)) > 0
         ORDER BY (SUM(messages) + SUM(voice_minutes)) DESC
         LIMIT 10`,
        guildId, startDate, endDate,
    );

    return rows.map((row) => ({
        userId: row.user_id,
        messages: Number(row.messages),
        voiceMinutes: Number(row.voice_minutes),
        score: Number(row.messages) + Number(row.voice_minutes),
    }));
}

// ─── Legacy: kept for existing routes ─────────────────────────────────────────

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

// ─── Export data ──────────────────────────────────────────────────────────────

export async function getAllUserStatsForExport(guildId: string): Promise<Array<{
    date: string;
    userId: string;
    messages: number;
    voiceMinutes: number;
}>> {
    const db = await getEconomyDatabase();
    const rows = await db.all<Array<{ date: string; user_id: string; messages: number; voice_minutes: number }>>(
        `SELECT date, user_id, messages, voice_minutes
         FROM daily_user_stats
         WHERE guild_id = ?
         ORDER BY date DESC, user_id ASC`,
        guildId,
    );
    return rows.map((r) => ({
        date: r.date,
        userId: r.user_id,
        messages: Number(r.messages),
        voiceMinutes: Number(r.voice_minutes),
    }));
}

export async function getAllChannelStatsForExport(guildId: string): Promise<Array<{
    date: string;
    channelId: string;
    messages: number;
    voiceMinutes: number;
}>> {
    const db = await getEconomyDatabase();
    const rows = await db.all<Array<{ date: string; channel_id: string; messages: number; voice_minutes: number }>>(
        `SELECT date, channel_id, messages, voice_minutes
         FROM daily_channel_stats
         WHERE guild_id = ?
         ORDER BY date DESC, channel_id ASC`,
        guildId,
    );
    return rows.map((r) => ({
        date: r.date,
        channelId: r.channel_id,
        messages: Number(r.messages),
        voiceMinutes: Number(r.voice_minutes),
    }));
}

export async function getAllMemberCountsForExport(guildId: string): Promise<Array<{
    date: string;
    memberCount: number;
    joins: number;
    leaves: number;
}>> {
    const db = await getEconomyDatabase();
    const rows = await db.all<DailyMemberRow[]>(
        `SELECT date, member_count, joins, leaves
         FROM daily_member_counts
         WHERE guild_id = ?
         ORDER BY date DESC`,
        guildId,
    );
    return rows.map((r) => ({
        date: r.date,
        memberCount: Number(r.member_count),
        joins: Number(r.joins),
        leaves: Number(r.leaves),
    }));
}

export async function resetAllStats(guildId: string): Promise<void> {
    const db = await getEconomyDatabase();
    await db.run('DELETE FROM daily_user_stats WHERE guild_id = ?', guildId);
    await db.run('DELETE FROM daily_channel_stats WHERE guild_id = ?', guildId);
    await db.run('DELETE FROM daily_member_counts WHERE guild_id = ?', guildId);
}
