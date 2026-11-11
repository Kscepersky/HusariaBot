import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTaskStore, type TaskStore } from './task-store.js';
import type { NewAttachmentRecord, NewTaskInput } from './types.js';

const CREATOR = '100000000000000001';
const ASSIGNEE = '100000000000000002';
const OTHER = '100000000000000003';

let store: TaskStore;

function input(overrides: Partial<NewTaskInput> = {}): NewTaskInput {
    return {
        title: 'Przygotuj grafike',
        description: 'Na mecz w piatek',
        priority: 'normal',
        assigneeId: ASSIGNEE,
        dueAt: null,
        creatorId: CREATOR,
        ...overrides,
    };
}

function attachment(kind: NewAttachmentRecord['kind'], index = 0): NewAttachmentRecord {
    return {
        id: `00000000-0000-4000-8000-00000000000${index}`,
        kind,
        storedName: `00000000-0000-4000-8000-00000000000${index}.png`,
        mimeType: 'image/png',
        sizeBytes: 123,
    };
}

beforeEach(async () => {
    store = await createTaskStore(':memory:');
});

afterEach(async () => {
    await store.close();
});

describe('createTask', () => {
    it('zapisuje otwarty task z zalacznikami i zdarzeniem created', async () => {
        const task = await store.createTask(input(), [attachment('description')]);

        expect(task.status).toBe('open');
        expect(task.assigneeId).toBe(ASSIGNEE);
        expect(task.attachments).toHaveLength(1);
        expect(task.attachments[0]?.uploadedBy).toBe(CREATOR);

        const events = await store.listEvents(task.id);
        expect(events.map((event) => event.type)).toEqual(['created']);
    });

    it('odrzuca niepoprawne ID autora i osoby przypisanej', async () => {
        await expect(store.createTask(input({ creatorId: 'abc' }), [])).rejects.toThrow();
        await expect(store.createTask(input({ assigneeId: 'abc' }), [])).rejects.toThrow();
    });

    it('przyjmuje task dla wszystkich (assigneeId = null)', async () => {
        const task = await store.createTask(input({ assigneeId: null }), []);
        expect(task.assigneeId).toBeNull();
    });
});

describe('listy otwartych taskow', () => {
    it('sortuje wg priorytetu, potem terminu', async () => {
        await store.createTask(input({ title: 'niski', priority: 'low' }), []);
        await store.createTask(input({ title: 'normalny bez terminu', priority: 'normal' }), []);
        await store.createTask(input({ title: 'normalny z terminem', priority: 'normal', dueAt: Date.now() + 1000 }), []);
        await store.createTask(input({ title: 'wysoki', priority: 'high' }), []);

        const titles = (await store.listOpenTasks()).map((task) => task.title);
        expect(titles).toEqual(['wysoki', 'normalny z terminem', 'normalny bez terminu', 'niski']);
    });

    it('listOpenTasksForUser zwraca taski uzytkownika i dla wszystkich', async () => {
        await store.createTask(input({ title: 'moj' }), []);
        await store.createTask(input({ title: 'wszyscy', assigneeId: null }), []);
        await store.createTask(input({ title: 'cudzy', assigneeId: OTHER }), []);
        const done = await store.createTask(input({ title: 'zrobiony' }), []);
        await store.completeTask(done.id, ASSIGNEE, 'gotowe', []);

        const titles = (await store.listOpenTasksForUser(ASSIGNEE)).map((task) => task.title).sort();
        expect(titles).toEqual(['moj', 'wszyscy']);
    });
});

describe('updateTask', () => {
    it('zapisuje zmiany i zdarzenie edited z diffem', async () => {
        const task = await store.createTask(input(), []);
        const result = await store.updateTask(task.id, { title: 'Nowy tytul', assigneeId: OTHER }, CREATOR);

        expect(result?.after.title).toBe('Nowy tytul');
        expect(result?.before.assigneeId).toBe(ASSIGNEE);
        expect((await store.getTask(task.id))?.assigneeId).toBe(OTHER);

        const edited = (await store.listEvents(task.id)).find((event) => event.type === 'edited');
        expect(edited?.changes).toEqual({
            title: { before: 'Przygotuj grafike', after: 'Nowy tytul' },
            assigneeId: { before: ASSIGNEE, after: OTHER },
        });
    });

    it('nie zapisuje zdarzenia, gdy nic sie nie zmienilo', async () => {
        const task = await store.createTask(input(), []);
        await store.updateTask(task.id, { title: task.title }, CREATOR);
        expect((await store.listEvents(task.id)).map((event) => event.type)).toEqual(['created']);
    });

    it('nie edytuje zamknietego taska', async () => {
        const task = await store.createTask(input(), []);
        await store.completeTask(task.id, ASSIGNEE, 'gotowe', []);
        expect(await store.updateTask(task.id, { title: 'x' }, CREATOR)).toBeNull();
    });
});

