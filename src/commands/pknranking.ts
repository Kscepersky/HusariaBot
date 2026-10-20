import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { getPknRanking, type PknPlayerStats } from '../economy/pkn-store.js';
import { HusariaColors } from '../utils/husaria-theme.js';

export const PKN_RANKING_SIZE = 10;
const MEDALS = ['🥇', '🥈', '🥉'] as const;

export function buildPknRankingEmbed(entries: readonly PknPlayerStats[]): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor(HusariaColors.GOLD)
        .setTitle('🏆 Ranking: papier, kamien, nozyce');

    if (entries.length === 0) {
        return embed.setDescription('Nikt jeszcze nie zagral. Zacznij pierwszy: `/pkn`!');
    }

    const lines = entries.map((entry, index) => {
        const place = MEDALS[index] ?? `**${index + 1}.**`;
        return `${place} <@${entry.userId}> - **${entry.wins}** W / ${entry.losses} P / ${entry.draws} R (${entry.winRate}%)`;
    });

    return embed.setDescription(lines.join('\n')).setFooter({ text: 'W = wygrane, P = porazki, R = remisy' });
}

export const pknrankingCommand = {
    data: new SlashCommandBuilder()
        .setName('pknranking')
        .setDescription('🏆 Pokaz ranking graczy w papier, kamien, nozyce')
        .setDMPermission(false),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guildId) {
            await interaction.reply({
                content: '❌ Ta komenda dziala tylko na serwerze.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply();

        try {
            const entries = await getPknRanking(interaction.guildId, PKN_RANKING_SIZE);
            await interaction.editReply({
                content: '',
                embeds: [buildPknRankingEmbed(entries)],
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            console.error('❌ Nie udalo sie wykonac /pknranking:', error);
            await interaction.editReply({ content: '❌ Wystapil blad podczas ladowania rankingu.', embeds: [] });
        }
    },
};
