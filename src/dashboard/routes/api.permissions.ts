import { Router } from 'express';
import { z } from 'zod';
import { requireOwner } from '../middleware/require-section-access.js';
import { getDiscordUserById, getGuildMember, getGuildRoles, searchGuildMembers } from '../discord-api.js';
import { ASSIGNABLE_SECTIONS, isAssignableSection, type DashboardSection } from '../dashboard-sections.js';
import { isOwner } from '../../permissions/access.js';
import { getPermissionStore, isSnowflake, type AuditEntry } from '../../permissions/permission-store.js';
import { zodErrorToMessage } from '../validation/request-schemas.js';
import { parsePositiveIntQuery } from './query-utils.js';
import { buildActorContext } from './actor-context.js';
import { createLogger } from '../../utils/logger.js';

export const permissionsRouter = Router();
const permissionsLogger = createLogger('dashboard:api:permissions');

const AUDIT_PAGE_SIZE_DEFAULT = 25;
const AUDIT_PAGE_SIZE_MAX = 100;
const MEMBER_SEARCH_LIMIT = 10;
const MEMBER_SEARCH_MIN_LENGTH = 2;
const USER_INFO_TTL_MS = 5 * 60 * 1000;

const updateSectionsSchema = z.object({
    sections: z.array(z.string()).max(ASSIGNABLE_SECTIONS.length),
}).strip();

const supportRoleSchema = z.object({
    roleId: z.string().nullable(),
}).strip();

interface UserSummary {
    id: string;
    username: string | null;
    globalName: string | null;
    avatar: string | null;
}

const userInfoCache = new Map<string, { value: UserSummary; fetchedAt: number }>();

async function describeUser(userId: string): Promise<UserSummary> {
    const cached = userInfoCache.get(userId);
    if (cached && Date.now() - cached.fetchedAt < USER_INFO_TTL_MS) {
        return cached.value;
    }

    let value: UserSummary = { id: userId, username: null, globalName: null, avatar: null };
    try {
        const user = await getDiscordUserById(userId);
        if (user) {
            value = { id: userId, username: user.username, globalName: user.global_name ?? null, avatar: user.avatar ?? null };
        }
    } catch (error) {
        // Brak nazwy nie moze blokowac panelu - pokazemy samo ID.
        permissionsLogger.warn('PERMISSIONS_USER_LOOKUP_FAILED', 'Nie udalo sie pobrac danych uzytkownika.', { targetUserId: userId }, error);
        return value;
    }

    userInfoCache.set(userId, { value, fetchedAt: Date.now() });
    return value;
}

async function describeUsers(userIds: readonly string[]): Promise<Record<string, UserSummary>> {
    const uniqueIds = [...new Set(userIds)].filter(isSnowflake);
    const summaries = await Promise.all(uniqueIds.map(describeUser));
    return Object.fromEntries(summaries.map((summary) => [summary.id, summary]));
}

function auditUserIds(entries: readonly AuditEntry[]): string[] {
    return entries.flatMap((entry) => [entry.actorId, ...(entry.action === 'setting' ? [] : [entry.targetId])]);
}

function requireGuildId(): string | null {
    const guildId = process.env.GUILD_ID?.trim();
    return guildId && guildId.length > 0 ? guildId : null;
}

// Cala sekcja jest wylacznie dla ownera. Ten sam guard stoi przed kazda trasa.
permissionsRouter.use('/permissions', requireOwner());

// GET /api/permissions — uzytkownicy z nadanym dostepem
permissionsRouter.get('/permissions', async (req, res) => {
    try {
        const store = await getPermissionStore();
        const entries = await store.list();
        const users = await describeUsers(entries.flatMap((entry) => [entry.userId, entry.grantedBy]));

        res.json({
            entries: entries.map((entry) => ({ ...entry, user: users[entry.userId] ?? null, grantedByUser: users[entry.grantedBy] ?? null })),
            assignableSections: ASSIGNABLE_SECTIONS,
        });
    } catch (error) {
        permissionsLogger.error('PERMISSIONS_LIST_FAILED', 'Nie udalo sie pobrac listy uprawnien.', buildActorContext(req.session.user), error);
        res.status(500).json({ error: 'Nie udało się pobrać uprawnień.' });
    }
});

