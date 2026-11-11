import {
    DiscordRequestError,
    editChannelMessage,
    editChannelMessageWithFile,
    getGuildAllChannels,
    sendMessageToChannel,
    sendMessageWithFile,
    type DiscordFileUpload,
    type DiscordMessagePayload,
} from '../dashboard/discord-api.js';
import { isSnowflake } from '../permissions/permission-store.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import { buildTasksSectionLink } from '../utils/dashboard-url.js';
import { createLogger } from '../utils/logger.js';
import { renderBoardImageForTasks } from './board-image.js';
import { formatTaskLine } from './format.js';
import { getTaskStore, type TaskStore } from './task-store.js';
import type { Task } from './types.js';

/**
 * Stała wiadomość z listą otwartych tasków na kanale `TASKS_CHANNEL_ID`.
 * Działa w procesie dashboardu (REST), bo tam dzieją się wszystkie zmiany.
 * Odświeża się co godzinę oraz po każdej zmianie (z debounce, żeby seria
 * edycji nie wpadła w rate limit Discorda).
 */

const boardLogger = createLogger('tasks:board');

export const TASK_BOARD_INTERVAL_MS = 60 * 60 * 1000;
export const TASK_BOARD_DEBOUNCE_MS = 3_000;
const DESCRIPTION_BUDGET = 3_900;
const VIEW_CHANNEL_PERMISSION = 1n << 10n;

export function buildTaskBoardPayload(tasks: readonly Task[], now: number = Date.now()): DiscordMessagePayload {
    const groups = new Map<string, Task[]>();
    // "Dla wszystkich" zawsze na gorze, reszta w kolejnosci pierwszego (najwazniejszego) taska.
    const sorted = [...tasks].sort((left, right) => Number(left.assigneeId !== null) - Number(right.assigneeId !== null));
    for (const task of sorted) {
        const key = task.assigneeId ?? 'all';
        groups.set(key, [...(groups.get(key) ?? []), task]);
    }

    const lines: string[] = [];
    let used = 0;
    let shown = 0;

    outer: for (const [key, groupTasks] of groups) {
        const header = key === 'all' ? '**👥 Wszyscy**' : `**👤 <@${key}>**`;
        const block = [header, ...groupTasks.map((task) => formatTaskLine(task, now))];

        for (const [index, line] of block.entries()) {
            if (used + line.length + 1 > DESCRIPTION_BUDGET) break outer;
            // Naglowek bez zadnego taska pod nim nie ma sensu.
            if (index === 0 && used + line.length + block[1]!.length + 2 > DESCRIPTION_BUDGET) break outer;
            lines.push(line);
            used += line.length + 1;
            if (index > 0) shown += 1;
        }
        lines.push('');
        used += 1;
    }

    const hidden = tasks.length - shown;
    if (hidden > 0) {
        lines.push(`…i jeszcze **${hidden}** ${hidden === 1 ? 'task' : 'tasków'} — pełna lista w dashboardzie.`);
    }

    const link = buildTasksSectionLink();
    const embed = {
        title: '📋 Taski do zrobienia',
        ...(link ? { url: link } : {}),
        description: tasks.length === 0 ? 'Brak otwartych tasków 🎉' : lines.join('\n').trim(),
        color: tasks.length === 0 ? HusariaColors.GREEN : HusariaColors.RED,
        footer: { text: `Otwarte: ${tasks.length} · 🔴 wysoki 🟡 normalny 🟢 niski · odświeżane co godzinę` },
        timestamp: new Date(now).toISOString(),
    };

    // Puste `attachments` zdejmuje z wiadomosci obrazek po ewentualnym wczesniejszym renderze.
    return { embeds: [embed], attachments: [], allowed_mentions: { parse: [] } };
}

export const TASK_BOARD_IMAGE_NAME = 'taski.png';

