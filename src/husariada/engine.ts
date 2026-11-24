import { createLogger, type Logger } from '../utils/logger.js';
import { computePoints, shouldShowLeaderboard } from './scoring.js';
import type { HusariadaStore } from './store.js';
import {
    systemClock,
    type AnswerInput,
    type AnswerOutcome,
    type EngineClock,
    type HusariadaChannelPort,
    type SentQuestion,
} from './engine-types.js';
import type { FastestAnswer } from './embeds.js';
import type { EventQuestion, HusariadaCommand, HusariadaEvent } from './types.js';

/**
 * Silnik Husariady (dziala w procesie bota). Wszystkie przejscia stanu ida przez jedna
 * kolejke (`exclusive`), wiec polecenia z dashboardu i timery nigdy sie nie przeplataja.
 * Odpowiedzi graczy omijaja kolejke (musza byc szybkie) i opieraja sie na `active`.
 */

/** Tolerancja na opoznienie sieci przy kliknieciu tuz przed koncem czasu. */
export const ANSWER_GRACE_MS = 300;
export const PROGRESS_INTERVAL_MS = 3_000;
export const RESUME_DELAY_MS = 5_000;

const PAUSE_REASON_ADMIN = 'Administracja wstrzymała event. Wracamy za chwilę — nie odchodź daleko!';
const PAUSE_REASON_SEND_FAILED = 'Nie udało się wysłać pytania na kanał. Administracja sprawdzi problem i wznowi event.';
const PAUSE_REASON_RESTART ='Bot został zrestartowany w trakcie eventu. Administracja może go wznowić z dashboardu.';

export class HusariadaCommandError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'HusariadaCommandError';
    }
}

interface ActiveQuestion {
    eventId: string;
    index: number;
    question: EventQuestion;
    messageId: string;
    /** Czas wyslania pytania wg Discorda - punkt odniesienia dla czasu odpowiedzi. */
    discordStartedAt: number;
    deadlineAt: number;
    timeLimitMs: number;
    maxPoints: number;
    closed: boolean;
    reportedCount: number;
}

type Step = () => Promise<void>;

export class HusariadaEngine {
    private chain: Promise<unknown> = Promise.resolve();
    private timer: unknown = null;
    private pendingStep: Step | null = null;
    private progressTimer: unknown = null;
    private active: ActiveQuestion | null = null;
    private readonly inFlightAnswers = new Set<Promise<unknown>>();

    constructor(
        private readonly store: HusariadaStore,
        private readonly port: HusariadaChannelPort,
        private readonly clock: EngineClock = systemClock,
        private readonly logger: Logger = createLogger('husariada:engine'),
    ) {}

    /** Czeka, az kolejka przejsc stanu sie oprozni (testy, wylaczanie). */
    async whenIdle(): Promise<void> {
        let current: Promise<unknown>;
        do {
            current = this.chain;
            await current.catch(() => undefined);
        } while (current !== this.chain);
    }

    /** Zatrzymuje timery (np. przy wylaczaniu bota). Stan w bazie zostaje. */
    shutdown(): void {
        this.clearTimer();
        this.stopProgress();
    }

    /** Pobiera polecenia z kolejki dashboardu i wykonuje je po kolei. */
    async processCommands(): Promise<void> {
        const commands = await this.store.claimPendingCommands();
        for (const command of commands) {
            try {
                await this.exclusive(() => this.applyCommand(command));
                this.logger.info('HUSARIADA_COMMAND_APPLIED', 'Wykonano polecenie Husariady.', {
                    command: command.type, eventId: command.eventId ?? undefined, actorUserId: command.createdBy,
                });
            } catch (error) {
                const message = error instanceof HusariadaCommandError ? error.message : 'Wewnętrzny błąd bota.';
                await this.store.markCommandFailed(command.id, message).catch(() => undefined);
                const log = error instanceof HusariadaCommandError ? this.logger.warn : this.logger.error;
                log.call(this.logger, 'HUSARIADA_COMMAND_FAILED', 'Nie udalo sie wykonac polecenia Husariady.', {
                    command: command.type, eventId: command.eventId ?? undefined,
                }, error);
            }
        }
    }

    /** Po starcie bota: odtwarza lobby albo bezpiecznie wstrzymuje przerwany event. */
    recover(): Promise<void> {
        return this.exclusive(async () => {
            const event = await this.store.getActiveEvent();
            if (!event) {
                await this.refreshLobby();
                return;
            }
            if (event.status !== 'running') {
                return;
            }
            if (event.phase === 'question' && event.questionMessageId) {
                await this.revealFromStore(event, event.questionMessageId);
            }
            await this.enterPaused(event, PAUSE_REASON_RESTART);
        });
    }

