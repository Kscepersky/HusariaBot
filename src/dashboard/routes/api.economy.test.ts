import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EconomyConfig } from '../../economy/types.js';

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

vi.mock('../../economy/repository.js', () => ({
    getEconomyConfig: vi.fn(),
    getEconomyLeaderboardPage: vi.fn(),
    updateEconomyConfig: vi.fn(),
    resetEconomyUsers: vi.fn(),
}));

vi.mock('../discord-api.js', () => ({
    createExternalGuildScheduledEvent: vi.fn(),
    deleteGuildScheduledEvent: vi.fn(),
    getGuildTextChannels: vi.fn(),
    getGuildRoles: vi.fn(),
    getGuildEmojis: vi.fn(),
    getGuildMember: vi.fn(),
    hasRequiredRole: vi.fn(() => true),
    listGuildScheduledEvents: vi.fn(),
    searchGuildMembers: vi.fn(),
    listImages: vi.fn(),
    sendImageToChannel: vi.fn(),
    updateGuildScheduledEvent: vi.fn(),
    DiscordRateLimitedError: class DiscordRateLimitedError extends Error {
        retryAfterSeconds: number;

        constructor(retryAfterSeconds: number) {
            super('rate limited');
            this.retryAfterSeconds = retryAfterSeconds;
        }
    },
}));

vi.mock('../embed-handlers.js', () => ({
    validateEmbedForm: vi.fn(() => null),
}));

vi.mock('../publish-flow.js', () => ({
    publishDashboardPost: vi.fn(),
}));

vi.mock('../event-publisher.js', () => ({
    tryCreateDiscordEventFromPayload: vi.fn(),
}));

vi.mock('../watchparty-lifecycle.js', () => ({
    registerWatchpartyLifecycle: vi.fn(),
}));

vi.mock('../watchparty-publisher.js', () => ({
    tryCreateWatchpartyChannelFromPayload: vi.fn(),
    deleteWatchpartyChannel: vi.fn(),
}));

vi.mock('../scheduler/store.js', () => ({
    insertScheduledPost: vi.fn(),
    updateScheduledPost: vi.fn(),
}));

import {
    getEconomyConfig,
    getEconomyLeaderboardPage,
    resetEconomyUsers,
    updateEconomyConfig,
} from '../../economy/repository.js';
import { getGuildMember, hasRequiredRole } from '../discord-api.js';
import { tryCreateDiscordEventFromPayload } from '../event-publisher.js';
import { publishDashboardPost } from '../publish-flow.js';
import { insertScheduledPost, updateScheduledPost } from '../scheduler/store.js';
import { deleteWatchpartyChannel, tryCreateWatchpartyChannelFromPayload } from '../watchparty-publisher.js';
import { apiRouter } from './api.js';

function buildConfig(overrides: Partial<EconomyConfig> = {}): EconomyConfig {
    return {
        dailyMinCoins: 100,
        dailyMaxCoins: 500,
        dailyStreakIncrement: 0.05,
        dailyStreakMaxDays: 30,
        dailyStreakGraceHours: 48,
        dailyMessages: ['{user} odbiera dzienne cebuliony i zgarnia {coins} monet!'],
        levelingMode: 'progressive',
        levelingBaseXp: 100,
        levelingExponent: 1.5,
        xpTextPerMessage: 1,
        xpTextCooldownSeconds: 5,
        xpVoicePerMinute: 5,
        xpVoiceRequireTwoUsers: true,
        xpVoiceAllowSelfMute: true,
        xpVoiceAllowSelfDeaf: false,
        xpVoiceAllowAfk: false,
        watchpartyXpMultiplier: 1,
        watchpartyCoinBonusPerMinute: 0,
        levelUpCoinsBase: 25,
        levelUpCoinsPerLevel: 10,
        ...overrides,
    };
}

function buildEmbedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        mode: 'message',
        channelId: '123456789012345678',
        content: 'test payload',
        watchpartyDraft: {
            enabled: true,
            channelName: 'G2 vs FNC | watchparty',
            startAtLocal: '2099-05-01T20:00',
            endAtLocal: '2099-05-01T22:00',
        },
        ...overrides,
    };
}

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api', apiRouter);

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

        throw new Error('Nie udało się uruchomić serwera testowego.');
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

