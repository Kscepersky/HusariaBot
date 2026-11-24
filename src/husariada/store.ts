import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import {
    EVENT_PATCH_COLUMNS,
    SCHEMA_SQL,
    normalizeSettings,
    rowToCommand,
    rowToEvent,
    rowToEventQuestion,
    rowToQuestion,
    rowToQuiz,
    type CommandRow,
    type EventQuestionRow,
    type EventRow,
    type QuestionRow,
    type QuizRow,
} from './store-rows.js';
import { rankStandings } from './scoring.js';
import {
    ACTIVE_EVENT_STATUSES,
    DEFAULT_SETTINGS,
    type AnswerRecord,
    type EventPatch,
    type EventQuestion,
    type HusariadaCommand,
    type HusariadaCommandType,
    type HusariadaEvent,
    type HusariadaSettings,
    type NewQuestionInput,
    type PlayerInfo,
    type Question,
    type QuestionImage,
    type QuestionPatch,
    type Quiz,
    type Standing,
} from './types.js';

/**
 * Baza Husariady wspoldzielona przez dashboard (quizy, polecenia) i bota (przebieg gry, odpowiedzi).
 * Tryb WAL + busy_timeout, jak w bazie taskow.
 */

const BUSY_TIMEOUT_MS = 5_000;
const SETTINGS_KEY = 'event_settings';
const ACTIVE_STATUS_SQL = ACTIVE_EVENT_STATUSES.map((status) => `'${status}'`).join(', ');

export type MetaKey = 'lobby_message_id' | 'engine_heartbeat_at';
export type RecordAnswerResult = 'recorded' | 'duplicate';

export class HusariadaConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'HusariadaConflictError';
    }
}

export interface CommandStatus extends HusariadaCommand {
    processedAt: number | null;
    error: string | null;
}

export interface CreateEventInput {
    quizId: string;
    startedBy: string;
    settings: HusariadaSettings;
    /** Pytania w kolejnosci gry (podzbior pytan quizu). */
    questionIds: readonly string[];
}

export interface HusariadaStore {
    listQuizzes(): Promise<Quiz[]>;
    getQuiz(quizId: string): Promise<Quiz | null>;
    createQuiz(input: { title: string; description: string; createdBy: string }): Promise<Quiz>;
    updateQuiz(quizId: string, patch: { title?: string; description?: string }): Promise<Quiz | null>;
    /** Zwraca obrazki usunietych pytan (do skasowania z dysku) albo null, gdy quiz nie istnial. */
    deleteQuiz(quizId: string): Promise<QuestionImage[] | null>;

    listQuestions(quizId: string): Promise<Question[]>;
    getQuestion(questionId: string): Promise<Question | null>;
    createQuestion(quizId: string, input: NewQuestionInput): Promise<Question>;
    updateQuestion(questionId: string, patch: QuestionPatch): Promise<{ before: Question; after: Question } | null>;
    deleteQuestion(questionId: string): Promise<Question | null>;
    reorderQuestions(quizId: string, orderedIds: readonly string[]): Promise<void>;

    getSettings(): Promise<HusariadaSettings>;
    updateSettings(patch: Partial<HusariadaSettings>): Promise<HusariadaSettings>;

    createEvent(input: CreateEventInput): Promise<HusariadaEvent>;
    getEvent(eventId: string): Promise<HusariadaEvent | null>;
    getActiveEvent(): Promise<HusariadaEvent | null>;
    listEvents(limit: number): Promise<HusariadaEvent[]>;
    updateEvent(eventId: string, patch: EventPatch): Promise<HusariadaEvent | null>;
    getEventQuestion(eventId: string, index: number): Promise<EventQuestion | null>;
    isQuizInActiveEvent(quizId: string): Promise<boolean>;

    recordAnswer(answer: AnswerRecord, player: PlayerInfo): Promise<RecordAnswerResult>;
    countAnswers(eventId: string, questionIndex: number): Promise<number>;
    getAnswerDistribution(eventId: string, questionIndex: number): Promise<number[]>;
    getQuestionAnswers(eventId: string, questionIndex: number): Promise<AnswerRecord[]>;
    getStandings(eventId: string): Promise<Standing[]>;

