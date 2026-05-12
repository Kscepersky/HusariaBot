import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';

export type SessionEventType = 'login' | 'logout';

export interface SessionEvent {
    id: string;
    eventType: SessionEventType;
    userId: string;
    username: string;
    globalName: string | null;
    avatarHash: string | null;
    dashboardRole: string | null;
    ip: string;
    userAgent: string;
    createdAt: number;
}

export interface SessionActivityResult {
    onlineUsers: SessionEvent[];
    recentEvents: SessionEvent[];
    totalEvents: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

interface SessionEventRow {
    id: string;
    event_type: string;
    user_id: string;
    username: string;
    global_name: string | null;
    avatar_hash: string | null;
    dashboard_role: string | null;
    ip: string;
    user_agent: string;
    created_at: number;
}

const SESSION_EVENTS_MAX_RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

function resolveDbPath(): string {
    const configured = process.env.SESSION_EVENTS_DB_PATH?.trim();
    if (configured) return configured;
    return join(process.cwd(), 'data', 'session-events.sqlite');
}

let dbPromise: Promise<Database | null> | null = null;
let initError: unknown = null;

async function openDatabase(): Promise<Database> {
    const filePath = resolveDbPath();
    await mkdir(dirname(filePath), { recursive: true });

    const db = await open({ filename: filePath, driver: sqlite3.Database });
    await db.exec('PRAGMA journal_mode = WAL;');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS session_events (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            global_name TEXT,
            avatar_hash TEXT,
            dashboard_role TEXT,
            ip TEXT NOT NULL,
            user_agent TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
    `);
    await db.exec('CREATE INDEX IF NOT EXISTS session_events_user_idx ON session_events(user_id);');
    await db.exec('CREATE INDEX IF NOT EXISTS session_events_created_idx ON session_events(created_at);');
    await db.exec('ALTER TABLE session_events ADD COLUMN dashboard_role TEXT').catch(() => {});

    return db;
}

function getDb(): Promise<Database | null> {
    if (!dbPromise) {
        dbPromise = openDatabase().catch((error) => {
            initError = error;
            console.error('Failed to initialize session-events database:', error);
            return null;
        });
    }

    return dbPromise;
}

function rowToEvent(row: SessionEventRow): SessionEvent {
    return {
        id: row.id,
        eventType: row.event_type === 'logout' ? 'logout' : 'login',
        userId: row.user_id,
        username: row.username,
        globalName: row.global_name ?? null,
        avatarHash: row.avatar_hash ?? null,
        dashboardRole: row.dashboard_role ?? null,
        ip: row.ip,
        userAgent: row.user_agent,
        createdAt: row.created_at,
    };
}

export async function recordSessionEvent(event: Omit<SessionEvent, 'id'>): Promise<void> {
    const db = await getDb();
    if (!db) {
        throw (initError ?? new Error('Session events database is not available.'));
    }

    await db.run(
        `INSERT INTO session_events (id, event_type, user_id, username, global_name, avatar_hash, dashboard_role, ip, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        event.eventType,
        event.userId,
        event.username,
        event.globalName ?? null,
        event.avatarHash ?? null,
        event.dashboardRole ?? null,
        event.ip,
        event.userAgent,
        event.createdAt,
    );
}

export async function listSessionActivity(page = 1, pageSize = 50): Promise<SessionActivityResult> {
    const db = await getDb();
    if (!db) {
        throw (initError ?? new Error('Session events database is not available.'));
    }

    const sessionTtlMs = Number(process.env.DASHBOARD_SESSION_TTL_HOURS ?? 24) * 60 * 60 * 1000;
    const onlineCutoffMs = Date.now() - sessionTtlMs;

    const onlineRows = await db.all<SessionEventRow[]>(`
        SELECT e.*
        FROM session_events e
        WHERE e.event_type = 'login'
          AND e.created_at > ?
          AND NOT EXISTS (
              SELECT 1 FROM session_events e2
              WHERE e2.user_id = e.user_id
                AND e2.event_type = 'logout'
                AND e2.created_at > e.created_at
          )
        ORDER BY e.created_at DESC
    `, onlineCutoffMs);

    const seenOnlineUsers = new Set<string>();
    const onlineUsers: SessionEvent[] = [];
    for (const row of onlineRows) {
        if (!seenOnlineUsers.has(row.user_id)) {
            seenOnlineUsers.add(row.user_id);
            onlineUsers.push(rowToEvent(row));
        }
    }

    const cutoffMs = Date.now() - SESSION_EVENTS_MAX_RETAIN_MS;
    const countRow = await db.get<{ total: number }>('SELECT COUNT(*) as total FROM session_events WHERE created_at > ?', cutoffMs);
    const totalEvents = countRow?.total ?? 0;

    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
    const totalPages = Math.max(1, Math.ceil(totalEvents / safePageSize));
    const clampedPage = Math.min(safePage, totalPages);
    const offset = (clampedPage - 1) * safePageSize;

    const recentRows = await db.all<SessionEventRow[]>(
        'SELECT * FROM session_events WHERE created_at > ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        cutoffMs, safePageSize, offset,
    );

    return {
        onlineUsers,
        recentEvents: recentRows.map(rowToEvent),
        totalEvents,
        page: clampedPage,
        pageSize: safePageSize,
        totalPages,
    };
}

export async function forceLogoutAllActiveSessions(killedByUserId: string): Promise<number> {
    const db = await getDb();
    if (!db) {
        throw (initError ?? new Error('Session events database is not available.'));
    }

    const sessionTtlMs = Number(process.env.DASHBOARD_SESSION_TTL_HOURS ?? 24) * 60 * 60 * 1000;
    const onlineCutoffMs = Date.now() - sessionTtlMs;
    const now = Date.now();

    const onlineRows = await db.all<SessionEventRow[]>(`
        SELECT e.*
        FROM session_events e
        WHERE e.event_type = 'login'
          AND e.created_at > ?
          AND NOT EXISTS (
              SELECT 1 FROM session_events e2
              WHERE e2.user_id = e.user_id
                AND e2.event_type = 'logout'
                AND e2.created_at > e.created_at
          )
        ORDER BY e.created_at DESC
    `, onlineCutoffMs);

    const seenUsers = new Set<string>();
    const uniqueOnlineUsers: SessionEventRow[] = [];
    for (const row of onlineRows) {
        if (!seenUsers.has(row.user_id)) {
            seenUsers.add(row.user_id);
            uniqueOnlineUsers.push(row);
        }
    }

    for (const row of uniqueOnlineUsers) {
        await db.run(
            `INSERT INTO session_events (id, event_type, user_id, username, global_name, avatar_hash, dashboard_role, ip, user_agent, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            crypto.randomUUID(),
            'logout',
            row.user_id,
            row.username,
            row.global_name ?? null,
            row.avatar_hash ?? null,
            row.dashboard_role ?? null,
            '',
            `killswitch:${killedByUserId}`,
            now,
        );
    }

    return uniqueOnlineUsers.length;
}

export async function pruneOldSessionEvents(): Promise<void> {
    const db = await getDb();
    if (!db) return;

    const cutoffMs = Date.now() - SESSION_EVENTS_MAX_RETAIN_MS;
    await db.run('DELETE FROM session_events WHERE created_at <= ?', cutoffMs);
}
