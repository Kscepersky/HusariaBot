import { Guild } from 'discord.js';

/**
 * Zwraca string emotki serwerowej w formacie Discord (<:name:id> lub <a:name:id>).
 * Jeśli emotka nie istnieje na serwerze, zwraca pusty string.
 */
export function getGuildEmoji(guild: Guild | null | undefined, name: string): string {
    if (!guild) return '';
    const emoji = guild.emojis.cache.find(e => e.name === name);
    if (!emoji) return '';
    return emoji.animated
        ? `<a:${emoji.name}:${emoji.id}>`
        : `<:${emoji.name}:${emoji.id}>`;
}

/**
 * Zwraca obiekt emoji do użycia w opcjach SelectMenu.
 * Jeśli emotka nie istnieje, zwraca undefined (opcja będzie bez emoji).
 */
export function resolveEmojiForComponent(
    guild: Guild | null | undefined,
    name: string,
): { id: string; name: string } | undefined {
    if (!guild) return undefined;
    const emoji = guild.emojis.cache.find(e => e.name === name);
    if (!emoji) return undefined;
    return { id: emoji.id, name: emoji.name! };
}
