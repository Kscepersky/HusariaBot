import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { ensureSupportRole } from '../utils/role-access.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import { buildEconomyResetButtons } from '../economy/admin-reset-buttons.js';

export const resetujLevelCommand = {
    data: new SlashCommandBuilder()
        .setName('resetuj-level')
        .setDescription('♻️ Zresetuj level i XP uzytkownika (wymaga potwierdzenia)')
        .setDefaultMemberPermissions(null)
        .setDMPermission(false)
        .addUserOption((option) => {
            return option
                .setName('uzytkownik')
                .setDescription('Komu zresetowac level i XP')
                .setRequired(true);
        }),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!(await ensureSupportRole(interaction))) {
            return;
        }

        const targetUser = interaction.options.getUser('uzytkownik', true);

        const embed = new EmbedBuilder()
            .setColor(HusariaColors.GOLD)
            .setTitle('⚠️ Potwierdz reset levela')
            .setDescription(`Czy na pewno chcesz zresetowac level i XP uzytkownika <@${targetUser.id}>?`)
            .addFields({ name: 'Operacja', value: 'Reset level i XP do 0', inline: false });

        await interaction.reply({
            embeds: [embed],
            components: [buildEconomyResetButtons(targetUser.id, 'level')],
            flags: MessageFlags.Ephemeral,
        });
    },
};
