import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetEconomyDatabaseForTests } from './database.js';
import {
    getStatsExcludedChannelIds,
    setStatsExcludedChannelIds,
    incrementChannelMessageStats,
    incrementChannelVoiceStats,
    recordMemberJoin,
    recordMemberLeave,
    recordMemberSnapshot,
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
} from './stats-store.js';
import { getEconomyDatabase } from './database.js';

const GUILD = 'guild-test';
const GUILD_B = 'guild-other';

// 2024-03-10 = Sunday, used as a stable date anchor
const D1 = '2024-03-10';
const D2 = '2024-03-11';
const D3 = '2024-03-12';

const TS_D1 = new Date(`${D1}T12:00:00Z`).getTime();
const TS_D2 = new Date(`${D2}T12:00:00Z`).getTime();
const TS_D3 = new Date(`${D3}T12:00:00Z`).getTime();

async function withTempDb(testFn: () => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'husaria-stats-test-'));
    const dbPath = join(dir, 'economy.sqlite');
    const prev = process.env.ECONOMY_DB_PATH;
    process.env.ECONOMY_DB_PATH = dbPath;
    await resetEconomyDatabaseForTests();

    try {
        await testFn();
    } finally {
        await resetEconomyDatabaseForTests();
        if (typeof prev === 'string') {
            process.env.ECONOMY_DB_PATH = prev;
        } else {
            delete process.env.ECONOMY_DB_PATH;
        }
        await rm(dir, { recursive: true, force: true });
    }
}

async function seedUserStats(rows: Array<{
    guildId: string;
    userId: string;
    date: string;
    messages: number;
    voiceMinutes: number;
}>): Promise<void> {
    const db = await getEconomyDatabase();
    for (const row of rows) {
        await db.run(
            `INSERT INTO daily_user_stats (guild_id, user_id, date, messages, voice_minutes)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (guild_id, user_id, date) DO UPDATE SET
                 messages = messages + ?,
                 voice_minutes = voice_minutes + ?`,
            row.guildId, row.userId, row.date,
            row.messages, row.voiceMinutes,
            row.messages, row.voiceMinutes,
        );
    }
}

afterEach(async () => {
    await resetEconomyDatabaseForTests();
});

// ─── Excluded channels ─────────────────────────────────────────────────────────

describe('getStatsExcludedChannelIds / setStatsExcludedChannelIds', () => {
    it('zwraca pustą tablicę gdy brak konfiguracji', async () => {
        await withTempDb(async () => {
            const ids = await getStatsExcludedChannelIds();
            expect(ids).toEqual([]);
        });
    });

    it('zapisuje i odczytuje listę ID kanałów', async () => {
        await withTempDb(async () => {
            await setStatsExcludedChannelIds(['ch-1', 'ch-2', 'ch-3']);
            const ids = await getStatsExcludedChannelIds();
            expect(ids).toEqual(['ch-1', 'ch-2', 'ch-3']);
        });
    });

    it('nadpisuje poprzednią listę przy kolejnym zapisie', async () => {
        await withTempDb(async () => {
            await setStatsExcludedChannelIds(['ch-1', 'ch-2']);
            await setStatsExcludedChannelIds(['ch-99']);
            const ids = await getStatsExcludedChannelIds();
            expect(ids).toEqual(['ch-99']);
        });
    });

    it('zapisuje pustą tablicę', async () => {
        await withTempDb(async () => {
            await setStatsExcludedChannelIds(['ch-1']);
            await setStatsExcludedChannelIds([]);
            const ids = await getStatsExcludedChannelIds();
            expect(ids).toEqual([]);
        });
    });
});

// ─── Channel message stats ─────────────────────────────────────────────────────

