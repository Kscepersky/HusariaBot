import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { startPknChallenge } from './pkn-game.js';

export const pknCommand = {
    data: new SlashCommandBuilder()
        .setName('pkn')
        .setDescription('🪨 Zagraj w papier, kamien, nozyce z wybrana osoba')
        .setDMPermission(false)
        .addUserOption((option) =>
            option
                .setName('osoba')
                .setDescription('Kogo chcesz wyzwac na pojedynek?')
                .setRequired(true),
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        await startPknChallenge(interaction);
    },
};
