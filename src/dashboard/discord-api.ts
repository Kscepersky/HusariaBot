import { config } from 'dotenv';
import { readdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';
config();

const DISCORD_API = 'https://discord.com/api/v10';
const MANAGE_EVENTS_PERMISSION = 1n << 33n;
const ADMINISTRATOR_PERMISSION = 1n << 3n;
const VIEW_CHANNEL_PERMISSION = 1n << 10n;
const CONNECT_PERMISSION = 1n << 20n;
const SPEAK_PERMISSION = 1n << 21n;
const SCHEDULED_EVENTS_CACHE_TTL_MS = 15_000;
const SCHEDULED_EVENTS_DEFAULT_RETRY_MS = 1_000;
const SCHEDULED_EVENTS_MAX_CACHE_ENTRIES = 20;

interface DiscordRateLimitPayload {
    message?: string;
    retry_after?: number;
    global?: boolean;
}

interface ScheduledEventsCacheEntry {
    events: DiscordScheduledEvent[];
    fetchedAt: number;
    rateLimitedUntil: number;
    hasSnapshot: boolean;
}

const scheduledEventsCache = new Map<string, ScheduledEventsCacheEntry>();
const scheduledEventsInFlight = new Map<string, Promise<DiscordScheduledEvent[]>>();

class DiscordRequestError extends Error {
    status: number;
    payload: unknown;

    constructor(operation: string, status: number, payload: unknown) {
        super(`Failed to ${operation}: ${status} — ${JSON.stringify(payload)}`);
        this.status = status;
        this.payload = payload;
    }
}

export class DiscordRateLimitedError extends Error {
    retryAfterSeconds: number;

    constructor(retryAfterSeconds: number) {
        super('Discord events endpoint is rate limited.');
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

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
    permissions: string;
}

interface DiscordBotUser {
    id: string;
    username: string;
}

export interface DiscordBotApiProbeResult {
    botId: string;
    username: string;
    inGuild: boolean;
}

export interface CreateExternalScheduledEventInput {
    name: string;
    description?: string;
    scheduledStartTimeIso: string;
    scheduledEndTimeIso?: string;
    location: string;
}

export interface DiscordScheduledEvent {
    id: string;
    guild_id: string;
    name: string;
    description?: string | null;
    status: number;
    scheduled_start_time: string;
    scheduled_end_time?: string | null;
    entity_type: number;
    entity_metadata?: {
        location?: string | null;
    } | null;
}

export interface CreateGuildVoiceChannelInput {
    name: string;
    categoryId?: string;
    initiallyOpen?: boolean;
}

export interface UpdateExternalScheduledEventInput {
    name: string;
    description?: string;
    scheduledStartTimeIso: string;
    scheduledEndTimeIso?: string;
    location: string;
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

export type DiscordMemberRoleUpdateOutcome = 'updated' | 'not_found';

function buildWatchpartyPermissionOverwrite(guildId: string, initiallyOpen: boolean): {
    id: string;
    type: number;
    allow: string;
    deny: string;
} {
    const allow = initiallyOpen
        ? (VIEW_CHANNEL_PERMISSION | CONNECT_PERMISSION | SPEAK_PERMISSION)
        : VIEW_CHANNEL_PERMISSION;
    const deny = initiallyOpen
        ? 0n
        : (CONNECT_PERMISSION | SPEAK_PERMISSION);

    return {
        id: guildId,
        type: 0,
        allow: allow.toString(),
        deny: deny.toString(),
    };
}

function isValidDiscordId(value: string): boolean {
    return /^\d{17,20}$/.test(value);
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

export async function getDiscordUserById(userId: string): Promise<DiscordUser | null> {
    const normalizedUserId = userId.trim();
    if (!isValidDiscordId(normalizedUserId)) {
        return null;
    }

    const resp = await fetch(`${DISCORD_API}/users/${encodeURIComponent(normalizedUserId)}`, {
        headers: { Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}` },
    });

    if (resp.status === 404) {
        return null;
    }

    if (!resp.ok) {
        throw new Error(`Failed to fetch Discord user by id: ${resp.status}`);
    }

    return resp.json() as Promise<DiscordUser>;
}

export async function getGuildMember(userId: string, guildId: string): Promise<DiscordGuildMember | null> {
    const resp = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
        headers: { Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}` },
    });

    if (resp.status === 404) return null;
    if (resp.status === 429) {
        const retryAfterHeader = resp.headers.get('retry-after');
        const retryAfterFromHeader = retryAfterHeader ? Number.parseFloat(retryAfterHeader) : Number.NaN;
        const retryAfterFromBody = await resp.json()
            .then((payload) => {
                if (!payload || typeof payload !== 'object') {
                    return Number.NaN;
                }

                const maybeRetryAfter = (payload as DiscordRateLimitPayload).retry_after;
                if (typeof maybeRetryAfter !== 'number' || !Number.isFinite(maybeRetryAfter)) {
                    return Number.NaN;
                }

                return maybeRetryAfter;
            })
            .catch(() => Number.NaN);

        const retryAfterSeconds = Number.isFinite(retryAfterFromHeader)
            ? retryAfterFromHeader
            : (Number.isFinite(retryAfterFromBody) ? retryAfterFromBody : 1);

        throw new DiscordRateLimitedError(Math.max(1, retryAfterSeconds));
    }
    if (!resp.ok) throw new Error(`Failed to fetch guild member: ${resp.status}`);
    return resp.json() as Promise<DiscordGuildMember>;
}

export async function updateGuildMemberRoles(
    guildId: string,
    userId: string,
    roles: string[],
): Promise<DiscordMemberRoleUpdateOutcome> {
    if (!isValidDiscordId(guildId)) {
        throw new Error('Invalid guild ID format.');
    }

    if (!isValidDiscordId(userId)) {
        throw new Error('Invalid user ID format.');
    }

    const sanitizedRoles = [...new Set(
        roles
            .map((roleId) => roleId.trim())
            .filter((roleId) => isValidDiscordId(roleId)),
    )];

    const resp = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            roles: sanitizedRoles,
        }),
    });

    if (resp.status === 404) {
        return 'not_found';
    }

    if (!resp.ok) {
        const errPayload = await resp.json().catch(() => ({}));
        throw new Error(`Failed to update guild member roles: ${resp.status} — ${JSON.stringify(errPayload)}`);
    }

    return 'updated';
}

