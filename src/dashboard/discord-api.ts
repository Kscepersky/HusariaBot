import { config } from 'dotenv';
import { readdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';
config();

const DISCORD_API = 'https://discord.com/api/v10';

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

export interface DiscordUser {
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
    discriminator: string;
    bot?: boolean;
}

export interface DiscordGuildMember {
    user?: DiscordUser;
    roles: string[];
    nick: string | null;
}

export interface DiscordChannel {
    id: string;
    name: string;
    type: number;
    position: number;
    parent_id: string | null;
}

export interface DiscordRole {
    id: string;
    name: string;
    position: number;
    managed: boolean;
}

export interface DiscordEmoji {
    id: string;
    name: string | null;
    animated?: boolean;
}

export interface DiscordMessagePayload {
    content?: string;
    embeds?: object[];
    allowed_mentions?: {
        parse: string[];
        roles?: string[];
        users?: string[];
    };
}

export interface DiscordMentionUser {
    id: string;
    username: string;
    globalName: string | null;
    nick: string | null;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<string> {
    const resp = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: requireEnv('CLIENT_ID'),
            client_secret: requireEnv('DISCORD_CLIENT_SECRET'),
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
        }),
    });

    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`OAuth2 token exchange failed: ${resp.status} — ${err}`);
    }

    const data = await resp.json() as { access_token: string };
    return data.access_token;
}

export async function getDiscordUser(accessToken: string): Promise<DiscordUser> {
    const resp = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) throw new Error(`Failed to fetch user: ${resp.status}`);
    return resp.json() as Promise<DiscordUser>;
}

export async function getGuildMember(userId: string, guildId: string): Promise<DiscordGuildMember | null> {
    const resp = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
        headers: { Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}` },
    });

    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`Failed to fetch guild member: ${resp.status}`);
    return resp.json() as Promise<DiscordGuildMember>;
}

export async function getGuildTextChannels(guildId: string): Promise<DiscordChannel[]> {
    const resp = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
        headers: { Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}` },
    });

    if (!resp.ok) throw new Error(`Failed to fetch channels: ${resp.status}`);

    const channels = await resp.json() as DiscordChannel[];
    return channels
        .filter(c => c.type === 0)
        .sort((a, b) => a.position - b.position);
}

export async function getGuildRoles(guildId: string): Promise<DiscordRole[]> {
    const resp = await fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
        headers: { Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}` },
    });

    if (!resp.ok) throw new Error(`Failed to fetch roles: ${resp.status}`);

    const roles = await resp.json() as DiscordRole[];
    return roles
        .filter((role) => role.name !== '@everyone')
        .sort((a, b) => b.position - a.position);
}

export async function searchGuildMembers(guildId: string, query: string, limit = 8): Promise<DiscordMentionUser[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
        return [];
    }

    const safeLimit = Number.isFinite(limit)
        ? Math.max(1, Math.min(20, Math.floor(limit)))
        : 8;

    const params = new URLSearchParams({
        query: trimmedQuery,
        limit: String(safeLimit),
    });

    const resp = await fetch(`${DISCORD_API}/guilds/${guildId}/members/search?${params.toString()}`, {
        headers: { Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}` },
    });

    if (!resp.ok) throw new Error(`Failed to search members: ${resp.status}`);

    const members = await resp.json() as DiscordGuildMember[];
    return members
        .filter((member) => member.user?.id && !member.user?.bot)
        .map((member) => ({
            id: member.user?.id ?? '',
            username: member.user?.username ?? 'unknown',
            globalName: member.user?.global_name ?? null,
            nick: member.nick,
        }));
}

export async function getGuildEmojis(guildId: string): Promise<DiscordEmoji[]> {
    const resp = await fetch(`${DISCORD_API}/guilds/${guildId}/emojis`, {
        headers: { Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}` },
    });

    if (!resp.ok) throw new Error(`Failed to fetch emojis: ${resp.status}`);

    const emojis = await resp.json() as DiscordEmoji[];
    return emojis
        .filter((emoji) => !!emoji.name)
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

export async function sendMessageToChannel(channelId: string, payload: DiscordMessagePayload): Promise<string> {
    const resp = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`Failed to send message: ${resp.status} — ${JSON.stringify(err)}`);
    }

    const msg = await resp.json() as { id: string };
    return msg.id;
}

export async function deleteChannelMessage(channelId: string, messageId: string): Promise<void> {
    const resp = await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
        method: 'DELETE',
        headers: {
            Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}`,
        },
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`Failed to delete message: ${resp.status} — ${JSON.stringify(err)}`);
    }
}

export async function sendEmbedToChannel(channelId: string, embedJson: object): Promise<string> {
    return sendMessageToChannel(channelId, { embeds: [embedJson] });
}

export function hasRequiredRole(member: DiscordGuildMember): boolean {
    const adminId  = requireEnv('ADMIN_ROLE_ID');
    const modId    = requireEnv('MODERATOR_ROLE_ID');
    return member.roles.includes(adminId) || member.roles.includes(modId);
}

const ALLOWED_IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif']);
const IMG_MIME: Record<string, string> = {
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
};

function imgDir(): string {
    // src/dashboard/ → src/ → project root → img/
    return join(__dirname, '..', '..', 'img');
}

export function listImages(): string[] {
    return readdirSync(imgDir())
        .filter(f => ALLOWED_IMG_EXTS.has(extname(f).toLowerCase()))
        .sort();
}

export async function sendImageToChannel(channelId: string, filename: string): Promise<string> {
    // Prevent path traversal — validate against the actual directory listing
    const available = listImages();
    if (!available.includes(filename)) {
        throw new Error('Invalid filename');
    }

    const ext = extname(filename).toLowerCase();
    const fileBuffer = await readFile(join(imgDir(), filename));
    const blob = new Blob([fileBuffer], { type: IMG_MIME[ext] ?? 'application/octet-stream' });

    const form = new FormData();
    form.append('files[0]', blob, filename);
    form.append('payload_json', JSON.stringify({ content: '' }));

    const resp = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}` },
        body: form,
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`Failed to send image: ${resp.status} — ${JSON.stringify(err)}`);
    }

    const msg = await resp.json() as { id: string };
    return msg.id;
}

