import type { Database } from 'sqlite';
import { getEconomyDatabase } from './database.js';
import type {
    EconomyAdminMutationResult,
    EconomyCsvImportResult,
    EconomyLeaderboardPage,
    EconomyLeaderboardSortBy,
    EconomyLevelRoleMapping,
    EconomyLevelRoleMappingInput,
    EconomyXpAwardResult,
    EconomyAdminOperation,
    DailyClaimContext,
    DailyClaimResult,
    DailyStreakSummary,
    EconomyConfig,
    EconomyUserState,
} from './types.js';

interface EconomyUserRow {
    guild_id: string;
    user_id: string;
    xp: number;
    level: number;
    coins: number;
    message_count: number;
    voice_minutes: number;
    daily_streak: number;
    last_daily_claim_at: number | null;
    created_at: number;
    updated_at: number;
}

interface EconomyConfigRow {
    daily_min_coins: number;
    daily_max_coins: number;
    daily_streak_increment: number;
    daily_streak_max_days: number;
    daily_streak_grace_hours: number;
    daily_messages_json: string;
    leveling_mode: 'progressive' | 'linear';
    leveling_curve: 'default' | 'formula_v2';
    leveling_base_xp: number;
    leveling_exponent: number;
    xp_text_per_message: number;
    xp_text_cooldown_seconds: number;
    xp_voice_per_minute: number;
    xp_voice_require_two_users: number;
    xp_voice_allow_self_mute: number;
    xp_voice_allow_self_deaf: number;
    xp_voice_allow_afk: number;
    watchparty_xp_multiplier: number;
    watchparty_coin_bonus_per_minute: number;
    level_up_coins_base: number;
    level_up_coins_per_level: number;
}

interface LeaderboardRow {
    user_id: string;
    xp: number;
    level: number;
    coins: number;
    message_count: number;
    voice_minutes: number;
}

interface EconomyLevelRoleMappingRow {
    guild_id: string;
    role_id: string;
    min_level: number;
    created_at: number;
    updated_at: number;
}

interface ClaimDailyRewardOptions {
    random: () => number;
}

interface AdminMutationInput {
    guildId: string;
    targetUserId: string;
    adminUserId: string;
    reason?: string;
    amount: number;
    nowTimestamp: number;
    operation: EconomyAdminOperation;
}

const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAILY_MESSAGE = '{user} odbiera dzienne cebuliony i zgarnia {coins} monet!';
const MAX_ADMIN_XP_MUTATION_AMOUNT = 1_000_000;
const MAX_ADMIN_LEVEL_MUTATION_AMOUNT = 1_000;
const MAX_CSV_IMPORT_ROWS = 10_000;
const ECONOMY_MIN_LEVEL = 1;
const ECONOMY_MAX_LEVEL = 10_000;
let economyWriteLock = Promise.resolve();

export class EconomyCsvImportValidationError extends Error {}
export class EconomyInputValidationError extends Error {}

function resolveAdminMutationReason(reason: string | undefined): string {
    const normalizedReason = reason?.trim() ?? '';
    return normalizedReason.length > 0
        ? normalizedReason
        : 'Dashboard: reczna mutacja';
}

function toSafeInt(value: number, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.floor(value);
}

function clampInt(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, toSafeInt(value, minimum)));
}

function clampFloat(value: number, minimum: number, maximum: number): number {
    if (!Number.isFinite(value)) {
        return minimum;
    }

    return Math.max(minimum, Math.min(maximum, value));
}

function sanitizeDailyMessageList(messages: string[]): string[] {
    const sanitizedMessages = messages
        .map((message) => message.trim())
        .filter((message) => message.length > 0)
        .slice(0, 50);

    return sanitizedMessages.length > 0
        ? sanitizedMessages
        : [DEFAULT_DAILY_MESSAGE];
}

function normalizeEconomyConfig(input: EconomyConfig): EconomyConfig {
    const dailyMinCoins = clampInt(input.dailyMinCoins, 0, 1_000_000);
    const dailyMaxCoins = Math.max(dailyMinCoins, clampInt(input.dailyMaxCoins, dailyMinCoins, 1_000_000));

    return {
        dailyMinCoins,
        dailyMaxCoins,
        dailyStreakIncrement: clampFloat(input.dailyStreakIncrement, 0, 10),
        dailyStreakMaxDays: clampInt(input.dailyStreakMaxDays, 1, 365),
        dailyStreakGraceHours: clampInt(input.dailyStreakGraceHours, 24, 168),
        dailyMessages: sanitizeDailyMessageList(input.dailyMessages),
        levelingMode: input.levelingMode === 'linear' ? 'linear' : 'progressive',
        levelingCurve: input.levelingCurve === 'formula_v2' ? 'formula_v2' : 'default',
        levelingBaseXp: clampInt(input.levelingBaseXp, 1, 1_000_000),
        levelingExponent: clampFloat(input.levelingExponent, 1, 8),
        xpTextPerMessage: clampInt(input.xpTextPerMessage, 0, 10_000),
        xpTextCooldownSeconds: clampInt(input.xpTextCooldownSeconds, 0, 86_400),
        xpVoicePerMinute: clampInt(input.xpVoicePerMinute, 0, 10_000),
        xpVoiceRequireTwoUsers: input.xpVoiceRequireTwoUsers === true,
        xpVoiceAllowSelfMute: input.xpVoiceAllowSelfMute === true,
        xpVoiceAllowSelfDeaf: input.xpVoiceAllowSelfDeaf === true,
        xpVoiceAllowAfk: input.xpVoiceAllowAfk === true,
        watchpartyXpMultiplier: clampFloat(input.watchpartyXpMultiplier, 0, 10),
        watchpartyCoinBonusPerMinute: clampInt(input.watchpartyCoinBonusPerMinute, 0, 10_000),
        levelUpCoinsBase: clampInt(input.levelUpCoinsBase, 0, 1_000_000),
        levelUpCoinsPerLevel: clampInt(input.levelUpCoinsPerLevel, 0, 1_000_000),
    };
}

