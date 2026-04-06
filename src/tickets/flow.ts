import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    TextChannel,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import {
    DEV_ROLE_ID,
    SUPPORT_ROLE_IDS,
    SUPPORT_ACCESS_DENIED_MESSAGE,
    ensureSupportRole,
} from '../utils/role-access.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import { getGuildEmoji } from '../utils/guild-emojis.js';
import { formatTicketNumber, getNextTicketNumber, sanitizeTicketUsername } from './counter-store.js';
import {
    SUPPORT_CATEGORY_ID,
    TICKET_CLOSE_ADMIN_BUTTON_ID,
    TICKET_CLOSE_ADMIN_CANCEL_ID,
    TICKET_CLOSE_ADMIN_CONFIRM_ID,
    TICKET_CLOSE_ADMIN_REASON_FIELD,
    TICKET_CLOSE_ADMIN_REASON_MODAL_ID,
    TICKET_CLOSE_USER_BUTTON_ID,
    TICKET_CLOSE_USER_CANCEL_ID,
    TICKET_CLOSE_USER_CONFIRM_ID,
    TICKET_CLOSE_USER_DM_BUTTON_PREFIX,
    TICKET_CLOSE_USER_DM_CANCEL_PREFIX,
    TICKET_CLOSE_USER_DM_CONFIRM_PREFIX,
    TICKETS_CONFIG_DESCRIPTION_FIELD,
    TICKETS_CONFIG_MODAL_ID,
    TICKETS_OPEN_BUTTON_ID,
} from './constants.js';

const TICKET_TOPIC_OWNER_PREFIX = 'ticketOwnerId=';
const openTicketLocks = new Map<string, Promise<unknown>>();

async function withUserTicketOpenLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = openTicketLocks.get(key) ?? Promise.resolve();

    let result: T;
    const current = previous
        .catch(() => undefined)
        .then(async () => {
            result = await operation();
            return result;
        });

    openTicketLocks.set(key, current);

    try {
        const resolved = await current;
        return resolved as T;
    } finally {
        if (openTicketLocks.get(key) === current) {
            openTicketLocks.delete(key);
        }
    }
}

function isTicketChannel(channel: ModalSubmitInteraction['channel'] | ButtonInteraction['channel']): channel is TextChannel {
    return Boolean(
        channel
        && channel.type === ChannelType.GuildText
        && channel.parentId === SUPPORT_CATEGORY_ID
        && channel.name.startsWith('zgloszenie-'),
    );
}

function isGuildTextChannel(channel: unknown): channel is TextChannel {
    return Boolean(channel && typeof channel === 'object' && (channel as { type?: ChannelType }).type === ChannelType.GuildText);
}

function extractTicketOwnerId(topic: string | null): string | null {
    if (!topic) {
        return null;
    }

    const match = topic.match(/ticketOwnerId=(\d{17,20})/);
    return match ? match[1] : null;
}

function resolveHusariaEmoji(guild: ModalSubmitInteraction['guild'] | ButtonInteraction['guild']): string {
    return (
        getGuildEmoji(guild, 'G2Hussars')
        || getGuildEmoji(guild, 'g2hussars')
        || getGuildEmoji(guild, 'G2_Hussars')
        || '⚔️'
    );
}

function parseDynamicChannelId(customId: string, prefix: string): string | null {
    if (!customId.startsWith(`${prefix}:`)) {
        return null;
    }

    const [, channelId] = customId.split(':', 2);
    return /^\d{17,20}$/.test(channelId) ? channelId : null;
}

async function getOwnedTicketChannel(
    interaction: ButtonInteraction,
    channelId: string,
): Promise<TextChannel | null> {
    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText || channel.parentId !== SUPPORT_CATEGORY_ID) {
        return null;
    }

    const ownerId = extractTicketOwnerId(channel.topic);
    if (!ownerId || ownerId !== interaction.user.id) {
        return null;
    }

    return channel;
}

async function notifyTicketOwner(client: ButtonInteraction['client'], ownerId: string, content: string): Promise<void> {
    try {
        const owner = await client.users.fetch(ownerId);
        await owner.send(content);
    } catch {
        // Ignorujemy błąd DM i zamykamy ticket dalej.
    }
}

