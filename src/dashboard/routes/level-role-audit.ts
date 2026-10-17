import type { DiscordGuildMember } from '../discord-api.js';
import type { EconomyLevelRoleMapping } from '../../economy/types.js';

export type LevelRoleAuditStatus = 'ok' | 'missing' | 'wrong' | 'unexpected';

export interface LevelRoleAuditIssue {
    userId: string;
    username: string | null;
    level: number;
    status: Exclude<LevelRoleAuditStatus, 'ok'>;
    expectedRoleId: string | null;
    currentMappedRoleIds: string[];
}

export interface LevelRoleAuditReport {
    totalUsers: number;
    checkedUsers: number;
    okUsers: number;
    notOnServerUsers: number;
    issues: LevelRoleAuditIssue[];
}

export function resolveExpectedRoleId(level: number, mappings: EconomyLevelRoleMapping[]): string | null {
    const match = [...mappings]
        .filter((mapping) => mapping.minLevel <= level)
        .sort((left, right) => right.minLevel - left.minLevel || String(left.roleId).localeCompare(String(right.roleId)))[0];

    return match ? String(match.roleId) : null;
}

/**
 * Porownuje level kazdego uzytkownika z rolami progowymi, ktore faktycznie posiada.
 * Tylko odczyt - niczego nie zmienia na serwerze.
 */
export function buildLevelRoleAuditReport(
    users: Array<{ userId: string; level: number }>,
    members: DiscordGuildMember[],
    mappings: EconomyLevelRoleMapping[],
): LevelRoleAuditReport {
    const memberById = new Map(
        members.flatMap((member) => (member.user?.id ? [[member.user.id, member] as const] : [])),
    );
    const mappedRoleIds = new Set(mappings.map((mapping) => String(mapping.roleId)));
    const issues: LevelRoleAuditIssue[] = [];
    let checkedUsers = 0;
    let notOnServerUsers = 0;

    for (const user of users) {
        const member = memberById.get(user.userId);
        if (!member) {
            notOnServerUsers += 1;
            continue;
        }

        checkedUsers += 1;
        const expectedRoleId = resolveExpectedRoleId(user.level, mappings);
        const currentMappedRoleIds = member.roles.filter((roleId) => mappedRoleIds.has(roleId));
        const hasExpected = expectedRoleId !== null && currentMappedRoleIds.includes(expectedRoleId);
        const hasOnlyExpected = currentMappedRoleIds.length === (expectedRoleId ? 1 : 0);

        if (hasExpected && hasOnlyExpected) {
            continue;
        }

        const status = expectedRoleId === null
            ? 'unexpected'
            : (currentMappedRoleIds.length === 0 ? 'missing' : 'wrong');

        issues.push({
            userId: user.userId,
            username: member.user?.global_name ?? member.user?.username ?? null,
            level: user.level,
            status,
            expectedRoleId,
            currentMappedRoleIds,
        });
    }

    return {
        totalUsers: users.length,
        checkedUsers,
        okUsers: checkedUsers - issues.length,
        notOnServerUsers,
        issues,
    };
}

export interface LevelRoleFixAction {
    userId: string;
    addRoleId: string | null;
    removeRoleIds: string[];
}

/** Zamienia wykryte rozbieznosci na minimalne operacje dodania/zdjecia rol. */
export function buildLevelRoleFixPlan(issues: LevelRoleAuditIssue[]): LevelRoleFixAction[] {
    return issues.map((issue) => ({
        userId: issue.userId,
        addRoleId: issue.expectedRoleId && !issue.currentMappedRoleIds.includes(issue.expectedRoleId)
            ? issue.expectedRoleId
            : null,
        removeRoleIds: issue.currentMappedRoleIds.filter((roleId) => roleId !== issue.expectedRoleId),
    }));
}
