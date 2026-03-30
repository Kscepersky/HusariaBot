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
    GuildTextBasedChannel,
} from 'discord.js';
import { buildGiveawayEmbed } from '../utils/embed-builder.js';
import { ensureSupportRole } from '../utils/role-access.js';

export const EMBED_MODAL_GIVEAWAY = 'husaria_embed_modal_giveaway';
const PUBLISH_BTN_ID              = 'husaria_giveaway_publish';
const CANCEL_BTN_ID               = 'husaria_giveaway_cancel';

const FIELD_PRIZE        = 'giveaway_nagroda';
const FIELD_REQUIREMENTS = 'giveaway_wymagania';
const FIELD_ENDS_AT      = 'giveaway_koniec';

export function buildGiveawayModal(): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(EMBED_MODAL_GIVEAWAY)
        .setTitle('🎁 Giveaway')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId(FIELD_PRIZE)
                    .setLabel('Nagroda')
                    .setPlaceholder('np. Skin Prestiżowy — Ahri')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(256)
                    .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId(FIELD_REQUIREMENTS)
                    .setLabel('Wymagania')
                    .setPlaceholder('np. Obserwuj serwer i zostaw reakcję 🎁')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(1000)
                    .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId(FIELD_ENDS_AT)
                    .setLabel('Czas do końca (Unix timestamp)')
                    .setPlaceholder('np. 1743861600  —  epochconverter.com')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(20)
                    .setRequired(true),
            ),
        );
}

export async function handleGiveawayModalSubmit(interaction: ModalSubmitInteraction) {
    if (!(await ensureSupportRole(interaction))) {
        return;
    }

    const prize        = interaction.fields.getTextInputValue(FIELD_PRIZE).trim();
    const requirements = interaction.fields.getTextInputValue(FIELD_REQUIREMENTS).trim();
    const endsAt       = parseInt(interaction.fields.getTextInputValue(FIELD_ENDS_AT).trim(), 10);

    const embed = buildGiveawayEmbed({ prize, requirements, endsAt });

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
            await btnInteraction.update({ content: '✅ Embed wysłany!', embeds: [], components: [] });
            await (interaction.channel as GuildTextBasedChannel).send({ embeds: [embed] });
        } else {
            await btnInteraction.update({ content: '❌ Anulowano.', embeds: [], components: [] });
        }

    } catch {
        await interaction.editReply({ content: '⏰ Czas minął — anulowano.', components: [] });
    }
}
