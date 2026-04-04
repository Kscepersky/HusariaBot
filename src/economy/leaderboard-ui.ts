import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} from 'discord.js';
import type {
    EconomyLeaderboardPage,
    EconomyLeaderboardSortBy,
} from './types.js';
import { HusariaColors } from '../utils/husaria-theme.js';

export const LEADERBOARD_PAGE_SIZE = 10;
const LEADERBOARD_CUSTOM_ID_PREFIX = 'economy_leaderboard';

export interface ParsedLeaderboardCustomId {
    sortBy: EconomyLeaderboardSortBy;
    page: number;
}

export function buildLeaderboardCustomId(sortBy: EconomyLeaderboardSortBy, page: number): string {
    return `${LEADERBOARD_CUSTOM_ID_PREFIX}:${sortBy}:${page}`;
}

export function parseLeaderboardCustomId(customId: string): ParsedLeaderboardCustomId | null {
    if (!customId.startsWith(`${LEADERBOARD_CUSTOM_ID_PREFIX}:`)) {
        return null;
    }

    const parts = customId.split(':');
    if (parts.length !== 3) {
        return null;
    }

    const sortBy = parts[1];
    const pageToken = parts[2] ?? '';
    if (!/^\d+$/.test(pageToken)) {
        return null;
    }

    const pageRaw = Number.parseInt(pageToken, 10);

    if ((sortBy !== 'xp' && sortBy !== 'coins') || !Number.isFinite(pageRaw)) {
        return null;
    }

    return {
        sortBy,
        page: Math.max(1, pageRaw),
    };
}

function resolveLeaderboardTitle(sortBy: EconomyLeaderboardSortBy): string {
    return sortBy === 'coins'
        ? 'G2 Hussars - Topka Cebulionow'
        : 'G2 Hussars - Topka Levela';
}

export function buildLeaderboardEmbed(data: EconomyLeaderboardPage): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor(HusariaColors.RED)
        .setTitle(resolveLeaderboardTitle(data.sortBy))
        .setFooter({ text: `Strona ${data.page}/${data.totalPages} | Osob: ${data.totalRows}` })
        .setTimestamp();

    if (data.entries.length === 0) {
        embed.setDescription('Brak danych w leaderboardzie.');
        return embed;
    }

    const rows = data.entries.map((entry) => {
        const score = data.sortBy === 'coins'
            ? `${entry.coins} cebulionow`
            : `Level ${entry.level} | ${entry.xp} XP`;

        return `**${entry.rank}.** <@${entry.userId}> - ${score}`;
    });

    embed.setDescription(rows.join('\n'));
    return embed;
}

export function buildLeaderboardButtons(data: EconomyLeaderboardPage): ActionRowBuilder<ButtonBuilder> {
    const hasPrev = data.page > 1;
    const hasNext = data.page < data.totalPages;

    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(buildLeaderboardCustomId(data.sortBy, data.page - 1))
            .setLabel('⬅️ Poprzednia')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasPrev),
        new ButtonBuilder()
            .setCustomId(buildLeaderboardCustomId(data.sortBy, data.page + 1))
            .setLabel('Nastepna ➡️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasNext),
    );
}
