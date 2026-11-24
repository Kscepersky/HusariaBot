/** Wspolne typy Husariady (quiz w stylu Kahoot) - uzywane przez bota i dashboard. */

export const ANSWER_COUNT = 4;
export const QUIZ_TITLE_MAX_LENGTH = 100;
export const QUIZ_DESCRIPTION_MAX_LENGTH = 500;
export const QUESTION_PROMPT_MAX_LENGTH = 300;
/** Etykieta przycisku Discorda ma limit 80 znakow. */
export const ANSWER_MAX_LENGTH = 80;
export const MAX_QUESTIONS_PER_QUIZ = 100;

export type AnswerTuple = readonly [string, string, string, string];

export const EVENT_STATUSES = ['pending', 'running', 'paused', 'finished', 'cancelled'] as const;
export type HusariadaEventStatus = (typeof EVENT_STATUSES)[number];
export const ACTIVE_EVENT_STATUSES: readonly HusariadaEventStatus[] = ['pending', 'running', 'paused'];

export const EVENT_PHASES = ['waiting', 'intro', 'question', 'reveal', 'leaderboard', 'paused', 'finished'] as const;
export type HusariadaPhase = (typeof EVENT_PHASES)[number];

export const COMMAND_TYPES = ['start', 'pause', 'resume', 'stop', 'skip', 'refresh_lobby'] as const;
export type HusariadaCommandType = (typeof COMMAND_TYPES)[number];

export interface HusariadaSettings {
    /** Czas na odpowiedz (s). */
    timeLimitSec: number;
    /** Punkty za natychmiastowa poprawna odpowiedz (Kahoot: spada liniowo do polowy). */
    maxPoints: number;
    /** Co ile pytan pokazywac top 3 (0 = nigdy). */
    leaderboardEvery: number;
    leaderboardSeconds: number;
    /** Jak dlugo widac poprawna odpowiedz i statystyki. */
    revealSeconds: number;
    /** Odliczanie przed pierwszym pytaniem. */
    introSeconds: number;
}

export interface SettingBounds {
    min: number;
    max: number;
    default: number;
}

export const SETTINGS_BOUNDS: Readonly<Record<keyof HusariadaSettings, SettingBounds>> = {
    timeLimitSec: { min: 5, max: 120, default: 15 },
    maxPoints: { min: 100, max: 5000, default: 400 },
    leaderboardEvery: { min: 0, max: 50, default: 5 },
    leaderboardSeconds: { min: 3, max: 60, default: 10 },
    revealSeconds: { min: 2, max: 30, default: 5 },
    introSeconds: { min: 0, max: 120, default: 10 },
};

export const DEFAULT_SETTINGS: HusariadaSettings = {
    timeLimitSec: SETTINGS_BOUNDS.timeLimitSec.default,
    maxPoints: SETTINGS_BOUNDS.maxPoints.default,
    leaderboardEvery: SETTINGS_BOUNDS.leaderboardEvery.default,
    leaderboardSeconds: SETTINGS_BOUNDS.leaderboardSeconds.default,
    revealSeconds: SETTINGS_BOUNDS.revealSeconds.default,
    introSeconds: SETTINGS_BOUNDS.introSeconds.default,
};

export interface QuestionImage {
    storedName: string;
    mimeType: string;
}

export interface Quiz {
    id: string;
    title: string;
    description: string;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
    questionCount: number;
}

export interface Question {
    id: string;
    quizId: string;
    position: number;
    prompt: string;
    answers: AnswerTuple;
    correctIndex: number;
    image: QuestionImage | null;
    createdAt: number;
    updatedAt: number;
}

export interface NewQuestionInput {
    prompt: string;
    answers: AnswerTuple;
    correctIndex: number;
    image: QuestionImage | null;
}

export interface QuestionPatch {
    prompt?: string;
    answers?: AnswerTuple;
    correctIndex?: number;
    /** `null` usuwa obrazek, `undefined` zostawia bez zmian. */
    image?: QuestionImage | null;
}

/** Kopia pytania zamrozona w chwili startu eventu - edycja quizu nie psuje trwajacej gry. */
export interface EventQuestion {
    index: number;
    questionId: string;
    prompt: string;
    answers: AnswerTuple;
    correctIndex: number;
    image: QuestionImage | null;
}

export interface HusariadaEvent {
    id: string;
    quizId: string;
    quizTitle: string;
    status: HusariadaEventStatus;
    phase: HusariadaPhase;
    /** -1 przed pierwszym pytaniem. */
    currentIndex: number;
    questionCount: number;
    settings: HusariadaSettings;
    startedBy: string;
    createdAt: number;
    startedAt: number | null;
    finishedAt: number | null;
    questionStartedAt: number | null;
    questionDeadlineAt: number | null;
    questionMessageId: string | null;
    pauseRequested: boolean;
}

export type EventPatch = Partial<Pick<HusariadaEvent,
    'status' | 'phase' | 'currentIndex' | 'startedAt' | 'finishedAt' | 'questionStartedAt'
    | 'questionDeadlineAt' | 'questionMessageId' | 'pauseRequested'>>;

export interface AnswerRecord {
    eventId: string;
    questionIndex: number;
    userId: string;
    choiceIndex: number;
    responseMs: number;
    correct: boolean;
    points: number;
    answeredAt: number;
}

export interface PlayerInfo {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
}

export interface Standing extends PlayerInfo {
    place: number;
    points: number;
    correctCount: number;
    answeredCount: number;
    /** Suma czasow poprawnych odpowiedzi - rozstrzyga remisy punktowe. */
    correctResponseMs: number;
}

export interface HusariadaCommand {
    id: number;
    type: HusariadaCommandType;
    eventId: string | null;
    createdBy: string;
    createdAt: number;
}

export function isCommandType(value: unknown): value is HusariadaCommandType {
    return typeof value === 'string' && (COMMAND_TYPES as readonly string[]).includes(value);
}

export function isActiveStatus(status: HusariadaEventStatus): boolean {
    return ACTIVE_EVENT_STATUSES.includes(status);
}