    async handleAnswer(input: AnswerInput): Promise<AnswerOutcome> {
        const active = this.active;
        if (!active || active.closed || active.eventId !== input.eventId || active.index !== input.questionIndex) {
            return { status: 'closed' };
        }
        const responseMs = Math.min(active.timeLimitMs, Math.max(0, input.clickedAt - active.discordStartedAt));
        if (input.clickedAt - active.discordStartedAt > active.timeLimitMs + ANSWER_GRACE_MS) {
            return { status: 'closed' };
        }

        const correct = input.choiceIndex === active.question.correctIndex;
        const pending = this.store.recordAnswer({
            eventId: active.eventId,
            questionIndex: active.index,
            userId: input.userId,
            choiceIndex: input.choiceIndex,
            responseMs,
            correct,
            points: computePoints({ correct, responseMs, timeLimitMs: active.timeLimitMs, maxPoints: active.maxPoints }),
            answeredAt: this.clock.now(),
        }, { userId: input.userId, displayName: input.displayName, avatarUrl: input.avatarUrl });

        this.inFlightAnswers.add(pending);
        try {
            const result = await pending;
            return result === 'recorded' ? { status: 'recorded', choiceIndex: input.choiceIndex } : { status: 'duplicate' };
        } finally {
            this.inFlightAnswers.delete(pending);
        }
    }

