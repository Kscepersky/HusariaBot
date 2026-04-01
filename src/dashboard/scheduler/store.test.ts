import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    deleteScheduledPostById,
    getScheduledPostById,
    insertScheduledPost,
    listScheduledPosts,
    updateScheduledPost,
} from './store.js';
import type { ScheduledPost } from './types.js';

async function withTempStore(testFn: (filePath: string) => Promise<void>): Promise<void> {
    const directoryPath = await mkdtemp(join(tmpdir(), 'husaria-scheduled-store-'));
    const storeFilePath = join(directoryPath, 'scheduled-posts.json');

    try {
        await testFn(storeFilePath);
    } finally {
        await rm(directoryPath, { recursive: true, force: true });
    }
}

function buildPost(overrides: Partial<ScheduledPost> = {}): ScheduledPost {
    return {
        id: 'scheduled-post-1',
        payload: {
            mode: 'embedded',
            channelId: '123456789012345678',
            title: 'Tytul',
            content: 'Tresc',
            colorName: 'czerwony',
            mentionRoleEnabled: false,
            mentionRoleId: '',
            imageMode: 'none',
            imageFilename: '',
            uploadFileName: '',
            uploadMimeType: '',
            uploadBase64: '',
        },
        scheduledFor: Date.now() + 60_000,
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        publisherName: 'Admin',
        publisherUserId: '123456789012345679',
        ...overrides,
    };
}

describe('scheduled store', () => {
    it('zapisuje i odczytuje posty', async () => {
        await withTempStore(async (filePath) => {
            const post = buildPost();
            await insertScheduledPost(post, filePath);

            const posts = await listScheduledPosts(filePath);
            expect(posts).toHaveLength(1);
            expect(posts[0]?.id).toBe(post.id);
        });
    });

    it('aktualizuje post niemutowalnie', async () => {
        await withTempStore(async (filePath) => {
            const post = buildPost();
            await insertScheduledPost(post, filePath);

            const updated = await updateScheduledPost(post.id, (existingPost) => ({
                ...existingPost,
                status: 'sent',
            }), filePath);

            expect(updated?.status).toBe('sent');

            const fetched = await getScheduledPostById(post.id, filePath);
            expect(fetched?.status).toBe('sent');
        });
    });

    it('usuwa post po identyfikatorze', async () => {
        await withTempStore(async (filePath) => {
            const post = buildPost();
            await insertScheduledPost(post, filePath);

            const deleted = await deleteScheduledPostById(post.id, filePath);
            expect(deleted).toBe(true);

            const fetched = await getScheduledPostById(post.id, filePath);
            expect(fetched).toBeNull();
        });
    });
});
