import {
    createExternalGuildScheduledEvent,
    hasBotManageEventsPermission,
} from './discord-api.js';
import type { EmbedFormData } from './embed-handlers.js';
import { parseWarsawDateTimeToTimestamp } from './scheduler/warsaw-time.js';

export type EventPublishStatus = 'not_requested' | 'created' | 'failed';

export interface EventPublishResult {
    status: EventPublishStatus;
    eventId?: string;
    eventError?: string;
    warnings: string[];
}

function normalizeTrimmedString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function fallbackEventTitle(payload: EmbedFormData): string {
    const payloadTitle = normalizeTrimmedString(payload.title);
    if (payloadTitle) {
        return payloadTitle;
    }

    if (payload.matchInfo) {
        const game = normalizeTrimmedString(payload.matchInfo.game);
        const g2TeamName = normalizeTrimmedString(payload.matchInfo.g2TeamName);
        const opponent = normalizeTrimmedString(payload.matchInfo.opponent);
        const fallback = `${game}: ${g2TeamName || 'G2 Esports'} vs ${opponent}`.trim();
        if (fallback) {
            return fallback.slice(0, 100);
        }
    }

    return 'Wydarzenie społeczności HusariaBot';
}

function resolveEventTimestamps(payload: EmbedFormData): { startAtIso: string; endAtIso: string } | null {
    if (!payload.eventDraft?.enabled) {
        return null;
    }

    const startAtLocal = normalizeTrimmedString(payload.eventDraft.startAtLocal);
    const endAtLocal = normalizeTrimmedString(payload.eventDraft.endAtLocal);
    const startAtTimestamp = parseWarsawDateTimeToTimestamp(startAtLocal);
    const endAtTimestamp = parseWarsawDateTimeToTimestamp(endAtLocal);

    if (!startAtTimestamp || !endAtTimestamp || endAtTimestamp <= startAtTimestamp) {
        return null;
    }

    return {
        startAtIso: new Date(startAtTimestamp).toISOString(),
        endAtIso: new Date(endAtTimestamp).toISOString(),
    };
}

export async function tryCreateDiscordEventFromPayload(payload: EmbedFormData): Promise<EventPublishResult> {
    if (!payload.eventDraft?.enabled) {
        return {
            status: 'not_requested',
            warnings: [],
        };
    }

    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        return {
            status: 'failed',
            eventError: 'Brakuje GUILD_ID do utworzenia wydarzenia Discord.',
            warnings: ['Nie udało się utworzyć wydarzenia Discord: Brakuje GUILD_ID.'],
        };
    }

    const timestamps = resolveEventTimestamps(payload);
    if (!timestamps) {
        return {
            status: 'failed',
            eventError: 'Nieprawidłowa data wydarzenia Discord.',
            warnings: ['Nie udało się utworzyć wydarzenia Discord: nieprawidłowa data.'],
        };
    }

    if (Date.parse(timestamps.startAtIso) <= Date.now()) {
        return {
            status: 'failed',
            eventError: 'Data startu wydarzenia Discord musi być w przyszłości.',
            warnings: ['Nie udało się utworzyć wydarzenia Discord: data startu jest w przeszłości.'],
        };
    }

    const title = normalizeTrimmedString(payload.eventDraft.title).slice(0, 100) || fallbackEventTitle(payload);
    const description = normalizeTrimmedString(payload.eventDraft.description);
    const location = normalizeTrimmedString(payload.eventDraft.location) || 'Online';

    try {
        const canManageEvents = await hasBotManageEventsPermission(guildId);
        if (!canManageEvents) {
            const warningMessage = 'Nie udało się utworzyć wydarzenia Discord: bot nie ma uprawnienia Manage Events.';
            return {
                status: 'failed',
                eventError: 'Bot nie ma uprawnienia Manage Events.',
                warnings: [warningMessage],
            };
        }

        const eventId = await createExternalGuildScheduledEvent(guildId, {
            name: title,
            description,
            scheduledStartTimeIso: timestamps.startAtIso,
            scheduledEndTimeIso: timestamps.endAtIso,
            location,
        });

        return {
            status: 'created',
            eventId,
            warnings: [],
        };
    } catch (error) {
        console.error('Failed to create Discord event from payload:', error);
        const eventError = 'Błąd usługi Discord podczas tworzenia wydarzenia.';

        return {
            status: 'failed',
            eventError,
            warnings: ['Nie udało się utworzyć wydarzenia Discord: błąd usługi zewnętrznej.'],
        };
    }
}