    private exclusive<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.chain.catch(() => undefined).then(operation);
        this.chain = next;
        return next;
    }

    private schedule(ms: number, step: Step): void {
        this.clearTimer();
        this.pendingStep = step;
        this.timer = this.clock.setTimeout(() => {
            this.timer = null;
            this.pendingStep = null;
            void this.exclusive(step).catch((error: unknown) => {
                this.logger.error('HUSARIADA_STEP_FAILED', 'Blad kroku Husariady.', {}, error);
            });
        }, Math.max(0, ms));
    }

    private clearTimer(): void {
        if (this.timer !== null) {
            this.clock.clearTimeout(this.timer);
            this.timer = null;
        }
        this.pendingStep = null;
    }

    private stopProgress(): void {
        if (this.progressTimer !== null) {
            this.clock.clearInterval(this.progressTimer);
            this.progressTimer = null;
        }
    }

    /** Bledy Discorda (np. usunieta wiadomosc) nie moga zatrzymac gry - logujemy i idziemy dalej. */
    private async safely(action: string, operation: () => Promise<unknown>): Promise<void> {
        try {
            await operation();
        } catch (error) {
            this.logger.error(action, 'Operacja Husariady na Discordzie nie powiodla sie.', {}, error);
        }
    }

    private async applyCommand(command: HusariadaCommand): Promise<void> {
        switch (command.type) {
            case 'start':
                return this.start(command.eventId);
            case 'pause':
                return this.pause();
            case 'resume':
                return this.resume();
            case 'skip':
                return this.skip();
            case 'stop':
                return this.stop();
            case 'refresh_lobby':
                return (await this.store.getActiveEvent()) ? undefined : this.refreshLobby();
        }
    }

    private async requireActive(): Promise<HusariadaEvent> {
        const event = await this.store.getActiveEvent();
        if (!event) {
            throw new HusariadaCommandError('Żaden event nie trwa.');
        }
        return event;
    }

    private async start(eventId: string | null): Promise<void> {
        const event = eventId ? await this.store.getEvent(eventId) : null;
        if (!event || event.status !== 'pending') {
            throw new HusariadaCommandError('Event nie istnieje albo został już uruchomiony.');
        }

        const lobbyId = await this.store.getMeta('lobby_message_id');
        if (lobbyId) {
            await this.safely('HUSARIADA_LOBBY_DELETE_FAILED', () => this.port.deleteMessage(lobbyId));
            await this.store.setMeta('lobby_message_id', null);
        }

        const now = this.clock.now();
        const introMs = event.settings.introSeconds * 1000;
        const running = await this.store.updateEvent(event.id, { status: 'running', phase: 'intro', startedAt: now });
        if (introMs <= 0) {
            await this.nextQuestion(event.id);
            return;
        }
        await this.safely('HUSARIADA_INTRO_FAILED', () => this.port.sendIntro(running ?? event, now + introMs));
        this.schedule(introMs, () => this.nextQuestion(event.id));
    }

    private async pause(): Promise<void> {
        const event = await this.requireActive();
        if (event.status !== 'running') {
            throw new HusariadaCommandError('Event nie jest w trakcie gry.');
        }
        // Pauza zaczyna dzialac przed kolejnym pytaniem - trwajace pytanie konczy sie normalnie.
        await this.store.updateEvent(event.id, { pauseRequested: true });
    }

    private async resume(): Promise<void> {
        const event = await this.requireActive();
        if (event.status === 'running' && event.pauseRequested) {
            await this.store.updateEvent(event.id, { pauseRequested: false });
            return;
        }
        if (event.status !== 'paused') {
            throw new HusariadaCommandError('Event nie jest wstrzymany.');
        }
        await this.store.updateEvent(event.id, { status: 'running', phase: 'waiting', pauseRequested: false });
        const nextAt = this.clock.now() + RESUME_DELAY_MS;
        await this.safely('HUSARIADA_RESUME_FAILED', () => this.port.sendResumed(nextAt));
        this.schedule(RESUME_DELAY_MS, () => this.nextQuestion(event.id));
    }

    private async skip(): Promise<void> {
        const event = await this.requireActive();
        if (event.status !== 'running') {
            throw new HusariadaCommandError('Można pominąć tylko w trakcie gry.');
        }
        const step = this.pendingStep;
        if (!step) {
            throw new HusariadaCommandError('Nie ma czego pominąć.');
        }
        this.clearTimer();
        await step();
    }

    private async stop(): Promise<void> {
        const event = await this.requireActive();
        this.clearTimer();
        if (event.status === 'pending') {
            this.stopProgress();
            await this.store.updateEvent(event.id, { status: 'cancelled', phase: 'finished', finishedAt: this.clock.now() });
            return;
        }
        if (this.active && !this.active.closed) {
            await this.reveal(event.id, { scheduleNext: false });
        }
        await this.finish(event.id, true);
    }

    private async nextQuestion(eventId: string): Promise<void> {
        const event = await this.store.getEvent(eventId);
        if (!event || event.status !== 'running') {
            return;
        }
        if (event.pauseRequested) {
            await this.enterPaused(event, PAUSE_REASON_ADMIN);
            return;
        }

        const index = event.currentIndex + 1;
        const question = index < event.questionCount ? await this.store.getEventQuestion(eventId, index) : null;
        if (!question) {
            await this.finish(eventId, false);
            return;
        }

        const timeLimitMs = event.settings.timeLimitSec * 1000;
        const current: HusariadaEvent = { ...event, currentIndex: index, phase: 'question' };
        let sent: SentQuestion;
        try {
            sent = await this.port.sendQuestion(current, question, this.clock.now() + timeLimitMs);
        } catch (error) {
            this.logger.error('HUSARIADA_QUESTION_SEND_FAILED', 'Nie udalo sie wyslac pytania - event wstrzymany.', { eventId, index }, error);
            await this.enterPaused(event, PAUSE_REASON_SEND_FAILED);
            return;
        }
        const deadlineAt = this.clock.now() + timeLimitMs;

        this.active = {
            eventId,
            index,
            question,
            messageId: sent.messageId,
            discordStartedAt: sent.createdAt,
            deadlineAt,
            timeLimitMs,
            maxPoints: event.settings.maxPoints,
            closed: false,
            reportedCount: 0,
        };
        await this.store.updateEvent(eventId, {
            phase: 'question',
            currentIndex: index,
            questionStartedAt: sent.createdAt,
            questionDeadlineAt: deadlineAt,
            questionMessageId: sent.messageId,
        });

        this.startProgress(current, deadlineAt);
        this.schedule(timeLimitMs + ANSWER_GRACE_MS, () => this.reveal(eventId, { scheduleNext: true }));
    }

    private startProgress(event: HusariadaEvent, deadlineAt: number): void {
        this.stopProgress();
        this.progressTimer = this.clock.setInterval(() => {
            void this.exclusive(async () => {
                const active = this.active;
                if (!active || active.closed || active.eventId !== event.id) return;
                const count = await this.store.countAnswers(active.eventId, active.index);
                if (count === active.reportedCount || active.closed) return;
                active.reportedCount = count;
                await this.safely('HUSARIADA_PROGRESS_FAILED', () => this.port.updateQuestionProgress(
                    active.messageId, event, active.question, deadlineAt, count,
                ));
            });
        }, PROGRESS_INTERVAL_MS);
    }

    private async collectRevealData(eventId: string, index: number, correctIndex: number): Promise<{ distribution: number[]; fastest: FastestAnswer | null }> {
        const [distribution, answers] = await Promise.all([
            this.store.getAnswerDistribution(eventId, index),
            this.store.getQuestionAnswers(eventId, index),
        ]);
        const first = answers.find((answer) => answer.choiceIndex === correctIndex && answer.correct);
        return {
            distribution,
            fastest: first ? { userId: first.userId, responseMs: first.responseMs, points: first.points } : null,
        };
    }

    private async reveal(eventId: string, options: { scheduleNext: boolean }): Promise<void> {
        const active = this.active;
        if (!active || active.eventId !== eventId || active.closed) {
            return;
        }
        active.closed = true;
        this.stopProgress();
        // Odpowiedzi przyjete przed zamknieciem musza trafic do statystyk.
        await Promise.allSettled([...this.inFlightAnswers]);

        const event = await this.store.getEvent(eventId);
        if (!event) return;
        const { distribution, fastest } = await this.collectRevealData(eventId, active.index, active.question.correctIndex);
        await this.safely('HUSARIADA_REVEAL_FAILED', () => this.port.revealQuestion(active.messageId, event, active.question, distribution, fastest));
        await this.store.updateEvent(eventId, { phase: 'reveal' });
        this.active = null;

        if (options.scheduleNext) {
            this.schedule(event.settings.revealSeconds * 1000, () => this.afterReveal(eventId));
        }
    }

    /** Odsloniecie pytania przerwanego restartem - na podstawie danych z bazy. */
    private async revealFromStore(event: HusariadaEvent, messageId: string): Promise<void> {
        const question = await this.store.getEventQuestion(event.id, event.currentIndex);
        if (!question) return;
        const { distribution, fastest } = await this.collectRevealData(event.id, event.currentIndex, question.correctIndex);
        await this.safely('HUSARIADA_REVEAL_FAILED', () => this.port.revealQuestion(messageId, event, question, distribution, fastest));
    }

    private async afterReveal(eventId: string): Promise<void> {
        const event = await this.store.getEvent(eventId);
        if (!event || event.status !== 'running') {
            return;
        }
        if (!shouldShowLeaderboard(event.currentIndex, event.questionCount, event.settings.leaderboardEvery)) {
            await this.nextQuestion(eventId);
            return;
        }

        const standings = await this.store.getStandings(eventId);
        const durationMs = event.settings.leaderboardSeconds * 1000;
        await this.safely('HUSARIADA_LEADERBOARD_FAILED', () => this.port.sendLeaderboard(event, standings.slice(0, 3), this.clock.now() + durationMs));
        await this.store.updateEvent(eventId, { phase: 'leaderboard' });
        this.schedule(durationMs, () => this.nextQuestion(eventId));
    }

    private async enterPaused(event: HusariadaEvent, reason: string): Promise<void> {
        this.clearTimer();
        this.stopProgress();
        this.active = null;
        await this.store.updateEvent(event.id, { status: 'paused', phase: 'paused', pauseRequested: false });
        await this.safely('HUSARIADA_PAUSE_FAILED', () => this.port.sendPaused(reason));
    }

    private async finish(eventId: string, cancelled: boolean): Promise<void> {
        this.clearTimer();
        this.stopProgress();
        this.active = null;

        const finished = await this.store.updateEvent(eventId, {
            status: cancelled ? 'cancelled' : 'finished',
            phase: 'finished',
            finishedAt: this.clock.now(),
        });
        if (!finished) return;
        const standings = await this.store.getStandings(eventId);
        // Kanal po evencie: tylko wyniki tej edycji i lobby - pytania, rankingi itd. znikaja.
        await this.safely('HUSARIADA_CLEAR_FAILED', () => this.port.clearChannel());
        await this.store.setMeta('lobby_message_id', null);
        await this.safely('HUSARIADA_RESULTS_FAILED', () => this.port.sendResults(finished, standings, cancelled));
        await this.refreshLobby();
    }

    private async refreshLobby(): Promise<void> {
        const existing = await this.store.getMeta('lobby_message_id');
        const settings = await this.store.getSettings();
        await this.safely('HUSARIADA_LOBBY_FAILED', async () => {
            const messageId = await this.port.upsertLobby(existing, settings);
            await this.store.setMeta('lobby_message_id', messageId);
        });
    }
}
