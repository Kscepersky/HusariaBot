import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    type User,
    SlashCommandBuilder,
} from 'discord.js';
import {
    createEconomyTimeout,
    getActiveEconomyTimeoutForUser,
    releaseEconomyTimeout,
} from '../economy/repository.js';
import { resolveEconomyGuildId } from '../economy/discord.js';
import { parseTimeoutDurationParts, type TimeoutDurationUnit } from '../timeouts/duration.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import { ensureSupportRole } from '../utils/role-access.js';
import { createLogger } from '../utils/logger.js';

const MAX_REASON_LENGTH = 500;
const muteLogger = createLogger('bot:mute-command');

const TIMEOUT_DURATION_CHOICES: ReadonlyArray<{ name: string; value: TimeoutDurationUnit }> = [
    { name: 'Sekundy', value: 's' },
    { name: 'Minuty', value: 'm' },
    { name: 'Godziny', value: 'h' },
    { name: 'Dni', value: 'd' },
    { name: 'Miesiace', value: 'mo' },
    { name: 'Lata', value: 'y' },
];

function resolveServerMuteRoleId(): string | null {
    const roleId = process.env.SERVER_MUTE_ROLE_ID?.trim() ?? '';
    if (!/^\d{17,20}$/.test(roleId)) {
        return null;
    }

    return roleId;
}

function normalizeReason(rawValue: string): string {
    const normalized = rawValue.trim();
    if (normalized.length === 0) {
        throw new Error('Powod timeoutu jest wymagany.');
    }

    return normalized.slice(0, MAX_REASON_LENGTH);
}

function formatDiscordTimestamp(valueMs: number): string {
    return `<t:${Math.floor(valueMs / 1000)}:F> (<t:${Math.floor(valueMs / 1000)}:R>)`;
}

function formatMuteDmMessage(guildName: string, expiresAtMs: number, adminUserId: string, reason: string): string {
    return `Zostales zmutowany na serwerze **${guildName}** do **${formatDiscordTimestamp(expiresAtMs)}** przez **<@${adminUserId}>** z powodu: **${reason}**`;
}

async function sendMuteDm(user: User, guildName: string, expiresAtMs: number, adminUserId: string, reason: string): Promise<void> {
    await user.send({
        content: formatMuteDmMessage(guildName, expiresAtMs, adminUserId, reason),
    });
}

