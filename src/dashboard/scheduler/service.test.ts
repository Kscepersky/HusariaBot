import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbedFormData } from '../embed-handlers.js';
import type { ScheduledPost } from './types.js';

const postStore = new Map<string, ScheduledPost>();

function clonePayload(payload: EmbedFormData): EmbedFormData {
    return {
        ...payload,
        ...(payload.matchInfo ? { matchInfo: { ...payload.matchInfo } } : {}),
        ...(payload.eventDraft ? { eventDraft: { ...payload.eventDraft } } : {}),
        ...(payload.watchpartyDraft ? { watchpartyDraft: { ...payload.watchpartyDraft } } : {}),
    };
}

function clonePost(post: ScheduledPost): ScheduledPost {
    return {
        ...post,
        payload: clonePayload(post.payload),
    };
}

vi.mock('../publish-flow.js', () => ({
    publishDashboardPost: vi.fn(),
}));

vi.mock('../event-publisher.js', () => ({
    tryCreateDiscordEventFromPayload: vi.fn(),
}));

vi.mock('../watchparty-publisher.js', () => ({
    tryCreateWatchpartyChannelFromPayload: vi.fn(),
    deleteWatchpartyChannel: vi.fn(),
}));

vi.mock('../watchparty-lifecycle.js', () => ({
    registerWatchpartyLifecycle: vi.fn(),
}));

vi.mock('./store.js', () => ({
    listScheduledPosts: vi.fn(async () => Array.from(postStore.values()).map((post) => clonePost(post))),
    getScheduledPostById: vi.fn(async (id: string) => {
        const post = postStore.get(id);
        return post ? clonePost(post) : null;
    }),
    updateScheduledPost: vi.fn(async (id: string, updater: (post: ScheduledPost) => ScheduledPost) => {
        const existing = postStore.get(id);
        if (!existing) {
            return null;
        }

        const updated = updater(clonePost(existing));
        const cloned = clonePost(updated);
        postStore.set(id, cloned);
        return clonePost(cloned);
    }),
}));

import { publishDashboardPost } from '../publish-flow.js';
import { tryCreateDiscordEventFromPayload } from '../event-publisher.js';
import { registerWatchpartyLifecycle } from '../watchparty-lifecycle.js';
import { deleteWatchpartyChannel, tryCreateWatchpartyChannelFromPayload } from '../watchparty-publisher.js';
import { updateScheduledPost } from './store.js';
import { registerScheduledPost } from './service.js';

function buildPayload(overrides: Partial<EmbedFormData> = {}): EmbedFormData {
    return {
        mode: 'embedded',
        channelId: '123456789012345678',
        title: 'Tytuł',
        content: 'Treść',
        mentionRoleEnabled: false,
        mentionRoleId: '',
        imageMode: 'none',
        imageFilename: '',
        uploadFileName: '',
        uploadMimeType: '',
        uploadBase64: '',
        eventDraft: {
            enabled: true,
            title: 'Test event',
            description: 'Opis',
            location: 'Online',
            startAtLocal: '2099-05-01T20:00',
            endAtLocal: '2099-05-01T22:00',
        },
        ...overrides,
    };
}

function buildPendingPost(overrides: Partial<ScheduledPost> = {}): ScheduledPost {
    return {
        id: 'pending-post-1',
        payload: buildPayload(),
        scheduledFor: Date.now() + 1_000,
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        publisherName: 'Admin',
        publisherUserId: 'user-1',
        ...overrides,
    };
}

