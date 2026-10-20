import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { getTttRanking, type TttPlayerStats } from '../economy/ttt-store.js';
import { HusariaColors } from '../utils/husaria-theme.js';

export const TTT_RANKING_SIZE = 10;
const MEDALS = ['🥇', '🥈', '🥉'] as const;

export function buildTttRankingEmbed(entries: readonly TttPlayerStats[]): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor(HusariaColors.GOLD)
        .setTitle('🏆 Ranking: kolko i krzyzyk');

    if (entries.length === 0) {
        return embed.setDescription('Nikt jeszcze nie zagral. Zacznij pierwszy: `/kk`!');
    }

    const lines = entries.map((entry, index) => {
        const place = MEDALS[index] ?? `**${index + 1}.**`;
        return `${place} <@${entry.userId}> - **${entry.wins}** W / ${entry.losses} P / ${entry.draws} R (${entry.winRate}%)`;
    });

    return embed.setDescription(lines.join('\n')).setFooter({ text: 'W = wygrane, P = porazki, R = remisy' });
}

export const kkrankingCommand = {
    data: new SlashCommandBuilder()
        .setName('kkranking')
        .setDescription('🏆 Pokaz ranking graczy w kolko i krzyzyk')
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
            const entries = await getTttRanking(interaction.guildId, TTT_RANKING_SIZE);
            await interaction.editReply({
                content: '',
                embeds: [buildTttRankingEmbed(entries)],
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            console.error('❌ Nie udalo sie wykonac /kkranking:', error);
            await interaction.editReply({ content: '❌ Wystapil blad podczas ladowania rankingu.', embeds: [] });
        }
    },
};
