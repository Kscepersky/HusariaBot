import type { ScheduledPost } from './scheduler/types.js';
import { getScheduledPostById, updateScheduledPost } from './scheduler/store.js';
import {
    closeWatchpartyChannel,
    deleteWatchpartyChannel,
    openWatchpartyChannel,
    resolveWatchpartyWindow,
} from './watchparty-publisher.js';

const MAX_TIMEOUT_MS = 2_147_000_000;
const WATCHPARTY_DELETE_GRACE_MS = 60 * 60 * 1000;
const watchpartyTimers = new Map<string, Set<NodeJS.Timeout>>();

type WatchpartyTransition = 'open' | 'close' | 'delete';

function normalizeTrimmedString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function removeWatchpartyTimer(postId: string, timer: NodeJS.Timeout): void {
    const timers = watchpartyTimers.get(postId);
    if (!timers) {
        return;
    }

    timers.delete(timer);
    if (timers.size === 0) {
        watchpartyTimers.delete(postId);
    }
}

function runScheduledWatchpartyAction(postId: string, action: () => Promise<void>): void {
    void action().catch((error) => {
        console.error('Failed to run scheduled watchparty lifecycle action:', {
            postId,
            error,
        });
    });
}

function scheduleAtTimestamp(postId: string, timestamp: number, action: () => Promise<void>): void {
    const delay = timestamp - Date.now();
    if (delay <= 0) {
        runScheduledWatchpartyAction(postId, action);
        return;
    }

    const chunkDelay = Math.min(delay, MAX_TIMEOUT_MS);
    const timer = setTimeout(() => {
        removeWatchpartyTimer(postId, timer);

        if (chunkDelay < delay) {
            scheduleAtTimestamp(postId, timestamp, action);
            return;
        }

        runScheduledWatchpartyAction(postId, action);
    }, chunkDelay);

    const timers = watchpartyTimers.get(postId) ?? new Set<NodeJS.Timeout>();
    timers.add(timer);
    watchpartyTimers.set(postId, timers);
}

export function unregisterWatchpartyLifecycle(postId: string): void {
    const timers = watchpartyTimers.get(postId);
    if (!timers) {
        return;
    }

    for (const timer of timers) {
        clearTimeout(timer);
    }

    watchpartyTimers.delete(postId);
}

async function markWatchpartyTransitionFailure(postId: string, message: string): Promise<void> {
    await updateScheduledPost(postId, (post) => ({
        ...post,
        updatedAt: Date.now(),
        watchpartyStatus: 'failed',
        watchpartyLastError: message,
        lastError: message,
    }));
}

async function executeWatchpartyTransition(postId: string, transition: WatchpartyTransition): Promise<void> {
    const post = await getScheduledPostById(postId);
    if (!post || post.status !== 'sent') {
        return;
    }

    const channelId = normalizeTrimmedString(post.watchpartyChannelId);
    if (!channelId) {
        return;
    }

    if (transition === 'delete') {
        try {
            await deleteWatchpartyChannel(channelId);
        } catch (error) {
            console.error('Failed to delete watchparty channel during lifecycle:', error);
            await markWatchpartyTransitionFailure(postId, 'Nie udało się usunąć kanału watchparty po zakończeniu okna czasu.');
            return;
        }

        await updateScheduledPost(postId, (existingPost) => ({
            ...existingPost,
            updatedAt: Date.now(),
            watchpartyStatus: 'deleted',
            watchpartyChannelId: undefined,
            watchpartyLastError: undefined,
        }));
        return;
    }

    if (!post.payload.watchpartyDraft?.enabled) {
        return;
    }

    const guildId = normalizeTrimmedString(process.env.GUILD_ID);
    if (!guildId) {
        await markWatchpartyTransitionFailure(postId, 'Brakuje GUILD_ID do zmiany statusu kanału watchparty.');
        return;
    }

    if (transition === 'open') {
        if (post.watchpartyStatus !== 'scheduled') {
            return;
        }

        try {
            await openWatchpartyChannel(channelId, guildId);
        } catch (error) {
            console.error('Failed to open watchparty channel during lifecycle:', error);
            await markWatchpartyTransitionFailure(postId, 'Nie udało się otworzyć kanału watchparty o czasie startu.');
            return;
        }

        await updateScheduledPost(postId, (existingPost) => ({
            ...existingPost,
            updatedAt: Date.now(),
            watchpartyStatus: 'open',
            watchpartyLastError: undefined,
        }));
        return;
    }

    if (post.watchpartyStatus !== 'open' && post.watchpartyStatus !== 'scheduled') {
        return;
    }

    try {
        await closeWatchpartyChannel(channelId, guildId);
    } catch (error) {
        console.error('Failed to close watchparty channel during lifecycle:', error);
        await markWatchpartyTransitionFailure(postId, 'Nie udało się zamknąć kanału watchparty o czasie zakończenia.');
        return;
    }

    await updateScheduledPost(postId, (existingPost) => ({
        ...existingPost,
        updatedAt: Date.now(),
        watchpartyStatus: 'closed',
        watchpartyLastError: undefined,
    }));
}

export function registerWatchpartyLifecycle(post: ScheduledPost): void {
    unregisterWatchpartyLifecycle(post.id);

    if (post.status !== 'sent' || !post.watchpartyChannelId) {
        return;
    }

    if (!post.payload.watchpartyDraft?.enabled) {
        if (post.watchpartyStatus === 'failed') {
            void executeWatchpartyTransition(post.id, 'delete');
        }
        return;
    }

    if (post.watchpartyStatus === 'deleted') {
        return;
    }

    const window = resolveWatchpartyWindow(post.payload);
    if (!window) {
        return;
    }

    const now = Date.now();
    const deleteAtTimestamp = window.endAtTimestamp + WATCHPARTY_DELETE_GRACE_MS;

    if (now >= deleteAtTimestamp) {
        void executeWatchpartyTransition(post.id, 'delete');
        return;
    }

    if (now >= window.endAtTimestamp) {
        if (post.watchpartyStatus === 'open' || post.watchpartyStatus === 'scheduled') {
            void executeWatchpartyTransition(post.id, 'close');
        }

        scheduleAtTimestamp(post.id, deleteAtTimestamp, async () => {
            await executeWatchpartyTransition(post.id, 'delete');
        });
        return;
    }

    if (now >= window.startAtTimestamp) {
        if (post.watchpartyStatus === 'scheduled') {
            void executeWatchpartyTransition(post.id, 'open');
        }

        scheduleAtTimestamp(post.id, window.endAtTimestamp, async () => {
            await executeWatchpartyTransition(post.id, 'close');
        });
        scheduleAtTimestamp(post.id, deleteAtTimestamp, async () => {
            await executeWatchpartyTransition(post.id, 'delete');
        });
        return;
    }

    scheduleAtTimestamp(post.id, window.startAtTimestamp, async () => {
        await executeWatchpartyTransition(post.id, 'open');
    });
    scheduleAtTimestamp(post.id, window.endAtTimestamp, async () => {
        await executeWatchpartyTransition(post.id, 'close');
    });
    scheduleAtTimestamp(post.id, deleteAtTimestamp, async () => {
        await executeWatchpartyTransition(post.id, 'delete');
    });
}
