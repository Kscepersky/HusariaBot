import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';

let databasePromise: Promise<Database> | null = null;

function resolveEconomyDatabasePath(): string {
    const configuredPath = process.env.ECONOMY_DB_PATH?.trim();
    if (configuredPath) {
        return isAbsolute(configuredPath)
            ? configuredPath
            : join(process.cwd(), configuredPath);
    }

    return join(process.cwd(), 'data', 'economy.sqlite');
}

async function ensureEconomyConfigColumns(db: Database): Promise<void> {
    const columns = await db.all<Array<{ name: string }>>('PRAGMA table_info(economy_config)');
    const columnNames = new Set(columns.map((column) => column.name));

    const migrations: Array<{ name: string; sql: string }> = [
        {
            name: 'xp_text_per_message',
            sql: 'ALTER TABLE economy_config ADD COLUMN xp_text_per_message INTEGER NOT NULL DEFAULT 1',
        },
        {
            name: 'xp_text_cooldown_seconds',
            sql: 'ALTER TABLE economy_config ADD COLUMN xp_text_cooldown_seconds INTEGER NOT NULL DEFAULT 5',
        },
        {
            name: 'xp_voice_per_minute',
            sql: 'ALTER TABLE economy_config ADD COLUMN xp_voice_per_minute INTEGER NOT NULL DEFAULT 5',
        },
        {
            name: 'xp_voice_require_two_users',
            sql: 'ALTER TABLE economy_config ADD COLUMN xp_voice_require_two_users INTEGER NOT NULL DEFAULT 1',
        },
        {
            name: 'xp_voice_allow_self_mute',
            sql: 'ALTER TABLE economy_config ADD COLUMN xp_voice_allow_self_mute INTEGER NOT NULL DEFAULT 1',
        },
        {
            name: 'xp_voice_allow_self_deaf',
            sql: 'ALTER TABLE economy_config ADD COLUMN xp_voice_allow_self_deaf INTEGER NOT NULL DEFAULT 0',
        },
        {
            name: 'xp_voice_allow_afk',
            sql: 'ALTER TABLE economy_config ADD COLUMN xp_voice_allow_afk INTEGER NOT NULL DEFAULT 0',
        },
        {
            name: 'watchparty_xp_multiplier',
            sql: 'ALTER TABLE economy_config ADD COLUMN watchparty_xp_multiplier REAL NOT NULL DEFAULT 1',
        },
        {
            name: 'watchparty_coin_bonus_per_minute',
            sql: 'ALTER TABLE economy_config ADD COLUMN watchparty_coin_bonus_per_minute INTEGER NOT NULL DEFAULT 0',
        },
        {
            name: 'level_up_coins_base',
            sql: 'ALTER TABLE economy_config ADD COLUMN level_up_coins_base INTEGER NOT NULL DEFAULT 25',
        },
        {
            name: 'level_up_coins_per_level',
            sql: 'ALTER TABLE economy_config ADD COLUMN level_up_coins_per_level INTEGER NOT NULL DEFAULT 10',
        },
    ];

    for (const migration of migrations) {
        if (!columnNames.has(migration.name)) {
            await db.exec(migration.sql);
        }
    }
}

