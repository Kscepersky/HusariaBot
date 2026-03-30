import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { ensureSupportRole } from '../utils/role-access.js';
import { buildTicketsConfigModal } from '../tickets/flow';

export const ticketyConfigCommand = {
    data: new SlashCommandBuilder()
        .setName('ticketyconfig')
        .setDescription('🛠️ Skonfiguruj i opublikuj panel systemu ticketów')
        .setDefaultMemberPermissions(null),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!(await ensureSupportRole(interaction))) {
            return;
        }

        await interaction.showModal(buildTicketsConfigModal());
    },
};
