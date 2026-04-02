import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbedFormData } from '../embed-handlers.js';
import type { ScheduledPost } from '../scheduler/types.js';

const postStore = new Map<string, ScheduledPost>();

function clonePayload(payload: EmbedFormData): EmbedFormData {
    return {
        ...payload,
        ...(payload.matchInfo ? { matchInfo: { ...payload.matchInfo } } : {}),
        ...(payload.eventDraft ? { eventDraft: { ...payload.eventDraft } } : {}),
    };
}

function clonePost(post: ScheduledPost): ScheduledPost {
    return {
        ...post,
        payload: clonePayload(post.payload),
    };
}

vi.mock('../middleware/require-auth.js', () => ({
    requireAuth: (req: Request, _res: ExpressResponse, next: NextFunction): void => {
        const reqWithSession = req as unknown as {
            session: {
                user: {
                    id: string;
                    username: string;
                    globalName: string;
                    avatar: string | null;
                };
            };
        };

        reqWithSession.session = {
            user: {
                id: 'user-1',
                username: 'Admin',
                globalName: 'Admin',
                avatar: null,
            },
        };

        next();
    },
}));

vi.mock('../scheduler/store.js', () => ({
    listScheduledPosts: vi.fn(async () => Array.from(postStore.values()).map((post) => clonePost(post))),
    getScheduledPostById: vi.fn(async (id: string) => {
        const post = postStore.get(id);
        return post ? clonePost(post) : null;
    }),
    insertScheduledPost: vi.fn(async (post: ScheduledPost) => {
        const cloned = clonePost(post);
        postStore.set(post.id, cloned);
        return clonePost(cloned);
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
    deleteScheduledPostById: vi.fn(async (id: string) => postStore.delete(id)),
}));

vi.mock('../scheduler/service.js', () => ({
    registerScheduledPost: vi.fn(),
    unregisterScheduledPost: vi.fn(),
}));

vi.mock('../publish-flow.js', () => ({
    publishDashboardPost: vi.fn(),
}));

vi.mock('../event-publisher.js', () => ({
    tryCreateDiscordEventFromPayload: vi.fn(),
}));

vi.mock('../discord-api.js', () => ({
    deleteChannelMessage: vi.fn(),
    deleteGuildScheduledEvent: vi.fn(),
}));

import { publishDashboardPost } from '../publish-flow.js';
import { tryCreateDiscordEventFromPayload } from '../event-publisher.js';
import { deleteChannelMessage, deleteGuildScheduledEvent } from '../discord-api.js';
import { scheduledRouter } from './scheduled.js';

function buildPayload(overrides: Partial<EmbedFormData> = {}): EmbedFormData {
    return {
        mode: 'message',
        channelId: '123456789012345678',
        content: 'Testowa treść',
        mentionRoleEnabled: false,
        mentionRoleId: '',
        imageMode: 'none',
        imageFilename: '',
        uploadFileName: '',
        uploadMimeType: '',
        uploadBase64: '',
        eventDraft: {
            enabled: true,
            title: 'Wydarzenie testowe',
            description: 'Opis wydarzenia',
            location: 'Online',
            startAtLocal: '2099-05-01T20:00',
            endAtLocal: '2099-05-01T22:00',
        },
        ...overrides,
    };
}

function buildSentPost(overrides: Partial<ScheduledPost> = {}): ScheduledPost {
    return {
        id: 'post-1',
        payload: buildPayload(),
        scheduledFor: Date.now() - 5_000,
        status: 'sent',
        createdAt: Date.now() - 60_000,
        updatedAt: Date.now() - 10_000,
        sentAt: Date.now() - 10_000,
        publisherName: 'Admin',
        publisherUserId: 'user-1',
        messageId: 'msg-old',
        pingMessageId: 'ping-old',
        imageMessageId: 'img-old',
        eventStatus: 'created',
        discordEventId: 'event-old',
        source: 'immediate',
        ...overrides,
    };
}

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/scheduled', scheduledRouter);

    const server = await new Promise<Server>((resolve) => {
        const started = app.listen(0, () => {
            resolve(started);
        });
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });

        throw new Error('Nie udało się ustalić adresu serwera testowego.');
    }

    const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;

    try {
        await run(baseUrl);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }
}

