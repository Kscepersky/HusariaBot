import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { replyWithShip } from './ship-reply.js';

export const shipCommand = {
    data: new SlashCommandBuilder()
        .setName('ship')
        .setDescription('💘 Sprawdz kompatybilnosc z wybrana osoba')
        .setDMPermission(false)
        .addUserOption((option) =>
            option
                .setName('osoba')
                .setDescription('Z kim chcesz sprawdzic kompatybilnosc?')
                .setRequired(true),
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        await replyWithShip(interaction, {
            first: interaction.user,
            second: interaction.options.getUser('osoba', true),
            title: 'Ship',
        });
    },
};
