import type { EmbedFormData } from '../embed-handlers.js';

export type ScheduledPostStatus = 'pending' | 'sent' | 'failed' | 'skipped';

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
}

export interface ScheduledPostStoreData {
    posts: ScheduledPost[];
}
