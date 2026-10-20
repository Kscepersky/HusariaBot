import type { TttMatchOutcome } from '../commands/ttt-logic.js';
import { getEconomyDatabase } from './database.js';

export interface TttPlayerStats {
    userId: string;
    wins: number;
    losses: number;
    draws: number;
    games: number;
    /** Procent wygranych z wszystkich gier, zaokraglony do calosci. */
    winRate: number;
}

interface TttStatsRow {
    user_id: string;
    wins: number;
    losses: number;
    draws: number;
}

type TttColumn = 'wins' | 'losses' | 'draws';

function toStats(row: TttStatsRow): TttPlayerStats {
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

async function incrementColumn(guildId: string, userId: string, column: TttColumn): Promise<void> {
    const db = await getEconomyDatabase();
    // Nazwa kolumny pochodzi z zamknietego typu TttColumn, nie z danych uzytkownika.
    await db.run(
        `INSERT INTO ttt_stats (guild_id, user_id, ${column}) VALUES (?, ?, 1)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET ${column} = ${column} + 1`,
        guildId,
        userId,
    );
}

export async function recordTttMatch(
    guildId: string,
    firstUserId: string,
    secondUserId: string,
    outcome: TttMatchOutcome,
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

export async function getTttPlayerStats(guildId: string, userId: string): Promise<TttPlayerStats | null> {
    const db = await getEconomyDatabase();
    const row = await db.get<TttStatsRow>(
        'SELECT user_id, wins, losses, draws FROM ttt_stats WHERE guild_id = ? AND user_id = ?',
        guildId,
        userId,
    );

    return row ? toStats(row) : null;
}

export async function getTttRanking(guildId: string, limit: number): Promise<TttPlayerStats[]> {
    const db = await getEconomyDatabase();
    const rows = await db.all<TttStatsRow[]>(
        `SELECT user_id, wins, losses, draws FROM ttt_stats
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
