import { describe, expect, it, vi } from 'vitest';
import { REGIONS, RiotApiError, createRiotClient, parseRiotId } from './riot-api.js';

function jsonResponse(body: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => body, headers: new Headers() } as Response;
}

function clientWith(fetchFn: ReturnType<typeof vi.fn>) {
    return createRiotClient({ apiKey: 'RGAPI-test', fetchFn: fetchFn as unknown as typeof fetch });
}

describe('parseRiotId', () => {
    it('rozdziela nick i tag', () => {
        expect(parseRiotId('Faker#KR1')).toEqual({ gameName: 'Faker', tagLine: 'KR1' });
    });

    it('obsluguje spacje w nicku i bierze ostatni #', () => {
        expect(parseRiotId('  Jakis Nick #EUNE ')).toEqual({ gameName: 'Jakis Nick', tagLine: 'EUNE' });
    });

    it('odrzuca niepoprawne wejscie', () => {
        expect(parseRiotId('bez-tagu')).toBeNull();
        expect(parseRiotId('#TAG')).toBeNull();
        expect(parseRiotId('Nick#')).toBeNull();
        expect(parseRiotId('Nick#za-dlugi-tag-na-pewno')).toBeNull();
    });
});

describe('createRiotClient', () => {
    it('wysyla klucz w naglowku i koduje nick w URL', async () => {
        const fetchFn = vi.fn(async () => jsonResponse({ puuid: 'p1', gameName: 'Jakis Nick', tagLine: 'EUNE' }));

        const account = await clientWith(fetchFn).getAccount(REGIONS.eune.routing, 'Jakis Nick', 'EUNE');

        expect(account.puuid).toBe('p1');
        const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/Jakis%20Nick/EUNE');
        expect((init.headers as Record<string, string>)['X-Riot-Token']).toBe('RGAPI-test');
    });

    it('uzywa hosta platformy dla summoner i league', async () => {
        const fetchFn = vi.fn(async (url: string) =>
            url.includes('summoner')
                ? jsonResponse({ profileIconId: 12, summonerLevel: 300 })
                : jsonResponse([{ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'II', leaguePoints: 54, wins: 10, losses: 8 }]));
        const client = clientWith(fetchFn);

        expect(await client.getSummoner('eun1', 'p1')).toEqual({ profileIconId: 12, summonerLevel: 300 });
        const entries = await client.getRankedEntries('eun1', 'p1');

        expect(entries[0]?.tier).toBe('GOLD');
        expect(String(fetchFn.mock.calls[0]![0])).toContain('https://eun1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/p1');
        expect(String(fetchFn.mock.calls[1]![0])).toContain('/lol/league/v4/entries/by-puuid/p1');
    });

    it('mapuje bledy HTTP na RiotApiError ze statusem', async () => {
        const fetchFn = vi.fn(async () => jsonResponse({}, 404));

        await expect(clientWith(fetchFn).getAccount('europe', 'X', 'Y')).rejects.toMatchObject({
            name: 'RiotApiError',
            status: 404,
        });
    });

    it('rzuca RiotApiError przy niepoprawnym ksztalcie odpowiedzi', async () => {
        const fetchFn = vi.fn(async () => jsonResponse({ nieoczekiwane: true }));

        await expect(clientWith(fetchFn).getAccount('europe', 'X', 'Y')).rejects.toBeInstanceOf(RiotApiError);
    });

    it('pobiera mastery, id meczow i szczegoly meczu', async () => {
        const fetchFn = vi.fn(async (url: string) => {
            if (url.includes('champion-mastery')) {
                return jsonResponse([{ championId: 234, championLevel: 7, championPoints: 123456 }]);
            }
            if (url.includes('/ids')) {
                return jsonResponse(['EUN1_1', 'EUN1_2']);
            }
            return jsonResponse({
                info: {
                    queueId: 420,
                    gameDuration: 1800,
                    participants: [{
                        puuid: 'p1', championId: 234, kills: 5, deaths: 2, assists: 9, win: true,
                        totalMinionsKilled: 150, neutralMinionsKilled: 20, gameEndedInEarlySurrender: false,
                    }],
                },
            });
        });
        const client = clientWith(fetchFn);

        expect((await client.getTopMastery('eun1', 'p1', 3))[0]?.championPoints).toBe(123456);
        expect(await client.getMatchIds('europe', 'p1', 5)).toEqual(['EUN1_1', 'EUN1_2']);
        expect((await client.getMatch('europe', 'EUN1_1')).info.participants[0]?.kills).toBe(5);
        expect(String(fetchFn.mock.calls[1]![0])).toContain('count=5');
    });
});
