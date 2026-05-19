import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} from 'discord.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import type { ShopItem, ShopOrder, ShopOrdersPage, ShopItemsPage } from './types.js';

export const SHOP_PAGE_SIZE = 10;
export const SHOP_ORDERS_PAGE_SIZE = 10;

const SHOP_BROWSE_PREFIX = 'shop_browse';
const SHOP_CONFIRM_BUY_PREFIX = 'shop_confirm_buy';
const SHOP_CANCEL_BUY_PREFIX = 'shop_cancel_buy';
const SHOP_ORDERS_PREFIX = 'shop_orders';

export function buildShopBrowseCustomId(page: number): string {
    return `${SHOP_BROWSE_PREFIX}:${page}`;
}

export function parseShopBrowseCustomId(customId: string): { page: number } | null {
    if (!customId.startsWith(`${SHOP_BROWSE_PREFIX}:`)) return null;
    const parts = customId.split(':');
    if (parts.length !== 2) return null;
    const page = Number.parseInt(parts[1] ?? '', 10);
    if (!Number.isFinite(page) || page < 1) return null;
    return { page };
}

export function buildShopConfirmBuyCustomId(itemId: number): string {
    return `${SHOP_CONFIRM_BUY_PREFIX}:${itemId}`;
}

export function parseShopConfirmBuyCustomId(customId: string): { itemId: number } | null {
    if (!customId.startsWith(`${SHOP_CONFIRM_BUY_PREFIX}:`)) return null;
    const parts = customId.split(':');
    if (parts.length !== 2) return null;
    const itemId = Number.parseInt(parts[1] ?? '', 10);
    if (!Number.isFinite(itemId)) return null;
    return { itemId };
}

export function buildShopCancelBuyCustomId(itemId: number): string {
    return `${SHOP_CANCEL_BUY_PREFIX}:${itemId}`;
}

export function parseShopCancelBuyCustomId(customId: string): { itemId: number } | null {
    if (!customId.startsWith(`${SHOP_CANCEL_BUY_PREFIX}:`)) return null;
    const parts = customId.split(':');
    if (parts.length !== 2) return null;
    const itemId = Number.parseInt(parts[1] ?? '', 10);
    if (!Number.isFinite(itemId)) return null;
    return { itemId };
}

export function buildShopOrdersCustomId(page: number): string {
    return `${SHOP_ORDERS_PREFIX}:${page}`;
}

export function parseShopOrdersCustomId(customId: string): { page: number } | null {
    if (!customId.startsWith(`${SHOP_ORDERS_PREFIX}:`)) return null;
    const parts = customId.split(':');
    if (parts.length !== 2) return null;
    const page = Number.parseInt(parts[1] ?? '', 10);
    if (!Number.isFinite(page) || page < 1) return null;
    return { page };
}

function formatItemStock(item: ShopItem): string {
    if (!item.isActive) return '❌ Niedostępny';
    if (item.stock === 0) return '∞ Nieograniczona';
    return `${item.stock} szt.`;
}

export function buildShopBrowseEmbed(data: ShopItemsPage): EmbedBuilder {
    const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

    const embed = new EmbedBuilder()
        .setColor(HusariaColors.RED)
        .setTitle('🛒 Sklep G2 Hussars')
        .setFooter({ text: `Strona ${data.page}/${totalPages} | Przedmiotów: ${data.total}` })
        .setTimestamp();

    if (data.items.length === 0) {
        embed.setDescription('Brak przedmiotów w sklepie.');
        return embed;
    }

    const lines = data.items.map((item) => {
        const availability = formatItemStock(item);
        return [
            `**[#${item.id}] ${item.name}** — ${item.price} 🧅`,
            `${item.description}`,
            `Ilość: ${availability}`,
        ].join('\n');
    });

    embed.setDescription(lines.join('\n\n'));
    return embed;
}

export function buildShopBrowseButtons(data: ShopItemsPage): ActionRowBuilder<ButtonBuilder> {
    const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    const hasPrev = data.page > 1;
    const hasNext = data.page < totalPages;

    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(buildShopBrowseCustomId(data.page - 1))
            .setLabel('⬅️ Poprzednia')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasPrev),
        new ButtonBuilder()
            .setCustomId(buildShopBrowseCustomId(data.page + 1))
            .setLabel('Następna ➡️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasNext),
    );
}

export function buildPurchaseConfirmEmbed(item: ShopItem, userCoins: number): EmbedBuilder {
    const afterPurchase = userCoins - item.price;
    return new EmbedBuilder()
        .setColor(HusariaColors.GOLD)
        .setTitle('🛒 Potwierdzenie zakupu')
        .setDescription(
            `Czy chcesz kupić **${item.name}** za **${item.price}** 🧅?\n\n` +
            `**Opis:** ${item.description}\n` +
            `**Twój stan konta:** ${userCoins} 🧅\n` +
            `**Po zakupie:** ${afterPurchase} 🧅`
        )
        .setFooter({ text: 'Masz 60 sekund na potwierdzenie.' })
        .setTimestamp();
}

export function buildPurchaseConfirmButtons(itemId: number): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(buildShopConfirmBuyCustomId(itemId))
            .setLabel('✅ Potwierdź')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(buildShopCancelBuyCustomId(itemId))
            .setLabel('❌ Anuluj')
            .setStyle(ButtonStyle.Danger),
    );
}

function formatOrderStatus(status: ShopOrder['status']): string {
    switch (status) {
        case 'pending': return '🕐 Złożone';
        case 'completed': return '✅ Zrealizowane';
        case 'cancelled': return '❌ Anulowane';
    }
}

export function buildUserOrdersEmbed(data: ShopOrdersPage): EmbedBuilder {
    const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

    const embed = new EmbedBuilder()
        .setColor(HusariaColors.RED)
        .setTitle('📦 Twoje zamówienia')
        .setFooter({ text: `Strona ${data.page}/${totalPages} | Zamówień: ${data.total}` })
        .setTimestamp();

    if (data.orders.length === 0) {
        embed.setDescription('Nie masz żadnych zamówień.');
        return embed;
    }

    const lines = data.orders.map((order) => {
        const date = new Date(order.createdAt).toLocaleDateString('pl-PL');

        return [
            `**Zamówienie #${order.id}** — ${formatOrderStatus(order.status)}`,
            `Przedmiot: **${order.itemNameSnapshot}** | Cena: ${order.itemPriceSnapshot} 🧅`,
            `Data: ${date}`,
        ].join('\n');
    });

    embed.setDescription(lines.join('\n\n'));
    return embed;
}

export function buildUserOrdersButtons(data: ShopOrdersPage): ActionRowBuilder<ButtonBuilder> {
    const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    const hasPrev = data.page > 1;
    const hasNext = data.page < totalPages;

    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(buildShopOrdersCustomId(data.page - 1))
            .setLabel('⬅️ Poprzednia')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasPrev),
        new ButtonBuilder()
            .setCustomId(buildShopOrdersCustomId(data.page + 1))
            .setLabel('Następna ➡️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasNext),
    );
}