describe('completeTask', () => {
    it('zamyka task z notatka i zalacznikami', async () => {
        const task = await store.createTask(input(), [attachment('description', 1)]);
        const done = await store.completeTask(task.id, ASSIGNEE, 'Zrobione', [attachment('completion', 2)]);

        expect(done?.status).toBe('done');
        expect(done?.completedBy).toBe(ASSIGNEE);
        expect(done?.completionNote).toBe('Zrobione');
        expect(done?.attachments.map((item) => item.kind)).toEqual(['description', 'completion']);
    });

    it('jest atomowe - rownolegle zamkniecia daja jeden sukces', async () => {
        const task = await store.createTask(input(), []);
        const results = await Promise.all([
            store.completeTask(task.id, ASSIGNEE, 'raz', []),
            store.completeTask(task.id, OTHER, 'dwa', []),
        ]);

        expect(results.filter(Boolean)).toHaveLength(1);
        const completedEvents = (await store.listEvents(task.id)).filter((event) => event.type === 'completed');
        expect(completedEvents).toHaveLength(1);
    });

    it('zwraca null dla nieistniejacego taska', async () => {
        expect(await store.completeTask('00000000-0000-4000-8000-000000000999', ASSIGNEE, 'x', [])).toBeNull();
    });
});

describe('deleteTask', () => {
    it('robi soft-delete i zachowuje historie', async () => {
        const task = await store.createTask(input(), []);
        const deleted = await store.deleteTask(task.id, CREATOR);

        expect(deleted?.status).toBe('deleted');
        expect(deleted?.deletedBy).toBe(CREATOR);
        expect(await store.listOpenTasks()).toEqual([]);
        expect((await store.listEvents(task.id)).map((event) => event.type)).toEqual(['created', 'deleted']);
    });

    it('nie usuwa dwa razy', async () => {
        const task = await store.createTask(input(), []);
        await store.deleteTask(task.id, CREATOR);
        expect(await store.deleteTask(task.id, CREATOR)).toBeNull();
    });
});

describe('listTasks (historia)', () => {
    it('filtruje po statusie, osobie i tekscie oraz stronicuje', async () => {
        for (let index = 0; index < 5; index += 1) {
            const task = await store.createTask(input({ title: `Task ${index}` }), []);
            await store.completeTask(task.id, ASSIGNEE, 'ok', []);
        }
        const forAll = await store.createTask(input({ title: 'Dla wszystkich', assigneeId: null }), []);
        await store.completeTask(forAll.id, OTHER, 'ok', []);
        const removed = await store.createTask(input({ title: 'Usuniety' }), []);
        await store.deleteTask(removed.id, CREATOR);

        const donePage = await store.listTasks({ statuses: ['done'], page: 1, pageSize: 4 });
        expect(donePage.total).toBe(6);
        expect(donePage.totalPages).toBe(2);
        expect(donePage.tasks).toHaveLength(4);

        const forAllPage = await store.listTasks({ statuses: ['done'], assigneeId: null, page: 1, pageSize: 10 });
        expect(forAllPage.tasks.map((task) => task.title)).toEqual(['Dla wszystkich']);

        const searched = await store.listTasks({ statuses: ['done', 'deleted'], search: 'usun', page: 1, pageSize: 10 });
        expect(searched.tasks.map((task) => task.title)).toEqual(['Usuniety']);
    });

    it('traktuje znaki LIKE w wyszukiwaniu doslownie', async () => {
        await store.createTask(input({ title: '100% gotowe' }), []);
        await store.createTask(input({ title: '100 sztuk' }), []);

        const page = await store.listTasks({ statuses: ['open'], search: '100%', page: 1, pageSize: 10 });
        expect(page.tasks.map((task) => task.title)).toEqual(['100% gotowe']);
    });

    it('pusta lista statusow nic nie zwraca', async () => {
        await store.createTask(input(), []);
        expect((await store.listTasks({ statuses: [], page: 1, pageSize: 10 })).tasks).toEqual([]);
    });
});

describe('getAttachment i ustawienia', () => {
    it('zwraca zalacznik ze statusem taska', async () => {
        const task = await store.createTask(input(), [attachment('description', 3)]);
        await store.deleteTask(task.id, CREATOR);

        const found = await store.getAttachment(task.attachments[0]!.id);
        expect(found?.taskStatus).toBe('deleted');
        expect(await store.getAttachment('nie-ma')).toBeNull();
    });

    it('zapisuje i czysci ustawienia boardu', async () => {
        await store.setSetting('board_message_id', '123');
        expect(await store.getSetting('board_message_id')).toBe('123');
        await store.setSetting('board_message_id', null);
        expect(await store.getSetting('board_message_id')).toBeNull();
    });
});
