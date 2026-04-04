import {
    ChatInputCommandInteraction,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { resolveEconomyGuildId } from '../economy/discord.js';
import { getEconomyLeaderboardPage } from '../economy/repository.js';
import {
    buildLeaderboardButtons,
    buildLeaderboardEmbed,
    LEADERBOARD_PAGE_SIZE,
} from '../economy/leaderboard-ui.js';

export const leaderboardXpCommand = {
    data: new SlashCommandBuilder()
        .setName('leaderboard-xp')
        .setDescription('🏆 Pokaz topke levela i XP')
        .setDMPermission(false),

    async execute(interaction: ChatInputCommandInteraction) {
        const guildId = resolveEconomyGuildId(interaction);
        if (!guildId) {
            await interaction.reply({
                content: '❌ Nie mozna ustalic serwera dla leaderboardu.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply();

        try {
            const page = await getEconomyLeaderboardPage(guildId, 'xp', 1, LEADERBOARD_PAGE_SIZE);
            await interaction.editReply({
                content: '',
                embeds: [buildLeaderboardEmbed(page)],
                components: [buildLeaderboardButtons(page)],
            });
        } catch (error) {
            console.error('❌  Nie udalo sie wykonac /leaderboard-xp:', error);
            await interaction.editReply({
                content: '❌ Wystapil blad podczas ladowania leaderboardu XP.',
                embeds: [],
                components: [],
            });
        }
    },
};
