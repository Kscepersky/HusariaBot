export interface DiscordUserProfile {
    username: string;
    globalName: string | null;
    avatarHash: string | null;
    role: string | null;
}

const userCache = new Map<string, DiscordUserProfile>();

export function cacheDiscordUser(id: string, username: string, globalName: string | null, avatarHash: string | null, role: string | null = null): void {
    userCache.set(id, { username, globalName, avatarHash, role });
}

export function getDiscordUserProfile(id: string): DiscordUserProfile | undefined {
    return userCache.get(id);
}

export function getDiscordAvatarUrl(userId: string, avatarHash: string | null): string {
    if (!avatarHash) {
        return `https://cdn.discordapp.com/embed/avatars/0.png`;
    }
    return `https://cdn.discordapp.com/avatars/${encodeURIComponent(userId)}/${encodeURIComponent(avatarHash)}.png?size=32`;
}

export function enrichWithDiscordUser(id: string | undefined): { displayName: string | null; avatarUrl: string | null; role: string | null } {
    if (!id) return { displayName: null, avatarUrl: null, role: null };
    const profile = userCache.get(id);
    if (!profile) return { displayName: null, avatarUrl: null, role: null };
    return {
        displayName: profile.globalName ?? profile.username,
        avatarUrl: getDiscordAvatarUrl(id, profile.avatarHash),
        role: profile.role,
    };
}