export async function addGuildMemberRole(
    guildId: string,
    userId: string,
    roleId: string,
): Promise<DiscordMemberRoleUpdateOutcome> {
    if (!isValidDiscordId(guildId)) {
        throw new Error('Invalid guild ID format.');
    }

    if (!isValidDiscordId(userId)) {
        throw new Error('Invalid user ID format.');
    }

    if (!isValidDiscordId(roleId)) {
        throw new Error('Invalid role ID format.');
    }

    const resp = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
        method: 'PUT',
        headers: { Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}` },
    });

    if (resp.status === 404) {
        return 'not_found';
    }

    if (!resp.ok) {
        const errPayload = await resp.json().catch(() => ({}));
        throw new Error(`Failed to add guild member role: ${resp.status} — ${JSON.stringify(errPayload)}`);
    }

    return 'updated';
}

export async function removeGuildMemberRole(
    guildId: string,
    userId: string,
    roleId: string,
): Promise<DiscordMemberRoleUpdateOutcome> {
    if (!isValidDiscordId(guildId)) {
        throw new Error('Invalid guild ID format.');
    }

    if (!isValidDiscordId(userId)) {
        throw new Error('Invalid user ID format.');
    }

    if (!isValidDiscordId(roleId)) {
        throw new Error('Invalid role ID format.');
    }

    const resp = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}` },
    });

    if (resp.status === 404) {
        return 'not_found';
    }

    if (!resp.ok) {
        const errPayload = await resp.json().catch(() => ({}));
        throw new Error(`Failed to remove guild member role: ${resp.status} — ${JSON.stringify(errPayload)}`);
    }

    return 'updated';
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

async function getGuildRolesRaw(guildId: string): Promise<DiscordRole[]> {
    const resp = await fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
        headers: { Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}` },
    });

    if (!resp.ok) throw new Error(`Failed to fetch roles: ${resp.status}`);
    return resp.json() as Promise<DiscordRole[]>;
}

async function getBotUser(): Promise<DiscordBotUser> {
    const resp = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}` },
    });

    if (!resp.ok) {
        throw new Error(`Failed to fetch bot user: ${resp.status}`);
    }

    return resp.json() as Promise<DiscordBotUser>;
}

