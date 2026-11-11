import { getDiscordUserById } from './discord-api.js';
import { isSnowflake } from '../permissions/permission-store.js';
import { createLogger } from '../utils/logger.js';

const userSummariesLogger = createLogger('dashboard:user-summaries');
const USER_INFO_TTL_MS = 5 * 60 * 1000;

export interface UserSummary {
    id: string;
    username: string | null;
    globalName: string | null;
    avatar: string | null;
}

const userInfoCache = new Map<string, { value: UserSummary; fetchedAt: number }>();

export async function describeUser(userId: string): Promise<UserSummary> {
    const cached = userInfoCache.get(userId);
    if (cached && Date.now() - cached.fetchedAt < USER_INFO_TTL_MS) {
        return cached.value;
    }

    let value: UserSummary = { id: userId, username: null, globalName: null, avatar: null };
    try {
        const user = await getDiscordUserById(userId);
        if (user) {
            value = { id: userId, username: user.username, globalName: user.global_name ?? null, avatar: user.avatar ?? null };
        }
    } catch (error) {
        // Brak nazwy nie moze blokowac panelu - pokazemy samo ID.
        userSummariesLogger.warn('USER_LOOKUP_FAILED', 'Nie udalo sie pobrac danych uzytkownika.', { targetUserId: userId }, error);
        return value;
    }

    userInfoCache.set(userId, { value, fetchedAt: Date.now() });
    return value;
}

export async function describeUsers(userIds: readonly (string | null | undefined)[]): Promise<Record<string, UserSummary>> {
    const uniqueIds = [...new Set(userIds)].filter(isSnowflake);
    const summaries = await Promise.all(uniqueIds.map(describeUser));
    return Object.fromEntries(summaries.map((summary) => [summary.id, summary]));
}