describe('incrementChannelMessageStats', () => {
    it('tworzy nowy rekord z messages=1 przy pierwszym wywołaniu', async () => {
        await withTempDb(async () => {
            await incrementChannelMessageStats(GUILD, 'ch-1', TS_D1);
            const channels = await getTopMessageChannels(GUILD, D1, D1, 10);
            expect(channels).toHaveLength(1);
            expect(channels[0].channelId).toBe('ch-1');
            expect(channels[0].messages).toBe(1);
        });
    });

    it('sumuje wiadomości przy wielokrotnych wywołaniach tego samego dnia', async () => {
        await withTempDb(async () => {
            await incrementChannelMessageStats(GUILD, 'ch-1', TS_D1);
            await incrementChannelMessageStats(GUILD, 'ch-1', TS_D1);
            await incrementChannelMessageStats(GUILD, 'ch-1', TS_D1);
            const channels = await getTopMessageChannels(GUILD, D1, D1, 10);
            expect(channels[0].messages).toBe(3);
        });
    });

    it('nie miesza danych różnych gildii', async () => {
        await withTempDb(async () => {
            await incrementChannelMessageStats(GUILD, 'ch-1', TS_D1);
            await incrementChannelMessageStats(GUILD_B, 'ch-1', TS_D1);
            const channels = await getTopMessageChannels(GUILD, D1, D1, 10);
            expect(channels[0].messages).toBe(1);
        });
    });
});

// ─── Channel voice stats ───────────────────────────────────────────────────────

describe('incrementChannelVoiceStats', () => {
    it('tworzy rekord z podaną liczbą minut', async () => {
        await withTempDb(async () => {
            await incrementChannelVoiceStats(GUILD, 'vc-1', 30, TS_D1);
            const channels = await getTopVoiceChannels(GUILD, D1, D1, 10);
            expect(channels).toHaveLength(1);
            expect(channels[0].channelId).toBe('vc-1');
            expect(channels[0].voiceMinutes).toBe(30);
        });
    });

    it('sumuje minuty przy kolejnych wywołaniach', async () => {
        await withTempDb(async () => {
            await incrementChannelVoiceStats(GUILD, 'vc-1', 20, TS_D1);
            await incrementChannelVoiceStats(GUILD, 'vc-1', 15, TS_D1);
            const channels = await getTopVoiceChannels(GUILD, D1, D1, 10);
            expect(channels[0].voiceMinutes).toBe(35);
        });
    });

    it('zamienia minuty < 1 na 1 (safeMinutes)', async () => {
        await withTempDb(async () => {
            await incrementChannelVoiceStats(GUILD, 'vc-1', 0, TS_D1);
            const channels = await getTopVoiceChannels(GUILD, D1, D1, 10);
            expect(channels[0].voiceMinutes).toBe(1);
        });
    });
});

// ─── Member recording ──────────────────────────────────────────────────────────

describe('recordMemberJoin / recordMemberLeave / recordMemberSnapshot', () => {
    it('recordMemberJoin zlicza dołączenia', async () => {
        await withTempDb(async () => {
            await recordMemberJoin(GUILD, 100, TS_D1);
            await recordMemberJoin(GUILD, 101, TS_D1);
            const summary = await getMemberSummary(GUILD, D1, D1);
            expect(summary.totalJoins).toBe(2);
            expect(summary.totalLeaves).toBe(0);
        });
    });

    it('recordMemberLeave zlicza odejścia', async () => {
        await withTempDb(async () => {
            await recordMemberLeave(GUILD, 99, TS_D1);
            const summary = await getMemberSummary(GUILD, D1, D1);
            expect(summary.totalLeaves).toBe(1);
            expect(summary.totalJoins).toBe(0);
        });
    });

    it('recordMemberSnapshot ustawia member_count bez zmiany joins/leaves', async () => {
        await withTempDb(async () => {
            await recordMemberJoin(GUILD, 50, TS_D1);
            await recordMemberSnapshot(GUILD, 55, TS_D1);
            const summary = await getMemberSummary(GUILD, D1, D1);
            expect(summary.latestMemberCount).toBe(55);
            expect(summary.totalJoins).toBe(1);
        });
    });

    it('aktualizuje member_count przy kolejnym snapshot tego samego dnia', async () => {
        await withTempDb(async () => {
            await recordMemberSnapshot(GUILD, 100, TS_D1);
            await recordMemberSnapshot(GUILD, 105, TS_D1);
            const summary = await getMemberSummary(GUILD, D1, D1);
            expect(summary.latestMemberCount).toBe(105);
        });
    });
});

// ─── getMessageSummary ─────────────────────────────────────────────────────────

