import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { addXpByAdmin } from '../economy/repository.js';
import { logEconomyAdminMutation } from '../economy/admin-log.js';
import { resolveEconomyGuildId } from '../economy/discord.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import { ensureSupportRole } from '../utils/role-access.js';

const MAX_REASON_LENGTH = 200;
const MAX_XP_AMOUNT = 1_000_000;

function normalizeReason(rawValue: string | null): string {
    const normalized = (rawValue ?? '').trim();
    if (normalized.length === 0) {
        return 'Brak powodu';
    }

    return normalized.slice(0, MAX_REASON_LENGTH);
}

export const dodajXpCommand = {
    data: new SlashCommandBuilder()
        .setName('dodaj-xp')
        .setDescription('➕ Dodaj XP uzytkownikowi')
        .setDefaultMemberPermissions(null)
        .setDMPermission(false)
        .addUserOption((option) => {
            return option
                .setName('uzytkownik')
                .setDescription('Komu dodac XP')
                .setRequired(true);
        })
        .addIntegerOption((option) => {
            return option
                .setName('ilosc')
                .setDescription('Liczba XP do dodania')
                .setMinValue(1)
                .setMaxValue(MAX_XP_AMOUNT)
                .setRequired(true);
        })
        .addStringOption((option) => {
            return option
                .setName('powod')
                .setDescription('Powod operacji (np. event)')
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
            const mutation = await addXpByAdmin({
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
                console.error('❌  Nie udalo sie zapisac logu /dodaj-xp:', error);
                loggingWarning = 'Operacja wykonana, ale nie udalo sie zapisac logu.';
            }

            const embed = new EmbedBuilder()
                .setColor(HusariaColors.GREEN)
                .setTitle('✅ Dodano XP')
                .setDescription(`Dodano **${amount}** XP uzytkownikowi <@${targetUser.id}>.`)
                .addFields(
                    { name: 'Nowe XP', value: `${mutation.currentXp}`, inline: true },
                    { name: 'Nowy level', value: `${mutation.currentLevel}`, inline: true },
                    { name: 'Powod', value: reason, inline: false },
                )
                .setTimestamp();

            if (loggingWarning) {
                embed.addFields({ name: 'Uwaga', value: loggingWarning, inline: false });
            }

            await interaction.editReply({ content: '', embeds: [embed] });
        } catch (error) {
            console.error('❌  Nie udalo sie wykonac /dodaj-xp:', error);
            await interaction.editReply({
                content: '❌ Wystapil blad podczas dodawania XP.',
                embeds: [],
            });
        }
    },
};
