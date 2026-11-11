import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPermissionStore, type PermissionStore } from '../../permissions/permission-store.js';
import { createTaskStore, type TaskStore } from '../../tasks/task-store.js';

let permissionStore: PermissionStore;
let taskStore: TaskStore;

vi.mock('../../permissions/permission-store.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../permissions/permission-store.js')>()),
    getPermissionStore: vi.fn(async () => permissionStore),
}));

vi.mock('../../tasks/task-store.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../tasks/task-store.js')>()),
    getTaskStore: vi.fn(async () => taskStore),
}));

const sendDirectMessage = vi.fn(async () => undefined);
vi.mock('../discord-api.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../discord-api.js')>()),
    getGuildMember: vi.fn(async () => ({ roles: [], user: { id: '1' } })),
    getDiscordUserById: vi.fn(async () => null),
    sendDirectMessage: (...args: unknown[]) => sendDirectMessage(...(args as [])),
}));

const requestTaskBoardRefresh = vi.fn();
vi.mock('../../tasks/board.js', () => ({
    requestTaskBoardRefresh: () => requestTaskBoardRefresh(),
}));

import { tasksRouter } from './api.tasks.js';

const OWNER = '111111111111111111';
const STAFF_A = '222222222222222222';
const STAFF_B = '444444444444444444';
const OUTSIDER = '333333333333333333';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PNG_UPLOAD = { mimeType: 'image/png', dataBase64: `data:image/png;base64,${PNG.toString('base64')}` };

let server: Server;
let baseUrl: string;
let sessionUserId: string | undefined;
let attachmentsDir: string;

interface ApiResult {
    status: number;
    body: any;
    headers: Headers;
}

async function api(method: string, path: string, body?: unknown, as?: string): Promise<ApiResult> {
    sessionUserId = as;
    const response = await fetch(`${baseUrl}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const isJson = response.headers.get('content-type')?.includes('application/json');
    return { status: response.status, body: isJson ? await response.json() : Buffer.from(await response.arrayBuffer()), headers: response.headers };
}

async function createTask(as: string, overrides: Record<string, unknown> = {}): Promise<any> {
    const result = await api('POST', '/tasks', { title: 'Grafika na mecz', description: 'Opis', assigneeId: STAFF_B, ...overrides }, as);
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body.task;
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
    app.use('/api', tasksRouter);

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
    process.env.DASHBOARD_BASE_URL = 'https://husariabot.dev';
    attachmentsDir = await mkdtemp(join(tmpdir(), 'tasks-api-'));
    process.env.TASKS_ATTACHMENTS_DIR = attachmentsDir;

    permissionStore = await createPermissionStore(':memory:');
    await permissionStore.setSections(STAFF_A, ['shop'], OWNER);
    await permissionStore.setSections(STAFF_B, ['events'], OWNER);
    taskStore = await createTaskStore(':memory:');
    sendDirectMessage.mockClear();
    requestTaskBoardRefresh.mockClear();

    return async () => {
        await taskStore.close();
        await rm(attachmentsDir, { recursive: true, force: true });
    };
});

describe('dostep', () => {
    it('odrzuca uzytkownika bez dostepu do dashboardu', async () => {
        expect((await api('GET', '/tasks', undefined, OUTSIDER)).status).toBe(403);
        expect((await api('POST', '/tasks', { title: 'x', assigneeId: null }, OUTSIDER)).status).toBe(403);
    });

    it('odrzuca niezalogowanego', async () => {
        expect((await api('GET', '/tasks/meta')).status).toBe(401);
    });

    it('meta zwraca ownera i staff jako mozliwych wykonawcow', async () => {
        const result = await api('GET', '/tasks/meta', undefined, STAFF_A);
        expect(result.status).toBe(200);
        expect(result.body.me).toEqual({ id: STAFF_A, isOwner: false });
        expect(result.body.assignees.map((user: { id: string }) => user.id).sort()).toEqual([OWNER, STAFF_A, STAFF_B].sort());
    });
});

describe('tworzenie', () => {
    it('tworzy task, wysyla DM do przypisanego i odswieza board', async () => {
        const task = await createTask(STAFF_A);

        expect(task.creatorId).toBe(STAFF_A);
        expect(task.permissions).toEqual({ canEdit: true, canDelete: true, canComplete: false });
        await vi.waitFor(() => expect(sendDirectMessage).toHaveBeenCalledTimes(1));
        expect((sendDirectMessage.mock.calls[0] as unknown[])[0]).toBe(STAFF_B);
        expect(String((sendDirectMessage.mock.calls[0] as unknown[])[1])).toContain(`/#tasks/${task.id}`);
        expect(requestTaskBoardRefresh).toHaveBeenCalled();
    });

    it('task dla wszystkich wysyla DM do wszystkich poza autorem', async () => {
        await createTask(STAFF_A, { assigneeId: null });
        await vi.waitFor(() => expect(sendDirectMessage).toHaveBeenCalledTimes(2));
        const recipients = sendDirectMessage.mock.calls.map((call) => (call as unknown[])[0]).sort();
        expect(recipients).toEqual([OWNER, STAFF_B].sort());
    });

    it('odrzuca przypisanie osobie bez dostepu, nieznane pola i zly termin', async () => {
        expect((await api('POST', '/tasks', { title: 'x', assigneeId: OUTSIDER }, STAFF_A)).status).toBe(400);
        expect((await api('POST', '/tasks', { title: 'x', assigneeId: null, creatorId: OWNER }, STAFF_A)).status).toBe(400);
        expect((await api('POST', '/tasks', { title: '   ', assigneeId: null }, STAFF_A)).status).toBe(400);
        expect((await api('POST', '/tasks', { title: 'x', assigneeId: null, dueAt: 1 }, STAFF_A)).status).toBe(400);
        expect((await api('POST', '/tasks', { title: 'x', assigneeId: null, priority: 'urgent' }, STAFF_A)).status).toBe(400);
    });
});

