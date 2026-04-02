import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { TemporaryVoiceChannelRecord, TemporaryVoiceChannelStoreData } from './types.js';

const STORE_FILE_PATH = join(process.cwd(), 'data', 'temporary-voice-channels.json');
let storeLock = Promise.resolve();

function cloneRecord(record: TemporaryVoiceChannelRecord): TemporaryVoiceChannelRecord {
    return {
        ...record,
    };
}

function cloneStoreData(store: TemporaryVoiceChannelStoreData): TemporaryVoiceChannelStoreData {
    const channels = Object.entries(store.channels).reduce<Record<string, TemporaryVoiceChannelRecord>>((acc, [channelId, record]) => {
        acc[channelId] = cloneRecord(record);
        return acc;
    }, {});

    return {
        channels,
    };
}

function isValidTemporaryVoiceChannelRecord(value: unknown): value is TemporaryVoiceChannelRecord {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<TemporaryVoiceChannelRecord>;

    return Boolean(
        typeof candidate.channelId === 'string'
        && typeof candidate.guildId === 'string'
        && typeof candidate.ownerId === 'string'
        && typeof candidate.createdAt === 'number'
        && Number.isFinite(candidate.createdAt),
    );
}

function toStoreData(content: string): TemporaryVoiceChannelStoreData {
    try {
        const parsed = JSON.parse(content) as Partial<TemporaryVoiceChannelStoreData>;
        const parsedChannels = parsed.channels;

        if (!parsedChannels || typeof parsedChannels !== 'object') {
            return { channels: {} };
        }

        const channels = Object.entries(parsedChannels).reduce<Record<string, TemporaryVoiceChannelRecord>>((acc, [channelId, value]) => {
            if (isValidTemporaryVoiceChannelRecord(value)) {
                acc[channelId] = cloneRecord(value);
            }
            return acc;
        }, {});

        return { channels };
    } catch (error) {
        throw new Error('Nie udalo sie sparsowac temporary-voice-channels.json', { cause: error });
    }
}

async function ensureStoreFile(filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });

    try {
        await readFile(filePath, 'utf8');
    } catch (error: unknown) {
        const errorCode = (error as { code?: string }).code;
        if (errorCode && errorCode !== 'ENOENT') {
            throw error;
        }

        await writeFile(filePath, JSON.stringify({ channels: {} }, null, 2), 'utf8');
    }
}

async function loadStore(filePath: string): Promise<TemporaryVoiceChannelStoreData> {
    await ensureStoreFile(filePath);
    const content = await readFile(filePath, 'utf8');
    return toStoreData(content);
}

async function saveStore(store: TemporaryVoiceChannelStoreData, filePath: string): Promise<void> {
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

export async function listTemporaryVoiceChannelRecords(
    filePath: string = STORE_FILE_PATH,
): Promise<TemporaryVoiceChannelRecord[]> {
    return withStoreLock(async () => {
        const store = await loadStore(filePath);
        return Object.values(store.channels).map((record) => cloneRecord(record));
    });
}

export async function getTemporaryVoiceChannelRecord(
    channelId: string,
    filePath: string = STORE_FILE_PATH,
): Promise<TemporaryVoiceChannelRecord | null> {
    return withStoreLock(async () => {
        const store = await loadStore(filePath);
        const matchedRecord = store.channels[channelId];
        return matchedRecord ? cloneRecord(matchedRecord) : null;
    });
}

export async function findTemporaryVoiceChannelByOwner(
    guildId: string,
    ownerId: string,
    filePath: string = STORE_FILE_PATH,
): Promise<TemporaryVoiceChannelRecord | null> {
    return withStoreLock(async () => {
        const store = await loadStore(filePath);
        const matchedRecord = Object.values(store.channels).find((record) => {
            return record.guildId === guildId && record.ownerId === ownerId;
        });

        return matchedRecord ? cloneRecord(matchedRecord) : null;
    });
}

export async function upsertTemporaryVoiceChannelRecord(
    record: TemporaryVoiceChannelRecord,
    filePath: string = STORE_FILE_PATH,
): Promise<TemporaryVoiceChannelRecord> {
    return withStoreLock(async () => {
        const store = await loadStore(filePath);
        const nextStore = cloneStoreData({
            channels: {
                ...store.channels,
                [record.channelId]: cloneRecord(record),
            },
        });

        await saveStore(nextStore, filePath);
        return cloneRecord(record);
    });
}

export async function deleteTemporaryVoiceChannelRecord(
    channelId: string,
    filePath: string = STORE_FILE_PATH,
): Promise<boolean> {
    return withStoreLock(async () => {
        const store = await loadStore(filePath);

        if (!store.channels[channelId]) {
            return false;
        }

        const nextChannels = Object.entries(store.channels).reduce<Record<string, TemporaryVoiceChannelRecord>>((acc, [key, record]) => {
            if (key !== channelId) {
                acc[key] = cloneRecord(record);
            }
            return acc;
        }, {});

        await saveStore({ channels: nextChannels }, filePath);
        return true;
    });
}
