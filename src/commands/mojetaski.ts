import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import { ensureDashboardAccess } from '../utils/role-access.js';
import { buildTasksSectionLink } from '../utils/dashboard-url.js';
import { createLogger } from '../utils/logger.js';
import { getTaskStore } from '../tasks/task-store.js';
import { escapeDiscordInline, formatTaskLine } from '../tasks/format.js';
import type { Task } from '../tasks/types.js';

const commandLogger = createLogger('bot:mojetaski');
const DESCRIPTION_BUDGET = 3_800;

/** Odpowiedź jest publiczna - pokazujemy tylko tytuły, priorytety i terminy, bez opisów. */
export function buildMyTasksDescription(tasks: readonly Task[], now: number = Date.now()): string {
    if (tasks.length === 0) {
        return 'Nie masz żadnych otwartych tasków 🎉';
    }

    const lines: string[] = [];
    let used = 0;
    for (const task of tasks) {
        const line = `${formatTaskLine(task, now)}${task.assigneeId === null ? ' · 👥 dla wszystkich' : ''}`;
        if (used + line.length + 1 > DESCRIPTION_BUDGET) break;
        lines.push(line);
        used += line.length + 1;
    }

    const hidden = tasks.length - lines.length;
    if (hidden > 0) {
        lines.push(`…i jeszcze **${hidden}** — pełna lista w dashboardzie.`);
    }
    return lines.join('\n');
}

export const mojeTaskiCommand = {
    data: new SlashCommandBuilder()
        .setName('mojetaski')
        .setDescription('📋 Pokaż taski przypisane do Ciebie')
        .setDefaultMemberPermissions(null),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!(await ensureDashboardAccess(interaction))) {
            return;
        }

        let tasks: Task[];
        try {
            tasks = await (await getTaskStore()).listOpenTasksForUser(interaction.user.id);
        } catch (error) {
            commandLogger.error('MY_TASKS_LOAD_FAILED', 'Nie udalo sie pobrac taskow uzytkownika.', { actorUserId: interaction.user.id }, error);
            await interaction.reply({ content: '❌ Nie udało się pobrać tasków. Spróbuj ponownie później.', flags: MessageFlags.Ephemeral });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(tasks.length === 0 ? HusariaColors.GREEN : HusariaColors.RED)
            .setTitle(`📋 Taski: ${escapeDiscordInline(interaction.user.displayName ?? interaction.user.username, 80)}`)
            .setDescription(buildMyTasksDescription(tasks))
            .setFooter({ text: `Otwarte: ${tasks.length} · 🔴 wysoki 🟡 normalny 🟢 niski` });

        const link = buildTasksSectionLink();
        const components = link
            ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Otwórz taski w dashboardzie').setURL(link),
            )]
            : [];

        await interaction.reply({ embeds: [embed], components, allowedMentions: { parse: [] } });
    },
};
