import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { getEconomyConfig, getEconomyUserState } from '../economy/repository.js';
import type { EconomyConfig } from '../economy/types.js';
import { resolveEconomyGuildId } from '../economy/discord.js';
import { HusariaColors } from '../utils/husaria-theme.js';

function resolveXpForNextLevel(level: number, config: EconomyConfig): number {
    if (config.levelingMode === 'linear') {
        return Math.max(1, Math.floor(config.levelingBaseXp * level));
    }

    return Math.max(1, Math.floor(config.levelingBaseXp * (level ** config.levelingExponent)));
}

function resolveXpSpentForLevel(level: number, config: EconomyConfig): number {
    let total = 0;
    for (let currentLevel = 1; currentLevel <= level; currentLevel += 1) {
        total += resolveXpForNextLevel(currentLevel, config);
    }

    return total;
}

export const levelCommand = {
    data: new SlashCommandBuilder()
        .setName('level')
        .setDescription('📊 Pokaz swoj level i postep XP')
        .setDMPermission(false),

    async execute(interaction: ChatInputCommandInteraction) {
        const guildId = resolveEconomyGuildId(interaction);
        if (!guildId) {
            await interaction.reply({
                content: '❌ Nie mozna ustalic serwera dla ekonomii.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply();

        try {
            const now = Date.now();
            const [config, state] = await Promise.all([
                getEconomyConfig(),
                getEconomyUserState(guildId, interaction.user.id, now),
            ]);

            const xpSpentForCurrentLevel = resolveXpSpentForLevel(state.level, config);
            const xpIntoCurrentLevel = Math.max(0, state.xp - xpSpentForCurrentLevel);
            const xpForNextLevel = resolveXpForNextLevel(state.level + 1, config);
            const xpToNextLevel = Math.max(0, xpForNextLevel - xpIntoCurrentLevel);

            const embed = new EmbedBuilder()
                .setColor(HusariaColors.RED)
                .setTitle('📊 Twoj level')
                .addFields(
                    { name: 'Level', value: `${state.level}`, inline: true },
                    { name: 'Calkowity XP', value: `${state.xp}`, inline: true },
                    { name: 'Postep', value: `${xpIntoCurrentLevel}/${xpForNextLevel} XP`, inline: true },
                    { name: 'Brakuje do next levela', value: `${xpToNextLevel} XP`, inline: false },
                )
                .setTimestamp();

            await interaction.editReply({ content: '', embeds: [embed] });
        } catch (error) {
            console.error('❌  Nie udalo sie wykonac /level:', error);
            await interaction.editReply({
                content: '❌ Wystapil blad podczas pobierania poziomu.',
                embeds: [],
            });
        }
    },
};
