import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    MessageFlags,
    SlashCommandBuilder,
    EmbedBuilder,
} from 'discord.js';
import { config } from 'dotenv';
import { HusariaColors } from '../utils/husaria-theme.js';
import { ensureSupportRole } from '../utils/role-access.js';

config();

function isValidDashboardUrl(value: string): boolean {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function resolveDashboardUrl(): string | null {
    const configuredUrl = process.env.DASHBOARD_BASE_URL?.trim() ?? '';
    if (configuredUrl) {
        return isValidDashboardUrl(configuredUrl) ? configuredUrl : null;
    }

    if (process.env.NODE_ENV === 'production') {
        return null;
    }

    const port = process.env.DASHBOARD_PORT?.trim() || '3000';
    return `http://localhost:${port}`;
}

export const dashboardLinkCommand = {
    data: new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('🌐 Wyślij link do panelu administracyjnego')
        .setDefaultMemberPermissions(null),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!(await ensureSupportRole(interaction))) {
            return;
        }

        const dashboardUrl = resolveDashboardUrl();
        if (!dashboardUrl) {
            await interaction.reply({
                content: '❌ DASHBOARD_BASE_URL ma nieprawidłowy format lub nie jest ustawiony.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(HusariaColors.RED)
            .setTitle('🌐 Dashboard administracyjny')
            .setDescription(
                [
                    'Panel do tworzenia i publikacji embedów oraz wysyłki obrazów.',
                    'Dostęp posiadają tylko role Zarząd i Moderator.',
                    '',
                    `Link: ${dashboardUrl}`,
                ].join('\n'),
            );

        const linkButton = new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel('Otwórz dashboard')
            .setURL(dashboardUrl);

        await interaction.reply({
            embeds: [embed],
            components: [new ActionRowBuilder<ButtonBuilder>().addComponents(linkButton)],
            flags: MessageFlags.Ephemeral,
        });
    },
};