export async function probeDiscordBotApi(guildId: string): Promise<DiscordBotApiProbeResult> {
    const botUser = await getBotUser();
    const member = await getGuildMember(botUser.id, guildId);

    return {
        botId: botUser.id,
        username: botUser.username,
        inGuild: Boolean(member),
    };
}

function safeBigInt(value: string | undefined): bigint {
    try {
        return BigInt(value ?? '0');
    } catch {
        return 0n;
    }
}

export async function hasBotManageEventsPermission(guildId: string): Promise<boolean> {
    const [botUser, roles] = await Promise.all([
        getBotUser(),
        getGuildRolesRaw(guildId),
    ]);

    const member = await getGuildMember(botUser.id, guildId);
    if (!member) {
        return false;
    }

    const rolePermissionsMap = new Map<string, bigint>();
    for (const role of roles) {
        rolePermissionsMap.set(role.id, safeBigInt(role.permissions));
    }

    const everyonePermissions = rolePermissionsMap.get(guildId) ?? 0n;
    const accumulatedPermissions = member.roles.reduce((result, roleId) => {
        return result | (rolePermissionsMap.get(roleId) ?? 0n);
    }, everyonePermissions);

    const hasAdministrator = (accumulatedPermissions & ADMINISTRATOR_PERMISSION) === ADMINISTRATOR_PERMISSION;
    if (hasAdministrator) {
        return true;
    }

    return (accumulatedPermissions & MANAGE_EVENTS_PERMISSION) === MANAGE_EVENTS_PERMISSION;
}

