import {
    AttachmentBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import {
    getEconomyConfig,
    getEconomyUserRankByXp,
    getEconomyUserState,
    resolveLevelProgress,
} from '../economy/repository.js';
import { resolveEconomyGuildId } from '../economy/discord.js';
import { HusariaColors } from '../utils/husaria-theme.js';

function buildLevelFallbackEmbed(
    rank: number,
    level: number,
    totalXp: number,
    xpIntoCurrentLevel: number,
    xpForNextLevel: number,
    xpToNextLevel: number,
): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(HusariaColors.RED)
        .setTitle('📊 Twoj level')
        .addFields(
            { name: 'Ranga', value: `#${rank}`, inline: true },
            { name: 'Level', value: `${level}`, inline: true },
            { name: 'Calkowity XP', value: `${totalXp}`, inline: true },
            { name: 'Postep', value: `${xpIntoCurrentLevel}/${xpForNextLevel} XP`, inline: true },
            { name: 'Brakuje do next levela', value: `${xpToNextLevel} XP`, inline: false },
        )
        .setTimestamp();
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
            const rank = await getEconomyUserRankByXp(guildId, interaction.user.id, now);

            const { xpIntoLevel, xpForNextLevel, xpToNextLevel } = resolveLevelProgress(state.xp, state.level, config);

            try {
                const { renderLevelCard } = await import('./level-card-renderer.js');
                const levelCardBuffer = await renderLevelCard({
                    username: interaction.user.globalName ?? interaction.user.username,
                    avatarUrl: interaction.user.displayAvatarURL({
                        extension: 'png',
                        forceStatic: true,
                        size: 256,
                    }),
                    rank,
                    level: state.level,
                    totalXp: state.xp,
                    xpIntoCurrentLevel: xpIntoLevel,
                    xpForNextLevel,
                    xpToNextLevel,
                });

                const levelCardAttachment = new AttachmentBuilder(levelCardBuffer, {
                    name: 'level-card.png',
                });

                await interaction.editReply({
                    content: '',
                    files: [levelCardAttachment],
                });
            } catch (renderError) {
                console.error('⚠️ Nie udalo sie wyrenderowac level card, fallback do embeda:', renderError);

                const embed = buildLevelFallbackEmbed(
                    rank,
                    state.level,
                    state.xp,
                    xpIntoLevel,
                    xpForNextLevel,
                    xpToNextLevel,
                );

                await interaction.editReply({ content: '', embeds: [embed] });
            }
        } catch (error) {
            console.error('❌  Nie udalo sie wykonac /level:', error);
            await interaction.editReply({
                content: '❌ Wystapil blad podczas pobierania poziomu.',
                embeds: [],
            });
        }
    },
};