describe('getMessageSummary', () => {
    it('zwraca zera gdy brak danych', async () => {
        await withTempDb(async () => {
            const result = await getMessageSummary(GUILD, D1, D3);
            expect(result).toEqual({ messages: 0, uniqueUsers: 0 });
        });
    });

    it('sumuje wiadomości i liczy unikalnych użytkowników w zakresie dat', async () => {
        await withTempDb(async () => {
            await seedUserStats([
                { guildId: GUILD, userId: 'u1', date: D1, messages: 5, voiceMinutes: 0 },
                { guildId: GUILD, userId: 'u2', date: D1, messages: 3, voiceMinutes: 0 },
                { guildId: GUILD, userId: 'u1', date: D2, messages: 2, voiceMinutes: 0 },
                // poza zakresem
                { guildId: GUILD, userId: 'u3', date: D3, messages: 10, voiceMinutes: 0 },
            ]);
            const result = await getMessageSummary(GUILD, D1, D2);
            expect(result.messages).toBe(10);
            expect(result.uniqueUsers).toBe(2);
        });
    });

    it('nie liczy użytkowników z messages=0', async () => {
        await withTempDb(async () => {
            await seedUserStats([
                { guildId: GUILD, userId: 'u1', date: D1, messages: 0, voiceMinutes: 60 },
                { guildId: GUILD, userId: 'u2', date: D1, messages: 5, voiceMinutes: 0 },
            ]);
            const result = await getMessageSummary(GUILD, D1, D1);
            expect(result.messages).toBe(5);
            expect(result.uniqueUsers).toBe(1);
        });
    });

    it('izoluje dane gildii', async () => {
        await withTempDb(async () => {
            await seedUserStats([
                { guildId: GUILD, userId: 'u1', date: D1, messages: 4, voiceMinutes: 0 },
                { guildId: GUILD_B, userId: 'u1', date: D1, messages: 100, voiceMinutes: 0 },
            ]);
            const result = await getMessageSummary(GUILD, D1, D1);
            expect(result.messages).toBe(4);
        });
    });
});

// ─── getMessageTimeSeries ──────────────────────────────────────────────────────

describe('getMessageTimeSeries', () => {
    it('wypełnia brakujące daty zerami', async () => {
        await withTempDb(async () => {
            await seedUserStats([
                { guildId: GUILD, userId: 'u1', date: D1, messages: 5, voiceMinutes: 0 },
                { guildId: GUILD, userId: 'u1', date: D3, messages: 3, voiceMinutes: 0 },
            ]);
            const ts = await getMessageTimeSeries(GUILD, D1, D3);
            expect(ts).toHaveLength(3);
            expect(ts[0]).toEqual({ date: D1, messages: 5 });
            expect(ts[1]).toEqual({ date: D2, messages: 0 });
            expect(ts[2]).toEqual({ date: D3, messages: 3 });
        });
    });

    it('zwraca tablicę jednego elementu dla zakresu jednodniowego', async () => {
        await withTempDb(async () => {
            await seedUserStats([
                { guildId: GUILD, userId: 'u1', date: D1, messages: 7, voiceMinutes: 0 },
            ]);
            const ts = await getMessageTimeSeries(GUILD, D1, D1);
            expect(ts).toHaveLength(1);
            expect(ts[0].messages).toBe(7);
        });
    });
});

// ─── getTopMessageUsers ────────────────────────────────────────────────────────

describe('getTopMessageUsers', () => {
    it('zwraca użytkowników posortowanych malejąco po liczbie wiadomości', async () => {
        await withTempDb(async () => {
            await seedUserStats([
                { guildId: GUILD, userId: 'u1', date: D1, messages: 3, voiceMinutes: 0 },
                { guildId: GUILD, userId: 'u2', date: D1, messages: 10, voiceMinutes: 0 },
                { guildId: GUILD, userId: 'u3', date: D1, messages: 7, voiceMinutes: 0 },
            ]);
            const users = await getTopMessageUsers(GUILD, D1, D1, 10);
            expect(users[0].userId).toBe('u2');
            expect(users[0].messages).toBe(10);
            expect(users[1].userId).toBe('u3');
            expect(users[2].userId).toBe('u1');
        });
    });

    it('respektuje limit', async () => {
        await withTempDb(async () => {
            await seedUserStats([
                { guildId: GUILD, userId: 'u1', date: D1, messages: 5, voiceMinutes: 0 },
                { guildId: GUILD, userId: 'u2', date: D1, messages: 4, voiceMinutes: 0 },
                { guildId: GUILD, userId: 'u3', date: D1, messages: 3, voiceMinutes: 0 },
            ]);
            const users = await getTopMessageUsers(GUILD, D1, D1, 2);
            expect(users).toHaveLength(2);
        });
    });

    it('sumuje wiadomości z wielu dni dla jednego użytkownika', async () => {
        await withTempDb(async () => {
            await seedUserStats([
                { guildId: GUILD, userId: 'u1', date: D1, messages: 4, voiceMinutes: 0 },
                { guildId: GUILD, userId: 'u1', date: D2, messages: 6, voiceMinutes: 0 },
            ]);
            const users = await getTopMessageUsers(GUILD, D1, D2, 10);
            expect(users[0].userId).toBe('u1');
            expect(users[0].messages).toBe(10);
        });
    });
});

