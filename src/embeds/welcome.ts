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
    AttachmentBuilder,
} from 'discord.js';
import { join } from 'node:path';
import { buildWelcomeEmbed } from '../utils/embed-builder.js';
import { getGuildEmoji } from '../utils/guild-emojis.js';
import { ensureSupportRole } from '../utils/role-access.js';

export const EMBED_MODAL_WELCOME = 'husaria_embed_modal_welcome';
const PUBLISH_BTN_ID             = 'husaria_welcome_publish';
const CANCEL_BTN_ID              = 'husaria_welcome_cancel';

const FIELD_MESSAGE = 'welcome_message';

const ASSETS_DIR = join(__dirname, '..', '..', 'img');

export function buildWelcomeModal(): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(EMBED_MODAL_WELCOME)
        .setTitle('👋 Powitanie')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId(FIELD_MESSAGE)
                    .setLabel('Wiadomość powitalna')
                    .setPlaceholder('Wiadmość powitalna')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(1000)
                    .setRequired(true),
            ),
        );
}

function buildWelcomeFiles(): AttachmentBuilder[] {
    return [
        new AttachmentBuilder(join(ASSETS_DIR, 'hussars_banner.png')).setName('hussars_banner.png'),
    ];
}

export async function handleWelcomeModalSubmit(interaction: ModalSubmitInteraction) {
    if (!(await ensureSupportRole(interaction))) {
        return;
    }

    const message = interaction.fields.getTextInputValue(FIELD_MESSAGE).trim() || 'Wiadmość powitalna';
    const g2Emoji = getGuildEmoji(interaction.guild, 'G2Hussars')
        || getGuildEmoji(interaction.guild, 'g2hussars')
        || getGuildEmoji(interaction.guild, 'G2_Hussars')
        || '';
    const memberCount = interaction.guild?.memberCount ?? 0;

    const embed = buildWelcomeEmbed({ g2Emoji, message, memberCount });

    const reply = await interaction.reply({
        content: '👁️ **Podgląd embeddeda:**',
        embeds: [embed],
        files: buildWelcomeFiles(),
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
                await targetChannel.send({ embeds: [embed], files: buildWelcomeFiles() });
                await btnInteraction.update({ content: '✅ Embed wysłany!', embeds: [], components: [] });
            } catch (error) {
                console.error('❌ Błąd publikacji welcome embeda:', error);
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
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        if (message.includes('time')) {
            await interaction.editReply({ content: '⏰ Czas minął — anulowano.', components: [] });
            return;
        }

        console.error('❌ Błąd obsługi welcome embeda:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas tworzenia embeda. Spróbuj ponownie.',
            components: [],
        });
    }
}
