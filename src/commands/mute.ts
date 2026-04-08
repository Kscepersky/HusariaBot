import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
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

const MAX_REASON_LENGTH = 500;

const TIMEOUT_DURATION_CHOICES: ReadonlyArray<{ name: string; value: TimeoutDurationUnit }> = [
    { name: 'Sekundy', value: 's' },
    { name: 'Minuty', value: 'm' },
    { name: 'Godziny', value: 'h' },
    { name: 'Dni', value: 'd' },
    { name: 'Miesiace', value: 'mo' },
    { name: 'Lata', value: 'y' },
];

function resolveProtectedStaffRoleIds(): Set<string> {
    const roleIds = [
        process.env.ADMIN_ROLE_ID,
        process.env.MODERATOR_ROLE_ID,
        process.env.COMMUNITY_MANAGER_ROLE_ID,
        process.env.DEV_ROLE_ID,
    ];

    return new Set(
        roleIds
            .map((roleId) => String(roleId ?? '').trim())
            .filter((roleId) => /^\d{17,20}$/.test(roleId)),
    );
}

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
        return 'Brak powodu';
    }

    return normalized.slice(0, MAX_REASON_LENGTH);
}

function formatDiscordTimestamp(valueMs: number): string {
    return `<t:${Math.floor(valueMs / 1000)}:F> (<t:${Math.floor(valueMs / 1000)}:R>)`;
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
        const reason = normalizeReason(interaction.options.getString('powod', true));

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

        const protectedStaffRoleIds = resolveProtectedStaffRoleIds();
        if ([...protectedStaffRoleIds].some((roleId) => member.roles.cache.has(roleId))) {
            await interaction.editReply({
                content: '❌ Nie mozna nalozyc timeoutu na czlonka staffu.',
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
            console.error('❌ Nie udalo sie sprawdzic aktywnego timeoutu:', error);
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
            console.error('❌ Nie udalo sie nadac roli Server Mute:', error);
            await releaseEconomyTimeout({
                guildId,
                timeoutId: timeoutRecord.id,
                releasedAt: Date.now(),
                releasedByUserId: interaction.user.id,
                releaseReason: 'Nie udalo sie nadac roli Server Mute',
            }).catch((releaseError) => {
                console.error('❌ Nie udalo sie wycofac timeoutu po bledzie nadawania roli:', releaseError);
            });

            await interaction.editReply({
                content: '❌ Nie udalo sie nadac roli Server Mute. Sprawdz uprawnienia bota.',
                embeds: [],
            });
            return;
        }

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
