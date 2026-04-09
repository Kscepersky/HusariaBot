import { mkdir, appendFile, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface TicketTranscriptMessageRecord {
    id: string;
    authorId: string;
    authorTag: string;
    content: string;
    createdAt: number;
    attachments: string[];
}

export interface TicketHistoryEntry {
    id: string;
    guildId: string;
    channelId: string;
    channelName: string;
    ownerId: string | null;
    closeType: 'user' | 'admin';
    closeReason: string;
    closedByUserId: string;
    closedByTag: string;
    closedAt: number;
    transcriptFileName: string;
}

export interface TicketHistoryListOptions {
    page: number;
    pageSize: number;
    search: string;
}

export interface TicketHistoryListResult {
    entries: TicketHistoryEntry[];
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
}

interface PersistTicketClosureInput {
    guildId: string;
    channelId: string;
    channelName: string;
    ownerId: string | null;
    closeType: 'user' | 'admin';
    closeReason: string;
    closedByUserId: string;
    closedByTag: string;
    closedAt: number;
    transcriptMessages: TicketTranscriptMessageRecord[];
}

const TICKET_HISTORY_FILE_PATH = join(__dirname, '..', '..', 'data', 'ticket-history.jsonl');
const TICKET_TRANSCRIPTS_DIRECTORY_PATH = join(__dirname, '..', '..', 'data', 'ticket-transcripts');
const TRANSCRIPT_FILE_PATTERN = /^[a-zA-Z0-9._-]+\.html$/;

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function sanitizeFileSegment(value: string): string {
    const normalized = value
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9_-]/g, '-');

    const compact = normalized.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '');
    return compact.length > 0 ? compact.toLowerCase() : 'ticket';
}

function isTicketHistoryEntry(value: unknown): value is TicketHistoryEntry {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<TicketHistoryEntry>;
    return (
        typeof candidate.id === 'string'
        && typeof candidate.guildId === 'string'
        && typeof candidate.channelId === 'string'
        && typeof candidate.channelName === 'string'
        && (candidate.ownerId === null || typeof candidate.ownerId === 'string')
        && (candidate.closeType === 'user' || candidate.closeType === 'admin')
        && typeof candidate.closeReason === 'string'
        && typeof candidate.closedByUserId === 'string'
        && typeof candidate.closedByTag === 'string'
        && typeof candidate.closedAt === 'number'
        && Number.isFinite(candidate.closedAt)
        && typeof candidate.transcriptFileName === 'string'
    );
}

function toTranscriptFileName(channelName: string, channelId: string, closedAt: number): string {
    const safeName = sanitizeFileSegment(channelName).slice(0, 48);
    return `${closedAt}-${channelId}-${safeName}.html`;
}