/** Wersja z obrazkiem: krotkie podsumowanie tekstem, a cala lista na karcie (z alt-textem). */
export function buildTaskBoardImagePayload(tasks: readonly Task[], altText: string, now: number = Date.now()): DiscordMessagePayload {
    const overdue = tasks.filter((task) => task.dueAt !== null && task.dueAt < now).length;
    const link = buildTasksSectionLink();
    const summary = [
        tasks.length === 0 ? 'Brak otwartych tasków 🎉' : `Otwarte: **${tasks.length}**${overdue > 0 ? ` · ⚠️ po terminie: **${overdue}**` : ''}`,
        link ? `[Otwórz taski w dashboardzie](${link})` : null,
    ].filter(Boolean).join('\n');

    return {
        embeds: [{
            title: '📋 Taski do zrobienia',
            description: summary,
            color: tasks.length === 0 ? HusariaColors.GREEN : HusariaColors.RED,
            image: { url: `attachment://${TASK_BOARD_IMAGE_NAME}` },
            footer: { text: 'Odświeżane co godzinę i po każdej zmianie' },
            timestamp: new Date(now).toISOString(),
        }],
        attachments: [{ id: 0, description: altText.slice(0, 1024) }],
        allowed_mentions: { parse: [] },
    };
}

export interface BoardImage {
    data: Buffer;
    altText: string;
}

export interface TaskBoardDeps {
    getStore: () => Promise<TaskStore>;
    send: (channelId: string, payload: DiscordMessagePayload) => Promise<string>;
    edit: (channelId: string, messageId: string, payload: DiscordMessagePayload) => Promise<void>;
    /** Gdy podane razem z `sendWithFile`/`editWithFile`, lista idzie jako obrazek; blad renderu = wersja tekstowa. */
    render?: (tasks: readonly Task[]) => Promise<BoardImage>;
    sendWithFile?: (channelId: string, payload: DiscordMessagePayload, file: DiscordFileUpload) => Promise<string>;
    editWithFile?: (channelId: string, messageId: string, payload: DiscordMessagePayload, file: DiscordFileUpload) => Promise<void>;
}

export interface TaskBoard {
    refreshNow(): Promise<void>;
    requestRefresh(): void;
    start(): void;
    stop(): void;
}

function isMissingMessageError(error: unknown): boolean {
    return error instanceof DiscordRequestError && error.status === 404;
}

export function createTaskBoard(
    deps: TaskBoardDeps,
    options: { channelId: string | null; debounceMs?: number; intervalMs?: number },
): TaskBoard {
    const { channelId } = options;
    const debounceMs = options.debounceMs ?? TASK_BOARD_DEBOUNCE_MS;
    const intervalMs = options.intervalMs ?? TASK_BOARD_INTERVAL_MS;

    let debounceTimer: NodeJS.Timeout | null = null;
    let intervalTimer: NodeJS.Timeout | null = null;
    let inFlight: Promise<void> | null = null;
    let rerunRequested = false;

    async function tryRenderImage(tasks: readonly Task[]): Promise<BoardImage | null> {
        if (!deps.render || !deps.sendWithFile || !deps.editWithFile) return null;
        try {
            return await deps.render(tasks);
        } catch (error) {
            boardLogger.warn('TASK_BOARD_RENDER_FAILED', 'Nie udalo sie wyrenderowac obrazka listy taskow - uzywam wersji tekstowej.', { channelId }, error);
            return null;
        }
    }

    async function publish(): Promise<void> {
        if (!channelId) return;

        const store = await deps.getStore();
        const tasks = await store.listOpenTasks();
        const image = await tryRenderImage(tasks);
        const payload = image ? buildTaskBoardImagePayload(tasks, image.altText) : buildTaskBoardPayload(tasks);
        const file: DiscordFileUpload | null = image
            ? { filename: TASK_BOARD_IMAGE_NAME, contentType: 'image/png', data: image.data }
            : null;
        const [messageId, storedChannelId] = await Promise.all([
            store.getSetting('board_message_id'),
            store.getSetting('board_channel_id'),
        ]);

        if (messageId && storedChannelId === channelId) {
            try {
                if (file && deps.editWithFile) {
                    await deps.editWithFile(channelId, messageId, payload, file);
                } else {
                    await deps.edit(channelId, messageId, payload);
                }
                return;
            } catch (error) {
                if (!isMissingMessageError(error)) throw error;
                boardLogger.warn('TASK_BOARD_MESSAGE_MISSING', 'Wiadomosc z taskami zniknela - tworze nowa.', { channelId, messageId });
            }
        }

        const newMessageId = file && deps.sendWithFile
            ? await deps.sendWithFile(channelId, payload, file)
            : await deps.send(channelId, payload);
        await store.setSetting('board_message_id', newMessageId);
        await store.setSetting('board_channel_id', channelId);
    }

    async function refreshNow(): Promise<void> {
        if (inFlight) {
            rerunRequested = true;
            return inFlight;
        }

        const run = (async () => {
            do {
                rerunRequested = false;
                try {
                    await publish();
                } catch (error) {
                    boardLogger.error('TASK_BOARD_REFRESH_FAILED', 'Nie udalo sie odswiezyc listy taskow na Discordzie.', { channelId }, error);
                }
            } while (rerunRequested);
            // Synchronicznie z ostatnim sprawdzeniem petli - kolejne zadanie nie zginie w szczelinie.
            inFlight = null;
        })();
        inFlight = run;

        return run;
    }

    return {
        refreshNow,

        requestRefresh() {
            if (!channelId) return;
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                debounceTimer = null;
                void refreshNow();
            }, debounceMs);
            debounceTimer.unref?.();
        },

        start() {
            if (!channelId || intervalTimer) return;
            void refreshNow();
            intervalTimer = setInterval(() => { void refreshNow(); }, intervalMs);
            intervalTimer.unref?.();
        },

        stop() {
            if (debounceTimer) clearTimeout(debounceTimer);
            if (intervalTimer) clearInterval(intervalTimer);
            debounceTimer = null;
            intervalTimer = null;
        },
    };
}

