import type { EmbedFormData } from '../embed-handlers.js';

export type MatchAnnouncementStatus = 'pending' | 'sent' | 'failed' | 'skipped';
export type MatchAnnouncementEventStatus = 'pending' | 'created' | 'failed';

export interface MatchSnapshot {
    matchId: string;
    game: string;
    g2TeamName: string;
    opponent: string;
    tournament: string;
    matchType: string;
    beginAtUtc: string;
    date: string;
    time: string;
}

export interface MatchAnnouncement {
    id: string;
    payload: EmbedFormData;
    match: MatchSnapshot;
    scheduledFor: number;
    status: MatchAnnouncementStatus;
    eventStatus: MatchAnnouncementEventStatus;
    discordEventId?: string;
    eventLastError?: string;
    createdAt: number;
    updatedAt: number;
    publisherName: string;
    publisherUserId?: string;
    messageId?: string;
    pingMessageId?: string;
    imageMessageId?: string;
    sentAt?: number;
    lastError?: string;
}

export interface MatchAnnouncementStoreData {
    announcements: MatchAnnouncement[];
}
