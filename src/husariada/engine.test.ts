import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
    createLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { ANSWER_GRACE_MS, HusariadaEngine, RESUME_DELAY_MS } from './engine.js';
import { createHusariadaStore, type HusariadaStore } from './store.js';
import type { HusariadaChannelPort } from './engine-types.js';
import type { HusariadaSettings } from './types.js';

const ADMIN = '100000000000000001';
const ALA = '100000000000000002';
const BOB = '100000000000000003';

const SETTINGS: HusariadaSettings = {
    timeLimitSec: 15,
    maxPoints: 400,
    leaderboardEvery: 1,
    leaderboardSeconds: 3,
    revealSeconds: 2,
    introSeconds: 2,
};

let store: HusariadaStore;
let port: { [K in keyof HusariadaChannelPort]: ReturnType<typeof vi.fn> };
let engine: HusariadaEngine;
let messageCounter = 0;

function createPort() {
    return {
        clearChannel: vi.fn(async () => undefined),
        upsertLobby: vi.fn(async () => 'lobby-new'),
        deleteMessage: vi.fn(async () => undefined),
        sendIntro: vi.fn(async () => undefined),
        sendQuestion: vi.fn(async () => ({ messageId: `msg-${messageCounter += 1}`, createdAt: Date.now() })),
        updateQuestionProgress: vi.fn(async () => undefined),
        revealQuestion: vi.fn(async () => undefined),
        sendLeaderboard: vi.fn(async () => undefined),
        sendPaused: vi.fn(async () => undefined),
        sendResumed: vi.fn(async () => undefined),
        sendResults: vi.fn(async () => undefined),
    };
}

async function settle(): Promise<void> {
    await engine.whenIdle();
}

async function advance(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await settle();
}

async function startEvent(questionCount = 2, settings: HusariadaSettings = SETTINGS) {
    const quiz = await store.createQuiz({ title: 'Wiedza o G2', description: '', createdBy: ADMIN });
    const ids: string[] = [];
    for (let index = 0; index < questionCount; index += 1) {
        const question = await store.createQuestion(quiz.id, {
            prompt: `Pytanie ${index + 1}`, answers: ['A', 'B', 'C', 'D'], correctIndex: 1, image: null,
        });
        ids.push(question.id);
    }
    const event = await store.createEvent({ quizId: quiz.id, startedBy: ADMIN, settings, questionIds: ids });
    await store.enqueueCommand('start', event.id, ADMIN);
    await engine.processCommands();
    await settle();
    return event;
}

function answer(eventId: string, userId: string, questionIndex: number, choiceIndex: number, afterMs: number) {
    const sentAt = (port.sendQuestion.mock.results.at(-1)?.value as Promise<{ createdAt: number }>);
    return sentAt.then(({ createdAt }) => engine.handleAnswer({
        eventId, questionIndex, choiceIndex, userId, displayName: userId === ALA ? 'Ala' : 'Bob', avatarUrl: null, clickedAt: createdAt + afterMs,
    }));
}

async function command(type: 'pause' | 'resume' | 'skip' | 'stop', eventId: string) {
    await store.enqueueCommand(type, eventId, ADMIN);
    await engine.processCommands();
    await settle();
}

beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-11-24T18:00:00Z'));
    store = await createHusariadaStore(':memory:');
    port = createPort();
    engine = new HusariadaEngine(store, port as unknown as HusariadaChannelPort);
    messageCounter = 0;
});

afterEach(async () => {
    engine.shutdown();
    await store.close();
    vi.useRealTimers();
});

