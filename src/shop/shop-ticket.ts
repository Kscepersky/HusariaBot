import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Client,
    EmbedBuilder,
    Guild,
    PermissionFlagsBits,
    TextChannel,
    User,
} from 'discord.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import { createLogger } from '../utils/logger.js';
import { sanitizeTicketUsername } from '../tickets/counter-store.js';
import {
    SUPPORT_CATEGORY_ID,
    TICKET_CLOSE_ADMIN_BUTTON_ID,
    TICKET_CLOSE_USER_BUTTON_ID,
} from '../tickets/constants.js';
import { SUPPORT_ROLE_IDS, DEV_ROLE_ID } from '../utils/role-access.js';
import type { ShopOrder } from './types.js';

const shopTicketLogger = createLogger('shop:ticket');

export async function createOrderTicket(
    client: Client,
    guild: Guild,
    order: ShopOrder,
    user: User,
): Promise<TextChannel | null> {
    const usernamePart = sanitizeTicketUsername(user.username);
    const channelName = `zamowienie-${usernamePart}-${order.id}`.slice(0, 100);

    const permissionOverwrites: {
        id: string;
        allow?: bigint[];
        deny?: bigint[];
    }[] = [
        {
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel],
        },
        {
            id: user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks,
            ],
        },
        ...SUPPORT_ROLE_IDS.map((roleId) => ({
            id: roleId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageMessages,
            ],
        })),
    ];

    if (DEV_ROLE_ID && !SUPPORT_ROLE_IDS.includes(DEV_ROLE_ID)) {
        permissionOverwrites.push({
            id: DEV_ROLE_ID,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageMessages,
            ],
        });
    }

    const botMemberId = guild.members.me?.id;
    if (botMemberId) {
        permissionOverwrites.push({
            id: botMemberId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages,
            ],
        });
    }

    try {
        const channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: SUPPORT_CATEGORY_ID,
            topic: `ticketOwnerId=${user.id};orderId=${order.id}`,
            permissionOverwrites,
        });

        if (channel.type !== ChannelType.GuildText) {
            return null;
        }

        const supportMentions = SUPPORT_ROLE_IDS.map((id) => `<@&${id}>`).join(' ');

        const embed = new EmbedBuilder()
            .setColor(HusariaColors.GOLD)
            .setTitle('🛒 Nowe zamówienie')
            .setDescription(
                `Witaj, <@${user.id}>. Zakupiłeś **${order.itemNameSnapshot}**. ` +
                `Administracja wkrótce się z tobą skontaktuje.\n\n` +
                `**Nr zamówienia:** #${order.id} | **Cena:** ${order.itemPriceSnapshot} 🧅`,
            )
            .setTimestamp();

        await channel.send({
            content: supportMentions.length > 0 ? supportMentions : undefined,
            embeds: [embed],
            allowedMentions: { users: [user.id], roles: SUPPORT_ROLE_IDS },
            components: [
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder()
                        .setCustomId(TICKET_CLOSE_USER_BUTTON_ID)
                        .setLabel('Zamknij ticket')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(TICKET_CLOSE_ADMIN_BUTTON_ID)
                        .setLabel('Zamknij Ticket (Administracja)')
                        .setStyle(ButtonStyle.Danger),
                ),
            ],
        });

        shopTicketLogger.info('SHOP_ORDER_TICKET_CREATED', 'Utworzono kanał zamówienia.', {
            channelId: channel.id,
            channelName,
            orderId: order.id,
            userId: user.id,
        });

        return channel;
    } catch (error) {
        shopTicketLogger.error('SHOP_ORDER_TICKET_FAILED', 'Nie udało się utworzyć kanału zamówienia.', {
            orderId: order.id,
            userId: user.id,
        }, error);
        return null;
    }
}
