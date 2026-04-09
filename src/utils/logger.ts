import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LOG_DIRECTORY_PATH = join(process.cwd(), 'logs');

let logWriteLock = Promise.resolve();

export interface LogContext {
    actorUserId?: string;
    targetUserId?: string;
    guildId?: string;
    requestId?: string;
    timeoutId?: number;
    [key: string]: unknown;
}

export interface StructuredLogEntry {
    timestampIso: string;
    timestampMs: number;
    level: LogLevel;
    action: string;
    scope: string;
    message: string;
    context: LogContext;
    error: {
        name: string;
        message: string;
        stack?: string;
    } | null;
}

interface LogInput {
    level: LogLevel;
    action: string;
    message: string;
    context?: LogContext;
    error?: unknown;
}

function isTestEnvironment(): boolean {
    return process.env.NODE_ENV === 'test';
}

function resolveAlertWebhookUrl(): string {
    return process.env.LOG_ALERT_WEBHOOK_URL?.trim() ?? '';
}

function withLogWriteLock<T>(work: () => Promise<T>): Promise<T> {
    const workPromise = logWriteLock.then(work);

    logWriteLock = workPromise.then(
        () => undefined,
        () => undefined,
    );

    return workPromise;
}

function formatDatePart(timestampMs: number): string {
    const date = new Date(timestampMs);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function resolveDailyLogFilePath(timestampMs: number): string {
    return join(LOG_DIRECTORY_PATH, `system-${formatDatePart(timestampMs)}.jsonl`);
}

function resolveDailyReadableLogFilePath(timestampMs: number): string {
    return join(LOG_DIRECTORY_PATH, `system-${formatDatePart(timestampMs)}.log`);
}

function formatReadableContext(context: LogContext): string {
    const entries = Object.entries(context)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`);

    if (entries.length === 0) {
        return '';
    }

    return ` | ${entries.join(' ')}`;
}

function formatReadableLine(entry: StructuredLogEntry): string {
    const errorLabel = entry.error ? ` | error=${entry.error.name}: ${entry.error.message}` : '';
    const contextLabel = formatReadableContext(entry.context);
    return `${entry.timestampIso} [${entry.level.toUpperCase()}] [${entry.action}] [${entry.scope}] ${entry.message}${contextLabel}${errorLabel}`;
}

function normalizeError(error: unknown): StructuredLogEntry['error'] {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }

    if (typeof error === 'string' && error.trim().length > 0) {
        return {
            name: 'Error',
            message: error,
        };
    }

    if (error === undefined || error === null) {
        return null;
    }

    return {
        name: 'UnknownError',
        message: JSON.stringify(error),
    };
}

function buildEntry(scope: string, input: LogInput): StructuredLogEntry {
    const timestampMs = Date.now();
    const context = input.context ? { ...input.context } : {};

    return {
        timestampIso: new Date(timestampMs).toISOString(),
        timestampMs,
        level: input.level,
        action: input.action,
        scope,
        message: input.message,
        context,
        error: normalizeError(input.error),
    };
}

function logToConsole(entry: StructuredLogEntry): void {
    const prefix = `[${entry.level.toUpperCase()}] [${entry.action}]`;
    const contextLabel = Object.keys(entry.context).length > 0
        ? ` ${JSON.stringify(entry.context)}`
        : '';
    const errorLabel = entry.error ? ` | ${entry.error.message}` : '';
    const line = `${prefix} ${entry.message}${contextLabel}${errorLabel}`;

    if (entry.level === 'error' || entry.level === 'fatal') {
        console.error(line);
        return;
    }

    if (entry.level === 'warn') {
        console.warn(line);
        return;
    }

    console.log(line);
}

async function appendEntryToFile(entry: StructuredLogEntry): Promise<void> {
    if (isTestEnvironment()) {
        return;
    }

    await withLogWriteLock(async () => {
        const jsonlFilePath = resolveDailyLogFilePath(entry.timestampMs);
        const readableFilePath = resolveDailyReadableLogFilePath(entry.timestampMs);
        await mkdir(dirname(jsonlFilePath), { recursive: true });
        await appendFile(jsonlFilePath, `${JSON.stringify(entry)}\n`, 'utf8');
        await appendFile(readableFilePath, `${formatReadableLine(entry)}\n`, 'utf8');
    });
}

function shouldAlert(level: LogLevel): boolean {
    return level === 'error' || level === 'fatal';
}

async function sendAlertWebhook(entry: StructuredLogEntry): Promise<void> {
    const webhookUrl = resolveAlertWebhookUrl();
    if (!webhookUrl || isTestEnvironment() || !shouldAlert(entry.level)) {
        return;
    }

    const payload = {
        content: [
            `🚨 **[${entry.level.toUpperCase()}] [${entry.action}]**`,
            `scope: ${entry.scope}`,
            `message: ${entry.message}`,
            `time: ${entry.timestampIso}`,
            `context: ${JSON.stringify(entry.context)}`,
        ].join('\n'),
    };

    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(`Webhook returned status ${response.status}`);
    }
}

async function persistAndAlert(entry: StructuredLogEntry): Promise<void> {
    await appendEntryToFile(entry);
    await sendAlertWebhook(entry);
}

export interface Logger {
    trace(action: string, message: string, context?: LogContext): void;
    debug(action: string, message: string, context?: LogContext): void;
    info(action: string, message: string, context?: LogContext): void;
    warn(action: string, message: string, context?: LogContext, error?: unknown): void;
    error(action: string, message: string, context?: LogContext, error?: unknown): void;
    fatal(action: string, message: string, context?: LogContext, error?: unknown): void;
}

export function createLogger(scope: string): Logger {
    function emit(input: LogInput): void {
        const entry = buildEntry(scope, input);
        logToConsole(entry);

        void persistAndAlert(entry).catch((logError) => {
            const payload = logError instanceof Error ? logError.message : String(logError);
            console.error(`[ERROR] [LOGGER_WRITE_FAILED] ${payload}`);
        });
    }

    return {
        trace(action, message, context) {
            emit({ level: 'trace', action, message, context });
        },
        debug(action, message, context) {
            emit({ level: 'debug', action, message, context });
        },
        info(action, message, context) {
            emit({ level: 'info', action, message, context });
        },
        warn(action, message, context, error) {
            emit({ level: 'warn', action, message, context, error });
        },
        error(action, message, context, error) {
            emit({ level: 'error', action, message, context, error });
        },
        fatal(action, message, context, error) {
            emit({ level: 'fatal', action, message, context, error });
        },
    };
}