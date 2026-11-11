import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { isSnowflake } from '../permissions/permission-store.js';
import {
    isTaskPriority,
    type NewAttachmentRecord,
    type NewTaskInput,
    type Task,
    type TaskAttachment,
    type TaskEvent,
    type TaskEventType,
    type TaskListQuery,
    type TaskPage,
    type TaskPatch,
    type TaskStatus,
} from './types.js';

/**
 * Baza tasków współdzielona przez dashboard (zapisy) i bota (odczyt w /mojetaski).
 * Oba procesy otwierają ten sam plik w trybie WAL; busy_timeout chroni przed
 * SQLITE_BUSY, gdy drugi proces akurat trzyma blokadę zapisu.
 */

export const TASK_SETTING_KEYS = ['board_message_id', 'board_channel_id'] as const;
export type TaskSettingKey = (typeof TASK_SETTING_KEYS)[number];

const MAX_PAGE_SIZE = 100;
const BUSY_TIMEOUT_MS = 5_000;

export interface TaskStore {
    createTask(input: NewTaskInput, attachments: readonly NewAttachmentRecord[]): Promise<Task>;
    getTask(taskId: string): Promise<Task | null>;
    listTasks(query: TaskListQuery): Promise<TaskPage>;
    listOpenTasks(): Promise<Task[]>;
    /** Otwarte taski przypisane do uzytkownika oraz te "dla wszystkich". */
    listOpenTasksForUser(userId: string): Promise<Task[]>;
    /** Zwraca `null`, gdy task nie istnieje albo nie jest juz otwarty. */
    updateTask(taskId: string, patch: TaskPatch, actorId: string): Promise<{ before: Task; after: Task } | null>;
    completeTask(taskId: string, actorId: string, note: string, attachments: readonly NewAttachmentRecord[]): Promise<Task | null>;
    deleteTask(taskId: string, actorId: string): Promise<Task | null>;
    listEvents(taskId: string): Promise<TaskEvent[]>;
    getAttachment(attachmentId: string): Promise<{ attachment: TaskAttachment; taskStatus: TaskStatus } | null>;
    getAttachmentBytesTotal(): Promise<number>;
    getSetting(key: TaskSettingKey): Promise<string | null>;
    setSetting(key: TaskSettingKey, value: string | null): Promise<void>;
    close(): Promise<void>;
}

interface TaskRow {
    id: string;
    title: string;
    description: string;
    priority: string;
    status: string;
    creator_id: string;
    assignee_id: string | null;
    due_at: number | null;
    created_at: number;
    updated_at: number;
    completed_by: string | null;
    completed_at: number | null;
    completion_note: string | null;
    deleted_by: string | null;
    deleted_at: number | null;
}

interface AttachmentRow {
    id: string;
    task_id: string;
    kind: string;
    stored_name: string;
    mime_type: string;
    size_bytes: number;
    uploaded_by: string;
    created_at: number;
}

interface EventRow {
    id: string;
    task_id: string;
    type: string;
    actor_id: string;
    changes_json: string;
    created_at: number;
}

const OPEN_ORDER = `
    CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
    CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
    due_at ASC,
    created_at ASC`;

const HISTORY_ORDER = 'COALESCE(completed_at, deleted_at, updated_at) DESC, rowid DESC';

