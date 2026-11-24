import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPermissionStore, type PermissionStore } from '../../permissions/permission-store.js';
import { createHusariadaStore, type HusariadaStore } from '../../husariada/store.js';

let permissionStore: PermissionStore;
let husariadaStore: HusariadaStore;

vi.mock('../../permissions/permission-store.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../permissions/permission-store.js')>()),
    getPermissionStore: vi.fn(async () => permissionStore),
}));

vi.mock('../../husariada/store.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../husariada/store.js')>()),
    getHusariadaStore: vi.fn(async () => husariadaStore),
}));

vi.mock('../discord-api.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../discord-api.js')>()),
    getGuildMember: vi.fn(async () => ({ roles: [], user: { id: '1' } })),
}));

import { husariadaRouter, pickQuestionOrder } from './api.husariada.js';

const OWNER = '111111111111111111';
const STAFF = '222222222222222222';
const OUTSIDER = '333333333333333333';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PNG_UPLOAD = { mimeType: 'image/png', dataBase64: `data:image/png;base64,${PNG.toString('base64')}` };
const QUESTION = { prompt: 'Kto wygrał LEC 2019?', answers: ['G2', 'Fnatic', 'Rogue', 'MAD'], correctIndex: 0 };

let server: Server;
let baseUrl: string;
let sessionUserId: string | undefined;
let imagesDir: string;

