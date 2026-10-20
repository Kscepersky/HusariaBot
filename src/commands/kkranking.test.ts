import { beforeEach, describe, expect, it, vi } from 'vitest';

const getTttRanking = vi.hoisted(() => vi.fn());
vi.mock('../economy/ttt-store.js', () => ({ getTttRanking }));

import { buildTttRankingEmbed, kkrankingCommand } from './kkranking.js';

function buildInteraction(guildId: string | null = 'guild-1') {
    return {
        guildId,
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
    } as any;
}

const entry = (userId: string, wins: number) => ({ userId, wins, losses: 1, draws: 2, games: wins + 3, winRate: 50 });

beforeEach(() => {
    getTttRanking.mockReset();
});

describe('buildTttRankingEmbed', () => {
    it('pokazuje podpowiedz gdy nikt nie gral', () => {
        expect(buildTttRankingEmbed([]).data.description).toContain('/kk');
    });

    it('numeruje graczy medalami i pozycjami', () => {
        const embed = buildTttRankingEmbed([entry('1', 9), entry('2', 8), entry('3', 7), entry('4', 6)]);
        const lines = embed.data.description!.split('\n');

        expect(lines[0]).toContain('🥇');
        expect(lines[0]).toContain('<@1>');
        expect(lines[2]).toContain('🥉');
        expect(lines[3]).toContain('**4.**');
        expect(lines[0]).toContain('9');
    });
});

describe('kkrankingCommand', () => {
    it('ma poprawna nazwe', () => {
        expect(kkrankingCommand.data.toJSON().name).toBe('kkranking');
    });

    it('odrzuca uzycie poza serwerem', async () => {
        const interaction = buildInteraction(null);
        await kkrankingCommand.execute(interaction);

        expect(interaction.reply).toHaveBeenCalledTimes(1);
        expect(getTttRanking).not.toHaveBeenCalled();
    });

    it('wysyla ranking top 10 bez pingowania', async () => {
        getTttRanking.mockResolvedValue([entry('1', 5)]);
        const interaction = buildInteraction();
        await kkrankingCommand.execute(interaction);

        expect(getTttRanking).toHaveBeenCalledWith('guild-1', 10);
        const payload = interaction.editReply.mock.calls[0][0];
        expect(payload.embeds).toHaveLength(1);
        expect(payload.allowedMentions).toEqual({ parse: [] });
    });

    it('obsluguje blad bazy', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        getTttRanking.mockRejectedValue(new Error('db down'));
        const interaction = buildInteraction();
        await kkrankingCommand.execute(interaction);
        errorSpy.mockRestore();

        expect(interaction.editReply.mock.calls[0][0].content).toContain('❌');
    });
});
