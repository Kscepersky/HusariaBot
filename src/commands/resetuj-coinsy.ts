import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { ensureSupportRole } from '../utils/role-access.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import { buildEconomyResetButtons } from '../economy/admin-reset-buttons.js';

export const resetujCoinsyCommand = {
    data: new SlashCommandBuilder()
        .setName('resetuj-coinsy')
        .setDescription('♻️ Zresetuj coinsy uzytkownika (wymaga potwierdzenia)')
        .setDefaultMemberPermissions(null)
        .setDMPermission(false)
        .addUserOption((option) => {
            return option
                .setName('uzytkownik')
                .setDescription('Komu zresetowac coinsy')
                .setRequired(true);
        }),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!(await ensureSupportRole(interaction))) {
            return;
        }

        const targetUser = interaction.options.getUser('uzytkownik', true);

        const embed = new EmbedBuilder()
            .setColor(HusariaColors.GOLD)
            .setTitle('⚠️ Potwierdz reset coinsow')
            .setDescription(`Czy na pewno chcesz zresetowac coinsy uzytkownika <@${targetUser.id}>?`)
            .addFields({ name: 'Operacja', value: 'Reset coins do 0', inline: false });

        await interaction.reply({
            embeds: [embed],
            components: [buildEconomyResetButtons(targetUser.id, 'coins')],
            flags: MessageFlags.Ephemeral,
        });
    },
};
