import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    PermissionFlagsBits,
    ComponentType,
    MessageFlags,
} from 'discord.js';
import { buildMatchModal, EMBED_MODAL_MATCH }               from '../embeds/match.js';
import { buildResultModal, EMBED_MODAL_RESULT }             from '../embeds/result.js';
import { buildAnnouncementModal, EMBED_MODAL_ANNOUNCEMENT } from '../embeds/announcement.js';
import { buildGiveawayModal, EMBED_MODAL_GIVEAWAY }         from '../embeds/giveaway.js';

export const EMBED_TYPE_SELECT = 'husaria_embed_type_select';

export { EMBED_MODAL_MATCH, EMBED_MODAL_RESULT, EMBED_MODAL_ANNOUNCEMENT, EMBED_MODAL_GIVEAWAY };

export const embedCommand = {
    data: new SlashCommandBuilder()
        .setName('embed')
        .setDescription('📝 Stwórz embedded wiadomość')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
            await interaction.reply({
                content: '🚫 Nie masz uprawnień. Wymagane: **Zarządzanie wiadomościami**.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const typeSelect = new StringSelectMenuBuilder()
            .setCustomId(EMBED_TYPE_SELECT)
            .setPlaceholder('📋 Wybierz typ embeddeda...')
            .addOptions(
                { label: '⚔️ Mecz',       value: 'mecz',        description: 'Zapowiedź nadchodzącego meczu' },
                { label: '📊 Wynik',       value: 'wynik',       description: 'Wynik rozegraanego meczu' },
                { label: '📢 Ogłoszenie',  value: 'ogloszenie',  description: 'Wolna forma — dowolna treść' },
                { label: '🎁 Giveaway',    value: 'giveaway',    description: 'Konkurs z nagrodami' },
            );

        const reply = await interaction.reply({
            content: '📋 Wybierz typ embeddeda:',
            components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(typeSelect)],
            flags: MessageFlags.Ephemeral,
            withResponse: true,
        });

        try {
            const typeInteraction = await reply.resource!.message!.awaitMessageComponent({
                componentType: ComponentType.StringSelect,
                time: 60_000,
            }) as StringSelectMenuInteraction;

            const type = typeInteraction.values[0];

            if (type === 'mecz') {
                await typeInteraction.showModal(buildMatchModal());
            } else if (type === 'wynik') {
                await typeInteraction.showModal(buildResultModal());
            } else if (type === 'giveaway') {
                await typeInteraction.showModal(buildGiveawayModal());
            } else {
                await typeInteraction.showModal(buildAnnouncementModal());
            }

        } catch {
            await interaction.editReply({ content: '⏰ Czas minął — anulowano.', components: [] });
        }
    },
};