describe('pelna rozgrywka', () => {
    it('intro -> pytania -> ranking -> wyniki -> lobby', async () => {
        await store.setMeta('lobby_message_id', 'lobby-old');
        const event = await startEvent(2);

        expect(port.deleteMessage).toHaveBeenCalledWith('lobby-old');
        expect(port.sendIntro).toHaveBeenCalledTimes(1);
        expect(port.sendQuestion).not.toHaveBeenCalled();

        await advance(2_000);
        expect(port.sendQuestion).toHaveBeenCalledTimes(1);
        expect((await store.getEvent(event.id))?.phase).toBe('question');

        expect(await answer(event.id, ALA, 0, 1, 1_500)).toEqual({ status: 'recorded', choiceIndex: 1 });
        expect(await answer(event.id, ALA, 0, 2, 2_000)).toEqual({ status: 'duplicate' });
        expect(await answer(event.id, BOB, 0, 3, 4_000)).toEqual({ status: 'recorded', choiceIndex: 3 });

        await advance(15_000 + ANSWER_GRACE_MS);
        expect(port.revealQuestion).toHaveBeenCalledTimes(1);
        const [, , , distribution, fastest] = port.revealQuestion.mock.calls[0];
        expect(distribution).toEqual([0, 1, 0, 1]);
        expect(fastest).toEqual({ userId: ALA, responseMs: 1_500, points: 380 });

        await advance(2_000);
        expect(port.sendLeaderboard).toHaveBeenCalledTimes(1);
        const standings = port.sendLeaderboard.mock.calls[0][1];
        expect(standings.map((entry: { userId: string; points: number }) => [entry.userId, entry.points])).toEqual([[ALA, 380], [BOB, 0]]);

        await advance(3_000);
        expect(port.sendQuestion).toHaveBeenCalledTimes(2);

        await advance(15_000 + ANSWER_GRACE_MS);
        await advance(2_000);
        // Po ostatnim pytaniu nie ma rankingu posredniego, tylko wyniki koncowe.
        expect(port.sendLeaderboard).toHaveBeenCalledTimes(1);
        expect(port.sendResults).toHaveBeenCalledTimes(1);
        expect(port.sendResults.mock.calls[0][2]).toBe(false);
        // Kanal czyszczony przed wynikami, potem nowe lobby (stare zniknelo razem z kanalem).
        expect(port.clearChannel).toHaveBeenCalledTimes(1);
        expect(port.clearChannel.mock.invocationCallOrder[0]).toBeLessThan(port.sendResults.mock.invocationCallOrder[0]);
        expect(port.upsertLobby).toHaveBeenLastCalledWith(null, expect.anything());
        expect((await store.getEvent(event.id))?.status).toBe('finished');
        expect(await store.getMeta('lobby_message_id')).toBe('lobby-new');
    });

    it('odrzuca spoznione odpowiedzi i odpowiedzi na inne pytanie', async () => {
        const event = await startEvent(2);
        await advance(2_000);

        expect(await answer(event.id, ALA, 0, 1, 15_000 + ANSWER_GRACE_MS + 1)).toEqual({ status: 'closed' });
        expect(await answer(event.id, ALA, 1, 1, 100)).toEqual({ status: 'closed' });
        expect(await answer('inny-event', ALA, 0, 1, 100)).toEqual({ status: 'closed' });

        await advance(15_000 + ANSWER_GRACE_MS);
        expect(await answer(event.id, BOB, 0, 1, 100)).toEqual({ status: 'closed' });
    });

    it('aktualizuje licznik odpowiedzi w trakcie pytania', async () => {
        const event = await startEvent(1);
        await advance(2_000);
        await answer(event.id, ALA, 0, 1, 500);
        await advance(3_000);
        expect(port.updateQuestionProgress).toHaveBeenCalledWith('msg-1', expect.anything(), expect.anything(), expect.any(Number), 1);
    });
});

