import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags,
    PermissionFlagsBits,
    type ButtonInteraction,
    type Guild,
    type GuildMember,
    type OverwriteResolvable,
    type PartialGuildMember,
    type TextChannel,
} from 'discord.js';
import { SUPPORT_CATEGORY_ID } from '../tickets/constants.js';
import { archiveTicketClosure } from '../tickets/flow.js';
import { getAdminRoleIds } from '../moderation/admin-roles.js';
import { createLogger } from '../utils/logger.js';
import {
    VERIFICATION_APPROVE_BUTTON_ID,
    VERIFICATION_BUTTON_IDS,
    VERIFICATION_REJECT_BUTTON_ID,
    VERIFICATION_REJECT_CANCEL_ID,
    VERIFICATION_REJECT_CONFIRM_ID,
} from './constants.js';
import { buildVerificationButtons, buildVerificationEmbed, type VerificationProfile } from './embed.js';
import {
    buildVerificationChannelName,
    buildVerificationTopic,
    canResolveVerification,
    extractVerificationUserId,
    getMinAccountAgeDays,
    getVerificationRoleId,
    requiresVerification,
    VERIFICATION_CHANNEL_PREFIX,
} from './logic.js';

/** Po decyzji kanal zostaje chwile, zeby administracja widziala wynik. */
export const VERIFICATION_CLOSE_DELAY_MS = 10_000;
const REJECT_BAN_REASON = 'Negatywna weryfikacja nowego konta';

const verificationLogger = createLogger('verification:flow');
const pendingJoins = new Set<string>();
const decisionsInProgress = new Set<string>();

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function isVerificationChannel(channel: unknown): channel is TextChannel {
    const candidate = channel as TextChannel | null;
    return Boolean(
        candidate
        && candidate.type === ChannelType.GuildText
        && candidate.parentId === SUPPORT_CATEGORY_ID
        && candidate.name.startsWith(VERIFICATION_CHANNEL_PREFIX),
    );
}

async function findVerificationChannel(guild: Guild, userId: string): Promise<TextChannel | null> {
    const channels = await guild.channels.fetch();
    const match = [...channels.values()].find(
        (channel) => isVerificationChannel(channel) && extractVerificationUserId(channel.topic) === userId,
    );
    return (match as TextChannel | undefined) ?? null;
}

export function toVerificationProfile(member: GuildMember): VerificationProfile {
    const { user } = member;
    return {
        userId: user.id,
        username: user.username,
        globalName: user.globalName ?? null,
        avatarUrl: user.displayAvatarURL({ size: 256 }),
        hasCustomAvatar: Boolean(user.avatar),
        createdTimestamp: user.createdTimestamp,
        joinedTimestamp: member.joinedTimestamp ?? null,
        isBot: user.bot,
        badges: user.flags?.toArray() ?? [],
    };
}

function buildPermissionOverwrites(guild: Guild, userId: string, adminRoleIds: readonly string[]): OverwriteResolvable[] {
    const memberAccess = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
    ];
    const staffAccess = [...memberAccess, PermissionFlagsBits.ManageMessages];
    const overwrites: OverwriteResolvable[] = [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: userId, allow: memberAccess },
        // Nieistniejaca rola w overwrite blokuje utworzenie kanalu - bierzemy tylko te z serwera.
        ...adminRoleIds.filter((roleId) => guild.roles.cache.has(roleId)).map((roleId) => ({ id: roleId, allow: staffAccess })),
    ];
    const botId = guild.members.me?.id;
    if (botId) {
        overwrites.push({ id: botId, allow: [...staffAccess, PermissionFlagsBits.ManageChannels] });
    }
    return overwrites;
}

async function openVerificationTicket(member: GuildMember, now: number): Promise<void> {
    const { guild } = member;
    if (await findVerificationChannel(guild, member.id)) {
        return;
    }

    const adminRoleIds = getAdminRoleIds();
    const channel = await guild.channels.create({
        name: buildVerificationChannelName(member.user.username),
        type: ChannelType.GuildText,
        parent: SUPPORT_CATEGORY_ID,
        topic: buildVerificationTopic(member.id),
        permissionOverwrites: buildPermissionOverwrites(guild, member.id, adminRoleIds),
    });

    const pings = adminRoleIds.map((roleId) => `<@&${roleId}>`).join(' ');
    await channel.send({
        content: `${pings}\nNowe konto <@${member.id}> czeka na weryfikację.`.trim(),
        embeds: [buildVerificationEmbed(toVerificationProfile(member), now, getMinAccountAgeDays())],
        components: [buildVerificationButtons()],
        allowedMentions: { roles: adminRoleIds, users: [member.id] },
    });

    verificationLogger.info('VERIFICATION_TICKET_OPENED', 'Utworzono ticket weryfikacyjny.', {
        guildId: guild.id,
        channelId: channel.id,
        targetUserId: member.id,
    });
}