export function buildTicketsConfigModal(): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(TICKETS_CONFIG_MODAL_ID)
        .setTitle('⚙️ Konfiguracja Ticketów')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId(TICKETS_CONFIG_DESCRIPTION_FIELD)
                    .setLabel('Opis systemu ticketów')
                    .setPlaceholder('Opisz, kiedy i jak użytkownicy powinni otwierać ticket.')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(4000)
                    .setRequired(true),
            ),
        );
}

export async function handleTicketsConfigModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    if (!(await ensureSupportRole(interaction))) {
        return;
    }

    const panelDescription = interaction.fields.getTextInputValue(TICKETS_CONFIG_DESCRIPTION_FIELD).trim();
    const targetChannel = interaction.channel;
    const husariaEmoji = resolveHusariaEmoji(interaction.guild);

    if (!targetChannel?.isTextBased() || !('send' in targetChannel)) {
        await interaction.reply({
            content: '❌ Ten kanał nie obsługuje publikacji panelu ticketów.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const panelEmbed = new EmbedBuilder()
        .setColor(HusariaColors.RED)
        .setDescription(`# ${husariaEmoji} System pomocy G2 Hussars\n\n${panelDescription}`);

    await targetChannel.send({
        embeds: [panelEmbed],
        components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(TICKETS_OPEN_BUTTON_ID)
                    .setLabel('Otwórz ticket')
                    .setStyle(ButtonStyle.Success),
            ),
        ],
    });

    await interaction.reply({
        content: '✅ Panel ticketów został opublikowany.',
        flags: MessageFlags.Ephemeral,
    });
}

export async function handleOpenTicketButton(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) {
        await interaction.reply({
            content: '❌ Ticket można otworzyć tylko na serwerze.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const lockKey = `${interaction.guild.id}:${interaction.user.id}`;

    await withUserTicketOpenLock(lockKey, async () => {
        const allChannels = await interaction.guild!.channels.fetch();
        const existingChannel = Array.from(allChannels.values()).find(
            (candidate): candidate is TextChannel =>
                isGuildTextChannel(candidate)
                && candidate.parentId === SUPPORT_CATEGORY_ID
                && extractTicketOwnerId(candidate.topic) === interaction.user.id,
        );

        if (existingChannel) {
            await interaction.editReply({
                content: `ℹ️ Masz już otwarty ticket: <#${existingChannel.id}>`,
            });
            return;
        }

        const nextTicketNumber = await getNextTicketNumber();
        const ticketNumber = formatTicketNumber(nextTicketNumber);
        const usernamePart = sanitizeTicketUsername(interaction.user.username);
        const channelName = `zgloszenie-${usernamePart}-${ticketNumber}`.slice(0, 100);

        const permissionOverwrites = [
            {
                id: interaction.guild!.id,
                deny: [PermissionFlagsBits.ViewChannel],
            },
            {
                id: interaction.user.id,
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

        const botMemberId = interaction.guild!.members.me?.id;
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

        const createdChannel = await interaction.guild!.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: SUPPORT_CATEGORY_ID,
            topic: `${TICKET_TOPIC_OWNER_PREFIX}${interaction.user.id};ticketNumber=${ticketNumber}`,
            permissionOverwrites,
        });

        if (createdChannel.type !== ChannelType.GuildText) {
            await interaction.editReply({
                content: '❌ Nie udało się utworzyć ticketu.',
            });
            return;
        }

        const ticketEmbed = new EmbedBuilder()
            .setColor(HusariaColors.RED)
            .setDescription((() => {
                const supportMentions = SUPPORT_ROLE_IDS.map((roleId) => `<@&${roleId}>`).join(' ');
                const mentionSuffix = supportMentions.length > 0 ? `\n\n${supportMentions}` : '';
                return `Witaj, **${interaction.user.username}**. Opisz swój problem, niedługo skontaktuje się z tobą zespół administracyjny.${mentionSuffix}`;
            })());

        await createdChannel.send({
            embeds: [ticketEmbed],
            allowedMentions: { roles: SUPPORT_ROLE_IDS },
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

        await interaction.editReply({
            content: `✅ Ticket utworzony: <#${createdChannel.id}>`,
            components: [],
        });
    });
}

export async function handleUserCloseTicketButton(interaction: ButtonInteraction): Promise<void> {
    if (!isTicketChannel(interaction.channel)) {
        await interaction.reply({ content: '❌ Ten przycisk działa tylko w kanałach ticketów.', flags: MessageFlags.Ephemeral });
        return;
    }

    const ownerId = extractTicketOwnerId(interaction.channel.topic);
    if (!ownerId || ownerId !== interaction.user.id) {
        await interaction.reply({
            content: '🚫 Tylko autor ticketu może użyć tego przycisku.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.reply({
        content: 'Czy na pewno chcesz zamknąć ticket?',
        flags: MessageFlags.Ephemeral,
        components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(TICKET_CLOSE_USER_CONFIRM_ID)
                    .setLabel('Tak, zamknij ticket')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(TICKET_CLOSE_USER_CANCEL_ID)
                    .setLabel('Anuluj')
                    .setStyle(ButtonStyle.Secondary),
            ),
        ],
    });
}

export async function handleUserCloseTicketDmButton(interaction: ButtonInteraction): Promise<void> {
    const channelId = parseDynamicChannelId(interaction.customId, TICKET_CLOSE_USER_DM_BUTTON_PREFIX);
    if (!channelId) {
        await interaction.reply({ content: '❌ Nieprawidłowy identyfikator ticketu.', flags: MessageFlags.Ephemeral });
        return;
    }

    const ticketChannel = await getOwnedTicketChannel(interaction, channelId);
    if (!ticketChannel) {
        await interaction.reply({
            content: '🚫 Nie możesz zamknąć tego ticketu albo ticket już nie istnieje.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.reply({
        content: `Czy na pewno chcesz zamknąć ticket **${ticketChannel.name}**?`,
        flags: MessageFlags.Ephemeral,
        components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`${TICKET_CLOSE_USER_DM_CONFIRM_PREFIX}:${channelId}`)
                    .setLabel('Tak, zamknij ticket')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`${TICKET_CLOSE_USER_DM_CANCEL_PREFIX}:${channelId}`)
                    .setLabel('Anuluj')
                    .setStyle(ButtonStyle.Secondary),
            ),
        ],
    });
}

