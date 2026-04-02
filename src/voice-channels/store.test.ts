import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    deleteTemporaryVoiceChannelRecord,
    findTemporaryVoiceChannelByOwner,
    getTemporaryVoiceChannelRecord,
    listTemporaryVoiceChannelRecords,
    upsertTemporaryVoiceChannelRecord,
} from './store.js';
import type { TemporaryVoiceChannelRecord } from './types.js';

async function withTempStore(testFn: (filePath: string) => Promise<void>): Promise<void> {
    const directoryPath = await mkdtemp(join(tmpdir(), 'husaria-temp-voice-store-'));
    const storeFilePath = join(directoryPath, 'temporary-voice-channels.json');

    try {
        await testFn(storeFilePath);
    } finally {
        await rm(directoryPath, { recursive: true, force: true });
    }
}

function buildRecord(overrides: Partial<TemporaryVoiceChannelRecord> = {}): TemporaryVoiceChannelRecord {
    return {
        channelId: 'voice-channel-1',
        guildId: 'guild-1',
        ownerId: 'user-1',
        createdAt: Date.now(),
        ...overrides,
    };
}

describe('temporary voice store', () => {
    it('zapisuje i odczytuje rekord kanału', async () => {
        await withTempStore(async (filePath) => {
            const record = buildRecord();
            await upsertTemporaryVoiceChannelRecord(record, filePath);

            const fetchedRecord = await getTemporaryVoiceChannelRecord(record.channelId, filePath);
            expect(fetchedRecord).toEqual(record);
        });
    });

    it('znajduje rekord po ownerId w guild', async () => {
        await withTempStore(async (filePath) => {
            const record = buildRecord();
            await upsertTemporaryVoiceChannelRecord(record, filePath);

            const byOwner = await findTemporaryVoiceChannelByOwner(record.guildId, record.ownerId, filePath);
            expect(byOwner?.channelId).toBe(record.channelId);
        });
    });

    it('usuwa rekord po channelId', async () => {
        await withTempStore(async (filePath) => {
            const record = buildRecord();
            await upsertTemporaryVoiceChannelRecord(record, filePath);

            const removed = await deleteTemporaryVoiceChannelRecord(record.channelId, filePath);
            const list = await listTemporaryVoiceChannelRecords(filePath);

            expect(removed).toBe(true);
            expect(list).toHaveLength(0);
        });
    });

    it('nie resetuje store przy błędach odczytu innych niz ENOENT', async () => {
        const directoryPath = await mkdtemp(join(tmpdir(), 'husaria-temp-voice-store-dir-'));

        try {
            await expect(listTemporaryVoiceChannelRecords(directoryPath)).rejects.toBeDefined();
        } finally {
            await rm(directoryPath, { recursive: true, force: true });
        }
    });

    it('rzuca błąd dla uszkodzonego JSON zamiast cichego resetu', async () => {
        await withTempStore(async (filePath) => {
            await writeFile(filePath, '{invalid-json', 'utf8');

            await expect(listTemporaryVoiceChannelRecords(filePath)).rejects.toBeDefined();
        });
    });
});
