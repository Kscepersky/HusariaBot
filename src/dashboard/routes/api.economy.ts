import { Router,   } from 'express';
import { config } from 'dotenv';
import { requireDevRole, requireSectionAccess, } from '../middleware/require-section-access.js';
import {
    addGuildMemberRole,
    getGuildMember,
    getGuildRoles,
    listAllGuildMembers,
    removeGuildMemberRole,
    updateGuildMemberRoles,
} from '../discord-api.js';
import {
    economyCsvImportSchema,
    economyConfigSchema,
    economyDenominateCoinsSchema,
    economyLevelRoleMappingsSchema,
    economyUserMutationSchema,
    zodErrorToMessage,
} from '../validation/request-schemas.js';
import { parsePositiveIntQuery } from './query-utils.js';
import { enrichEconomyLeaderboard } from './leaderboard-profiles.js';
import { buildLevelRoleAuditReport, buildLevelRoleFixPlan } from './level-role-audit.js';
import {
    normalizeTrimmedString,
} from '../payload-sanitizer.js';
import {
    EconomyCsvImportValidationError,
    EconomyInputValidationError,
    addCoinsByAdmin,
    addLevelsByAdmin,
    addXpByAdmin,
    denominateEconomyCoins,
    exportEconomyCsvSnapshot,
    getEconomyConfig,
    getEconomyLeaderboardPage,
    getEconomyLevelRoleMappings,
    importEconomyCsvSnapshot,
    listEconomyUserLevels,
    replaceEconomyLevelRoleMappings,
    resetEconomyUsers,
    updateEconomyConfig,
} from '../../economy/repository.js';
import type { EconomyLeaderboardSortBy } from '../../economy/types.js';
import { createLogger } from '../../utils/logger.js';

config();

export const economyRouter = Router();
const apiLogger = createLogger('dashboard:api');

interface EconomyCsvImportedUserRow {
    userId: string;
    level: number;
}

interface EconomyImportRoleSyncStats {
    attemptedUsers: number;
    updatedUsers: number;
    skippedUsers: number;
    failedUsers: number;
}

function resolveProtectedStaffRoleIds(): Set<string> {
    const roleIds = [
        process.env.ADMIN_ROLE_ID,
        process.env.MODERATOR_ROLE_ID,
        process.env.COMMUNITY_MANAGER_ROLE_ID,
        process.env.DEV_ROLE_ID,
    ];

    return new Set(
        roleIds
            .map((roleId) => String(roleId ?? '').trim())
            .filter((roleId) => /^\d{17,20}$/.test(roleId)),
    );
}

function parseEconomyImportUserRows(csvContent: string): EconomyCsvImportedUserRow[] {
    const rows = csvContent
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const seenUserIds = new Set<string>();
    const parsedRows: EconomyCsvImportedUserRow[] = [];

    for (const row of rows) {
        const columns = row.split(',').map((column) => column.trim());
        if (columns.length !== 5) {
            continue;
        }

        const userId = columns[0] ?? '';
        const parsedLevel = Number.parseInt(columns[1] ?? '', 10);

        if (!/^\d{17,20}$/.test(userId)) {
            continue;
        }

        if (!Number.isFinite(parsedLevel) || parsedLevel < 1) {
            continue;
        }

        if (seenUserIds.has(userId)) {
            continue;
        }

        seenUserIds.add(userId);
        parsedRows.push({
            userId,
            level: parsedLevel,
        });
    }

    return parsedRows;
}

function resolveTargetRoleIdForLevel(
    level: number,
    mappings: Awaited<ReturnType<typeof getEconomyLevelRoleMappings>>,
): string | null {
    const sortedMappings = [...mappings].sort((left, right) => {
        if (left.minLevel !== right.minLevel) {
            return right.minLevel - left.minLevel;
        }

        return String(left.roleId).localeCompare(String(right.roleId), 'pl');
    });

    const matchingRole = sortedMappings.find((mapping) => mapping.minLevel <= level);
    return matchingRole ? String(matchingRole.roleId) : null;
}