describe('sterowanie z dashboardu', () => {
    it('pauza dziala po biezacym pytaniu, wznowienie kontynuuje', async () => {
        const event = await startEvent(2, { ...SETTINGS, leaderboardEvery: 0 });
        await advance(2_000);
        await command('pause', event.id);
        expect((await store.getEvent(event.id))?.status).toBe('running');

        await advance(15_000 + ANSWER_GRACE_MS);
        await advance(2_000);
        expect(port.sendPaused).toHaveBeenCalledTimes(1);
        expect((await store.getEvent(event.id))?.status).toBe('paused');
        expect(port.sendQuestion).toHaveBeenCalledTimes(1);

        await command('resume', event.id);
        expect(port.sendResumed).toHaveBeenCalledTimes(1);
        await advance(RESUME_DELAY_MS);
        expect(port.sendQuestion).toHaveBeenCalledTimes(2);
        expect(port.sendQuestion.mock.calls[1][1].index).toBe(1);
    });

    it('pomija pytanie i od razu je odslania', async () => {
        const event = await startEvent(2);
        await advance(2_000);
        await command('skip', event.id);
        expect(port.revealQuestion).toHaveBeenCalledTimes(1);
    });

    it('pomija intro', async () => {
        const event = await startEvent(2);
        await command('skip', event.id);
        expect(port.sendQuestion).toHaveBeenCalledTimes(1);
    });

    it('stop konczy event z wynikami oznaczonymi jako przerwane', async () => {
        const event = await startEvent(3);
        await advance(2_000);
        await answer(event.id, ALA, 0, 1, 100);
        await command('stop', event.id);

        expect(port.revealQuestion).toHaveBeenCalledTimes(1);
        expect(port.sendResults).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }), expect.any(Array), true);
        expect((await store.getEvent(event.id))?.status).toBe('cancelled');
        await advance(60_000);
        expect(port.sendQuestion).toHaveBeenCalledTimes(1);
    });

    it('stop przed uruchomieniem anuluje event bez wynikow', async () => {
        const quiz = await store.createQuiz({ title: 'Q', description: '', createdBy: ADMIN });
        const question = await store.createQuestion(quiz.id, { prompt: 'P', answers: ['A', 'B', 'C', 'D'], correctIndex: 0, image: null });
        const event = await store.createEvent({ quizId: quiz.id, startedBy: ADMIN, settings: SETTINGS, questionIds: [question.id] });

        await command('stop', event.id);

        expect((await store.getEvent(event.id))?.status).toBe('cancelled');
        expect(port.sendResults).not.toHaveBeenCalled();
    });

    it('oznacza bledne polecenie jako nieudane', async () => {
        await command('resume', 'x');
        await store.enqueueCommand('start', 'nie-istnieje', ADMIN);
        await engine.processCommands();
        expect(port.sendIntro).not.toHaveBeenCalled();
    });
});

describe('odpornosc', () => {
    it('wstrzymuje event, gdy nie da sie wyslac pytania', async () => {
        port.sendQuestion.mockRejectedValueOnce(new Error('Missing Access'));
        const event = await startEvent(2);
        await advance(2_000);
        expect((await store.getEvent(event.id))?.status).toBe('paused');
        expect(port.sendPaused).toHaveBeenCalled();
    });

    it('po restarcie odslania przerwane pytanie i wstrzymuje event', async () => {
        const event = await startEvent(2);
        await advance(2_000);
        await answer(event.id, ALA, 0, 1, 100);
        engine.shutdown();

        const restarted = new HusariadaEngine(store, port as unknown as HusariadaChannelPort);
        await restarted.recover();

        expect(port.revealQuestion).toHaveBeenCalledWith('msg-1', expect.anything(), expect.objectContaining({ index: 0 }), [0, 1, 0, 0], expect.objectContaining({ userId: ALA }));
        expect((await store.getEvent(event.id))?.status).toBe('paused');
        restarted.shutdown();
    });

    it('bez aktywnego eventu odswieza lobby', async () => {
        await engine.recover();
        expect(port.upsertLobby).toHaveBeenCalledWith(null, expect.objectContaining({ timeLimitSec: 15 }));
        expect(await store.getMeta('lobby_message_id')).toBe('lobby-new');
    });
});
