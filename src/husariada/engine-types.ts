import type { FastestAnswer } from './embeds.js';
import type { EventQuestion, HusariadaEvent, HusariadaSettings, Standing } from './types.js';

/** Granica miedzy silnikiem gry a Discordem - w testach podmieniana na fake. */
export interface HusariadaChannelPort {
    /** Usuwa wszystkie wiadomosci z kanalu (sprzatanie po evencie). */
    clearChannel(): Promise<void>;
    /** Edytuje istniejacy embed "brak eventu" albo wysyla nowy; zwraca ID wiadomosci. */
    upsertLobby(existingMessageId: string | null, settings: HusariadaSettings): Promise<string>;
    deleteMessage(messageId: string): Promise<void>;
    sendIntro(event: HusariadaEvent, startsAt: number): Promise<void>;
    /** Wysyla pytanie z przyciskami. `createdAt` to czas wiadomosci wg Discorda. */
    sendQuestion(event: HusariadaEvent, question: EventQuestion, deadlineAt: number): Promise<SentQuestion>;
    updateQuestionProgress(messageId: string, event: HusariadaEvent, question: EventQuestion, deadlineAt: number, answeredCount: number): Promise<void>;
    revealQuestion(messageId: string, event: HusariadaEvent, question: EventQuestion, distribution: readonly number[], fastest: FastestAnswer | null): Promise<void>;
    sendLeaderboard(event: HusariadaEvent, standings: readonly Standing[], nextAt: number): Promise<void>;
    sendPaused(reason: string): Promise<void>;
    sendResumed(nextAt: number): Promise<void>;
    sendResults(event: HusariadaEvent, standings: readonly Standing[], cancelled: boolean): Promise<void>;
}

export interface SentQuestion {
    messageId: string;
    createdAt: number;
}

export interface EngineClock {
    now(): number;
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    setInterval(callback: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
}

export const systemClock: EngineClock = {
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

export interface AnswerInput {
    eventId: string;
    questionIndex: number;
    choiceIndex: number;
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    /** Moment klikniecia wg Discorda (snowflake interakcji), nie moment przetworzenia. */
    clickedAt: number;
}

export type AnswerOutcome =
    | { status: 'recorded'; choiceIndex: number }
    | { status: 'duplicate' }
    | { status: 'closed' };

export interface CommandResult {
    ok: boolean;
    error?: string;
}
