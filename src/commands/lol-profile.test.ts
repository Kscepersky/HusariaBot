import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLolProfile, clearLolProfileCache, queueLabel } from './lol-profile.js';
import type { ChampionCatalog } from './champion-data.js';
import { RiotApiError, type RiotClient } from './riot-api.js';

const CATALOG: ChampionCatalog = {
    version: '16.1.1',
    champions: [
        { id: 'Viego', key: '234', name: 'Viego', title: 'Krol', blurb: '', tags: [] },
        { id: 'Ahri', key: '103', name: 'Ahri', title: 'Lisica', blurb: '', tags: [] },
    ],
};

function participant(overrides: Record<string, unknown> = {}) {
    return {
        puuid: 'p1', championId: 234, kills: 5, deaths: 2, assists: 9, win: true,
        totalMinionsKilled: 150, neutralMinionsKilled: 30, gameEndedInEarlySurrender: false,
        ...overrides,
    };
}

function buildClient(overrides: Partial<Record<keyof RiotClient, unknown>> = {}) {
    return {
        getAccount: vi.fn(async () => ({ puuid: 'p1', gameName: 'Nick', tagLine: 'EUNE' })),
        getSummoner: vi.fn(async () => ({ profileIconId: 12, summonerLevel: 321 })),
        getRankedEntries: vi.fn(async () => [
            { queueType: 'RANKED_FLEX_SR', tier: 'SILVER', rank: 'I', leaguePoints: 1, wins: 1, losses: 1 },
            { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'II', leaguePoints: 54, wins: 10, losses: 8 },
        ]),
        getTopMastery: vi.fn(async () => [
            { championId: 234, championLevel: 7, championPoints: 100000 },
            { championId: 9999, championLevel: 5, championPoints: 5 },
        ]),
        getMatchIds: vi.fn(async () => ['M1', 'M2']),
        getMatch: vi.fn(async (_routing: string, id: string) => ({
            info: { queueId: 420, gameDuration: 1800, participants: [participant(id === 'M2' ? { championId: 103, win: false } : {}), participant({ puuid: 'other' })] },
        })),
        ...overrides,
    } as unknown as RiotClient & Record<string, ReturnType<typeof vi.fn>>;
}

beforeEach(() => {
    clearLolProfileCache();
});

describe('buildLolProfile', () => {
    it('sklada profil z rangi solo, mainow i meczow', async () => {
        const profile = await buildLolProfile(buildClient(), CATALOG, { gameName: 'Nick', tagLine: 'EUNE' }, 'eune');

        expect(profile.level).toBe(321);
        expect(profile.profileIconUrl).toContain('/16.1.1/img/profileicon/12.png');
        expect(profile.rank).toMatchObject({ tier: 'GOLD', division: 'II', lp: 54, wins: 10, losses: 8 });
        expect(profile.mains).toHaveLength(1);
        expect(profile.mains[0]).toMatchObject({ name: 'Viego', level: 7, points: 100000 });
        expect(profile.matches.map((match) => match.championName)).toEqual(['Viego', 'Ahri']);
        expect(profile.matches[0]).toMatchObject({ win: true, kills: 5, deaths: 2, assists: 9, cs: 180, durationSec: 1800, queueLabel: 'Solo/Duo' });
        expect(profile.matches[1]!.win).toBe(false);
    });

    it('zwraca rank null dla gracza bez rangi solo', async () => {
        const client = buildClient({ getRankedEntries: vi.fn(async () => []) });

        const profile = await buildLolProfile(client, CATALOG, { gameName: 'Nick', tagLine: 'EUNE' }, 'eune');

        expect(profile.rank).toBeNull();
    });

    it('pomija mecze, ktore sie nie pobraly', async () => {
        const client = buildClient({
            getMatch: vi.fn(async (_routing: string, id: string) => {
                if (id === 'M1') {
                    throw new RiotApiError(500, 'boom');
                }
                return { info: { queueId: 450, gameDuration: 900, participants: [participant()] } };
            }),
        });

        const profile = await buildLolProfile(client, CATALOG, { gameName: 'Nick', tagLine: 'EUNE' }, 'eune');

        expect(profile.matches).toHaveLength(1);
        expect(profile.matches[0]!.queueLabel).toBe('ARAM');
    });

    it('cache\'uje profil, a bledy konta propaguje', async () => {
        const client = buildClient();
        const riotId = { gameName: 'Nick', tagLine: 'EUNE' };

        await buildLolProfile(client, CATALOG, riotId, 'eune');
        await buildLolProfile(client, CATALOG, riotId, 'eune');
        expect(client.getAccount).toHaveBeenCalledTimes(1);

        const failing = buildClient({ getAccount: vi.fn(async () => { throw new RiotApiError(404, 'nope'); }) });
        await expect(buildLolProfile(failing, CATALOG, { gameName: 'Inny', tagLine: 'X' }, 'eune')).rejects.toMatchObject({ status: 404 });
    });
});

describe('queueLabel', () => {
    it('zna popularne kolejki i ma fallback', () => {
        expect(queueLabel(420)).toBe('Solo/Duo');
        expect(queueLabel(440)).toBe('Flex');
        expect(queueLabel(1700)).toBe('Arena');
        expect(queueLabel(99999)).toBe('Inny tryb');
    });
});
