export interface G2MatchRecord {
    matchId: string;
    game: string;
    opponent: string;
    tournament: string;
    matchType: string;
    date: string;
    time: string;
    beginAtUtc: string;
    beginAtTimestamp: number;
    status: string;
    g2TeamName: string;
    leagueName: string;
    sourceUpdatedAt: number;
    rawPayload: string;
}

export interface G2MatchesSyncMeta {
    lastSyncAt: number | null;
    lastSyncCount: number;
    lastError: string | null;
}

export interface G2MatchesQueryFilters {
    game?: string;
    g2Team?: string;
    tournament?: string;
    status?: string;
    opponent?: string;
    limit?: number;
    offset?: number;
}

export interface G2MatchesFilterOptions {
    games: string[];
    g2Teams: string[];
    tournaments: string[];
    statuses: string[];
}

export interface PandaScoreFetchResult {
    matches: G2MatchRecord[];
    fetchedPages: number;
}
