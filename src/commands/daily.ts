import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { claimDailyReward } from '../economy/repository.js';
import { formatDurationFromMs, resolveEconomyGuildId } from '../economy/discord.js';
import { HusariaColors } from '../utils/husaria-theme.js';

export const dailyCommand = {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('🧅 Odbierz dzienne cebuliony')
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

        await interaction.deferReply();

        let result;
        try {
            result = await claimDailyReward({
                guildId,
                userId: interaction.user.id,
                displayName: `<@${interaction.user.id}>`,
                nowTimestamp: Date.now(),
            });
        } catch (error) {
            console.error('❌  Nie udalo sie wykonac /daily:', error);
            await interaction.editReply({
                content: '❌ Wystapil blad podczas odbierania /daily.',
                embeds: [],
            });
            return;
        }

        if (result.status === 'cooldown') {
            const retryAtUnix = Math.floor(result.retryAt / 1000);
            const embed = new EmbedBuilder()
                .setColor(HusariaColors.LIGHT_GRAY)
                .setTitle('🧅 /daily jeszcze na cooldownie')
                .setDescription('Wroc pozniej po kolejne cebuliony.')
                .addFields(
                    {
                        name: 'Nastepny claim',
                        value: `<t:${retryAtUnix}:F> (<t:${retryAtUnix}:R>)`,
                        inline: false,
                    },
                    {
                        name: 'Pozostalo',
                        value: formatDurationFromMs(result.remainingMs),
                        inline: true,
                    },
                    {
                        name: 'Obecny streak',
                        value: String(result.streak),
                        inline: true,
                    },
                    {
                        name: 'Mnoznik',
                        value: `x${result.multiplier.toFixed(2)}`,
                        inline: true,
                    },
                );

            await interaction.editReply({ embeds: [embed], content: '' });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(HusariaColors.RED)
            .setTitle('🧅 Daily odebrane!')
            .setDescription(result.message)
            .addFields(
                { name: 'Przyznano', value: `${result.coinsAwarded}`, inline: true },
                { name: 'Streak', value: `${result.streak} (${result.multiplier.toFixed(2)}x)`, inline: true },
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed], content: '' });
    },
};
