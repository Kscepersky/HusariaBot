import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPknRanking = vi.hoisted(() => vi.fn());
vi.mock('../economy/pkn-store.js', () => ({ getPknRanking }));

import { buildPknRankingEmbed, pknrankingCommand } from './pknranking.js';

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
    getPknRanking.mockReset();
});

describe('buildPknRankingEmbed', () => {
    it('pokazuje podpowiedz gdy nikt nie gral', () => {
        expect(buildPknRankingEmbed([]).data.description).toContain('/pkn');
    });

    it('numeruje graczy medalami i pozycjami', () => {
        const embed = buildPknRankingEmbed([entry('1', 9), entry('2', 8), entry('3', 7), entry('4', 6)]);
        const lines = embed.data.description!.split('\n');

        expect(lines[0]).toContain('🥇');
        expect(lines[0]).toContain('<@1>');
        expect(lines[2]).toContain('🥉');
        expect(lines[3]).toContain('**4.**');
        expect(lines[0]).toContain('9');
    });
});

describe('pknrankingCommand', () => {
    it('ma poprawna nazwe', () => {
        expect(pknrankingCommand.data.toJSON().name).toBe('pknranking');
    });

    it('odrzuca uzycie poza serwerem', async () => {
        const interaction = buildInteraction(null);
        await pknrankingCommand.execute(interaction);

        expect(interaction.reply).toHaveBeenCalledTimes(1);
        expect(getPknRanking).not.toHaveBeenCalled();
    });

    it('wysyla ranking top 10 bez pingowania', async () => {
        getPknRanking.mockResolvedValue([entry('1', 5)]);
        const interaction = buildInteraction();
        await pknrankingCommand.execute(interaction);

        expect(getPknRanking).toHaveBeenCalledWith('guild-1', 10);
        const payload = interaction.editReply.mock.calls[0][0];
        expect(payload.embeds).toHaveLength(1);
        expect(payload.allowedMentions).toEqual({ parse: [] });
    });

    it('obsluguje blad bazy', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        getPknRanking.mockRejectedValue(new Error('db down'));
        const interaction = buildInteraction();
        await pknrankingCommand.execute(interaction);
        errorSpy.mockRestore();

        expect(interaction.editReply.mock.calls[0][0].content).toContain('❌');
    });
});