/** Nowe konta (< progu dni) dostaja range weryfikacji i ticket z decyzja dla administracji. */
export async function handleVerificationMemberJoin(member: GuildMember, now: number = Date.now()): Promise<void> {
    const roleId = getVerificationRoleId();
    if (!roleId || member.user.bot) {
        return;
    }
    if (!requiresVerification(member.user.createdTimestamp, now, getMinAccountAgeDays())) {
        return;
    }

    const lockKey = `${member.guild.id}:${member.id}`;
    if (pendingJoins.has(lockKey)) {
        return;
    }
    pendingJoins.add(lockKey);

    try {
        await member.roles.add(roleId, 'Weryfikacja nowego konta');
        await openVerificationTicket(member, now);
    } finally {
        pendingJoins.delete(lockKey);
    }
}

async function closeVerificationChannel(channel: TextChannel, subjectUserId: string, reason: string, closedBy: { id: string; tag: string }): Promise<void> {
    try {
        await archiveTicketClosure({
            channel,
            ownerId: subjectUserId,
            closeType: 'admin',
            closeReason: reason,
            closedByUserId: closedBy.id,
            closedByTag: closedBy.tag,
        });
    } catch {
        await channel.send('❌ Nie udało się zapisać historii weryfikacji. Kanał nie został usunięty.').catch(() => undefined);
        return;
    }
    if (channel.deletable) {
        await channel.delete(reason).catch((error: unknown) => {
            verificationLogger.error('VERIFICATION_CHANNEL_DELETE_FAILED', 'Nie udalo sie usunac kanalu weryfikacji.', {
                channelId: channel.id,
            }, error);
        });
    }
}

/** Gdy weryfikowany wyjdzie z serwera, sprzatamy jego ticket (chyba ze trwa decyzja - np. ban). */
export async function handleVerificationMemberLeave(member: GuildMember | PartialGuildMember): Promise<void> {
    if (!getVerificationRoleId()) {
        return;
    }
    const channel = await findVerificationChannel(member.guild, member.id);
    if (!channel || decisionsInProgress.has(channel.id)) {
        return;
    }
    const botUser = member.guild.client.user;
    await closeVerificationChannel(channel, member.id, 'Użytkownik opuścił serwer przed weryfikacją.', {
        id: botUser?.id ?? 'bot',
        tag: botUser?.tag ?? 'HusariaBot',
    });
}

async function isAuthorizedActor(interaction: ButtonInteraction, subjectUserId: string): Promise<boolean> {
    const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
        return false;
    }
    return canResolveVerification({
        actorId: member.id,
        actorRoleIds: [...member.roles.cache.keys()],
        actorIsAdministrator: member.permissions.has(PermissionFlagsBits.Administrator),
    }, subjectUserId);
}

function disabledDecisionRow(): ActionRowBuilder<ButtonBuilder> {
    const row = buildVerificationButtons();
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        row.components.map((button) => ButtonBuilder.from(button.toJSON()).setDisabled(true)),
    );
}

async function notifyUser(interaction: ButtonInteraction, userId: string, content: string): Promise<void> {
    const user = await interaction.client.users.fetch(userId).catch(() => null);
    await user?.send(content).catch(() => undefined);
}

async function approve(interaction: ButtonInteraction, channel: TextChannel, subjectUserId: string): Promise<void> {
    await interaction.update({ components: [disabledDecisionRow()] });

    const roleId = getVerificationRoleId();
    const subject = await channel.guild.members.fetch(subjectUserId).catch(() => null);
    if (subject && roleId) {
        await subject.roles.remove(roleId, `Pozytywna weryfikacja: ${interaction.user.tag}`);
    }

    await notifyUser(interaction, subjectUserId, `✅ **${channel.guild.name}**: Twoje konto zostało zweryfikowane. Witamy na serwerze!`);
    await channel.send(`✅ <@${subjectUserId}> zweryfikowany pozytywnie przez <@${interaction.user.id}>. Kanał zostanie zamknięty za ${VERIFICATION_CLOSE_DELAY_MS / 1000} s.`);
    verificationLogger.info('VERIFICATION_APPROVED', 'Pozytywna weryfikacja.', {
        guildId: channel.guild.id, targetUserId: subjectUserId, actorUserId: interaction.user.id,
    });

    await delay(VERIFICATION_CLOSE_DELAY_MS);
    await closeVerificationChannel(channel, subjectUserId, `Pozytywna weryfikacja (${interaction.user.tag}).`, interaction.user);
}

