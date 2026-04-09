import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LogLevel, StructuredLogEntry } from './logger.js';

const LOG_DIRECTORY_PATH = join(process.cwd(), 'logs');
const LOG_FILE_PATTERN = /^system-\d{4}-\d{2}-\d{2}\.jsonl$/;
const MAX_LOG_FILES_TO_SCAN = 30;
const MAX_SANITIZE_DEPTH = 4;
const SENSITIVE_KEY_PATTERN = /(token|secret|password|passwd|authorization|cookie|session|sessionid|requestid|sid|api[-_]?key|bearer)/i;

export interface DashboardLogListQuery {
    page: number;
    pageSize: number;
    search: string;
    level: LogLevel | 'all';
}

export interface DashboardLogListResult {
    entries: StructuredLogEntry[];
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
}

function normalizeJsonLine(rawLine: string): StructuredLogEntry | null {
    const trimmed = rawLine.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const parsed = JSON.parse(trimmed) as Partial<StructuredLogEntry>;
        const normalizedLevel = normalizeLogLevel(parsed.level);
        const normalizedContext = sanitizeContext(parsed.context);
        const normalizedError = sanitizeError(parsed.error);

        if (
            typeof parsed.timestampIso !== 'string'
            || typeof parsed.timestampMs !== 'number'
            || typeof parsed.action !== 'string'
            || typeof parsed.scope !== 'string'
            || typeof parsed.message !== 'string'
            || !Number.isFinite(parsed.timestampMs)
        ) {
            return null;
        }

        return {
            timestampIso: parsed.timestampIso,
            timestampMs: parsed.timestampMs,
            level: normalizedLevel,
            action: parsed.action,
            scope: parsed.scope,
            message: parsed.message,
            context: normalizedContext,
            error: normalizedError,
        };
    } catch {
        return null;
    }
}

function normalizeLogLevel(value: unknown): LogLevel {
    const normalized = typeof value === 'string' ? value.toLowerCase() : '';
    if (normalized === 'trace' || normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error' || normalized === 'fatal') {
        return normalized;
    }

    return 'info';
}

function sanitizeContextValue(value: unknown, depth = 0): unknown {
    if (depth >= MAX_SANITIZE_DEPTH) {
        return '[truncated]';
    }

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeContextValue(item, depth + 1));
    }

    if (value && typeof value === 'object') {
        return sanitizeContext(value, depth + 1);
    }

    if (typeof value === 'string' && value.length > 2000) {
        return `${value.slice(0, 2000)}...[truncated]`;
    }

    return value;
}

function sanitizeContext(rawContext: unknown, depth = 0): Record<string, unknown> {
    if (!rawContext || typeof rawContext !== 'object' || Array.isArray(rawContext)) {
        return {};
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawContext)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
            result[key] = '[redacted]';
            continue;
        }

        result[key] = sanitizeContextValue(value, depth);
    }

    return result;
}

function sanitizeError(rawError: unknown): StructuredLogEntry['error'] {
    if (!rawError || typeof rawError !== 'object') {
        return null;
    }

    const nameRaw = (rawError as { name?: unknown }).name;
    const messageRaw = (rawError as { message?: unknown }).message;
    if (typeof nameRaw !== 'string' || typeof messageRaw !== 'string') {
        return null;
    }

    return {
        name: nameRaw,
        message: messageRaw,
    };
}

async function readAllLogEntries(): Promise<StructuredLogEntry[]> {
    let files: string[] = [];

    try {
        files = await readdir(LOG_DIRECTORY_PATH);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }

        throw error;
    }

    const orderedFiles = files
        .filter((filename) => LOG_FILE_PATTERN.test(filename))
        .sort((left, right) => right.localeCompare(left))
        .slice(0, MAX_LOG_FILES_TO_SCAN);

    if (orderedFiles.length === 0) {
        return [];
    }

    const entries: StructuredLogEntry[] = [];

    for (const filename of orderedFiles) {
        const filePath = join(LOG_DIRECTORY_PATH, filename);
        const content = await readFile(filePath, 'utf8');
        const lines = content.split(/\r?\n/g);

        for (const line of lines) {
            const parsed = normalizeJsonLine(line);
            if (parsed) {
                entries.push(parsed);
            }
        }
    }

    return entries.sort((left, right) => right.timestampMs - left.timestampMs);
}

function matchesSearch(entry: StructuredLogEntry, searchLower: string): boolean {
    if (!searchLower) {
        return true;
    }

    const haystack = [
        entry.timestampIso,
        entry.level,
        entry.action,
        entry.scope,
        entry.message,
        JSON.stringify(entry.context ?? {}),
        entry.error?.message ?? '',
    ].join(' ').toLowerCase();

    return haystack.includes(searchLower);
}

export async function listDashboardLogs(query: DashboardLogListQuery): Promise<DashboardLogListResult> {
    const safePage = Number.isFinite(query.page) ? Math.max(1, Math.floor(query.page)) : 1;
    const safePageSize = Number.isFinite(query.pageSize)
        ? Math.max(1, Math.min(100, Math.floor(query.pageSize)))
        : 25;
    const levelFilter = query.level;
    const searchLower = query.search.trim().toLowerCase();

    const filtered = (await readAllLogEntries()).filter((entry) => {
        if (levelFilter !== 'all' && entry.level !== levelFilter) {
            return false;
        }

        return matchesSearch(entry, searchLower);
    });

    const totalRows = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / safePageSize));
    const page = Math.min(safePage, totalPages);
    const offset = (page - 1) * safePageSize;

    return {
        entries: filtered.slice(offset, offset + safePageSize),
        page,
        pageSize: safePageSize,
        totalRows,
        totalPages,
    };
}
