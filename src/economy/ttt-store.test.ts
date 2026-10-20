import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetEconomyDatabaseForTests } from './database.js';
import { getTttPlayerStats, getTttRanking, recordTttMatch } from './ttt-store.js';

const GUILD = 'guild-a';

async function withTempDb(testFn: () => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'husaria-ttt-test-'));
    const previous = process.env.ECONOMY_DB_PATH;
    process.env.ECONOMY_DB_PATH = join(dir, 'economy.sqlite');
    await resetEconomyDatabaseForTests();

    try {
        await testFn();
    } finally {
        await resetEconomyDatabaseForTests();
        if (typeof previous === 'string') {
            process.env.ECONOMY_DB_PATH = previous;
        } else {
            delete process.env.ECONOMY_DB_PATH;
        }
        await rm(dir, { recursive: true, force: true });
    }
}

describe('ttt-store', () => {
    it('zapisuje wygrana i porazke', () =>
        withTempDb(async () => {
            await recordTttMatch(GUILD, 'u1', 'u2', 'first');

            expect(await getTttPlayerStats(GUILD, 'u1')).toMatchObject({ wins: 1, losses: 0, draws: 0 });
            expect(await getTttPlayerStats(GUILD, 'u2')).toMatchObject({ wins: 0, losses: 1, draws: 0 });
        }));

    it('wynik "second" nagradza drugiego gracza', () =>
        withTempDb(async () => {
            await recordTttMatch(GUILD, 'u1', 'u2', 'second');

            expect(await getTttPlayerStats(GUILD, 'u2')).toMatchObject({ wins: 1, losses: 0 });
            expect(await getTttPlayerStats(GUILD, 'u1')).toMatchObject({ wins: 0, losses: 1 });
        }));

    it('remis liczy sie obu graczom', () =>
        withTempDb(async () => {
            await recordTttMatch(GUILD, 'u1', 'u2', 'draw');

            expect(await getTttPlayerStats(GUILD, 'u1')).toMatchObject({ draws: 1, games: 1 });
            expect(await getTttPlayerStats(GUILD, 'u2')).toMatchObject({ draws: 1, games: 1 });
        }));

    it('zwraca null dla gracza bez gier', () =>
        withTempDb(async () => {
            expect(await getTttPlayerStats(GUILD, 'nobody')).toBeNull();
        }));

    it('ranking sortuje po wygranych, potem po win rate', () =>
        withTempDb(async () => {
            await recordTttMatch(GUILD, 'a', 'b', 'first');
            await recordTttMatch(GUILD, 'a', 'b', 'first');
            await recordTttMatch(GUILD, 'c', 'b', 'first');
            await recordTttMatch(GUILD, 'c', 'd', 'draw');
            await recordTttMatch(GUILD, 'c', 'a', 'second');

            const ranking = await getTttRanking(GUILD, 10);

            expect(ranking.map((entry) => entry.userId)).toEqual(['a', 'c', 'd', 'b']);
            expect(ranking[0]).toMatchObject({ wins: 3, losses: 0, winRate: 100 });
        }));

    it('izoluje serwery i respektuje limit', () =>
        withTempDb(async () => {
            await recordTttMatch(GUILD, 'a', 'b', 'first');
            await recordTttMatch('guild-b', 'x', 'y', 'first');

            expect(await getTttRanking('guild-b', 10)).toHaveLength(2);
            expect(await getTttRanking(GUILD, 1)).toHaveLength(1);
        }));
});
