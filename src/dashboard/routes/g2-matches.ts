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

function toPublicMatch(match: G2MatchRecord): Omit<G2MatchRecord, 'rawPayload'> {
    const { rawPayload: _rawPayload, ...publicMatch } = match;
    return publicMatch;
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
        console.error('Failed to load G2 matches:', error);
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

        res.json({
            success: true,
            count: result.matches.length,
            fetchedPages: result.fetchedPages,
            lastSyncAt: Date.now(),
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Nieznany błąd odświeżania.';
        await saveG2MatchesSyncError(errorMessage).catch((metaError) => {
            console.error('Failed to persist G2 sync error:', metaError);
        });

        console.error('Failed to refresh G2 matches:', error);
        res.status(502).json({ error: errorMessage });
    } finally {
        refreshInProgress = false;
    }
});
