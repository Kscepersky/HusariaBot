import {
    ChatInputCommandInteraction,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { getShopItemById } from '../shop/repository.js';
import { getEconomyUserState } from '../economy/repository.js';
import { buildPurchaseConfirmEmbed, buildPurchaseConfirmButtons } from '../shop/shop-ui.js';
import { trackConfirmation, buildConfirmKey } from '../shop/confirmation-tracker.js';

const CONFIRMATION_TIMEOUT_MS = 60_000;

export const kupCommand = {
    data: new SlashCommandBuilder()
        .setName('kup')
        .setDescription('🛒 Kup przedmiot ze sklepu')
        .setDMPermission(false)
        .addIntegerOption((opt) =>
            opt
                .setName('id')
                .setDescription('ID przedmiotu ze sklepu')
                .setRequired(true)
                .setMinValue(1)
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({ content: '❌ Ta komenda działa tylko na serwerze.', flags: MessageFlags.Ephemeral });
            return;
        }

        const itemId = interaction.options.getInteger('id', true);

        try {
            const item = await getShopItemById(itemId);

            if (!item) {
                await interaction.reply({ content: `❌ Przedmiot o ID **#${itemId}** nie istnieje.`, flags: MessageFlags.Ephemeral });
                return;
            }

            if (!item.isActive) {
                await interaction.reply({ content: `❌ Przedmiot **${item.name}** jest niedostępny.`, flags: MessageFlags.Ephemeral });
                return;
            }

            const userState = await getEconomyUserState(guildId, interaction.user.id, Date.now());

            if (userState.coins < item.price) {
                await interaction.reply({
                    content: `❌ Nie masz wystarczającej liczby cebulionów, aby kupić ten przedmiot.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const embed = buildPurchaseConfirmEmbed(item, userState.coins);
            const buttons = buildPurchaseConfirmButtons(item.id);
            await interaction.reply({ embeds: [embed], components: [buttons], flags: MessageFlags.Ephemeral });

            const confirmKey = buildConfirmKey(interaction.user.id, itemId);
            trackConfirmation(confirmKey, CONFIRMATION_TIMEOUT_MS, async () => {
                try {
                    await interaction.editReply({ content: '⌛ Czas na potwierdzenie zakupu minął.', embeds: [], components: [] });
                } catch {
                    // interaction token expired or message already updated
                }
            });
        } catch (error) {
            const errorContent = '❌ Wystąpił błąd podczas pobierania przedmiotu.';
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: errorContent });
            } else {
                await interaction.reply({ content: errorContent, flags: MessageFlags.Ephemeral });
            }
        }
    },
};
