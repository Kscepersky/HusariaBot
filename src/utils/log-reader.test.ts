import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const entry = (action: string, scope: string, level: string, ts: number) => JSON.stringify({
    timestampIso: new Date(ts).toISOString(),
    timestampMs: ts,
    level,
    action,
    scope,
    message: action,
    context: {},
    error: null,
});

describe('listDashboardLogs noise filtering', () => {
    let dir: string;
    const cwd = process.cwd();

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'logs-'));
        await mkdir(join(dir, 'logs'));
        await writeFile(join(dir, 'logs', 'system-2026-10-17.jsonl'), [
            entry('DASHBOARD_RATE_LIMIT_HIT', 'dashboard:rate-limit', 'warn', 3),
            entry('DASHBOARD_RATE_LIMIT_HIT', 'dashboard:rate-limit', 'warn', 2),
            entry('LEVEL_ROLE_FIX_USER', 'dashboard:api', 'info', 1),
        ].join('\n'));
        vi.spyOn(process, 'cwd').mockReturnValue(dir);
        vi.resetModules();
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        process.chdir(cwd);
        await rm(dir, { recursive: true, force: true });
    });

    it('hides noise and reports how many entries were hidden', async () => {
        const { listDashboardLogs } = await import('./log-reader.js');
        const result = await listDashboardLogs({ page: 1, pageSize: 25, search: '', level: 'all', hideNoise: true });

        expect(result.entries.map((e) => e.action)).toEqual(['LEVEL_ROLE_FIX_USER']);
        expect(result.hiddenNoiseCount).toBe(2);
        expect(result.scopes).toEqual(['dashboard:api', 'dashboard:rate-limit']);
    });

    it('filters by scope and keeps noise when not hidden', async () => {
        const { listDashboardLogs } = await import('./log-reader.js');
        const noisy = await listDashboardLogs({ page: 1, pageSize: 25, search: '', level: 'all', hideNoise: false });
        const scoped = await listDashboardLogs({ page: 1, pageSize: 25, search: '', level: 'all', scope: 'dashboard:api' });

        expect(noisy.totalRows).toBe(3);
        expect(scoped.entries.map((e) => e.action)).toEqual(['LEVEL_ROLE_FIX_USER']);
    });
});

describe('categorizeLogEntry', () => {
    it('maps well-known actions to categories', async () => {
        const { categorizeLogEntry } = await import('./log-categories.js');
        expect(categorizeLogEntry({ action: 'DASHBOARD_RATE_LIMIT_HIT', scope: 'dashboard:rate-limit' })).toBe('security');
        expect(categorizeLogEntry({ action: 'DASHBOARD_LOGIN_SUCCESS', scope: 'dashboard:auth' })).toBe('auth');
        expect(categorizeLogEntry({ action: 'LEVEL_ROLE_FIX_USER', scope: 'dashboard:api' })).toBe('economy');
        expect(categorizeLogEntry({ action: 'SHOP_ITEM_CREATED', scope: 'dashboard:api:shop' })).toBe('shop');
        expect(categorizeLogEntry({ action: 'SCHEDULED_POST_CREATED', scope: 'dashboard:scheduled-routes' })).toBe('posts');
        expect(categorizeLogEntry({ action: 'WATCHPARTY_OPENED', scope: 'dashboard:watchparty-lifecycle' })).toBe('events');
        expect(categorizeLogEntry({ action: 'BOT_READY', scope: 'bot:runtime' })).toBe('bot');
        expect(categorizeLogEntry({ action: 'DASHBOARD_STARTED', scope: 'dashboard:server' })).toBe('system');
    });
});
