import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { addCoinsByAdmin } from '../economy/repository.js';
import { logEconomyAdminMutation } from '../economy/admin-log.js';
import { resolveEconomyGuildId } from '../economy/discord.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import { ensureSupportRole } from '../utils/role-access.js';

const MAX_REASON_LENGTH = 200;

function normalizeReason(rawValue: string | null): string {
    const normalized = (rawValue ?? '').trim();
    if (normalized.length === 0) {
        return 'Brak powodu';
    }

    return normalized.slice(0, MAX_REASON_LENGTH);
}

export const dodajCoinsyCommand = {
    data: new SlashCommandBuilder()
        .setName('dodaj-coinsy')
        .setDescription('➕ Dodaj cebuliony uzytkownikowi')
        .setDefaultMemberPermissions(null)
        .setDMPermission(false)
        .addUserOption((option) => {
            return option
                .setName('uzytkownik')
                .setDescription('Komu dodac coinsy')
                .setRequired(true);
        })
        .addIntegerOption((option) => {
            return option
                .setName('ilosc')
                .setDescription('Liczba coinsow do dodania')
                .setMinValue(1)
                .setRequired(true);
        })
        .addStringOption((option) => {
            return option
                .setName('powod')
                .setDescription('Powod operacji (np. konkurs)')
                .setMaxLength(MAX_REASON_LENGTH)
                .setRequired(false);
        }),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!(await ensureSupportRole(interaction))) {
            return;
        }

        const guildId = resolveEconomyGuildId(interaction);
        if (!guildId) {
            await interaction.reply({
                content: '❌ Nie mozna ustalic serwera dla ekonomii.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const targetUser = interaction.options.getUser('uzytkownik', true);
        const amount = interaction.options.getInteger('ilosc', true);
        const reason = normalizeReason(interaction.options.getString('powod'));

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const mutation = await addCoinsByAdmin({
                guildId,
                targetUserId: targetUser.id,
                adminUserId: interaction.user.id,
                reason,
                amount,
                nowTimestamp: Date.now(),
            });

            let loggingWarning = '';
            try {
                await logEconomyAdminMutation(interaction.user.id, reason, mutation);
            } catch (error) {
                console.error('❌  Nie udalo sie zapisac logu /dodaj-coinsy:', error);
                loggingWarning = 'Operacja wykonana, ale nie udalo sie zapisac logu.';
            }

            const embed = new EmbedBuilder()
                .setColor(HusariaColors.GREEN)
                .setTitle('✅ Dodano coinsy')
                .setDescription(`Dodano **${amount}** coinsow uzytkownikowi <@${targetUser.id}>.`)
                .addFields(
                    { name: 'Nowy stan konta', value: `${mutation.currentCoins}`, inline: true },
                    { name: 'Powod', value: reason, inline: false },
                )
                .setTimestamp();

            if (loggingWarning) {
                embed.addFields({ name: 'Uwaga', value: loggingWarning, inline: false });
            }

            await interaction.editReply({ content: '', embeds: [embed] });
        } catch (error) {
            console.error('❌  Nie udalo sie wykonac /dodaj-coinsy:', error);
            await interaction.editReply({
                content: '❌ Wystapil blad podczas dodawania coinsow.',
                embeds: [],
            });
        }
    },
};
