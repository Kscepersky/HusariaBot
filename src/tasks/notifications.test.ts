import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscordRequestError } from '../dashboard/discord-api.js';
import { DM_LIMIT_PER_PAIR, buildAssignmentDm, notifyTaskAssigned, resetDmLimitsForTests } from './notifications.js';

beforeEach(() => {
    resetDmLimitsForTests();
});
import type { Task } from './types.js';

const ACTOR = '100000000000000001';
const USER_B = '100000000000000002';
const USER_C = '100000000000000003';
const TASK_ID = '0b5e1a8e-2f6c-4f43-9c0f-111111111111';

function task(overrides: Partial<Task> = {}): Task {
    return {
        id: TASK_ID,
        title: 'Grafika @everyone',
        description: 'tajny opis',
        priority: 'high',
        status: 'open',
        creatorId: ACTOR,
        assigneeId: USER_B,
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

describe('buildAssignmentDm', () => {
    const originalUrl = process.env.DASHBOARD_BASE_URL;
    afterEach(() => {
        process.env.DASHBOARD_BASE_URL = originalUrl;
    });

    it('zawiera autora, tytul, deep link i przycisk, ale nie opis', () => {
        process.env.DASHBOARD_BASE_URL = 'https://husariabot.dev/';
        const dm = buildAssignmentDm(task(), ACTOR);

        expect(dm.content).toContain(`Został przypisany ci nowy task przez użytkownika <@${ACTOR}>`);
        expect(dm.content).toContain(`https://husariabot.dev/#tasks/${TASK_ID}`);
        expect(dm.content).not.toContain('@everyone');
        expect(dm.content).not.toContain('tajny opis');
        expect(dm.content).toContain('🔴');

        const button = (dm.components![0] as { components: Array<{ url: string; style: number }> }).components[0]!;
        expect(button.style).toBe(5);
        expect(button.url).toBe(`https://husariabot.dev/#tasks/${TASK_ID}`);
    });

    it('bez poprawnego adresu dashboardu nie dodaje przycisku', () => {
        process.env.DASHBOARD_BASE_URL = 'zly-adres';
        const dm = buildAssignmentDm(task(), ACTOR);
        expect(dm.components).toBeUndefined();
    });
});

describe('notifyTaskAssigned', () => {
    it('pomija autora, duplikaty i niepoprawne ID', async () => {
        const send = vi.fn(async (..._args: unknown[]) => undefined);
        const result = await notifyTaskAssigned(task(), ACTOR, [ACTOR, USER_B, USER_B, 'abc', USER_C], send);

        expect(result).toEqual({ sent: 2, failed: 0 });
        expect(send.mock.calls.map((call) => call[0])).toEqual([USER_B, USER_C]);
        expect(send.mock.calls[0]![2]).toMatchObject({ allowedMentions: { parse: [] } });
    });

    it('ogranicza liczbe DM-ow od jednej osoby do jednej osoby', async () => {
        resetDmLimitsForTests();
        const send = vi.fn(async (..._args: unknown[]) => undefined);
        for (let index = 0; index < DM_LIMIT_PER_PAIR + 3; index += 1) {
            await notifyTaskAssigned(task(), ACTOR, [USER_B], send);
        }
        expect(send).toHaveBeenCalledTimes(DM_LIMIT_PER_PAIR);

        await notifyTaskAssigned(task(), ACTOR, [USER_C], send);
        expect(send).toHaveBeenCalledTimes(DM_LIMIT_PER_PAIR + 1);
    });

    it('blad jednej wysylki (zamkniete DM) nie przerywa pozostalych', async () => {
        const send = vi.fn()
            .mockRejectedValueOnce(new DiscordRequestError('send DM', 403, { code: 50007 }))
            .mockResolvedValueOnce(undefined);

        const result = await notifyTaskAssigned(task(), ACTOR, [USER_B, USER_C], send);
        expect(result).toEqual({ sent: 1, failed: 1 });
    });
});
