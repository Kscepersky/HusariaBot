import { publishMatchAnnouncement } from './publisher.js';
import {
    getMatchAnnouncementById,
    listMatchAnnouncements,
    updateMatchAnnouncement,
} from './store.js';
import type { MatchAnnouncement } from './types.js';

const timers = new Map<string, NodeJS.Timeout>();
const MAX_TIMEOUT_MS = 2_147_000_000;
const RESTART_SKIP_ERROR = 'Czas publikacji minął podczas restartu dashboardu.';
let schedulerInitialized = false;
let schedulerInitializationPromise: Promise<void> | null = null;

function runDetached(task: Promise<void>, context: string): void {
    task.catch((error) => {
        console.error(`Detached scheduler task failed (${context}):`, error);
    });
}

function clearTimer(announcementId: string): void {
    const timer = timers.get(announcementId);
    if (!timer) {
        return;
    }

    clearTimeout(timer);
    timers.delete(announcementId);
}

async function executeAnnouncement(announcementId: string): Promise<void> {
    clearTimer(announcementId);

    let announcement = null;

    try {
        announcement = await getMatchAnnouncementById(announcementId);
    } catch (error) {
        console.error('Failed to load match announcement before execution:', error);
        return;
    }

    if (!announcement || announcement.status !== 'pending') {
        return;
    }

    try {
        const result = await publishMatchAnnouncement(announcement);

        await updateMatchAnnouncement(announcementId, (existing) => ({
            ...existing,
            status: 'sent',
            eventStatus: result.eventStatus,
            discordEventId: result.discordEventId,
            eventLastError: result.eventError,
            updatedAt: Date.now(),
            sentAt: Date.now(),
            messageId: result.messageId,
            pingMessageId: result.pingMessageId,
            imageMessageId: result.imageMessageId,
            lastError: result.warnings.length > 0 ? result.warnings.join(' | ') : undefined,
        }));
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Nieznany błąd publikacji.';

        try {
            await updateMatchAnnouncement(announcementId, (existing) => ({
                ...existing,
                status: 'failed',
                eventStatus: 'failed',
                eventLastError: message,
                updatedAt: Date.now(),
                lastError: message,
            }));
        } catch (updateError) {
            console.error('Failed to persist failed match announcement execution state:', updateError);
        }
    }
}

async function scheduleOrSkip(announcementId: string): Promise<void> {
    let announcement = null;

    try {
        announcement = await getMatchAnnouncementById(announcementId);
    } catch (error) {
        console.error('Failed to load match announcement for scheduling:', error);
        return;
    }

    if (!announcement || announcement.status !== 'pending') {
        clearTimer(announcementId);
        return;
    }

    schedulePendingAnnouncement(announcement);
}

function schedulePendingAnnouncement(announcement: MatchAnnouncement): void {
    clearTimer(announcement.id);

    const delay = announcement.scheduledFor - Date.now();
    if (delay <= 0) {
        runDetached(
            updateMatchAnnouncement(announcement.id, (existing) => ({
                ...existing,
                status: 'skipped',
                eventStatus: 'failed',
                eventLastError: RESTART_SKIP_ERROR,
                updatedAt: Date.now(),
                lastError: RESTART_SKIP_ERROR,
            })).then(() => undefined),
            `mark-skipped:${announcement.id}`,
        );
        return;
    }

    if (delay > MAX_TIMEOUT_MS) {
        const timer = setTimeout(() => {
            runDetached(scheduleOrSkip(announcement.id), `long-delay-reschedule:${announcement.id}`);
        }, MAX_TIMEOUT_MS);

        timers.set(announcement.id, timer);
        return;
    }

    const timer = setTimeout(() => {
        runDetached(executeAnnouncement(announcement.id), `execute:${announcement.id}`);
    }, delay);

    timers.set(announcement.id, timer);
}

export async function initializeMatchAnnouncementScheduler(): Promise<void> {
    if (schedulerInitialized) {
        return;
    }

    if (schedulerInitializationPromise) {
        await schedulerInitializationPromise;
        return;
    }

    schedulerInitializationPromise = (async () => {
        const announcements = await listMatchAnnouncements();
        const now = Date.now();

        await Promise.all(announcements.map(async (announcement) => {
            if (announcement.status !== 'pending') {
                return;
            }

            if (announcement.scheduledFor <= now) {
                await updateMatchAnnouncement(announcement.id, (existing) => ({
                    ...existing,
                    status: 'skipped',
                    eventStatus: 'failed',
                    eventLastError: RESTART_SKIP_ERROR,
                    updatedAt: Date.now(),
                    lastError: RESTART_SKIP_ERROR,
                }));
                return;
            }

            schedulePendingAnnouncement(announcement);
        }));

        schedulerInitialized = true;
    })();

    try {
        await schedulerInitializationPromise;
    } finally {
        schedulerInitializationPromise = null;
    }
}

export function registerMatchAnnouncement(announcement: MatchAnnouncement): void {
    if (announcement.status !== 'pending') {
        clearTimer(announcement.id);
        return;
    }

    schedulePendingAnnouncement(announcement);
}

export function unregisterMatchAnnouncement(announcementId: string): void {
    clearTimer(announcementId);
}
