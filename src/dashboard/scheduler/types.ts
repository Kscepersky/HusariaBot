import type { EmbedFormData } from '../embed-handlers.js';

export type ScheduledPostStatus = 'pending' | 'sent' | 'failed' | 'skipped';
export type ScheduledPostEventStatus = 'not_requested' | 'pending' | 'created' | 'failed';
export type ScheduledPostSource = 'immediate' | 'scheduled';

export interface ScheduledPost {
    id: string;
    payload: EmbedFormData;
    scheduledFor: number;
    status: ScheduledPostStatus;
    createdAt: number;
    updatedAt: number;
    publisherName: string;
    publisherUserId?: string;
    messageId?: string;
    pingMessageId?: string;
    imageMessageId?: string;
    sentAt?: number;
    lastError?: string;
    eventStatus?: ScheduledPostEventStatus;
    discordEventId?: string;
    eventLastError?: string;
    source?: ScheduledPostSource;
    editedAt?: number;
    editedBy?: string;
    editedByUserId?: string;
}

export interface ScheduledPostStoreData {
    posts: ScheduledPost[];
}
