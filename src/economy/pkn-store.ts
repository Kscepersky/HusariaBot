import type { PknOutcome } from '../commands/pkn-logic.js';
import { getEconomyDatabase } from './database.js';

export interface PknPlayerStats {
    userId: string;
    wins: number;
    losses: number;
    draws: number;
    games: number;
    /** Procent wygranych z wszystkich gier, zaokraglony do calosci. */
    winRate: number;
}

interface PknStatsRow {
    user_id: string;
    wins: number;
    losses: number;
    draws: number;
}

function toStats(row: PknStatsRow): PknPlayerStats {
    const games = row.wins + row.losses + row.draws;
    return {
        userId: row.user_id,
        wins: row.wins,
        losses: row.losses,
        draws: row.draws,
        games,
        winRate: games > 0 ? Math.round((row.wins / games) * 100) : 0,
    };
}

type PknColumn = 'wins' | 'losses' | 'draws';

async function incrementColumn(guildId: string, userId: string, column: PknColumn): Promise<void> {
    const db = await getEconomyDatabase();
    // Nazwa kolumny pochodzi z zamknietego typu PknColumn, nie z danych uzytkownika.
    await db.run(
        `INSERT INTO pkn_stats (guild_id, user_id, ${column}) VALUES (?, ?, 1)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET ${column} = ${column} + 1`,
        guildId,
        userId,
    );
}

export async function recordPknMatch(
    guildId: string,
    firstUserId: string,
    secondUserId: string,
    outcome: PknOutcome,
): Promise<void> {
    if (outcome === 'draw') {
        await Promise.all([
            incrementColumn(guildId, firstUserId, 'draws'),
            incrementColumn(guildId, secondUserId, 'draws'),
        ]);
        return;
    }

    const winnerId = outcome === 'first' ? firstUserId : secondUserId;
    const loserId = outcome === 'first' ? secondUserId : firstUserId;
    await Promise.all([
        incrementColumn(guildId, winnerId, 'wins'),
        incrementColumn(guildId, loserId, 'losses'),
    ]);
}

export async function getPknPlayerStats(guildId: string, userId: string): Promise<PknPlayerStats | null> {
    const db = await getEconomyDatabase();
    const row = await db.get<PknStatsRow>(
        'SELECT user_id, wins, losses, draws FROM pkn_stats WHERE guild_id = ? AND user_id = ?',
        guildId,
        userId,
    );

    return row ? toStats(row) : null;
}

export async function getPknRanking(guildId: string, limit: number): Promise<PknPlayerStats[]> {
    const db = await getEconomyDatabase();
    const rows = await db.all<PknStatsRow[]>(
        `SELECT user_id, wins, losses, draws FROM pkn_stats
         WHERE guild_id = ?
         ORDER BY wins DESC,
                  (CAST(wins AS REAL) / (wins + losses + draws)) DESC,
                  losses ASC,
                  user_id ASC
         LIMIT ?`,
        guildId,
        limit,
    );

    return rows.map(toStats);
}
