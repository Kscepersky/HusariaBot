import { z } from 'zod';

const DDRAGON_BASE_URL = 'https://ddragon.leagueoflegends.com';
const DDRAGON_LOCALE = 'pl_PL';
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6000;

export interface ChampionInfo {
    id: string;
    name: string;
    title: string;
    blurb: string;
    tags: string[];
}

export interface ChampionCatalog {
    version: string;
    champions: ChampionInfo[];
}

const versionsSchema = z.array(z.string()).min(1);
const championsSchema = z.object({
    data: z.record(
        z.string(),
        z.object({
            id: z.string(),
            name: z.string(),
            title: z.string(),
            blurb: z.string(),
            tags: z.array(z.string()),
        }),
    ),
});

let cached: { catalog: ChampionCatalog; fetchedAt: number } | null = null;

export function clearChampionCatalogCache(): void {
    cached = null;
}

export function championSplashUrl(championId: string): string {
    return `${DDRAGON_BASE_URL}/cdn/img/champion/splash/${championId}_0.jpg`;
}

export function championIconUrl(version: string, championId: string): string {
    return `${DDRAGON_BASE_URL}/cdn/${version}/img/champion/${championId}.png`;
}

async function fetchJson(fetchFn: typeof fetch, url: string): Promise<unknown> {
    const response = await fetchFn(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) {
        throw new Error(`Data Dragon request failed with status ${response.status}.`);
    }

    return response.json();
}

async function fetchCatalog(fetchFn: typeof fetch): Promise<ChampionCatalog> {
    const versions = versionsSchema.parse(await fetchJson(fetchFn, `${DDRAGON_BASE_URL}/api/versions.json`));
    const version = versions[0]!;
    const parsed = championsSchema.parse(
        await fetchJson(fetchFn, `${DDRAGON_BASE_URL}/cdn/${version}/data/${DDRAGON_LOCALE}/champion.json`),
    );
    const champions = Object.values(parsed.data);
    if (champions.length === 0) {
        throw new Error('Data Dragon returned an empty champion list.');
    }

    return { version, champions };
}

/** Lista postaci z Data Dragona z cache (24 h); przy bledzie odswiezania zwraca ostatni cache. */
export async function loadChampionCatalog(
    fetchFn: typeof fetch = fetch,
    now: () => number = Date.now,
): Promise<ChampionCatalog> {
    if (cached && now() - cached.fetchedAt < CATALOG_TTL_MS) {
        return cached.catalog;
    }

    try {
        const catalog = await fetchCatalog(fetchFn);
        cached = { catalog, fetchedAt: now() };
        return catalog;
    } catch (error) {
        if (cached) {
            console.warn('⚠️ Nie udalo sie odswiezyc listy postaci, uzywam starego cache:', error);
            return cached.catalog;
        }

        throw error;
    }
}
