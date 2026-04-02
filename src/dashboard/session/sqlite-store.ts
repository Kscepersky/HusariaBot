import session from 'express-session';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';

interface SessionRow {
    sid: string;
    session_data: string;
    expires_at: number;
}

export interface SQLiteSessionStoreOptions {
    filePath: string;
    defaultTtlMs: number;
    cleanupIntervalMs?: number;
}

export class SQLiteSessionStore extends session.Store {
    private readonly filePath: string;
    private readonly defaultTtlMs: number;
    private readonly cleanupIntervalMs: number;
    private readonly dbPromise: Promise<Database | null>;
    private initializationError: unknown = null;
    private readonly cleanupTimer: NodeJS.Timeout;

    public constructor(options: SQLiteSessionStoreOptions) {
        super();

        this.filePath = options.filePath;
        this.defaultTtlMs = options.defaultTtlMs;
        this.cleanupIntervalMs = options.cleanupIntervalMs ?? 30 * 60 * 1000;
        this.dbPromise = this.initialize().catch((error) => {
            this.initializationError = error;
            console.error('Failed to initialize SQLite session store:', error);
            return null;
        });

        this.cleanupTimer = setInterval(() => {
            void this.removeExpiredSessions().catch((error) => {
                console.error('Failed to cleanup expired dashboard sessions:', error);
            });
        }, this.cleanupIntervalMs);

        if (typeof this.cleanupTimer.unref === 'function') {
            this.cleanupTimer.unref();
        }
    }

    private async initialize(): Promise<Database> {
        await mkdir(dirname(this.filePath), { recursive: true });

        const db = await open({
            filename: this.filePath,
            driver: sqlite3.Database,
        });

        await db.exec('PRAGMA journal_mode = WAL;');
        await db.exec(`
            CREATE TABLE IF NOT EXISTS dashboard_sessions (
                sid TEXT PRIMARY KEY,
                session_data TEXT NOT NULL,
                expires_at INTEGER NOT NULL
            );
        `);
        await db.exec('CREATE INDEX IF NOT EXISTS dashboard_sessions_expires_idx ON dashboard_sessions(expires_at);');

        return db;
    }

    private async getDb(): Promise<Database> {
        const db = await this.dbPromise;
        if (!db) {
            throw (this.initializationError ?? new Error('SQLite session store is not initialized.'));
        }

        return db;
    }

    private getExpiresAtMs(sessionData?: session.SessionData): number {
        const cookieMaxAge = sessionData?.cookie?.maxAge;
        if (typeof cookieMaxAge === 'number' && Number.isFinite(cookieMaxAge) && cookieMaxAge > 0) {
            return Date.now() + cookieMaxAge;
        }

        return Date.now() + this.defaultTtlMs;
    }

    private async removeExpiredSessions(): Promise<void> {
        const db = await this.getDb();
        await db.run('DELETE FROM dashboard_sessions WHERE expires_at <= ?', Date.now());
    }

    public override get(
        sid: string,
        callback: (error: unknown, sessionData?: session.SessionData | null) => void,
    ): void {
        void (async () => {
            const db = await this.getDb();
            const row = await db.get<SessionRow>('SELECT sid, session_data, expires_at FROM dashboard_sessions WHERE sid = ?', sid);

            if (!row) {
                callback(null, null);
                return;
            }

            if (row.expires_at <= Date.now()) {
                await db.run('DELETE FROM dashboard_sessions WHERE sid = ?', sid);
                callback(null, null);
                return;
            }

            const parsed = JSON.parse(row.session_data) as session.SessionData;
            callback(null, parsed);
        })().catch((error) => {
            callback(error, null);
        });
    }

    public override set(
        sid: string,
        sessionData: session.SessionData,
        callback?: (error?: unknown) => void,
    ): void {
        void (async () => {
            const db = await this.getDb();
            const serialized = JSON.stringify(sessionData);
            const expiresAt = this.getExpiresAtMs(sessionData);

            await db.run(
                `
                    INSERT INTO dashboard_sessions (sid, session_data, expires_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(sid) DO UPDATE SET
                        session_data = excluded.session_data,
                        expires_at = excluded.expires_at
                `,
                sid,
                serialized,
                expiresAt,
            );

            callback?.();
        })().catch((error) => {
            callback?.(error);
        });
    }

    public override destroy(sid: string, callback?: (error?: unknown) => void): void {
        void (async () => {
            const db = await this.getDb();
            await db.run('DELETE FROM dashboard_sessions WHERE sid = ?', sid);
            callback?.();
        })().catch((error) => {
            callback?.(error);
        });
    }

    public override touch(
        sid: string,
        sessionData: session.SessionData,
        callback?: (error?: unknown) => void,
    ): void {
        void (async () => {
            const db = await this.getDb();
            await db.run(
                'UPDATE dashboard_sessions SET expires_at = ? WHERE sid = ?',
                this.getExpiresAtMs(sessionData),
                sid,
            );

            callback?.();
        })().catch(() => {
            callback?.(new Error('Nie udalo sie odswiezyc sesji w SQLite store.'));
        });
    }

    public override clear(callback?: (error?: unknown) => void): void {
        void (async () => {
            const db = await this.getDb();
            await db.run('DELETE FROM dashboard_sessions');
            callback?.();
        })().catch((error) => {
            callback?.(error);
        });
    }
}