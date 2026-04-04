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
        ...(payload.watchpartyDraft ? { watchpartyDraft: { ...payload.watchpartyDraft } } : {}),
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

vi.mock('../watchparty-lifecycle.js', () => ({
    registerWatchpartyLifecycle: vi.fn(),
    unregisterWatchpartyLifecycle: vi.fn(),
}));

vi.mock('../watchparty-publisher.js', () => ({
    tryCreateWatchpartyChannelFromPayload: vi.fn(),
    deleteWatchpartyChannel: vi.fn(),
}));

vi.mock('../discord-api.js', () => ({
    editChannelMessage: vi.fn(),
    deleteChannelMessage: vi.fn(),
    deleteGuildScheduledEvent: vi.fn(),
}));

import { publishDashboardPost } from '../publish-flow.js';
import { tryCreateDiscordEventFromPayload } from '../event-publisher.js';
import { deleteChannelMessage, deleteGuildScheduledEvent, editChannelMessage } from '../discord-api.js';
import { updateScheduledPost } from '../scheduler/store.js';
import { registerWatchpartyLifecycle, unregisterWatchpartyLifecycle } from '../watchparty-lifecycle.js';
import { deleteWatchpartyChannel, tryCreateWatchpartyChannelFromPayload } from '../watchparty-publisher.js';
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

        vi.mocked(editChannelMessage).mockResolvedValue(undefined);
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
            expect(vi.mocked(publishDashboardPost)).not.toHaveBeenCalled();
            expect(vi.mocked(tryCreateDiscordEventFromPayload)).not.toHaveBeenCalled();
            expect(vi.mocked(editChannelMessage)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(registerWatchpartyLifecycle)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(editChannelMessage)).toHaveBeenCalledWith(
                existingPost.payload.channelId,
                'msg-old',
                expect.objectContaining({
                    content: expect.stringContaining('*Edytował*: Admin'),
                    embeds: [],
                }),
            );
            expect(vi.mocked(deleteChannelMessage)).not.toHaveBeenCalled();

            const updated = postStore.get(existingPost.id);
            expect(updated?.messageId).toBe('msg-old');
            expect(updated?.pingMessageId).toBe('ping-old');
            expect(updated?.imageMessageId).toBe('img-old');
            expect(updated?.eventStatus).toBe('created');
            expect(updated?.discordEventId).toBe('event-preserved-123');
            expect(updated?.lastError).toBeUndefined();
            expect(updated?.editedBy).toBe('Admin');
            expect(vi.mocked(deleteGuildScheduledEvent)).not.toHaveBeenCalled();
        });
    });

    it('czyści content i podmienia embed przy zmianie trybu na embedded', async () => {
        const existingPost = buildSentPost({
            id: 'post-switch-to-embedded',
            payload: buildPayload({
                mode: 'message',
                imageMode: 'none',
            }),
            eventStatus: 'created',
            discordEventId: 'event-preserved-321',
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        vi.mocked(editChannelMessage).mockResolvedValue(undefined);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildPayload({
                    mode: 'embedded',
                    title: 'Nowy tytuł embeda',
                    content: 'Nowa treść embeda',
                    imageMode: 'none',
                })),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(vi.mocked(editChannelMessage)).toHaveBeenCalledWith(
                existingPost.payload.channelId,
                'msg-old',
                expect.objectContaining({
                    content: '',
                    embeds: expect.any(Array),
                }),
            );
        });
    });

    it('odrzuca zmiane kanalu przy edycji opublikowanego posta', async () => {
        const existingPost = buildSentPost({
            id: 'post-channel-change',
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildPayload({
                    channelId: '123456789012345679',
                })),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(400);
            expect(body.error).toBe('Nie można zmienić kanału dla opublikowanego posta.');
            expect(vi.mocked(editChannelMessage)).not.toHaveBeenCalled();
        });
    });

    it('odrzuca zmiane ustawien pingu lub grafiki przy edycji opublikowanego posta', async () => {
        const existingPost = buildSentPost({
            id: 'post-side-messages-change',
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildPayload({
                    mentionRoleEnabled: true,
                    mentionRoleId: 'everyone',
                })),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(400);
            expect(body.error).toBe('W edycji opublikowanego posta nie można zmieniać ustawień pingu ani grafiki.');
            expect(vi.mocked(editChannelMessage)).not.toHaveBeenCalled();
        });
    });

    it('zwraca ostrzezenie gdy usuniecie starego kanału watchparty po zapisie się nie powiedzie', async () => {
        const existingPost = buildSentPost({
            id: 'post-watchparty-rollback',
            payload: buildPayload({
                watchpartyDraft: {
                    enabled: true,
                    channelName: 'old watchparty',
                    startAtLocal: '2099-05-01T20:00',
                    endAtLocal: '2099-05-01T22:00',
                },
            }),
            watchpartyStatus: 'scheduled',
            watchpartyChannelId: 'watchparty-old',
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        vi.mocked(editChannelMessage).mockResolvedValue(undefined);
        vi.mocked(tryCreateWatchpartyChannelFromPayload).mockResolvedValue({
            status: 'scheduled',
            channelId: 'watchparty-new',
            warnings: [],
        });
        vi.mocked(deleteWatchpartyChannel).mockRejectedValueOnce(new Error('old delete failed'));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildPayload({
                    content: 'Edycja z nowym watchparty',
                    watchpartyDraft: {
                        enabled: true,
                        channelName: 'new watchparty',
                        startAtLocal: '2099-05-01T21:00',
                        endAtLocal: '2099-05-01T23:00',
                    },
                })),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(vi.mocked(tryCreateWatchpartyChannelFromPayload)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(deleteWatchpartyChannel)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(deleteWatchpartyChannel)).toHaveBeenCalledWith('watchparty-old');
            expect((body.warnings as string[]).some((warning) => warning.includes('Wymagane ręczne sprzątanie'))).toBe(true);

            const updated = postStore.get(existingPost.id);
            expect(updated?.watchpartyChannelId).toBe('watchparty-new');
            expect(updated?.watchpartyStatus).toBe('scheduled');
            expect(updated?.watchpartyLastError).toContain('Nie udało się usunąć poprzedniego kanału watchparty po zapisaniu zmian.');
            expect(updated?.lastError).toContain('Nie udało się usunąć poprzedniego kanału watchparty po zapisaniu zmian.');
        });
    });

    it('rollbackuje nowy kanał watchparty gdy zapis edycji posta się nie powiedzie', async () => {
        const existingPost = buildSentPost({
            id: 'post-watchparty-persist-failure',
            payload: buildPayload({
                watchpartyDraft: {
                    enabled: true,
                    channelName: 'watchparty existing',
                    startAtLocal: '2099-05-01T20:00',
                    endAtLocal: '2099-05-01T22:00',
                },
            }),
            watchpartyStatus: 'scheduled',
            watchpartyChannelId: 'watchparty-existing',
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        vi.mocked(editChannelMessage).mockResolvedValue(undefined);
        vi.mocked(tryCreateWatchpartyChannelFromPayload).mockResolvedValue({
            status: 'scheduled',
            channelId: 'watchparty-created-before-failure',
            warnings: [],
        });
        vi.mocked(deleteWatchpartyChannel).mockResolvedValue(undefined);
        vi.mocked(updateScheduledPost).mockResolvedValueOnce(null);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildPayload({
                    content: 'Edycja, która wywali się na persist',
                    watchpartyDraft: {
                        enabled: true,
                        channelName: 'watchparty new after edit',
                        startAtLocal: '2099-05-01T21:00',
                        endAtLocal: '2099-05-01T23:00',
                    },
                })),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(404);
            expect(body.error).toBe('Nie znaleziono wysłanego posta po zapisie.');
            expect(vi.mocked(deleteWatchpartyChannel)).toHaveBeenCalledWith('watchparty-created-before-failure');
            expect(vi.mocked(deleteWatchpartyChannel)).not.toHaveBeenCalledWith('watchparty-existing');
        });
    });

    it('rollbackuje nowy kanał watchparty gdy zapis edycji posta rzuci wyjątek', async () => {
        const existingPost = buildSentPost({
            id: 'post-watchparty-persist-throw',
            payload: buildPayload({
                watchpartyDraft: {
                    enabled: true,
                    channelName: 'watchparty existing throw',
                    startAtLocal: '2099-05-01T20:00',
                    endAtLocal: '2099-05-01T22:00',
                },
            }),
            watchpartyStatus: 'scheduled',
            watchpartyChannelId: 'watchparty-existing-throw',
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        vi.mocked(editChannelMessage).mockResolvedValue(undefined);
        vi.mocked(tryCreateWatchpartyChannelFromPayload).mockResolvedValue({
            status: 'scheduled',
            channelId: 'watchparty-created-before-throw',
            warnings: [],
        });
        vi.mocked(deleteWatchpartyChannel).mockResolvedValue(undefined);
        vi.mocked(updateScheduledPost).mockRejectedValueOnce(new Error('persist exception'));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildPayload({
                    content: 'Edycja, która rzuci wyjątek persistu',
                    watchpartyDraft: {
                        enabled: true,
                        channelName: 'watchparty throw path',
                        startAtLocal: '2099-05-01T21:00',
                        endAtLocal: '2099-05-01T23:00',
                    },
                })),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(500);
            expect(body.error).toBe('Nie udało się zaktualizować wysłanego posta.');
            expect(vi.mocked(deleteWatchpartyChannel)).toHaveBeenCalledWith('watchparty-created-before-throw');
            expect(vi.mocked(deleteWatchpartyChannel)).not.toHaveBeenCalledWith('watchparty-existing-throw');
        });
    });

    it('zwraca 502 z rollbackChannelId gdy rollback nowego kanału watchparty po błędzie zapisu się nie powiedzie', async () => {
        const existingPost = buildSentPost({
            id: 'post-watchparty-persist-throw-rollback-failure',
            payload: buildPayload({
                watchpartyDraft: {
                    enabled: true,
                    channelName: 'watchparty existing rollback fail',
                    startAtLocal: '2099-05-01T20:00',
                    endAtLocal: '2099-05-01T22:00',
                },
            }),
            watchpartyStatus: 'scheduled',
            watchpartyChannelId: 'watchparty-existing-rollback-fail',
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        vi.mocked(editChannelMessage).mockResolvedValue(undefined);
        vi.mocked(tryCreateWatchpartyChannelFromPayload).mockResolvedValue({
            status: 'scheduled',
            channelId: 'watchparty-created-before-rollback-failure',
            warnings: [],
        });
        vi.mocked(deleteWatchpartyChannel).mockRejectedValueOnce(new Error('rollback cleanup failed'));
        vi.mocked(updateScheduledPost).mockRejectedValueOnce(new Error('persist exception'));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildPayload({
                    content: 'Edycja, która wywali rollback',
                    watchpartyDraft: {
                        enabled: true,
                        channelName: 'watchparty rollback fail',
                        startAtLocal: '2099-05-01T21:00',
                        endAtLocal: '2099-05-01T23:00',
                    },
                })),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(502);
            expect(body.error).toBe('Nie udało się zapisać zmian i wycofać nowego kanału watchparty. Wymagane ręczne sprzątanie kanału.');
            expect(body.rollbackChannelId).toBe('watchparty-created-before-rollback-failure');
            expect(vi.mocked(deleteWatchpartyChannel)).toHaveBeenCalledWith('watchparty-created-before-rollback-failure');
            expect(vi.mocked(deleteWatchpartyChannel)).not.toHaveBeenCalledWith('watchparty-existing-rollback-fail');
        });
    });

    it('utrzymuje 200 gdy dodatkowy zapis ostrzezenia cleanup po sukcesie rzuci wyjątek', async () => {
        const existingPost = buildSentPost({
            id: 'post-watchparty-warning-persist-failure',
            payload: buildPayload({
                watchpartyDraft: {
                    enabled: true,
                    channelName: 'watchparty warning persist',
                    startAtLocal: '2099-05-01T20:00',
                    endAtLocal: '2099-05-01T22:00',
                },
            }),
            watchpartyStatus: 'scheduled',
            watchpartyChannelId: 'watchparty-old-warning-persist',
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        vi.mocked(editChannelMessage).mockResolvedValue(undefined);
        vi.mocked(tryCreateWatchpartyChannelFromPayload).mockResolvedValue({
            status: 'scheduled',
            channelId: 'watchparty-new-warning-persist',
            warnings: [],
        });
        vi.mocked(deleteWatchpartyChannel).mockRejectedValueOnce(new Error('old delete failed after persist'));

        const storeUpdateImpl = vi.mocked(updateScheduledPost).getMockImplementation();
        vi.mocked(updateScheduledPost).mockImplementationOnce(async (id, updater) => {
            if (!storeUpdateImpl) {
                return null;
            }

            return storeUpdateImpl(id, updater);
        });
        vi.mocked(updateScheduledPost).mockRejectedValueOnce(new Error('warning persist failed'));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildPayload({
                    content: 'Edycja z warning persistence failure',
                    watchpartyDraft: {
                        enabled: true,
                        channelName: 'watchparty new warning persist',
                        startAtLocal: '2099-05-01T21:00',
                        endAtLocal: '2099-05-01T23:00',
                    },
                })),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(Array.isArray(body.warnings)).toBe(true);
            expect((body.warnings as string[]).some((warning) => warning.includes('Wymagane ręczne sprzątanie'))).toBe(true);
            expect(vi.mocked(deleteWatchpartyChannel)).toHaveBeenCalledWith('watchparty-old-warning-persist');
        });
    });

    it('odrzuca zmiane danych uploadu grafiki przy edycji opublikowanego posta', async () => {
        const existingPost = buildSentPost({
            id: 'post-upload-change',
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildPayload({
                    uploadFileName: 'nowa-grafika.png',
                    uploadMimeType: 'image/png',
                    uploadBase64: 'ZmFrZS1pbWFnZS1kYXRh',
                })),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(400);
            expect(body.error).toBe('W edycji opublikowanego posta nie można zmieniać ustawień pingu ani grafiki.');
            expect(vi.mocked(editChannelMessage)).not.toHaveBeenCalled();
        });
    });

    it('akceptuje niezmieniony upload grafiki gdy klient wysyla placeholder [stored]', async () => {
        const existingPost = buildSentPost({
            id: 'post-upload-placeholder',
            payload: buildPayload({
                imageMode: 'upload',
                uploadFileName: 'grafika.png',
                uploadMimeType: 'image/png',
                uploadBase64: 'REAL_BASE64_DATA',
            }),
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        vi.mocked(editChannelMessage).mockResolvedValue(undefined);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildPayload({
                    imageMode: 'upload',
                    uploadFileName: 'grafika.png',
                    uploadMimeType: 'image/png',
                    uploadBase64: '[stored]',
                })),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(vi.mocked(editChannelMessage)).toHaveBeenCalledTimes(1);
        });
    });

    it('zwraca 409 gdy wyslany post nie ma messageId do edycji', async () => {
        const existingPost = buildSentPost({
            id: 'post-without-message-id',
            messageId: undefined,
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildPayload()),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(409);
            expect(body.error).toBe('Nie można edytować posta bez identyfikatora wiadomości.');
            expect(vi.mocked(editChannelMessage)).not.toHaveBeenCalled();
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

        vi.mocked(editChannelMessage).mockResolvedValue(undefined);
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

        vi.mocked(editChannelMessage).mockResolvedValue(undefined);
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

    it('usuwa kanał watchparty przy kasowaniu wysłanego posta', async () => {
        const existingPost = buildSentPost({
            id: 'post-delete-watchparty',
            watchpartyStatus: 'scheduled',
            watchpartyChannelId: 'watchparty-123',
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        vi.mocked(deleteWatchpartyChannel).mockResolvedValue(undefined);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}`, {
                method: 'DELETE',
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(vi.mocked(deleteWatchpartyChannel)).toHaveBeenCalledWith('watchparty-123');
            expect(vi.mocked(unregisterWatchpartyLifecycle)).toHaveBeenCalledWith(existingPost.id);
            expect(postStore.has(existingPost.id)).toBe(false);
        });
    });

    it('nie usuwa wysłanego posta gdy cleanup kanału watchparty się nie powiedzie', async () => {
        const existingPost = buildSentPost({
            id: 'post-delete-watchparty-failure',
            watchpartyStatus: 'scheduled',
            watchpartyChannelId: 'watchparty-failed-123',
        });
        postStore.set(existingPost.id, clonePost(existingPost));

        vi.mocked(deleteWatchpartyChannel).mockRejectedValue(new Error('discord failure'));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/scheduled/sent/${existingPost.id}`, {
                method: 'DELETE',
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(502);
            expect(body.error).toBe('Nie udało się usunąć kanału watchparty powiązanego z tym postem. Spróbuj ponownie.');
            expect(postStore.has(existingPost.id)).toBe(true);
            expect(vi.mocked(unregisterWatchpartyLifecycle)).not.toHaveBeenCalledWith(existingPost.id);
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
            expect(vi.mocked(unregisterWatchpartyLifecycle)).toHaveBeenCalledWith(existingPost.id);
            expect(postStore.has(existingPost.id)).toBe(false);
        });
    });
});
