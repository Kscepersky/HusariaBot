import type { ButtonInteraction } from 'discord.js';
import {
    getShopItemsPage,
    getOrdersByUser,
    purchaseShopItem,
} from './repository.js';
import {
    buildShopBrowseEmbed,
    buildShopBrowseButtons,
    buildPurchaseConfirmEmbed,
    buildPurchaseConfirmButtons,
    buildUserOrdersEmbed,
    buildUserOrdersButtons,
    parseShopBrowseCustomId,
    parseShopConfirmBuyCustomId,
    parseShopCancelBuyCustomId,
    parseShopOrdersCustomId,
    SHOP_PAGE_SIZE,
    SHOP_ORDERS_PAGE_SIZE,
} from './shop-ui.js';
import { createOrderTicket } from './shop-ticket.js';
import { createLogger } from '../utils/logger.js';

const shopLogger = createLogger('shop:buttons');

export async function handleShopButton(interaction: ButtonInteraction): Promise<boolean> {
    const { customId } = interaction;
    const guildId = interaction.guildId;

    if (!guildId) return false;

    const browseParsed = parseShopBrowseCustomId(customId);
    if (browseParsed) {
        await handleShopBrowsePage(interaction, guildId, browseParsed.page);
        return true;
    }

    const confirmParsed = parseShopConfirmBuyCustomId(customId);
    if (confirmParsed) {
        await handleConfirmPurchase(interaction, guildId, confirmParsed.itemId);
        return true;
    }

    const cancelParsed = parseShopCancelBuyCustomId(customId);
    if (cancelParsed) {
        await handleCancelPurchase(interaction);
        return true;
    }

    const ordersParsed = parseShopOrdersCustomId(customId);
    if (ordersParsed) {
        await handleShopOrdersPage(interaction, guildId, ordersParsed.page);
        return true;
    }

    return false;
}

async function handleShopBrowsePage(interaction: ButtonInteraction, guildId: string, page: number): Promise<void> {
    try {
        const pageData = await getShopItemsPage(page, SHOP_PAGE_SIZE, false);
        await interaction.update({
            embeds: [buildShopBrowseEmbed(pageData)],
            components: [buildShopBrowseButtons(pageData)],
        });
    } catch (error) {
        shopLogger.error('SHOP_BROWSE_PAGE_ERROR', 'Błąd podczas zmiany strony sklepu.', { guildId, page }, error);
        await interaction.update({ content: '❌ Błąd podczas ładowania sklepu.', embeds: [], components: [] });
    }
}

async function handleConfirmPurchase(interaction: ButtonInteraction, guildId: string, itemId: number): Promise<void> {
    await interaction.deferUpdate();

    if (!checkAndSetPurchaseCooldown(interaction.user.id)) {
        await interaction.editReply({ content: '⏳ Poczekaj chwilę przed kolejnym zakupem.', embeds: [], components: [] });
        return;
    }

    try {
        const result = await purchaseShopItem({
            guildId,
            userId: interaction.user.id,
            itemId,
        });

        if (!result.success) {
            const message = resolvePurchaseErrorMessage(result.reason);
            await interaction.editReply({ content: message, embeds: [], components: [] });
            return;
        }

        await interaction.editReply({
            content: `✅ Zakup zakończony pomyślnie! Zamówienie **#${result.order.id}**.\nTwój nowy stan konta: **${result.newBalance}** 🧅`,
            embeds: [],
            components: [],
        });

        if (interaction.guild) {
            void createOrderTicket(interaction.client, interaction.guild, result.order, interaction.user).catch((err) => {
                shopLogger.error('SHOP_TICKET_CREATE_ERROR', 'Nie udało się utworzyć ticketu zamówienia.', {
                    orderId: result.order.id,
                    userId: interaction.user.id,
                }, err);
            });
        }
    } catch (error) {
        shopLogger.error('SHOP_CONFIRM_PURCHASE_ERROR', 'Błąd podczas realizacji zakupu.', { guildId, itemId }, error);
        await interaction.editReply({ content: '❌ Wystąpił błąd podczas zakupu.', embeds: [], components: [] });
    }
}

async function handleCancelPurchase(interaction: ButtonInteraction): Promise<void> {
    await interaction.update({ content: '❌ Zakup anulowany.', embeds: [], components: [] });
}

async function handleShopOrdersPage(interaction: ButtonInteraction, guildId: string, page: number): Promise<void> {
    try {
        const ordersPage = await getOrdersByUser(guildId, interaction.user.id, page, SHOP_ORDERS_PAGE_SIZE);
        await interaction.update({
            embeds: [buildUserOrdersEmbed(ordersPage)],
            components: [buildUserOrdersButtons(ordersPage)],
        });
    } catch (error) {
        shopLogger.error('SHOP_ORDERS_PAGE_ERROR', 'Błąd podczas zmiany strony zamówień.', { guildId, page }, error);
        await interaction.update({ content: '❌ Błąd podczas ładowania zamówień.', embeds: [], components: [] });
    }
}

const purchaseCooldowns = new Map<string, number>();
const PURCHASE_COOLDOWN_MS = 5_000;

function checkAndSetPurchaseCooldown(userId: string): boolean {
    const now = Date.now();
    const last = purchaseCooldowns.get(userId);
    if (last !== undefined && now - last < PURCHASE_COOLDOWN_MS) return false;
    purchaseCooldowns.set(userId, now);
    setTimeout(() => purchaseCooldowns.delete(userId), PURCHASE_COOLDOWN_MS);
    return true;
}

export function resolvePurchaseErrorMessage(reason: string): string {
    switch (reason) {
        case 'insufficient_funds': return '❌ Nie masz wystarczającej liczby cebulionów.';
        case 'out_of_stock': return '❌ Przedmiot jest wyprzedany.';
        case 'item_not_found': return '❌ Przedmiot nie istnieje.';
        case 'item_inactive': return '❌ Przedmiot jest niedostępny.';
        case 'limit_reached': return '❌ Osiągnąłeś limit zakupów tego przedmiotu.';
        default: return '❌ Wystąpił błąd podczas zakupu.';
    }
}
