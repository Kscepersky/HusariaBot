import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { getEconomyDatabase, resetEconomyDatabaseForTests } from './database.js';

async function withTempEconomyDb(testFn: (databasePath: string) => Promise<void>): Promise<void> {
    const directoryPath = await mkdtemp(join(tmpdir(), 'husaria-economy-db-test-'));
    const dbPath = join(directoryPath, 'economy.sqlite');
    const previousDbPath = process.env.ECONOMY_DB_PATH;

    process.env.ECONOMY_DB_PATH = dbPath;
    await resetEconomyDatabaseForTests();

    try {
        await testFn(dbPath);
    } finally {
        await resetEconomyDatabaseForTests();
        if (typeof previousDbPath === 'string') {
            process.env.ECONOMY_DB_PATH = previousDbPath;
        } else {
            delete process.env.ECONOMY_DB_PATH;
        }

        await rm(directoryPath, { recursive: true, force: true });
    }
}

afterEach(async () => {
    await resetEconomyDatabaseForTests();
});

describe('economy database migrations', () => {
    it('migruje legacy economy_config przed seed insert', async () => {
        await withTempEconomyDb(async (dbPath) => {
            const legacyDb = await open({
                filename: dbPath,
                driver: sqlite3.Database,
            });

            await legacyDb.exec(`
                CREATE TABLE IF NOT EXISTS economy_config (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    daily_min_coins INTEGER NOT NULL,
                    daily_max_coins INTEGER NOT NULL,
                    daily_streak_increment REAL NOT NULL,
                    daily_streak_max_days INTEGER NOT NULL,
                    daily_streak_grace_hours INTEGER NOT NULL,
                    daily_messages_json TEXT NOT NULL,
                    leveling_mode TEXT NOT NULL,
                    leveling_base_xp INTEGER NOT NULL,
                    leveling_exponent REAL NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
            `);

            await legacyDb.run(
                `
                INSERT OR IGNORE INTO economy_config (
                    id,
                    daily_min_coins,
                    daily_max_coins,
                    daily_streak_increment,
                    daily_streak_max_days,
                    daily_streak_grace_hours,
                    daily_messages_json,
                    leveling_mode,
                    leveling_base_xp,
                    leveling_exponent,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                1,
                100,
                500,
                0.05,
                30,
                48,
                '[]',
                'progressive',
                100,
                1.5,
                Date.now(),
                Date.now(),
            );

            await legacyDb.close();

            const migratedDb = await getEconomyDatabase();
            const columns = await migratedDb.all<Array<{ name: string }>>('PRAGMA table_info(economy_config)');
            const names = columns.map((column) => column.name);

            expect(names).toContain('xp_text_per_message');
            expect(names).toContain('xp_voice_per_minute');
            expect(names).toContain('level_up_coins_base');
            expect(names).toContain('level_up_coins_per_level');
        });
    });
});