// ─── getTopMessageChannels ─────────────────────────────────────────────────────

describe('getTopMessageChannels', () => {
    it('zwraca kanały posortowane malejąco po wiadomościach', async () => {
        await withTempDb(async () => {
            await incrementChannelMessageStats(GUILD, 'ch-a', TS_D1);
            await incrementChannelMessageStats(GUILD, 'ch-b', TS_D1);
            await incrementChannelMessageStats(GUILD, 'ch-b', TS_D1);
            const channels = await getTopMessageChannels(GUILD, D1, D1, 10);
            expect(channels[0].channelId).toBe('ch-b');
            expect(channels[0].messages).toBe(2);
            expect(channels[1].channelId).toBe('ch-a');
            expect(channels[1].messages).toBe(1);
        });
    });

    it('respektuje limit', async () => {
        await withTempDb(async () => {
            await incrementChannelMessageStats(GUILD, 'ch-1', TS_D1);
            await incrementChannelMessageStats(GUILD, 'ch-2', TS_D1);
            await incrementChannelMessageStats(GUILD, 'ch-3', TS_D1);
            const channels = await getTopMessageChannels(GUILD, D1, D1, 2);
            expect(channels).toHaveLength(2);
        });
    });
});

// ─── getVoiceSummary ───────────────────────────────────────────────────────────

describe('getVoiceSummary', () => {
    it('zwraca zera gdy brak danych', async () => {
        await withTempDb(async () => {
            const result = await getVoiceSummary(GUILD, D1, D3);
            expect(result).toEqual({ voiceMinutes: 0, voiceHours: 0, uniqueUsers: 0 });
        });
    });

    it('oblicza voiceHours jako podłogę z voiceMinutes / 60', async () => {
        await withTempDb(async () => {
            await seedUserStats([
                { guildId: GUILD, userId: 'u1', date: D1, messages: 0, voiceMinutes: 130 },
            ]);
            const result = await getVoiceSummary(GUILD, D1, D1);
            expect(result.voiceMinutes).toBe(130);
            expect(result.voiceHours).toBe(2);
        });
    });

    it('liczy unikalnych użytkowników tylko gdy voice_minutes > 0', async () => {
        await withTempDb(async () => {
            await seedUserStats([
                { guildId: GUILD, userId: 'u1', date: D1, messages: 5, voiceMinutes: 0 },
                { guildId: GUILD, userId: 'u2', date: D1, messages: 0, voiceMinutes: 20 },
            ]);
            const result = await getVoiceSummary(GUILD, D1, D1);
            expect(result.uniqueUsers).toBe(1);
        });
    });
});

// ─── getVoiceTimeSeries ────────────────────────────────────────────────────────

describe('getVoiceTimeSeries', () => {
    it('wypełnia brakujące daty zerami', async () => {
        await withTempDb(async () => {
            await seedUserStats([
                { guildId: GUILD, userId: 'u1', date: D1, messages: 0, voiceMinutes: 60 },
                { guildId: GUILD, userId: 'u1', date: D3, messages: 0, voiceMinutes: 30 },
            ]);
            const ts = await getVoiceTimeSeries(GUILD, D1, D3);
            expect(ts).toHaveLength(3);
            expect(ts[0]).toEqual({ date: D1, voiceMinutes: 60 });
            expect(ts[1]).toEqual({ date: D2, voiceMinutes: 0 });
            expect(ts[2]).toEqual({ date: D3, voiceMinutes: 30 });
        });
    });
});

