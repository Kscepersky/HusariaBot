import { z } from 'zod';

export type LolRegion = 'eune' | 'euw' | 'na' | 'kr' | 'tr';

export interface RegionInfo {
    /** Host platformy (summoner, league, mastery). */
    platform: string;
    /** Host regionalny (account, match). */
    routing: string;
    label: string;
}

export const REGIONS: Readonly<Record<LolRegion, RegionInfo>> = {
    eune: { platform: 'eun1', routing: 'europe', label: 'EUNE' },
    euw: { platform: 'euw1', routing: 'europe', label: 'EUW' },
    na: { platform: 'na1', routing: 'americas', label: 'NA' },
    kr: { platform: 'kr', routing: 'asia', label: 'KR' },
    tr: { platform: 'tr1', routing: 'europe', label: 'TR' },
};

const REQUEST_TIMEOUT_MS = 6000;
const MAX_GAME_NAME_LENGTH = 16;
const MAX_TAG_LENGTH = 5;

export class RiotApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'RiotApiError';
    }
}

const accountSchema = z.object({ puuid: z.string(), gameName: z.string(), tagLine: z.string() });
const summonerSchema = z.object({ profileIconId: z.number(), summonerLevel: z.number() });
const rankedEntrySchema = z.object({
    queueType: z.string(),
    tier: z.string(),
    rank: z.string(),
    leaguePoints: z.number(),
    wins: z.number(),
    losses: z.number(),
});
const masterySchema = z.object({
    championId: z.number(),
    championLevel: z.number(),
    championPoints: z.number(),
});
const participantSchema = z.object({
    puuid: z.string(),
    championId: z.number(),
    kills: z.number(),
    deaths: z.number(),
    assists: z.number(),
    win: z.boolean(),
    totalMinionsKilled: z.number().default(0),
    neutralMinionsKilled: z.number().default(0),
    gameEndedInEarlySurrender: z.boolean().default(false),
});
const matchSchema = z.object({
    info: z.object({
        queueId: z.number(),
        gameDuration: z.number(),
        participants: z.array(participantSchema),
    }),
});

export type RiotAccount = z.infer<typeof accountSchema>;
export type RiotSummoner = z.infer<typeof summonerSchema>;
export type RiotRankedEntry = z.infer<typeof rankedEntrySchema>;
export type RiotMastery = z.infer<typeof masterySchema>;
export type RiotMatch = z.infer<typeof matchSchema>;
export type RiotMatchParticipant = z.infer<typeof participantSchema>;

/** Dzieli "Nick#TAG" po ostatnim '#'; zwraca null gdy format jest niepoprawny. */
export function parseRiotId(input: string): { gameName: string; tagLine: string } | null {
    const trimmed = input.trim();
    const separator = trimmed.lastIndexOf('#');
    if (separator < 1) {
        return null;
    }

    const gameName = trimmed.slice(0, separator).trim();
    const tagLine = trimmed.slice(separator + 1).trim();
    if (!gameName || gameName.length > MAX_GAME_NAME_LENGTH) {
        return null;
    }
    if (!/^[\p{L}\p{N}]{1,5}$/u.test(tagLine) || tagLine.length > MAX_TAG_LENGTH) {
        return null;
    }

    return { gameName, tagLine };
}

export interface RiotClientOptions {
    apiKey: string;
    fetchFn?: typeof fetch;
}

export function createRiotClient({ apiKey, fetchFn = fetch }: RiotClientOptions) {
    async function request<T>(host: string, path: string, schema: z.ZodType<T>): Promise<T> {
        const response = await fetchFn(`https://${host}.api.riotgames.com${path}`, {
            headers: { 'X-Riot-Token': apiKey },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
            throw new RiotApiError(response.status, `Riot API request failed with status ${response.status}.`);
        }

        const parsed = schema.safeParse(await response.json());
        if (!parsed.success) {
            throw new RiotApiError(502, 'Riot API returned an unexpected response shape.');
        }

        return parsed.data;
    }

    return {
        getAccount: (routing: string, gameName: string, tagLine: string) =>
            request(
                routing,
                `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
                accountSchema,
            ),
        getSummoner: (platform: string, puuid: string) =>
            request(platform, `/lol/summoner/v4/summoners/by-puuid/${puuid}`, summonerSchema),
        getRankedEntries: (platform: string, puuid: string) =>
            request(platform, `/lol/league/v4/entries/by-puuid/${puuid}`, z.array(rankedEntrySchema)),
        getTopMastery: (platform: string, puuid: string, count: number) =>
            request(
                platform,
                `/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=${count}`,
                z.array(masterySchema),
            ),
        getMatchIds: (routing: string, puuid: string, count: number) =>
            request(routing, `/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}`, z.array(z.string())),
        getMatch: (routing: string, matchId: string) =>
            request(routing, `/lol/match/v5/matches/${encodeURIComponent(matchId)}`, matchSchema),
    };
}

export type RiotClient = ReturnType<typeof createRiotClient>;