export async function createExternalGuildScheduledEvent(
    guildId: string,
    input: CreateExternalScheduledEventInput,
): Promise<string> {
    const eventName = input.name.trim();
    const eventDescription = input.description?.trim() ?? '';
    const eventLocation = input.location.trim();

    if (!eventName) {
        throw new Error('Nazwa wydarzenia Discord jest wymagana.');
    }

    const body = {
        name: eventName,
        ...(eventDescription ? { description: eventDescription } : {}),
        scheduled_start_time: input.scheduledStartTimeIso,
        scheduled_end_time: input.scheduledEndTimeIso,
        privacy_level: 2,
        entity_type: 3,
        channel_id: null,
        entity_metadata: {
            location: eventLocation || 'Online',
        },
    };

    const resp = await fetch(`${DISCORD_API}/guilds/${guildId}/scheduled-events`, {
        method: 'POST',
        headers: {
            Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const errPayload = await resp.json().catch(() => ({}));
        throw new Error(`Failed to create Discord event: ${resp.status} — ${JSON.stringify(errPayload)}`);
    }

    const created = await resp.json() as { id: string };
    return created.id;
}

export async function listGuildScheduledEvents(guildId: string): Promise<DiscordScheduledEvent[]> {
    const now = Date.now();
    cleanupScheduledEventsCache(now);

    const cached = scheduledEventsCache.get(guildId);

    if (cached && now < cached.rateLimitedUntil) {
        if (cached.hasSnapshot) {
            return [...cached.events];
        }

        throw new DiscordRateLimitedError((cached.rateLimitedUntil - now) / 1000);
    }

    if (cached && now - cached.fetchedAt <= SCHEDULED_EVENTS_CACHE_TTL_MS) {
        return [...cached.events];
    }

    const inFlightRequest = scheduledEventsInFlight.get(guildId);
    if (inFlightRequest) {
        return inFlightRequest;
    }

    const requestPromise = (async (): Promise<DiscordScheduledEvent[]> => {
        try {
            const resp = await fetch(`${DISCORD_API}/guilds/${guildId}/scheduled-events?with_user_count=false`, {
                headers: {
                    Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}`,
                },
            });

            if (!resp.ok) {
                const errPayload = await resp.json().catch(() => ({}));
                throw new DiscordRequestError('list Discord events', resp.status, errPayload);
            }

            const events = await resp.json() as DiscordScheduledEvent[];
            const normalizedEvents = Array.isArray(events) ? [...events] : [];

            scheduledEventsCache.set(guildId, {
                events: normalizedEvents,
                fetchedAt: Date.now(),
                rateLimitedUntil: 0,
                hasSnapshot: true,
            });

            return normalizedEvents;
        } catch (error) {
            if (error instanceof DiscordRequestError && error.status === 429) {
                const retryAfterSeconds = extractRetryAfterSeconds(error.payload);
                const retryAfterMs = Math.max(
                    SCHEDULED_EVENTS_DEFAULT_RETRY_MS,
                    Math.ceil(retryAfterSeconds * 1000),
                );
                const fallbackEvents = cached ? [...cached.events] : [];

                scheduledEventsCache.set(guildId, {
                    events: fallbackEvents,
                    fetchedAt: cached?.fetchedAt ?? 0,
                    rateLimitedUntil: Date.now() + retryAfterMs,
                    hasSnapshot: cached?.hasSnapshot ?? false,
                });

                if (cached?.hasSnapshot) {
                    return fallbackEvents;
                }

                throw new DiscordRateLimitedError(retryAfterMs / 1000);
            }

            throw error;
        }
    })().finally(() => {
        scheduledEventsInFlight.delete(guildId);
    });

    scheduledEventsInFlight.set(guildId, requestPromise);
    return requestPromise;
}

function extractRetryAfterSeconds(payload: unknown): number {
    if (!payload || typeof payload !== 'object') {
        return SCHEDULED_EVENTS_DEFAULT_RETRY_MS / 1000;
    }

    const maybeRateLimitPayload = payload as DiscordRateLimitPayload;
    const retryAfter = maybeRateLimitPayload.retry_after;

    if (typeof retryAfter !== 'number' || !Number.isFinite(retryAfter) || retryAfter < 0) {
        return SCHEDULED_EVENTS_DEFAULT_RETRY_MS / 1000;
    }

    return retryAfter;
}

function cleanupScheduledEventsCache(now: number): void {
    for (const [guildId, entry] of scheduledEventsCache.entries()) {
        const isCooldownExpired = now >= entry.rateLimitedUntil;
        const isSnapshotExpired = now - entry.fetchedAt > SCHEDULED_EVENTS_CACHE_TTL_MS * 2;

        if (isCooldownExpired && isSnapshotExpired) {
            scheduledEventsCache.delete(guildId);
        }
    }

    if (scheduledEventsCache.size <= SCHEDULED_EVENTS_MAX_CACHE_ENTRIES) {
        return;
    }

    const entriesByAge = [...scheduledEventsCache.entries()]
        .sort((left, right) => left[1].fetchedAt - right[1].fetchedAt);

    const entriesToDelete = scheduledEventsCache.size - SCHEDULED_EVENTS_MAX_CACHE_ENTRIES;
    for (let index = 0; index < entriesToDelete; index += 1) {
        const oldest = entriesByAge[index];
        if (!oldest) {
            break;
        }

        scheduledEventsCache.delete(oldest[0]);
    }
}

export async function updateGuildScheduledEvent(
    guildId: string,
    eventId: string,
    input: UpdateExternalScheduledEventInput,
): Promise<DiscordScheduledEvent> {
    const eventName = input.name.trim();
    const eventDescription = input.description?.trim() ?? '';
    const eventLocation = input.location.trim();

    if (!eventName) {
        throw new Error('Nazwa wydarzenia Discord jest wymagana.');
    }

    const body = {
        name: eventName,
        ...(eventDescription ? { description: eventDescription } : { description: null }),
        scheduled_start_time: input.scheduledStartTimeIso,
        scheduled_end_time: input.scheduledEndTimeIso,
        privacy_level: 2,
        entity_type: 3,
        channel_id: null,
        entity_metadata: {
            location: eventLocation || 'Online',
        },
    };

    const resp = await fetch(`${DISCORD_API}/guilds/${guildId}/scheduled-events/${eventId}`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const errPayload = await resp.json().catch(() => ({}));
        throw new Error(`Failed to update Discord event: ${resp.status} — ${JSON.stringify(errPayload)}`);
    }

    return await resp.json() as DiscordScheduledEvent;
}

export async function deleteGuildScheduledEvent(guildId: string, eventId: string): Promise<void> {
    const resp = await fetch(`${DISCORD_API}/guilds/${guildId}/scheduled-events/${eventId}`, {
        method: 'DELETE',
        headers: {
            Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}`,
        },
    });

    if (!resp.ok) {
        const errPayload = await resp.json().catch(() => ({}));
        throw new Error(`Failed to delete Discord event: ${resp.status} — ${JSON.stringify(errPayload)}`);
    }
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

export async function sendDirectMessage(userId: string, content: string): Promise<void> {
    if (!isValidDiscordId(userId)) {
        throw new Error('Invalid user ID format.');
    }

    const openDmChannelResponse = await fetch(`${DISCORD_API}/users/@me/channels`, {
        method: 'POST',
        headers: {
            Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ recipient_id: userId }),
    });

    if (!openDmChannelResponse.ok) {
        const errPayload = await openDmChannelResponse.json().catch(() => ({}));
        throw new Error(`Failed to open DM channel: ${openDmChannelResponse.status} — ${JSON.stringify(errPayload)}`);
    }

    const dmChannel = await openDmChannelResponse.json() as { id: string };
    const sendMessageResponse = await fetch(`${DISCORD_API}/channels/${dmChannel.id}/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
    });

    if (!sendMessageResponse.ok) {
        const errPayload = await sendMessageResponse.json().catch(() => ({}));
        throw new Error(`Failed to send DM: ${sendMessageResponse.status} — ${JSON.stringify(errPayload)}`);
    }
}

export async function createGuildVoiceChannel(
    guildId: string,
    input: CreateGuildVoiceChannelInput,
): Promise<string> {
    const channelName = input.name.trim();
    if (!channelName) {
        throw new Error('Nazwa kanału watchparty jest wymagana.');
    }

    const trimmedCategoryId = input.categoryId?.trim() ?? '';
    const body = {
        name: channelName,
        type: 2,
        ...(trimmedCategoryId && isValidDiscordId(trimmedCategoryId) ? { parent_id: trimmedCategoryId } : {}),
        permission_overwrites: [buildWatchpartyPermissionOverwrite(guildId, input.initiallyOpen === true)],
    };

    const resp = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
        method: 'POST',
        headers: {
            Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`Failed to create voice channel: ${resp.status} — ${JSON.stringify(err)}`);
    }

    const created = await resp.json() as { id: string };
    return created.id;
}

export async function updateChannelRolePermissions(
    channelId: string,
    roleId: string,
    options: { open: boolean },
): Promise<void> {
    const overwrite = buildWatchpartyPermissionOverwrite(roleId, options.open);

    const resp = await fetch(`${DISCORD_API}/channels/${channelId}/permissions/${roleId}`, {
        method: 'PUT',
        headers: {
            Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            allow: overwrite.allow,
            deny: overwrite.deny,
            type: overwrite.type,
        }),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`Failed to update channel permissions: ${resp.status} — ${JSON.stringify(err)}`);
    }
}

export async function deleteGuildChannel(channelId: string): Promise<void> {
    const resp = await fetch(`${DISCORD_API}/channels/${channelId}`, {
        method: 'DELETE',
        headers: {
            Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}`,
        },
    });

    if (resp.status === 404) {
        return;
    }

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`Failed to delete channel: ${resp.status} — ${JSON.stringify(err)}`);
    }
}

