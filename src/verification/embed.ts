import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import { VERIFICATION_APPROVE_BUTTON_ID, VERIFICATION_REJECT_BUTTON_ID } from './constants.js';
import { describeAccountRisk, formatHoursOrDays } from './logic.js';

export interface VerificationProfile {
    userId: string;
    username: string;
    globalName: string | null;
    avatarUrl: string;
    hasCustomAvatar: boolean;
    createdTimestamp: number;
    joinedTimestamp: number | null;
    isBot: boolean;
    /** Nazwy flag z `UserFlags` (np. `HypeSquadOnlineHouse1`). */
    badges: readonly string[];
}

const BADGE_LABELS: Readonly<Record<string, string>> = {
    Staff: 'Discord Staff',
    Partner: 'Partner',
    Hypesquad: 'HypeSquad Events',
    BugHunterLevel1: 'Bug Hunter',
    BugHunterLevel2: 'Bug Hunter (złoty)',
    HypeSquadOnlineHouse1: 'HypeSquad Bravery',
    HypeSquadOnlineHouse2: 'HypeSquad Brilliance',
    HypeSquadOnlineHouse3: 'HypeSquad Balance',
    PremiumEarlySupporter: 'Early Supporter',
    VerifiedDeveloper: 'Zweryfikowany developer',
    CertifiedModerator: 'Moderator Alumni',
    ActiveDeveloper: 'Aktywny developer',
    VerifiedBot: 'Zweryfikowany bot',
};

function toDiscordTimestamp(timestampMs: number, style: 'F' | 'R'): string {
    return `<t:${Math.floor(timestampMs / 1000)}:${style}>`;
}

function formatBadges(badges: readonly string[]): string {
    const labels = badges.map((badge) => BADGE_LABELS[badge]).filter((label): label is string => Boolean(label));
    return labels.length > 0 ? labels.join(', ') : 'Brak';
}

export function buildVerificationEmbed(profile: VerificationProfile, now: number, minAgeDays: number): EmbedBuilder {
    const risk = describeAccountRisk(profile.createdTimestamp, now);
    const displayName = profile.globalName ? `${profile.globalName} (@${profile.username})` : `@${profile.username}`;
    const joined = profile.joinedTimestamp
        ? `${toDiscordTimestamp(profile.joinedTimestamp, 'F')}\n${toDiscordTimestamp(profile.joinedTimestamp, 'R')}`
        : 'Nieznana';

    return new EmbedBuilder()
        .setColor(HusariaColors.RED)
        .setThumbnail(profile.avatarUrl)
        .setDescription(
            `# 🛡️ Weryfikacja nowego konta\n`
            + `Konto **${displayName}** jest młodsze niż **${minAgeDays} dni**. `
            + 'Do czasu decyzji administracji ma ograniczony dostęp do serwera.',
        )
        .addFields(
            { name: '👤 Użytkownik', value: `<@${profile.userId}>\n${displayName}`, inline: true },
            { name: '🆔 ID', value: `\`${profile.userId}\``, inline: true },
            { name: '🤖 Bot', value: profile.isBot ? 'Tak' : 'Nie', inline: true },
            {
                name: '📅 Konto utworzone',
                value: `${toDiscordTimestamp(profile.createdTimestamp, 'F')}\n${toDiscordTimestamp(profile.createdTimestamp, 'R')}`,
                inline: true,
            },
            { name: '⏳ Wiek konta', value: `**${formatHoursOrDays(profile.createdTimestamp, now)}**`, inline: true },
            { name: '📥 Dołączył na serwer', value: joined, inline: true },
            { name: '🖼️ Avatar', value: profile.hasCustomAvatar ? 'Własny' : 'Domyślny', inline: true },
            { name: '🏅 Odznaki', value: formatBadges(profile.badges), inline: true },
            { name: '⚠️ Ryzyko', value: risk.label, inline: false },
        )
        .setFooter({ text: 'Decyzję może podjąć tylko administracja serwera.' })
        .setTimestamp(now);
}

export function buildVerificationButtons(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(VERIFICATION_APPROVE_BUTTON_ID)
            .setLabel('Zweryfikuj pozytywnie')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(VERIFICATION_REJECT_BUTTON_ID)
            .setLabel('Odrzuć i zbanuj')
            .setEmoji('⛔')
            .setStyle(ButtonStyle.Danger),
    );
}
