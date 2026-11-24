import {
    ANSWER_COUNT,
    DEFAULT_SETTINGS,
    EVENT_PHASES,
    EVENT_STATUSES,
    SETTINGS_BOUNDS,
    isCommandType,
    type AnswerTuple,
    type EventQuestion,
    type HusariadaCommand,
    type HusariadaEvent,
    type HusariadaPhase,
    type HusariadaSettings,
    type HusariadaEventStatus,
    type Question,
    type QuestionImage,
    type Quiz,
} from './types.js';

/** Schemat bazy i mapowanie wierszy SQLite na typy domenowe. */

export const SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS quizzes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        prompt TEXT NOT NULL,
        answers_json TEXT NOT NULL,
        correct_index INTEGER NOT NULL,
        image_name TEXT,
        image_mime TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS questions_quiz_idx ON questions(quiz_id, position);
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        quiz_id TEXT NOT NULL,
        quiz_title TEXT NOT NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        current_index INTEGER NOT NULL,
        question_count INTEGER NOT NULL,
        settings_json TEXT NOT NULL,
        started_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        question_started_at INTEGER,
        question_deadline_at INTEGER,
        question_message_id TEXT,
        pause_requested INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS events_status_idx ON events(status);
    CREATE TABLE IF NOT EXISTS event_questions (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        idx INTEGER NOT NULL,
        question_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        answers_json TEXT NOT NULL,
        correct_index INTEGER NOT NULL,
        image_name TEXT,
        image_mime TEXT,
        PRIMARY KEY (event_id, idx)
    );
    CREATE TABLE IF NOT EXISTS players (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        PRIMARY KEY (event_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS answers (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        question_index INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        choice_index INTEGER NOT NULL,
        response_ms INTEGER NOT NULL,
        correct INTEGER NOT NULL,
        points INTEGER NOT NULL,
        answered_at INTEGER NOT NULL,
        PRIMARY KEY (event_id, question_index, user_id)
    );
    CREATE TABLE IF NOT EXISTS commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        event_id TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        processed_at INTEGER,
        error TEXT
    );
    CREATE INDEX IF NOT EXISTS commands_pending_idx ON commands(processed_at, id);
    CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
`;

export interface QuizRow {
    id: string;
    title: string;
    description: string;
    created_by: string;
    created_at: number;
    updated_at: number;
    question_count: number | null;
}

export interface QuestionRow {
    id: string;
    quiz_id: string;
    position: number;
    prompt: string;
    answers_json: string;
    correct_index: number;
    image_name: string | null;
    image_mime: string | null;
    created_at: number;
    updated_at: number;
}

export interface EventRow {
    id: string;
    quiz_id: string;
    quiz_title: string;
    status: string;
    phase: string;
    current_index: number;
    question_count: number;
    settings_json: string;
    started_by: string;
    created_at: number;
    started_at: number | null;
    finished_at: number | null;
    question_started_at: number | null;
    question_deadline_at: number | null;
    question_message_id: string | null;
    pause_requested: number;
}

export interface EventQuestionRow {
    idx: number;
    question_id: string;
    prompt: string;
    answers_json: string;
    correct_index: number;
    image_name: string | null;
    image_mime: string | null;
}

export interface CommandRow {
    id: number;
    type: string;
    event_id: string | null;
    created_by: string;
    created_at: number;
}

export function parseAnswers(json: string): AnswerTuple {
    try {
        const parsed: unknown = JSON.parse(json);
        if (Array.isArray(parsed) && parsed.length === ANSWER_COUNT && parsed.every((item) => typeof item === 'string')) {
            return [parsed[0], parsed[1], parsed[2], parsed[3]];
        }
    } catch {
        // Uszkodzony wiersz - zwracamy puste odpowiedzi zamiast wywracac caly proces.
    }
    return ['', '', '', ''];
}

function toImage(name: string | null, mime: string | null): QuestionImage | null {
    return name && mime ? { storedName: name, mimeType: mime } : null;
}

export function clampSetting(key: keyof HusariadaSettings, value: unknown): number {
    const bounds = SETTINGS_BOUNDS[key];
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) {
        return bounds.default;
    }
    return Math.min(bounds.max, Math.max(bounds.min, Math.round(numeric)));
}

export function normalizeSettings(raw: Partial<Record<keyof HusariadaSettings, unknown>>): HusariadaSettings {
    const keys = Object.keys(DEFAULT_SETTINGS) as (keyof HusariadaSettings)[];
    return Object.fromEntries(
        keys.map((key) => [key, raw[key] === undefined ? DEFAULT_SETTINGS[key] : clampSetting(key, raw[key])]),
    ) as unknown as HusariadaSettings;
}

function parseSettings(json: string): HusariadaSettings {
    try {
        const parsed: unknown = JSON.parse(json);
        return parsed && typeof parsed === 'object' ? normalizeSettings(parsed as Record<string, unknown>) : DEFAULT_SETTINGS;
    } catch {
        return DEFAULT_SETTINGS;
    }
}

export function rowToQuiz(row: QuizRow): Quiz {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        questionCount: row.question_count ?? 0,
    };
}

export function rowToQuestion(row: QuestionRow): Question {
    return {
        id: row.id,
        quizId: row.quiz_id,
        position: row.position,
        prompt: row.prompt,
        answers: parseAnswers(row.answers_json),
        correctIndex: row.correct_index,
        image: toImage(row.image_name, row.image_mime),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export function rowToEventQuestion(row: EventQuestionRow): EventQuestion {
    return {
        index: row.idx,
        questionId: row.question_id,
        prompt: row.prompt,
        answers: parseAnswers(row.answers_json),
        correctIndex: row.correct_index,
        image: toImage(row.image_name, row.image_mime),
    };
}

function toStatus(value: string): HusariadaEventStatus {
    return (EVENT_STATUSES as readonly string[]).includes(value) ? value as HusariadaEventStatus : 'cancelled';
}

function toPhase(value: string): HusariadaPhase {
    return (EVENT_PHASES as readonly string[]).includes(value) ? value as HusariadaPhase : 'finished';
}

export function rowToEvent(row: EventRow): HusariadaEvent {
    return {
        id: row.id,
        quizId: row.quiz_id,
        quizTitle: row.quiz_title,
        status: toStatus(row.status),
        phase: toPhase(row.phase),
        currentIndex: row.current_index,
        questionCount: row.question_count,
        settings: parseSettings(row.settings_json),
        startedBy: row.started_by,
        createdAt: row.created_at,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        questionStartedAt: row.question_started_at,
        questionDeadlineAt: row.question_deadline_at,
        questionMessageId: row.question_message_id,
        pauseRequested: row.pause_requested === 1,
    };
}

export function rowToCommand(row: CommandRow): HusariadaCommand | null {
    if (!isCommandType(row.type)) {
        return null;
    }
    return {
        id: row.id,
        type: row.type,
        eventId: row.event_id,
        createdBy: row.created_by,
        createdAt: row.created_at,
    };
}

/** Mapowanie pol `EventPatch` na kolumny tabeli `events`. */
export const EVENT_PATCH_COLUMNS = {
    status: 'status',
    phase: 'phase',
    currentIndex: 'current_index',
    startedAt: 'started_at',
    finishedAt: 'finished_at',
    questionStartedAt: 'question_started_at',
    questionDeadlineAt: 'question_deadline_at',
    questionMessageId: 'question_message_id',
    pauseRequested: 'pause_requested',
} as const;