function renderTranscriptHtml(entry: Omit<TicketHistoryEntry, 'transcriptFileName'>, transcriptMessages: TicketTranscriptMessageRecord[]): string {
    const closedAtIso = new Date(entry.closedAt).toISOString();
    const rows = transcriptMessages.map((message) => {
        const createdAtIso = new Date(message.createdAt).toISOString();
        const content = message.content.trim().length > 0
            ? escapeHtml(message.content)
            : '<span class="muted">(brak tresci)</span>';
        const attachments = message.attachments.length > 0
            ? `<div class="attachments">${message.attachments
                .map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`)
                .join('<br>')}</div>`
            : '';

        return `
            <article class="message-row">
                <div class="message-meta">
                    <span class="author">${escapeHtml(message.authorTag)}</span>
                    <span class="author-id">(${escapeHtml(message.authorId)})</span>
                    <time datetime="${createdAtIso}">${createdAtIso}</time>
                </div>
                <div class="message-content">${content}</div>
                ${attachments}
            </article>`;
    }).join('\n');

    return `<!doctype html>
<html lang="pl">
<head>
    <meta charset="utf-8">
    <title>Ticket transcript ${escapeHtml(entry.channelName)}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #111827; color: #f3f4f6; }
        .meta { margin-bottom: 24px; padding: 16px; border: 1px solid #374151; border-radius: 8px; background: #1f2937; }
        .meta h1 { margin: 0 0 12px; font-size: 20px; }
        .meta p { margin: 4px 0; color: #d1d5db; }
        .message-row { border: 1px solid #374151; border-radius: 8px; padding: 12px; margin-bottom: 10px; background: #1f2937; }
        .message-meta { font-size: 12px; color: #9ca3af; margin-bottom: 8px; display: flex; gap: 8px; flex-wrap: wrap; }
        .author { color: #f9fafb; font-weight: 600; }
        .message-content { white-space: pre-wrap; line-height: 1.45; }
        .attachments { margin-top: 8px; font-size: 13px; }
        .attachments a { color: #93c5fd; }
        .muted { color: #9ca3af; }
    </style>
</head>
<body>
    <section class="meta">
        <h1>Ticket ${escapeHtml(entry.channelName)}</h1>
        <p><strong>Channel ID:</strong> ${escapeHtml(entry.channelId)}</p>
        <p><strong>Owner ID:</strong> ${escapeHtml(entry.ownerId ?? 'unknown')}</p>
        <p><strong>Closed by:</strong> ${escapeHtml(entry.closedByTag)} (${escapeHtml(entry.closedByUserId)})</p>
        <p><strong>Close type:</strong> ${escapeHtml(entry.closeType)}</p>
        <p><strong>Reason:</strong> ${escapeHtml(entry.closeReason)}</p>
        <p><strong>Closed at:</strong> ${closedAtIso}</p>
    </section>
    <section>
        ${rows || '<p class="muted">Brak wiadomosci w transkrypcie.</p>'}
    </section>
</body>
</html>`;
}

export async function persistTicketClosureRecord(input: PersistTicketClosureInput): Promise<TicketHistoryEntry> {
    const transcriptFileName = toTranscriptFileName(input.channelName, input.channelId, input.closedAt);

    await mkdir(TICKET_TRANSCRIPTS_DIRECTORY_PATH, { recursive: true });
    await mkdir(dirname(TICKET_HISTORY_FILE_PATH), { recursive: true });

    const entry: TicketHistoryEntry = {
        id: `${input.closedAt}:${input.channelId}`,
        guildId: input.guildId,
        channelId: input.channelId,
        channelName: input.channelName,
        ownerId: input.ownerId,
        closeType: input.closeType,
        closeReason: input.closeReason,
        closedByUserId: input.closedByUserId,
        closedByTag: input.closedByTag,
        closedAt: input.closedAt,
        transcriptFileName,
    };

    const transcriptHtml = renderTranscriptHtml(
        {
            id: entry.id,
            guildId: entry.guildId,
            channelId: entry.channelId,
            channelName: entry.channelName,
            ownerId: entry.ownerId,
            closeType: entry.closeType,
            closeReason: entry.closeReason,
            closedByUserId: entry.closedByUserId,
            closedByTag: entry.closedByTag,
            closedAt: entry.closedAt,
        },
        input.transcriptMessages,
    );

    await writeFile(join(TICKET_TRANSCRIPTS_DIRECTORY_PATH, transcriptFileName), transcriptHtml, 'utf8');
    await appendFile(TICKET_HISTORY_FILE_PATH, `${JSON.stringify(entry)}\n`, 'utf8');

    return entry;
}

export async function listTicketHistoryEntries(options: TicketHistoryListOptions): Promise<TicketHistoryListResult> {
    const raw = await readFile(TICKET_HISTORY_FILE_PATH, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
            return '';
        }

        throw error;
    });

    const parsedEntries = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
            try {
                return JSON.parse(line) as unknown;
            } catch {
                return null;
            }
        })
        .filter((entry): entry is TicketHistoryEntry => isTicketHistoryEntry(entry));

    const normalizedSearch = options.search.trim().toLowerCase();
    const filteredEntries = normalizedSearch.length === 0
        ? parsedEntries
        : parsedEntries.filter((entry) => {
            const haystack = [
                entry.channelName,
                entry.ownerId ?? '',
                entry.closedByUserId,
                entry.closedByTag,
                entry.closeReason,
            ].join(' ').toLowerCase();

            return haystack.includes(normalizedSearch);
        });

    const sortedEntries = [...filteredEntries].sort((left, right) => right.closedAt - left.closedAt);
    const pageSize = Math.max(1, options.pageSize);
    const totalItems = sortedEntries.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const page = Math.max(1, Math.min(options.page, totalPages));
    const startIndex = (page - 1) * pageSize;

    return {
        entries: sortedEntries.slice(startIndex, startIndex + pageSize),
        page,
        pageSize,
        totalItems,
        totalPages,
    };
}

export function resolveTicketTranscriptFilePath(fileName: string): string | null {
    if (!TRANSCRIPT_FILE_PATTERN.test(fileName)) {
        return null;
    }

    return join(TICKET_TRANSCRIPTS_DIRECTORY_PATH, fileName);
}
