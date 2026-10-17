import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { LogLevel, StructuredLogEntry } from './logger.js';
import { LOG_CATEGORIES, categorizeLogEntry, type LogCategory } from './log-categories.js';

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
    scope?: string;
    hideNoise?: boolean;
    category?: LogCategory | 'all';
    /** Odciecie czasowe w ms (wpisy starsze sa pomijane); 0/undefined = bez limitu. */
    sinceMs?: number;
}

export interface DashboardLogSummary {
    total: number;
    levelCounts: Record<'error' | 'warn' | 'info' | 'debug', number>;
    categoryCounts: Record<LogCategory, number>;
}

/** Akcje generowane masowo przez boty/skanery - domyslnie ukrywane w widoku. */
export const NOISE_LOG_ACTIONS: readonly string[] = ['DASHBOARD_RATE_LIMIT_HIT'];

export interface DashboardLogListResult {
    entries: Array<StructuredLogEntry & { category: LogCategory }>;
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
    hiddenNoiseCount: number;
    scopes: string[];
    summary: DashboardLogSummary;
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

const logFileCache = new Map<string, { signature: string; entries: StructuredLogEntry[] }>();

/** Parsuje plik tylko gdy sie zmienil (rozmiar/mtime) - stare dni nie sa czytane przy kazdym zapytaniu. */
async function readLogFileEntries(filePath: string): Promise<StructuredLogEntry[]> {
    const fileStat = await stat(filePath);
    const signature = `${fileStat.size}:${fileStat.mtimeMs}`;
    const cached = logFileCache.get(filePath);
    if (cached && cached.signature === signature) {
        return cached.entries;
    }

    const content = await readFile(filePath, 'utf8');
    const parsedEntries = content
        .split(/\r?\n/g)
        .map((line) => normalizeJsonLine(line))
        .filter((entry): entry is StructuredLogEntry => entry !== null);

    logFileCache.set(filePath, { signature, entries: parsedEntries });
    return parsedEntries;
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
        entries.push(...await readLogFileEntries(join(LOG_DIRECTORY_PATH, filename)));
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

    const scopeFilter = query.scope && query.scope !== 'all' ? query.scope : null;
    const categoryFilter = query.category && query.category !== 'all' ? query.category : null;
    const hideNoise = query.hideNoise === true;
    const sinceMs = Number.isFinite(query.sinceMs) ? Number(query.sinceMs) : 0;
    const allEntries = await readAllLogEntries();
    const scopes = [...new Set(allEntries.map((entry) => entry.scope))].sort();
    let hiddenNoiseCount = 0;

    const matchesLevel = (entry: StructuredLogEntry): boolean => {
        if (levelFilter === 'all') return true;
        if (levelFilter === 'error') return entry.level === 'error' || entry.level === 'fatal';
        return entry.level === levelFilter;
    };

    // Wspolna czesc filtrow (czas, zakres, szukanie, szum) - liczniki w podsumowaniu opieraja sie na niej.
    const base = allEntries.filter((entry) => {
        if (sinceMs > 0 && entry.timestampMs < sinceMs) return false;
        if (scopeFilter && entry.scope !== scopeFilter) return false;
        if (!matchesSearch(entry, searchLower)) return false;

        if (hideNoise && NOISE_LOG_ACTIONS.includes(entry.action)) {
            hiddenNoiseCount += 1;
            return false;
        }

        return true;
    });

    const summary: DashboardLogSummary = {
        total: base.length,
        levelCounts: { error: 0, warn: 0, info: 0, debug: 0 },
        categoryCounts: Object.fromEntries(LOG_CATEGORIES.map((category) => [category, 0])) as Record<LogCategory, number>,
    };
    for (const entry of base) {
        const bucket = entry.level === 'fatal' ? 'error' : (entry.level === 'trace' ? 'debug' : entry.level);
        summary.levelCounts[bucket] += 1;
        if (matchesLevel(entry)) {
            summary.categoryCounts[categorizeLogEntry(entry)] += 1;
        }
    }

    const filtered = base.filter((entry) => {
        return matchesLevel(entry) && (!categoryFilter || categorizeLogEntry(entry) === categoryFilter);
    });

    const totalRows = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / safePageSize));
    const page = Math.min(safePage, totalPages);
    const offset = (page - 1) * safePageSize;

    return {
        entries: filtered.slice(offset, offset + safePageSize).map((entry) => ({ ...entry, category: categorizeLogEntry(entry) })),
        page,
        pageSize: safePageSize,
        totalRows,
        totalPages,
        hiddenNoiseCount,
        scopes,
        summary,
    };
}
