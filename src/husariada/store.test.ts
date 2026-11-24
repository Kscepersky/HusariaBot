import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHusariadaStore, HusariadaConflictError, type HusariadaStore } from './store.js';
import { DEFAULT_SETTINGS, type NewQuestionInput } from './types.js';

const ADMIN = '100000000000000001';
const PLAYER_A = '100000000000000002';
const PLAYER_B = '100000000000000003';

let store: HusariadaStore;

function questionInput(overrides: Partial<NewQuestionInput> = {}): NewQuestionInput {
    return {
        prompt: 'Kto wygrał LEC 2019?',
        answers: ['G2', 'Fnatic', 'Rogue', 'MAD'],
        correctIndex: 0,
        image: null,
        ...overrides,
    };
}

async function quizWithQuestions(count: number) {
    const quiz = await store.createQuiz({ title: 'Wiedza o G2', description: '', createdBy: ADMIN });
    const questions = [];
    for (let index = 0; index < count; index += 1) {
        questions.push(await store.createQuestion(quiz.id, questionInput({ prompt: `Pytanie ${index + 1}` })));
    }
    return { quiz, questions };
}

beforeEach(async () => {
    store = await createHusariadaStore(':memory:');
});

afterEach(async () => {
    await store.close();
});

describe('quizy i pytania', () => {
    it('tworzy quiz z licznikiem pytan', async () => {
        const { quiz } = await quizWithQuestions(2);
        expect((await store.getQuiz(quiz.id))?.questionCount).toBe(2);
        expect((await store.listQuizzes()).map((item) => item.id)).toEqual([quiz.id]);
    });

    it('nadaje kolejne pozycje i pozwala zmienic kolejnosc', async () => {
        const { quiz, questions } = await quizWithQuestions(3);
        expect(questions.map((question) => question.position)).toEqual([0, 1, 2]);

        await store.reorderQuestions(quiz.id, [questions[2].id, questions[0].id, questions[1].id]);

        expect((await store.listQuestions(quiz.id)).map((question) => question.prompt)).toEqual(['Pytanie 3', 'Pytanie 1', 'Pytanie 2']);
    });

    it('odrzuca nieaktualna liste przy zmianie kolejnosci', async () => {
        const { quiz, questions } = await quizWithQuestions(2);
        await expect(store.reorderQuestions(quiz.id, [questions[0].id])).rejects.toBeInstanceOf(HusariadaConflictError);
    });

    it('edytuje pytanie i obrazek', async () => {
        const { questions } = await quizWithQuestions(1);
        const image = { storedName: 'abc.png', mimeType: 'image/png' };
        const updated = await store.updateQuestion(questions[0].id, { correctIndex: 2, image });
        expect(updated?.after.correctIndex).toBe(2);
        expect(updated?.after.image).toEqual(image);
        expect(updated?.after.answers).toEqual(questions[0].answers);

        const cleared = await store.updateQuestion(questions[0].id, { image: null });
        expect(cleared?.after.image).toBeNull();
        expect(cleared?.before.image).toEqual(image);
    });

    it('usuniecie quizu zwraca obrazki pytan', async () => {
        const quiz = await store.createQuiz({ title: 'Q', description: '', createdBy: ADMIN });
        await store.createQuestion(quiz.id, questionInput({ image: { storedName: 'x.png', mimeType: 'image/png' } }));
        await store.createQuestion(quiz.id, questionInput());

        expect(await store.deleteQuiz(quiz.id)).toEqual([{ storedName: 'x.png', mimeType: 'image/png' }]);
        expect(await store.getQuiz(quiz.id)).toBeNull();
        expect(await store.deleteQuiz(quiz.id)).toBeNull();
    });
});

describe('ustawienia', () => {
    it('zwraca domyslne i przycina wartosci do zakresu', async () => {
        expect(await store.getSettings()).toEqual(DEFAULT_SETTINGS);
        const next = await store.updateSettings({ timeLimitSec: 1000, maxPoints: 500 });
        expect(next.timeLimitSec).toBe(120);
        expect(next.maxPoints).toBe(500);
        expect(await store.getSettings()).toEqual(next);
    });
});

