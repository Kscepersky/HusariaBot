import type { Task, TaskPriority } from './types.js';

export const PRIORITY_ICONS: Readonly<Record<TaskPriority, string>> = {
    high: '🔴',
    normal: '🟡',
    low: '🟢',
};

export const PRIORITY_LABELS: Readonly<Record<TaskPriority, string>> = {
    high: 'Wysoki',
    normal: 'Normalny',
    low: 'Niski',
};

const ZERO_WIDTH_SPACE = '​';

/**
 * Tekst od uzytkownika wstawiany do wiadomosci Discorda: jedna linia, bez
 * formatowania markdown i bez dzialajacych wzmianek (@everyone, <@id>, <#id>).
 */
export function escapeDiscordInline(text: string, maxLength = 100): string {
    const singleLine = text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
    return singleLine
        .replace(/[\\*_~`|>#[\]()-]/g, (char) => `\\${char}`)
        .replace(/@/g, `@${ZERO_WIDTH_SPACE}`)
        .replace(/</g, `<${ZERO_WIDTH_SPACE}`)
        // Goly adres w tytule nie moze stac sie klikalnym linkiem w wiadomosci bota.
        .replace(/:\/\//g, `:${ZERO_WIDTH_SPACE}//`);
}

export function discordTimestamp(epochMs: number, style: 'R' | 'f' | 'd' = 'R'): string {
    return `<t:${Math.floor(epochMs / 1000)}:${style}>`;
}

export function isOverdue(task: Pick<Task, 'dueAt' | 'status'>, now: number = Date.now()): boolean {
    return task.status === 'open' && task.dueAt !== null && task.dueAt < now;
}

/** Jedna linia taska: ikona priorytetu, tytul i opcjonalny termin. */
export function formatTaskLine(task: Task, now: number = Date.now()): string {
    const parts = [`${PRIORITY_ICONS[task.priority]} ${escapeDiscordInline(task.title)}`];
    if (task.dueAt !== null) {
        parts.push(`${isOverdue(task, now) ? '⚠️ po terminie' : '⏰'} ${discordTimestamp(task.dueAt)}`);
    }
    return parts.join(' · ');
}