async function askRejectConfirmation(interaction: ButtonInteraction, subjectUserId: string): Promise<void> {
    await interaction.reply({
        content: `Czy na pewno chcesz odrzucić weryfikację i **zbanować** <@${subjectUserId}>?`,
        flags: MessageFlags.Ephemeral,
        components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(VERIFICATION_REJECT_CONFIRM_ID).setLabel('Tak, zbanuj').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(VERIFICATION_REJECT_CANCEL_ID).setLabel('Anuluj').setStyle(ButtonStyle.Secondary),
            ),
        ],
    });
}

async function reject(interaction: ButtonInteraction, channel: TextChannel, subjectUserId: string): Promise<void> {
    await interaction.update({ content: '⛔ Odrzucanie weryfikacji...', components: [] });
    await notifyUser(interaction, subjectUserId, `⛔ **${channel.guild.name}**: Weryfikacja Twojego konta zakończyła się negatywnie.`);

    try {
        await channel.guild.bans.create(subjectUserId, { reason: `${REJECT_BAN_REASON} (${interaction.user.tag})` });
    } catch (error) {
        verificationLogger.error('VERIFICATION_BAN_FAILED', 'Nie udalo sie zbanowac po negatywnej weryfikacji.', {
            guildId: channel.guild.id, targetUserId: subjectUserId, actorUserId: interaction.user.id,
        }, error);
        await interaction.followUp({ content: '❌ Nie udało się zbanować użytkownika (uprawnienia bota lub hierarchia ról).', flags: MessageFlags.Ephemeral });
        return;
    }

    await channel.send(`⛔ <@${subjectUserId}> zweryfikowany negatywnie i zbanowany przez <@${interaction.user.id}>. Kanał zostanie zamknięty za ${VERIFICATION_CLOSE_DELAY_MS / 1000} s.`);
    verificationLogger.warn('VERIFICATION_REJECTED', 'Negatywna weryfikacja - ban.', {
        guildId: channel.guild.id, targetUserId: subjectUserId, actorUserId: interaction.user.id,
    });

    await delay(VERIFICATION_CLOSE_DELAY_MS);
    await closeVerificationChannel(channel, subjectUserId, `Negatywna weryfikacja - ban (${interaction.user.tag}).`, interaction.user);
}

async function runDecision(channelId: string, operation: () => Promise<void>): Promise<boolean> {
    if (decisionsInProgress.has(channelId)) {
        return false;
    }
    decisionsInProgress.add(channelId);
    try {
        await operation();
        return true;
    } finally {
        decisionsInProgress.delete(channelId);
    }
}

/** Zwraca true, gdy przycisk nalezal do weryfikacji. Kazda akcja sprawdza uprawnienia po stronie bota. */
export async function handleVerificationButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!VERIFICATION_BUTTON_IDS.includes(interaction.customId)) {
        return false;
    }

    const channel = interaction.channel;
    const subjectUserId = isVerificationChannel(channel) ? extractVerificationUserId(channel.topic) : null;
    if (!isVerificationChannel(channel) || !subjectUserId) {
        await interaction.reply({ content: '❌ Ten przycisk działa tylko w kanale weryfikacji.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (!(await isAuthorizedActor(interaction, subjectUserId))) {
        await interaction.reply({ content: '🚫 Tylko administracja może podjąć decyzję w sprawie weryfikacji.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.customId === VERIFICATION_REJECT_BUTTON_ID) {
        await askRejectConfirmation(interaction, subjectUserId);
        return true;
    }
    if (interaction.customId === VERIFICATION_REJECT_CANCEL_ID) {
        await interaction.update({ content: '❌ Anulowano odrzucenie weryfikacji.', components: [] });
        return true;
    }

    const operation = interaction.customId === VERIFICATION_APPROVE_BUTTON_ID
        ? () => approve(interaction, channel, subjectUserId)
        : () => reject(interaction, channel, subjectUserId);

    if (!(await runDecision(channel.id, operation))) {
        await interaction.reply({ content: 'ℹ️ Decyzja w sprawie tej weryfikacji jest już przetwarzana.', flags: MessageFlags.Ephemeral });
    }
    return true;
}