function hasSameRoles(currentRoles: string[], nextRoles: string[]): boolean {
    if (currentRoles.length !== nextRoles.length) {
        return false;
    }

    const currentRoleSet = new Set(currentRoles);
    return nextRoles.every((roleId) => currentRoleSet.has(roleId));
}

async function syncLevelRolesAfterCsvImport(guildId: string, csvContent: string): Promise<EconomyImportRoleSyncStats> {
    const mappings = await getEconomyLevelRoleMappings(guildId);
    const protectedRoleIds = resolveProtectedStaffRoleIds();
    const automationSafeMappings = mappings.filter((mapping) => !protectedRoleIds.has(String(mapping.roleId)));
    const importedUsers = parseEconomyImportUserRows(csvContent);

    if (!Array.isArray(automationSafeMappings) || automationSafeMappings.length === 0 || importedUsers.length === 0) {
        return {
            attemptedUsers: importedUsers.length,
            updatedUsers: 0,
            skippedUsers: importedUsers.length,
            failedUsers: 0,
        };
    }

    const mappedRoleIds = new Set(automationSafeMappings.map((mapping) => String(mapping.roleId)));
    let updatedUsers = 0;
    let skippedUsers = 0;
    let failedUsers = 0;

    for (const importedUser of importedUsers) {
        try {
            const member = await getGuildMember(importedUser.userId, guildId);
            if (!member || !Array.isArray(member.roles)) {
                skippedUsers += 1;
                continue;
            }

            const currentRoles = member.roles
                .map((roleId) => String(roleId).trim())
                .filter((roleId) => /^\d{17,20}$/.test(roleId));
            const targetRoleId = resolveTargetRoleIdForLevel(importedUser.level, automationSafeMappings);
            const rolesWithoutMapped = currentRoles.filter((roleId) => !mappedRoleIds.has(roleId));
            const nextRoles = targetRoleId
                ? [...new Set([...rolesWithoutMapped, targetRoleId])]
                : [...new Set(rolesWithoutMapped)];

            if (hasSameRoles(currentRoles, nextRoles)) {
                skippedUsers += 1;
                continue;
            }

            const outcome = await updateGuildMemberRoles(guildId, importedUser.userId, nextRoles);
            if (outcome === 'not_found') {
                skippedUsers += 1;
                continue;
            }

            updatedUsers += 1;
        } catch (error) {
            failedUsers += 1;
            apiLogger.warn('LEVEL_ROLE_SYNC_USER_FAILED', 'Failed to sync imported economy role mapping for user.', {
                guildId,
                userId: importedUser.userId,
            }, error);
        }
    }

    return {
        attemptedUsers: importedUsers.length,
        updatedUsers,
        skippedUsers,
        failedUsers,
    };
}

// GET /api/economy/settings — load economy configuration for dashboard
economyRouter.get('/economy/settings', requireSectionAccess('economy-settings'), async (_req, res) => {
    try {
        const config = await getEconomyConfig();
        res.json({ config });
    } catch (error) {
        apiLogger.error('ECONOMY_SETTINGS_LOAD_FAILED', 'Failed to load economy settings.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać ustawień ekonomii.' });
    }
});

// PATCH /api/economy/settings — update economy configuration from dashboard
economyRouter.patch('/economy/settings', requireSectionAccess('economy-settings'), async (req, res) => {
    const parsedBody = economyConfigSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    try {
        const updatedConfig = await updateEconomyConfig(parsedBody.data, Date.now());
        res.json({ success: true, config: updatedConfig });
    } catch (error) {
        apiLogger.error('ECONOMY_SETTINGS_UPDATE_FAILED', 'Failed to update economy settings.', {}, error);
        res.status(500).json({ error: 'Nie udało się zapisać ustawień ekonomii.' });
    }
});

