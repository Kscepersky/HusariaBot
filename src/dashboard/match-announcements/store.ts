import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
    MatchAnnouncement,
    MatchAnnouncementEventStatus,
    MatchAnnouncementStatus,
    MatchAnnouncementStoreData,
} from './types.js';

const STORE_FILE_PATH = join(process.cwd(), 'data', 'match-announcements.json');
let storeLock = Promise.resolve();

function isAnnouncementStatus(value: unknown): value is MatchAnnouncementStatus {
    return value === 'pending' || value === 'sent' || value === 'failed' || value === 'skipped';
}

function isEventStatus(value: unknown): value is MatchAnnouncementEventStatus {
    return value === 'pending' || value === 'created' || value === 'failed';
}

function toStoreData(content: string): MatchAnnouncementStoreData {
    try {
        const parsed = JSON.parse(content) as Partial<MatchAnnouncementStoreData>;
        if (!parsed || !Array.isArray(parsed.announcements)) {
            return { announcements: [] };
        }

        const announcements = parsed.announcements
            .filter((announcement): announcement is MatchAnnouncement => Boolean(
                announcement
                && typeof announcement.id === 'string'
                && typeof announcement.scheduledFor === 'number'
                && typeof announcement.createdAt === 'number'
                && typeof announcement.updatedAt === 'number'
                && typeof announcement.publisherName === 'string'
                && typeof announcement.payload === 'object'
                && announcement.payload !== null
                && typeof announcement.match === 'object'
                && announcement.match !== null
                && isAnnouncementStatus(announcement.status)
                && isEventStatus(announcement.eventStatus),
            ))
            .map((announcement) => ({
                ...announcement,
                payload: { ...announcement.payload },
                match: { ...announcement.match },
            }));

        return { announcements };
    } catch {
        return { announcements: [] };
    }
}

async function ensureStoreFile(filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });

    try {
        await readFile(filePath, 'utf8');
    } catch {
        const initialStore: MatchAnnouncementStoreData = { announcements: [] };
        await writeFile(filePath, JSON.stringify(initialStore, null, 2), 'utf8');
    }
}

async function loadStore(filePath: string): Promise<MatchAnnouncementStoreData> {
    await ensureStoreFile(filePath);
    const content = await readFile(filePath, 'utf8');
    return toStoreData(content);
}

async function saveStore(store: MatchAnnouncementStoreData, filePath: string): Promise<void> {
    await writeFile(filePath, JSON.stringify(store, null, 2), 'utf8');
}

function withStoreLock<T>(work: () => Promise<T>): Promise<T> {
    const workPromise = storeLock.then(work);

    storeLock = workPromise.then(
        () => undefined,
        () => undefined,
    );

    return workPromise;
}

export async function listMatchAnnouncements(filePath: string = STORE_FILE_PATH): Promise<MatchAnnouncement[]> {
    return withStoreLock(async () => {
        const store = await loadStore(filePath);
        return store.announcements.map((announcement) => ({
            ...announcement,
            payload: { ...announcement.payload },
            match: { ...announcement.match },
        }));
    });
}

export async function getMatchAnnouncementById(
    id: string,
    filePath: string = STORE_FILE_PATH,
): Promise<MatchAnnouncement | null> {
    return withStoreLock(async () => {
        const store = await loadStore(filePath);
        const matched = store.announcements.find((announcement) => announcement.id === id);

        return matched
            ? {
                ...matched,
                payload: { ...matched.payload },
                match: { ...matched.match },
            }
            : null;
    });
}

export async function insertMatchAnnouncement(
    announcement: MatchAnnouncement,
    filePath: string = STORE_FILE_PATH,
): Promise<MatchAnnouncement> {
    return withStoreLock(async () => {
        const store = await loadStore(filePath);
        const nextStore: MatchAnnouncementStoreData = {
            announcements: [
                ...store.announcements,
                {
                    ...announcement,
                    payload: { ...announcement.payload },
                    match: { ...announcement.match },
                },
            ],
        };

        await saveStore(nextStore, filePath);
        return {
            ...announcement,
            payload: { ...announcement.payload },
            match: { ...announcement.match },
        };
    });
}

export async function updateMatchAnnouncement(
    id: string,
    updater: (announcement: MatchAnnouncement) => MatchAnnouncement,
    filePath: string = STORE_FILE_PATH,
): Promise<MatchAnnouncement | null> {
    return withStoreLock(async () => {
        const store = await loadStore(filePath);
        const existing = store.announcements.find((announcement) => announcement.id === id);

        if (!existing) {
            return null;
        }

        const updated = updater({
            ...existing,
            payload: { ...existing.payload },
            match: { ...existing.match },
        });

        const nextAnnouncements = store.announcements.map((announcement) => {
            if (announcement.id !== id) {
                return announcement;
            }

            return {
                ...updated,
                payload: { ...updated.payload },
                match: { ...updated.match },
            };
        });

        await saveStore({ announcements: nextAnnouncements }, filePath);

        return {
            ...updated,
            payload: { ...updated.payload },
            match: { ...updated.match },
        };
    });
}

export async function deleteMatchAnnouncementById(
    id: string,
    filePath: string = STORE_FILE_PATH,
): Promise<boolean> {
    return withStoreLock(async () => {
        const store = await loadStore(filePath);
        const nextAnnouncements = store.announcements.filter((announcement) => announcement.id !== id);

        if (nextAnnouncements.length === store.announcements.length) {
            return false;
        }

        await saveStore({ announcements: nextAnnouncements }, filePath);
        return true;
    });
}
