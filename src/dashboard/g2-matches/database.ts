import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';

let databasePromise: Promise<Database> | null = null;

function resolveDatabasePath(): string {
    return join(process.cwd(), 'data', 'g2-matches.db');
}

async function initializeSchema(db: Database): Promise<void> {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS g2_matches (
            match_id TEXT PRIMARY KEY,
            game TEXT NOT NULL,
            opponent TEXT NOT NULL,
            tournament TEXT NOT NULL,
            match_type TEXT NOT NULL,
            date_pl TEXT NOT NULL,
            time_pl TEXT NOT NULL,
            begin_at_utc TEXT NOT NULL,
            begin_at_timestamp INTEGER NOT NULL,
            status TEXT NOT NULL,
            g2_team_name TEXT NOT NULL,
            league_name TEXT NOT NULL,
            source_updated_at INTEGER NOT NULL,
            raw_payload TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_g2_matches_begin_at ON g2_matches(begin_at_timestamp);
        CREATE INDEX IF NOT EXISTS idx_g2_matches_game ON g2_matches(game);
        CREATE INDEX IF NOT EXISTS idx_g2_matches_tournament ON g2_matches(tournament);
        CREATE INDEX IF NOT EXISTS idx_g2_matches_status ON g2_matches(status);

        CREATE TABLE IF NOT EXISTS g2_matches_sync_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            last_sync_at INTEGER,
            last_sync_count INTEGER NOT NULL DEFAULT 0,
            last_error TEXT
        );

        INSERT OR IGNORE INTO g2_matches_sync_state (id, last_sync_at, last_sync_count, last_error)
        VALUES (1, NULL, 0, NULL);
    `);
}

export async function getG2MatchesDatabase(): Promise<Database> {
    if (!databasePromise) {
        databasePromise = (async () => {
            const dbPath = resolveDatabasePath();
            await mkdir(dirname(dbPath), { recursive: true });

            const db = await open({
                filename: dbPath,
                driver: sqlite3.Database,
            });

            await initializeSchema(db);
            return db;
        })();
    }

    return databasePromise;
}
