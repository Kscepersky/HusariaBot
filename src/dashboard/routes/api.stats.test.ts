import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/require-auth.js', () => ({
    requireAuth: (req: Request, _res: ExpressResponse, next: NextFunction): void => {
        const reqWithSession = req as unknown as {
            session: { user: { id: string; username: string; globalName: string; avatar: string | null } };
        };
        reqWithSession.session = {
            user: { id: 'user-1', username: 'Admin', globalName: 'Admin', avatar: null },
        };
        next();
    },
}));

vi.mock('../discord-api.js', () => ({
    createExternalGuildScheduledEvent: vi.fn(),
    deleteGuildScheduledEvent: vi.fn(),
    getGuildTextChannels: vi.fn(),
    getGuildRoles: vi.fn(),
    getGuildEmojis: vi.fn(),
    getGuildMember: vi.fn(),
    getDiscordUserById: vi.fn(),
    addGuildMemberRole: vi.fn(),
    removeGuildMemberRole: vi.fn(),
    updateGuildMemberRoles: vi.fn(),
    listGuildScheduledEvents: vi.fn(),
    hasDevRole: vi.fn(() => true),
    hasRequiredRole: vi.fn(() => true),
    searchGuildMembers: vi.fn(),
    listImages: vi.fn(),
    sendImageToChannel: vi.fn(),
    sendDirectMessage: vi.fn(),
    updateGuildScheduledEvent: vi.fn(),
    getGuildAllChannels: vi.fn(),
    DiscordRateLimitedError: class DiscordRateLimitedError extends Error {
        retryAfterSeconds: number;
        constructor(retryAfterSeconds: number) {
            super('rate limited');
            this.retryAfterSeconds = retryAfterSeconds;
        }
    },
}));

vi.mock('../../economy/stats-store.js', () => ({
    getStatsExcludedChannelIds: vi.fn(),
    setStatsExcludedChannelIds: vi.fn(),
    getServerStatsByDateRange: vi.fn(),
    getServerStatsTopUsers: vi.fn(),
    getServerStatsDailyTimeSeries: vi.fn(),
    getMessageSummary: vi.fn(),
    getMessageTimeSeries: vi.fn(),
    getTopMessageUsers: vi.fn(),
    getTopMessageChannels: vi.fn(),
    getVoiceSummary: vi.fn(),
    getVoiceTimeSeries: vi.fn(),
    getTopVoiceUsers: vi.fn(),
    getTopVoiceChannels: vi.fn(),
    getMemberTimeSeries: vi.fn(),
    getMemberSummary: vi.fn(),
    getActiveUsersInPeriod: vi.fn(),
    getAllUserStatsForExport: vi.fn(),
    getAllChannelStatsForExport: vi.fn(),
    getAllMemberCountsForExport: vi.fn(),
}));

