import type { Database } from 'sqlite';
import { getG2MatchesDatabase } from './database.js';
import type {
    G2MatchRecord,
    G2MatchesFilterOptions,
    G2MatchesQueryFilters,
    G2MatchesSyncMeta,
} from './types.js';

interface G2MatchRow {
    match_id: string;
    game: string;
    opponent: string;
    tournament: string;
    match_type: string;
    date_pl: string;
    time_pl: string;
    begin_at_utc: string;
    begin_at_timestamp: number;
    status: string;
    g2_team_name: string;
    league_name: string;
    source_updated_at: number;
    raw_payload: string;
}

interface G2SyncStateRow {
    last_sync_at: number | null;
    last_sync_count: number;
    last_error: string | null;
}

function toRecord(row: G2MatchRow): G2MatchRecord {
    return {
        matchId: row.match_id,
        game: row.game,
        opponent: row.opponent,
        tournament: row.tournament,
        matchType: row.match_type,
        date: row.date_pl,
        time: row.time_pl,
        beginAtUtc: row.begin_at_utc,
        beginAtTimestamp: row.begin_at_timestamp,
        status: row.status,
        g2TeamName: row.g2_team_name,
        leagueName: row.league_name,
        sourceUpdatedAt: row.source_updated_at,
        rawPayload: row.raw_payload,
    };
}

async function withTransaction<T>(db: Database, work: () => Promise<T>): Promise<T> {
    await db.exec('BEGIN IMMEDIATE TRANSACTION');

    try {
        const result = await work();
        await db.exec('COMMIT');
        return result;
    } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
    }
}

export async function replaceAllG2Matches(matches: G2MatchRecord[]): Promise<void> {
    const db = await getG2MatchesDatabase();

    await withTransaction(db, async () => {
        await db.run('DELETE FROM g2_matches');

        const statement = await db.prepare(`
            INSERT INTO g2_matches (
                match_id,
                game,
                opponent,
                tournament,
                match_type,
                date_pl,
                time_pl,
                begin_at_utc,
                begin_at_timestamp,
                status,
                g2_team_name,
                league_name,
                source_updated_at,
                raw_payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        try {
            for (const match of matches) {
                await statement.run(
                    match.matchId,
                    match.game,
                    match.opponent,
                    match.tournament,
                    match.matchType,
                    match.date,
                    match.time,
                    match.beginAtUtc,
                    match.beginAtTimestamp,
                    match.status,
                    match.g2TeamName,
                    match.leagueName,
                    match.sourceUpdatedAt,
                    match.rawPayload,
                );
            }
        } finally {
            await statement.finalize();
        }

        await db.run(
            `
            UPDATE g2_matches_sync_state
            SET last_sync_at = ?, last_sync_count = ?, last_error = NULL
            WHERE id = 1
            `,
            Date.now(),
            matches.length,
        );
    });
}

export async function saveG2MatchesSyncError(message: string): Promise<void> {
    const db = await getG2MatchesDatabase();

    await db.run(
        `
        UPDATE g2_matches_sync_state
        SET last_error = ?
        WHERE id = 1
        `,
        message,
    );
}

export async function listG2Matches(filters: G2MatchesQueryFilters): Promise<G2MatchRecord[]> {
    const db = await getG2MatchesDatabase();

    const whereClauses: string[] = [];
    const params: Array<string | number> = [];

    if (filters.game) {
        whereClauses.push('game = ?');
        params.push(filters.game);
    }

    if (filters.g2Team) {
        whereClauses.push('g2_team_name = ?');
        params.push(filters.g2Team);
    }

    if (filters.tournament) {
        whereClauses.push('tournament = ?');
        params.push(filters.tournament);
    }

    if (filters.status) {
        whereClauses.push('status = ?');
        params.push(filters.status);
    }

    if (filters.opponent) {
        whereClauses.push('LOWER(opponent) LIKE ?');
        params.push(`%${filters.opponent.toLowerCase()}%`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const limit = Number.isFinite(filters.limit) ? Math.max(1, Math.min(500, filters.limit ?? 100)) : 100;
    const offset = Number.isFinite(filters.offset) ? Math.max(0, filters.offset ?? 0) : 0;

    const rows = await db.all<G2MatchRow[]>(
        `
        SELECT *
        FROM g2_matches
        ${whereSql}
        ORDER BY begin_at_timestamp ASC
        LIMIT ? OFFSET ?
        `,
        ...params,
        limit,
        offset,
    );

    return rows.map(toRecord);
}

export async function getG2MatchById(matchId: string): Promise<G2MatchRecord | null> {
    const db = await getG2MatchesDatabase();

    const row = await db.get<G2MatchRow>(
        `
        SELECT *
        FROM g2_matches
        WHERE match_id = ?
        LIMIT 1
        `,
        matchId,
    );

    return row ? toRecord(row) : null;
}

export async function listG2MatchesFilterOptions(): Promise<G2MatchesFilterOptions> {
    const db = await getG2MatchesDatabase();

    const [gameRows, g2TeamRows, tournamentRows, statusRows] = await Promise.all([
        db.all<Array<{ value: string }>>('SELECT DISTINCT game AS value FROM g2_matches ORDER BY game ASC'),
        db.all<Array<{ value: string }>>('SELECT DISTINCT g2_team_name AS value FROM g2_matches ORDER BY g2_team_name ASC'),
        db.all<Array<{ value: string }>>('SELECT DISTINCT tournament AS value FROM g2_matches ORDER BY tournament ASC'),
        db.all<Array<{ value: string }>>('SELECT DISTINCT status AS value FROM g2_matches ORDER BY status ASC'),
    ]);

    return {
        games: gameRows.map((row) => row.value),
        g2Teams: g2TeamRows.map((row) => row.value),
        tournaments: tournamentRows.map((row) => row.value),
        statuses: statusRows.map((row) => row.value),
    };
}

export async function getG2MatchesSyncMeta(): Promise<G2MatchesSyncMeta> {
    const db = await getG2MatchesDatabase();
    const row = await db.get<G2SyncStateRow>('SELECT last_sync_at, last_sync_count, last_error FROM g2_matches_sync_state WHERE id = 1');

    return {
        lastSyncAt: row?.last_sync_at ?? null,
        lastSyncCount: row?.last_sync_count ?? 0,
        lastError: row?.last_error ?? null,
    };
}
