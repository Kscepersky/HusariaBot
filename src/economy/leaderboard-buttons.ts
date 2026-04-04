import type { ButtonInteraction } from 'discord.js';
import { getEconomyLeaderboardPage } from './repository.js';
import {
    buildLeaderboardButtons,
    buildLeaderboardEmbed,
    LEADERBOARD_PAGE_SIZE,
    parseLeaderboardCustomId,
} from './leaderboard-ui.js';
import { resolveEconomyGuildId } from './discord.js';

export async function handleEconomyLeaderboardButton(interaction: ButtonInteraction): Promise<boolean> {
    const parsed = parseLeaderboardCustomId(interaction.customId);
    if (!parsed) {
        return false;
    }

    const guildId = resolveEconomyGuildId(interaction);
    if (!guildId) {
        await interaction.update({
            content: '❌ Nie mozna ustalic serwera dla leaderboardu.',
            embeds: [],
            components: [],
        });
        return true;
    }

    try {
        const pageData = await getEconomyLeaderboardPage(
            guildId,
            parsed.sortBy,
            parsed.page,
            LEADERBOARD_PAGE_SIZE,
        );

        await interaction.update({
            content: '',
            embeds: [buildLeaderboardEmbed(pageData)],
            components: [buildLeaderboardButtons(pageData)],
        });
    } catch (error) {
        console.error('❌  Nie udalo sie zaktualizowac leaderboardu:', error);
        await interaction.update({
            content: '❌ Wystapil blad podczas ladowania leaderboardu.',
            embeds: [],
            components: [],
        });
    }

    return true;
}