function toEconomyUserState(row: EconomyUserRow): EconomyUserState {
    return {
        guildId: row.guild_id,
        userId: row.user_id,
        xp: row.xp,
        level: row.level,
        coins: row.coins,
        messageCount: row.message_count,
        voiceMinutes: row.voice_minutes,
        dailyStreak: row.daily_streak,
        lastDailyClaimAt: row.last_daily_claim_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function toEconomyLevelRoleMapping(row: EconomyLevelRoleMappingRow): EconomyLevelRoleMapping {
    return {
        guildId: row.guild_id,
        roleId: row.role_id,
        minLevel: row.min_level,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function parseDailyMessages(value: string): string[] {
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) {
            return [DEFAULT_DAILY_MESSAGE];
        }

        const messages = parsed
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter((item) => item.length > 0);

        return messages.length > 0 ? messages : [DEFAULT_DAILY_MESSAGE];
    } catch {
        return [DEFAULT_DAILY_MESSAGE];
    }
}

function toEconomyConfig(row: EconomyConfigRow): EconomyConfig {
    return {
        dailyMinCoins: row.daily_min_coins,
        dailyMaxCoins: row.daily_max_coins,
        dailyStreakIncrement: row.daily_streak_increment,
        dailyStreakMaxDays: row.daily_streak_max_days,
        dailyStreakGraceHours: row.daily_streak_grace_hours,
        dailyMessages: parseDailyMessages(row.daily_messages_json),
        levelingMode: row.leveling_mode,
        levelingCurve: row.leveling_curve === 'formula_v2' ? 'formula_v2' : 'default',
        levelingBaseXp: row.leveling_base_xp,
        levelingExponent: row.leveling_exponent,
        xpTextPerMessage: row.xp_text_per_message,
        xpTextCooldownSeconds: row.xp_text_cooldown_seconds,
        xpVoicePerMinute: row.xp_voice_per_minute,
        xpVoiceRequireTwoUsers: row.xp_voice_require_two_users === 1,
        xpVoiceAllowSelfMute: row.xp_voice_allow_self_mute === 1,
        xpVoiceAllowSelfDeaf: row.xp_voice_allow_self_deaf === 1,
        xpVoiceAllowAfk: row.xp_voice_allow_afk === 1,
        watchpartyXpMultiplier: row.watchparty_xp_multiplier,
        watchpartyCoinBonusPerMinute: row.watchparty_coin_bonus_per_minute,
        levelUpCoinsBase: row.level_up_coins_base,
        levelUpCoinsPerLevel: row.level_up_coins_per_level,
    };
}

function resolveXpForNextLevel(level: number, config: EconomyConfig): number {
    const safeLevel = Math.max(ECONOMY_MIN_LEVEL, Math.floor(level));

    if (config.levelingCurve === 'formula_v2') {
        const previousLevel = Math.max(0, safeLevel - 1);
        const formulaValue = 100
            + (0.04 * (previousLevel ** 3))
            + (0.8 * (previousLevel ** 2))
            + (2 * previousLevel)
            + 0.5;

        return Math.max(1, Math.floor(formulaValue));
    }

    if (config.levelingMode === 'linear') {
        return Math.max(1, Math.floor(config.levelingBaseXp * safeLevel));
    }

    return Math.max(1, Math.floor(config.levelingBaseXp * (safeLevel ** config.levelingExponent)));
}

function resolveLevelFromXp(totalXp: number, config: EconomyConfig): number {
    let level = ECONOMY_MIN_LEVEL;
    let remainingXp = Math.max(0, totalXp);

    while (level < ECONOMY_MAX_LEVEL) {
        const xpForNextLevel = resolveXpForNextLevel(level, config);
        if (remainingXp < xpForNextLevel) {
            return level;
        }

        remainingXp -= xpForNextLevel;
        level += 1;
    }

    return level;
}

function resolveXpSpentForLevel(level: number, config: EconomyConfig): number {
    const safeLevel = Math.max(ECONOMY_MIN_LEVEL, Math.floor(level));
    let xpSpent = 0;

    for (let currentLevel = ECONOMY_MIN_LEVEL; currentLevel < safeLevel; currentLevel += 1) {
        xpSpent += resolveXpForNextLevel(currentLevel, config);
    }

    return xpSpent;
}

function resolveTotalXpFromLevelAndProgress(level: number, xpIntoLevel: number, config: EconomyConfig): number {
    const safeLevel = Math.max(ECONOMY_MIN_LEVEL, Math.floor(level));
    const xpForCurrentLevel = resolveXpForNextLevel(safeLevel, config);
    const safeXpIntoLevel = Math.max(0, Math.floor(xpIntoLevel));

    if (safeXpIntoLevel >= xpForCurrentLevel) {
        throw new EconomyCsvImportValidationError(
            `XP wewnatrz levela (${safeXpIntoLevel}) musi byc mniejsze od progu kolejnego poziomu (${xpForCurrentLevel}).`,
        );
    }

    return resolveXpSpentForLevel(safeLevel, config) + safeXpIntoLevel;
}

function normalizeLevelRoleMappings(inputMappings: EconomyLevelRoleMappingInput[]): EconomyLevelRoleMappingInput[] {
    const normalized = inputMappings.map((mapping) => {
        return {
            roleId: String(mapping.roleId ?? '').trim(),
            minLevel: Math.max(1, Math.floor(mapping.minLevel)),
        };
    });

    const roleIdSet = new Set<string>();
    for (const mapping of normalized) {
        if (!/^\d{17,20}$/.test(mapping.roleId)) {
            throw new EconomyInputValidationError('Kazde mapowanie roli musi zawierac poprawne roleId (17-20 cyfr).');
        }

        if (roleIdSet.has(mapping.roleId)) {
            throw new EconomyInputValidationError(`Rola ${mapping.roleId} wystepuje wielokrotnie w mapowaniu leveli.`);
        }

        roleIdSet.add(mapping.roleId);
    }

    return [...normalized].sort((left, right) => {
        if (left.minLevel !== right.minLevel) {
            return left.minLevel - right.minLevel;
        }

        return left.roleId.localeCompare(right.roleId);
    });
}

function parseCsvImportRows(csvContent: string): string[] {
    const normalized = csvContent.replace(/^\uFEFF/, '');
    const rows = normalized
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    if (rows.length === 0) {
        throw new EconomyCsvImportValidationError('Plik CSV jest pusty.');
    }

    if (rows.length > MAX_CSV_IMPORT_ROWS) {
        throw new EconomyCsvImportValidationError(`Plik CSV przekracza limit ${MAX_CSV_IMPORT_ROWS} wierszy.`);
    }

    return rows;
}

export function resolveLevelProgress(totalXp: number, level: number, config: EconomyConfig): {
    xpIntoLevel: number;
    xpForNextLevel: number;
    xpToNextLevel: number;
} {
    const safeLevel = Math.max(ECONOMY_MIN_LEVEL, Math.floor(level));
    const xpSpentForCurrentLevel = resolveXpSpentForLevel(safeLevel, config);
    const xpIntoLevel = Math.max(0, totalXp - xpSpentForCurrentLevel);
    const xpForNextLevel = resolveXpForNextLevel(safeLevel, config);
    const xpToNextLevel = Math.max(0, xpForNextLevel - xpIntoLevel);

    return {
        xpIntoLevel,
        xpForNextLevel,
        xpToNextLevel,
    };
}

function resolveLevelUpCoins(previousLevel: number, currentLevel: number, config: EconomyConfig): number {
    if (currentLevel <= previousLevel) {
        return 0;
    }

    let awarded = 0;
    for (let level = previousLevel + 1; level <= currentLevel; level += 1) {
        awarded += config.levelUpCoinsBase + (level * config.levelUpCoinsPerLevel);
    }

    return Math.max(0, awarded);
}

async function withTransaction<T>(db: Database, work: () => Promise<T>): Promise<T> {
    await db.exec('BEGIN IMMEDIATE TRANSACTION');

    try {
        const result = await work();
        await db.exec('COMMIT');
        return result;
    } catch (error) {
        try {
            await db.exec('ROLLBACK');
        } catch (rollbackError) {
            console.error('❌  Rollback transakcji ekonomii nie powiodl sie:', rollbackError);
        }

        throw error;
    }
}

function withWriteLock<T>(work: () => Promise<T>): Promise<T> {
    const workPromise = economyWriteLock.then(work);

    economyWriteLock = workPromise.then(
        () => undefined,
        () => undefined,
    );

    return workPromise;
}

function roundMultiplier(value: number): number {
    return Number(value.toFixed(2));
}

function resolveCurrentMultiplier(streak: number, config: EconomyConfig): number {
    if (streak <= 0) {
        return 1;
    }

    const boundedStreak = Math.min(streak, config.dailyStreakMaxDays);
    const extraDays = Math.max(0, boundedStreak - 1);
    return roundMultiplier(1 + (extraDays * config.dailyStreakIncrement));
}

function resolveDailyCoinsRoll(config: EconomyConfig, random: () => number): number {
    const boundedRandom = Math.min(0.999_999_999, Math.max(0, random()));
    const range = config.dailyMaxCoins - config.dailyMinCoins;

    if (range <= 0) {
        return config.dailyMinCoins;
    }

    return config.dailyMinCoins + Math.floor(boundedRandom * (range + 1));
}

function formatDailyMessage(template: string, payload: {
    user: string;
    coins: number;
    currentCoins: number;
    streak: number;
    multiplier: number;
}): string {
    const tokens: Record<string, string> = {
        '{user}': payload.user,
        '{coins}': String(payload.coins),
        '{current_coins}': String(payload.currentCoins),
        '{streak}': String(payload.streak),
        '{multiplier}': payload.multiplier.toFixed(2),
    };

    return Object.entries(tokens).reduce((message, [token, value]) => {
        return message.split(token).join(value);
    }, template);
}

function resolveStreakAfterClaim(
    previousStreak: number,
    previousClaimAt: number | null,
    nowTimestamp: number,
    graceHours: number,
    maxDays: number,
): number {
    if (previousClaimAt === null) {
        return 1;
    }

    const elapsedMs = nowTimestamp - previousClaimAt;
    const streakGraceMs = graceHours * 60 * 60 * 1000;

    if (elapsedMs <= streakGraceMs) {
        return Math.min(previousStreak + 1, maxDays);
    }

    return 1;
}

function resolveEffectiveStreak(
    storedStreak: number,
    previousClaimAt: number | null,
    nowTimestamp: number,
    graceHours: number,
): number {
    if (storedStreak <= 0 || previousClaimAt === null) {
        return 0;
    }

    const elapsedMs = nowTimestamp - previousClaimAt;
    const streakGraceMs = graceHours * 60 * 60 * 1000;
    return elapsedMs <= streakGraceMs ? storedStreak : 0;
}

async function getOrCreateEconomyUser(
    db: Database,
    guildId: string,
    userId: string,
    nowTimestamp: number,
): Promise<EconomyUserState> {
    await db.run(
        `
        INSERT OR IGNORE INTO economy_users (
            guild_id,
            user_id,
            xp,
            level,
            coins,
            message_count,
            voice_minutes,
            daily_streak,
            last_daily_claim_at,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        guildId,
        userId,
        0,
        ECONOMY_MIN_LEVEL,
        0,
        0,
        0,
        0,
        null,
        nowTimestamp,
        nowTimestamp,
    );

    const row = await db.get<EconomyUserRow>(
        `
        SELECT *
        FROM economy_users
        WHERE guild_id = ?
          AND user_id = ?
        LIMIT 1
        `,
        guildId,
        userId,
    );

    if (!row) {
        throw new Error('Nie udalo sie utworzyc rekordu ekonomii uzytkownika.');
    }

    return toEconomyUserState(row);
}

async function getEconomyConfigFromDatabase(db: Database): Promise<EconomyConfig> {
    const row = await db.get<EconomyConfigRow>(
        `
        SELECT
            daily_min_coins,
            daily_max_coins,
            daily_streak_increment,
            daily_streak_max_days,
            daily_streak_grace_hours,
            daily_messages_json,
            leveling_mode,
            leveling_curve,
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
            level_up_coins_per_level
        FROM economy_config
        WHERE id = 1
        LIMIT 1
        `,
    );

    if (!row) {
        throw new Error('Nie znaleziono konfiguracji ekonomii.');
    }

    return toEconomyConfig(row);
}

export async function getEconomyConfig(): Promise<EconomyConfig> {
    const db = await getEconomyDatabase();
    return getEconomyConfigFromDatabase(db);
}

export async function updateEconomyConfig(
    input: EconomyConfig,
    nowTimestamp: number,
): Promise<EconomyConfig> {
    const db = await getEconomyDatabase();
    const config = normalizeEconomyConfig(input);

    return withWriteLock(async () => {
        return withTransaction(db, async () => {
            await db.run(
                `
                UPDATE economy_config
                SET daily_min_coins = ?,
                    daily_max_coins = ?,
                    daily_streak_increment = ?,
                    daily_streak_max_days = ?,
                    daily_streak_grace_hours = ?,
                    daily_messages_json = ?,
                    leveling_mode = ?,
                    leveling_curve = ?,
                    leveling_base_xp = ?,
                    leveling_exponent = ?,
                    xp_text_per_message = ?,
                    xp_text_cooldown_seconds = ?,
                    xp_voice_per_minute = ?,
                    xp_voice_require_two_users = ?,
                    xp_voice_allow_self_mute = ?,
                    xp_voice_allow_self_deaf = ?,
                    xp_voice_allow_afk = ?,
                    watchparty_xp_multiplier = ?,
                    watchparty_coin_bonus_per_minute = ?,
                    level_up_coins_base = ?,
                    level_up_coins_per_level = ?,
                    updated_at = ?
                WHERE id = 1
                `,
                config.dailyMinCoins,
                config.dailyMaxCoins,
                config.dailyStreakIncrement,
                config.dailyStreakMaxDays,
                config.dailyStreakGraceHours,
                JSON.stringify(config.dailyMessages),
                config.levelingMode,
                config.levelingCurve,
                config.levelingBaseXp,
                config.levelingExponent,
                config.xpTextPerMessage,
                config.xpTextCooldownSeconds,
                config.xpVoicePerMinute,
                config.xpVoiceRequireTwoUsers ? 1 : 0,
                config.xpVoiceAllowSelfMute ? 1 : 0,
                config.xpVoiceAllowSelfDeaf ? 1 : 0,
                config.xpVoiceAllowAfk ? 1 : 0,
                config.watchpartyXpMultiplier,
                config.watchpartyCoinBonusPerMinute,
                config.levelUpCoinsBase,
                config.levelUpCoinsPerLevel,
                nowTimestamp,
            );

            return getEconomyConfigFromDatabase(db);
        });
    });
}

export async function resetEconomyUsers(guildId: string): Promise<number> {
    const db = await getEconomyDatabase();

    return withWriteLock(async () => {
        return withTransaction(db, async () => {
            const result = await db.run(
                `
                DELETE FROM economy_users
                WHERE guild_id = ?
                `,
                guildId,
            );

            return Number(result?.changes ?? 0);
        });
    });
}

export async function incrementMessageCount(
    guildId: string,
    userId: string,
    nowTimestamp: number,
): Promise<void> {
    const db = await getEconomyDatabase();

    await withWriteLock(async () => {
        await withTransaction(db, async () => {
            await getOrCreateEconomyUser(db, guildId, userId, nowTimestamp);

            await db.run(
                `
                UPDATE economy_users
                SET message_count = message_count + 1,
                    updated_at = ?
                WHERE guild_id = ?
                  AND user_id = ?
                `,
                nowTimestamp,
                guildId,
                userId,
            );
        });
    });
}

export async function incrementVoiceMinutes(
    guildId: string,
    userId: string,
    minutes: number,
    nowTimestamp: number,
): Promise<void> {
    const db = await getEconomyDatabase();
    const safeMinutes = Math.max(1, Math.floor(minutes));

    await withWriteLock(async () => {
        await withTransaction(db, async () => {
            await getOrCreateEconomyUser(db, guildId, userId, nowTimestamp);

            await db.run(
                `
                UPDATE economy_users
                SET voice_minutes = voice_minutes + ?,
                    updated_at = ?
                WHERE guild_id = ?
                  AND user_id = ?
                `,
                safeMinutes,
                nowTimestamp,
                guildId,
                userId,
            );
        });
    });
}

export async function getEconomyUserRankByXp(
    guildId: string,
    userId: string,
    nowTimestamp: number,
): Promise<number> {
    const db = await getEconomyDatabase();

    await getOrCreateEconomyUser(db, guildId, userId, nowTimestamp);

    const rankRow = await db.get<{ rank: number }>(
        `
        SELECT 1 + COUNT(*) AS rank
        FROM economy_users AS higher
        INNER JOIN economy_users AS target
            ON target.guild_id = ?
           AND target.user_id = ?
        WHERE higher.guild_id = target.guild_id
          AND (
              higher.xp > target.xp
              OR (higher.xp = target.xp AND higher.level > target.level)
              OR (higher.xp = target.xp AND higher.level = target.level AND higher.coins > target.coins)
              OR (higher.xp = target.xp AND higher.level = target.level AND higher.coins = target.coins AND higher.user_id < target.user_id)
          )
        `,
        guildId,
        userId,
    );

    return Math.max(1, Number(rankRow?.rank ?? 1));
}

export async function getEconomyLevelRoleMappings(guildId: string): Promise<EconomyLevelRoleMapping[]> {
    const db = await getEconomyDatabase();
    const rows = await db.all<EconomyLevelRoleMappingRow[]>(
        `
        SELECT guild_id, role_id, min_level, created_at, updated_at
        FROM economy_level_roles
        WHERE guild_id = ?
        ORDER BY min_level ASC, role_id ASC
        `,
        guildId,
    );

    return rows.map((row) => toEconomyLevelRoleMapping(row));
}

export async function replaceEconomyLevelRoleMappings(
    guildId: string,
    inputMappings: EconomyLevelRoleMappingInput[],
    nowTimestamp: number,
): Promise<EconomyLevelRoleMapping[]> {
    const db = await getEconomyDatabase();
    const mappings = normalizeLevelRoleMappings(inputMappings);

    return withWriteLock(async () => {
        return withTransaction(db, async () => {
            await db.run(
                `
                DELETE FROM economy_level_roles
                WHERE guild_id = ?
                `,
                guildId,
            );

            for (const mapping of mappings) {
                await db.run(
                    `
                    INSERT INTO economy_level_roles (
                        guild_id,
                        role_id,
                        min_level,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?)
                    `,
                    guildId,
                    mapping.roleId,
                    mapping.minLevel,
                    nowTimestamp,
                    nowTimestamp,
                );
            }

            const rows = await db.all<EconomyLevelRoleMappingRow[]>(
                `
                SELECT guild_id, role_id, min_level, created_at, updated_at
                FROM economy_level_roles
                WHERE guild_id = ?
                ORDER BY min_level ASC, role_id ASC
                `,
                guildId,
            );

            return rows.map((row) => toEconomyLevelRoleMapping(row));
        });
    });
}

function parseCsvIntegerField(rawValue: string, lineNumber: number, columnName: string, minimum: number): number {
    if (!/^-?\d+$/.test(rawValue)) {
        throw new EconomyCsvImportValidationError(`Wiersz ${lineNumber}: pole ${columnName} musi byc liczba calkowita.`);
    }

    const parsedValue = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsedValue) || parsedValue < minimum) {
        throw new EconomyCsvImportValidationError(`Wiersz ${lineNumber}: pole ${columnName} musi byc >= ${minimum}.`);
    }

    return parsedValue;
}

export async function importEconomyCsvSnapshot(input: {
    guildId: string;
    csvContent: string;
    nowTimestamp: number;
}): Promise<EconomyCsvImportResult> {
    const db = await getEconomyDatabase();
    const rows = parseCsvImportRows(input.csvContent);

    return withWriteLock(async () => {
        return withTransaction(db, async () => {
            const config = await getEconomyConfigFromDatabase(db);
            let insertedRows = 0;
            let updatedRows = 0;
            const seenUserIds = new Set<string>();

            for (let index = 0; index < rows.length; index += 1) {
                const lineNumber = index + 1;
                const columns = rows[index].split(',').map((value) => value.trim());

                if (columns.length !== 5) {
                    throw new EconomyCsvImportValidationError(
                        `Wiersz ${lineNumber}: oczekiwano 5 kolumn w formacie userId,level,xp,messages,voiceMinutes.`,
                    );
                }

                const [userId, levelRaw, xpRaw, messageCountRaw, voiceMinutesRaw] = columns;

                if (!/^\d{17,20}$/.test(userId)) {
                    throw new EconomyCsvImportValidationError(`Wiersz ${lineNumber}: pole userId ma niepoprawny format.`);
                }

                if (seenUserIds.has(userId)) {
                    throw new EconomyCsvImportValidationError(`Wiersz ${lineNumber}: userId ${userId} wystepuje wielokrotnie w pliku.`);
                }

                seenUserIds.add(userId);

                const level = parseCsvIntegerField(levelRaw, lineNumber, 'level', ECONOMY_MIN_LEVEL);
                const xpIntoLevel = parseCsvIntegerField(xpRaw, lineNumber, 'xp', 0);
                const messageCount = parseCsvIntegerField(messageCountRaw, lineNumber, 'messages', 0);
                const voiceMinutes = parseCsvIntegerField(voiceMinutesRaw, lineNumber, 'voiceMinutes', 0);

                if (level > ECONOMY_MAX_LEVEL) {
                    throw new EconomyCsvImportValidationError(`Wiersz ${lineNumber}: level nie moze przekraczac 10000.`);
                }

                let totalXp = 0;
                try {
                    totalXp = resolveTotalXpFromLevelAndProgress(level, xpIntoLevel, config);
                } catch (error) {
                    if (error instanceof EconomyCsvImportValidationError) {
                        throw new EconomyCsvImportValidationError(`Wiersz ${lineNumber}: ${error.message}`);
                    }

                    throw error;
                }

                const updateResult = await db.run(
                    `
                    UPDATE economy_users
                    SET xp = ?,
                        level = ?,
                        message_count = ?,
                        voice_minutes = ?,
                        updated_at = ?
                    WHERE guild_id = ?
                      AND user_id = ?
                    `,
                    totalXp,
                    level,
                    messageCount,
                    voiceMinutes,
                    input.nowTimestamp,
                    input.guildId,
                    userId,
                );

                if (Number(updateResult?.changes ?? 0) > 0) {
                    updatedRows += 1;
                    continue;
                }

                await db.run(
                    `
                    INSERT INTO economy_users (
                        guild_id,
                        user_id,
                        xp,
                        level,
                        coins,
                        message_count,
                        voice_minutes,
                        daily_streak,
                        last_daily_claim_at,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `,
                    input.guildId,
                    userId,
                    totalXp,
                    level,
                    0,
                    messageCount,
                    voiceMinutes,
                    0,
                    null,
                    input.nowTimestamp,
                    input.nowTimestamp,
                );

                insertedRows += 1;
            }

            return {
                importedRows: rows.length,
                insertedRows,
                updatedRows,
            };
        });
    });
}

export async function getEconomyUserState(
    guildId: string,
    userId: string,
    nowTimestamp: number,
): Promise<EconomyUserState> {
    const db = await getEconomyDatabase();
    return getOrCreateEconomyUser(db, guildId, userId, nowTimestamp);
}

export async function claimDailyReward(
    context: DailyClaimContext,
    options: Partial<ClaimDailyRewardOptions> = {},
): Promise<DailyClaimResult> {
    const db = await getEconomyDatabase();
    const random = options.random ?? Math.random;

    return withWriteLock(async () => {
        return withTransaction(db, async () => {
            const config = await getEconomyConfigFromDatabase(db);
            const user = await getOrCreateEconomyUser(db, context.guildId, context.userId, context.nowTimestamp);

            if (user.lastDailyClaimAt !== null) {
                const retryAt = user.lastDailyClaimAt + DAILY_COOLDOWN_MS;
                if (context.nowTimestamp < retryAt) {
                    const effectiveStreak = resolveEffectiveStreak(
                        user.dailyStreak,
                        user.lastDailyClaimAt,
                        context.nowTimestamp,
                        config.dailyStreakGraceHours,
                    );

                    return {
                        status: 'cooldown',
                        retryAt,
                        remainingMs: Math.max(0, retryAt - context.nowTimestamp),
                        streak: effectiveStreak,
                        multiplier: resolveCurrentMultiplier(effectiveStreak, config),
                    };
                }
            }

            const nextStreak = resolveStreakAfterClaim(
                user.dailyStreak,
                user.lastDailyClaimAt,
                context.nowTimestamp,
                config.dailyStreakGraceHours,
                config.dailyStreakMaxDays,
            );

            const multiplier = resolveCurrentMultiplier(nextStreak, config);
            const baseCoinsRoll = resolveDailyCoinsRoll(config, random);
            const coinsAwarded = Math.max(0, Math.floor(baseCoinsRoll * multiplier));
            const currentCoins = user.coins + coinsAwarded;

            await db.run(
                `
                UPDATE economy_users
                SET coins = ?,
                    daily_streak = ?,
                    last_daily_claim_at = ?,
                    updated_at = ?
                WHERE guild_id = ?
                  AND user_id = ?
                `,
                currentCoins,
                nextStreak,
                context.nowTimestamp,
                context.nowTimestamp,
                context.guildId,
                context.userId,
            );

            const messages = config.dailyMessages;
            const template = messages[Math.floor(Math.min(messages.length - 1, random() * messages.length))] ?? DEFAULT_DAILY_MESSAGE;

            return {
                status: 'claimed',
                coinsAwarded,
                baseCoinsRoll,
                multiplier,
                streak: nextStreak,
                currentCoins,
                nextClaimAt: context.nowTimestamp + DAILY_COOLDOWN_MS,
                message: formatDailyMessage(template, {
                    user: context.displayName,
                    coins: coinsAwarded,
                    currentCoins,
                    streak: nextStreak,
                    multiplier,
                }),
            };
        });
    });
}

export async function getDailyStreakSummary(
    guildId: string,
    userId: string,
    nowTimestamp: number,
): Promise<DailyStreakSummary> {
    const db = await getEconomyDatabase();
    const config = await getEconomyConfigFromDatabase(db);
    const user = await getOrCreateEconomyUser(db, guildId, userId, nowTimestamp);

    const effectiveStreak = resolveEffectiveStreak(
        user.dailyStreak,
        user.lastDailyClaimAt,
        nowTimestamp,
        config.dailyStreakGraceHours,
    );

    const nextClaimAt = user.lastDailyClaimAt === null
        ? null
        : user.lastDailyClaimAt + DAILY_COOLDOWN_MS;

    const canClaimNow = nextClaimAt === null || nowTimestamp >= nextClaimAt;

    return {
        streak: effectiveStreak,
        multiplier: resolveCurrentMultiplier(effectiveStreak, config),
        canClaimNow,
        nextClaimAt,
        lastClaimAt: user.lastDailyClaimAt,
    };
}

async function awardXp(
    guildId: string,
    userId: string,
    nowTimestamp: number,
    amount: number,
    options: {
        bonusCoins?: number;
        config?: EconomyConfig;
    } = {},
): Promise<EconomyXpAwardResult> {
    const db = await getEconomyDatabase();

    return withWriteLock(async () => {
        return withTransaction(db, async () => {
            const config = options.config ?? await getEconomyConfigFromDatabase(db);
            const user = await getOrCreateEconomyUser(db, guildId, userId, nowTimestamp);
            const awardedXp = Math.max(0, Math.floor(amount));
            const bonusCoins = Math.max(0, Math.floor(options.bonusCoins ?? 0));

            const previousXp = user.xp;
            const currentXp = user.xp + awardedXp;
            const previousLevel = user.level;
            const currentLevel = resolveLevelFromXp(currentXp, config);
            const levelsGained = Math.max(0, currentLevel - previousLevel);
            const levelUpCoinsAwarded = resolveLevelUpCoins(previousLevel, currentLevel, config);
            const coinsAwarded = levelUpCoinsAwarded + bonusCoins;
            const currentCoins = user.coins + coinsAwarded;

            await db.run(
                `
                UPDATE economy_users
                SET xp = ?,
                    level = ?,
                    coins = ?,
                    updated_at = ?
                WHERE guild_id = ?
                  AND user_id = ?
                `,
                currentXp,
                currentLevel,
                currentCoins,
                nowTimestamp,
                guildId,
                userId,
            );

            return {
                guildId,
                userId,
                awardedXp,
                previousXp,
                currentXp,
                previousLevel,
                currentLevel,
                levelsGained,
                coinsAwarded,
                currentCoins,
                createdAt: nowTimestamp,
            };
        });
    });
}

export async function awardMessageXp(
    guildId: string,
    userId: string,
    nowTimestamp: number,
): Promise<EconomyXpAwardResult> {
    const config = await getEconomyConfig();
    return awardXp(guildId, userId, nowTimestamp, config.xpTextPerMessage, { config });
}

export async function awardVoiceXp(
    guildId: string,
    userId: string,
    nowTimestamp: number,
    multiplier: number = 1,
): Promise<EconomyXpAwardResult> {
    const config = await getEconomyConfig();
    const amount = Math.max(0, Math.floor(config.xpVoicePerMinute * Math.max(0, multiplier)));
    return awardXp(guildId, userId, nowTimestamp, amount, { config });
}

export async function awardWatchpartyVoiceActivity(
    guildId: string,
    userId: string,
    nowTimestamp: number,
    config: EconomyConfig,
): Promise<EconomyXpAwardResult> {
    const xpAmount = Math.max(0, Math.floor(config.xpVoicePerMinute * config.watchpartyXpMultiplier));
    const bonusCoins = Math.max(0, Math.floor(config.watchpartyCoinBonusPerMinute));

    return awardXp(guildId, userId, nowTimestamp, xpAmount, {
        bonusCoins,
        config,
    });
}

export async function getEconomyLeaderboardPage(
    guildId: string,
    sortBy: EconomyLeaderboardSortBy,
    page: number,
    pageSize: number,
): Promise<EconomyLeaderboardPage> {
    const db = await getEconomyDatabase();
    const config = await getEconomyConfigFromDatabase(db);
    const safePageSize = Math.max(1, Math.min(25, pageSize));
    const safePage = Math.max(1, page);

    const countRow = await db.get<{ count: number }>(
        `
        SELECT COUNT(*) AS count
        FROM economy_users
        WHERE guild_id = ?
        `,
        guildId,
    );

    const totalRows = countRow?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalRows / safePageSize));
    const normalizedPage = Math.min(safePage, totalPages);
    const offset = (normalizedPage - 1) * safePageSize;

    const orderBySql = sortBy === 'xp'
        ? 'xp DESC, level DESC, coins DESC, user_id ASC'
        : 'coins DESC, xp DESC, level DESC, user_id ASC';

    const rows = await db.all<LeaderboardRow[]>(
        `
        SELECT user_id, xp, level, coins, message_count, voice_minutes
        FROM economy_users
        WHERE guild_id = ?
        ORDER BY ${orderBySql}
        LIMIT ? OFFSET ?
        `,
        guildId,
        safePageSize,
        offset,
    );

    const entries = rows.map((row, index) => {
        const progress = resolveLevelProgress(row.xp, row.level, config);

        return {
            rank: offset + index + 1,
            userId: row.user_id,
            xp: row.xp,
            level: row.level,
            coins: row.coins,
            messageCount: row.message_count,
            voiceMinutes: row.voice_minutes,
            xpIntoLevel: progress.xpIntoLevel,
            xpForNextLevel: progress.xpForNextLevel,
            xpToNextLevel: progress.xpToNextLevel,
        };
    });

    return {
        sortBy,
        page: normalizedPage,
        pageSize: safePageSize,
        totalRows,
        totalPages,
        entries,
    };
}

async function applyAdminMutation(input: AdminMutationInput): Promise<EconomyAdminMutationResult> {
    const db = await getEconomyDatabase();

    return withWriteLock(async () => {
        return withTransaction(db, async () => {
            const user = await getOrCreateEconomyUser(db, input.guildId, input.targetUserId, input.nowTimestamp);

            const previousCoins = user.coins;
            const previousXp = user.xp;
            const previousLevel = user.level;

            let currentCoins = user.coins;
            let currentXp = user.xp;
            let currentLevel = user.level;

            if (input.operation === 'add_coins') {
                currentCoins = user.coins + input.amount;
            } else if (input.operation === 'remove_coins') {
                currentCoins = Math.max(0, user.coins - input.amount);
            } else if (input.operation === 'reset_coins') {
                currentCoins = 0;
            } else if (input.operation === 'reset_level') {
                currentLevel = ECONOMY_MIN_LEVEL;
                currentXp = 0;
            } else if (input.operation === 'add_xp') {
                const config = await getEconomyConfigFromDatabase(db);
                currentXp = user.xp + input.amount;
                currentLevel = resolveLevelFromXp(currentXp, config);
                const levelUpCoinsAwarded = resolveLevelUpCoins(user.level, currentLevel, config);
                currentCoins = user.coins + levelUpCoinsAwarded;
            } else if (input.operation === 'add_levels') {
                const config = await getEconomyConfigFromDatabase(db);
                const levelsToAdd = Math.max(1, Math.floor(input.amount));
                let xpToAdd = 0;

                for (let level = user.level; level < (user.level + levelsToAdd); level += 1) {
                    xpToAdd += resolveXpForNextLevel(level, config);
                }

                currentXp = user.xp + xpToAdd;
                currentLevel = resolveLevelFromXp(currentXp, config);
                const levelUpCoinsAwarded = resolveLevelUpCoins(user.level, currentLevel, config);
                currentCoins = user.coins + levelUpCoinsAwarded;
            }

            await db.run(
                `
                UPDATE economy_users
                SET coins = ?,
                    xp = ?,
                    level = ?,
                    updated_at = ?
                WHERE guild_id = ?
                  AND user_id = ?
                `,
                currentCoins,
                currentXp,
                currentLevel,
                input.nowTimestamp,
                input.guildId,
                input.targetUserId,
            );

            await db.run(
                `
                INSERT INTO economy_admin_mutations (
                    guild_id,
                    admin_user_id,
                    target_user_id,
                    operation,
                    amount,
                    reason,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                `,
                input.guildId,
                input.adminUserId,
                input.targetUserId,
                input.operation,
                input.amount,
                resolveAdminMutationReason(input.reason),
                input.nowTimestamp,
            );

            return {
                guildId: input.guildId,
                userId: input.targetUserId,
                operation: input.operation,
                amount: input.amount,
                previousCoins,
                currentCoins,
                previousXp,
                currentXp,
                previousLevel,
                currentLevel,
                createdAt: input.nowTimestamp,
            };
        });
    });
}

export async function addCoinsByAdmin(input: Omit<AdminMutationInput, 'operation'>): Promise<EconomyAdminMutationResult> {
    return applyAdminMutation({
        ...input,
        amount: Math.max(1, input.amount),
        operation: 'add_coins',
    });
}

export async function removeCoinsByAdmin(input: Omit<AdminMutationInput, 'operation'>): Promise<EconomyAdminMutationResult> {
    return applyAdminMutation({
        ...input,
        amount: Math.max(1, input.amount),
        operation: 'remove_coins',
    });
}

export async function resetCoinsByAdmin(input: Omit<AdminMutationInput, 'operation' | 'amount'>): Promise<EconomyAdminMutationResult> {
    return applyAdminMutation({
        ...input,
        amount: 0,
        operation: 'reset_coins',
    });
}

export async function resetLevelByAdmin(input: Omit<AdminMutationInput, 'operation' | 'amount'>): Promise<EconomyAdminMutationResult> {
    return applyAdminMutation({
        ...input,
        amount: 0,
        operation: 'reset_level',
    });
}

export async function addXpByAdmin(input: Omit<AdminMutationInput, 'operation'>): Promise<EconomyAdminMutationResult> {
    return applyAdminMutation({
        ...input,
        amount: Math.min(MAX_ADMIN_XP_MUTATION_AMOUNT, Math.max(1, input.amount)),
        operation: 'add_xp',
    });
}

export async function addLevelsByAdmin(input: Omit<AdminMutationInput, 'operation'>): Promise<EconomyAdminMutationResult> {
    return applyAdminMutation({
        ...input,
        amount: Math.min(MAX_ADMIN_LEVEL_MUTATION_AMOUNT, Math.max(1, input.amount)),
        operation: 'add_levels',
    });
}
