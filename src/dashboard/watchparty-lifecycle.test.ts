import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledPost } from './scheduler/types.js';

const WATCHPARTY_DELETE_GRACE_MS = 60 * 60 * 1000;

const postStore = new Map<string, ScheduledPost>();

function clonePost(post: ScheduledPost): ScheduledPost {
    return {
        ...post,
        payload: {
            ...post.payload,
            ...(post.payload.matchInfo ? { matchInfo: { ...post.payload.matchInfo } } : {}),
            ...(post.payload.eventDraft ? { eventDraft: { ...post.payload.eventDraft } } : {}),
            ...(post.payload.watchpartyDraft ? { watchpartyDraft: { ...post.payload.watchpartyDraft } } : {}),
        },
    };
}

vi.mock('./scheduler/store.js', () => ({
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

vi.mock('./watchparty-publisher.js', () => ({
    openWatchpartyChannel: vi.fn(),
    closeWatchpartyChannel: vi.fn(),
    deleteWatchpartyChannel: vi.fn(),
    resolveWatchpartyWindow: vi.fn(),
}));

import {
    closeWatchpartyChannel,
    deleteWatchpartyChannel,
    openWatchpartyChannel,
    resolveWatchpartyWindow,
} from './watchparty-publisher.js';
import { registerWatchpartyLifecycle } from './watchparty-lifecycle.js';

function buildSentPost(overrides: Partial<ScheduledPost> = {}): ScheduledPost {
    return {
        id: 'post-1',
        payload: {
            mode: 'message',
            channelId: '123456789012345678',
            content: 'Test',
            watchpartyDraft: {
                enabled: true,
                channelName: 'watchparty test',
                startAtLocal: '2099-05-01T20:00',
                endAtLocal: '2099-05-01T22:00',
            },
        },
        scheduledFor: Date.now() - 5_000,
        status: 'sent',
        createdAt: Date.now() - 60_000,
        updatedAt: Date.now() - 10_000,
        sentAt: Date.now() - 10_000,
        publisherName: 'Admin',
        publisherUserId: 'user-1',
        watchpartyStatus: 'failed',
        watchpartyChannelId: 'watchparty-1',
        ...overrides,
    };
}

describe('watchparty lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2099-05-01T21:00:00.000Z'));
        process.env.GUILD_ID = '123456789012345678';
        postStore.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('ponawia cleanup delete dla statusu failed po restarcie, gdy okno juz minelo', async () => {
        vi.mocked(resolveWatchpartyWindow).mockReturnValue({
            startAtTimestamp: Date.now() - 5 * 60 * 60 * 1000,
            endAtTimestamp: Date.now() - 2 * 60 * 60 * 1000,
        });
        vi.mocked(deleteWatchpartyChannel).mockResolvedValue(undefined);

        const post = buildSentPost();
        postStore.set(post.id, clonePost(post));

        registerWatchpartyLifecycle(clonePost(post));
        await vi.advanceTimersByTimeAsync(0);

        expect(vi.mocked(deleteWatchpartyChannel)).toHaveBeenCalledWith('watchparty-1');

        const updated = postStore.get(post.id);
        expect(updated?.watchpartyStatus).toBe('deleted');
        expect(updated?.watchpartyChannelId).toBeUndefined();
    });

    it('ponawia cleanup delete dla statusu failed nawet gdy draft watchparty jest wylaczony', async () => {
        vi.mocked(resolveWatchpartyWindow).mockReturnValue({
            startAtTimestamp: Date.now() - 5 * 60 * 60 * 1000,
            endAtTimestamp: Date.now() - 2 * 60 * 60 * 1000,
        });
        vi.mocked(deleteWatchpartyChannel).mockResolvedValue(undefined);

        const post = buildSentPost({
            id: 'post-disabled-failed',
            payload: {
                mode: 'message',
                channelId: '123456789012345678',
                content: 'Test',
                watchpartyDraft: {
                    enabled: false,
                    channelName: '',
                    startAtLocal: '',
                    endAtLocal: '',
                },
            },
        });
        postStore.set(post.id, clonePost(post));

        registerWatchpartyLifecycle(clonePost(post));
        await vi.advanceTimersByTimeAsync(0);

        expect(vi.mocked(deleteWatchpartyChannel)).toHaveBeenCalledWith('watchparty-1');
        const updated = postStore.get(post.id);
        expect(updated?.watchpartyStatus).toBe('deleted');
        expect(updated?.watchpartyChannelId).toBeUndefined();
    });

    it('otwiera, zamyka i usuwa kanal watchparty dla zaplanowanego okna czasu', async () => {
        const now = Date.now();
        const startAtTimestamp = now + 60_000;
        const endAtTimestamp = now + (2 * 60_000);

        vi.mocked(resolveWatchpartyWindow).mockReturnValue({
            startAtTimestamp,
            endAtTimestamp,
        });
        vi.mocked(openWatchpartyChannel).mockResolvedValue(undefined);
        vi.mocked(closeWatchpartyChannel).mockResolvedValue(undefined);
        vi.mocked(deleteWatchpartyChannel).mockResolvedValue(undefined);

        const post = buildSentPost({
            id: 'post-timed-transitions',
            watchpartyStatus: 'scheduled',
        });
        postStore.set(post.id, clonePost(post));

        registerWatchpartyLifecycle(clonePost(post));

        await vi.advanceTimersByTimeAsync(59_000);
        expect(vi.mocked(openWatchpartyChannel)).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(vi.mocked(openWatchpartyChannel)).toHaveBeenCalledWith(
            'watchparty-1',
            '123456789012345678',
        );
        expect(vi.mocked(openWatchpartyChannel)).toHaveBeenCalledTimes(1);
        expect(postStore.get(post.id)?.watchpartyStatus).toBe('open');

        await vi.advanceTimersByTimeAsync(60_000);
        expect(vi.mocked(closeWatchpartyChannel)).toHaveBeenCalledWith(
            'watchparty-1',
            '123456789012345678',
        );
        expect(vi.mocked(closeWatchpartyChannel)).toHaveBeenCalledTimes(1);
        expect(postStore.get(post.id)?.watchpartyStatus).toBe('closed');

        await vi.advanceTimersByTimeAsync(WATCHPARTY_DELETE_GRACE_MS - 1);
        expect(vi.mocked(deleteWatchpartyChannel)).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(vi.mocked(deleteWatchpartyChannel)).toHaveBeenCalledWith('watchparty-1');
        expect(vi.mocked(deleteWatchpartyChannel)).toHaveBeenCalledTimes(1);
        expect(postStore.get(post.id)?.watchpartyStatus).toBe('deleted');
        expect(postStore.get(post.id)?.watchpartyChannelId).toBeUndefined();
    });

    it('po restarcie po czasie zakonczenia natychmiast zamyka kanal i planuje delete', async () => {
        const now = Date.now();
        const startAtTimestamp = now - (3 * 60 * 60 * 1000);
        const endAtTimestamp = now - 60_000;

        vi.mocked(resolveWatchpartyWindow).mockReturnValue({
            startAtTimestamp,
            endAtTimestamp,
        });
        vi.mocked(closeWatchpartyChannel).mockResolvedValue(undefined);
        vi.mocked(deleteWatchpartyChannel).mockResolvedValue(undefined);

        const post = buildSentPost({
            id: 'post-restart-close-then-delete',
            watchpartyStatus: 'open',
        });
        postStore.set(post.id, clonePost(post));

        registerWatchpartyLifecycle(clonePost(post));
        await vi.advanceTimersByTimeAsync(0);

        expect(vi.mocked(closeWatchpartyChannel)).toHaveBeenCalledWith(
            'watchparty-1',
            '123456789012345678',
        );
        expect(vi.mocked(closeWatchpartyChannel)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(deleteWatchpartyChannel)).not.toHaveBeenCalled();
        expect(postStore.get(post.id)?.watchpartyStatus).toBe('closed');

        await vi.advanceTimersByTimeAsync(WATCHPARTY_DELETE_GRACE_MS - 60_001);
        expect(vi.mocked(deleteWatchpartyChannel)).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(vi.mocked(deleteWatchpartyChannel)).toHaveBeenCalledWith('watchparty-1');
        expect(vi.mocked(deleteWatchpartyChannel)).toHaveBeenCalledTimes(1);
        expect(postStore.get(post.id)?.watchpartyStatus).toBe('deleted');
    });
});
