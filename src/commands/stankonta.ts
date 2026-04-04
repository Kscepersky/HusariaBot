import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { getEconomyUserState } from '../economy/repository.js';
import { resolveEconomyGuildId } from '../economy/discord.js';
import { HusariaColors } from '../utils/husaria-theme.js';

export const stankontaCommand = {
    data: new SlashCommandBuilder()
        .setName('stankonta')
        .setDescription('🧅 Pokaz stan swoich coinow')
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

        try {
            const state = await getEconomyUserState(guildId, interaction.user.id, Date.now());
            const embed = new EmbedBuilder()
                .setColor(HusariaColors.RED)
                .setTitle('💰 Stan konta')
                .setDescription(`Masz obecnie **${state.coins}** coinow.`)
                .setTimestamp();

            await interaction.editReply({ content: '', embeds: [embed] });
        } catch (error) {
            console.error('❌  Nie udalo sie wykonac /stankonta:', error);
            await interaction.editReply({
                content: '❌ Wystapil blad podczas pobierania stanu konta.',
                embeds: [],
            });
        }
    },
};