// ─── getTopVoiceUsers ──────────────────────────────────────────────────────────

describe('getTopVoiceUsers', () => {
    it('zwraca użytkowników posortowanych malejąco po minutach voice', async () => {
        await withTempDb(async () => {
            await seedUserStats([
                { guildId: GUILD, userId: 'u1', date: D1, messages: 0, voiceMinutes: 10 },
                { guildId: GUILD, userId: 'u2', date: D1, messages: 0, voiceMinutes: 90 },
            ]);
            const users = await getTopVoiceUsers(GUILD, D1, D1, 10);
            expect(users[0].userId).toBe('u2');
            expect(users[0].voiceMinutes).toBe(90);
        });
    });
});

// ─── getTopVoiceChannels ───────────────────────────────────────────────────────

describe('getTopVoiceChannels', () => {
    it('zwraca kanały posortowane malejąco po minutach voice', async () => {
        await withTempDb(async () => {
            await incrementChannelVoiceStats(GUILD, 'vc-a', 15, TS_D1);
            await incrementChannelVoiceStats(GUILD, 'vc-b', 45, TS_D1);
            const channels = await getTopVoiceChannels(GUILD, D1, D1, 10);
            expect(channels[0].channelId).toBe('vc-b');
            expect(channels[0].voiceMinutes).toBe(45);
            expect(channels[1].channelId).toBe('vc-a');
        });
    });
});

// ─── getMemberTimeSeries ───────────────────────────────────────────────────────

describe('getMemberTimeSeries', () => {
    it('wypełnia brakujące daty zerami', async () => {
        await withTempDb(async () => {
            await recordMemberSnapshot(GUILD, 100, TS_D1);
            await recordMemberSnapshot(GUILD, 105, TS_D3);
            const ts = await getMemberTimeSeries(GUILD, D1, D3);
            expect(ts).toHaveLength(3);
            expect(ts[0]).toEqual({ date: D1, memberCount: 100, joins: 0, leaves: 0 });
            expect(ts[1]).toEqual({ date: D2, memberCount: 0, joins: 0, leaves: 0 });
            expect(ts[2]).toEqual({ date: D3, memberCount: 105, joins: 0, leaves: 0 });
        });
    });

    it('odzwierciedla joins i leaves w szeregu czasowym', async () => {
        await withTempDb(async () => {
            await recordMemberJoin(GUILD, 101, TS_D1);
            await recordMemberJoin(GUILD, 102, TS_D1);
            await recordMemberLeave(GUILD, 101, TS_D1);
            const ts = await getMemberTimeSeries(GUILD, D1, D1);
            expect(ts[0].joins).toBe(2);
            expect(ts[0].leaves).toBe(1);
        });
    });
});

// ─── getMemberSummary ──────────────────────────────────────────────────────────

describe('getMemberSummary', () => {
    it('zwraca zera gdy brak danych', async () => {
        await withTempDb(async () => {
            const result = await getMemberSummary(GUILD, D1, D3);
            expect(result).toEqual({ totalJoins: 0, totalLeaves: 0, latestMemberCount: 0 });
        });
    });

    it('sumuje joins i leaves z wielu dni', async () => {
        await withTempDb(async () => {
            await recordMemberJoin(GUILD, 100, TS_D1);
            await recordMemberJoin(GUILD, 101, TS_D2);
            await recordMemberLeave(GUILD, 100, TS_D2);
            const result = await getMemberSummary(GUILD, D1, D2);
            expect(result.totalJoins).toBe(2);
            expect(result.totalLeaves).toBe(1);
        });
    });

    it('latestMemberCount = MAX member_count w zakresie', async () => {
        await withTempDb(async () => {
            await recordMemberSnapshot(GUILD, 90, TS_D1);
            await recordMemberSnapshot(GUILD, 95, TS_D2);
            await recordMemberSnapshot(GUILD, 88, TS_D3);
            const result = await getMemberSummary(GUILD, D1, D3);
            expect(result.latestMemberCount).toBe(95);
        });
    });
});

// ─── getActiveUsersInPeriod ────────────────────────────────────────────────────