    enqueueCommand(type: HusariadaCommandType, eventId: string | null, createdBy: string): Promise<HusariadaCommand>;
    /** Pobiera i oznacza jako przetworzone polecenia czekajace na bota (w kolejnosci). */
    claimPendingCommands(): Promise<HusariadaCommand[]>;
    markCommandFailed(commandId: number, error: string): Promise<void>;
    listRecentCommands(limit: number): Promise<CommandStatus[]>;

    getMeta(key: MetaKey): Promise<string | null>;
    setMeta(key: MetaKey, value: string | null): Promise<void>;
    close(): Promise<void>;
}

const QUIZ_SELECT = `
    SELECT q.*, (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count
    FROM quizzes q`;

export async function createHusariadaStore(filePath: string): Promise<HusariadaStore> {
    if (filePath !== ':memory:') {
        await mkdir(dirname(filePath), { recursive: true });
    }

    const db: Database = await open({ filename: filePath, driver: sqlite3.Database });
    await db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
    await db.exec('PRAGMA journal_mode = WAL;');
    await db.exec('PRAGMA foreign_keys = ON;');
    await db.exec(SCHEMA_SQL);

    let writeQueue: Promise<unknown> = Promise.resolve();
    function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
        const next = writeQueue.catch(() => undefined).then(operation);
        writeQueue = next;
        return next;
    }

    async function inTransaction<T>(operation: () => Promise<T>): Promise<T> {
        await db.exec('BEGIN IMMEDIATE');
        try {
            const result = await operation();
            await db.exec('COMMIT');
            return result;
        } catch (error) {
            await db.exec('ROLLBACK').catch(() => undefined);
            throw error;
        }
    }

    async function getQuiz(quizId: string): Promise<Quiz | null> {
        const row = await db.get<QuizRow>(`${QUIZ_SELECT} WHERE q.id = ?`, quizId);
        return row ? rowToQuiz(row) : null;
    }

    async function getQuestion(questionId: string): Promise<Question | null> {
        const row = await db.get<QuestionRow>('SELECT * FROM questions WHERE id = ?', questionId);
        return row ? rowToQuestion(row) : null;
    }

    async function listQuestions(quizId: string): Promise<Question[]> {
        const rows = await db.all<QuestionRow[]>('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position ASC, created_at ASC', quizId);
        return rows.map(rowToQuestion);
    }

    async function getEvent(eventId: string): Promise<HusariadaEvent | null> {
        const row = await db.get<EventRow>('SELECT * FROM events WHERE id = ?', eventId);
        return row ? rowToEvent(row) : null;
    }

    async function getActiveEvent(): Promise<HusariadaEvent | null> {
        const row = await db.get<EventRow>(
            `SELECT * FROM events WHERE status IN (${ACTIVE_STATUS_SQL}) ORDER BY created_at DESC LIMIT 1`,
        );
        return row ? rowToEvent(row) : null;
    }

    async function isQuizInActiveEvent(quizId: string): Promise<boolean> {
        const row = await db.get<{ found: number }>(
            `SELECT 1 AS found FROM events WHERE quiz_id = ? AND status IN (${ACTIVE_STATUS_SQL}) LIMIT 1`,
            quizId,
        );
        return Boolean(row);
    }

    async function getSettings(): Promise<HusariadaSettings> {
        const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', SETTINGS_KEY);
        if (!row) return DEFAULT_SETTINGS;
        try {
            return normalizeSettings(JSON.parse(row.value) as Record<string, unknown>);
        } catch {
            return DEFAULT_SETTINGS;
        }
    }

    return {
        async listQuizzes() {
            const rows = await db.all<QuizRow[]>(`${QUIZ_SELECT} ORDER BY q.updated_at DESC`);
            return rows.map(rowToQuiz);
        },

        getQuiz,

        createQuiz(input) {
            return enqueueWrite(async () => {
                const now = Date.now();
                const id = randomUUID();
                await db.run(
                    'INSERT INTO quizzes (id, title, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
                    id, input.title, input.description, input.createdBy, now, now,
                );
                return (await getQuiz(id))!;
            });
        },

        updateQuiz(quizId, patch) {
            return enqueueWrite(async () => {
                const current = await getQuiz(quizId);
                if (!current) return null;
                await db.run(
                    'UPDATE quizzes SET title = ?, description = ?, updated_at = ? WHERE id = ?',
                    patch.title ?? current.title, patch.description ?? current.description, Date.now(), quizId,
                );
                return getQuiz(quizId);
            });
        },

        deleteQuiz(quizId) {
            return enqueueWrite(() => inTransaction(async () => {
                if (!(await getQuiz(quizId))) return null;
                const images = (await listQuestions(quizId))
                    .map((question) => question.image)
                    .filter((image): image is QuestionImage => image !== null);
                await db.run('DELETE FROM questions WHERE quiz_id = ?', quizId);
                await db.run('DELETE FROM quizzes WHERE id = ?', quizId);
                return images;
            }));
        },

        listQuestions,
        getQuestion,

        createQuestion(quizId, input) {
            return enqueueWrite(() => inTransaction(async () => {
                const now = Date.now();
                const id = randomUUID();
                const position = (await db.get<{ next: number }>(
                    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM questions WHERE quiz_id = ?',
                    quizId,
                ))?.next ?? 0;
                await db.run(
                    `INSERT INTO questions (id, quiz_id, position, prompt, answers_json, correct_index, image_name, image_mime, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    id, quizId, position, input.prompt, JSON.stringify(input.answers), input.correctIndex,
                    input.image?.storedName ?? null, input.image?.mimeType ?? null, now, now,
                );
                await db.run('UPDATE quizzes SET updated_at = ? WHERE id = ?', now, quizId);
                return (await getQuestion(id))!;
            }));
        },

        updateQuestion(questionId, patch) {
            return enqueueWrite(async () => {
                const before = await getQuestion(questionId);
                if (!before) return null;
                const image = patch.image === undefined ? before.image : patch.image;
                const now = Date.now();
                await db.run(
                    `UPDATE questions SET prompt = ?, answers_json = ?, correct_index = ?, image_name = ?, image_mime = ?, updated_at = ?
                     WHERE id = ?`,
                    patch.prompt ?? before.prompt,
                    JSON.stringify(patch.answers ?? before.answers),
                    patch.correctIndex ?? before.correctIndex,
                    image?.storedName ?? null,
                    image?.mimeType ?? null,
                    now,
                    questionId,
                );
                await db.run('UPDATE quizzes SET updated_at = ? WHERE id = ?', now, before.quizId);
                return { before, after: (await getQuestion(questionId))! };
            });
        },

        deleteQuestion(questionId) {
            return enqueueWrite(async () => {
                const question = await getQuestion(questionId);
                if (!question) return null;
                await db.run('DELETE FROM questions WHERE id = ?', questionId);
                await db.run('UPDATE quizzes SET updated_at = ? WHERE id = ?', Date.now(), question.quizId);
                return question;
            });
        },

        reorderQuestions(quizId, orderedIds) {
            return enqueueWrite(() => inTransaction(async () => {
                const existing = (await listQuestions(quizId)).map((question) => question.id);
                const sameSet = existing.length === orderedIds.length
                    && new Set(orderedIds).size === orderedIds.length
                    && orderedIds.every((id) => existing.includes(id));
                if (!sameSet) {
                    throw new HusariadaConflictError('Lista pytań do zmiany kolejności jest nieaktualna.');
                }
                for (const [position, id] of orderedIds.entries()) {
                    await db.run('UPDATE questions SET position = ? WHERE id = ?', position, id);
                }
            }));
        },

        getSettings,

        updateSettings(patch) {
            return enqueueWrite(async () => {
                const next = normalizeSettings({ ...(await getSettings()), ...patch });
                await db.run(
                    `INSERT INTO settings (key, value) VALUES (?, ?)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                    SETTINGS_KEY, JSON.stringify(next),
                );
                return next;
            });
        },

        createEvent(input) {
            return enqueueWrite(() => inTransaction(async () => {
                if (await getActiveEvent()) {
                    throw new HusariadaConflictError('Inny event Husariady już trwa.');
                }
                const quiz = await getQuiz(input.quizId);
                if (!quiz) {
                    throw new HusariadaConflictError('Quiz nie istnieje.');
                }
                const byId = new Map((await listQuestions(input.quizId)).map((question) => [question.id, question]));
                const questions = input.questionIds.map((id) => byId.get(id));
                if (questions.length === 0 || questions.some((question) => !question)) {
                    throw new HusariadaConflictError('Wybrane pytania nie należą do quizu.');
                }

                const id = randomUUID();
                const now = Date.now();
                await db.run(
                    `INSERT INTO events (id, quiz_id, quiz_title, status, phase, current_index, question_count, settings_json, started_by, created_at)
                     VALUES (?, ?, ?, 'pending', 'waiting', -1, ?, ?, ?, ?)`,
                    id, quiz.id, quiz.title, questions.length, JSON.stringify(normalizeSettings(input.settings)), input.startedBy, now,
                );
                for (const [index, question] of questions.entries()) {
                    await db.run(
                        `INSERT INTO event_questions (event_id, idx, question_id, prompt, answers_json, correct_index, image_name, image_mime)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        id, index, question!.id, question!.prompt, JSON.stringify(question!.answers), question!.correctIndex,
                        question!.image?.storedName ?? null, question!.image?.mimeType ?? null,
                    );
                }
                return (await getEvent(id))!;
            }));
        },

        getEvent,
        getActiveEvent,

        async listEvents(limit) {
            const rows = await db.all<EventRow[]>('SELECT * FROM events ORDER BY created_at DESC LIMIT ?', Math.max(1, Math.min(limit, 100)));
            return rows.map(rowToEvent);
        },

        updateEvent(eventId, patch) {
            return enqueueWrite(async () => {
                const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as [keyof EventPatch, unknown][];
                if (entries.length > 0) {
                    const assignments = entries.map(([key]) => `${EVENT_PATCH_COLUMNS[key]} = ?`).join(', ');
                    const values = entries.map(([key, value]) => (key === 'pauseRequested' ? (value ? 1 : 0) : value));
                    await db.run(`UPDATE events SET ${assignments} WHERE id = ?`, ...values, eventId);
                }
                return getEvent(eventId);
            });
        },

        async getEventQuestion(eventId, index) {
            const row = await db.get<EventQuestionRow>('SELECT * FROM event_questions WHERE event_id = ? AND idx = ?', eventId, index);
            return row ? rowToEventQuestion(row) : null;
        },

        isQuizInActiveEvent,

        recordAnswer(answer, player) {
            return enqueueWrite(() => inTransaction(async () => {
                const result = await db.run(
                    `INSERT OR IGNORE INTO answers (event_id, question_index, user_id, choice_index, response_ms, correct, points, answered_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    answer.eventId, answer.questionIndex, answer.userId, answer.choiceIndex,
                    answer.responseMs, answer.correct ? 1 : 0, answer.points, answer.answeredAt,
                );
                if (!result.changes) {
                    return 'duplicate' as const;
                }
                await db.run(
                    `INSERT INTO players (event_id, user_id, display_name, avatar_url) VALUES (?, ?, ?, ?)
                     ON CONFLICT(event_id, user_id) DO UPDATE SET display_name = excluded.display_name, avatar_url = excluded.avatar_url`,
                    answer.eventId, player.userId, player.displayName, player.avatarUrl,
                );
                return 'recorded' as const;
            }));
        },

        async countAnswers(eventId, questionIndex) {
            const row = await db.get<{ total: number }>(
                'SELECT COUNT(*) AS total FROM answers WHERE event_id = ? AND question_index = ?',
                eventId, questionIndex,
            );
            return row?.total ?? 0;
        },

        async getAnswerDistribution(eventId, questionIndex) {
            const rows = await db.all<{ choice_index: number; total: number }[]>(
                `SELECT choice_index, COUNT(*) AS total FROM answers
                 WHERE event_id = ? AND question_index = ? GROUP BY choice_index`,
                eventId, questionIndex,
            );
            const distribution = [0, 0, 0, 0];
            for (const row of rows) {
                if (row.choice_index >= 0 && row.choice_index < distribution.length) {
                    distribution[row.choice_index] = row.total;
                }
            }
            return distribution;
        },

        async getQuestionAnswers(eventId, questionIndex) {
            const rows = await db.all<{
                user_id: string; choice_index: number; response_ms: number; correct: number; points: number; answered_at: number;
            }[]>(
                'SELECT * FROM answers WHERE event_id = ? AND question_index = ? ORDER BY response_ms ASC',
                eventId, questionIndex,
            );
            return rows.map((row) => ({
                eventId,
                questionIndex,
                userId: row.user_id,
                choiceIndex: row.choice_index,
                responseMs: row.response_ms,
                correct: row.correct === 1,
                points: row.points,
                answeredAt: row.answered_at,
            }));
        },

        async getStandings(eventId) {
            const rows = await db.all<{
                user_id: string; display_name: string; avatar_url: string | null;
                points: number; correct_count: number; answered_count: number; correct_ms: number;
            }[]>(
                `SELECT p.user_id, p.display_name, p.avatar_url,
                        COALESCE(SUM(a.points), 0) AS points,
                        COALESCE(SUM(a.correct), 0) AS correct_count,
                        COUNT(a.user_id) AS answered_count,
                        COALESCE(SUM(CASE WHEN a.correct = 1 THEN a.response_ms ELSE 0 END), 0) AS correct_ms
                 FROM players p
                 LEFT JOIN answers a ON a.event_id = p.event_id AND a.user_id = p.user_id
                 WHERE p.event_id = ?
                 GROUP BY p.user_id`,
                eventId,
            );
            return rankStandings(rows.map((row) => ({
                userId: row.user_id,
                displayName: row.display_name,
                avatarUrl: row.avatar_url,
                points: row.points,
                correctCount: row.correct_count,
                answeredCount: row.answered_count,
                correctResponseMs: row.correct_ms,
            })));
        },

        enqueueCommand(type, eventId, createdBy) {
            return enqueueWrite(async () => {
                const now = Date.now();
                const result = await db.run(
                    'INSERT INTO commands (type, event_id, created_by, created_at) VALUES (?, ?, ?, ?)',
                    type, eventId, createdBy, now,
                );
                return { id: Number(result.lastID), type, eventId, createdBy, createdAt: now };
            });
        },

        claimPendingCommands() {
            return enqueueWrite(() => inTransaction(async () => {
                const rows = await db.all<CommandRow[]>('SELECT * FROM commands WHERE processed_at IS NULL ORDER BY id ASC LIMIT 20');
                if (rows.length === 0) return [];
                const now = Date.now();
                for (const row of rows) {
                    await db.run('UPDATE commands SET processed_at = ? WHERE id = ?', now, row.id);
                }
                return rows.map(rowToCommand).filter((command): command is HusariadaCommand => command !== null);
            }));
        },

        markCommandFailed(commandId, error) {
            return enqueueWrite(async () => {
                await db.run('UPDATE commands SET error = ? WHERE id = ?', error.slice(0, 500), commandId);
            });
        },

        async listRecentCommands(limit) {
            const rows = await db.all<(CommandRow & { processed_at: number | null; error: string | null })[]>(
                'SELECT * FROM commands ORDER BY id DESC LIMIT ?',
                Math.max(1, Math.min(limit, 50)),
            );
            return rows.flatMap((row) => {
                const command = rowToCommand(row);
                return command ? [{ ...command, processedAt: row.processed_at, error: row.error }] : [];
            });
        },

        async getMeta(key) {
            const row = await db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
            return row?.value ?? null;
        },

        setMeta(key, value) {
            return enqueueWrite(async () => {
                if (value === null) {
                    await db.run('DELETE FROM meta WHERE key = ?', key);
                    return;
                }
                await db.run(
                    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
                    key, value,
                );
            });
        },

        async close() {
            await writeQueue.catch(() => undefined);
            await db.close();
        },
    };
}

function resolveHusariadaDbPath(): string {
    const configured = process.env.HUSARIADA_DB_PATH?.trim();
    if (!configured) {
        return join(process.cwd(), 'data', 'husariada.sqlite');
    }
    if (configured === ':memory:') {
        return configured;
    }
    return isAbsolute(configured) ? configured : join(process.cwd(), configured);
}

let sharedStore: Promise<HusariadaStore> | null = null;

/** Wspolna instancja dla procesu. Blad inicjalizacji nie jest zapamietywany. */
export function getHusariadaStore(): Promise<HusariadaStore> {
    if (!sharedStore) {
        sharedStore = createHusariadaStore(resolveHusariadaDbPath()).catch((error: unknown) => {
            sharedStore = null;
            throw error;
        });
    }
    return sharedStore;
}
