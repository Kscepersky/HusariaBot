import { createCanvas, type CanvasRenderingContext2D, type Image } from 'canvas';
import {
    FONT_STACK,
    drawBackground,
    registerFontsOnce,
    roundedRectPath,
    tryFetchImage,
    type CardLayout,
} from '../commands/card-canvas.js';
import type { Task, TaskPriority } from './types.js';

/**
 * Obrazek z listą otwartych tasków (karta w stylu /level i /statylol).
 * Czysto wizualny - treść tekstowa idzie równolegle jako alt-text i opis embeda.
 */

const CARD_WIDTH = 1100;
const OUTER_PADDING = 24;
const INNER_X = 60;
const INNER_WIDTH = CARD_WIDTH - INNER_X * 2;
const HEADER_HEIGHT = 168;
const GROUP_HEADER_HEIGHT = 64;
const GROUP_GAP = 18;
const ROW_HEIGHT = 50;
const ROW_GAP = 8;
const FOOTER_HEIGHT = 64;
const AVATAR_SIZE = 44;
const MAX_ROWS = 18;
const MAX_TITLE_PIXELS = 560;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const WARSAW_TZ = 'Europe/Warsaw';

const PRIORITY_COLORS: Readonly<Record<TaskPriority, string>> = {
    high: '#ED4245',
    normal: '#FEE75C',
    low: '#57F287',
};
const PRIORITY_NAMES: Readonly<Record<TaskPriority, string>> = {
    high: 'wysoki',
    normal: 'normalny',
    low: 'niski',
};
const PRIORITY_LABELS: Readonly<Record<TaskPriority, string>> = {
    high: 'Wysoki',
    normal: 'Normalny',
    low: 'Niski',
};
const WHITE = '#F5F5F5';
const MUTED = 'rgba(255, 255, 255, 0.62)';
const ACCENT = '#DC143C';
const GOLD = '#FFD700';
const OVERDUE = '#ED4245';

const CARD_LAYOUT_BASE = { width: CARD_WIDTH, outerPadding: OUTER_PADDING, panelRadius: 18 } as const;

export interface BoardUser {
    name: string;
    avatarUrl: string | null;
}

export interface BoardGroup {
    /** `null` = taski dla wszystkich. */
    assigneeId: string | null;
    tasks: Task[];
}

export interface BoardPlan {
    groups: BoardGroup[];
    shown: number;
    hidden: number;
    height: number;
}

export interface BoardRenderInput {
    tasks: readonly Task[];
    users: Readonly<Record<string, BoardUser>>;
    now: number;
    footerText: string;
}

/** Grupuje po osobie ("Wszyscy" na górze) i ucina listę do limitu wierszy. */
export function planBoard(tasks: readonly Task[]): BoardPlan {
    const grouped = new Map<string | null, Task[]>();
    const ordered = [...tasks].sort((left, right) => Number(left.assigneeId !== null) - Number(right.assigneeId !== null));
    for (const task of ordered) {
        grouped.set(task.assigneeId, [...(grouped.get(task.assigneeId) ?? []), task]);
    }

    const groups: BoardGroup[] = [];
    let shown = 0;
    for (const [assigneeId, groupTasks] of grouped) {
        const room = MAX_ROWS - shown;
        if (room <= 0) break;
        const visible = groupTasks.slice(0, room);
        groups.push({ assigneeId, tasks: visible });
        shown += visible.length;
    }

    const hidden = tasks.length - shown;
    const bodyHeight = tasks.length === 0
        ? 150
        : groups.reduce((sum, group) => sum + GROUP_HEADER_HEIGHT + group.tasks.length * (ROW_HEIGHT + ROW_GAP) + GROUP_GAP, 0)
            + (hidden > 0 ? 46 : 0);

    return { groups, shown, hidden, height: HEADER_HEIGHT + bodyHeight + FOOTER_HEIGHT };
}

function truncateToWidth(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    const singleLine = text.replace(/\s+/g, ' ').trim();
    if (context.measureText(singleLine).width <= maxWidth) return singleLine;

    let end = singleLine.length;
    while (end > 1 && context.measureText(`${singleLine.slice(0, end)}…`).width > maxWidth) {
        end -= 1;
    }
    return `${singleLine.slice(0, end).trimEnd()}…`;
}

