import {
    ChatInputCommandInteraction,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { getOrdersByUser } from '../shop/repository.js';
import { buildUserOrdersEmbed, buildUserOrdersButtons, SHOP_ORDERS_PAGE_SIZE } from '../shop/shop-ui.js';

export const zamowieniaCommand = {
    data: new SlashCommandBuilder()
        .setName('zamowienia')
        .setDescription('📦 Sprawdź swoje zamówienia ze sklepu')
        .setDMPermission(false),

    async execute(interaction: ChatInputCommandInteraction) {
        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({ content: '❌ Ta komenda działa tylko na serwerze.', flags: MessageFlags.Ephemeral });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const ordersPage = await getOrdersByUser(guildId, interaction.user.id, 1, SHOP_ORDERS_PAGE_SIZE);
            const embed = buildUserOrdersEmbed(ordersPage);
            const buttons = buildUserOrdersButtons(ordersPage);

            await interaction.editReply({ embeds: [embed], components: [buttons] });
        } catch (error) {
            await interaction.editReply({ content: '❌ Nie udało się pobrać zamówień.' });
        }
    },
};
