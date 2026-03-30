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
import { buildHusariaEmbed, parseEmbedOptions } from '../utils/embed-builder.js';
import { ensureSupportRole } from '../utils/role-access.js';

export const EMBED_MODAL_ANNOUNCEMENT = 'husaria_embed_modal_ogloszenie';
const COLOR_SELECT_ID                 = 'husaria_announcement_color';
const PUBLISH_BTN_ID                  = 'husaria_announcement_publish';
const CANCEL_BTN_ID                   = 'husaria_announcement_cancel';

const FIELD_TITLE = 'announcement_title';
const FIELD_DESC  = 'announcement_desc';

export function buildAnnouncementModal(): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(EMBED_MODAL_ANNOUNCEMENT)
        .setTitle('📝 Tworzenie Ogłoszenia')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId(FIELD_TITLE)
                    .setLabel('Tytuł')
                    .setPlaceholder('np. 📢 Ważna informacja dla fanów')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(256)
                    .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId(FIELD_DESC)
                    .setLabel('Treść (obsługuje wiele linii i emotki)')
                    .setPlaceholder('🔥 Linia pierwsza\n⚡ Linia druga\n🏆 Linia trzecia')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(4000)
                    .setRequired(true),
            ),
        );
}

export async function handleAnnouncementModalSubmit(interaction: ModalSubmitInteraction) {
    if (!(await ensureSupportRole(interaction))) {
        return;
    }

    const title       = interaction.fields.getTextInputValue(FIELD_TITLE).trim();
    const description = interaction.fields.getTextInputValue(FIELD_DESC).trim();

    const colorSelect = new StringSelectMenuBuilder()
        .setCustomId(COLOR_SELECT_ID)
        .setPlaceholder('🎨 Wybierz kolor embeddeda...')
        .addOptions(
            { label: '🔴 Czerwony', value: 'czerwony', description: 'Husaria — główny kolor' },
            { label: '⚪ Biały',    value: 'biały',    description: 'Czysty, jasny styl' },
            { label: '⬛ Szary',    value: 'szary',    description: 'Subtelny, ciemny motyw' },
            { label: '🟡 Złoty',    value: 'złoty',    description: 'Wyróżnione ogłoszenia' },
        );

    const reply = await interaction.reply({
        content: '🎨 Wybierz kolor embeddeda:',
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(colorSelect)],
        flags: MessageFlags.Ephemeral,
        withResponse: true,
    });

    try {
        const colorInteraction = await reply.resource!.message!.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            time: 60_000,
        }) as StringSelectMenuInteraction;

        const colorName = colorInteraction.values[0];
        const options   = parseEmbedOptions({ title, description, colorName });
        const embed     = buildHusariaEmbed(options);

        await colorInteraction.update({
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
