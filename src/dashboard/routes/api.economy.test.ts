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
    EconomyCsvImportValidationError: class EconomyCsvImportValidationError extends Error {},
    EconomyInputValidationError: class EconomyInputValidationError extends Error {},
    addCoinsByAdmin: vi.fn(),
    addLevelsByAdmin: vi.fn(),
    addXpByAdmin: vi.fn(),
    createEconomyTimeout: vi.fn(),
    getActiveEconomyTimeoutForUser: vi.fn(),
    getEconomyConfig: vi.fn(),
    getEconomyLeaderboardPage: vi.fn(),
    getEconomyLevelRoleMappings: vi.fn(),
    getEconomyTimeoutById: vi.fn(),
    importEconomyCsvSnapshot: vi.fn(),
    listActiveEconomyTimeouts: vi.fn(),
    releaseEconomyTimeout: vi.fn(),
    replaceEconomyLevelRoleMappings: vi.fn(),
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
    addGuildMemberRole: vi.fn(),
    removeGuildMemberRole: vi.fn(),
    updateGuildMemberRoles: vi.fn(),
    hasDevRole: vi.fn(() => true),
    hasRequiredRole: vi.fn(() => true),
    listGuildScheduledEvents: vi.fn(),
    searchGuildMembers: vi.fn(),
    listImages: vi.fn(),
    sendImageToChannel: vi.fn(),
    sendDirectMessage: vi.fn(),
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
    addCoinsByAdmin,
    addLevelsByAdmin,
    addXpByAdmin,
    createEconomyTimeout,
    getActiveEconomyTimeoutForUser,
    getEconomyConfig,
    getEconomyLeaderboardPage,
    getEconomyLevelRoleMappings,
    getEconomyTimeoutById,
    importEconomyCsvSnapshot,
    listActiveEconomyTimeouts,
    releaseEconomyTimeout,
    replaceEconomyLevelRoleMappings,
    resetEconomyUsers,
    updateEconomyConfig,
} from '../../economy/repository.js';
import {
    addGuildMemberRole,
    getGuildMember,
    hasDevRole,
    hasRequiredRole,
    removeGuildMemberRole,
    sendDirectMessage,
    updateGuildMemberRoles,
} from '../discord-api.js';
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
        levelingCurve: 'default',
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
        process.env.ADMIN_ROLE_ID = '910000000000000001';
        process.env.MODERATOR_ROLE_ID = '910000000000000002';
        process.env.COMMUNITY_MANAGER_ROLE_ID = '910000000000000003';
        process.env.DEV_ROLE_ID = '910000000000000004';
        process.env.SERVER_MUTE_ROLE_ID = '910000000000000005';
        vi.mocked(getGuildMember).mockResolvedValue({ roles: ['admin-role'] } as any);
        vi.mocked(hasDevRole).mockReturnValue(true);
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

    it('dodaje coinsy uzytkownikowi przez endpoint recznej mutacji', async () => {
        vi.mocked(addCoinsByAdmin).mockResolvedValue({
            guildId: '123456789012345678',
            userId: '999999999999999999',
            operation: 'add_coins',
            amount: 1500,
            previousCoins: 100,
            currentCoins: 1600,
            previousXp: 500,
            currentXp: 500,
            previousLevel: 3,
            currentLevel: 3,
            createdAt: Date.now(),
        });

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/user-mutation`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    targetUserId: '999999999999999999',
                    operation: 'add_coins',
                    amount: 1500,
                }),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(vi.mocked(addCoinsByAdmin)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(addCoinsByAdmin)).toHaveBeenCalledWith(expect.objectContaining({
                guildId: '123456789012345678',
                targetUserId: '999999999999999999',
                adminUserId: 'user-1',
                amount: 1500,
            }));
            expect(vi.mocked(addXpByAdmin)).not.toHaveBeenCalled();
            expect(vi.mocked(addLevelsByAdmin)).not.toHaveBeenCalled();
        });
    });

    it('dodaje levele uzytkownikowi przez endpoint recznej mutacji', async () => {
        vi.mocked(addLevelsByAdmin).mockResolvedValue({
            guildId: '123456789012345678',
            userId: '777777777777777777',
            operation: 'add_levels',
            amount: 3,
            previousCoins: 100,
            currentCoins: 220,
            previousXp: 500,
            currentXp: 920,
            previousLevel: 4,
            currentLevel: 7,
            createdAt: Date.now(),
        });

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/user-mutation`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    targetUserId: '777777777777777777',
                    operation: 'add_levels',
                    amount: 3,
                }),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(vi.mocked(addLevelsByAdmin)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(addLevelsByAdmin)).toHaveBeenCalledWith(expect.objectContaining({
                guildId: '123456789012345678',
                targetUserId: '777777777777777777',
                adminUserId: 'user-1',
                amount: 3,
            }));
            expect(vi.mocked(addCoinsByAdmin)).not.toHaveBeenCalled();
            expect(vi.mocked(addXpByAdmin)).not.toHaveBeenCalled();
        });
    });

    it('dodaje XP uzytkownikowi przez endpoint recznej mutacji', async () => {
        vi.mocked(addXpByAdmin).mockResolvedValue({
            guildId: '123456789012345678',
            userId: '888888888888888888',
            operation: 'add_xp',
            amount: 2500,
            previousCoins: 80,
            currentCoins: 120,
            previousXp: 900,
            currentXp: 3400,
            previousLevel: 4,
            currentLevel: 6,
            createdAt: Date.now(),
        });

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/user-mutation`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    targetUserId: '888888888888888888',
                    operation: 'add_xp',
                    amount: 2500,
                }),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(vi.mocked(addXpByAdmin)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(addXpByAdmin)).toHaveBeenCalledWith(expect.objectContaining({
                guildId: '123456789012345678',
                targetUserId: '888888888888888888',
                adminUserId: 'user-1',
                amount: 2500,
            }));
            expect(vi.mocked(addCoinsByAdmin)).not.toHaveBeenCalled();
            expect(vi.mocked(addLevelsByAdmin)).not.toHaveBeenCalled();
        });
    });

    it('odrzuca add_levels powyzej limitu', async () => {
        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/user-mutation`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    targetUserId: '777777777777777777',
                    operation: 'add_levels',
                    amount: 1001,
                }),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(400);
            expect(typeof body.error).toBe('string');
            expect(vi.mocked(addLevelsByAdmin)).not.toHaveBeenCalled();
        });
    });

    it('odrzuca nieprawidlowy payload recznej mutacji ekonomii', async () => {
        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/user-mutation`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    targetUserId: 'not-a-user-id',
                    operation: 'add_coins',
                    amount: 0,
                }),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(400);
            expect(typeof body.error).toBe('string');
            expect(vi.mocked(addCoinsByAdmin)).not.toHaveBeenCalled();
            expect(vi.mocked(addXpByAdmin)).not.toHaveBeenCalled();
            expect(vi.mocked(addLevelsByAdmin)).not.toHaveBeenCalled();
        });
    });

    it('zwraca 403 dla recznej mutacji gdy uzytkownik utracil role', async () => {
        vi.mocked(getGuildMember).mockResolvedValue({ roles: [] } as any);
        vi.mocked(hasDevRole).mockReturnValue(false);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/user-mutation`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    targetUserId: '999999999999999999',
                    operation: 'add_coins',
                    amount: 100,
                }),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(403);
            expect(body.error).toBe('Brak uprawnień do wykonania tej operacji.');
            expect(vi.mocked(addCoinsByAdmin)).not.toHaveBeenCalled();
            expect(vi.mocked(addXpByAdmin)).not.toHaveBeenCalled();
            expect(vi.mocked(addLevelsByAdmin)).not.toHaveBeenCalled();
        });
    });

    it('zwraca blad 500 przy braku GUILD_ID dla recznej mutacji', async () => {
        delete process.env.GUILD_ID;

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/user-mutation`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    targetUserId: '999999999999999999',
                    operation: 'add_coins',
                    amount: 100,
                }),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(500);
            expect(body.error).toBe('Brakuje GUILD_ID.');
            expect(vi.mocked(addCoinsByAdmin)).not.toHaveBeenCalled();
            expect(vi.mocked(addXpByAdmin)).not.toHaveBeenCalled();
            expect(vi.mocked(addLevelsByAdmin)).not.toHaveBeenCalled();
        });
    });

    it('zwraca 500 przy bledzie zapisu recznej mutacji', async () => {
        vi.mocked(addCoinsByAdmin).mockRejectedValue(new Error('mutation failed'));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/user-mutation`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    targetUserId: '999999999999999999',
                    operation: 'add_coins',
                    amount: 100,
                }),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(500);
            expect(body.error).toBe('Nie udało się wykonać ręcznej mutacji użytkownika.');
            expect(vi.mocked(addCoinsByAdmin)).toHaveBeenCalledTimes(1);
        });
    });

    it('zwraca 403 dla aktualizacji ekonomii gdy uzytkownik utracil role', async () => {
        const payload = buildConfig();
        vi.mocked(getGuildMember).mockResolvedValue({ roles: [] } as any);
        vi.mocked(hasDevRole).mockReturnValue(false);

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

    it('zwraca mapowania rol levelowych', async () => {
        vi.mocked(getEconomyLevelRoleMappings).mockResolvedValue([
            {
                guildId: '123456789012345678',
                roleId: '111111111111111111',
                minLevel: 5,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            },
        ] as any);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/level-roles`);
            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(Array.isArray(body.mappings)).toBe(true);
            expect(vi.mocked(getEconomyLevelRoleMappings)).toHaveBeenCalledWith('123456789012345678');
        });
    });

    it('zapisuje mapowania rol levelowych', async () => {
        vi.mocked(replaceEconomyLevelRoleMappings).mockResolvedValue([
            {
                guildId: '123456789012345678',
                roleId: '111111111111111111',
                minLevel: 10,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            },
        ] as any);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/level-roles`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    mappings: [
                        {
                            roleId: '111111111111111111',
                            minLevel: 10,
                        },
                    ],
                }),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(vi.mocked(replaceEconomyLevelRoleMappings)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(replaceEconomyLevelRoleMappings)).toHaveBeenCalledWith(
                '123456789012345678',
                [{ roleId: '111111111111111111', minLevel: 10 }],
                expect.any(Number),
            );
        });
    });

    it('odrzuca mapowanie levelowe dla roli staff', async () => {
        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/level-roles`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    mappings: [
                        {
                            roleId: process.env.ADMIN_ROLE_ID,
                            minLevel: 10,
                        },
                    ],
                }),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(400);
            expect(body.error).toBe('Mapowania leveli nie moga zawierac ról staff (Admin, Moderator, Community Manager, Dev).');
            expect(vi.mocked(replaceEconomyLevelRoleMappings)).not.toHaveBeenCalled();
        });
    });

    it('importuje snapshot CSV ekonomii', async () => {
        vi.mocked(importEconomyCsvSnapshot).mockResolvedValue({
            importedRows: 2,
            insertedRows: 1,
            updatedRows: 1,
        });
        vi.mocked(getEconomyLevelRoleMappings).mockResolvedValue([
            {
                guildId: '123456789012345678',
                roleId: '111111111111111111',
                minLevel: 1,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            },
            {
                guildId: '123456789012345678',
                roleId: '222222222222222222',
                minLevel: 2,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            },
        ] as any);
        vi.mocked(getGuildMember).mockImplementation(async (userId: string) => {
            if (userId === 'user-1') {
                return { roles: ['admin-role'] } as any;
            }

            if (userId === '123456789012345678') {
                return { roles: ['333333333333333333'] } as any;
            }

            if (userId === '987654321098765432') {
                return { roles: ['111111111111111111'] } as any;
            }

            return null;
        });
        vi.mocked(updateGuildMemberRoles).mockResolvedValue('updated' as any);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/import-csv`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    csvContent: '123456789012345678,1,20,5,3\n987654321098765432,2,10,4,1',
                }),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.result).toEqual({
                importedRows: 2,
                insertedRows: 1,
                updatedRows: 1,
            });
            expect(body.roleSync).toEqual({
                attemptedUsers: 2,
                updatedUsers: 2,
                skippedUsers: 0,
                failedUsers: 0,
            });
            expect(vi.mocked(importEconomyCsvSnapshot)).toHaveBeenCalledWith({
                guildId: '123456789012345678',
                csvContent: '123456789012345678,1,20,5,3\n987654321098765432,2,10,4,1',
                nowTimestamp: expect.any(Number),
            });
            expect(vi.mocked(updateGuildMemberRoles)).toHaveBeenCalledTimes(2);
            expect(vi.mocked(updateGuildMemberRoles)).toHaveBeenNthCalledWith(
                1,
                '123456789012345678',
                '123456789012345678',
                ['333333333333333333', '111111111111111111'],
            );
            expect(vi.mocked(updateGuildMemberRoles)).toHaveBeenNthCalledWith(
                2,
                '123456789012345678',
                '987654321098765432',
                ['222222222222222222'],
            );
        });
    });

    it('liczy roleSync jako skipped gdy member zniknie przy patchowaniu rol (404)', async () => {
        vi.mocked(importEconomyCsvSnapshot).mockResolvedValue({
            importedRows: 1,
            insertedRows: 1,
            updatedRows: 0,
        });
        vi.mocked(getEconomyLevelRoleMappings).mockResolvedValue([
            {
                guildId: '123456789012345678',
                roleId: '999999999999999999',
                minLevel: 1,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            },
        ] as any);
        vi.mocked(getGuildMember).mockImplementation(async (userId: string) => {
            if (userId === 'user-1') {
                return { roles: ['admin-role'] } as any;
            }

            if (userId === '123456789012345678') {
                return { roles: [] } as any;
            }

            return null;
        });
        vi.mocked(updateGuildMemberRoles).mockResolvedValue('not_found' as any);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/import-csv`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    csvContent: '123456789012345678,1,20,5,3',
                }),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.roleSync).toEqual({
                attemptedUsers: 1,
                updatedUsers: 0,
                skippedUsers: 1,
                failedUsers: 0,
            });
        });
    });

    it('zwraca 403 gdy uzytkownik utracil role dashboardu', async () => {
        vi.mocked(getGuildMember).mockResolvedValue({ roles: [] } as any);
        vi.mocked(hasDevRole).mockReturnValue(false);

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

    it('blokuje ustawienia ekonomii dla support role bez roli Dev', async () => {
        vi.mocked(hasRequiredRole).mockReturnValue(true);
        vi.mocked(hasDevRole).mockReturnValue(false);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/settings`);
            const body = await parseJsonResponse(response);

            expect(response.status).toBe(403);
            expect(body.error).toBe('Brak uprawnień do wykonania tej operacji.');
            expect(vi.mocked(getEconomyConfig)).not.toHaveBeenCalled();
        });
    });

    it('pozwala support role pobrac leaderboard bez roli Dev', async () => {
        vi.mocked(hasRequiredRole).mockReturnValue(true);
        vi.mocked(hasDevRole).mockReturnValue(false);
        vi.mocked(getEconomyLeaderboardPage).mockResolvedValue({
            sortBy: 'xp',
            page: 1,
            pageSize: 10,
            totalRows: 0,
            totalPages: 1,
            entries: [],
        } as any);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/economy/leaderboard`);
            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.leaderboard).toEqual({
                sortBy: 'xp',
                page: 1,
                pageSize: 10,
                totalRows: 0,
                totalPages: 1,
                entries: [],
            });
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

    it('zwraca aktywna liste timeoutow', async () => {
        vi.mocked(listActiveEconomyTimeouts).mockResolvedValue([
            {
                id: 1,
                guildId: '123456789012345678',
                userId: '999999999999999999',
                reason: 'Flood',
                muteRoleId: '910000000000000005',
                createdByUserId: 'user-1',
                createdAt: Date.now(),
                expiresAt: Date.now() + 60_000,
                isActive: true,
                releasedAt: null,
                releasedByUserId: null,
                releaseReason: null,
            },
        ] as any);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/timeouts?userId=999999999999999999&limit=25`);
            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(Array.isArray(body.timeouts)).toBe(true);
            expect(vi.mocked(listActiveEconomyTimeouts)).toHaveBeenCalledWith(
                '123456789012345678',
                {
                    userId: '999999999999999999',
                    limit: 25,
                },
            );
        });
    });

    it('naklada timeout przez dashboard i zapisuje rekord', async () => {
        const now = Date.now();
        const createdTimeout = {
            id: 55,
            guildId: '123456789012345678',
            userId: '999999999999999999',
            reason: 'Spam',
            muteRoleId: '910000000000000005',
            createdByUserId: 'user-1',
            createdAt: now,
            expiresAt: now + (60 * 60 * 1000),
            isActive: true,
            releasedAt: null,
            releasedByUserId: null,
            releaseReason: null,
        };

        vi.mocked(getActiveEconomyTimeoutForUser)
            .mockResolvedValueOnce(null as any)
            .mockResolvedValueOnce(createdTimeout as any);
        vi.mocked(getGuildMember).mockImplementation(async (userId: string) => {
            if (userId === 'user-1') {
                return { roles: ['admin-role'] } as any;
            }

            if (userId === '999999999999999999') {
                return { roles: ['222222222222222222'] } as any;
            }

            return null;
        });
        vi.mocked(createEconomyTimeout).mockResolvedValue(createdTimeout as any);
        vi.mocked(addGuildMemberRole).mockResolvedValue('updated' as any);
        vi.mocked(sendDirectMessage).mockResolvedValue(undefined);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/timeouts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    targetUserId: '999999999999999999',
                    durationAmount: 1,
                    durationUnit: 'h',
                    reason: 'Spam',
                }),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.warnings).toEqual([]);
            expect(vi.mocked(createEconomyTimeout)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(addGuildMemberRole)).toHaveBeenCalledWith(
                '123456789012345678',
                '999999999999999999',
                '910000000000000005',
            );
            expect(vi.mocked(sendDirectMessage)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(sendDirectMessage)).toHaveBeenCalledWith(
                '999999999999999999',
                expect.stringContaining('Zostales zmutowany na serwerze'),
            );
        });
    });

    it('odrzuca timeout dla bota przez API', async () => {
        vi.mocked(getActiveEconomyTimeoutForUser).mockResolvedValue(null as any);
        vi.mocked(getGuildMember).mockImplementation(async (userId: string) => {
            if (userId === 'user-1') {
                return { roles: ['admin-role'] } as any;
            }

            if (userId === '999999999999999999') {
                return { roles: ['222222222222222222'], user: { bot: true } } as any;
            }

            return null;
        });

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/timeouts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    targetUserId: '999999999999999999',
                    durationAmount: 1,
                    durationUnit: 'h',
                    reason: 'Spam',
                }),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(400);
            expect(body.error).toBe('Nie mozna nalozyc timeoutu na boty.');
            expect(vi.mocked(createEconomyTimeout)).not.toHaveBeenCalled();
        });
    });

    it('naklada timeout dla czlonka staffu przez dashboard', async () => {
        const now = Date.now();
        const createdTimeout = {
            id: 58,
            guildId: '123456789012345678',
            userId: '999999999999999999',
            reason: 'Spam',
            muteRoleId: '910000000000000005',
            createdByUserId: 'user-1',
            createdAt: now,
            expiresAt: now + (60 * 60 * 1000),
            isActive: true,
            releasedAt: null,
            releasedByUserId: null,
            releaseReason: null,
        };

        vi.mocked(getActiveEconomyTimeoutForUser).mockResolvedValue(null as any);
        vi.mocked(getGuildMember).mockImplementation(async (userId: string) => {
            if (userId === 'user-1') {
                return { roles: ['admin-role'] } as any;
            }

            if (userId === '999999999999999999') {
                return { roles: ['910000000000000001'] } as any;
            }

            return null;
        });
        vi.mocked(createEconomyTimeout).mockResolvedValue(createdTimeout as any);
        vi.mocked(addGuildMemberRole).mockResolvedValue('updated' as any);
        vi.mocked(sendDirectMessage).mockResolvedValue(undefined);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/timeouts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    targetUserId: '999999999999999999',
                    durationAmount: 1,
                    durationUnit: 'h',
                    reason: 'Spam',
                }),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(vi.mocked(createEconomyTimeout)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(addGuildMemberRole)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(sendDirectMessage)).toHaveBeenCalledTimes(1);
        });
    });

    it('odrzuca timeout przez dashboard gdy reason to sam whitespace', async () => {
        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/timeouts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    targetUserId: '999999999999999999',
                    durationAmount: 1,
                    durationUnit: 'h',
                    reason: '   ',
                }),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(400);
            expect(typeof body.error).toBe('string');
            expect(vi.mocked(createEconomyTimeout)).not.toHaveBeenCalled();
            expect(vi.mocked(addGuildMemberRole)).not.toHaveBeenCalled();
            expect(vi.mocked(sendDirectMessage)).not.toHaveBeenCalled();
        });
    });

    it('zwraca sukces i ostrzezenie gdy DM o timeoutcie z dashboardu nie zostanie dostarczony', async () => {
        const now = Date.now();
        const createdTimeout = {
            id: 59,
            guildId: '123456789012345678',
            userId: '999999999999999999',
            reason: 'Spam',
            muteRoleId: '910000000000000005',
            createdByUserId: 'user-1',
            createdAt: now,
            expiresAt: now + (60 * 60 * 1000),
            isActive: true,
            releasedAt: null,
            releasedByUserId: null,
            releaseReason: null,
        };

        vi.mocked(getActiveEconomyTimeoutForUser).mockResolvedValue(null as any);
        vi.mocked(getGuildMember).mockImplementation(async (userId: string) => {
            if (userId === 'user-1') {
                return { roles: ['admin-role'] } as any;
            }

            if (userId === '999999999999999999') {
                return { roles: ['222222222222222222'] } as any;
            }

            return null;
        });
        vi.mocked(createEconomyTimeout).mockResolvedValue(createdTimeout as any);
        vi.mocked(addGuildMemberRole).mockResolvedValue('updated' as any);
        vi.mocked(sendDirectMessage).mockRejectedValue(new Error('dm blocked'));

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/timeouts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    targetUserId: '999999999999999999',
                    durationAmount: 1,
                    durationUnit: 'h',
                    reason: 'Spam',
                }),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.warnings).toEqual(['Nie udalo sie wyslac DM do uzytkownika.']);
            expect(vi.mocked(createEconomyTimeout)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(addGuildMemberRole)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(sendDirectMessage)).toHaveBeenCalledTimes(1);
        });
    });

    it('zdejmuje timeout przez dashboard i aktualizuje role', async () => {
        const activeTimeout = {
            id: 77,
            guildId: '123456789012345678',
            userId: '888888888888888888',
            reason: 'Flood',
            muteRoleId: '910000000000000005',
            createdByUserId: 'user-1',
            createdAt: Date.now() - 5_000,
            expiresAt: Date.now() + (60 * 60 * 1000),
            isActive: true,
            releasedAt: null,
            releasedByUserId: null,
            releaseReason: null,
        };
        const releasedTimeout = {
            ...activeTimeout,
            isActive: false,
            releasedAt: Date.now(),
            releasedByUserId: 'user-1',
            releaseReason: 'Timeout zdjety recznie z dashboardu',
        };

        vi.mocked(getEconomyTimeoutById).mockResolvedValue(activeTimeout as any);
        vi.mocked(getGuildMember).mockImplementation(async (userId: string) => {
            if (userId === 'user-1') {
                return { roles: ['admin-role'] } as any;
            }

            if (userId === '888888888888888888') {
                return { roles: ['910000000000000005', '123123123123123123'] } as any;
            }

            return null;
        });
        vi.mocked(removeGuildMemberRole).mockResolvedValue('updated' as any);
        vi.mocked(releaseEconomyTimeout).mockResolvedValue(releasedTimeout as any);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/timeouts/77/remove`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            });

            const body = await parseJsonResponse(response);

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);
            expect(vi.mocked(removeGuildMemberRole)).toHaveBeenCalledWith(
                '123456789012345678',
                '888888888888888888',
                '910000000000000005',
            );
            expect(vi.mocked(releaseEconomyTimeout)).toHaveBeenCalledTimes(1);
        });
    });
});