const dateFormatter = new Intl.DateTimeFormat('pl-PL', {
    timeZone: WARSAW_TZ,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat('pl-PL', { timeZone: WARSAW_TZ, hour: '2-digit', minute: '2-digit' });

const DAY_MS = 24 * 60 * 60 * 1000;

export function describeDue(task: Pick<Task, 'dueAt'>, now: number): { text: string; overdue: boolean } {
    if (task.dueAt === null) return { text: 'bez terminu', overdue: false };

    const diff = task.dueAt - now;
    if (diff < 0) {
        const days = Math.floor(-diff / DAY_MS);
        return { text: days >= 1 ? `${days} d po terminie` : 'po terminie', overdue: true };
    }

    const days = Math.floor(diff / DAY_MS);
    const label = days === 0 ? 'dziś' : days === 1 ? 'jutro' : `za ${days} d`;
    return { text: `${label} · ${dateFormatter.format(task.dueAt)}`, overdue: false };
}

/**
 * Emotki (w tym sekwencje ZWJ, flagi, odcienie skory i klawisze) maja inna szerokosc i
 * linie bazowa niz reszta tekstu i rozjezdzaja naglowki na karcie - wycinamy je z nickow.
 * Cyfry, # i * zostaja (sa tylko skladnikami emotek, nie emotkami).
 */
const EMOJI_PATTERN = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

export function stripEmoji(name: string): string {
    return name.replace(EMOJI_PATTERN, '').replace(/\s+/g, ' ').trim();
}

function displayName(assigneeId: string | null, users: BoardRenderInput['users']): string {
    if (assigneeId === null) return 'Wszyscy';
    // Nick z samych emotek po wycieciu jest pusty - wtedy pokazujemy koncowke ID zamiast pustego naglowka.
    return stripEmoji(users[assigneeId]?.name ?? '') || `Użytkownik ${assigneeId.slice(-4)}`;
}

/** Tekst zastępczy obrazka (czytniki ekranu, wyszukiwarka) - max 1024 znaki wg Discorda. */
export function buildBoardAltText(tasks: readonly Task[], users: BoardRenderInput['users'], now: number): string {
    if (tasks.length === 0) return 'Brak otwartych tasków.';

    const lines: string[] = [];
    for (const task of tasks) {
        const due = describeDue(task, now);
        lines.push(`${displayName(task.assigneeId, users)}: ${task.title.replace(/\s+/g, ' ').trim()} (${PRIORITY_NAMES[task.priority]}, ${due.text})`);
    }

    let text = `Otwarte taski: ${tasks.length}. `;
    for (const line of lines) {
        if (text.length + line.length + 2 > 1000) {
            text += '…';
            break;
        }
        text += `${line}; `;
    }
    return text.trim().slice(0, 1024);
}

function drawPill(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    text: string,
    color: string,
    options: { filled?: boolean } = {},
): number {
    context.font = `600 20px ${FONT_STACK}`;
    const textWidth = context.measureText(text).width;
    const width = textWidth + 48;

    roundedRectPath(context, x, y, width, 36, 18);
    context.fillStyle = options.filled ? color : 'rgba(255, 255, 255, 0.08)';
    context.fill();

    if (!options.filled) {
        context.beginPath();
        context.arc(x + 20, y + 18, 6, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
    }

    context.fillStyle = options.filled ? '#FFFFFF' : WHITE;
    context.textBaseline = 'middle';
    context.fillText(text, x + (options.filled ? 24 : 36), y + 19);
    context.textBaseline = 'alphabetic';
    return width;
}

function drawHeader(context: CanvasRenderingContext2D, input: BoardRenderInput): void {
    const { tasks, now } = input;

    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = WHITE;
    context.font = `700 44px ${FONT_STACK}`;
    context.fillText('TASKI DO ZROBIENIA', INNER_X, 98);

    context.fillStyle = ACCENT;
    context.fillRect(INNER_X, 112, 72, 5);

    context.textAlign = 'right';
    context.fillStyle = MUTED;
    context.font = `400 18px ${FONT_STACK}`;
    context.fillText(`Aktualizacja ${timeFormatter.format(now)}`, CARD_WIDTH - INNER_X, 98);
    context.textAlign = 'left';

    const counts: Record<TaskPriority, number> = { high: 0, normal: 0, low: 0 };
    let overdue = 0;
    for (const task of tasks) {
        counts[task.priority] += 1;
        if (task.dueAt !== null && task.dueAt < now) overdue += 1;
    }

    let x = INNER_X;
    const y = 128;
    x += drawPill(context, x, y, `Otwarte: ${tasks.length}`, ACCENT, { filled: true }) + 10;
    for (const priority of ['high', 'normal', 'low'] as const) {
        if (counts[priority] === 0) continue;
        x += drawPill(context, x, y, `${PRIORITY_LABELS[priority]}: ${counts[priority]}`, PRIORITY_COLORS[priority]) + 10;
    }
    if (overdue > 0) {
        drawPill(context, x, y, `Po terminie: ${overdue}`, OVERDUE);
    }
}

function drawGroupAvatar(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    assigneeId: string | null,
    image: Image | null | undefined,
): void {
    const radius = AVATAR_SIZE / 2;
    const cx = x + radius;
    const cy = y + radius;

    context.beginPath();
    context.arc(cx, cy, radius + 3, 0, Math.PI * 2);
    context.fillStyle = assigneeId === null ? GOLD : 'rgba(255, 255, 255, 0.28)';
    context.fill();

    context.save();
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.clip();
    if (image) {
        context.drawImage(image, x, y, AVATAR_SIZE, AVATAR_SIZE);
    } else {
        context.fillStyle = '#31353F';
        context.fillRect(x, y, AVATAR_SIZE, AVATAR_SIZE);
        if (assigneeId === null) {
            // "Wszyscy": trzy nakładające się kółka zamiast awatara.
            for (const [dx, color] of [[-9, '#8A8F99'], [9, '#8A8F99'], [0, '#C5C9D1']] as const) {
                context.beginPath();
                context.arc(cx + dx, cy + (dx === 0 ? -2 : 4), dx === 0 ? 9 : 7, 0, Math.PI * 2);
                context.fillStyle = color;
                context.fill();
            }
        }
    }
    context.restore();
}

function drawRow(context: CanvasRenderingContext2D, task: Task, y: number, now: number): void {
    const x = INNER_X;

    context.save();
    roundedRectPath(context, x, y, INNER_WIDTH, ROW_HEIGHT, 12);
    context.clip();
    context.fillStyle = 'rgba(22, 26, 33, 0.82)';
    context.fillRect(x, y, INNER_WIDTH, ROW_HEIGHT);
    context.fillStyle = PRIORITY_COLORS[task.priority];
    context.fillRect(x, y, 7, ROW_HEIGHT);
    context.restore();

    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillStyle = WHITE;
    context.font = `600 22px ${FONT_STACK}`;
    context.fillText(truncateToWidth(context, task.title, MAX_TITLE_PIXELS), x + 28, y + ROW_HEIGHT / 2 + 1);

    const due = describeDue(task, now);
    context.textAlign = 'right';
    context.fillStyle = due.overdue ? OVERDUE : MUTED;
    context.font = `${due.overdue ? 700 : 400} 18px ${FONT_STACK}`;
    context.fillText(due.text, x + INNER_WIDTH - 22, y + ROW_HEIGHT / 2 + 1);

    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
}

function drawBody(
    context: CanvasRenderingContext2D,
    input: BoardRenderInput,
    plan: BoardPlan,
    avatars: Map<string, Image | null>,
): void {
    if (input.tasks.length === 0) {
        context.textAlign = 'center';
        context.fillStyle = '#57F287';
        context.font = `700 34px ${FONT_STACK}`;
        context.fillText('Brak otwartych tasków', CARD_WIDTH / 2, HEADER_HEIGHT + 70);
        context.fillStyle = MUTED;
        context.font = `400 20px ${FONT_STACK}`;
        context.fillText('Wszystko zrobione — dobra robota!', CARD_WIDTH / 2, HEADER_HEIGHT + 106);
        context.textAlign = 'left';
        return;
    }

    let y = HEADER_HEIGHT;
    for (const group of plan.groups) {
        const url = group.assigneeId ? input.users[group.assigneeId]?.avatarUrl : null;
        drawGroupAvatar(context, INNER_X, y + 6, group.assigneeId, url ? avatars.get(url) : null);

        context.textAlign = 'left';
        context.fillStyle = WHITE;
        context.font = `700 26px ${FONT_STACK}`;
        const name = truncateToWidth(context, displayName(group.assigneeId, input.users), 520);
        context.fillText(name, INNER_X + AVATAR_SIZE + 18, y + 38);

        const nameWidth = context.measureText(name).width;
        context.fillStyle = MUTED;
        context.font = `400 20px ${FONT_STACK}`;
        context.fillText(`${group.tasks.length}`, INNER_X + AVATAR_SIZE + 18 + nameWidth + 12, y + 38);

        y += GROUP_HEADER_HEIGHT;
        for (const task of group.tasks) {
            drawRow(context, task, y, input.now);
            y += ROW_HEIGHT + ROW_GAP;
        }
        y += GROUP_GAP;
    }

    if (plan.hidden > 0) {
        context.fillStyle = MUTED;
        context.font = `600 20px ${FONT_STACK}`;
        context.fillText(`+ ${plan.hidden} więcej — pełna lista w dashboardzie`, INNER_X, y + 12);
    }
}

function drawFooter(context: CanvasRenderingContext2D, input: BoardRenderInput, height: number): void {
    context.textAlign = 'center';
    context.fillStyle = 'rgba(255, 255, 255, 0.42)';
    context.font = `400 17px ${FONT_STACK}`;
    context.fillText(input.footerText, CARD_WIDTH / 2, height - OUTER_PADDING - 22);
    context.textAlign = 'left';
}

export async function renderTaskBoardImage(input: BoardRenderInput): Promise<Buffer> {
    registerFontsOnce();
    const plan = planBoard(input.tasks);
    const layout: CardLayout = { ...CARD_LAYOUT_BASE, height: plan.height };
    const canvas = createCanvas(CARD_WIDTH, plan.height);
    const context = canvas.getContext('2d');

    const avatarUrls = [...new Set(plan.groups
        .map((group) => (group.assigneeId ? input.users[group.assigneeId]?.avatarUrl : null))
        .filter((url): url is string => Boolean(url)))];
    const loaded = await Promise.all(avatarUrls.map(async (url) => [url, await tryFetchImage(url)] as const));
    const avatars = new Map<string, Image | null>(loaded);

    await drawBackground(context, layout);
    drawHeader(context, input);
    drawBody(context, input, plan, avatars);
    drawFooter(context, input, plan.height);

    const output = canvas.toBuffer('image/png');
    if (output.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('Wygenerowany obrazek listy taskow przekracza limit rozmiaru.');
    }
    return output;
}
