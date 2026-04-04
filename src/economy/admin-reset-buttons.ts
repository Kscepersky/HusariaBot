import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    EmbedBuilder,
} from 'discord.js';
import { resetCoinsByAdmin, resetLevelByAdmin } from './repository.js';
import { resolveEconomyGuildId } from './discord.js';
import { logEconomyAdminMutation } from './admin-log.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import { ensureSupportRole } from '../utils/role-access.js';

type EconomyResetAction = 'coins' | 'level';
type EconomyResetDecision = 'confirm' | 'cancel';

const ECONOMY_RESET_CUSTOM_ID_PREFIX = 'economy_reset';

interface ParsedEconomyResetCustomId {
    action: EconomyResetAction;
    decision: EconomyResetDecision;
    targetUserId: string;
}

export function buildEconomyResetCustomId(
    action: EconomyResetAction,
    decision: EconomyResetDecision,
    targetUserId: string,
): string {
    return `${ECONOMY_RESET_CUSTOM_ID_PREFIX}:${action}:${decision}:${targetUserId}`;
}

export function buildEconomyResetButtons(targetUserId: string, action: EconomyResetAction) {
    const confirmId = buildEconomyResetCustomId(action, 'confirm', targetUserId);
    const cancelId = buildEconomyResetCustomId(action, 'cancel', targetUserId);

    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(confirmId)
            .setLabel('Potwierdz')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(cancelId)
            .setLabel('Anuluj')
            .setStyle(ButtonStyle.Secondary),
    );
}

function parseEconomyResetCustomId(customId: string): ParsedEconomyResetCustomId | null {
    if (!customId.startsWith(`${ECONOMY_RESET_CUSTOM_ID_PREFIX}:`)) {
        return null;
    }

    const parts = customId.split(':');
    if (parts.length !== 4) {
        return null;
    }

    const action = parts[1];
    const decision = parts[2];
    const targetUserId = parts[3];

    if ((action !== 'coins' && action !== 'level') || (decision !== 'confirm' && decision !== 'cancel')) {
        return null;
    }

    if (!targetUserId || targetUserId.length < 10) {
        return null;
    }

    return {
        action,
        decision,
        targetUserId,
    };
}

function buildDoneEmbed(action: EconomyResetAction, targetUserId: string): EmbedBuilder {
    const actionLabel = action === 'coins' ? 'coinsy' : 'level i XP';

    return new EmbedBuilder()
        .setColor(HusariaColors.RED)
        .setTitle('✅ Reset wykonany')
        .setDescription(`Zresetowano ${actionLabel} u <@${targetUserId}>.`)
        .setTimestamp();
}

export async function handleEconomyResetButton(interaction: ButtonInteraction): Promise<boolean> {
    const parsed = parseEconomyResetCustomId(interaction.customId);
    if (!parsed) {
        return false;
    }

    if (!(await ensureSupportRole(interaction))) {
        return true;
    }

    if (parsed.decision === 'cancel') {
        await interaction.update({
            content: 'Anulowano reset.',
            components: [],
            embeds: [],
        });
        return true;
    }

    const guildId = resolveEconomyGuildId(interaction);
    if (!guildId) {
        await interaction.update({
            content: '❌ Nie mozna ustalic serwera dla ekonomii.',
            components: [],
            embeds: [],
        });
        return true;
    }

    const nowTimestamp = Date.now();
    const reason = parsed.action === 'coins'
        ? 'Reset coins przez komende /resetuj-coinsy'
        : 'Reset level/XP przez komende /resetuj-level';

    try {
        await interaction.deferUpdate();

        const mutation = parsed.action === 'coins'
            ? await resetCoinsByAdmin({
                guildId,
                targetUserId: parsed.targetUserId,
                adminUserId: interaction.user.id,
                reason,
                nowTimestamp,
            })
            : await resetLevelByAdmin({
                guildId,
                targetUserId: parsed.targetUserId,
                adminUserId: interaction.user.id,
                reason,
                nowTimestamp,
            });

        let loggingWarning = '';
        try {
            await logEconomyAdminMutation(interaction.user.id, reason, mutation);
        } catch (error) {
            console.error('❌  Nie udalo sie zapisac logu resetu ekonomii:', error);
            loggingWarning = 'Reset wykonany, ale nie udalo sie zapisac logu.';
        }

        const embed = buildDoneEmbed(parsed.action, parsed.targetUserId);
        if (loggingWarning) {
            embed.addFields({ name: 'Uwaga', value: loggingWarning, inline: false });
        }

        await interaction.editReply({
            content: '',
            components: [],
            embeds: [embed],
        });
    } catch (error) {
        console.error('❌  Nie udalo sie wykonac resetu ekonomii:', error);
        await interaction.editReply({
            content: '❌ Wystapil blad podczas resetowania danych.',
            components: [],
            embeds: [],
        });
    }

    return true;
}
