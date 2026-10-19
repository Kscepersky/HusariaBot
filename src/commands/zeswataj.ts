import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { replyWithShip } from './ship-reply.js';

export const zeswatajCommand = {
    data: new SlashCommandBuilder()
        .setName('zeswataj')
        .setDescription('💞 Zeswataj dwie wybrane osoby i sprawdz ich kompatybilnosc')
        .setDMPermission(false)
        .addUserOption((option) =>
            option
                .setName('pierwsza')
                .setDescription('Pierwsza osoba do zeswatania')
                .setRequired(true),
        )
        .addUserOption((option) =>
            option
                .setName('druga')
                .setDescription('Druga osoba do zeswatania')
                .setRequired(true),
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        const matchmaker = interaction.user.globalName ?? interaction.user.username;

        await replyWithShip(interaction, {
            first: interaction.options.getUser('pierwsza', true),
            second: interaction.options.getUser('druga', true),
            title: 'Swatka',
            footerText: `Swatem jest ${matchmaker}`,
        });
    },
};
