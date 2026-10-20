import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetEconomyDatabaseForTests } from './database.js';
import { getPknPlayerStats, getPknRanking, recordPknMatch } from './pkn-store.js';

const GUILD = 'guild-a';

async function withTempDb(testFn: () => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'husaria-pkn-test-'));
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

describe('pkn-store', () => {
    it('zapisuje wygrana i porazke', () =>
        withTempDb(async () => {
            await recordPknMatch(GUILD, 'u1', 'u2', 'first');

            expect(await getPknPlayerStats(GUILD, 'u1')).toMatchObject({ wins: 1, losses: 0, draws: 0 });
            expect(await getPknPlayerStats(GUILD, 'u2')).toMatchObject({ wins: 0, losses: 1, draws: 0 });
        }));

    it('wynik "second" nagradza drugiego gracza', () =>
        withTempDb(async () => {
            await recordPknMatch(GUILD, 'u1', 'u2', 'second');

            expect(await getPknPlayerStats(GUILD, 'u2')).toMatchObject({ wins: 1, losses: 0 });
            expect(await getPknPlayerStats(GUILD, 'u1')).toMatchObject({ wins: 0, losses: 1 });
        }));

    it('remis liczy sie obu graczom', () =>
        withTempDb(async () => {
            await recordPknMatch(GUILD, 'u1', 'u2', 'draw');

            expect(await getPknPlayerStats(GUILD, 'u1')).toMatchObject({ draws: 1, games: 1 });
            expect(await getPknPlayerStats(GUILD, 'u2')).toMatchObject({ draws: 1, games: 1 });
        }));

    it('zwraca null dla gracza bez gier', () =>
        withTempDb(async () => {
            expect(await getPknPlayerStats(GUILD, 'nobody')).toBeNull();
        }));

    it('ranking sortuje po wygranych, potem po win rate', () =>
        withTempDb(async () => {
            await recordPknMatch(GUILD, 'a', 'b', 'first');
            await recordPknMatch(GUILD, 'a', 'b', 'first');
            await recordPknMatch(GUILD, 'c', 'b', 'first');
            await recordPknMatch(GUILD, 'c', 'd', 'draw');
            await recordPknMatch(GUILD, 'c', 'a', 'second');

            const ranking = await getPknRanking(GUILD, 10);

            expect(ranking.map((entry) => entry.userId)).toEqual(['a', 'c', 'd', 'b']);
            expect(ranking[0]).toMatchObject({ wins: 3, losses: 0, winRate: 100 });
        }));

    it('izoluje serwery i respektuje limit', () =>
        withTempDb(async () => {
            await recordPknMatch(GUILD, 'a', 'b', 'first');
            await recordPknMatch('guild-b', 'x', 'y', 'first');

            expect(await getPknRanking('guild-b', 10)).toHaveLength(2);
            expect(await getPknRanking(GUILD, 1)).toHaveLength(1);
        }));
});
