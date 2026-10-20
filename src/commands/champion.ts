import {
    AttachmentBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import {
    championIconUrl,
    championSplashUrl,
    loadChampionCatalog,
    loadChampionLore,
    trimToSentences,
} from './champion-data.js';
import { pickChampion } from './champion-pick.js';

const MAX_LORE_LENGTH = 330;
/** Karta z podpisem ma mniej miejsca na opis. */
const MAX_LORE_LENGTH_WITH_CAPTION = 200;
const CARD_FILE_NAME = 'champion.png';
const STEP_DELAY_MS = 1500;
const ANIMATION_MESSAGES: readonly string[] = [
    'Zaglądam do Rozdarcia...',
    'Przeszukuję Summoner\'s Rift pod kątem Twojej duszy...',
    'Pytam Nexusa, kto do Ciebie pasuje...',
];

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function displayName(interaction: ChatInputCommandInteraction): string {
    return interaction.user.globalName ?? interaction.user.username;
}

export const championCommand = {
    data: new SlashCommandBuilder()
        .setName('champion')
        .setDescription('⚔️ Sprawdź, jaka postać z League of Legends do Ciebie pasuje')
        .setDMPermission(false),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guildId) {
            await interaction.reply({
                content: '❌ Ta komenda dziala tylko na serwerze.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply();

        try {
            const catalogPromise = loadChampionCatalog();
            // Zapobiega unhandled rejection, gdy animacja trwa dluzej niz blad pobierania.
            catalogPromise.catch(() => undefined);

            for (const message of ANIMATION_MESSAGES) {
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(HusariaColors.DARK_GRAY)
                            .setTitle('⚔️ Szukam Twojej postaci')
                            .setDescription(`*${message}*`),
                    ],
                });
                await sleep(STEP_DELAY_MS);
            }

            const { version, champions } = await catalogPromise;
            const { champion, caption } = pickChampion(interaction.user.id, champions);
            const lore = await loadChampionLore(version, champion.id);
            const description = trimToSentences(
                lore ?? champion.blurb,
                caption ? MAX_LORE_LENGTH_WITH_CAPTION : MAX_LORE_LENGTH,
            );
            const userName = displayName(interaction);

            const embed = new EmbedBuilder()
                .setColor(HusariaColors.RED)
                .setTitle(`⚔️ ${userName}, Twoja postać to ${champion.name}`)
                .setDescription(caption ? `**${champion.title}**\n${caption}` : `**${champion.title}**`)
                .setFooter({ text: `Zapytał(a): ${userName}` })
                .setTimestamp();

            try {
                const { renderChampionCard } = await import('./champion-card-renderer.js');
                const cardBuffer = await renderChampionCard({
                    championName: champion.name,
                    championTitle: champion.title,
                    blurb: description,
                    caption,
                    username: userName,
                    splashUrl: championSplashUrl(champion.id),
                    iconUrl: championIconUrl(version, champion.id),
                    avatarUrl: interaction.user.displayAvatarURL({ extension: 'png', forceStatic: true, size: 128 }),
                });

                embed.setImage(`attachment://${CARD_FILE_NAME}`);
                await interaction.editReply({
                    content: '',
                    embeds: [embed],
                    files: [new AttachmentBuilder(cardBuffer, { name: CARD_FILE_NAME })],
                });
            } catch (error) {
                console.error('⚠️ Nie udalo sie wyrenderowac karty /champion, fallback do embeda:', error);
                await interaction.editReply({ content: '', embeds: [embed] });
            }
        } catch (error) {
            console.error('❌  Nie udalo sie wykonac /champion:', error);
            await interaction.editReply({
                content: '❌ Nie udalo sie pobrac listy postaci. Sprobuj ponownie za chwile.',
                embeds: [],
            }).catch(() => undefined);
        }
    },
};
