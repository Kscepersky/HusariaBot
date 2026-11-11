import { describe, expect, it } from 'vitest';
import { buildBoardAltText, describeDue, planBoard, renderTaskBoardImage, stripEmoji } from './board-renderer.js';
import type { Task } from './types.js';

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const USER_A = '100000000000000001';
const USER_B = '100000000000000002';

function task(overrides: Partial<Task> = {}): Task {
    return {
        id: 'id',
        title: 'Task',
        description: 'TAJNY OPIS',
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

const USERS = { [USER_A]: { name: 'Kacper', avatarUrl: null }, [USER_B]: { name: 'Mod', avatarUrl: null } };

describe('planBoard', () => {
    it('grupuje po osobie i stawia "Wszyscy" na gorze', () => {
        const plan = planBoard([
            task({ assigneeId: USER_B }),
            task({ assigneeId: USER_A }),
            task({ assigneeId: null }),
        ]);

        expect(plan.groups.map((group) => group.assigneeId)).toEqual([null, USER_B, USER_A]);
        expect(plan.shown).toBe(3);
        expect(plan.hidden).toBe(0);
    });

    it('ucina liste do limitu wierszy i liczy ukryte', () => {
        const plan = planBoard(Array.from({ length: 40 }, (_, index) => task({ id: String(index) })));

        expect(plan.shown).toBe(18);
        expect(plan.hidden).toBe(22);
    });

    it('wysokosc rosnie wraz z liczba taskow', () => {
        const small = planBoard([task()]).height;
        const big = planBoard(Array.from({ length: 10 }, () => task())).height;
        expect(big).toBeGreaterThan(small);
    });
});

describe('stripEmoji', () => {
    it.each([
        ['🔥Kacper🔥', 'Kacper'],
        ['Kacper 🔥 Mod', 'Kacper Mod'],
        ['👨‍👩‍👧 Rodzina', 'Rodzina'],
        ['🇵🇱 Polska', 'Polska'],
        ['Ala👍🏽ma', 'Alama'],
        ['❤️ Serce ✨', 'Serce'],
        ['Zażółć gęślą jaźń 😀', 'Zażółć gęślą jaźń'],
        ['  Dużo   spacji  🎉 ', 'Dużo spacji'],
    ])('%s -> %s', (input, expected) => {
        expect(stripEmoji(input)).toBe(expected);
    });

    it('zostawia litery, cyfry i znaki specjalne, ktore nie sa emotkami', () => {
        expect(stripEmoji('Gracz_01 #7 *tag* (x) – ok')).toBe('Gracz_01 #7 *tag* (x) – ok');
        expect(stripEmoji('日本語 Привет')).toBe('日本語 Привет');
    });

    it('nick z samych emotek daje pusty tekst', () => {
        expect(stripEmoji('🔥🔥🔥')).toBe('');
    });
});

describe('emotki w nickach na karcie', () => {
    it('alt-text i naglowki uzywaja nicku bez emotek, a pusty nick ma awaryjna nazwe', () => {
        const users = {
            [USER_A]: { name: '🔥 Kacper 🔥', avatarUrl: null },
            [USER_B]: { name: '👑👑', avatarUrl: null },
        };
        const alt = buildBoardAltText([task({ assigneeId: USER_A }), task({ assigneeId: USER_B })], users, NOW);

        expect(alt).toContain('Kacper: Task');
        expect(alt).not.toContain('🔥');
        expect(alt).not.toContain('👑');
        expect(alt).toContain(`Użytkownik ${USER_B.slice(-4)}: Task`);
    });

    it('karta z nickami pelnymi emotek sie renderuje', async () => {
        const output = await renderTaskBoardImage({
            tasks: [task({ assigneeId: USER_A }), task({ assigneeId: USER_B })],
            users: {
                [USER_A]: { name: '🔥👨‍👩‍👧 Kacper 🇵🇱', avatarUrl: null },
                [USER_B]: { name: '👑', avatarUrl: null },
            },
            now: NOW,
            footerText: 'stopka',
        });
        expect(output.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    });
});

describe('describeDue', () => {
    it('opisuje brak terminu, przyszlosc i przeterminowanie', () => {
        expect(describeDue({ dueAt: null }, NOW)).toEqual({ text: 'bez terminu', overdue: false });
        expect(describeDue({ dueAt: NOW + 5 * DAY }, NOW).text).toMatch(/^za 5 d/);
        expect(describeDue({ dueAt: NOW + 3600_000 }, NOW).text).toMatch(/^dziś/);
        expect(describeDue({ dueAt: NOW - 3 * DAY }, NOW)).toEqual({ text: '3 d po terminie', overdue: true });
        expect(describeDue({ dueAt: NOW - 3600_000 }, NOW)).toEqual({ text: 'po terminie', overdue: true });
    });
});

describe('buildBoardAltText', () => {
    it('zawiera tytuly i osoby, ale nie opisy, i miesci sie w limicie Discorda', () => {
        const many = Array.from({ length: 80 }, (_, index) => task({ id: String(index), title: `Dluga nazwa taska numer ${index}` }));
        const alt = buildBoardAltText(many, USERS, NOW);

        expect(alt.length).toBeLessThanOrEqual(1024);
        expect(alt).toContain('Kacper: Dluga nazwa taska numer 0');
        expect(alt).not.toContain('TAJNY OPIS');
    });

    it('pusty stan', () => {
        expect(buildBoardAltText([], USERS, NOW)).toBe('Brak otwartych tasków.');
    });
});

describe('renderTaskBoardImage', () => {
    const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    it('zwraca poprawny PNG dla listy i dla pustego stanu', async () => {
        const withTasks = await renderTaskBoardImage({
            tasks: [task({ priority: 'high', dueAt: NOW - DAY }), task({ assigneeId: null, title: 'x'.repeat(300) })],
            users: USERS,
            now: NOW,
            footerText: 'stopka',
        });
        const empty = await renderTaskBoardImage({ tasks: [], users: USERS, now: NOW, footerText: 'stopka' });

        expect(withTasks.subarray(0, 8)).toEqual(PNG_SIGNATURE);
        expect(empty.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    });

    it('radzi sobie z nieznanym uzytkownikiem i bardzo dluga lista', async () => {
        const output = await renderTaskBoardImage({
            tasks: Array.from({ length: 60 }, (_, index) => task({ id: String(index), assigneeId: `1000000000000001${String(index % 10)}0` })),
            users: {},
            now: NOW,
            footerText: 'stopka',
        });
        expect(output.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    });
});