async function initializeSchema(db: Database): Promise<void> {
    await db.exec('PRAGMA journal_mode = WAL;');

    await db.exec(`
        CREATE TABLE IF NOT EXISTS economy_users (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            xp INTEGER NOT NULL DEFAULT 0,
            level INTEGER NOT NULL DEFAULT 0,
            coins INTEGER NOT NULL DEFAULT 0,
            daily_streak INTEGER NOT NULL DEFAULT 0,
            last_daily_claim_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id),
            CHECK (xp >= 0),
            CHECK (level >= 0),
            CHECK (daily_streak >= 0)
        );

        CREATE INDEX IF NOT EXISTS idx_economy_users_guild_coins
            ON economy_users(guild_id, coins DESC);

        CREATE INDEX IF NOT EXISTS idx_economy_users_guild_xp
            ON economy_users(guild_id, xp DESC);

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
            xp_text_per_message INTEGER NOT NULL DEFAULT 1,
            xp_text_cooldown_seconds INTEGER NOT NULL DEFAULT 5,
            xp_voice_per_minute INTEGER NOT NULL DEFAULT 5,
            xp_voice_require_two_users INTEGER NOT NULL DEFAULT 1,
            xp_voice_allow_self_mute INTEGER NOT NULL DEFAULT 1,
            xp_voice_allow_self_deaf INTEGER NOT NULL DEFAULT 0,
            xp_voice_allow_afk INTEGER NOT NULL DEFAULT 0,
            watchparty_xp_multiplier REAL NOT NULL DEFAULT 1,
            watchparty_coin_bonus_per_minute INTEGER NOT NULL DEFAULT 0,
            level_up_coins_base INTEGER NOT NULL DEFAULT 25,
            level_up_coins_per_level INTEGER NOT NULL DEFAULT 10,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            CHECK (daily_min_coins >= 0),
            CHECK (daily_max_coins >= daily_min_coins),
            CHECK (daily_streak_increment >= 0),
            CHECK (daily_streak_max_days >= 1),
            CHECK (daily_streak_grace_hours >= 24),
            CHECK (leveling_mode IN ('progressive', 'linear')),
            CHECK (leveling_base_xp >= 1),
            CHECK (leveling_exponent >= 1),
            CHECK (watchparty_xp_multiplier >= 0),
            CHECK (watchparty_coin_bonus_per_minute >= 0)
        );

        CREATE TABLE IF NOT EXISTS economy_admin_mutations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            admin_user_id TEXT NOT NULL,
            target_user_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            amount INTEGER NOT NULL,
            reason TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_economy_admin_mutations_created_at
            ON economy_admin_mutations(created_at DESC);
    `);

            await ensureEconomyConfigColumns(db);

    const now = Date.now();
    const defaultDailyMessages = JSON.stringify([
        '{user} odbiera dzienne cebuliony i zgarnia {coins} monet! Masz teraz {current_coins} monet. Streak: {streak} (x{multiplier}).',
    ]);

    await db.run(
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
            xp_text_per_message,
            xp_text_cooldown_seconds,
            xp_voice_per_minute,
            xp_voice_require_two_users,
            xp_voice_allow_self_mute,
            xp_voice_allow_self_deaf,
            xp_voice_allow_afk,
            watchparty_xp_multiplier,
            watchparty_coin_bonus_per_minute,
            level_up_coins_base,
            level_up_coins_per_level,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        1,
        100,
        500,
        0.05,
        30,
        48,
        defaultDailyMessages,
        'progressive',
        100,
        1.5,
        1,
        5,
        5,
        1,
        1,
        0,
        0,
        1,
        0,
        25,
        10,
        now,
        now,
    );
}

export async function getEconomyDatabase(): Promise<Database> {
    if (!databasePromise) {
        const initializationPromise = (async () => {
            const dbPath = resolveEconomyDatabasePath();
            await mkdir(dirname(dbPath), { recursive: true });

            const db = await open({
                filename: dbPath,
                driver: sqlite3.Database,
            });

            await initializeSchema(db);
            return db;
        })();

        databasePromise = initializationPromise.catch((error) => {
            databasePromise = null;
            throw error;
        });
    }

    return databasePromise;
}

export async function closeEconomyDatabase(): Promise<void> {
    const pendingDatabasePromise = databasePromise;
    if (!pendingDatabasePromise) {
        return;
    }

    try {
        const db = await pendingDatabasePromise;
        await db.close();
    } finally {
        databasePromise = null;
    }
}

export async function resetEconomyDatabaseForTests(): Promise<void> {
    await closeEconomyDatabase();
}
