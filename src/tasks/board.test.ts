import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscordRequestError } from '../dashboard/discord-api.js';
import { buildTaskBoardPayload, createTaskBoard, type TaskBoardDeps } from './board.js';
import { escapeDiscordInline, formatTaskLine } from './format.js';
import { createTaskStore, type TaskStore } from './task-store.js';
import type { Task } from './types.js';

const CHANNEL = '200000000000000001';
const USER_A = '100000000000000001';
const USER_B = '100000000000000002';

function task(overrides: Partial<Task> = {}): Task {
    return {
        id: 'id',
        title: 'Task',
        description: '',
        priority: 'normal',
        status: 'open',
        creatorId: USER_A,
        assigneeId: USER_A,
        dueAt: null,
        createdAt: 0,
        updatedAt: 0,
        completedBy: null,
        completedAt: null,
        completionNote: null,
        deletedBy: null,
        deletedAt: null,
        attachments: [],
        ...overrides,
    };
}

function embedOf(payload: ReturnType<typeof buildTaskBoardPayload>): { description: string; color: number; footer: { text: string } } {
    return payload.embeds![0] as { description: string; color: number; footer: { text: string } };
}

describe('format', () => {
    it('neutralizuje markdown i wzmianki w tytule', () => {
        const escaped = escapeDiscordInline('@everyone **pilne** <@123> [link](http://x)');
        expect(escaped).not.toContain('@everyone');
        expect(escaped).not.toContain('<@123>');
        expect(escaped).toContain('\\*\\*pilne\\*\\*');
        expect(escaped).toContain('\\[link\\]\\(http:');
        expect(escaped).not.toContain('http://');
    });

    it('nie pozwala, by adres w tytule stal sie linkiem', () => {
        expect(escapeDiscordInline('zobacz https://evil.example')).not.toContain('https://');
    });

    it('sklada tytul w jedna linie i przycina', () => {
        expect(escapeDiscordInline('a\n\nb', 100)).toBe('a b');
        expect(escapeDiscordInline('x'.repeat(200)).length).toBe(100);
    });

    it('oznacza task po terminie', () => {
        const line = formatTaskLine(task({ priority: 'high', dueAt: 1_000 }), 5_000);
        expect(line).toContain('🔴');
        expect(line).toContain('po terminie');
        expect(line).toContain('<t:1:R>');
    });
});

describe('buildTaskBoardPayload', () => {
    it('pokazuje pusty stan na zielono', () => {
        const embed = embedOf(buildTaskBoardPayload([], 0));
        expect(embed.description).toContain('Brak otwartych tasków');
    });

    it('grupuje po osobie, "Wszyscy" na gorze, i nie pinguje nikogo', () => {
        const payload = buildTaskBoardPayload([
            task({ title: 'A1', assigneeId: USER_A }),
            task({ title: 'B1', assigneeId: USER_B }),
            task({ title: 'All1', assigneeId: null }),
        ], 0);
        const description = embedOf(payload).description;

        expect(description.indexOf('Wszyscy')).toBeLessThan(description.indexOf(`<@${USER_A}>`));
        expect(description.indexOf(`<@${USER_A}>`)).toBeLessThan(description.indexOf(`<@${USER_B}>`));
        expect(payload.allowed_mentions).toEqual({ parse: [] });
        expect(embedOf(payload).footer.text).toContain('Otwarte: 3');
    });

    it('nie przekracza limitu opisu i informuje o ukrytych taskach', () => {
        const many = Array.from({ length: 200 }, (_, index) => task({ id: String(index), title: `Bardzo dlugi tytul taska numer ${index} `.repeat(3) }));
        const description = embedOf(buildTaskBoardPayload(many, 0)).description;

        expect(description.length).toBeLessThanOrEqual(4096);
        expect(description).toMatch(/i jeszcze \*\*\d+\*\* tasków/);
    });
});

