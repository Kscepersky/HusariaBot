import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { startRrChallenge } from './rr-game.js';

export const rrCommand = {
    data: new SlashCommandBuilder()
        .setName('rr')
        .setDescription('🔫 Zagraj w rosyjska ruletke z wybrana osoba')
        .setDMPermission(false)
        .addUserOption((option) =>
            option
                .setName('osoba')
                .setDescription('Kogo chcesz wyzwac na pojedynek?')
                .setRequired(true),
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        await startRrChallenge(interaction);
    },
};
