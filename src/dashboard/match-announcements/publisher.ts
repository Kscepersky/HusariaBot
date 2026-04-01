import {
    createExternalGuildScheduledEvent,
    hasBotManageEventsPermission,
} from '../discord-api.js';
import { publishDashboardPost, type PublishDashboardPostResult } from '../publish-flow.js';
import type { MatchAnnouncement } from './types.js';

const DISCORD_EVENT_LOCATION = 'Online';
const DISCORD_EVENT_DURATION_MS = 2 * 60 * 60 * 1000;

export interface PublishMatchAnnouncementResult extends PublishDashboardPostResult {
    eventStatus: 'created' | 'failed';
    discordEventId?: string;
    eventError?: string;
}

function toIsoTimestamp(timestamp: number): string {
    return new Date(timestamp).toISOString();
}

function normalizeEventName(announcement: MatchAnnouncement): string {
    const normalizedTitle = (announcement.payload.title ?? '').trim();

    if (normalizedTitle) {
        return normalizedTitle.slice(0, 100);
    }

    return `${announcement.match.game}: ${announcement.match.g2TeamName ?? 'G2 Esports'} vs ${announcement.match.opponent}`.slice(0, 100);
}

async function createEventForAnnouncement(announcement: MatchAnnouncement): Promise<{ eventId?: string; eventError?: string }> {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        return { eventError: 'Brakuje GUILD_ID do utworzenia wydarzenia Discord.' };
    }

    const eventStartTimestamp = Date.parse(announcement.match.beginAtUtc);
    if (!Number.isFinite(eventStartTimestamp)) {
        return { eventError: 'Data meczu ma nieprawidłowy format i nie pozwala utworzyć wydarzenia.' };
    }

    if (eventStartTimestamp <= Date.now()) {
        return { eventError: 'Data meczu już minęła. Nie można utworzyć wydarzenia Discord.' };
    }

    try {
        const hasPermission = await hasBotManageEventsPermission(guildId);
        if (!hasPermission) {
            return { eventError: 'Bot nie ma uprawnienia Manage Events.' };
        }

        const eventId = await createExternalGuildScheduledEvent(guildId, {
            name: normalizeEventName(announcement),
            scheduledStartTimeIso: announcement.match.beginAtUtc,
            scheduledEndTimeIso: toIsoTimestamp(eventStartTimestamp + DISCORD_EVENT_DURATION_MS),
            location: DISCORD_EVENT_LOCATION,
        });

        return { eventId };
    } catch (error) {
        return {
            eventError: error instanceof Error
                ? error.message
                : 'Nieznany błąd podczas tworzenia wydarzenia Discord.',
        };
    }
}

export async function publishMatchAnnouncement(
    announcement: MatchAnnouncement,
): Promise<PublishMatchAnnouncementResult> {
    const publishResult = await publishDashboardPost(announcement.payload, {
        publishedBy: announcement.publisherName,
        publishedByUserId: announcement.publisherUserId,
    });

    const { eventId, eventError } = await createEventForAnnouncement(announcement);

    const warnings = eventError
        ? [...publishResult.warnings, `Nie udało się utworzyć wydarzenia Discord: ${eventError}`]
        : publishResult.warnings;

    return {
        ...publishResult,
        warnings,
        eventStatus: eventError ? 'failed' : 'created',
        discordEventId: eventId,
        eventError,
    };
}

export async function retryMatchAnnouncementEvent(announcement: MatchAnnouncement): Promise<{ eventId?: string; eventError?: string }> {
    return createEventForAnnouncement(announcement);
}
