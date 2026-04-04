import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { EconomyAdminMutationResult } from './types.js';

const LOG_DIRECTORY_PATH = join(process.cwd(), 'logs');
let logWriteLock = Promise.resolve();

function formatYearMonth(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function resolveMonthlyLogFilePath(timestamp: number): string {
    return join(LOG_DIRECTORY_PATH, `logi_administracyjne_ekonomia-${formatYearMonth(timestamp)}.txt`);
}

function formatTimestampInWarsaw(timestamp: number): string {
    const formatter = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Warsaw',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });

    return formatter.format(new Date(timestamp)).replace(' ', ' ');
}

function withLogWriteLock<T>(work: () => Promise<T>): Promise<T> {
    const workPromise = logWriteLock.then(work);

    logWriteLock = workPromise.then(
        () => undefined,
        () => undefined,
    );

    return workPromise;
}

export async function logEconomyAdminMutation(
    adminUserId: string,
    reason: string,
    mutation: EconomyAdminMutationResult,
): Promise<void> {
    await withLogWriteLock(async () => {
        const timestampLabel = formatTimestampInWarsaw(mutation.createdAt);
        const payload = {
            timestamp: timestampLabel,
            guildId: mutation.guildId,
            adminUserId,
            targetUserId: mutation.userId,
            operation: mutation.operation,
            amount: mutation.amount,
            previousCoins: mutation.previousCoins,
            currentCoins: mutation.currentCoins,
            previousXp: mutation.previousXp,
            currentXp: mutation.currentXp,
            previousLevel: mutation.previousLevel,
            currentLevel: mutation.currentLevel,
            reason: reason.trim(),
        };

        const filePath = resolveMonthlyLogFilePath(mutation.createdAt);
        await mkdir(dirname(filePath), { recursive: true });
        await appendFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
    });
}