describe('edycja i usuwanie', () => {
    it('edytowac moze autor i owner, ale nie przypisana osoba', async () => {
        const task = await createTask(STAFF_A);

        expect((await api('PATCH', `/tasks/${task.id}`, { title: 'Nowy' }, STAFF_B)).status).toBe(403);
        expect((await api('PATCH', `/tasks/${task.id}`, { title: 'Nowy' }, STAFF_A)).status).toBe(200);
        expect((await api('PATCH', `/tasks/${task.id}`, { priority: 'high' }, OWNER)).body.task.priority).toBe('high');
    });

    it('przeterminowany task da sie edytowac bez zmiany terminu', async () => {
        const task = await createTask(STAFF_A);
        const longOverdue = Date.now() - 3 * 24 * 60 * 60 * 1000;
        await taskStore.updateTask(task.id, { dueAt: longOverdue }, STAFF_A);

        const result = await api('PATCH', `/tasks/${task.id}`, { priority: 'high', dueAt: longOverdue }, STAFF_A);
        expect(result.status, JSON.stringify(result.body)).toBe(200);
        expect((await api('PATCH', `/tasks/${task.id}`, { dueAt: longOverdue - 1000 }, STAFF_A)).status).toBe(400);
    });

    it('task osoby, ktora stracila dostep, da sie edytowac bez przepinania', async () => {
        const task = await createTask(STAFF_A);
        await permissionStore.setSections(STAFF_B, [], OWNER);

        const result = await api('PATCH', `/tasks/${task.id}`, { title: 'Inny', assigneeId: STAFF_B }, STAFF_A);
        expect(result.status).toBe(200);
        expect(result.body.task.assigneeId).toBe(STAFF_B);
        expect((await api('PATCH', `/tasks/${task.id}`, { assigneeId: OUTSIDER }, STAFF_A)).status).toBe(400);
    });

    it('zmiana osoby wysyla DM nowej osobie', async () => {
        const task = await createTask(STAFF_A);
        await vi.waitFor(() => expect(sendDirectMessage).toHaveBeenCalledTimes(1));

        await api('PATCH', `/tasks/${task.id}`, { assigneeId: OWNER }, STAFF_A);
        await vi.waitFor(() => expect(sendDirectMessage).toHaveBeenCalledTimes(2));
        expect((sendDirectMessage.mock.calls[1] as unknown[])[0]).toBe(OWNER);
    });

    it('usuniety task widzi tylko owner (soft-delete)', async () => {
        const task = await createTask(STAFF_A);

        expect((await api('DELETE', `/tasks/${task.id}`, undefined, STAFF_B)).status).toBe(403);
        expect((await api('DELETE', `/tasks/${task.id}`, undefined, STAFF_A)).status).toBe(200);
        expect((await api('GET', `/tasks/${task.id}`, undefined, STAFF_A)).status).toBe(404);
        expect((await api('GET', `/tasks/${task.id}`, undefined, OWNER)).body.task.status).toBe('deleted');

        const staffHistory = await api('GET', '/tasks?scope=history&status=deleted', undefined, STAFF_A);
        expect(staffHistory.body.tasks).toEqual([]);
        const ownerHistory = await api('GET', '/tasks?scope=history&status=deleted', undefined, OWNER);
        expect(ownerHistory.body.tasks).toHaveLength(1);
    });
});

