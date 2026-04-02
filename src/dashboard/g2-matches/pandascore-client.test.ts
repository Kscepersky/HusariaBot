import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchUpcomingG2Matches } from './pandascore-client.js';

describe('pandascore client', () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.PANDASCORE_API_KEY;

    beforeEach(() => {
        process.env.PANDASCORE_API_KEY = 'test-key';
    });

    afterEach(() => {
        global.fetch = originalFetch;

        if (originalApiKey === undefined) {
            delete process.env.PANDASCORE_API_KEY;
        } else {
            process.env.PANDASCORE_API_KEY = originalApiKey;
        }
    });

    it('prefers structured opponent names over parsing noisy match title', async () => {
        const beginAtIso = new Date(Date.now() + (2 * 24 * 60 * 60 * 1000)).toISOString();

        const firstPage = [
            {
                id: 12345,
                name: 'Swiss Stage - Team Liquid vs G2 Gozen',
                begin_at: beginAtIso,
                status: 'not_started',
                match_type: 'best_of',
                number_of_games: 3,
                opponents: [
                    { opponent: { name: 'Team Liquid' } },
                    { opponent: { name: 'G2 Gozen' } },
                ],
                videogame: { name: 'Valorant' },
                tournament: { name: 'Regular Season' },
                league: { name: 'VCT 2025' },
                serie: { full_name: 'Game Changers EMEA' },
            },
        ];

        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(firstPage), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }))
            .mockResolvedValueOnce(new Response(JSON.stringify([]), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }));

        global.fetch = fetchMock as typeof fetch;

        const result = await fetchUpcomingG2Matches();

        expect(result.matches).toHaveLength(1);
        expect(result.matches[0]?.opponent).toBe('Team Liquid');
        expect(result.matches[0]?.g2TeamName).toBe('G2 Gozen');
        expect(result.fetchedPages).toBe(2);
    });

    it('normalizuje gre LoL do pelnej nazwy League of Legends', async () => {
        const beginAtIso = new Date(Date.now() + (2 * 24 * 60 * 60 * 1000)).toISOString();

        const firstPage = [
            {
                id: 54321,
                name: 'G2 Esports vs Team BDS',
                begin_at: beginAtIso,
                status: 'not_started',
                match_type: 'best_of',
                number_of_games: 5,
                opponents: [
                    { opponent: { name: 'G2 Esports' } },
                    { opponent: { name: 'Team BDS' } },
                ],
                videogame: { name: 'LoL' },
                tournament: { name: 'LEC' },
                league: { name: 'LEC' },
                serie: { full_name: 'Spring Split' },
            },
        ];

        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(firstPage), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }))
            .mockResolvedValueOnce(new Response(JSON.stringify([]), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }));

        global.fetch = fetchMock as typeof fetch;

        const result = await fetchUpcomingG2Matches();

        expect(result.matches).toHaveLength(1);
        expect(result.matches[0]?.game).toBe('League of Legends');
    });
});
