import { getEconomyDatabase } from '../economy/database.js';

interface LeaderboardProfileCacheRow {
    guild_id: string;
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    expires_at: number;
    updated_at: number;
}

export interface StoredLeaderboardProfile {
    guildId: string;
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    expiresAt: number;
    updatedAt: number;
}

function normalizeIdentifier(value: string): string {
    return value.trim();
}

function normalizeDisplayName(value: string): string {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized.slice(0, 128) : 'Uzytkownik';
}

function normalizeAvatarUrl(value: string | null | undefined): string | null {
    const normalized = value?.trim() ?? '';
    return normalized.length > 0 ? normalized.slice(0, 512) : null;
}

function toStoredLeaderboardProfile(row: LeaderboardProfileCacheRow): StoredLeaderboardProfile {
    return {
        guildId: row.guild_id,
        userId: row.user_id,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        expiresAt: row.expires_at,
        updatedAt: row.updated_at,
    };
}

export async function getStoredLeaderboardProfile(
    guildId: string,
    userId: string,
): Promise<StoredLeaderboardProfile | null> {
    const normalizedGuildId = normalizeIdentifier(guildId);
    const normalizedUserId = normalizeIdentifier(userId);
    if (!normalizedGuildId || !normalizedUserId) {
        return null;
    }

    const db = await getEconomyDatabase();
    const row = await db.get<LeaderboardProfileCacheRow>(
        `
        SELECT guild_id, user_id, display_name, avatar_url, expires_at, updated_at
        FROM dashboard_leaderboard_profile_cache
        WHERE guild_id = ? AND user_id = ?
        LIMIT 1
        `,
        normalizedGuildId,
        normalizedUserId,
    );

    if (!row) {
        return null;
    }

    return toStoredLeaderboardProfile(row);
}

export async function upsertStoredLeaderboardProfile(
    profile: {
        guildId: string;
        userId: string;
        displayName: string;
        avatarUrl: string | null;
        expiresAt: number;
    },
): Promise<void> {
    const normalizedGuildId = normalizeIdentifier(profile.guildId);
    const normalizedUserId = normalizeIdentifier(profile.userId);
    if (!normalizedGuildId || !normalizedUserId) {
        return;
    }

    const normalizedDisplayName = normalizeDisplayName(profile.displayName);
    const normalizedAvatarUrl = normalizeAvatarUrl(profile.avatarUrl);
    const normalizedExpiresAt = Number.isFinite(profile.expiresAt)
        ? Math.max(0, Math.floor(profile.expiresAt))
        : Date.now();
    const now = Date.now();

    const db = await getEconomyDatabase();
    await db.run(
        `
        INSERT INTO dashboard_leaderboard_profile_cache (
            guild_id,
            user_id,
            display_name,
            avatar_url,
            expires_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
            display_name = excluded.display_name,
            avatar_url = excluded.avatar_url,
            expires_at = excluded.expires_at,
            updated_at = excluded.updated_at
        `,
        normalizedGuildId,
        normalizedUserId,
        normalizedDisplayName,
        normalizedAvatarUrl,
        normalizedExpiresAt,
        now,
    );
}

export async function pruneStoredLeaderboardProfiles(expiredBeforeMs: number): Promise<void> {
    const normalizedExpiredBeforeMs = Number.isFinite(expiredBeforeMs)
        ? Math.max(0, Math.floor(expiredBeforeMs))
        : Date.now();

    const db = await getEconomyDatabase();
    await db.run(
        `
        DELETE FROM dashboard_leaderboard_profile_cache
        WHERE expires_at <= ?
        `,
        normalizedExpiredBeforeMs,
    );
}
