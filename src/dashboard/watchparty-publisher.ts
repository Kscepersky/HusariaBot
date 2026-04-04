import {
    createGuildVoiceChannel,
    deleteGuildChannel,
    updateChannelRolePermissions,
} from './discord-api.js';
import type { EmbedFormData } from './embed-handlers.js';
import { parseWarsawDateTimeToTimestamp } from './scheduler/warsaw-time.js';
import type { ScheduledPostWatchpartyStatus } from './scheduler/types.js';

export type WatchpartyPublishStatus = Exclude<ScheduledPostWatchpartyStatus, 'pending' | 'deleted'>;

export interface WatchpartyPublishResult {
    status: WatchpartyPublishStatus;
    channelId?: string;
    watchpartyError?: string;
    warnings: string[];
}

export interface WatchpartyWindow {
    startAtTimestamp: number;
    endAtTimestamp: number;
}

function normalizeTrimmedString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeChannelName(input: string): string {
    return input
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
}

export function resolveWatchpartyWindow(payload: EmbedFormData): WatchpartyWindow | null {
    if (!payload.watchpartyDraft?.enabled) {
        return null;
    }

    const startAtLocal = normalizeTrimmedString(payload.watchpartyDraft.startAtLocal);
    const endAtLocal = normalizeTrimmedString(payload.watchpartyDraft.endAtLocal);
    const startAtTimestamp = parseWarsawDateTimeToTimestamp(startAtLocal);
    const endAtTimestamp = parseWarsawDateTimeToTimestamp(endAtLocal);

    if (!startAtTimestamp || !endAtTimestamp || endAtTimestamp <= startAtTimestamp) {
        return null;
    }

    return {
        startAtTimestamp,
        endAtTimestamp,
    };
}

export async function tryCreateWatchpartyChannelFromPayload(payload: EmbedFormData): Promise<WatchpartyPublishResult> {
    if (!payload.watchpartyDraft?.enabled) {
        return {
            status: 'not_requested',
            warnings: [],
        };
    }

    const guildId = normalizeTrimmedString(process.env.GUILD_ID);
    if (!guildId) {
        return {
            status: 'failed',
            watchpartyError: 'Brakuje GUILD_ID do utworzenia kanału watchparty.',
            warnings: ['Nie udało się utworzyć kanału watchparty: Brakuje GUILD_ID.'],
        };
    }

    const watchpartyWindow = resolveWatchpartyWindow(payload);
    if (!watchpartyWindow) {
        return {
            status: 'failed',
            watchpartyError: 'Nieprawidłowy przedział czasu watchparty.',
            warnings: ['Nie udało się utworzyć kanału watchparty: nieprawidłowa data.'],
        };
    }

    if (watchpartyWindow.endAtTimestamp <= Date.now()) {
        return {
            status: 'failed',
            watchpartyError: 'Okno watchparty jest już zakończone.',
            warnings: ['Nie udało się utworzyć kanału watchparty: okno czasu już minęło.'],
        };
    }

    const channelName = normalizeChannelName(normalizeTrimmedString(payload.watchpartyDraft.channelName));
    if (!channelName) {
        return {
            status: 'failed',
            watchpartyError: 'Nazwa kanału watchparty jest wymagana.',
            warnings: ['Nie udało się utworzyć kanału watchparty: brak nazwy kanału.'],
        };
    }

    const shouldOpenImmediately = Date.now() >= watchpartyWindow.startAtTimestamp;
    const categoryId = normalizeTrimmedString(process.env.WATCHPARTY_CATEGORY_ID);

    try {
        const channelId = await createGuildVoiceChannel(guildId, {
            name: channelName,
            categoryId: categoryId || undefined,
            initiallyOpen: shouldOpenImmediately,
        });

        return {
            status: shouldOpenImmediately ? 'open' : 'scheduled',
            channelId,
            warnings: [],
        };
    } catch (error) {
        console.error('Failed to create watchparty channel:', error);
        return {
            status: 'failed',
            watchpartyError: 'Błąd usługi Discord podczas tworzenia kanału watchparty.',
            warnings: ['Nie udało się utworzyć kanału watchparty: błąd usługi zewnętrznej.'],
        };
    }
}

export async function openWatchpartyChannel(channelId: string, guildId: string): Promise<void> {
    await updateChannelRolePermissions(channelId, guildId, { open: true });
}

export async function closeWatchpartyChannel(channelId: string, guildId: string): Promise<void> {
    await updateChannelRolePermissions(channelId, guildId, { open: false });
}

export async function deleteWatchpartyChannel(channelId: string): Promise<void> {
    await deleteGuildChannel(channelId);
}
