import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { startTttChallenge } from './ttt-game.js';

export const kkCommand = {
    data: new SlashCommandBuilder()
        .setName('kk')
        .setDescription('⭕ Zagraj w kolko i krzyzyk z wybrana osoba')
        .setDMPermission(false)
        .addUserOption((option) =>
            option
                .setName('osoba')
                .setDescription('Kogo chcesz wyzwac na pojedynek?')
                .setRequired(true),
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        await startTttChallenge(interaction);
    },
};
