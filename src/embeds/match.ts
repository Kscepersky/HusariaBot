import {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    MessageFlags,
    ModalSubmitInteraction,
    GuildTextBasedChannel,
} from 'discord.js';
import { buildMatchEmbed } from '../utils/embed-builder.js';
import { getGuildEmoji, resolveEmojiForComponent } from '../utils/guild-emojis.js';


export const EMBED_MODAL_MATCH  = 'husaria_embed_modal_mecz';
const GAME_SELECT_ID            = 'husaria_match_game';
const PUBLISH_BTN_ID            = 'husaria_match_publish';
const CANCEL_BTN_ID             = 'husaria_match_cancel';

const FIELD_RIVAL       = 'match_rywal';
const FIELD_COMPETITION = 'match_rozgrywki';
const FIELD_DATE        = 'match_data';
const FIELD_STREAM      = 'match_stream';

export function buildMatchModal(): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(EMBED_MODAL_MATCH)
        .setTitle('⚔️ Zapowiedź Meczu')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId(FIELD_RIVAL)
                    .setLabel('Rywal')
                    .setPlaceholder('np. Fnatic')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(100)
                    .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId(FIELD_COMPETITION)
                    .setLabel('Rozgrywki')
                    .setPlaceholder('np. LEC Spring 2025 — Playoff')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(100)
                    .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId(FIELD_DATE)
                    .setLabel('Data i godzina (Unix timestamp)')
                    .setPlaceholder('np. 1743861600  —  epochconverter.com')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(20)
                    .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId(FIELD_STREAM)
                    .setLabel('Link do streamu (opcjonalnie)')
                    .setPlaceholder('np. https://twitch.tv/riotgames')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(200)
                    .setRequired(false),
            ),
        );
}

export async function handleMatchModalSubmit(interaction: ModalSubmitInteraction) {
    const rival       = interaction.fields.getTextInputValue(FIELD_RIVAL).trim();
    const competition = interaction.fields.getTextInputValue(FIELD_COMPETITION).trim();
    const timestamp   = parseInt(interaction.fields.getTextInputValue(FIELD_DATE).trim(), 10);
    const stream      = interaction.fields.getTextInputValue(FIELD_STREAM).trim() || undefined;

    const lolEmojiComponent = resolveEmojiForComponent(interaction.guild, 'LoL');
    const cs2EmojiComponent = resolveEmojiForComponent(interaction.guild, 'cs2');

    const gameSelect = new StringSelectMenuBuilder()
        .setCustomId(GAME_SELECT_ID)
        .setPlaceholder('🎮 Wybierz grę...')
        .addOptions(
            {
                label: 'League of Legends',
                value: 'lol',
                ...(lolEmojiComponent && { emoji: lolEmojiComponent }),
            },
            {
                label: 'Counter-Strike 2',
                value: 'cs2',
                ...(cs2EmojiComponent && { emoji: cs2EmojiComponent }),
            },
        );

    const reply = await interaction.reply({
        content: '🎮 Wybierz grę:',
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(gameSelect)],
        flags: MessageFlags.Ephemeral,
        withResponse: true,
    });

    try {
        const gameInteraction = await reply.resource!.message!.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            time: 60_000,
        }) as StringSelectMenuInteraction;

        const gameType  = gameInteraction.values[0] as 'lol' | 'cs2';
        const g2Emoji   = getGuildEmoji(interaction.guild, 'G2');
        const gameEmoji = getGuildEmoji(interaction.guild, gameType === 'lol' ? 'LoL' : 'CS2');
        const gameName  = gameType === 'lol' ? 'League of Legends' : 'Counter-Strike 2';
        const embed     = buildMatchEmbed({ g2Emoji, gameEmoji, gameName, rival, competition, timestamp, stream });

        await gameInteraction.update({
            content: '👁️ **Podgląd embeddeda:**',
            embeds: [embed],
            components: [
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder()
                        .setCustomId(PUBLISH_BTN_ID)
                        .setLabel('📤 Publikuj')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(CANCEL_BTN_ID)
                        .setLabel('❌ Anuluj')
                        .setStyle(ButtonStyle.Danger),
                ),
            ],
        });

        const btnInteraction = await reply.resource!.message!.awaitMessageComponent({
            componentType: ComponentType.Button,
            time: 120_000,
        });

        if (btnInteraction.customId === PUBLISH_BTN_ID) {
            await btnInteraction.update({ content: '✅ Embed wysłany!', embeds: [], components: [] });
            await (interaction.channel as GuildTextBasedChannel).send({ embeds: [embed] });
        } else {
            await btnInteraction.update({ content: '❌ Anulowano.', embeds: [], components: [] });
        }

    } catch {
        await interaction.editReply({ content: '⏰ Czas minął — anulowano.', components: [] });
    }
}