// GET /api/permissions/members?q= — wyszukiwarka czlonkow serwera
permissionsRouter.get('/permissions/members', async (req, res) => {
    const query = typeof req.query['q'] === 'string' ? req.query['q'].trim() : '';
    if (query.length < MEMBER_SEARCH_MIN_LENGTH) {
        res.json({ members: [] });
        return;
    }

    const guildId = requireGuildId();
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    try {
        const [members, store] = await Promise.all([
            searchGuildMembers(guildId, query, MEMBER_SEARCH_LIMIT),
            getPermissionStore(),
        ]);
        const granted = new Set((await store.list()).map((entry) => entry.userId));

        res.json({
            members: members.map((member) => ({
                ...member,
                isOwner: isOwner(member.id),
                hasAccess: granted.has(member.id),
            })),
        });
    } catch (error) {
        permissionsLogger.error('PERMISSIONS_MEMBER_SEARCH_FAILED', 'Nie udalo sie wyszukac czlonkow.', buildActorContext(req.session.user), error);
        res.status(502).json({ error: 'Nie udało się wyszukać użytkowników.' });
    }
});

// PUT /api/permissions/users/:userId — ustawia pelna liste sekcji uzytkownika
permissionsRouter.put('/permissions/users/:userId', async (req, res) => {
    const targetId = String(req.params['userId'] ?? '');
    const actorId = req.session.user?.id ?? '';

    if (!isSnowflake(targetId)) {
        res.status(400).json({ error: 'Niepoprawne ID użytkownika.' });
        return;
    }

    if (isOwner(targetId)) {
        res.status(400).json({ error: 'Uprawnień ownera nie można zmieniać.' });
        return;
    }

    const parsed = updateSectionsSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: zodErrorToMessage(parsed.error) });
        return;
    }

    const sections = parsed.data.sections;
    const invalid = sections.filter((section) => !isAssignableSection(section));
    if (invalid.length > 0) {
        res.status(400).json({ error: `Nie można nadać sekcji: ${invalid.join(', ')}.` });
        return;
    }

    const guildId = requireGuildId();
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    try {
        if (sections.length > 0 && !(await getGuildMember(targetId, guildId))) {
            res.status(404).json({ error: 'Użytkownik nie jest członkiem serwera.' });
            return;
        }

        const store = await getPermissionStore();
        const audit = await store.setSections(targetId, sections as DashboardSection[], actorId);

        if (audit) {
            permissionsLogger.warn('PERMISSIONS_CHANGED', 'Zmieniono uprawnienia uzytkownika.', {
                ...buildActorContext(req.session.user),
                targetUserId: targetId,
                action: audit.action,
                before: audit.before,
                after: audit.after,
            });
        }

        res.json({ success: true, sections: await store.getSections(targetId) });
    } catch (error) {
        permissionsLogger.error('PERMISSIONS_UPDATE_FAILED', 'Nie udalo sie zapisac uprawnien.', {
            ...buildActorContext(req.session.user),
            targetUserId: targetId,
        }, error);
        res.status(500).json({ error: 'Nie udało się zapisać uprawnień.' });
    }
});

