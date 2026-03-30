import {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    MessageFlags,
    ModalSubmitInteraction,
} from 'discord.js';
import { buildRulebookEmbed } from '../utils/embed-builder.js';
import { getGuildEmoji } from '../utils/guild-emojis.js';

export const EMBED_MODAL_RULEBOOK = 'husaria_embed_modal_rulebook';
const PUBLISH_BTN_ID              = 'husaria_rulebook_publish';
const CANCEL_BTN_ID               = 'husaria_rulebook_cancel';

const FIELD_MESSAGE = 'rulebook_message';

export function buildRulebookModal(): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(EMBED_MODAL_RULEBOOK)
        .setTitle('📜 Regulamin')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId(FIELD_MESSAGE)
                    .setLabel('Treść regulaminu')
                    .setPlaceholder('Wpisz treść regulaminu (PL/EN)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(4000)
                    .setRequired(true),
            ),
        );
}

function resolveRulebookEmoji(guild: ModalSubmitInteraction['guild']): string {
    return (
        getGuildEmoji(guild, 'G2Hussars')
        || getGuildEmoji(guild, 'g2hussars')
        || getGuildEmoji(guild, 'G2_Hussars')
        || ''
    );
}

export async function handleRulebookModalSubmit(interaction: ModalSubmitInteraction) {
    const message = interaction.fields.getTextInputValue(FIELD_MESSAGE).trim();
    const rulesEmoji = resolveRulebookEmoji(interaction.guild);

    const embed = buildRulebookEmbed({ rulesEmoji, message });

    const reply = await interaction.reply({
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
        flags: MessageFlags.Ephemeral,
        withResponse: true,
    });

    try {
        const btnInteraction = await reply.resource!.message!.awaitMessageComponent({
            componentType: ComponentType.Button,
            time: 120_000,
        });

        if (btnInteraction.customId === PUBLISH_BTN_ID) {
            const targetChannel = interaction.channel;

            if (!targetChannel?.isTextBased() || !('send' in targetChannel)) {
                await btnInteraction.update({
                    content: '❌ Nie udało się wysłać embeda: ten kanał nie obsługuje wiadomości tekstowych.',
                    embeds: [],
                    components: [],
                });
                return;
            }

            try {
                await targetChannel.send({ embeds: [embed] });
                await btnInteraction.update({ content: '✅ Embed wysłany!', embeds: [], components: [] });
            } catch (error) {
                console.error('❌ Błąd publikacji embeda regulaminu:', error);
                await btnInteraction.update({
                    content: '❌ Nie udało się opublikować embeda. Sprawdź uprawnienia bota i spróbuj ponownie.',
                    embeds: [],
                    components: [],
                });
            }
        } else {
            await btnInteraction.update({ content: '❌ Anulowano.', embeds: [], components: [] });
        }

    } catch (error) {
        const errMessage = error instanceof Error ? error.message.toLowerCase() : '';
        if (errMessage.includes('time')) {
            await interaction.editReply({ content: '⏰ Czas minął — anulowano.', components: [] });
            return;
        }

        console.error('❌ Błąd obsługi embeda regulaminu:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas tworzenia embeda. Spróbuj ponownie.',
            components: [],
        });
    }
}