describe('dashboard scheduler service', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2099-01-01T00:00:00.000Z'));
        vi.clearAllMocks();
        postStore.clear();
    });

    afterEach(() => {
        postStore.clear();
        vi.useRealTimers();
    });

    it('wysyla pending post i zapisuje status eventu po sukcesie', async () => {
        const post = buildPendingPost({
            id: 'pending-success',
            scheduledFor: Date.now() + 2_000,
        });
        postStore.set(post.id, clonePost(post));

        vi.mocked(publishDashboardPost).mockResolvedValue({
            messageId: 'msg-1',
            pingMessageId: 'ping-1',
            imageMessageId: 'img-1',
            warnings: ['warn-publish'],
        });

        vi.mocked(tryCreateDiscordEventFromPayload).mockResolvedValue({
            status: 'created',
            eventId: 'event-1',
            warnings: ['warn-event'],
        });

        vi.mocked(tryCreateWatchpartyChannelFromPayload).mockResolvedValue({
            status: 'scheduled',
            channelId: 'watchparty-1',
            warnings: ['warn-watchparty'],
        });

        registerScheduledPost(clonePost(post));
        await vi.advanceTimersByTimeAsync(2_000);

        const updated = postStore.get(post.id);
        expect(vi.mocked(publishDashboardPost)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(tryCreateDiscordEventFromPayload)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(tryCreateWatchpartyChannelFromPayload)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(registerWatchpartyLifecycle)).toHaveBeenCalledTimes(1);
        expect(updated?.status).toBe('sent');
        expect(updated?.messageId).toBe('msg-1');
        expect(updated?.eventStatus).toBe('created');
        expect(updated?.discordEventId).toBe('event-1');
        expect(updated?.watchpartyStatus).toBe('scheduled');
        expect(updated?.watchpartyChannelId).toBe('watchparty-1');
        expect(updated?.source).toBe('scheduled');
        expect(updated?.lastError).toContain('warn-publish');
        expect(updated?.lastError).toContain('warn-event');
        expect(updated?.lastError).toContain('warn-watchparty');
    });

    it('oznacza pending post jako failed gdy publikacja rzuca wyjątek', async () => {
        const post = buildPendingPost({
            id: 'pending-failure',
            scheduledFor: Date.now() + 1_000,
        });
        postStore.set(post.id, clonePost(post));

        vi.mocked(publishDashboardPost).mockRejectedValue(new Error('Nieudana publikacja'));

        registerScheduledPost(clonePost(post));
        await vi.advanceTimersByTimeAsync(1_000);

        const updated = postStore.get(post.id);
        expect(vi.mocked(publishDashboardPost)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(tryCreateDiscordEventFromPayload)).not.toHaveBeenCalled();
        expect(vi.mocked(tryCreateWatchpartyChannelFromPayload)).not.toHaveBeenCalled();
        expect(vi.mocked(registerWatchpartyLifecycle)).not.toHaveBeenCalled();
        expect(updated?.status).toBe('failed');
        expect(updated?.lastError).toBe('Nieudana publikacja');
    });

    it('cofa utworzenie kanału watchparty gdy zapis statusu posta się nie powiedzie', async () => {
        const post = buildPendingPost({
            id: 'pending-watchparty-persist-failure',
            scheduledFor: Date.now() + 1_500,
        });
        postStore.set(post.id, clonePost(post));

        vi.mocked(publishDashboardPost).mockResolvedValue({
            messageId: 'msg-persist-failure',
            pingMessageId: undefined,
            imageMessageId: undefined,
            warnings: [],
        });
        vi.mocked(tryCreateDiscordEventFromPayload).mockResolvedValue({
            status: 'not_requested',
            eventId: undefined,
            eventError: undefined,
            warnings: [],
        });
        vi.mocked(tryCreateWatchpartyChannelFromPayload).mockResolvedValue({
            status: 'scheduled',
            channelId: 'watchparty-persist-failure',
            watchpartyError: undefined,
            warnings: [],
        });
        vi.mocked(updateScheduledPost).mockResolvedValueOnce(null);
        vi.mocked(deleteWatchpartyChannel).mockResolvedValue(undefined);

        registerScheduledPost(clonePost(post));
        await vi.advanceTimersByTimeAsync(1_500);

        const updated = postStore.get(post.id);
        expect(vi.mocked(deleteWatchpartyChannel)).toHaveBeenCalledWith('watchparty-persist-failure');
        expect(updated?.status).toBe('failed');
        expect(updated?.watchpartyStatus).toBe('failed');
        expect(updated?.watchpartyLastError).toContain('channelId=watchparty-persist-failure');
    });

    it('zapisuje kontekst bledu gdy rollback kanału watchparty też się nie powiedzie', async () => {
        const post = buildPendingPost({
            id: 'pending-watchparty-rollback-failure',
            scheduledFor: Date.now() + 1_200,
        });
        postStore.set(post.id, clonePost(post));

        vi.mocked(publishDashboardPost).mockResolvedValue({
            messageId: 'msg-rollback-failure',
            pingMessageId: undefined,
            imageMessageId: undefined,
            warnings: [],
        });
        vi.mocked(tryCreateDiscordEventFromPayload).mockResolvedValue({
            status: 'not_requested',
            eventId: undefined,
            eventError: undefined,
            warnings: [],
        });
        vi.mocked(tryCreateWatchpartyChannelFromPayload).mockResolvedValue({
            status: 'scheduled',
            channelId: 'watchparty-rollback-failure-channel',
            watchpartyError: undefined,
            warnings: [],
        });
        vi.mocked(updateScheduledPost).mockRejectedValueOnce(new Error('persist write failed'));
        vi.mocked(deleteWatchpartyChannel).mockRejectedValueOnce(new Error('rollback delete failed'));

        registerScheduledPost(clonePost(post));
        await vi.advanceTimersByTimeAsync(1_200);

        const updated = postStore.get(post.id);
        expect(vi.mocked(deleteWatchpartyChannel)).toHaveBeenCalledWith('watchparty-rollback-failure-channel');
        expect(updated?.status).toBe('failed');
        expect(updated?.watchpartyStatus).toBe('failed');
        expect(updated?.watchpartyLastError).toContain('channelId=watchparty-rollback-failure-channel');
        expect(updated?.lastError).toContain('persist write failed');
        expect(updated?.lastError).toContain('channelId=watchparty-rollback-failure-channel');
    });
});