export const muteCommand = {
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('🔇 Nadaj timeout przez role Server Mute')
        .setDefaultMemberPermissions(null)
        .setDMPermission(false)
        .addUserOption((option) => {
            return option
                .setName('uzytkownik')
                .setDescription('Kogo ztimeoutowac')
                .setRequired(true);
        })
        .addIntegerOption((option) => {
            return option
                .setName('ilosc')
                .setDescription('Ilosc czasu timeoutu')
                .setMinValue(1)
                .setRequired(true);
        })
        .addStringOption((option) => {
            return option
                .setName('jednostka')
                .setDescription('Jednostka czasu timeoutu')
                .setRequired(true)
                .addChoices(...TIMEOUT_DURATION_CHOICES);
        })
        .addStringOption((option) => {
            return option
                .setName('powod')
                .setDescription('Powod timeoutu')
                .setMaxLength(MAX_REASON_LENGTH)
                .setRequired(true);
        }),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!(await ensureSupportRole(interaction))) {
            return;
        }

        const guildId = resolveEconomyGuildId(interaction);
        if (!guildId || !interaction.guild) {
            await interaction.reply({
                content: '❌ Nie mozna ustalic serwera dla timeoutu.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const targetUser = interaction.options.getUser('uzytkownik', true);
        const durationAmount = interaction.options.getInteger('ilosc', true);
        const durationUnit = interaction.options.getString('jednostka', true);
        let reason: string;

        try {
            reason = normalizeReason(interaction.options.getString('powod', true));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Powod timeoutu jest wymagany.';
            await interaction.reply({
                content: `❌ ${message}`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (targetUser.bot) {
            await interaction.reply({
                content: '❌ Nie mozna nakladac timeoutu na boty.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const muteRoleId = resolveServerMuteRoleId();
        if (!muteRoleId) {
            await interaction.reply({
                content: '❌ Brakuje poprawnej zmiennej SERVER_MUTE_ROLE_ID.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        let parsedDuration;
        try {
            parsedDuration = parseTimeoutDurationParts(durationAmount, durationUnit);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Nieprawidlowy czas timeoutu.';
            await interaction.reply({
                content: `❌ ${message}`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let member;
        try {
            member = await interaction.guild.members.fetch(targetUser.id);
        } catch {
            member = null;
        }

        if (!member) {
            await interaction.editReply({
                content: '❌ Nie znaleziono uzytkownika na tym serwerze.',
                embeds: [],
            });
            return;
        }

        if (member.roles.cache.has(muteRoleId)) {
            await interaction.editReply({
                content: '❌ Uzytkownik ma juz role Server Mute.',
                embeds: [],
            });
            return;
        }

        try {
            const activeTimeout = await getActiveEconomyTimeoutForUser(guildId, targetUser.id);
            if (activeTimeout && activeTimeout.isActive) {
                await interaction.editReply({
                    content: `❌ Uzytkownik ma juz aktywny timeout do ${formatDiscordTimestamp(activeTimeout.expiresAt)}.`,
                    embeds: [],
                });
                return;
            }
        } catch (error) {
            muteLogger.error('TIMEOUT_ACTIVE_LOOKUP_FAILED', 'Nie udalo sie sprawdzic aktywnego timeoutu.', {
                guildId,
                actorUserId: interaction.user.id,
                targetUserId: targetUser.id,
            }, error);
            await interaction.editReply({
                content: '❌ Wystapil blad podczas sprawdzania aktywnego timeoutu.',
                embeds: [],
            });
            return;
        }

        const nowTimestamp = Date.now();
        const expiresAt = nowTimestamp + parsedDuration.durationMs;

        let timeoutRecord;
        try {
            timeoutRecord = await createEconomyTimeout({
                guildId,
                userId: targetUser.id,
                reason,
                muteRoleId,
                createdByUserId: interaction.user.id,
                createdAt: nowTimestamp,
                expiresAt,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Nie udalo sie utworzyc timeoutu.';
            await interaction.editReply({
                content: `❌ ${message}`,
                embeds: [],
            });
            return;
        }

        try {
            await member.roles.add(muteRoleId, `Timeout: ${reason}`);
        } catch (error) {
            muteLogger.error('MUTE_ROLE_ASSIGN_FAILED', 'Nie udalo sie nadac roli Server Mute.', {
                guildId,
                actorUserId: interaction.user.id,
                targetUserId: targetUser.id,
                timeoutId: timeoutRecord.id,
                muteRoleId,
            }, error);
            await releaseEconomyTimeout({
                guildId,
                timeoutId: timeoutRecord.id,
                releasedAt: Date.now(),
                releasedByUserId: interaction.user.id,
                releaseReason: 'Nie udalo sie nadac roli Server Mute',
            }).catch((releaseError) => {
                muteLogger.error('MUTE_TIMEOUT_ROLLBACK_FAILED', 'Nie udalo sie wycofac timeoutu po bledzie nadawania roli.', {
                    guildId,
                    actorUserId: interaction.user.id,
                    targetUserId: targetUser.id,
                    timeoutId: timeoutRecord.id,
                }, releaseError);
            });

            await interaction.editReply({
                content: '❌ Nie udalo sie nadac roli Server Mute. Sprawdz uprawnienia bota.',
                embeds: [],
            });
            return;
        }

        try {
            await sendMuteDm(targetUser, interaction.guild.name, expiresAt, interaction.user.id, reason);
        } catch (error) {
            muteLogger.warn('MUTE_DM_SEND_FAILED', 'Nie udalo sie wyslac DM o timeoutcie.', {
                guildId,
                actorUserId: interaction.user.id,
                targetUserId: targetUser.id,
                timeoutId: timeoutRecord.id,
            }, error);
        }

        muteLogger.info('MUTE_APPLIED', 'Timeout zostal pomyslnie nalozony.', {
            guildId,
            actorUserId: interaction.user.id,
            targetUserId: targetUser.id,
            timeoutId: timeoutRecord.id,
            muteRoleId,
            expiresAt,
        });

        const embed = new EmbedBuilder()
            .setColor(HusariaColors.RED)
            .setTitle('🔇 Nalozono timeout')
            .setDescription(`Uzytkownik <@${targetUser.id}> otrzymal timeout.`)
            .addFields(
                { name: 'Powod', value: reason, inline: false },
                { name: 'Czas', value: parsedDuration.normalized, inline: true },
                { name: 'Koniec', value: formatDiscordTimestamp(expiresAt), inline: true },
            )
            .setFooter({ text: `Timeout ID: ${timeoutRecord.id}` })
            .setTimestamp(new Date(nowTimestamp));

        await interaction.editReply({
            content: '',
            embeds: [embed],
        });
    },
};
