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
import { buildResultEmbed } from '../utils/embed-builder.js';
import { getGuildEmoji, resolveEmojiForComponent } from '../utils/guild-emojis.js';
import { ensureSupportRole } from '../utils/role-access.js';

export const EMBED_MODAL_RESULT = 'husaria_embed_modal_wynik';
const OUTCOME_SELECT_ID         = 'husaria_result_outcome';
const PUBLISH_BTN_ID            = 'husaria_result_publish';
const CANCEL_BTN_ID             = 'husaria_result_cancel';

const FIELD_RIVAL       = 'result_rywal';
const FIELD_SCORE       = 'result_wynik';
const FIELD_COMPETITION = 'result_rozgrywki';
const FIELD_COMMENT     = 'result_komentarz';

export function buildResultModal(): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(EMBED_MODAL_RESULT)
        .setTitle('📊 Wynik Meczu')
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
                    .setCustomId(FIELD_SCORE)
                    .setLabel('Wynik')
                    .setPlaceholder('np. 2 - 1')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(20)
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
                    .setCustomId(FIELD_COMMENT)
                    .setLabel('Komentarz (opcjonalnie)')
                    .setPlaceholder('np. Dramatyczne odwrócenie w mapie 3!')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(500)
                    .setRequired(false),
            ),
        );
}

export async function handleResultModalSubmit(interaction: ModalSubmitInteraction) {
    if (!(await ensureSupportRole(interaction))) {
        return;
    }

    const rival       = interaction.fields.getTextInputValue(FIELD_RIVAL).trim();
    const score       = interaction.fields.getTextInputValue(FIELD_SCORE).trim();
    const competition = interaction.fields.getTextInputValue(FIELD_COMPETITION).trim();
    const comment     = interaction.fields.getTextInputValue(FIELD_COMMENT).trim() || undefined;

    const lolEmojiComponent = resolveEmojiForComponent(interaction.guild, 'LoL');
    const cs2EmojiComponent = resolveEmojiForComponent(interaction.guild, 'CS2');

    const outcomeSelect = new StringSelectMenuBuilder()
        .setCustomId(OUTCOME_SELECT_ID)
        .setPlaceholder('🏆 Wybierz grę i wynik...')
        .addOptions(
            {
                label: 'League of Legends — Wygrana',
                value: 'lol_win',
                description: '✅ Zielony kolor embeddeda',
                ...(lolEmojiComponent && { emoji: lolEmojiComponent }),
            },
            {
                label: 'League of Legends — Porażka',
                value: 'lol_loss',
                description: '❌ Czerwony kolor embeddeda',
                ...(lolEmojiComponent && { emoji: lolEmojiComponent }),
            },
            {
                label: 'Counter-Strike 2 — Wygrana',
                value: 'cs2_win',
                description: '✅ Zielony kolor embeddeda',
                ...(cs2EmojiComponent && { emoji: cs2EmojiComponent }),
            },
            {
                label: 'Counter-Strike 2 — Porażka',
                value: 'cs2_loss',
                description: '❌ Czerwony kolor embeddeda',
                ...(cs2EmojiComponent && { emoji: cs2EmojiComponent }),
            },
        );

    const reply = await interaction.reply({
        content: '🏆 Wybierz grę i wynik meczu:',
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(outcomeSelect)],
        flags: MessageFlags.Ephemeral,
        withResponse: true,
    });

    try {
        const outcomeInteraction = await reply.resource!.message!.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            time: 60_000,
        }) as StringSelectMenuInteraction;

        const value     = outcomeInteraction.values[0];
        const isWin     = value === 'lol_win' || value === 'cs2_win';
        const gameType  = value.startsWith('cs2') ? 'cs2' : 'lol';
        const gameEmoji = getGuildEmoji(interaction.guild, gameType === 'lol' ? 'LoL' : 'CS2');
        const gameName  = gameType === 'lol' ? 'League of Legends' : 'Counter-Strike 2';
        const embed     = buildResultEmbed({ gameEmoji, gameName, rival, score, competition, comment, isWin });

        await outcomeInteraction.update({
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