describe('ukonczenie', () => {
    it('wymaga notatki i moze to zrobic tylko przypisana osoba (lub owner)', async () => {
        const task = await createTask(STAFF_A);

        expect((await api('POST', `/tasks/${task.id}/complete`, { note: 'Zrobione' }, STAFF_A)).status).toBe(403);
        expect((await api('POST', `/tasks/${task.id}/complete`, { note: 'x' }, STAFF_B)).status).toBe(400);

        const done = await api('POST', `/tasks/${task.id}/complete`, { note: 'Grafika wrzucona' }, STAFF_B);
        expect(done.status).toBe(200);
        expect(done.body.task.status).toBe('done');
        expect(done.body.task.completionNote).toBe('Grafika wrzucona');

        expect((await api('POST', `/tasks/${task.id}/complete`, { note: 'drugi raz' }, OWNER)).status).toBe(409);
        expect((await api('PATCH', `/tasks/${task.id}`, { title: 'po fakcie' }, STAFF_A)).status).toBe(409);
    });

    it('task dla wszystkich moze ukonczyc kazdy z dostepem', async () => {
        const task = await createTask(STAFF_A, { assigneeId: null });
        expect((await api('POST', `/tasks/${task.id}/complete`, { note: 'Zrobione' }, STAFF_B)).status).toBe(200);
    });

    it('listy: moje, otwarte i historia', async () => {
        await createTask(STAFF_A);
        await createTask(STAFF_A, { assigneeId: null });
        const forOwner = await createTask(STAFF_A, { assigneeId: OWNER });
        await api('POST', `/tasks/${forOwner.id}/complete`, { note: 'Zrobione' }, OWNER);

        const mine = await api('GET', '/tasks?scope=mine', undefined, STAFF_B);
        expect(mine.body.tasks).toHaveLength(2);
        expect(mine.body.counts).toEqual({ mine: 2, open: 2, overdue: 0 });

        const history = await api('GET', '/tasks?scope=history', undefined, STAFF_B);
        expect(history.body.tasks.map((task: { id: string }) => task.id)).toEqual([forOwner.id]);
        expect(history.body.pagination.total).toBe(1);
    });
});

describe('zalaczniki', () => {
    it('zapisuje screenshot i serwuje go tylko przez API, bez ujawniania nazwy pliku', async () => {
        const task = await createTask(STAFF_A, { attachments: [PNG_UPLOAD] });
        expect(task.attachments).toHaveLength(1);
        expect(JSON.stringify(task)).not.toContain('storedName');

        const file = await api('GET', task.attachments[0].url.replace('/api', ''), undefined, STAFF_B);
        expect(file.status).toBe(200);
        expect(file.body).toEqual(PNG);
        expect(file.headers.get('content-type')).toBe('image/png');
        expect(file.headers.get('x-content-type-options')).toBe('nosniff');
        expect(file.headers.get('cache-control')).toContain('no-store');

        expect((await api('GET', task.attachments[0].url.replace('/api', ''))).status).toBe(401);
        expect((await api('GET', task.attachments[0].url.replace('/api', ''), undefined, OUTSIDER)).status).toBe(403);
    });

    it('odrzuca SVG i plik o zawartosci niezgodnej z typem', async () => {
        const svg = { mimeType: 'image/svg+xml', dataBase64: Buffer.from('<svg></svg>').toString('base64') };
        expect((await api('POST', '/tasks', { title: 'x', assigneeId: null, attachments: [svg] }, STAFF_A)).status).toBe(400);
        const fake = { mimeType: 'image/png', dataBase64: Buffer.from('<html>').toString('base64') };
        expect((await api('POST', '/tasks', { title: 'x', assigneeId: null, attachments: [fake] }, STAFF_A)).status).toBe(400);
    });

    it('zalacznik usunietego taska jest niedostepny dla staffu', async () => {
        const task = await createTask(STAFF_A, { attachments: [PNG_UPLOAD] });
        await api('DELETE', `/tasks/${task.id}`, undefined, STAFF_A);
        const path = task.attachments[0].url.replace('/api', '');

        expect((await api('GET', path, undefined, STAFF_A)).status).toBe(404);
        expect((await api('GET', path, undefined, OWNER)).status).toBe(200);
    });

    it('niepoprawne ID zwraca 404 bez dotykania dysku', async () => {
        expect((await api('GET', '/tasks/attachments/..%2F..%2Fetc%2Fpasswd', undefined, STAFF_A)).status).toBe(404);
        expect((await api('GET', '/tasks/nie-uuid', undefined, STAFF_A)).status).toBe(404);
    });
});