export async function editChannelMessage(
    channelId: string,
    messageId: string,
    payload: DiscordMessagePayload,
): Promise<void> {
    const resp = await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bot ${requireEnv('DISCORD_TOKEN')}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`Failed to edit message: ${resp.status} — ${JSON.stringify(err)}`);
    }
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

function resolveDashboardSupportRoleIds(): string[] {
    const roleIds = [
        requireEnv('ADMIN_ROLE_ID'),
        requireEnv('MODERATOR_ROLE_ID'),
        process.env.COMMUNITY_MANAGER_ROLE_ID?.trim(),
    ];

    return [...new Set(roleIds.filter((roleId): roleId is string => typeof roleId === 'string' && roleId.length > 0))];
}

function resolveDashboardDevRoleId(): string | null {
    const roleId = process.env.DEV_ROLE_ID?.trim();
    return roleId && roleId.length > 0 ? roleId : null;
}

export function hasSupportRole(member: DiscordGuildMember): boolean {
    const supportRoleIds = resolveDashboardSupportRoleIds();
    return supportRoleIds.some((roleId) => member.roles.includes(roleId));
}

export function hasDevRole(member: DiscordGuildMember): boolean {
    const devRoleId = resolveDashboardDevRoleId();
    return Boolean(devRoleId && member.roles.includes(devRoleId));
}

export function hasRequiredRole(member: DiscordGuildMember): boolean {
    return hasSupportRole(member) || hasDevRole(member);
}

const ALLOWED_IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const IMG_MIME: Record<string, string> = {
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.svg':  'image/svg+xml',
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