// DELETE /api/permissions/users/:userId — odbiera caly dostep
permissionsRouter.delete('/permissions/users/:userId', async (req, res) => {
    const targetId = String(req.params['userId'] ?? '');
    const actorId = req.session.user?.id ?? '';

    if (!isSnowflake(targetId)) {
        res.status(400).json({ error: 'Niepoprawne ID użytkownika.' });
        return;
    }

    if (isOwner(targetId)) {
        res.status(400).json({ error: 'Uprawnień ownera nie można zmieniać.' });
        return;
    }

    try {
        const store = await getPermissionStore();
        const audit = await store.setSections(targetId, [], actorId);

        if (audit) {
            permissionsLogger.warn('PERMISSIONS_REVOKED', 'Odebrano uprawnienia uzytkownika.', {
                ...buildActorContext(req.session.user),
                targetUserId: targetId,
                before: audit.before,
            });
        }

        res.json({ success: true });
    } catch (error) {
        permissionsLogger.error('PERMISSIONS_REVOKE_FAILED', 'Nie udalo sie odebrac uprawnien.', {
            ...buildActorContext(req.session.user),
            targetUserId: targetId,
        }, error);
        res.status(500).json({ error: 'Nie udało się odebrać uprawnień.' });
    }
});

// GET /api/permissions/audit — log zmian uprawnien (najnowsze pierwsze)
permissionsRouter.get('/permissions/audit', async (req, res) => {
    const page = parsePositiveIntQuery(req.query['page'], 1);
    const pageSize = Math.min(parsePositiveIntQuery(req.query['pageSize'], AUDIT_PAGE_SIZE_DEFAULT), AUDIT_PAGE_SIZE_MAX);

    try {
        const store = await getPermissionStore();
        const result = await store.listAudit(page, pageSize);
        const users = await describeUsers(auditUserIds(result.entries));

        res.json({ ...result, users });
    } catch (error) {
        permissionsLogger.error('PERMISSIONS_AUDIT_FAILED', 'Nie udalo sie pobrac logu audytowego.', buildActorContext(req.session.user), error);
        res.status(500).json({ error: 'Nie udało się pobrać logu audytowego.' });
    }
});

// GET /api/permissions/settings — rola supportu (tickety, pingi, kanaly voice)
permissionsRouter.get('/permissions/settings', async (req, res) => {
    const guildId = requireGuildId();
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    try {
        const store = await getPermissionStore();
        const [supportRoleId, roles] = await Promise.all([
            store.getSetting('support_role_id'),
            getGuildRoles(guildId),
        ]);

        res.json({
            supportRoleId,
            roles: roles.map((role) => ({ id: role.id, name: role.name })),
        });
    } catch (error) {
        permissionsLogger.error('PERMISSIONS_SETTINGS_FAILED', 'Nie udalo sie pobrac ustawien.', buildActorContext(req.session.user), error);
        res.status(502).json({ error: 'Nie udało się pobrać ustawień.' });
    }
});

// PUT /api/permissions/settings/support-role
permissionsRouter.put('/permissions/settings/support-role', async (req, res) => {
    const parsed = supportRoleSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: zodErrorToMessage(parsed.error) });
        return;
    }

    const { roleId } = parsed.data;
    if (roleId !== null && !isSnowflake(roleId)) {
        res.status(400).json({ error: 'Niepoprawne ID roli.' });
        return;
    }

    const guildId = requireGuildId();
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    try {
        if (roleId !== null) {
            const roles = await getGuildRoles(guildId);
            if (!roles.some((role) => role.id === roleId)) {
                res.status(404).json({ error: 'Nie ma takiej roli na serwerze.' });
                return;
            }
        }

        const store = await getPermissionStore();
        const audit = await store.setSetting('support_role_id', roleId, req.session.user?.id ?? '');
        if (audit) {
            permissionsLogger.warn('PERMISSIONS_SUPPORT_ROLE_CHANGED', 'Zmieniono role supportu.', {
                ...buildActorContext(req.session.user),
                before: audit.before,
                after: audit.after,
            });
        }

        res.json({ success: true, supportRoleId: roleId });
    } catch (error) {
        permissionsLogger.error('PERMISSIONS_SUPPORT_ROLE_FAILED', 'Nie udalo sie zapisac roli supportu.', buildActorContext(req.session.user), error);
        res.status(500).json({ error: 'Nie udało się zapisać roli supportu.' });
    }
});
