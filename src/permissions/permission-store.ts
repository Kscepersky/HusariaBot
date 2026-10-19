import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import {
    isAssignableSection,
    normalizeSections,
    type DashboardSection,
} from '../dashboard/dashboard-sections.js';

export const SETTING_KEYS = ['support_role_id'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export type AuditAction = 'grant' | 'update' | 'revoke' | 'setting';

export interface PermissionEntry {
    userId: string;
    sections: DashboardSection[];
    grantedBy: string;
    updatedAt: number;
}

export interface AuditEntry {
    id: string;
    action: AuditAction;
    actorId: string;
    /** ID uzytkownika (grant/update/revoke) albo klucz ustawienia (setting). */
    targetId: string;
    before: string[];
    after: string[];
    createdAt: number;
}

export interface AuditPage {
    entries: AuditEntry[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

export interface PermissionStore {
    getSections(userId: string): Promise<DashboardSection[]>;
    setSections(userId: string, sections: readonly DashboardSection[], actorId: string): Promise<AuditEntry | null>;
    list(): Promise<PermissionEntry[]>;
    listAudit(page: number, pageSize: number): Promise<AuditPage>;
    getSetting(key: SettingKey): Promise<string | null>;
    setSetting(key: SettingKey, value: string | null, actorId: string): Promise<AuditEntry | null>;
    close(): Promise<void>;
}

interface PermissionRow {
    user_id: string;
    sections: string;
    granted_by: string;
    updated_at: number;
}

interface AuditRow {
    id: string;
    action: string;
    actor_id: string;
    target_id: string;
    before_json: string;
    after_json: string;
    created_at: number;
}

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const MAX_AUDIT_PAGE_SIZE = 100;

export function isSnowflake(value: unknown): value is string {
    return typeof value === 'string' && SNOWFLAKE_PATTERN.test(value);
}

function parseStringArray(json: string): string[] {
    try {
        const parsed: unknown = JSON.parse(json);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

function parseStoredSections(json: string): DashboardSection[] {
    // Przy odczycie odfiltrowujemy wszystko, co nie jest juz przydzielalne
    // (np. sekcje przeniesione do owner-only) - nigdy nie dajemy wiecej niz wolno.
    return normalizeSections(parseStringArray(json).filter(isAssignableSection));
}

function rowToAuditEntry(row: AuditRow): AuditEntry {
    return {
        id: row.id,
        action: row.action as AuditAction,
        actorId: row.actor_id,
        targetId: row.target_id,
        before: parseStringArray(row.before_json),
        after: parseStringArray(row.after_json),
        createdAt: row.created_at,
    };
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((item, index) => item === right[index]);
}

async function initializeSchema(db: Database): Promise<void> {
    await db.exec('PRAGMA journal_mode = WAL;');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS dashboard_permissions (
            user_id TEXT PRIMARY KEY,
            sections TEXT NOT NULL,
            granted_by TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS permission_audit_log (
            id TEXT PRIMARY KEY,
            action TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            before_json TEXT NOT NULL,
            after_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS permission_audit_created_idx ON permission_audit_log(created_at);
        CREATE TABLE IF NOT EXISTS bot_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
    `);
}

async function insertAudit(db: Database, entry: AuditEntry): Promise<void> {
    await db.run(
        `INSERT INTO permission_audit_log (id, action, actor_id, target_id, before_json, after_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        entry.id,
        entry.action,
        entry.actorId,
        entry.targetId,
        JSON.stringify(entry.before),
        JSON.stringify(entry.after),
        entry.createdAt,
    );
}

function assertActor(actorId: string): void {
    if (!isSnowflake(actorId)) {
        throw new Error('Niepoprawne ID wykonujacego zmiane.');
    }
}

export async function createPermissionStore(filePath: string): Promise<PermissionStore> {
    if (filePath !== ':memory:') {
        await mkdir(dirname(filePath), { recursive: true });
    }

    const db = await open({ filename: filePath, driver: sqlite3.Database });
    await initializeSchema(db);

    // Zapisy ida przez jedna kolejke - zmiana uprawnien i wpis audytu musza byc atomowe.
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

    return {
        async getSections(userId) {
            const row = await db.get<PermissionRow>(
                'SELECT * FROM dashboard_permissions WHERE user_id = ?',
                userId,
            );
            return row ? parseStoredSections(row.sections) : [];
        },

        async setSections(userId, sections, actorId) {
            if (!isSnowflake(userId)) {
                throw new Error('Niepoprawne ID uzytkownika.');
            }
            assertActor(actorId);

            const invalid = sections.filter((section) => !isAssignableSection(section));
            if (invalid.length > 0) {
                throw new Error(`Sekcje nie moga byc przydzielone: ${invalid.join(', ')}`);
            }
            const next = normalizeSections(sections);

            return enqueueWrite(() => inTransaction(async () => {
                const existing = await db.get<PermissionRow>(
                    'SELECT * FROM dashboard_permissions WHERE user_id = ?',
                    userId,
                );
                const before = existing ? parseStoredSections(existing.sections) : [];
                if (sameList(before, next)) {
                    return null;
                }

                const now = Date.now();
                if (next.length === 0) {
                    await db.run('DELETE FROM dashboard_permissions WHERE user_id = ?', userId);
                } else {
                    await db.run(
                        `INSERT INTO dashboard_permissions (user_id, sections, granted_by, updated_at)
                         VALUES (?, ?, ?, ?)
                         ON CONFLICT(user_id) DO UPDATE SET
                            sections = excluded.sections,
                            granted_by = excluded.granted_by,
                            updated_at = excluded.updated_at`,
                        userId,
                        JSON.stringify(next),
                        actorId,
                        now,
                    );
                }

                const entry: AuditEntry = {
                    id: randomUUID(),
                    action: next.length === 0 ? 'revoke' : before.length === 0 ? 'grant' : 'update',
                    actorId,
                    targetId: userId,
                    before,
                    after: next,
                    createdAt: now,
                };
                await insertAudit(db, entry);
                return entry;
            }));
        },

        async list() {
            const rows = await db.all<PermissionRow[]>(
                'SELECT * FROM dashboard_permissions ORDER BY updated_at DESC',
            );
            return rows
                .map((row) => ({
                    userId: row.user_id,
                    sections: parseStoredSections(row.sections),
                    grantedBy: row.granted_by,
                    updatedAt: row.updated_at,
                }))
                .filter((entry) => entry.sections.length > 0);
        },

        async listAudit(page, pageSize) {
            const safePageSize = Math.max(1, Math.min(MAX_AUDIT_PAGE_SIZE, Math.floor(pageSize) || 1));
            const countRow = await db.get<{ total: number }>('SELECT COUNT(*) AS total FROM permission_audit_log');
            const total = countRow?.total ?? 0;
            const totalPages = Math.max(1, Math.ceil(total / safePageSize));
            const safePage = Math.max(1, Math.min(totalPages, Math.floor(page) || 1));

            const rows = await db.all<AuditRow[]>(
                `SELECT * FROM permission_audit_log
                 ORDER BY created_at DESC, rowid DESC
                 LIMIT ? OFFSET ?`,
                safePageSize,
                (safePage - 1) * safePageSize,
            );

            return {
                entries: rows.map(rowToAuditEntry),
                total,
                page: safePage,
                pageSize: safePageSize,
                totalPages,
            };
        },

        async getSetting(key) {
            const row = await db.get<{ value: string }>('SELECT value FROM bot_settings WHERE key = ?', key);
            return row?.value ?? null;
        },

        async setSetting(key, value, actorId) {
            if (!(SETTING_KEYS as readonly string[]).includes(key)) {
                throw new Error(`Nieznany klucz ustawienia: ${String(key)}`);
            }
            assertActor(actorId);

            return enqueueWrite(() => inTransaction(async () => {
                const existing = await db.get<{ value: string }>('SELECT value FROM bot_settings WHERE key = ?', key);
                const before = existing ? [existing.value] : [];
                const after = value === null ? [] : [value];
                if (sameList(before, after)) {
                    return null;
                }

                const now = Date.now();
                if (value === null) {
                    await db.run('DELETE FROM bot_settings WHERE key = ?', key);
                } else {
                    await db.run(
                        `INSERT INTO bot_settings (key, value, updated_at) VALUES (?, ?, ?)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
                        key,
                        value,
                        now,
                    );
                }

                const entry: AuditEntry = {
                    id: randomUUID(),
                    action: 'setting',
                    actorId,
                    targetId: key,
                    before,
                    after,
                    createdAt: now,
                };
                await insertAudit(db, entry);
                return entry;
            }));
        },

        async close() {
            await writeQueue.catch(() => undefined);
            await db.close();
        },
    };
}

function resolvePermissionsDbPath(): string {
    const configured = process.env.PERMISSIONS_DB_PATH?.trim();
    if (!configured) {
        return join(process.cwd(), 'data', 'permissions.sqlite');
    }
    if (configured === ':memory:') {
        return configured;
    }
    return isAbsolute(configured) ? configured : join(process.cwd(), configured);
}

let sharedStore: Promise<PermissionStore> | null = null;

/** Wspolna instancja dla calego procesu. Blad inicjalizacji nie jest zapamietywany. */
export function getPermissionStore(): Promise<PermissionStore> {
    if (!sharedStore) {
        sharedStore = createPermissionStore(resolvePermissionsDbPath()).catch((error: unknown) => {
            sharedStore = null;
            throw error;
        });
    }
    return sharedStore;
}

export function resetPermissionStoreForTests(): void {
    sharedStore = null;
}
