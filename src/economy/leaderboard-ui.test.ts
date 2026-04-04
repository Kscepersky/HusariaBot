import { describe, expect, it } from 'vitest';
import { parseLeaderboardCustomId } from './leaderboard-ui.js';

describe('parseLeaderboardCustomId', () => {
    it('parsuje poprawne customId', () => {
        const parsed = parseLeaderboardCustomId('economy_leaderboard:coins:2');

        expect(parsed).toEqual({
            sortBy: 'coins',
            page: 2,
        });
    });

    it('odrzuca nienumeryczne strony i malformed tokeny', () => {
        expect(parseLeaderboardCustomId('economy_leaderboard:coins:2abc')).toBeNull();
        expect(parseLeaderboardCustomId('economy_leaderboard:coins:-1')).toBeNull();
        expect(parseLeaderboardCustomId('economy_leaderboard:coins:')).toBeNull();
        expect(parseLeaderboardCustomId('economy_leaderboard:coins:1:extra')).toBeNull();
    });
});
