import { publishDashboardPost } from '../publish-flow.js';
import {
    getScheduledPostById,
    listScheduledPosts,
    updateScheduledPost,
} from './store.js';
import type { ScheduledPost } from './types.js';

const timers = new Map<string, NodeJS.Timeout>();
const MAX_TIMEOUT_MS = 2_147_000_000;
let schedulerInitialized = false;
let schedulerInitializationPromise: Promise<void> | null = null;

function clearScheduledTimer(postId: string): void {
    const timer = timers.get(postId);
    if (!timer) {
        return;
    }

    clearTimeout(timer);
    timers.delete(postId);
}

async function executeScheduledPost(postId: string): Promise<void> {
    clearScheduledTimer(postId);

    const scheduledPost = await getScheduledPostById(postId);
    if (!scheduledPost || scheduledPost.status !== 'pending') {
        return;
    }

    try {
        const result = await publishDashboardPost(scheduledPost.payload, {
            publishedBy: scheduledPost.publisherName,
            publishedByUserId: scheduledPost.publisherUserId,
        });

        await updateScheduledPost(postId, (post) => ({
            ...post,
            status: 'sent',
            updatedAt: Date.now(),
            sentAt: Date.now(),
            messageId: result.messageId,
            pingMessageId: result.pingMessageId,
            imageMessageId: result.imageMessageId,
            lastError: result.warnings.length > 0 ? result.warnings.join(' | ') : undefined,
        }));
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Nieznany błąd';

        await updateScheduledPost(postId, (post) => ({
            ...post,
            status: 'failed',
            updatedAt: Date.now(),
            lastError: message,
        }));
    }
}

async function schedulePostOrMarkSkipped(postId: string): Promise<void> {
    const scheduledPost = await getScheduledPostById(postId);
    if (!scheduledPost || scheduledPost.status !== 'pending') {
        clearScheduledTimer(postId);
        return;
    }

    schedulePendingPost(scheduledPost);
}

function schedulePendingPost(post: ScheduledPost): void {
    clearScheduledTimer(post.id);

    const delay = post.scheduledFor - Date.now();
    if (delay <= 0) {
        void updateScheduledPost(post.id, (existingPost) => ({
            ...existingPost,
            status: 'skipped',
            updatedAt: Date.now(),
            lastError: 'Czas publikacji minął podczas restartu dashboardu.',
        }));
        return;
    }

    if (delay > MAX_TIMEOUT_MS) {
        const timer = setTimeout(() => {
            void schedulePostOrMarkSkipped(post.id);
        }, MAX_TIMEOUT_MS);

        timers.set(post.id, timer);
        return;
    }

    const timer = setTimeout(() => {
        void executeScheduledPost(post.id);
    }, delay);

    timers.set(post.id, timer);
}

export async function initializeDashboardScheduler(): Promise<void> {
    if (schedulerInitialized) {
        return;
    }

    if (schedulerInitializationPromise) {
        await schedulerInitializationPromise;
        return;
    }

    schedulerInitializationPromise = (async () => {
        const posts = await listScheduledPosts();
        const now = Date.now();

        await Promise.all(posts.map(async (post) => {
            if (post.status !== 'pending') {
                return;
            }

            if (post.scheduledFor <= now) {
                await updateScheduledPost(post.id, (existingPost) => ({
                    ...existingPost,
                    status: 'skipped',
                    updatedAt: Date.now(),
                    lastError: 'Czas publikacji minął podczas restartu dashboardu.',
                }));
                return;
            }

            schedulePendingPost(post);
        }));

        schedulerInitialized = true;
    })();

    try {
        await schedulerInitializationPromise;
    } finally {
        schedulerInitializationPromise = null;
    }
}

export function registerScheduledPost(post: ScheduledPost): void {
    if (post.status !== 'pending') {
        clearScheduledTimer(post.id);
        return;
    }

    schedulePendingPost(post);
}

export function unregisterScheduledPost(postId: string): void {
    clearScheduledTimer(postId);
}
