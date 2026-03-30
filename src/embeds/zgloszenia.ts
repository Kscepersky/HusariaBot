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
import { buildZgloszeniaEmbed } from '../utils/embed-builder.js';
import { getGuildEmoji } from '../utils/guild-emojis.js';
import { ensureSupportRole } from '../utils/role-access.js';

export const EMBED_MODAL_ZGLOSZENIA = 'husaria_embed_modal_zgloszenia';
const PUBLISH_BTN_ID                = 'husaria_zgloszenia_publish';
const CANCEL_BTN_ID                 = 'husaria_zgloszenia_cancel';

const FIELD_MESSAGE = 'zgloszenia_message';

export function buildZgloszeniaModal(): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(EMBED_MODAL_ZGLOSZENIA)
        .setTitle('📋 Zgłoszenia')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId(FIELD_MESSAGE)
                    .setLabel('Treść zgłoszeń')
                    .setPlaceholder('Wpisz treść zgłoszeń (PL/EN)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(4000)
                    .setRequired(true),
            ),
        );
}

function resolveZgloszeniaEmoji(guild: ModalSubmitInteraction['guild']): string {
    return (
        getGuildEmoji(guild, 'G2Hussars')
        || getGuildEmoji(guild, 'g2hussars')
        || getGuildEmoji(guild, 'G2_Hussars')
        || ''
    );
}

export async function handleZgloszeniaModalSubmit(interaction: ModalSubmitInteraction) {
    if (!(await ensureSupportRole(interaction))) {
        return;
    }

    const message = interaction.fields.getTextInputValue(FIELD_MESSAGE).trim();
    const reportsEmoji = resolveZgloszeniaEmoji(interaction.guild);

    const embed = buildZgloszeniaEmbed({ reportsEmoji, message });

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
                console.error('❌ Błąd publikacji embeda zgłoszeń:', error);
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

        console.error('❌ Błąd obsługi embeda zgłoszeń:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas tworzenia embeda. Spróbuj ponownie.',
            components: [],
        });
    }
}