describe('eventy', () => {
    it('zamraza kopie pytan w kolejnosci gry', async () => {
        const { quiz, questions } = await quizWithQuestions(3);
        const event = await store.createEvent({
            quizId: quiz.id, startedBy: ADMIN, settings: DEFAULT_SETTINGS,
            questionIds: [questions[2].id, questions[0].id],
        });

        expect(event.status).toBe('pending');
        expect(event.questionCount).toBe(2);
        expect(event.currentIndex).toBe(-1);

        await store.updateQuestion(questions[2].id, { prompt: 'Zmienione' });
        expect((await store.getEventQuestion(event.id, 0))?.prompt).toBe('Pytanie 3');
        expect((await store.getEventQuestion(event.id, 1))?.prompt).toBe('Pytanie 1');
        expect(await store.getEventQuestion(event.id, 2)).toBeNull();
    });

    it('nie pozwala na dwa aktywne eventy', async () => {
        const { quiz, questions } = await quizWithQuestions(1);
        const input = { quizId: quiz.id, startedBy: ADMIN, settings: DEFAULT_SETTINGS, questionIds: [questions[0].id] };
        await store.createEvent(input);
        await expect(store.createEvent(input)).rejects.toBeInstanceOf(HusariadaConflictError);
        expect(await store.isQuizInActiveEvent(quiz.id)).toBe(true);
    });

    it('odrzuca pytania spoza quizu', async () => {
        const { quiz } = await quizWithQuestions(1);
        await expect(store.createEvent({
            quizId: quiz.id, startedBy: ADMIN, settings: DEFAULT_SETTINGS, questionIds: ['nope'],
        })).rejects.toBeInstanceOf(HusariadaConflictError);
    });

    it('aktualizuje stan eventu', async () => {
        const { quiz, questions } = await quizWithQuestions(1);
        const event = await store.createEvent({ quizId: quiz.id, startedBy: ADMIN, settings: DEFAULT_SETTINGS, questionIds: [questions[0].id] });

        const updated = await store.updateEvent(event.id, { status: 'running', phase: 'question', currentIndex: 0, pauseRequested: true });

        expect(updated).toMatchObject({ status: 'running', phase: 'question', currentIndex: 0, pauseRequested: true });
        await store.updateEvent(event.id, { status: 'finished' });
        expect(await store.getActiveEvent()).toBeNull();
    });
});

describe('odpowiedzi i ranking', () => {
    async function runningEvent() {
        const { quiz, questions } = await quizWithQuestions(2);
        return store.createEvent({ quizId: quiz.id, startedBy: ADMIN, settings: DEFAULT_SETTINGS, questionIds: questions.map((q) => q.id) });
    }

    function answer(eventId: string, userId: string, questionIndex: number, points: number, choiceIndex = 0) {
        return {
            eventId, questionIndex, userId, choiceIndex, responseMs: 1000, correct: points > 0, points, answeredAt: Date.now(),
        };
    }

    it('zapisuje odpowiedz raz na pytanie i uzytkownika', async () => {
        const event = await runningEvent();
        const player = { userId: PLAYER_A, displayName: 'Ala', avatarUrl: null };

        expect(await store.recordAnswer(answer(event.id, PLAYER_A, 0, 400), player)).toBe('recorded');
        expect(await store.recordAnswer(answer(event.id, PLAYER_A, 0, 0, 2), player)).toBe('duplicate');
        expect(await store.recordAnswer(answer(event.id, PLAYER_A, 1, 300), player)).toBe('recorded');
        expect(await store.countAnswers(event.id, 0)).toBe(1);
    });

    it('liczy rozklad odpowiedzi i ranking', async () => {
        const event = await runningEvent();
        await store.recordAnswer(answer(event.id, PLAYER_A, 0, 400, 0), { userId: PLAYER_A, displayName: 'Ala', avatarUrl: null });
        await store.recordAnswer(answer(event.id, PLAYER_B, 0, 0, 3), { userId: PLAYER_B, displayName: 'Bob', avatarUrl: 'x' });
        await store.recordAnswer(answer(event.id, PLAYER_B, 1, 350, 0), { userId: PLAYER_B, displayName: 'Bob', avatarUrl: 'x' });

        expect(await store.getAnswerDistribution(event.id, 0)).toEqual([1, 0, 0, 1]);
        const standings = await store.getStandings(event.id);
        expect(standings.map((entry) => [entry.userId, entry.points, entry.place, entry.correctCount])).toEqual([
            [PLAYER_A, 400, 1, 1],
            [PLAYER_B, 350, 2, 1],
        ]);
        expect(standings[1].answeredCount).toBe(2);
    });
});

describe('kolejka polecen', () => {
    it('pobiera polecenia w kolejnosci tylko raz', async () => {
        await store.enqueueCommand('start', 'e1', ADMIN);
        await store.enqueueCommand('pause', 'e1', ADMIN);

        expect((await store.claimPendingCommands()).map((command) => command.type)).toEqual(['start', 'pause']);
        expect(await store.claimPendingCommands()).toEqual([]);
    });
});

describe('meta', () => {
    it('zapisuje i usuwa wartosci', async () => {
        await store.setMeta('lobby_message_id', '123');
        expect(await store.getMeta('lobby_message_id')).toBe('123');
        await store.setMeta('lobby_message_id', null);
        expect(await store.getMeta('lobby_message_id')).toBeNull();
    });
});
