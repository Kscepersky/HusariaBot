import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const OWNER_ID = '100000000000000001';
const OUTSIDER_ID = '100000000000000009';
process.env.OWNER_ID = OWNER_ID;
process.env.PERMISSIONS_DB_PATH = ':memory:';
process.env.TASKS_DB_PATH = ':memory:';
process.env.DASHBOARD_BASE_URL = 'https://husariabot.dev';

import { buildMyTasksDescription, mojeTaskiCommand } from './mojetaski.js';
import { getTaskStore } from '../tasks/task-store.js';

function interaction(userId: string) {
    return {
        user: { id: userId, username: 'tester', displayName: 'Tester' },
        replied: false,
        deferred: false,
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
    } as any;
}

beforeAll(async () => {
    const store = await getTaskStore();
    const base = { description: 'TAJNY OPIS', priority: 'high' as const, dueAt: null, creatorId: OWNER_ID };
    await store.createTask({ ...base, title: 'Moj task', assigneeId: OWNER_ID }, []);
    await store.createTask({ ...base, title: 'Dla wszystkich', assigneeId: null }, []);
    await store.createTask({ ...base, title: 'Cudzy', assigneeId: '100000000000000002' }, []);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('/mojetaski', () => {
    it('odmawia osobie bez dostepu do dashboardu', async () => {
        const ctx = interaction(OUTSIDER_ID);
        await mojeTaskiCommand.execute(ctx);

        expect(ctx.reply).toHaveBeenCalledTimes(1);
        expect(ctx.reply.mock.calls[0][0].flags).toBe(64);
        expect(ctx.reply.mock.calls[0][0].embeds).toBeUndefined();
    });

    it('pokazuje publicznie wlasne taski i taski dla wszystkich, bez opisow', async () => {
        const ctx = interaction(OWNER_ID);
        await mojeTaskiCommand.execute(ctx);

        const payload = ctx.reply.mock.calls[0][0];
        expect(payload.flags).toBeUndefined();
        expect(payload.allowedMentions).toEqual({ parse: [] });

        const description: string = payload.embeds[0].toJSON().description;
        expect(description).toContain('Moj task');
        expect(description).toContain('Dla wszystkich');
        expect(description).not.toContain('Cudzy');
        expect(description).not.toContain('TAJNY OPIS');

        const button = payload.components[0].toJSON().components[0];
        expect(button.url).toBe('https://husariabot.dev/#tasks');
    });

    it('pusty stan', () => {
        expect(buildMyTasksDescription([])).toContain('Nie masz');
    });
});