vi.mock('../leaderboard-profile-cache-store.js', () => ({
    getStoredLeaderboardProfile: vi.fn(),
    upsertStoredLeaderboardProfile: vi.fn(),
    pruneStoredLeaderboardProfiles: vi.fn(),
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
    incrementMessageCount: vi.fn(),
    incrementVoiceMinutes: vi.fn(),
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

vi.mock('../../tickets/history-store.js', () => ({
    listTicketHistoryEntries: vi.fn(),
    resolveTicketTranscriptFilePath: vi.fn(),
    clearTicketHistory: vi.fn(),
}));

vi.mock('../scheduler/store.js', () => ({
    insertScheduledPost: vi.fn(),
    updateScheduledPost: vi.fn(),
}));

vi.mock('../../utils/log-reader.js', () => ({
    listDashboardLogs: vi.fn(),
}));

vi.mock('../session/session-events.js', () => ({
    listSessionActivity: vi.fn(),
}));

vi.mock('../../utils/discord-user-cache.js', () => ({
    enrichWithDiscordUser: vi.fn(),
}));

vi.mock('archiver', () => {
    const createArchive = (): unknown => {
        let dest: NodeJS.WritableStream | null = null;
        const archive = {
            on(_event: string, _cb: (...args: unknown[]) => void) { return archive; },
            pipe(stream: NodeJS.WritableStream) { dest = stream; return archive; },
            append(_data: unknown, _opts: unknown) { return archive; },
            async finalize() { if (dest) { dest.end(); } },
        };
        return archive;
    };
    return { default: vi.fn(createArchive) };
});

import {
    getMessageSummary,
    getMessageTimeSeries,
    getTopMessageUsers,
    getTopMessageChannels,
    getVoiceSummary,
    getVoiceTimeSeries,
    getTopVoiceUsers,
    getTopVoiceChannels,
    getMemberTimeSeries,
    getMemberSummary,
    getActiveUsersInPeriod,
    getAllUserStatsForExport,
    getAllChannelStatsForExport,
    getAllMemberCountsForExport,
} from '../../economy/stats-store.js';
import { getGuildMember, hasRequiredRole, getGuildAllChannels } from '../discord-api.js';
import {
    upsertStoredLeaderboardProfile,
    pruneStoredLeaderboardProfiles,
} from '../leaderboard-profile-cache-store.js';
import { apiRouter } from './api.js';

const GUILD_ID = 'guild-123';
const START = '2024-03-10';
const END = '2024-03-12';
const DATE_PARAMS = `startDate=${START}&endDate=${END}`;

beforeEach(() => {
    process.env.GUILD_ID = GUILD_ID;
    vi.mocked(getGuildMember).mockResolvedValue({ roles: ['admin-role'] } as never);
    vi.mocked(hasRequiredRole).mockReturnValue(true);
    vi.mocked(getGuildAllChannels).mockResolvedValue([
        { id: 'ch-1', name: 'general', type: 0 },
        { id: 'vc-1', name: 'Voice 1', type: 2 },
    ] as never);
    vi.mocked(upsertStoredLeaderboardProfile).mockResolvedValue(undefined as never);
    vi.mocked(pruneStoredLeaderboardProfiles).mockResolvedValue(undefined as never);
});

afterEach(() => {
    delete process.env.GUILD_ID;
    vi.clearAllMocks();
});

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
    const app = express();
    app.use(express.json({ limit: '32mb' }));
    app.use('/api', apiRouter);

    const server = await new Promise<Server>((resolve) => {
        const started = app.listen(0, () => resolve(started));
    });

    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
        await run(baseUrl);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
    }
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
    const res = await fetch(url);
    const body = await res.json();
    return { status: res.status, body };
}

// ─── /api/stats/messages/summary ──────────────────────────────────────────────

describe('GET /api/stats/messages/summary', () => {
    it('zwraca 400 gdy brak startDate/endDate', async () => {
        await withServer(async (base) => {
            const { status } = await getJson(`${base}/api/stats/messages/summary`);
            expect(status).toBe(400);
        });
    });

    it('zwraca summary z danymi ze stats-store', async () => {
        vi.mocked(getMessageSummary).mockResolvedValue({ messages: 42, uniqueUsers: 7 });
        await withServer(async (base) => {
            const { status, body } = await getJson(`${base}/api/stats/messages/summary?${DATE_PARAMS}`);
            expect(status).toBe(200);
            expect((body as Record<string, unknown>).summary).toEqual({ messages: 42, uniqueUsers: 7 });
            expect(getMessageSummary).toHaveBeenCalledWith(GUILD_ID, START, END);
        });
    });

    it('zwraca 500 gdy stats-store rzuca błąd', async () => {
        vi.mocked(getMessageSummary).mockRejectedValue(new Error('db error'));
        await withServer(async (base) => {
            const { status } = await getJson(`${base}/api/stats/messages/summary?${DATE_PARAMS}`);
            expect(status).toBe(500);
        });
    });
});

// ─── /api/stats/messages/timeseries ───────────────────────────────────────────

describe('GET /api/stats/messages/timeseries', () => {
    it('zwraca szereg czasowy wiadomości', async () => {
        const timeSeries = [
            { date: START, messages: 10 },
            { date: END, messages: 5 },
        ];
        vi.mocked(getMessageTimeSeries).mockResolvedValue(timeSeries);
        await withServer(async (base) => {
            const { status, body } = await getJson(`${base}/api/stats/messages/timeseries?${DATE_PARAMS}`);
            expect(status).toBe(200);
            expect((body as Record<string, unknown>).timeSeries).toEqual(timeSeries);
        });
    });

    it('zwraca 400 dla nieprawidłowego zakresu dat', async () => {
        await withServer(async (base) => {
            const { status } = await getJson(`${base}/api/stats/messages/timeseries?startDate=invalid&endDate=invalid`);
            expect(status).toBe(400);
        });
    });
});

// ─── /api/stats/messages/top-users ────────────────────────────────────────────

describe('GET /api/stats/messages/top-users', () => {
    it('zwraca topUsers z uzupełnionymi profilami (fallback gdy brak)', async () => {
        vi.mocked(getTopMessageUsers).mockResolvedValue([
            { userId: 'u-1', messages: 20, voiceMinutes: 0, score: 20 },
        ]);
        await withServer(async (base) => {
            const { status, body } = await getJson(`${base}/api/stats/messages/top-users?${DATE_PARAMS}`);
            expect(status).toBe(200);
            const users = (body as Record<string, unknown>).topUsers as Array<Record<string, unknown>>;
            expect(users).toHaveLength(1);
            expect(users[0].userId).toBe('u-1');
            expect(users[0].messages).toBe(20);
            expect(typeof users[0].displayName).toBe('string');
        });
    });

    it('respektuje parametr limit', async () => {
        vi.mocked(getTopMessageUsers).mockResolvedValue([]);
        await withServer(async (base) => {
            await getJson(`${base}/api/stats/messages/top-users?${DATE_PARAMS}&limit=5`);
            expect(getTopMessageUsers).toHaveBeenCalledWith(GUILD_ID, START, END, 5);
        });
    });
});

// ─── /api/stats/messages/top-channels ─────────────────────────────────────────

describe('GET /api/stats/messages/top-channels', () => {
    it('zwraca topChannels z nazwami kanałów', async () => {
        vi.mocked(getTopMessageChannels).mockResolvedValue([
            { channelId: 'ch-1', messages: 15, voiceMinutes: 0 },
        ]);
        await withServer(async (base) => {
            const { status, body } = await getJson(`${base}/api/stats/messages/top-channels?${DATE_PARAMS}`);
            expect(status).toBe(200);
            const channels = (body as Record<string, unknown>).topChannels as Array<Record<string, unknown>>;
            expect(channels[0].channelId).toBe('ch-1');
            expect(channels[0].channelName).toBe('general');
        });
    });

    it('używa fallback #channelId gdy nazwa nieznana', async () => {
        vi.mocked(getTopMessageChannels).mockResolvedValue([
            { channelId: 'unknown-ch', messages: 5, voiceMinutes: 0 },
        ]);
        await withServer(async (base) => {
            const { status, body } = await getJson(`${base}/api/stats/messages/top-channels?${DATE_PARAMS}`);
            expect(status).toBe(200);
            const channels = (body as Record<string, unknown>).topChannels as Array<Record<string, unknown>>;
            expect(channels[0].channelName).toBe('#unknown-ch');
        });
    });
});

// ─── /api/stats/voice/summary ─────────────────────────────────────────────────

describe('GET /api/stats/voice/summary', () => {
    it('zwraca summary voice', async () => {
        vi.mocked(getVoiceSummary).mockResolvedValue({ voiceMinutes: 120, voiceHours: 2, uniqueUsers: 3 });
        await withServer(async (base) => {
            const { status, body } = await getJson(`${base}/api/stats/voice/summary?${DATE_PARAMS}`);
            expect(status).toBe(200);
            expect((body as Record<string, unknown>).summary).toEqual({
                voiceMinutes: 120,
                voiceHours: 2,
                uniqueUsers: 3,
            });
        });
    });

    it('zwraca 400 gdy brak dat', async () => {
        await withServer(async (base) => {
            const { status } = await getJson(`${base}/api/stats/voice/summary`);
            expect(status).toBe(400);
        });
    });
});

// ─── /api/stats/voice/timeseries ──────────────────────────────────────────────

describe('GET /api/stats/voice/timeseries', () => {
    it('zwraca szereg czasowy voice', async () => {
        vi.mocked(getVoiceTimeSeries).mockResolvedValue([
            { date: START, voiceMinutes: 60 },
        ]);
        await withServer(async (base) => {
            const { status, body } = await getJson(`${base}/api/stats/voice/timeseries?${DATE_PARAMS}`);
            expect(status).toBe(200);
            expect((body as Record<string, unknown>).timeSeries).toHaveLength(1);
        });
    });
});

// ─── /api/stats/voice/top-users ───────────────────────────────────────────────

describe('GET /api/stats/voice/top-users', () => {
    it('zwraca topUsers z voiceMinutes', async () => {
        vi.mocked(getTopVoiceUsers).mockResolvedValue([
            { userId: 'u-2', messages: 0, voiceMinutes: 300, score: 300 },
        ]);
        await withServer(async (base) => {
            const { status, body } = await getJson(`${base}/api/stats/voice/top-users?${DATE_PARAMS}`);
            expect(status).toBe(200);
            const users = (body as Record<string, unknown>).topUsers as Array<Record<string, unknown>>;
            expect(users[0].voiceMinutes).toBe(300);
        });
    });
});

// ─── /api/stats/voice/top-channels ────────────────────────────────────────────

describe('GET /api/stats/voice/top-channels', () => {
    it('zwraca kanały voice z nazwami', async () => {
        vi.mocked(getTopVoiceChannels).mockResolvedValue([
            { channelId: 'vc-1', messages: 0, voiceMinutes: 45 },
        ]);
        await withServer(async (base) => {
            const { status, body } = await getJson(`${base}/api/stats/voice/top-channels?${DATE_PARAMS}`);
            expect(status).toBe(200);
            const channels = (body as Record<string, unknown>).topChannels as Array<Record<string, unknown>>;
            expect(channels[0].channelName).toBe('Voice 1');
            expect(channels[0].voiceMinutes).toBe(45);
        });
    });
});

// ─── /api/stats/members/summary ───────────────────────────────────────────────

describe('GET /api/stats/members/summary', () => {
    it('zwraca summary członków', async () => {
        vi.mocked(getMemberSummary).mockResolvedValue({
            totalJoins: 10,
            totalLeaves: 2,
            latestMemberCount: 150,
        });
        await withServer(async (base) => {
            const { status, body } = await getJson(`${base}/api/stats/members/summary?${DATE_PARAMS}`);
            expect(status).toBe(200);
            expect((body as Record<string, unknown>).summary).toEqual({
                totalJoins: 10,
                totalLeaves: 2,
                latestMemberCount: 150,
            });
        });
    });
});

// ─── /api/stats/members/timeseries ────────────────────────────────────────────

describe('GET /api/stats/members/timeseries', () => {
    it('zwraca szereg czasowy członków', async () => {
        vi.mocked(getMemberTimeSeries).mockResolvedValue([
            { date: START, memberCount: 100, joins: 2, leaves: 0 },
        ]);
        await withServer(async (base) => {
            const { status, body } = await getJson(`${base}/api/stats/members/timeseries?${DATE_PARAMS}`);
            expect(status).toBe(200);
            expect((body as Record<string, unknown>).timeSeries).toHaveLength(1);
        });
    });
});

// ─── /api/stats/members/active-users ──────────────────────────────────────────

describe('GET /api/stats/members/active-users', () => {
    it('zwraca aktywnych użytkowników z profilami', async () => {
        vi.mocked(getActiveUsersInPeriod).mockResolvedValue([
            { userId: 'u-3', messages: 5, voiceMinutes: 30, score: 35 },
        ]);
        await withServer(async (base) => {
            const { status, body } = await getJson(`${base}/api/stats/members/active-users?${DATE_PARAMS}`);
            expect(status).toBe(200);
            const users = (body as Record<string, unknown>).activeUsers as Array<Record<string, unknown>>;
            expect(users[0].userId).toBe('u-3');
        });
    });
});

// ─── /api/stats/export/messages ───────────────────────────────────────────────

describe('GET /api/stats/export/messages', () => {
    it('zwraca plik CSV z nagłówkami', async () => {
        vi.mocked(getAllUserStatsForExport).mockResolvedValue([
            { date: START, userId: 'u-1', messages: 5, voiceMinutes: 0 },
        ]);
        await withServer(async (base) => {
            const res = await fetch(`${base}/api/stats/export/messages?${DATE_PARAMS}`);
            expect(res.status).toBe(200);
            const ct = res.headers.get('content-type') ?? '';
            expect(ct).toContain('text/csv');
            const text = await res.text();
            expect(text).toContain('date');
            expect(text).toContain('user_id');
            expect(text).toContain(START);
        });
    });

    it('zwraca 500 gdy stats-store rzuca błąd', async () => {
        vi.mocked(getAllUserStatsForExport).mockRejectedValue(new Error('db down'));
        await withServer(async (base) => {
            const res = await fetch(`${base}/api/stats/export/messages?${DATE_PARAMS}`);
            expect(res.status).toBe(500);
        });
    });
});

// ─── /api/stats/export/voice ──────────────────────────────────────────────────

describe('GET /api/stats/export/voice', () => {
    it('zwraca plik CSV z danymi voice', async () => {
        vi.mocked(getAllUserStatsForExport).mockResolvedValue([
            { date: START, userId: 'u-1', messages: 0, voiceMinutes: 30 },
        ]);
        await withServer(async (base) => {
            const res = await fetch(`${base}/api/stats/export/voice?${DATE_PARAMS}`);
            expect(res.status).toBe(200);
            const ct = res.headers.get('content-type') ?? '';
            expect(ct).toContain('text/csv');
            const text = await res.text();
            expect(text).toContain('voice_minutes');
        });
    });
});

// ─── /api/stats/export/members ────────────────────────────────────────────────

describe('GET /api/stats/export/members', () => {
    it('zwraca plik CSV z danymi członków', async () => {
        vi.mocked(getAllMemberCountsForExport).mockResolvedValue([
            { date: START, memberCount: 100, joins: 2, leaves: 1 },
        ]);
        await withServer(async (base) => {
            const res = await fetch(`${base}/api/stats/export/members?${DATE_PARAMS}`);
            expect(res.status).toBe(200);
            const ct = res.headers.get('content-type') ?? '';
            expect(ct).toContain('text/csv');
            const text = await res.text();
            expect(text).toContain('member_count');
        });
    });
});

// ─── /api/stats/export/all ────────────────────────────────────────────────────

describe('GET /api/stats/export/all', () => {
    it('zwraca archiwum ZIP', async () => {
        vi.mocked(getAllUserStatsForExport).mockResolvedValue([]);
        vi.mocked(getAllChannelStatsForExport).mockResolvedValue([]);
        vi.mocked(getAllMemberCountsForExport).mockResolvedValue([]);
        await withServer(async (base) => {
            const res = await fetch(`${base}/api/stats/export/all`);
            expect(res.status).toBe(200);
            const ct = res.headers.get('content-type') ?? '';
            expect(ct).toContain('zip');
        });
    });

    it('zwraca 500 gdy export rzuca błąd', async () => {
        vi.mocked(getAllUserStatsForExport).mockRejectedValue(new Error('fail'));
        await withServer(async (base) => {
            const res = await fetch(`${base}/api/stats/export/all`);
            expect(res.status).toBe(500);
        });
    });
});

// ─── Uwspólniona ochrona: brak GUILD_ID ───────────────────────────────────────

describe('brak GUILD_ID — wszystkie stats endpoints zwracają 500', () => {
    beforeEach(() => {
        delete process.env.GUILD_ID;
    });

    it('/api/stats/messages/summary → 500', async () => {
        await withServer(async (base) => {
            const { status } = await getJson(`${base}/api/stats/messages/summary?${DATE_PARAMS}`);
            expect(status).toBe(500);
        });
    });

    it('/api/stats/voice/summary → 500', async () => {
        await withServer(async (base) => {
            const { status } = await getJson(`${base}/api/stats/voice/summary?${DATE_PARAMS}`);
            expect(status).toBe(500);
        });
    });

    it('/api/stats/members/summary → 500', async () => {
        await withServer(async (base) => {
            const { status } = await getJson(`${base}/api/stats/members/summary?${DATE_PARAMS}`);
            expect(status).toBe(500);
        });
    });
});