export async function handleUserCloseTicketConfirm(interaction: ButtonInteraction): Promise<void> {
    if (!isTicketChannel(interaction.channel)) {
        await interaction.reply({ content: '❌ Ten przycisk działa tylko w kanałach ticketów.', flags: MessageFlags.Ephemeral });
        return;
    }

    const ownerId = extractTicketOwnerId(interaction.channel.topic);
    if (!ownerId || ownerId !== interaction.user.id) {
        await interaction.reply({
            content: '🚫 Tylko autor ticketu może zamknąć ten ticket.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.update({ content: '🔒 Ticket zostanie zamknięty.', components: [] });

    const husariaEmoji = resolveHusariaEmoji(interaction.guild);

    await notifyTicketOwner(
        interaction.client,
        ownerId,
        `${husariaEmoji} **G2 Hussars**: Zamknąłeś ticket o nazwie **${interaction.channel.name}**.`,
    );

    await interaction.channel.delete('Ticket closed by owner');
}

export async function handleUserCloseTicketDmConfirm(interaction: ButtonInteraction): Promise<void> {
    const channelId = parseDynamicChannelId(interaction.customId, TICKET_CLOSE_USER_DM_CONFIRM_PREFIX);
    if (!channelId) {
        await interaction.reply({ content: '❌ Nieprawidłowy identyfikator ticketu.', flags: MessageFlags.Ephemeral });
        return;
    }

    const ticketChannel = await getOwnedTicketChannel(interaction, channelId);
    if (!ticketChannel) {
        await interaction.reply({
            content: '🚫 Nie możesz zamknąć tego ticketu albo ticket już nie istnieje.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.update({ content: '🔒 Ticket zostanie zamknięty.', components: [] });

    const husariaEmoji = resolveHusariaEmoji(ticketChannel.guild);
    await notifyTicketOwner(
        interaction.client,
        interaction.user.id,
        `${husariaEmoji} **G2 Hussars**: Zamknąłeś ticket o nazwie **${ticketChannel.name}**.`,
    );

    await ticketChannel.delete('Ticket closed by owner from private control');
}

export async function handleUserCloseTicketDmCancel(interaction: ButtonInteraction): Promise<void> {
    await interaction.update({ content: '❌ Anulowano zamykanie ticketu.', components: [] });
}

export async function handleUserCloseTicketCancel(interaction: ButtonInteraction): Promise<void> {
    await interaction.update({ content: '❌ Anulowano zamykanie ticketu.', components: [] });
}

export async function handleAdminCloseTicketButton(interaction: ButtonInteraction): Promise<void> {
    if (!(await ensureSupportRole(interaction, SUPPORT_ACCESS_DENIED_MESSAGE))) {
        return;
    }

    if (!isTicketChannel(interaction.channel)) {
        await interaction.reply({ content: '❌ Ten przycisk działa tylko w kanałach ticketów.', flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.reply({
        content: 'Czy na pewno chcesz zamknąć ten ticket jako administrator?',
        flags: MessageFlags.Ephemeral,
        components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(TICKET_CLOSE_ADMIN_CONFIRM_ID)
                    .setLabel('Tak, zamknij ticket')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(TICKET_CLOSE_ADMIN_CANCEL_ID)
                    .setLabel('Anuluj')
                    .setStyle(ButtonStyle.Secondary),
            ),
        ],
    });
}

export async function handleAdminCloseTicketConfirm(interaction: ButtonInteraction): Promise<void> {
    if (!(await ensureSupportRole(interaction, SUPPORT_ACCESS_DENIED_MESSAGE))) {
        return;
    }

    if (!isTicketChannel(interaction.channel)) {
        await interaction.reply({ content: '❌ Ten przycisk działa tylko w kanałach ticketów.', flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.showModal(
        new ModalBuilder()
            .setCustomId(TICKET_CLOSE_ADMIN_REASON_MODAL_ID)
            .setTitle('Powód zamknięcia ticketu')
            .addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId(TICKET_CLOSE_ADMIN_REASON_FIELD)
                        .setLabel('Podaj powód zamknięcia')
                        .setStyle(TextInputStyle.Paragraph)
                        .setMinLength(3)
                        .setMaxLength(1000)
                        .setRequired(true),
                ),
            ),
    );
}

export async function handleAdminCloseTicketCancel(interaction: ButtonInteraction): Promise<void> {
    if (!(await ensureSupportRole(interaction, SUPPORT_ACCESS_DENIED_MESSAGE))) {
        return;
    }

    if (!isTicketChannel(interaction.channel)) {
        await interaction.reply({ content: '❌ Ten przycisk działa tylko w kanałach ticketów.', flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.update({ content: '❌ Anulowano zamykanie ticketu.', components: [] });
}

export async function handleAdminCloseReasonModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    if (!(await ensureSupportRole(interaction, SUPPORT_ACCESS_DENIED_MESSAGE))) {
        return;
    }

    if (!isTicketChannel(interaction.channel)) {
        await interaction.reply({ content: '❌ Ten formularz działa tylko w kanałach ticketów.', flags: MessageFlags.Ephemeral });
        return;
    }

    const ownerId = extractTicketOwnerId(interaction.channel.topic);
    const reason = interaction.fields.getTextInputValue(TICKET_CLOSE_ADMIN_REASON_FIELD).trim();
    const husariaEmoji = resolveHusariaEmoji(interaction.guild);

    await interaction.reply({
        content: '🔒 Ticket zostanie zamknięty.',
        flags: MessageFlags.Ephemeral,
    });

    if (ownerId) {
        await notifyTicketOwner(
            interaction.client,
            ownerId,
            `${husariaEmoji} **G2 Hussars**: Ticket o nazwie **${interaction.channel.name}** został zamknięty przez <@${interaction.user.id}>. Powód: **${reason}**.`,
        );
    }

    await interaction.channel.delete(`Ticket closed by admin: ${interaction.user.tag}`);
}
