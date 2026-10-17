import { describe, expect, it } from 'vitest';
import { buildLevelRoleAuditReport, buildLevelRoleFixPlan } from './level-role-audit.js';
import type { EconomyLevelRoleMapping } from '../../economy/types.js';

const mappings = [
    { guildId: 'g', roleId: 'r5', minLevel: 5, createdAt: 0, updatedAt: 0 },
    { guildId: 'g', roleId: 'r10', minLevel: 10, createdAt: 0, updatedAt: 0 },
] as EconomyLevelRoleMapping[];

const member = (id: string, roles: string[]) => ({ user: { id, username: id } as never, roles, nick: null });

describe('buildLevelRoleAuditReport', () => {
    it('flags missing, wrong, unexpected and counts ok / not-on-server', () => {
        const report = buildLevelRoleAuditReport(
            [
                { userId: 'ok', level: 12 },
                { userId: 'missing', level: 6 },
                { userId: 'wrong', level: 12 },
                { userId: 'extra', level: 1 },
                { userId: 'stacked', level: 12 },
                { userId: 'gone', level: 7 },
            ],
            [
                member('ok', ['r10']),
                member('missing', ['x']),
                member('wrong', ['r5']),
                member('extra', ['r5']),
                member('stacked', ['r5', 'r10']),
            ],
            mappings,
        );

        expect(report.okUsers).toBe(1);
        expect(report.notOnServerUsers).toBe(1);
        expect(report.issues.map((i) => [i.userId, i.status])).toEqual([
            ['missing', 'missing'],
            ['wrong', 'wrong'],
            ['extra', 'unexpected'],
            ['stacked', 'wrong'],
        ]);
    });
});

describe('buildLevelRoleFixPlan', () => {
    it('adds the expected role and removes other threshold roles', () => {
        const plan = buildLevelRoleFixPlan([
            { userId: 'a', username: null, level: 6, status: 'missing', expectedRoleId: 'r5', currentMappedRoleIds: [] },
            { userId: 'b', username: null, level: 12, status: 'wrong', expectedRoleId: 'r10', currentMappedRoleIds: ['r5', 'r10'] },
            { userId: 'c', username: null, level: 1, status: 'unexpected', expectedRoleId: null, currentMappedRoleIds: ['r5'] },
        ]);

        expect(plan).toEqual([
            { userId: 'a', addRoleId: 'r5', removeRoleIds: [] },
            { userId: 'b', addRoleId: null, removeRoleIds: ['r5'] },
            { userId: 'c', addRoleId: null, removeRoleIds: ['r5'] },
        ]);
    });
});