describe('getActiveUsersInPeriod', () => {
    it('zwraca użytkowników aktywnych (msg lub voice) posortowanych malejąco', async () => {
        await withTempDb(async () => {
            await seedUserStats([
                { guildId: GUILD, userId: 'u1', date: D1, messages: 10, voiceMinutes: 0 },
                { guildId: GUILD, userId: 'u2', date: D1, messages: 0, voiceMinutes: 20 },
                { guildId: GUILD, userId: 'u3', date: D1, messages: 5, voiceMinutes: 15 },
            ]);
            const users = await getActiveUsersInPeriod(GUILD, D1, D1);
            // u3 ma score 20, u1 ma 10, u2 ma 20 — u3 i u2 na szczycie
            expect(users.length).toBeGreaterThanOrEqual(2);
            const ids = users.map((u) => u.userId);
            expect(ids).toContain('u1');
            expect(ids).toContain('u2');
            expect(ids).toContain('u3');
        });
    });

    it('nie zwraca użytkowników z msg=0 i voice=0', async () => {
        await withTempDb(async () => {
            await seedUserStats([
                { guildId: GUILD, userId: 'u-inactive', date: D1, messages: 0, voiceMinutes: 0 },
                { guildId: GUILD, userId: 'u-active', date: D1, messages: 1, voiceMinutes: 0 },
            ]);
            const users = await getActiveUsersInPeriod(GUILD, D1, D1);
            const ids = users.map((u) => u.userId);
            expect(ids).not.toContain('u-inactive');
            expect(ids).toContain('u-active');
        });
    });

    it('ogranicza wyniki do 10', async () => {
        await withTempDb(async () => {
            for (let i = 0; i < 15; i++) {
                await seedUserStats([
                    { guildId: GUILD, userId: `u${i}`, date: D1, messages: 1, voiceMinutes: 0 },
                ]);
            }
            const users = await getActiveUsersInPeriod(GUILD, D1, D1);
            expect(users.length).toBe(10);
        });
    });
});

// ─── Export functions ──────────────────────────────────────────────────────────

describe('getAllUserStatsForExport', () => {
    it('zwraca wszystkie rekordy gildii posortowane datą malejąco', async () => {
        await withTempDb(async () => {
            await seedUserStats([
                { guildId: GUILD, userId: 'u1', date: D1, messages: 2, voiceMinutes: 10 },
                { guildId: GUILD, userId: 'u2', date: D2, messages: 3, voiceMinutes: 0 },
                { guildId: GUILD_B, userId: 'u1', date: D1, messages: 99, voiceMinutes: 99 },
            ]);
            const rows = await getAllUserStatsForExport(GUILD);
            expect(rows).toHaveLength(2);
            expect(rows.every((r) => typeof r.date === 'string')).toBe(true);
            expect(rows[0].date >= rows[rows.length - 1].date).toBe(true);
        });
    });
});

describe('getAllChannelStatsForExport', () => {
    it('zwraca kanały tylko danej gildii', async () => {
        await withTempDb(async () => {
            await incrementChannelMessageStats(GUILD, 'ch-1', TS_D1);
            await incrementChannelMessageStats(GUILD_B, 'ch-2', TS_D1);
            const rows = await getAllChannelStatsForExport(GUILD);
            expect(rows).toHaveLength(1);
            expect(rows[0].channelId).toBe('ch-1');
        });
    });
});

describe('getAllMemberCountsForExport', () => {
    it('zwraca rekordy tylko danej gildii', async () => {
        await withTempDb(async () => {
            await recordMemberSnapshot(GUILD, 100, TS_D1);
            await recordMemberSnapshot(GUILD_B, 200, TS_D1);
            const rows = await getAllMemberCountsForExport(GUILD);
            expect(rows).toHaveLength(1);
            expect(rows[0].memberCount).toBe(100);
        });
    });

    it('zawiera pola date, memberCount, joins, leaves', async () => {
        await withTempDb(async () => {
            await recordMemberJoin(GUILD, 50, TS_D1);
            await recordMemberLeave(GUILD, 49, TS_D1);
            const rows = await getAllMemberCountsForExport(GUILD);
            expect(rows[0]).toMatchObject({
                date: D1,
                joins: 1,
                leaves: 1,
            });
        });
    });
});