async function parseJsonResponse(response: globalThis.Response): Promise<Record<string, unknown>> {
    const text = await response.text();
    if (!text) {
        return {};
    }

    return JSON.parse(text) as Record<string, unknown>;
}

describe('scheduled routes - sent posts', () => {
    beforeEach(() => {
        postStore.clear();
        vi.resetAllMocks();
    });

    afterEach(() => {
        postStore.clear();
    });

    it('aktualizuje wysłany post i zachowuje istniejące wydarzenie gdy draft eventu jest bez zmian', async () => {
        const existingPost = buildSentPost({
            id: 'post-preserve-event',
            eventStatus: 'created',
            discordEventId: 'event-preserved-123',
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        vi.mocked(publishDashboardPost).mockResolvedValue({
            messageId: 'msg-new',
            pingMessageId: 'ping-new',
            imageMessageId: 'img-new',
            warnings: ['publish-warning'],
        });

        vi.mocked(deleteChannelMessage).mockResolvedValue(undefined);
        vi.mocked(tryCreateDiscordEventFromPayload).mockResolvedValue({
            status: 'created',
            eventId: 'event-should-not-be-used',
            warnings: [],
        });

        const requestBody = {
            ...buildPayload({
                content: 'Nowa treść posta',
                eventDraft: {
                    enabled: true,
                    title: 'Wydarzenie testowe',
                    description: 'Opis wydarzenia',
                    location: 'Online',
                    startAtLocal: '2099-05-01T20:00',
                    endAtLocal: '2099-05-01T22:00',
                },
            }),
        };

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.eventStatus).toBe('created');
            expect(vi.mocked(tryCreateDiscordEventFromPayload)).not.toHaveBeenCalled();
            expect(vi.mocked(deleteChannelMessage)).toHaveBeenCalledTimes(3);
            const deletionCalls = vi.mocked(deleteChannelMessage).mock.calls;
            expect(deletionCalls).toEqual(expect.arrayContaining([
                [existingPost.payload.channelId, 'msg-old'],
                [existingPost.payload.channelId, 'ping-old'],
                [existingPost.payload.channelId, 'img-old'],
            ]));

            const updated = postStore.get(existingPost.id);
            expect(updated?.messageId).toBe('msg-new');
            expect(updated?.eventStatus).toBe('created');
            expect(updated?.discordEventId).toBe('event-preserved-123');
            expect(updated?.lastError).toContain('publish-warning');
            expect(updated?.editedBy).toBe('Admin');
            expect(vi.mocked(deleteGuildScheduledEvent)).not.toHaveBeenCalled();
        });
    });

    it('usuwa poprzednie wydarzenie Discord przy wylaczeniu eventu w edycji wyslanego posta', async () => {
        process.env.GUILD_ID = '123456789012345678';

        const existingPost = buildSentPost({
            id: 'post-disable-event',
            eventStatus: 'created',
            discordEventId: 'event-to-remove-1',
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        vi.mocked(publishDashboardPost).mockResolvedValue({
            messageId: 'msg-updated',
            pingMessageId: undefined,
            imageMessageId: undefined,
            warnings: [],
        });
        vi.mocked(deleteChannelMessage).mockResolvedValue(undefined);
        vi.mocked(deleteGuildScheduledEvent).mockResolvedValue(undefined);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildPayload({
                    content: 'Wyłączam event',
                    eventDraft: {
                        enabled: false,
                    },
                })),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.eventStatus).toBe('not_requested');
            expect(vi.mocked(tryCreateDiscordEventFromPayload)).not.toHaveBeenCalled();
            expect(vi.mocked(deleteGuildScheduledEvent)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(deleteGuildScheduledEvent)).toHaveBeenCalledWith('123456789012345678', 'event-to-remove-1');

            const updated = postStore.get(existingPost.id);
            expect(updated?.eventStatus).toBe('not_requested');
            expect(updated?.discordEventId).toBeUndefined();
        });
    });

    it('zachowuje poprzednie wydarzenie gdy usuwanie Discord eventu nie powiedzie sie przy wylaczeniu', async () => {
        process.env.GUILD_ID = '123456789012345678';

        const existingPost = buildSentPost({
            id: 'post-disable-event-failure',
            eventStatus: 'created',
            discordEventId: 'event-to-keep-1',
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        vi.mocked(publishDashboardPost).mockResolvedValue({
            messageId: 'msg-updated-2',
            pingMessageId: undefined,
            imageMessageId: undefined,
            warnings: [],
        });
        vi.mocked(deleteChannelMessage).mockResolvedValue(undefined);
        vi.mocked(deleteGuildScheduledEvent).mockRejectedValue(new Error('delete failed'));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildPayload({
                    content: 'Wyłączam event i delete ma fail',
                    eventDraft: {
                        enabled: false,
                    },
                })),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.eventStatus).toBe('created');
            expect(body.eventError).toBe('Nie udało się usunąć poprzedniego wydarzenia Discord po wyłączeniu opcji eventu.');
            expect(vi.mocked(deleteGuildScheduledEvent)).toHaveBeenCalledTimes(1);

            const updated = postStore.get(existingPost.id);
            expect(updated?.eventStatus).toBe('created');
            expect(updated?.discordEventId).toBe('event-to-keep-1');
            expect(updated?.eventLastError).toBe('Nie udało się usunąć poprzedniego wydarzenia Discord po wyłączeniu opcji eventu.');
            expect(updated?.lastError).toContain('Nie udało się usunąć poprzedniego wydarzenia Discord po wyłączeniu opcji eventu.');
        });
    });

    it('ponawia event dla wyslanego posta z eventStatus=failed', async () => {
        const existingPost = buildSentPost({
            id: 'post-retry-event',
            eventStatus: 'failed',
            discordEventId: undefined,
            eventLastError: 'Brak uprawnień',
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        vi.mocked(tryCreateDiscordEventFromPayload).mockResolvedValue({
            status: 'created',
            eventId: 'event-new-456',
            warnings: [],
        });

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}/retry-event`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(vi.mocked(tryCreateDiscordEventFromPayload)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(tryCreateDiscordEventFromPayload)).toHaveBeenCalledWith(existingPost.payload);
            expect(vi.mocked(publishDashboardPost)).not.toHaveBeenCalled();
            expect(vi.mocked(deleteChannelMessage)).not.toHaveBeenCalled();

            const updated = postStore.get(existingPost.id);
            expect(updated?.eventStatus).toBe('created');
            expect(updated?.discordEventId).toBe('event-new-456');
            expect(updated?.eventLastError).toBeUndefined();
        });
    });

    it('zwraca 409 dla retry-event gdy post nie ma statusu failed', async () => {
        const existingPost = buildSentPost({
            id: 'post-retry-conflict',
            eventStatus: 'created',
            discordEventId: 'event-existing-1',
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}/retry-event`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(409);
            expect(body.error).toBe('To wydarzenie nie wymaga ponowienia.');
            expect(vi.mocked(tryCreateDiscordEventFromPayload)).not.toHaveBeenCalled();
            expect(vi.mocked(publishDashboardPost)).not.toHaveBeenCalled();
            expect(vi.mocked(deleteChannelMessage)).not.toHaveBeenCalled();
        });
    });

    it('usuwa wysłany post z historii', async () => {
        const existingPost = buildSentPost({
            id: 'post-delete-sent',
            eventStatus: 'created',
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}`, {
                method: 'DELETE',
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(postStore.has(existingPost.id)).toBe(false);
        });
    });
});
