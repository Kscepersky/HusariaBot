import {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
} from 'discord.js';
import { getShopItemsPage } from '../shop/repository.js';
import { buildShopBrowseEmbed, buildShopBrowseButtons, SHOP_PAGE_SIZE } from '../shop/shop-ui.js';

export const sklepCommand = {
    data: new SlashCommandBuilder()
        .setName('sklep')
        .setDescription('🛒 Przeglądaj przedmioty dostępne w sklepie')
        .setDMPermission(false),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        try {
            const page = await getShopItemsPage(1, SHOP_PAGE_SIZE, false);
            const embed = buildShopBrowseEmbed(page);
            const buttons = buildShopBrowseButtons(page);

            await interaction.editReply({ embeds: [embed], components: [buttons] });
        } catch (error) {
            await interaction.editReply({ content: '❌ Nie udało się załadować sklepu.' });
        }
    },
};
