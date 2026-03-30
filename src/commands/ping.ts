import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { HusariaColors } from '../utils/husaria-theme.js';

export const pingCommand = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('🏓 Sprawdź czy bot żyje i jaką ma latencję'),

    async execute(interaction: ChatInputCommandInteraction) {
        const response = await interaction.reply({
            content: '🏓 Pinguję...',
            withResponse: true,
        });

        const sent = response.resource!.message!;
        const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
        const wsLatency = interaction.client.ws.ping;

        const embed = new EmbedBuilder()
            .setColor(HusariaColors.RED)
            .setTitle('🏓 Pong!')
            .addFields(
                { name: '⏱️ Round-trip', value: `\`${roundtrip}ms\``, inline: true },
                { name: '💓 WebSocket', value: `\`${wsLatency}ms\``, inline: true },
            )
            .setFooter({ text: 'HusariaBot' })
            .setTimestamp();

        await interaction.editReply({ content: '', embeds: [embed] });
    },
};
