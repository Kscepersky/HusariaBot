import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { getDailyStreakSummary } from '../economy/repository.js';
import { resolveEconomyGuildId } from '../economy/discord.js';
import { HusariaColors } from '../utils/husaria-theme.js';

export const streakDailyCommand = {
    data: new SlashCommandBuilder()
        .setName('streak-daily')
        .setDescription('📈 Pokaz obecny streak i mnoznik daily')
        .setDMPermission(false),

    async execute(interaction: ChatInputCommandInteraction) {
        const guildId = resolveEconomyGuildId(interaction);
        if (!guildId) {
            await interaction.reply({
                content: '❌ Nie mozna ustalic serwera dla ekonomii.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let summary;
        try {
            summary = await getDailyStreakSummary(guildId, interaction.user.id, Date.now());
        } catch (error) {
            console.error('❌  Nie udalo sie wykonac /streak-daily:', error);
            await interaction.editReply({
                content: '❌ Wystapil blad podczas pobierania streaku.',
                embeds: [],
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(HusariaColors.RED)
            .setTitle('📈 Twoj streak /daily')
            .addFields(
                {
                    name: 'Obecny streak',
                    value: `${summary.streak}`,
                    inline: true,
                },
                {
                    name: 'Mnoznik',
                    value: `x${summary.multiplier.toFixed(2)}`,
                    inline: true,
                },
                {
                    name: 'Status claimu',
                    value: summary.canClaimNow ? 'Mozesz odebrac /daily teraz' : 'Poczekaj na cooldown',
                    inline: false,
                },
            )
            .setTimestamp();

        if (summary.lastClaimAt) {
            const lastClaimUnix = Math.floor(summary.lastClaimAt / 1000);
            embed.addFields({
                name: 'Ostatni claim',
                value: `<t:${lastClaimUnix}:F> (<t:${lastClaimUnix}:R>)`,
                inline: false,
            });
        }

        if (summary.nextClaimAt) {
            const nextClaimUnix = Math.floor(summary.nextClaimAt / 1000);
            embed.addFields({
                name: 'Nastepny claim',
                value: `<t:${nextClaimUnix}:F> (<t:${nextClaimUnix}:R>)`,
                inline: false,
            });
        }

        await interaction.editReply({ embeds: [embed], content: '' });
    },
};