// POST /api/economy/reset-users — reset economy state for all users in current guild
economyRouter.post('/economy/reset-users', requireSectionAccess('economy-settings'), async (_req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    try {
        const resetCount = await resetEconomyUsers(guildId);
        res.json({ success: true, resetCount });
    } catch (error) {
        apiLogger.error('ECONOMY_RESET_USERS_FAILED', 'Failed to reset economy users.', {}, error);
        res.status(500).json({ error: 'Nie udało się zresetować danych ekonomii.' });
    }
});

// POST /api/economy/denominate-coins — divide every user's coins by a divisor (e.g. 100:1), no other state changes
economyRouter.post('/economy/denominate-coins', requireSectionAccess('economy-settings'), async (req, res) => {
    const parsedBody = economyDenominateCoinsSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    try {
        const affectedCount = await denominateEconomyCoins(guildId, parsedBody.data.divisor ?? 100);
        res.json({ success: true, affectedCount });
    } catch (error) {
        apiLogger.error('ECONOMY_DENOMINATE_COINS_FAILED', 'Failed to denominate economy coins.', {}, error);
        res.status(500).json({ error: 'Nie udało się wykonać denominacji coinsów.' });
    }
});

// GET /api/economy/export-csv — export current economy snapshot as importable CSV
economyRouter.get('/economy/export-csv', requireSectionAccess('economy-settings'), async (_req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    try {
        const csvContent = await exportEconomyCsvSnapshot(guildId);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="economy-snapshot-${Date.now()}.csv"`);
        res.send(csvContent);
    } catch (error) {
        apiLogger.error('ECONOMY_EXPORT_CSV_FAILED', 'Failed to export economy CSV snapshot.', {}, error);
        res.status(500).json({ error: 'Nie udało się wyeksportować snapshotu CSV ekonomii.' });
    }
});

// POST /api/economy/user-mutation — apply manual economy mutation for one user
economyRouter.post('/economy/user-mutation', requireSectionAccess('economy-settings'), async (req, res) => {
    const parsedBody = economyUserMutationSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    const adminUserId = req.session.user?.id;
    if (!adminUserId) {
        res.status(401).json({ error: 'Brak autoryzacji.' });
        return;
    }

    try {
        let mutation;
        if (parsedBody.data.operation === 'add_coins') {
            mutation = await addCoinsByAdmin({
                guildId,
                targetUserId: parsedBody.data.targetUserId,
                adminUserId,
                amount: parsedBody.data.amount,
                nowTimestamp: Date.now(),
            });
        } else if (parsedBody.data.operation === 'add_levels') {
            mutation = await addLevelsByAdmin({
                guildId,
                targetUserId: parsedBody.data.targetUserId,
                adminUserId,
                amount: parsedBody.data.amount,
                nowTimestamp: Date.now(),
            });
        } else {
            mutation = await addXpByAdmin({
                guildId,
                targetUserId: parsedBody.data.targetUserId,
                adminUserId,
                amount: parsedBody.data.amount,
                nowTimestamp: Date.now(),
            });
        }

        res.json({ success: true, mutation });
    } catch (error) {
        apiLogger.error('ECONOMY_USER_MUTATION_FAILED', 'Failed to apply manual economy mutation.', {}, error);
        res.status(500).json({ error: 'Nie udało się wykonać ręcznej mutacji użytkownika.' });
    }
});

// GET /api/economy/level-roles — load level->role mappings
economyRouter.get('/economy/level-roles', requireSectionAccess('economy-settings'), async (_req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    try {
        const mappings = await getEconomyLevelRoleMappings(guildId);
        res.json({ mappings });
    } catch (error) {
        apiLogger.error('ECONOMY_LEVEL_ROLES_LOAD_FAILED', 'Failed to load economy level-role mappings.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać mapowań ról levelowych.' });
    }
});

// PUT /api/economy/level-roles — replace level->role mappings
economyRouter.put('/economy/level-roles', requireSectionAccess('economy-settings'), async (req, res) => {
    const parsedBody = economyLevelRoleMappingsSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    const protectedRoleIds = resolveProtectedStaffRoleIds();
    const hasProtectedRole = parsedBody.data.mappings.some((mapping) => protectedRoleIds.has(mapping.roleId));
    if (hasProtectedRole) {
        res.status(400).json({
            error: 'Mapowania leveli nie moga zawierac ról staff (Admin, Moderator, Community Manager, Dev).',
        });
        return;
    }

    try {
        const mappings = await replaceEconomyLevelRoleMappings(guildId, parsedBody.data.mappings, Date.now());
        res.json({ success: true, mappings });
    } catch (error) {
        if (error instanceof EconomyInputValidationError) {
            res.status(400).json({ error: error.message });
            return;
        }

        apiLogger.error('ECONOMY_LEVEL_ROLES_UPDATE_FAILED', 'Failed to update economy level-role mappings.', {}, error);
        res.status(500).json({ error: 'Nie udało się zapisać mapowań ról levelowych.' });
    }
});

// POST /api/economy/import-csv — strict snapshot import (userId,level,xp,messages,voiceMinutes[,coins])
economyRouter.post('/economy/import-csv', requireSectionAccess('economy-settings'), async (req, res) => {
    const parsedBody = economyCsvImportSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    try {
        const result = await importEconomyCsvSnapshot({
            guildId,
            csvContent: parsedBody.data.csvContent,
            nowTimestamp: Date.now(),
        });

        let roleSync: EconomyImportRoleSyncStats = {
            attemptedUsers: 0,
            updatedUsers: 0,
            skippedUsers: 0,
            failedUsers: 0,
        };

        try {
            roleSync = await syncLevelRolesAfterCsvImport(guildId, parsedBody.data.csvContent);
        } catch (roleSyncError) {
            apiLogger.warn('ECONOMY_CSV_ROLE_SYNC_FAILED', 'Failed to sync level roles after economy CSV import.', {}, roleSyncError);
        }

        res.json({ success: true, result, roleSync });
    } catch (error) {
        if (error instanceof EconomyCsvImportValidationError) {
            res.status(400).json({ error: error.message });
            return;
        }

        apiLogger.error('ECONOMY_CSV_IMPORT_FAILED', 'Failed to import economy CSV snapshot.', {}, error);
        res.status(500).json({ error: 'Nie udało się zaimportować danych CSV ekonomii.' });
    }
});

// POST /api/economy/level-roles/audit — read-only check of every user's level vs. threshold role (dev only)
economyRouter.post('/economy/level-roles/audit', requireSectionAccess('economy-leaderboard'), requireDevRole(), async (_req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    try {
        const protectedRoleIds = resolveProtectedStaffRoleIds();
        const mappings = (await getEconomyLevelRoleMappings(guildId))
            .filter((mapping) => !protectedRoleIds.has(String(mapping.roleId)));
        const [users, members, guildRoles] = await Promise.all([
            listEconomyUserLevels(guildId),
            listAllGuildMembers(guildId),
            getGuildRoles(guildId),
        ]);
        const mappedRoleIds = new Set(mappings.map((mapping) => String(mapping.roleId)));
        const roles = Object.fromEntries(
            guildRoles
                .filter((role) => mappedRoleIds.has(role.id))
                .map((role) => [role.id, { name: role.name, color: role.color ?? 0 }]),
        );

        res.json({
            success: true,
            mappingCount: mappings.length,
            roles,
            report: buildLevelRoleAuditReport(users, members, mappings),
        });
    } catch (error) {
        apiLogger.error('ECONOMY_LEVEL_ROLE_AUDIT_FAILED', 'Failed to audit level roles.', {}, error);
        res.status(500).json({ error: 'Nie udało się sprawdzić rang levelowych.' });
    }
});

// POST /api/economy/level-roles/fix-user — correct threshold roles of a single user (dev only)
economyRouter.post('/economy/level-roles/fix-user', requireSectionAccess('economy-leaderboard'), requireDevRole(), async (req, res) => {
    const targetUserId = normalizeTrimmedString(req.body?.targetUserId);
    if (!/^\d{17,20}$/.test(targetUserId)) {
        res.status(400).json({ error: 'Nieprawidłowe ID użytkownika.' });
        return;
    }

    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    try {
        const protectedRoleIds = resolveProtectedStaffRoleIds();
        const mappings = (await getEconomyLevelRoleMappings(guildId))
            .filter((mapping) => !protectedRoleIds.has(String(mapping.roleId)));
        if (mappings.length === 0) {
            res.status(400).json({ error: 'Brak skonfigurowanych mapowań rang levelowych.' });
            return;
        }

        const user = (await listEconomyUserLevels(guildId)).find((entry) => entry.userId === targetUserId);
        const member = await getGuildMember(targetUserId, guildId, true);
        if (!user || !member) {
            res.status(404).json({ error: 'Użytkownika nie ma w ekonomii lub na serwerze.' });
            return;
        }

        const [action] = buildLevelRoleFixPlan(buildLevelRoleAuditReport([user], [member], mappings).issues);
        if (!action) {
            res.json({ success: true, changed: false, addedRoleId: null, removedRoleIds: [] });
            return;
        }

        for (const roleId of action.removeRoleIds) {
            await removeGuildMemberRole(guildId, targetUserId, roleId);
        }
        if (action.addRoleId) {
            await addGuildMemberRole(guildId, targetUserId, action.addRoleId);
        }

        apiLogger.info('LEVEL_ROLE_FIX_USER', 'Level roles corrected for user.', {
            guildId,
            targetUserId,
            level: user.level,
            addedRoleId: action.addRoleId,
            removedRoleIds: action.removeRoleIds,
            actorUserId: req.session.user?.id,
        });
        res.json({ success: true, changed: true, addedRoleId: action.addRoleId, removedRoleIds: action.removeRoleIds });
    } catch (error) {
        apiLogger.error('ECONOMY_LEVEL_ROLE_FIX_USER_FAILED', 'Failed to fix level roles for user.', { targetUserId }, error);
        res.status(500).json({ error: 'Nie udało się naprawić rang użytkownika. Sprawdź uprawnienia i hierarchię roli bota.' });
    }
});

// GET /api/economy/leaderboard — load paginated economy leaderboard for dashboard
economyRouter.get('/economy/leaderboard', requireSectionAccess('economy-leaderboard'), async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    const sortByRaw = normalizeTrimmedString(req.query.sortBy).toLowerCase();
    const sortBy: EconomyLeaderboardSortBy = sortByRaw === 'coins' ? 'coins' : 'xp';

    if (sortByRaw && sortByRaw !== 'xp' && sortByRaw !== 'coins') {
        res.status(400).json({ error: 'Nieprawidłowy parametr sortBy. Dozwolone: xp, coins.' });
        return;
    }

    const page = parsePositiveIntQuery(req.query.page, 1);
    const pageSize = Math.max(1, Math.min(25, parsePositiveIntQuery(req.query.pageSize, 10)));

    try {
        const rawLeaderboard = await getEconomyLeaderboardPage(guildId, sortBy, page, pageSize);
        const leaderboard = await enrichEconomyLeaderboard(guildId, rawLeaderboard);
        res.json({ leaderboard });
    } catch (error) {
        apiLogger.error('ECONOMY_LEADERBOARD_LOAD_FAILED', 'Failed to load economy leaderboard.', {}, error);
        res.status(500).json({ error: 'Nie udało się pobrać leaderboardu ekonomii.' });
    }
});