describe('createTaskBoard', () => {
    let store: TaskStore;
    let deps: TaskBoardDeps & { send: ReturnType<typeof vi.fn>; edit: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        store = await createTaskStore(':memory:');
        deps = {
            getStore: async () => store,
            send: vi.fn(async () => '300000000000000001'),
            edit: vi.fn(async () => undefined),
        };
    });

    afterEach(async () => {
        vi.useRealTimers();
        await store.close();
    });

    it('przy pierwszym odswiezeniu wysyla wiadomosc i zapamietuje jej ID', async () => {
        await createTaskBoard(deps, { channelId: CHANNEL }).refreshNow();

        expect(deps.send).toHaveBeenCalledTimes(1);
        expect(await store.getSetting('board_message_id')).toBe('300000000000000001');
        expect(await store.getSetting('board_channel_id')).toBe(CHANNEL);
    });

    it('kolejne odswiezenie edytuje istniejaca wiadomosc', async () => {
        const board = createTaskBoard(deps, { channelId: CHANNEL });
        await board.refreshNow();
        await board.refreshNow();

        expect(deps.send).toHaveBeenCalledTimes(1);
        expect(deps.edit).toHaveBeenCalledWith(CHANNEL, '300000000000000001', expect.any(Object));
    });

    it('odtwarza wiadomosc, gdy ktos ja usunal (404)', async () => {
        await store.setSetting('board_message_id', '300000000000000009');
        await store.setSetting('board_channel_id', CHANNEL);
        deps.edit.mockRejectedValueOnce(new DiscordRequestError('edit message', 404, {}));

        await createTaskBoard(deps, { channelId: CHANNEL }).refreshNow();

        expect(deps.send).toHaveBeenCalledTimes(1);
        expect(await store.getSetting('board_message_id')).toBe('300000000000000001');
    });

    it('przy zmianie kanalu tworzy nowa wiadomosc', async () => {
        await store.setSetting('board_message_id', '300000000000000009');
        await store.setSetting('board_channel_id', '200000000000000099');

        await createTaskBoard(deps, { channelId: CHANNEL }).refreshNow();

        expect(deps.edit).not.toHaveBeenCalled();
        expect(deps.send).toHaveBeenCalledTimes(1);
    });

    it('inny blad edycji nie tworzy duplikatu wiadomosci', async () => {
        await store.setSetting('board_message_id', '300000000000000009');
        await store.setSetting('board_channel_id', CHANNEL);
        deps.edit.mockRejectedValueOnce(new DiscordRequestError('edit message', 500, {}));

        await createTaskBoard(deps, { channelId: CHANNEL }).refreshNow();

        expect(deps.send).not.toHaveBeenCalled();
    });

    it('debounce laczy serie zmian w jedno odswiezenie', async () => {
        vi.useFakeTimers();
        const board = createTaskBoard(deps, { channelId: CHANNEL, debounceMs: 1_000 });

        board.requestRefresh();
        board.requestRefresh();
        board.requestRefresh();
        await vi.advanceTimersByTimeAsync(1_000);
        await vi.waitFor(() => expect(deps.send).toHaveBeenCalledTimes(1));
    });

    describe('tryb z obrazkiem', () => {
        const image = { data: Buffer.from([1, 2, 3]), altText: 'alt tekst' };

        function imageDeps(render: TaskBoardDeps['render']) {
            return {
                ...deps,
                render,
                sendWithFile: vi.fn(async () => '300000000000000002'),
                editWithFile: vi.fn(async () => undefined),
            };
        }

        it('wysyla karte jako plik z alt-textem, bez opisow', async () => {
            await store.createTask({ title: 'Wazny', description: 'TAJNY OPIS', priority: 'high', assigneeId: USER_A, dueAt: null, creatorId: USER_A }, []);
            const withImage = imageDeps(vi.fn(async () => image));

            await createTaskBoard(withImage, { channelId: CHANNEL }).refreshNow();

            expect(withImage.send).not.toHaveBeenCalled();
            const [, payload, file] = withImage.sendWithFile.mock.calls[0] as unknown as [string, any, { filename: string; contentType: string }];
            expect(file.filename).toBe('taski.png');
            expect(file.contentType).toBe('image/png');
            expect(payload.embeds[0].image.url).toBe('attachment://taski.png');
            expect(payload.attachments).toEqual([{ id: 0, description: 'alt tekst' }]);
            expect(JSON.stringify(payload)).not.toContain('TAJNY OPIS');
            expect(await store.getSetting('board_message_id')).toBe('300000000000000002');
        });

        it('kolejne odswiezenie edytuje wiadomosc z nowym plikiem', async () => {
            const withImage = imageDeps(vi.fn(async () => image));
            const board = createTaskBoard(withImage, { channelId: CHANNEL });
            await board.refreshNow();
            await board.refreshNow();

            expect(withImage.sendWithFile).toHaveBeenCalledTimes(1);
            expect(withImage.editWithFile).toHaveBeenCalledWith(CHANNEL, '300000000000000002', expect.any(Object), expect.objectContaining({ filename: 'taski.png' }));
        });

        it('gdy render sie wywroci, publikuje wersje tekstowa i zdejmuje stary obrazek', async () => {
            const withImage = imageDeps(vi.fn(async () => { throw new Error('canvas padl'); }));

            await createTaskBoard(withImage, { channelId: CHANNEL }).refreshNow();

            expect(withImage.sendWithFile).not.toHaveBeenCalled();
            const payload = withImage.send.mock.calls[0]![1];
            expect(payload.embeds![0]).toHaveProperty('description');
            expect(payload.attachments).toEqual([]);
        });
    });

    it('bez kanalu nic nie robi', async () => {
        const board = createTaskBoard(deps, { channelId: null });
        await board.refreshNow();
        board.requestRefresh();
        board.start();

        expect(deps.send).not.toHaveBeenCalled();
    });
});
