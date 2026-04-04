import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ScheduledPost, ScheduledPostStatus, ScheduledPostStoreData } from './types.js';

const STORE_FILE_PATH = join(process.cwd(), 'data', 'scheduled-posts.json');
let storeLock = Promise.resolve();

function clonePayload<T extends ScheduledPost['payload']>(payload: T): T {
    return {
        ...payload,
        ...(payload.matchInfo ? { matchInfo: { ...payload.matchInfo } } : {}),
        ...(payload.eventDraft ? { eventDraft: { ...payload.eventDraft } } : {}),
        ...(payload.watchpartyDraft ? { watchpartyDraft: { ...payload.watchpartyDraft } } : {}),
    };
}

function isScheduledPostStatus(value: unknown): value is ScheduledPostStatus {
    return value === 'pending' || value === 'sent' || value === 'failed' || value === 'skipped';
}

function toScheduledPostStoreData(content: string): ScheduledPostStoreData {
    try {
        const parsed = JSON.parse(content) as Partial<ScheduledPostStoreData>;
        if (!parsed || !Array.isArray(parsed.posts)) {
            return { posts: [] };
        }

        const posts = parsed.posts
            .filter((post): post is ScheduledPost => {
                return Boolean(
                    post
                    && typeof post.id === 'string'
                    && typeof post.scheduledFor === 'number'
                    && typeof post.createdAt === 'number'
                    && typeof post.updatedAt === 'number'
                    && typeof post.publisherName === 'string'
                    && typeof post.payload === 'object'
                    && post.payload !== null
                    && isScheduledPostStatus(post.status),
                );
            })
            .map((post) => ({ ...post, payload: clonePayload(post.payload) }));

        return { posts };
    } catch {
        return { posts: [] };
    }
}

async function ensureStoreFile(filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });

    try {
        await readFile(filePath, 'utf8');
    } catch {
        const initialStore: ScheduledPostStoreData = { posts: [] };
        await writeFile(filePath, JSON.stringify(initialStore, null, 2), 'utf8');
    }
}

async function loadStore(filePath: string): Promise<ScheduledPostStoreData> {
    await ensureStoreFile(filePath);
    const content = await readFile(filePath, 'utf8');
    return toScheduledPostStoreData(content);
}

async function saveStore(store: ScheduledPostStoreData, filePath: string): Promise<void> {
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

export async function listScheduledPosts(filePath: string = STORE_FILE_PATH): Promise<ScheduledPost[]> {
    return withStoreLock(async () => {
        const store = await loadStore(filePath);
        return store.posts.map((post) => ({ ...post, payload: clonePayload(post.payload) }));
    });
}

export async function getScheduledPostById(
    id: string,
    filePath: string = STORE_FILE_PATH,
): Promise<ScheduledPost | null> {
    return withStoreLock(async () => {
        const store = await loadStore(filePath);
        const matchedPost = store.posts.find((post) => post.id === id);
        return matchedPost ? { ...matchedPost, payload: clonePayload(matchedPost.payload) } : null;
    });
}

export async function insertScheduledPost(
    post: ScheduledPost,
    filePath: string = STORE_FILE_PATH,
): Promise<ScheduledPost> {
    return withStoreLock(async () => {
        const store = await loadStore(filePath);
        const nextStore: ScheduledPostStoreData = {
            posts: [...store.posts, { ...post, payload: clonePayload(post.payload) }],
        };

        await saveStore(nextStore, filePath);
        return { ...post, payload: clonePayload(post.payload) };
    });
}

export async function updateScheduledPost(
    id: string,
    updater: (post: ScheduledPost) => ScheduledPost,
    filePath: string = STORE_FILE_PATH,
): Promise<ScheduledPost | null> {
    return withStoreLock(async () => {
        const store = await loadStore(filePath);
        const existingPost = store.posts.find((post) => post.id === id);

        if (!existingPost) {
            return null;
        }

        const updatedPost = updater({ ...existingPost, payload: clonePayload(existingPost.payload) });
        const nextPosts = store.posts.map((post) => {
            if (post.id !== id) {
                return post;
            }
            return { ...updatedPost, payload: clonePayload(updatedPost.payload) };
        });

        await saveStore({ posts: nextPosts }, filePath);
        return { ...updatedPost, payload: clonePayload(updatedPost.payload) };
    });
}

export async function deleteScheduledPostById(
    id: string,
    filePath: string = STORE_FILE_PATH,
): Promise<boolean> {
    return withStoreLock(async () => {
        const store = await loadStore(filePath);
        const nextPosts = store.posts.filter((post) => post.id !== id);

        if (nextPosts.length === store.posts.length) {
            return false;
        }

        await saveStore({ posts: nextPosts }, filePath);
        return true;
    });
}
