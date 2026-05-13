import { Router } from 'express';
import { requireAuth } from '../middleware/require-auth.js';
import { fetchUpcomingG2Matches } from '../g2-matches/pandascore-client.js';
import {
    getG2MatchesSyncMeta,
    listG2Matches,
    listG2MatchesFilterOptions,
    replaceAllG2Matches,
    saveG2MatchesSyncError,
} from '../g2-matches/repository.js';
import type { G2MatchRecord, G2MatchesQueryFilters } from '../g2-matches/types.js';
import { createLogger } from '../../utils/logger.js';

const g2Logger = createLogger('dashboard:g2-matches');

const REFRESH_COOLDOWN_MS = 30_000;

let lastRefreshAttemptTimestamp = 0;
let refreshInProgress = false;

export const g2MatchesRouter = Router();

g2MatchesRouter.use(requireAuth);

function normalizeQueryString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeNumber(value: unknown, fallback: number): number {
    if (typeof value !== 'string') {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return parsed;
}

function buildFilters(query: Record<string, unknown>): G2MatchesQueryFilters {
    const game = normalizeQueryString(query.game);
    const g2Team = normalizeQueryString(query.g2Team);
    const tournament = normalizeQueryString(query.tournament);
    const status = normalizeQueryString(query.status);
    const opponent = normalizeQueryString(query.opponent);

    return {
        game: game || undefined,
        g2Team: g2Team || undefined,
        tournament: tournament || undefined,
        status: status || undefined,
        opponent: opponent || undefined,
        limit: normalizeNumber(query.limit, 200),
        offset: normalizeNumber(query.offset, 0),
    };
}

function getLiquipediaPath(gameLower: string): string {
    if (gameLower.includes('valorant')) return 'valorant';
    if (gameLower.includes('rainbow six') || gameLower.includes('r6')) return 'rainbowsix';
    if (gameLower.includes('rocket league')) return 'rocketleague';
    if (gameLower.includes('apex')) return 'apexlegends';
    if (gameLower.includes('dota')) return 'dota2';
    if (gameLower.includes('overwatch')) return 'overwatch';
    if (gameLower.includes('starcraft')) return 'starcraft2';
    return 'commons';
}

function buildTournamentUrl(gameName: string, leagueName: string): string | null {
    const lower = gameName.toLowerCase().trim();
    const searchTerm = leagueName.trim();
    if (!searchTerm) return null;
    if (lower.includes('counter-strike') || lower === 'cs2') {
        return `https://www.hltv.org/search#query=${encodeURIComponent(searchTerm)}`;
    }
    if (lower.includes('league of legends')) {
        return `https://lol.fandom.com/wiki/Special:Search?query=${encodeURIComponent(searchTerm)}`;
    }
    return `https://liquipedia.net/${getLiquipediaPath(lower)}/index.php?search=${encodeURIComponent(searchTerm)}`;
}

function toPublicMatch(match: G2MatchRecord) {
    const { rawPayload, ...publicMatch } = match;
    let gameImageUrl: string | null = null;
    let directLeagueUrl: string | null = null;
    try {
        const raw = JSON.parse(rawPayload) as {
            videogame?: { image_url?: string | null } | null;
            league?: { url?: string | null } | null;
        };
        const imageUrl = raw.videogame?.image_url;
        gameImageUrl = typeof imageUrl === 'string' && imageUrl.trim() ? imageUrl.trim() : null;
        const leagueUrl = raw.league?.url;
        directLeagueUrl = typeof leagueUrl === 'string' && leagueUrl.trim() ? leagueUrl.trim() : null;
    } catch {
        // non-critical — rawPayload malformed
    }
    return {
        ...publicMatch,
        gameImageUrl,
        tournamentUrl: directLeagueUrl ?? buildTournamentUrl(match.game, match.leagueName),
    };
}

g2MatchesRouter.get('/', async (req, res) => {
    const filters = buildFilters(req.query as Record<string, unknown>);

    try {
        const [matches, options, meta] = await Promise.all([
            listG2Matches(filters),
            listG2MatchesFilterOptions(),
            getG2MatchesSyncMeta(),
        ]);

        res.json({
            matches: matches.map(toPublicMatch),
            filters: options,
            meta,
            refreshCooldownMs: REFRESH_COOLDOWN_MS,
            refreshInProgress,
        });
    } catch (error) {
        g2Logger.error('G2_MATCHES_LOAD_FAILED', 'Nie udało się załadować bazy meczów G2.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać bazy meczów G2.' });
    }
});

g2MatchesRouter.post('/refresh', async (_req, res) => {
    const now = Date.now();

    if (refreshInProgress) {
        res.status(409).json({ error: 'Odświeżanie już trwa. Poczekaj na zakończenie.' });
        return;
    }

    const elapsedSinceLastRefresh = now - lastRefreshAttemptTimestamp;
    if (elapsedSinceLastRefresh < REFRESH_COOLDOWN_MS) {
        const remainingMs = REFRESH_COOLDOWN_MS - elapsedSinceLastRefresh;
        res.status(429).json({
            error: `Odświeżanie można uruchomić ponownie za ${Math.ceil(remainingMs / 1000)} s.`,
        });
        return;
    }

    refreshInProgress = true;
    lastRefreshAttemptTimestamp = now;

    try {
        const result = await fetchUpcomingG2Matches();
        await replaceAllG2Matches(result.matches);

        g2Logger.info('G2_MATCHES_REFRESHED', 'Odświeżono bazę meczów G2.', {
            count: result.matches.length,
            fetchedPages: result.fetchedPages,
        });
        res.json({
            success: true,
            count: result.matches.length,
            fetchedPages: result.fetchedPages,
            lastSyncAt: Date.now(),
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Nieznany błąd odświeżania.';
        await saveG2MatchesSyncError(errorMessage).catch((metaError) => {
            g2Logger.error('G2_SYNC_META_WRITE_FAILED', 'Nie udało się zapisać błędu synchronizacji G2.', {}, metaError);
        });

        g2Logger.error('G2_MATCHES_REFRESH_FAILED', 'Nie udało się odświeżyć bazy meczów G2.', {}, error);
        res.status(502).json({ error: errorMessage });
    } finally {
        refreshInProgress = false;
    }
});
