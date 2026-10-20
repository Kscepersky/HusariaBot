import type { ChampionCatalog } from './champion-data.js';
import { championIconUrl } from './champion-data.js';
import { REGIONS, type LolRegion, type RiotClient, type RiotMatch } from './riot-api.js';

const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const MATCH_CACHE_LIMIT = 500;
const MATCH_COUNT = 5;
const MASTERY_COUNT = 3;
const SOLO_QUEUE = 'RANKED_SOLO_5x5';
const DDRAGON_BASE_URL = 'https://ddragon.leagueoflegends.com';

const QUEUE_LABELS: Readonly<Record<number, string>> = {
    400: 'Normal Draft',
    420: 'Solo/Duo',
    430: 'Normal Blind',
    440: 'Flex',
    450: 'ARAM',
    480: 'Swiftplay',
    490: 'Quickplay',
    700: 'Clash',
    1700: 'Arena',
};

export interface LolRank {
    tier: string;
    division: string;
    lp: number;
    wins: number;
    losses: number;
}

export interface LolMain {
    name: string;
    iconUrl: string;
    level: number;
    points: number;
}

export interface LolMatchSummary {
    championName: string;
    iconUrl: string;
    win: boolean;
    remake: boolean;
    kills: number;
    deaths: number;
    assists: number;
    cs: number;
    durationSec: number;
    queueLabel: string;
}

export interface LolProfile {
    gameName: string;
    tagLine: string;
    regionLabel: string;
    level: number;
    profileIconUrl: string;
    rank: LolRank | null;
    mains: LolMain[];
    matches: LolMatchSummary[];
}

const profileCache = new Map<string, { profile: LolProfile; fetchedAt: number }>();
const matchCache = new Map<string, RiotMatch>();

export function clearLolProfileCache(): void {
    profileCache.clear();
    matchCache.clear();
}

export function queueLabel(queueId: number): string {
    return QUEUE_LABELS[queueId] ?? 'Inny tryb';
}

async function loadMatch(client: RiotClient, routing: string, matchId: string): Promise<RiotMatch> {
    const cached = matchCache.get(matchId);
    if (cached) {
        return cached;
    }

    const match = await client.getMatch(routing, matchId);
    if (matchCache.size >= MATCH_CACHE_LIMIT) {
        matchCache.clear();
    }
    matchCache.set(matchId, match);
    return match;
}

function summarizeMatch(match: RiotMatch, puuid: string, catalog: ChampionCatalog): LolMatchSummary | null {
    const player = match.info.participants.find((participant) => participant.puuid === puuid);
    if (!player) {
        return null;
    }

    const champion = catalog.champions.find((candidate) => candidate.key === String(player.championId));

    return {
        championName: champion?.name ?? 'Nieznana',
        iconUrl: champion ? championIconUrl(catalog.version, champion.id) : '',
        win: player.win,
        remake: player.gameEndedInEarlySurrender,
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        cs: player.totalMinionsKilled + player.neutralMinionsKilled,
        durationSec: match.info.gameDuration,
        queueLabel: queueLabel(match.info.queueId),
    };
}

/** Sklada profil gracza z kilku endpointow Riotu; wynik jest cache'owany na 5 minut (limity dev key). */
export async function buildLolProfile(
    client: RiotClient,
    catalog: ChampionCatalog,
    riotId: { gameName: string; tagLine: string },
    region: LolRegion,
    now: () => number = Date.now,
): Promise<LolProfile> {
    const cacheKey = `${region}:${riotId.gameName.toLowerCase()}#${riotId.tagLine.toLowerCase()}`;
    const cached = profileCache.get(cacheKey);
    if (cached && now() - cached.fetchedAt < PROFILE_CACHE_TTL_MS) {
        return cached.profile;
    }

    const { platform, routing, label } = REGIONS[region];
    const account = await client.getAccount(routing, riotId.gameName, riotId.tagLine);

    const [summoner, entries, mastery, matchIds] = await Promise.all([
        client.getSummoner(platform, account.puuid),
        client.getRankedEntries(platform, account.puuid),
        client.getTopMastery(platform, account.puuid, MASTERY_COUNT),
        client.getMatchIds(routing, account.puuid, MATCH_COUNT),
    ]);

    const settled = await Promise.allSettled(matchIds.map((matchId) => loadMatch(client, routing, matchId)));
    const matches = settled
        .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
        .map((match) => summarizeMatch(match, account.puuid, catalog))
        .filter((summary): summary is LolMatchSummary => summary !== null);

    const solo = entries.find((entry) => entry.queueType === SOLO_QUEUE);
    const mains = mastery.flatMap((entry): LolMain[] => {
        const champion = catalog.champions.find((candidate) => candidate.key === String(entry.championId));
        return champion
            ? [{
                name: champion.name,
                iconUrl: championIconUrl(catalog.version, champion.id),
                level: entry.championLevel,
                points: entry.championPoints,
            }]
            : [];
    });

    const profile: LolProfile = {
        gameName: account.gameName,
        tagLine: account.tagLine,
        regionLabel: label,
        level: summoner.summonerLevel,
        profileIconUrl: `${DDRAGON_BASE_URL}/cdn/${catalog.version}/img/profileicon/${summoner.profileIconId}.png`,
        rank: solo
            ? { tier: solo.tier, division: solo.rank, lp: solo.leaguePoints, wins: solo.wins, losses: solo.losses }
            : null,
        mains,
        matches,
    };

    profileCache.set(cacheKey, { profile, fetchedAt: now() });
    return profile;
}