/** `as = ''` oznacza niezalogowanego. */
async function api(method: string, path: string, body?: unknown, as: string = STAFF): Promise<{ status: number; body: any }> {
    sessionUserId = as || undefined;
    const response = await fetch(`${baseUrl}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const isJson = response.headers.get('content-type')?.includes('application/json');
    return { status: response.status, body: isJson ? await response.json() : Buffer.from(await response.arrayBuffer()) };
}

async function createQuiz(): Promise<any> {
    const result = await api('POST', '/husariada/quizzes', { title: 'Wiedza o G2' });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body.quiz;
}

async function addQuestion(quizId: string, overrides: Record<string, unknown> = {}): Promise<any> {
    const result = await api('POST', `/husariada/quizzes/${quizId}/questions`, { ...QUESTION, ...overrides });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body.question;
}

async function markBotOnline(): Promise<void> {
    await husariadaStore.setMeta('engine_heartbeat_at', String(Date.now()));
}

beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '32mb' }));
    app.use((req: Request, _res: Response, next: NextFunction) => {
        (req as unknown as { session: unknown }).session = {
            user: sessionUserId ? { id: sessionUserId, username: 'tester' } : undefined,
        };
        next();
    });
    app.use('/api', husariadaRouter);
    await new Promise<void>((resolve) => {
        server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
    process.env.OWNER_ID = OWNER;
    process.env.GUILD_ID = '999999999999999999';
    process.env.HUSARIADA_CHANNEL_ID = '444444444444444444';
    imagesDir = await mkdtemp(join(tmpdir(), 'husariada-api-'));
    process.env.HUSARIADA_IMAGES_DIR = imagesDir;
    permissionStore = await createPermissionStore(':memory:');
    await permissionStore.setSections(STAFF, ['husariada'], OWNER);
    husariadaStore = await createHusariadaStore(':memory:');

    return async () => {
        await husariadaStore.close();
        await rm(imagesDir, { recursive: true, force: true });
    };
});

describe('dostep', () => {
    it('wymaga sekcji husariada', async () => {
        expect((await api('GET', '/husariada/quizzes', undefined, OUTSIDER)).status).toBe(403);
        expect((await api('GET', '/husariada/quizzes', undefined, '')).status).toBe(401);
        expect((await api('GET', '/husariada/quizzes', undefined, OWNER)).status).toBe(200);
    });
});

describe('quizy i pytania', () => {
    it('tworzy quiz, dodaje pytania i zwraca je w kolejnosci', async () => {
        const quiz = await createQuiz();
        await addQuestion(quiz.id);
        await addQuestion(quiz.id, { prompt: 'Drugie' });

        const result = await api('GET', `/husariada/quizzes/${quiz.id}`);
        expect(result.status).toBe(200);
        expect(result.body.questions.map((question: { prompt: string }) => question.prompt)).toEqual([QUESTION.prompt, 'Drugie']);
        expect(result.body.locked).toBe(false);
    });

    it('waliduje pytanie', async () => {
        const quiz = await createQuiz();
        const bad = [
            { ...QUESTION, answers: ['A', 'B', 'C'] },
            { ...QUESTION, answers: ['A', '', 'C', 'D'] },
            { ...QUESTION, correctIndex: 4 },
            { ...QUESTION, prompt: '' },
            { ...QUESTION, extra: true },
        ];
        for (const body of bad) {
            expect((await api('POST', `/husariada/quizzes/${quiz.id}/questions`, body)).status).toBe(400);
        }
    });

    it('zapisuje obrazek, serwuje go i usuwa przy podmianie', async () => {
        const quiz = await createQuiz();
        const question = await addQuestion(quiz.id, { image: PNG_UPLOAD });
        expect(question.imageUrl).toBe(`/api/husariada/questions/${question.id}/image`);
        expect(await readdir(imagesDir)).toHaveLength(1);

        const image = await api('GET', `/husariada/questions/${question.id}/image`);
        expect(image.status).toBe(200);
        expect(Buffer.compare(image.body, PNG)).toBe(0);

        const cleared = await api('PATCH', `/husariada/questions/${question.id}`, { image: null });
        expect(cleared.body.question.imageUrl).toBeNull();
        expect(await readdir(imagesDir)).toHaveLength(0);
    });

    it('odrzuca plik, ktory nie jest obrazem', async () => {
        const quiz = await createQuiz();
        const result = await api('POST', `/husariada/quizzes/${quiz.id}/questions`, {
            ...QUESTION, image: { mimeType: 'image/png', dataBase64: Buffer.from('<svg/>').toString('base64') },
        });
        expect(result.status).toBe(400);
        expect(await readdir(imagesDir)).toHaveLength(0);
    });

    it('zmienia kolejnosc i usuwa pytanie oraz quiz', async () => {
        const quiz = await createQuiz();
        const first = await addQuestion(quiz.id);
        const second = await addQuestion(quiz.id, { prompt: 'Drugie', image: PNG_UPLOAD });

        const reordered = await api('POST', `/husariada/quizzes/${quiz.id}/reorder`, { questionIds: [second.id, first.id] });
        expect(reordered.body.questions.map((question: { id: string }) => question.id)).toEqual([second.id, first.id]);

        expect((await api('DELETE', `/husariada/questions/${first.id}`)).status).toBe(200);
        expect((await api('DELETE', `/husariada/quizzes/${quiz.id}`)).status).toBe(200);
        expect(await readdir(imagesDir)).toHaveLength(0);
        expect((await api('GET', `/husariada/quizzes/${quiz.id}`)).status).toBe(404);
    });
});

describe('ustawienia', () => {
    it('zapisuje w granicach i kolejkuje odswiezenie lobby', async () => {
        const result = await api('PUT', '/husariada/settings', { timeLimitSec: 20, maxPoints: 1000 });
        expect(result.status).toBe(200);
        expect(result.body.settings).toMatchObject({ timeLimitSec: 20, maxPoints: 1000 });
        expect((await husariadaStore.claimPendingCommands()).map((command) => command.type)).toEqual(['refresh_lobby']);

        expect((await api('PUT', '/husariada/settings', { timeLimitSec: 1 })).status).toBe(400);
    });
});

describe('eventy', () => {
    it('nie startuje, gdy bot jest offline', async () => {
        const quiz = await createQuiz();
        await addQuestion(quiz.id);
        const result = await api('POST', '/husariada/events', { quizId: quiz.id });
        expect(result.status).toBe(409);
        expect(result.body.error).toContain('Bot');
    });

    it('nie startuje pustego quizu ani bez kanalu', async () => {
        await markBotOnline();
        const quiz = await createQuiz();
        expect((await api('POST', '/husariada/events', { quizId: quiz.id })).status).toBe(409);

        await addQuestion(quiz.id);
        delete process.env.HUSARIADA_CHANNEL_ID;
        expect((await api('POST', '/husariada/events', { quizId: quiz.id })).status).toBe(409);
    });

    it('startuje event, blokuje edycje quizu i przyjmuje polecenia', async () => {
        await markBotOnline();
        const quiz = await createQuiz();
        const question = await addQuestion(quiz.id);
        await addQuestion(quiz.id, { prompt: 'Drugie' });

        const started = await api('POST', '/husariada/events', { quizId: quiz.id, questionCount: 1 });
        expect(started.status, JSON.stringify(started.body)).toBe(201);
        expect(started.body.event).toMatchObject({ status: 'pending', questionCount: 1 });
        const eventId = started.body.event.id;

        expect((await api('POST', '/husariada/events', { quizId: quiz.id })).status).toBe(409);
        expect((await api('PATCH', `/husariada/questions/${question.id}`, { prompt: 'X' })).status).toBe(409);
        expect((await api('DELETE', `/husariada/quizzes/${quiz.id}`)).status).toBe(409);

        expect((await api('POST', `/husariada/events/${eventId}/commands`, { type: 'pause' })).status).toBe(202);
        expect((await api('POST', `/husariada/events/${eventId}/commands`, { type: 'explode' })).status).toBe(400);

        const state = await api('GET', '/husariada/state');
        expect(state.body.event.id).toBe(eventId);
        expect(state.body.bot.online).toBe(true);
        expect(state.body.recentCommands.map((command: { type: string }) => command.type)).toEqual(['pause', 'start']);

        const history = await api('GET', '/husariada/events');
        expect(history.body.events).toHaveLength(1);
        expect((await api('GET', `/husariada/events/${eventId}`)).body.standings).toEqual([]);
    });

    it('nie przyjmuje polecen dla zakonczonego eventu', async () => {
        const result = await api('POST', '/husariada/events/0f8fad5b-d9cb-469f-a165-70867728950e/commands', { type: 'stop' });
        expect(result.status).toBe(409);
    });
});

describe('pickQuestionOrder', () => {
    it('bez tasowania zachowuje kolejnosc i przycina', () => {
        expect(pickQuestionOrder(['a', 'b', 'c'], false, 2)).toEqual(['a', 'b']);
    });

    it('tasuje deterministycznie z podanym RNG', () => {
        expect(pickQuestionOrder(['a', 'b', 'c'], true, null, () => 0)).toEqual(['b', 'c', 'a']);
    });
});