async function initializeSchema(db: Database): Promise<void> {
    // busy_timeout najpierw: bot i dashboard moga inicjalizowac baze w tym samym momencie.
    await db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
    await db.exec('PRAGMA journal_mode = WAL;');
    await db.exec('PRAGMA foreign_keys = ON;');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            priority TEXT NOT NULL,
            status TEXT NOT NULL,
            creator_id TEXT NOT NULL,
            assignee_id TEXT,
            due_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            completed_by TEXT,
            completed_at INTEGER,
            completion_note TEXT,
            deleted_by TEXT,
            deleted_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
        CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks(assignee_id);
        CREATE TABLE IF NOT EXISTS task_attachments (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES tasks(id),
            kind TEXT NOT NULL,
            stored_name TEXT NOT NULL UNIQUE,
            mime_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            uploaded_by TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS task_attachments_task_idx ON task_attachments(task_id);
        CREATE TABLE IF NOT EXISTS task_events (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES tasks(id),
            type TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            changes_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS task_events_task_idx ON task_events(task_id, created_at);
        CREATE TABLE IF NOT EXISTS task_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
    `);
}

function rowToAttachment(row: AttachmentRow): TaskAttachment {
    return {
        id: row.id,
        taskId: row.task_id,
        kind: row.kind === 'completion' ? 'completion' : 'description',
        storedName: row.stored_name,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        uploadedBy: row.uploaded_by,
        createdAt: row.created_at,
    };
}

function toStatus(value: string): TaskStatus {
    return value === 'done' || value === 'deleted' ? value : 'open';
}

function rowToTask(row: TaskRow, attachments: TaskAttachment[]): Task {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        priority: isTaskPriority(row.priority) ? row.priority : 'normal',
        status: toStatus(row.status),
        creatorId: row.creator_id,
        assigneeId: row.assignee_id,
        dueAt: row.due_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedBy: row.completed_by,
        completedAt: row.completed_at,
        completionNote: row.completion_note,
        deletedBy: row.deleted_by,
        deletedAt: row.deleted_at,
        attachments,
    };
}

function parseChanges(json: string): TaskEvent['changes'] {
    try {
        const parsed: unknown = JSON.parse(json);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as TaskEvent['changes']
            : {};
    } catch {
        return {};
    }
}

function rowToEvent(row: EventRow): TaskEvent {
    return {
        id: row.id,
        taskId: row.task_id,
        type: row.type as TaskEventType,
        actorId: row.actor_id,
        changes: parseChanges(row.changes_json),
        createdAt: row.created_at,
    };
}

function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function assertActor(actorId: string): void {
    if (!isSnowflake(actorId)) {
        throw new Error('Niepoprawne ID wykonujacego zmiane.');
    }
}

function diffTask(before: Task, after: Task): TaskEvent['changes'] {
    const fields = ['title', 'description', 'priority', 'assigneeId', 'dueAt'] as const;
    const changes: TaskEvent['changes'] = {};
    for (const field of fields) {
        if (before[field] !== after[field]) {
            changes[field] = { before: before[field], after: after[field] };
        }
    }
    return changes;
}

export async function createTaskStore(filePath: string): Promise<TaskStore> {
    if (filePath !== ':memory:') {
        await mkdir(dirname(filePath), { recursive: true });
    }

    const db = await open({ filename: filePath, driver: sqlite3.Database });
    await initializeSchema(db);

    let writeQueue: Promise<unknown> = Promise.resolve();
    function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
        const run = writeQueue.then(task, task);
        writeQueue = run.catch(() => undefined);
        return run;
    }

    async function inTransaction<T>(task: () => Promise<T>): Promise<T> {
        await db.exec('BEGIN IMMEDIATE');
        try {
            const result = await task();
            await db.exec('COMMIT');
            return result;
        } catch (error) {
            await db.exec('ROLLBACK').catch(() => undefined);
            throw error;
        }
    }

    async function loadAttachments(taskIds: readonly string[]): Promise<Map<string, TaskAttachment[]>> {
        const grouped = new Map<string, TaskAttachment[]>();
        if (taskIds.length === 0) return grouped;

        const placeholders = taskIds.map(() => '?').join(', ');
        const rows = await db.all<AttachmentRow[]>(
            `SELECT * FROM task_attachments WHERE task_id IN (${placeholders}) ORDER BY created_at ASC, rowid ASC`,
            ...taskIds,
        );
        for (const row of rows) {
            grouped.set(row.task_id, [...(grouped.get(row.task_id) ?? []), rowToAttachment(row)]);
        }
        return grouped;
    }

    async function hydrate(rows: readonly TaskRow[]): Promise<Task[]> {
        const attachments = await loadAttachments(rows.map((row) => row.id));
        return rows.map((row) => rowToTask(row, attachments.get(row.id) ?? []));
    }

    async function getTaskRow(taskId: string): Promise<TaskRow | undefined> {
        return db.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', taskId);
    }

    async function getTask(taskId: string): Promise<Task | null> {
        const row = await getTaskRow(taskId);
        if (!row) return null;
        const [task] = await hydrate([row]);
        return task ?? null;
    }

    async function insertEvent(taskId: string, type: TaskEventType, actorId: string, changes: TaskEvent['changes'], createdAt: number): Promise<void> {
        await db.run(
            `INSERT INTO task_events (id, task_id, type, actor_id, changes_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
            randomUUID(),
            taskId,
            type,
            actorId,
            JSON.stringify(changes),
            createdAt,
        );
    }

    async function insertAttachments(taskId: string, attachments: readonly NewAttachmentRecord[], actorId: string, createdAt: number): Promise<void> {
        for (const attachment of attachments) {
            await db.run(
                `INSERT INTO task_attachments (id, task_id, kind, stored_name, mime_type, size_bytes, uploaded_by, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                attachment.id,
                taskId,
                attachment.kind,
                attachment.storedName,
                attachment.mimeType,
                attachment.sizeBytes,
                actorId,
                createdAt,
            );
        }
    }

    return {
        async createTask(input, attachments) {
            assertActor(input.creatorId);
            if (input.assigneeId !== null && !isSnowflake(input.assigneeId)) {
                throw new Error('Niepoprawne ID osoby przypisanej.');
            }

            const taskId = randomUUID();
            const now = Date.now();
            await enqueueWrite(() => inTransaction(async () => {
                await db.run(
                    `INSERT INTO tasks (id, title, description, priority, status, creator_id, assignee_id, due_at, created_at, updated_at)
                     VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
                    taskId,
                    input.title,
                    input.description,
                    input.priority,
                    input.creatorId,
                    input.assigneeId,
                    input.dueAt,
                    now,
                    now,
                );
                await insertAttachments(taskId, attachments, input.creatorId, now);
                await insertEvent(taskId, 'created', input.creatorId, {}, now);
            }));

            // Wynik skladamy z zapisanych danych zamiast czytac ponownie: po commicie
            // nic nie moze juz rzucic, wiec wywolujacy nie posprzata plikow wskazywanych przez baze.
            return {
                id: taskId,
                ...input,
                status: 'open',
                createdAt: now,
                updatedAt: now,
                completedBy: null,
                completedAt: null,
                completionNote: null,
                deletedBy: null,
                deletedAt: null,
                attachments: attachments.map((attachment) => ({
                    ...attachment,
                    taskId,
                    uploadedBy: input.creatorId,
                    createdAt: now,
                })),
            };
        },

        getTask,

        async listTasks(query) {
            const safePageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(query.pageSize) || 1));
            const conditions: string[] = [];
            const params: unknown[] = [];

            if (query.statuses.length === 0) {
                return { tasks: [], total: 0, page: 1, pageSize: safePageSize, totalPages: 1 };
            }
            conditions.push(`status IN (${query.statuses.map(() => '?').join(', ')})`);
            params.push(...query.statuses);

            if (query.assigneeId === null) {
                conditions.push('assignee_id IS NULL');
            } else if (query.assigneeId !== undefined) {
                conditions.push('assignee_id = ?');
                params.push(query.assigneeId);
            }

            const search = query.search?.trim();
            if (search) {
                conditions.push(`(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')`);
                const pattern = `%${escapeLike(search)}%`;
                params.push(pattern, pattern);
            }

            const where = `WHERE ${conditions.join(' AND ')}`;
            const countRow = await db.get<{ total: number }>(`SELECT COUNT(*) AS total FROM tasks ${where}`, ...params);
            const total = countRow?.total ?? 0;
            const totalPages = Math.max(1, Math.ceil(total / safePageSize));
            const safePage = Math.max(1, Math.min(totalPages, Math.floor(query.page) || 1));
            const isOpenOnly = query.statuses.length === 1 && query.statuses[0] === 'open';

            const rows = await db.all<TaskRow[]>(
                `SELECT * FROM tasks ${where} ORDER BY ${isOpenOnly ? OPEN_ORDER : HISTORY_ORDER} LIMIT ? OFFSET ?`,
                ...params,
                safePageSize,
                (safePage - 1) * safePageSize,
            );

            return {
                tasks: await hydrate(rows),
                total,
                page: safePage,
                pageSize: safePageSize,
                totalPages,
            };
        },

        async listOpenTasks() {
            const rows = await db.all<TaskRow[]>(`SELECT * FROM tasks WHERE status = 'open' ORDER BY ${OPEN_ORDER}`);
            return hydrate(rows);
        },

        async listOpenTasksForUser(userId) {
            const rows = await db.all<TaskRow[]>(
                `SELECT * FROM tasks WHERE status = 'open' AND (assignee_id = ? OR assignee_id IS NULL) ORDER BY ${OPEN_ORDER}`,
                userId,
            );
            return hydrate(rows);
        },

        async updateTask(taskId, patch, actorId) {
            assertActor(actorId);
            if (patch.assigneeId !== undefined && patch.assigneeId !== null && !isSnowflake(patch.assigneeId)) {
                throw new Error('Niepoprawne ID osoby przypisanej.');
            }

            return enqueueWrite(() => inTransaction(async () => {
                const before = await getTask(taskId);
                if (!before || before.status !== 'open') return null;

                const next: Task = {
                    ...before,
                    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
                };
                const changes = diffTask(before, next);
                if (Object.keys(changes).length === 0) {
                    return { before, after: before };
                }

                const now = Date.now();
                await db.run(
                    `UPDATE tasks SET title = ?, description = ?, priority = ?, assignee_id = ?, due_at = ?, updated_at = ?
                     WHERE id = ? AND status = 'open'`,
                    next.title,
                    next.description,
                    next.priority,
                    next.assigneeId,
                    next.dueAt,
                    now,
                    taskId,
                );
                await insertEvent(taskId, 'edited', actorId, changes, now);
                return { before, after: { ...next, updatedAt: now } };
            }));
        },

        async completeTask(taskId, actorId, note, attachments) {
            assertActor(actorId);
            const completed = await enqueueWrite(() => inTransaction(async () => {
                const now = Date.now();
                // Warunek na status czyni zmiane atomowa: dwa rownolegle "Ukoncz" nie zamkna taska dwa razy.
                const result = await db.run(
                    `UPDATE tasks SET status = 'done', completed_by = ?, completed_at = ?, completion_note = ?, updated_at = ?
                     WHERE id = ? AND status = 'open'`,
                    actorId,
                    now,
                    note,
                    now,
                    taskId,
                );
                if (!result.changes) return false;

                await insertAttachments(taskId, attachments, actorId, now);
                await insertEvent(taskId, 'completed', actorId, {}, now);
                return true;
            }));

            return completed ? getTask(taskId) : null;
        },

        async deleteTask(taskId, actorId) {
            assertActor(actorId);
            const deleted = await enqueueWrite(() => inTransaction(async () => {
                const now = Date.now();
                const result = await db.run(
                    `UPDATE tasks SET status = 'deleted', deleted_by = ?, deleted_at = ?, updated_at = ?
                     WHERE id = ? AND status = 'open'`,
                    actorId,
                    now,
                    now,
                    taskId,
                );
                if (!result.changes) return false;

                await insertEvent(taskId, 'deleted', actorId, {}, now);
                return true;
            }));

            return deleted ? getTask(taskId) : null;
        },

        async listEvents(taskId) {
            const rows = await db.all<EventRow[]>(
                'SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC, rowid ASC',
                taskId,
            );
            return rows.map(rowToEvent);
        },

        async getAttachment(attachmentId) {
            const row = await db.get<AttachmentRow & { task_status: string }>(
                `SELECT a.*, t.status AS task_status FROM task_attachments a
                 JOIN tasks t ON t.id = a.task_id
                 WHERE a.id = ?`,
                attachmentId,
            );
            return row ? { attachment: rowToAttachment(row), taskStatus: toStatus(row.task_status) } : null;
        },

        async getAttachmentBytesTotal() {
            const row = await db.get<{ total: number | null }>('SELECT SUM(size_bytes) AS total FROM task_attachments');
            return row?.total ?? 0;
        },

        async getSetting(key) {
            const row = await db.get<{ value: string }>('SELECT value FROM task_settings WHERE key = ?', key);
            return row?.value ?? null;
        },

        async setSetting(key, value) {
            if (!(TASK_SETTING_KEYS as readonly string[]).includes(key)) {
                throw new Error(`Nieznany klucz ustawienia taskow: ${String(key)}`);
            }

            await enqueueWrite(async () => {
                if (value === null) {
                    await db.run('DELETE FROM task_settings WHERE key = ?', key);
                    return;
                }
                await db.run(
                    `INSERT INTO task_settings (key, value, updated_at) VALUES (?, ?, ?)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
                    key,
                    value,
                    Date.now(),
                );
            });
        },

        async close() {
            await writeQueue.catch(() => undefined);
            await db.close();
        },
    };
}

function resolveTasksDbPath(): string {
    const configured = process.env.TASKS_DB_PATH?.trim();
    if (!configured) {
        return join(process.cwd(), 'data', 'tasks.sqlite');
    }
    if (configured === ':memory:') {
        return configured;
    }
    return isAbsolute(configured) ? configured : join(process.cwd(), configured);
}

let sharedStore: Promise<TaskStore> | null = null;

/** Wspolna instancja dla calego procesu. Blad inicjalizacji nie jest zapamietywany. */
export function getTaskStore(): Promise<TaskStore> {
    if (!sharedStore) {
        sharedStore = createTaskStore(resolveTasksDbPath()).catch((error: unknown) => {
            sharedStore = null;
            throw error;
        });
    }
    return sharedStore;
}

export function resetTaskStoreForTests(): void {
    sharedStore = null;
}
