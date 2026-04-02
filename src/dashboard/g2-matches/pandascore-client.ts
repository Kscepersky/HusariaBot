import type { G2MatchRecord, PandaScoreFetchResult } from './types.js';

const PANDASCORE_BASE_URL = 'https://api.pandascore.co';
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const UPCOMING_HORIZON_DAYS = 90;
const WARSAW_TIME_ZONE = 'Europe/Warsaw';
const PANDASCORE_REQUEST_TIMEOUT_MS = 15_000;
const PANDASCORE_MAX_FETCH_RETRIES = 4;
const PANDASCORE_RETRY_BASE_DELAY_MS = 700;

interface PandaScoreOpponent {
    name?: string | null;
    acronym?: string | null;
    slug?: string | null;
}

interface PandaScoreOpponentEntry {
    opponent?: PandaScoreOpponent | null;
}

interface PandaScoreVideogame {
    name?: string | null;
}

interface PandaScoreTournament {
    name?: string | null;
}

interface PandaScoreLeague {
    name?: string | null;
}

interface PandaScoreSerie {
    name?: string | null;
    full_name?: string | null;
}

interface PandaScoreMatch {
    id: number | string;
    name?: string | null;
    begin_at?: string | null;
    status?: string | null;
    match_type?: string | null;
    number_of_games?: number | null;
    opponents?: PandaScoreOpponentEntry[];
    videogame?: PandaScoreVideogame | null;
    tournament?: PandaScoreTournament | null;
    league?: PandaScoreLeague | null;
    serie?: PandaScoreSerie | null;
}

function requirePandaScoreApiKey(): string {
    const apiKey = process.env.PANDASCORE_API_KEY?.trim();
    if (!apiKey) {
        throw new Error('Brakuje zmiennej PANDASCORE_API_KEY.');
    }

    return apiKey;
}

function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function normalizeGameName(value: string): string {
    const normalized = normalizeWhitespace(value);
    if (!normalized) {
        return 'Nieznana gra';
    }

    if (normalized.toLowerCase() === 'lol') {
        return 'League of Legends';
    }

    return normalized;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(statusCode: number): boolean {
    return statusCode === 429 || statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504;
}

function parseRetryAfterMs(response: Response): number | null {
    const retryAfterHeader = response.headers.get('retry-after');
    if (!retryAfterHeader) {
        return null;
    }

    const numeric = Number.parseInt(retryAfterHeader, 10);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric * 1000;
    }

    return null;
}

function backoffDelayMs(attempt: number): number {
    return PANDASCORE_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1));
}

function isTransientFetchError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const message = error.message.toLowerCase();
    return message.includes('timed out')
        || message.includes('network')
        || message.includes('socket')
        || message.includes('fetch failed');
}

async function fetchWithTimeout(url: URL, apiKey: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, PANDASCORE_REQUEST_TIMEOUT_MS);

    try {
        return await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            signal: controller.signal,
        });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`PandaScore request timed out after ${PANDASCORE_REQUEST_TIMEOUT_MS}ms.`);
        }

        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function normalizedLower(value: string): string {
    return normalizeWhitespace(value).toLowerCase();
}

function includesNormalized(haystack: string, needle: string): boolean {
    const left = normalizedLower(haystack);
    const right = normalizedLower(needle);

    if (!left || !right) {
        return false;
    }

    return left.includes(right);
}

function includesG2(value: string): boolean {
    return normalizeWhitespace(value).toLowerCase().includes('g2');
}

function isGenericTournamentStageName(value: string): boolean {
    const genericStages = new Set([
        'regular season',
        'playoffs',
        'playoff',
        'group stage',
        'groups',
        'swiss stage',
        'main event',
        'knockout stage',
        'bracket stage',
        'qualifier',
        'closed qualifier',
        'open qualifier',
        'quarterfinals',
        'semifinals',
        'finals',
        'final',
    ]);

    return genericStages.has(normalizedLower(value));
}