describe('api economy settings routes', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        process.env.GUILD_ID = '123456789012345678';
        vi.mocked(getGuildMember).mockResolvedValue({ roles: ['admin-role'] } as any);
        vi.mocked(hasRequiredRole).mockReturnValue(true);
    });

    it('zwraca ustawienia ekonomii', async () => {
        const config = buildConfig();
        vi.mocked(getEconomyConfig).mockResolvedValue(config);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/settings`);
            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.config).toEqual(config);
            expect(vi.mocked(getEconomyConfig)).toHaveBeenCalledTimes(1);
        });
    });

    it('aktualizuje ustawienia ekonomii dla poprawnego payloadu', async () => {
        const payload = buildConfig({
            dailyMinCoins: 120,
            dailyMaxCoins: 650,
            dailyMessages: ['line 1', 'line 2'],
            levelingMode: 'linear',
            xpVoiceAllowSelfDeaf: true,
        });

        vi.mocked(updateEconomyConfig).mockResolvedValue(payload);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/settings`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.config).toEqual(payload);
            expect(vi.mocked(updateEconomyConfig)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(updateEconomyConfig)).toHaveBeenCalledWith(payload, expect.any(Number));
        });
    });

    it('zwraca 500 przy bledzie pobierania ustawien ekonomii', async () => {
        vi.mocked(getEconomyConfig).mockRejectedValue(new Error('db failed'));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/settings`);
            const body = await parseJsonResponse(response);

            expect(response.status).toBe(500);
            expect(body.error).toBe('Nie udało się pobrać ustawień ekonomii.');
        });
    });

    it('zwraca 500 przy bledzie zapisu ustawien ekonomii', async () => {
        const payload = buildConfig();
        vi.mocked(updateEconomyConfig).mockRejectedValue(new Error('db write failed'));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/settings`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(500);
            expect(body.error).toBe('Nie udało się zapisać ustawień ekonomii.');
        });
    });

    it('odrzuca nieprawidlowy payload aktualizacji ekonomii', async () => {
        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/settings`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(400);
            expect(typeof body.error).toBe('string');
            expect(vi.mocked(updateEconomyConfig)).not.toHaveBeenCalled();
        });
    });

    it('zwraca 403 dla aktualizacji ekonomii gdy uzytkownik utracil role', async () => {
        const payload = buildConfig();
        vi.mocked(getGuildMember).mockResolvedValue({ roles: [] } as any);
        vi.mocked(hasRequiredRole).mockReturnValue(false);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/settings`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(403);
            expect(body.error).toBe('Brak uprawnień do wykonania tej operacji.');
            expect(vi.mocked(updateEconomyConfig)).not.toHaveBeenCalled();
        });
    });

    it('zwraca 502 dla aktualizacji ekonomii gdy weryfikacja roli nie dziala', async () => {
        const payload = buildConfig();
        vi.mocked(getGuildMember).mockRejectedValue(new Error('discord unavailable'));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/settings`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(502);
            expect(body.error).toBe('Nie udało się zweryfikować uprawnień użytkownika.');
            expect(vi.mocked(updateEconomyConfig)).not.toHaveBeenCalled();
        });
    });

    it('resetuje ekonomie uzytkownikow dla aktualnego guild', async () => {
        vi.mocked(resetEconomyUsers).mockResolvedValue(7);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/reset-users`, {
                method: 'POST',
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.resetCount).toBe(7);
            expect(vi.mocked(resetEconomyUsers)).toHaveBeenCalledWith('123456789012345678');
        });
    });

    it('zwraca 500 przy bledzie resetu ekonomii', async () => {
        vi.mocked(resetEconomyUsers).mockRejectedValue(new Error('db delete failed'));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/reset-users`, {
                method: 'POST',
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(500);
            expect(body.error).toBe('Nie udało się zresetować danych ekonomii.');
        });
    });

    it('zwraca blad 500 przy braku GUILD_ID dla resetu ekonomii', async () => {
        delete process.env.GUILD_ID;

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/reset-users`, {
                method: 'POST',
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(500);
            expect(body.error).toBe('Brakuje GUILD_ID.');
            expect(vi.mocked(resetEconomyUsers)).not.toHaveBeenCalled();
        });
    });

    it('zwraca 403 gdy uzytkownik utracil role dashboardu', async () => {
        vi.mocked(getGuildMember).mockResolvedValue({ roles: [] } as any);
        vi.mocked(hasRequiredRole).mockReturnValue(false);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/reset-users`, {
                method: 'POST',
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(403);
            expect(body.error).toBe('Brak uprawnień do wykonania tej operacji.');
            expect(vi.mocked(resetEconomyUsers)).not.toHaveBeenCalled();
        });
    });

    it('zwraca leaderboard ekonomii z domyslnym sortowaniem i stronicowaniem', async () => {
        const leaderboardPayload = {
            sortBy: 'xp',
            page: 1,
            pageSize: 10,
            totalRows: 2,
            totalPages: 1,
            entries: [
                { rank: 1, userId: 'u1', xp: 300, level: 3, coins: 100 },
                { rank: 2, userId: 'u2', xp: 120, level: 1, coins: 200 },
            ],
        };

        vi.mocked(getGuildMember).mockImplementation(async (userId: string) => {
            if (userId === 'user-1') {
                return {
                    roles: ['admin-role'],
                    nick: null,
                    user: {
                        id: 'user-1',
                        username: 'Admin',
                        global_name: 'Admin',
                        avatar: null,
                        discriminator: '0',
                    },
                } as any;
            }

            if (userId === 'u1') {
                return {
                    roles: [],
                    nick: 'Rotmistrz',
                    user: {
                        id: 'u1',
                        username: 'husaria-u1',
                        global_name: 'Husaria U1',
                        avatar: 'avatarhash1',
                        discriminator: '0',
                    },
                } as any;
            }

            if (userId === 'u2') {
                return {
                    roles: [],
                    nick: null,
                    user: {
                        id: 'u2',
                        username: 'husaria-u2',
                        global_name: null,
                        avatar: null,
                        discriminator: '0',
                    },
                } as any;
            }

            return {
                roles: [],
                nick: null,
            } as any;
        });

        vi.mocked(getEconomyLeaderboardPage).mockResolvedValue(leaderboardPayload as any);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/leaderboard`);
            const body = await parseJsonResponse(response);

            const expectedLeaderboard = {
                ...leaderboardPayload,
                entries: [
                    {
                        rank: 1,
                        userId: 'u1',
                        xp: 300,
                        level: 3,
                        coins: 100,
                        displayName: 'Rotmistrz',
                        avatarUrl: 'https://cdn.discordapp.com/avatars/u1/avatarhash1.png?size=64',
                    },
                    {
                        rank: 2,
                        userId: 'u2',
                        xp: 120,
                        level: 1,
                        coins: 200,
                        displayName: 'husaria-u2',
                        avatarUrl: null,
                    },
                ],
            };

            expect(response.status).toBe(200);
            expect(body.leaderboard).toEqual(expectedLeaderboard);
            expect(vi.mocked(getEconomyLeaderboardPage)).toHaveBeenCalledWith('123456789012345678', 'xp', 1, 10);
        });
    });

    it('zwraca leaderboard ekonomii z query parametrami', async () => {
        const leaderboardPayload = {
            sortBy: 'coins',
            page: 2,
            pageSize: 15,
            totalRows: 50,
            totalPages: 4,
            entries: [],
        };

        vi.mocked(getEconomyLeaderboardPage).mockResolvedValue(leaderboardPayload as any);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/leaderboard?sortBy=coins&page=2&pageSize=15`);
            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.leaderboard).toEqual(leaderboardPayload);
            expect(vi.mocked(getEconomyLeaderboardPage)).toHaveBeenCalledWith('123456789012345678', 'coins', 2, 15);
        });
    });

    it('normalizuje nieprawidlowe page oraz pageSize do wartosci domyslnych', async () => {
        const leaderboardPayload = {
            sortBy: 'xp',
            page: 1,
            pageSize: 10,
            totalRows: 0,
            totalPages: 1,
            entries: [],
        };

        vi.mocked(getEconomyLeaderboardPage).mockResolvedValue(leaderboardPayload as any);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/leaderboard?page=-1&pageSize=abc`);
            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.leaderboard).toEqual(leaderboardPayload);
            expect(vi.mocked(getEconomyLeaderboardPage)).toHaveBeenCalledWith('123456789012345678', 'xp', 1, 10);
        });
    });

    it('przycina pageSize leaderboardu do maksymalnie 25', async () => {
        const leaderboardPayload = {
            sortBy: 'xp',
            page: 2,
            pageSize: 25,
            totalRows: 0,
            totalPages: 1,
            entries: [],
        };

        vi.mocked(getEconomyLeaderboardPage).mockResolvedValue(leaderboardPayload as any);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/leaderboard?page=2&pageSize=999`);
            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.leaderboard).toEqual(leaderboardPayload);
            expect(vi.mocked(getEconomyLeaderboardPage)).toHaveBeenCalledWith('123456789012345678', 'xp', 2, 25);
        });
    });

    it('odrzuca nieprawidlowy parametr sortBy dla leaderboardu', async () => {
        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/leaderboard?sortBy=invalid`);
            const body = await parseJsonResponse(response);

            expect(response.status).toBe(400);
            expect(body.error).toBe('Nieprawidłowy parametr sortBy. Dozwolone: xp, coins.');
            expect(vi.mocked(getEconomyLeaderboardPage)).not.toHaveBeenCalled();
        });
    });

    it('zwraca 403 dla leaderboardu gdy uzytkownik utracil role', async () => {
        vi.mocked(getGuildMember).mockResolvedValue({ roles: [] } as any);
        vi.mocked(hasRequiredRole).mockReturnValue(false);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/leaderboard`);
            const body = await parseJsonResponse(response);

            expect(response.status).toBe(403);
            expect(body.error).toBe('Brak uprawnień do wykonania tej operacji.');
            expect(vi.mocked(getEconomyLeaderboardPage)).not.toHaveBeenCalled();
        });
    });

    it('zwraca 502 dla leaderboardu gdy weryfikacja roli nie dziala', async () => {
        vi.mocked(getGuildMember).mockRejectedValue(new Error('discord unavailable'));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/leaderboard`);
            const body = await parseJsonResponse(response);

            expect(response.status).toBe(502);
            expect(body.error).toBe('Nie udało się zweryfikować uprawnień użytkownika.');
            expect(vi.mocked(getEconomyLeaderboardPage)).not.toHaveBeenCalled();
        });
    });

    it('zwraca blad 500 przy braku GUILD_ID dla leaderboardu', async () => {
        delete process.env.GUILD_ID;

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/leaderboard`);
            const body = await parseJsonResponse(response);

            expect(response.status).toBe(500);
            expect(body.error).toBe('Brakuje GUILD_ID.');
            expect(vi.mocked(getEconomyLeaderboardPage)).not.toHaveBeenCalled();
        });
    });

    it('zwraca 500 przy bledzie pobierania leaderboardu ekonomii', async () => {
        vi.mocked(getEconomyLeaderboardPage).mockRejectedValue(new Error('db read failed'));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/leaderboard`);
            const body = await parseJsonResponse(response);

            expect(response.status).toBe(500);
            expect(body.error).toBe('Nie udało się pobrać leaderboardu ekonomii.');
        });
    });

    it('zwraca fallback profilu leaderboardu gdy pobranie czlonka Discord nie powiedzie sie', async () => {
        const leaderboardPayload = {
            sortBy: 'xp',
            page: 1,
            pageSize: 10,
            totalRows: 1,
            totalPages: 1,
            entries: [
                { rank: 1, userId: 'u-fallback', xp: 300, level: 3, coins: 100 },
            ],
        };

        vi.mocked(getGuildMember).mockImplementation(async (userId: string) => {
            if (userId === 'user-1') {
                return {
                    roles: ['admin-role'],
                    nick: null,
                    user: {
                        id: 'user-1',
                        username: 'Admin',
                        global_name: 'Admin',
                        avatar: null,
                        discriminator: '0',
                    },
                } as any;
            }

            if (userId === 'u-fallback') {
                throw new Error('discord member failed');
            }

            return {
                roles: [],
                nick: null,
            } as any;
        });

        vi.mocked(getEconomyLeaderboardPage).mockResolvedValue(leaderboardPayload as any);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/leaderboard`);
            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.leaderboard).toEqual({
                ...leaderboardPayload,
                entries: [
                    {
                        rank: 1,
                        userId: 'u-fallback',
                        xp: 300,
                        level: 3,
                        coins: 100,
                        displayName: 'Uzytkownik u-fallback',
                        avatarUrl: null,
                    },
                ],
            });
            expect(vi.mocked(getEconomyLeaderboardPage)).toHaveBeenCalledWith('123456789012345678', 'xp', 1, 10);
        });
    });

    it('rollbackuje utworzony kanał watchparty gdy zapis statusu po /api/embed nie powiedzie się', async () => {
        vi.mocked(publishDashboardPost).mockResolvedValue({
            messageId: 'message-1',
            pingMessageId: undefined,
            imageMessageId: undefined,
            warnings: [],
        } as any);
        vi.mocked(tryCreateDiscordEventFromPayload).mockResolvedValue({
            status: 'not_requested',
            eventId: undefined,
            eventError: undefined,
            warnings: [],
        } as any);
        vi.mocked(insertScheduledPost).mockResolvedValue({ id: 'post-1' } as any);
        vi.mocked(tryCreateWatchpartyChannelFromPayload).mockResolvedValue({
            status: 'scheduled',
            channelId: 'watchparty-created-before-persist-fail',
            watchpartyError: undefined,
            warnings: [],
        } as any);
        vi.mocked(updateScheduledPost).mockResolvedValue(null);
        vi.mocked(deleteWatchpartyChannel).mockResolvedValue(undefined);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/embed`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildEmbedPayload()),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.watchpartyStatus).toBe('failed');
            expect(body.watchpartyChannelId).toBeUndefined();
            expect(body.watchpartyError).toBe('Nie utworzono kanału watchparty, bo nie udało się zapisać jego statusu.');
            expect(vi.mocked(deleteWatchpartyChannel)).toHaveBeenCalledWith('watchparty-created-before-persist-fail');
        });
    });

    it('zwraca ostrzezenie o recznym sprzataniu gdy rollback kanału watchparty po /api/embed sie nie powiedzie', async () => {
        vi.mocked(publishDashboardPost).mockResolvedValue({
            messageId: 'message-rollback-warning',
            pingMessageId: undefined,
            imageMessageId: undefined,
            warnings: [],
        } as any);
        vi.mocked(tryCreateDiscordEventFromPayload).mockResolvedValue({
            status: 'not_requested',
            eventId: undefined,
            eventError: undefined,
            warnings: [],
        } as any);
        vi.mocked(insertScheduledPost).mockResolvedValue({ id: 'post-rollback-warning' } as any);
        vi.mocked(tryCreateWatchpartyChannelFromPayload).mockResolvedValue({
            status: 'scheduled',
            channelId: 'watchparty-rollback-warning-channel',
            watchpartyError: undefined,
            warnings: [],
        } as any);
        vi.mocked(updateScheduledPost).mockRejectedValueOnce(new Error('persist update failed'));
        vi.mocked(deleteWatchpartyChannel).mockRejectedValueOnce(new Error('rollback delete failed'));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/embed`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildEmbedPayload({
                    content: 'test rollback warning',
                })),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.watchpartyStatus).toBe('failed');
            expect(body.watchpartyError).toBe('Nie utworzono kanału watchparty, bo nie udało się zapisać jego statusu.');
            expect(Array.isArray(body.warnings)).toBe(true);
            expect((body.warnings as string[]).some((warning) => warning.includes('Wymagane ręczne sprzątanie kanału'))).toBe(true);
            expect(vi.mocked(deleteWatchpartyChannel)).toHaveBeenCalledWith('watchparty-rollback-warning-channel');
        });
    });

    it('uzywa cache profili leaderboardu przy kolejnych requestach', async () => {
        const cachedUserId = 'u-cache-hit-verification';
        const leaderboardPayload = {
            sortBy: 'xp',
            page: 1,
            pageSize: 10,
            totalRows: 1,
            totalPages: 1,
            entries: [
                { rank: 1, userId: cachedUserId, xp: 500, level: 4, coins: 120 },
            ],
        };

        vi.mocked(getEconomyLeaderboardPage).mockResolvedValue(leaderboardPayload as any);
        vi.mocked(getGuildMember).mockImplementation(async (userId: string) => {
            if (userId === 'user-1') {
                return {
                    roles: ['admin-role'],
                    nick: null,
                    user: {
                        id: 'user-1',
                        username: 'Admin',
                        global_name: 'Admin',
                        avatar: null,
                        discriminator: '0',
                    },
                } as any;
            }

            if (userId === cachedUserId) {
                return {
                    roles: [],
                    nick: 'Cache User',
                    user: {
                        id: cachedUserId,
                        username: 'cache-user',
                        global_name: null,
                        avatar: null,
                        discriminator: '0',
                    },
                } as any;
            }

            return {
                roles: [],
                nick: null,
            } as any;
        });

        await withServer(async (baseUrl) => {
            const firstResponse = await fetch(`${baseUrl}/api/economy/leaderboard`);
            const firstBody = await parseJsonResponse(firstResponse);

            const secondResponse = await fetch(`${baseUrl}/api/economy/leaderboard`);
            const secondBody = await parseJsonResponse(secondResponse);

            expect(firstResponse.status).toBe(200);
            expect(secondResponse.status).toBe(200);
            expect(firstBody.leaderboard).toEqual(secondBody.leaderboard);

            const cachedProfileLookups = vi.mocked(getGuildMember).mock.calls
                .filter((call) => call[0] === cachedUserId);
            expect(cachedProfileLookups).toHaveLength(1);
        });
    });

    it('deduplikuje równoległe lookupy profilu leaderboardu w tym samym czasie', async () => {
        const dedupeUserId = 'u-cache-inflight-dedupe';
        const leaderboardPayload = {
            sortBy: 'xp',
            page: 1,
            pageSize: 10,
            totalRows: 1,
            totalPages: 1,
            entries: [
                { rank: 1, userId: dedupeUserId, xp: 900, level: 6, coins: 300 },
            ],
        };

        vi.mocked(getEconomyLeaderboardPage).mockResolvedValue(leaderboardPayload as any);
        vi.mocked(getGuildMember).mockImplementation(async (userId: string) => {
            if (userId === 'user-1') {
                return {
                    roles: ['admin-role'],
                    nick: null,
                    user: {
                        id: 'user-1',
                        username: 'Admin',
                        global_name: 'Admin',
                        avatar: null,
                        discriminator: '0',
                    },
                } as any;
            }

            if (userId === dedupeUserId) {
                return {
                    roles: [],
                    nick: 'Inflight Dedupe',
                    user: {
                        id: dedupeUserId,
                        username: 'inflight-user',
                        global_name: null,
                        avatar: null,
                        discriminator: '0',
                    },
                } as any;
            }

            return {
                roles: [],
                nick: null,
            } as any;
        });

        await withServer(async (baseUrl) => {
            const [firstResponse, secondResponse] = await Promise.all([
                fetch(`${baseUrl}/api/economy/leaderboard`),
                fetch(`${baseUrl}/api/economy/leaderboard`),
            ]);

            expect(firstResponse.status).toBe(200);
            expect(secondResponse.status).toBe(200);

            const cachedProfileLookups = vi.mocked(getGuildMember).mock.calls
                .filter((call) => call[0] === dedupeUserId);
            expect(cachedProfileLookups).toHaveLength(1);
        });
    });
});