export function resolveTasksChannelId(): string | null {
    const value = process.env.TASKS_CHANNEL_ID?.trim();
    return value && isSnowflake(value) ? value : null;
}

interface ChannelWithOverwrites {
    id: string;
    parent_id: string | null;
    permission_overwrites?: Array<{ id: string; type: number; deny: string }>;
}

function deniesEveryoneView(channel: ChannelWithOverwrites | undefined, guildId: string): boolean | null {
    const overwrite = channel?.permission_overwrites?.find((item) => item.id === guildId);
    if (!overwrite) return null;
    try {
        return (BigInt(overwrite.deny) & VIEW_CHANNEL_PERMISSION) === VIEW_CHANNEL_PERMISSION;
    } catch {
        return false;
    }
}

/** Ostrzega w logach, gdy kanał tasków wygląda na widoczny dla @everyone. */
export async function warnIfTasksChannelPublic(channelId: string, guildId: string): Promise<void> {
    try {
        const channels = await getGuildAllChannels(guildId) as unknown as ChannelWithOverwrites[];
        const channel = channels.find((item) => item.id === channelId);
        if (!channel) {
            boardLogger.warn('TASK_BOARD_CHANNEL_NOT_FOUND', 'Kanal z TASKS_CHANNEL_ID nie istnieje na serwerze.', { channelId });
            return;
        }

        const parent = channel.parent_id ? channels.find((item) => item.id === channel.parent_id) : undefined;
        const isPrivate = deniesEveryoneView(channel, guildId) ?? deniesEveryoneView(parent, guildId) ?? false;
        if (!isPrivate) {
            boardLogger.warn('TASK_BOARD_CHANNEL_PUBLIC', 'Kanal taskow moze byc widoczny dla @everyone - ustaw go jako prywatny dla administracji.', { channelId });
        }
    } catch (error) {
        boardLogger.warn('TASK_BOARD_CHANNEL_CHECK_FAILED', 'Nie udalo sie sprawdzic widocznosci kanalu taskow.', { channelId }, error);
    }
}

let sharedBoard: TaskBoard | null = null;

function getTaskBoard(): TaskBoard {
    if (!sharedBoard) {
        sharedBoard = createTaskBoard(
            {
                getStore: getTaskStore,
                send: sendMessageToChannel,
                edit: editChannelMessage,
                render: renderBoardImageForTasks,
                sendWithFile: sendMessageWithFile,
                editWithFile: editChannelMessageWithFile,
            },
            { channelId: resolveTasksChannelId() },
        );
    }
    return sharedBoard;
}

export function startTaskBoard(): void {
    const channelId = resolveTasksChannelId();
    if (!channelId) {
        boardLogger.warn('TASK_BOARD_DISABLED', 'Brak poprawnego TASKS_CHANNEL_ID - lista taskow na Discordzie jest wylaczona.');
        return;
    }

    const guildId = process.env.GUILD_ID?.trim();
    if (guildId) void warnIfTasksChannelPublic(channelId, guildId);
    getTaskBoard().start();
}

export function requestTaskBoardRefresh(): void {
    getTaskBoard().requestRefresh();
}