function buildCompetitionName(match: PandaScoreMatch): string {
    const tournamentName = normalizeWhitespace(match.tournament?.name ?? '');
    const leagueName = normalizeWhitespace(match.league?.name ?? '');
    const serieName = normalizeWhitespace(match.serie?.full_name ?? match.serie?.name ?? '');

    let leagueSerieName = '';

    if (leagueName && serieName) {
        leagueSerieName = includesNormalized(serieName, leagueName)
            ? serieName
            : `${leagueName} ${serieName}`;
    } else {
        leagueSerieName = serieName || leagueName;
    }

    if (!tournamentName) {
        return leagueSerieName || 'Nieznany turniej';
    }

    if (!leagueSerieName) {
        return tournamentName;
    }

    if (isGenericTournamentStageName(tournamentName)) {
        return `${leagueSerieName} (${tournamentName})`;
    }

    if (includesNormalized(tournamentName, leagueSerieName)) {
        return tournamentName;
    }

    if (includesNormalized(leagueSerieName, tournamentName)) {
        return leagueSerieName;
    }

    return tournamentName;
}

function formatWarsawDate(timestamp: number): string {
    return new Intl.DateTimeFormat('pl-PL', {
        timeZone: WARSAW_TIME_ZONE,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).format(new Date(timestamp));
}

function formatWarsawTime(timestamp: number): string {
    return new Intl.DateTimeFormat('pl-PL', {
        timeZone: WARSAW_TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(new Date(timestamp));
}

function formatMatchType(matchType: string | null | undefined, numberOfGames: number | null | undefined): string {
    const normalizedType = (matchType ?? '').trim().toLowerCase();

    if (normalizedType === 'best_of' && numberOfGames && Number.isFinite(numberOfGames)) {
        return `BO${numberOfGames}`;
    }

    if (normalizedType === 'first_to' && numberOfGames && Number.isFinite(numberOfGames)) {
        return `FT${numberOfGames}`;
    }

    if (normalizedType === 'red_bull_home_ground' && numberOfGames && Number.isFinite(numberOfGames)) {
        return `BO${numberOfGames}`;
    }

    if (numberOfGames && Number.isFinite(numberOfGames)) {
        return `BO${numberOfGames}`;
    }

    return 'BO?';
}

function isLikelyAcronym(value: string): boolean {
    const compact = value.replace(/[\s._-]+/g, '');

    if (!compact || compact.length < 2 || compact.length > 6) {
        return false;
    }

    return compact === compact.toUpperCase() && /[A-Z]/.test(compact);
}

function slugToDisplayName(slug: string): string {
    return slug
        .split('-')
        .filter((part) => Boolean(part))
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ')
        .trim();
}

function normalizeOpponentDisplayName(opponent: PandaScoreOpponent | null | undefined): string {
    const name = normalizeWhitespace(opponent?.name ?? '');
    const acronym = normalizeWhitespace(opponent?.acronym ?? '');
    const slug = normalizeWhitespace(opponent?.slug ?? '');
    const slugDisplayName = slug ? slugToDisplayName(slug) : '';

    if (!name) {
        return slugDisplayName || acronym;
    }

    // Prefer full display names over short acronyms like SHFT.
    if (isLikelyAcronym(name) && slugDisplayName) {
        return slugDisplayName;
    }

    return name;
}

function inferOpponentName(matchName: string, teamNames: string[]): string {
    const normalizedName = normalizeWhitespace(matchName);

    // Structured opponent entries are more reliable than parsing human-readable match names.
    const firstNonG2 = teamNames.find((name) => !includesG2(name));
    if (firstNonG2) {
        return firstNonG2;
    }

    if (normalizedName) {
        const splitByVs = normalizedName.split(/\s+vs\s+/i);
        if (splitByVs.length === 2) {
            const [left, right] = splitByVs;
            if (left && includesG2(left) && right) {
                return normalizeWhitespace(right);
            }
            if (right && includesG2(right) && left) {
                return normalizeWhitespace(left);
            }
        }
    }

    return teamNames[0] ?? 'Nieznany rywal';
}

function normalizeMatch(match: PandaScoreMatch, horizonTimestamp: number): G2MatchRecord | null {
    const beginAtUtc = (match.begin_at ?? '').trim();
    if (!beginAtUtc) {
        return null;
    }

    const beginAtTimestamp = Date.parse(beginAtUtc);
    if (!Number.isFinite(beginAtTimestamp)) {
        return null;
    }

    if (beginAtTimestamp > horizonTimestamp) {
        return null;
    }

    const teamNames = (match.opponents ?? [])
        .map((entry) => normalizeOpponentDisplayName(entry.opponent ?? null))
        .filter((name) => Boolean(name));

    if (teamNames.length === 0) {
        return null;
    }

    const g2Teams = teamNames.filter((name) => includesG2(name));
    if (g2Teams.length === 0) {
        return null;
    }

    const gameName = normalizeGameName(match.videogame?.name ?? '');
    const tournamentName = buildCompetitionName(match);

    const opponent = inferOpponentName(match.name ?? '', teamNames);
    const matchType = formatMatchType(match.match_type, match.number_of_games);

    return {
        matchId: String(match.id),
        game: gameName,
        opponent,
        tournament: tournamentName,
        matchType,
        date: formatWarsawDate(beginAtTimestamp),
        time: formatWarsawTime(beginAtTimestamp),
        beginAtUtc,
        beginAtTimestamp,
        status: normalizeWhitespace(match.status ?? '') || 'upcoming',
        g2TeamName: g2Teams[0] ?? 'G2 Esports',
        leagueName: normalizeWhitespace(match.league?.name ?? ''),
        sourceUpdatedAt: Date.now(),
        rawPayload: JSON.stringify(match),
    };
}

async function fetchMatchesPage(pageNumber: number, apiKey: string): Promise<PandaScoreMatch[]> {
    const url = new URL('/matches/upcoming', PANDASCORE_BASE_URL);
    url.searchParams.set('sort', 'begin_at');
    url.searchParams.set('page[size]', String(PAGE_SIZE));
    url.searchParams.set('page[number]', String(pageNumber));

    for (let attempt = 1; attempt <= PANDASCORE_MAX_FETCH_RETRIES; attempt += 1) {
        try {
            const response = await fetchWithTimeout(url, apiKey);

            if (response.status === 401 || response.status === 403) {
                throw new Error('Nie udało się uwierzytelnić w PandaScore. Sprawdź PANDASCORE_API_KEY.');
            }

            if (!response.ok) {
                const responseText = await response.text();

                if (isRetryableStatus(response.status) && attempt < PANDASCORE_MAX_FETCH_RETRIES) {
                    const retryAfter = parseRetryAfterMs(response);
                    const delayMs = retryAfter ?? backoffDelayMs(attempt);
                    console.warn(`⚠️  PandaScore transient error on page=${pageNumber}, attempt=${attempt}, status=${response.status}. Retry in ${delayMs}ms.`);
                    await sleep(delayMs);
                    continue;
                }

                if (response.status === 429) {
                    throw new Error('PandaScore zwrócił limit zapytań (429). Spróbuj ponownie za chwilę.');
                }

                throw new Error(`Błąd PandaScore (${response.status}): ${responseText || 'brak treści odpowiedzi'}`);
            }

            const payload = await response.json();
            if (!Array.isArray(payload)) {
                throw new Error('Nieprawidłowa odpowiedź PandaScore: oczekiwano tablicy meczów.');
            }

            return payload as PandaScoreMatch[];
        } catch (error) {
            if (attempt < PANDASCORE_MAX_FETCH_RETRIES && isTransientFetchError(error)) {
                const delayMs = backoffDelayMs(attempt);
                const message = error instanceof Error ? error.message : String(error);
                console.warn(`⚠️  PandaScore transient fetch failure on page=${pageNumber}, attempt=${attempt}: ${message}. Retry in ${delayMs}ms.`);
                await sleep(delayMs);
                continue;
            }

            if (error instanceof Error) {
                throw error;
            }

            throw new Error(String(error));
        }
    }

    throw new Error('Nie udało się pobrać danych z PandaScore po wszystkich próbach.');
}

export async function fetchUpcomingG2Matches(): Promise<PandaScoreFetchResult> {
    const apiKey = requirePandaScoreApiKey();
    const now = Date.now();
    const horizonTimestamp = now + (UPCOMING_HORIZON_DAYS * 24 * 60 * 60 * 1000);

    const collectedMatches: G2MatchRecord[] = [];
    let fetchedPages = 0;

    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
        const pageMatches = await fetchMatchesPage(pageNumber, apiKey);
        fetchedPages += 1;

        if (pageMatches.length === 0) {
            break;
        }

        let everyMatchPastHorizon = true;

        for (const pageMatch of pageMatches) {
            const beginAtTimestamp = Date.parse((pageMatch.begin_at ?? '').trim());
            if (Number.isFinite(beginAtTimestamp) && beginAtTimestamp <= horizonTimestamp) {
                everyMatchPastHorizon = false;
            }

            const normalized = normalizeMatch(pageMatch, horizonTimestamp);
            if (normalized) {
                collectedMatches.push(normalized);
            }
        }

        if (everyMatchPastHorizon) {
            break;
        }
    }

    const deduplicated = Array.from(
        new Map(collectedMatches.map((match) => [match.matchId, match])).values(),
    );

    deduplicated.sort((left, right) => left.beginAtTimestamp - right.beginAtTimestamp);

    return {
        matches: deduplicated,
        fetchedPages,
    };
}

export async function probePandaScoreApiConnection(): Promise<{ sampleCount: number }> {
    const apiKey = requirePandaScoreApiKey();

    const url = new URL('/matches/upcoming', PANDASCORE_BASE_URL);
    url.searchParams.set('sort', 'begin_at');
    url.searchParams.set('page[size]', '1');
    url.searchParams.set('page[number]', '1');

    for (let attempt = 1; attempt <= PANDASCORE_MAX_FETCH_RETRIES; attempt += 1) {
        try {
            const response = await fetchWithTimeout(url, apiKey);

            if (response.status === 401 || response.status === 403) {
                throw new Error('PandaScore auth failed (401/403). Sprawdź PANDASCORE_API_KEY.');
            }

            if (!response.ok) {
                const responseText = await response.text();

                if (isRetryableStatus(response.status) && attempt < PANDASCORE_MAX_FETCH_RETRIES) {
                    const retryAfter = parseRetryAfterMs(response);
                    const delayMs = retryAfter ?? backoffDelayMs(attempt);
                    console.warn(`⚠️  PandaScore probe transient error on attempt=${attempt}, status=${response.status}. Retry in ${delayMs}ms.`);
                    await sleep(delayMs);
                    continue;
                }

                throw new Error(`PandaScore probe failed (${response.status}): ${responseText || 'brak treści odpowiedzi'}`);
            }

            const payload = await response.json();
            if (!Array.isArray(payload)) {
                throw new Error('PandaScore probe returned invalid payload (expected array).');
            }

            return { sampleCount: payload.length };
        } catch (error) {
            if (attempt < PANDASCORE_MAX_FETCH_RETRIES && isTransientFetchError(error)) {
                const delayMs = backoffDelayMs(attempt);
                const message = error instanceof Error ? error.message : String(error);
                console.warn(`⚠️  PandaScore probe transient fetch failure on attempt=${attempt}: ${message}. Retry in ${delayMs}ms.`);
                await sleep(delayMs);
                continue;
            }

            if (error instanceof Error) {
                throw error;
            }

            throw new Error(String(error));
        }
    }

    throw new Error('PandaScore probe failed after all retry attempts.');
}
