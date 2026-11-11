import { DiscordRequestError, sendDirectMessage } from '../dashboard/discord-api.js';
import { isSnowflake } from '../permissions/permission-store.js';
import { buildTaskDeepLink } from '../utils/dashboard-url.js';
import { createLogger } from '../utils/logger.js';
import { PRIORITY_ICONS, PRIORITY_LABELS, discordTimestamp, escapeDiscordInline } from './format.js';
import type { Task } from './types.js';

const notificationsLogger = createLogger('tasks:notifications');
const DM_CLOSED_ERROR_CODE = 50007;
/** Sufit DM-ów od jednej osoby do jednej osoby - przeciw spamowi przez ciągłe przepinanie taska. */
export const DM_LIMIT_PER_PAIR = 10;
export const DM_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const sentDmTimestamps = new Map<string, number[]>();

function tryReserveDm(actorId: string, recipientId: string, now: number): boolean {
    const key = `${actorId}:${recipientId}`;
    const recent = (sentDmTimestamps.get(key) ?? []).filter((timestamp) => now - timestamp < DM_LIMIT_WINDOW_MS);
    if (recent.length >= DM_LIMIT_PER_PAIR) {
        sentDmTimestamps.set(key, recent);
        return false;
    }
    sentDmTimestamps.set(key, [...recent, now]);
    return true;
}

export function resetDmLimitsForTests(): void {
    sentDmTimestamps.clear();
}

type SendDm = typeof sendDirectMessage;

export interface AssignmentDm {
    content: string;
    components?: object[];
}

/** Treść DM-a. Opis taska celowo nie trafia do Discorda - jest tylko w dashboardzie. */
export function buildAssignmentDm(task: Task, actorId: string): AssignmentDm {
    const link = buildTaskDeepLink(task.id);
    const lines = [
        `📌 Został przypisany ci nowy task przez użytkownika <@${actorId}> o tytule **${escapeDiscordInline(task.title)}**`
            + (link ? ` — sprawdź szczegóły na ${link}` : ' — sprawdź szczegóły w dashboardzie.'),
        `${PRIORITY_ICONS[task.priority]} Priorytet: ${PRIORITY_LABELS[task.priority]}`
            + (task.dueAt !== null ? ` · ⏰ Termin: ${discordTimestamp(task.dueAt, 'f')}` : '')
            + (task.assigneeId === null ? ' · 👥 Task dla wszystkich' : ''),
    ];

    return {
        content: lines.join('\n'),
        ...(link
            ? { components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Otwórz task', url: link }] }] }
            : {}),
    };
}

function isDmClosedError(error: unknown): boolean {
    if (!(error instanceof DiscordRequestError)) return false;
    const code = (error.payload as { code?: unknown } | null)?.code;
    return code === DM_CLOSED_ERROR_CODE;
}

/**
 * Wysyła DM o przypisaniu do każdego odbiorcy poza autorem zmiany. Błąd
 * pojedynczej wysyłki (np. zamknięte DM-y) nie przerywa pozostałych.
 */
export async function notifyTaskAssigned(
    task: Task,
    actorId: string,
    recipientIds: readonly string[],
    send: SendDm = sendDirectMessage,
): Promise<{ sent: number; failed: number }> {
    const recipients = [...new Set(recipientIds)].filter((id) => isSnowflake(id) && id !== actorId);
    const message = buildAssignmentDm(task, actorId);
    let sent = 0;
    let failed = 0;

    for (const recipientId of recipients) {
        if (!tryReserveDm(actorId, recipientId, Date.now())) {
            failed += 1;
            notificationsLogger.warn('TASK_DM_THROTTLED', 'Pominieto DM o tasku - przekroczony limit powiadomien.', { taskId: task.id, actorUserId: actorId, targetUserId: recipientId });
            continue;
        }

        try {
            await send(recipientId, message.content, {
                allowedMentions: { parse: [] },
                ...(message.components ? { components: message.components } : {}),
            });
            sent += 1;
        } catch (error) {
            failed += 1;
            if (isDmClosedError(error)) {
                notificationsLogger.warn('TASK_DM_CLOSED', 'Uzytkownik ma zamkniete DM - pomijam powiadomienie o tasku.', { taskId: task.id, targetUserId: recipientId });
            } else {
                notificationsLogger.error('TASK_DM_FAILED', 'Nie udalo sie wyslac DM o tasku.', { taskId: task.id, targetUserId: recipientId }, error);
            }
        }
    }

    return { sent, failed };
}
