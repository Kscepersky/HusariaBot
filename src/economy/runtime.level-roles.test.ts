import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as runtime from './runtime.js';
import type { EconomyLevelRoleMapping, EconomyXpAwardResult } from './types.js';

const loggerCalls: Array<{ level: string; action: string; context?: Record<string, unknown> }> = [];

function recordLoggerCall(level: string) {
    return (action: string, _message: string, context?: Record<string, unknown>) => {
        loggerCalls.push({ level, action, context });
    };
}

vi.mock('../utils/logger.js', () => ({
    createLogger: () => ({
        trace: recordLoggerCall('trace'),
        debug: recordLoggerCall('debug'),
        info: recordLoggerCall('info'),
        warn: recordLoggerCall('warn'),
        error: recordLoggerCall('error'),
        fatal: recordLoggerCall('fatal'),
    }),
}));

const getEconomyLevelRoleMappingsMock = vi.fn<(guildId: string) => Promise<EconomyLevelRoleMapping[]>>();

const getProtectedStaffRoleIdsMock = vi.fn<() => Promise<Set<string>>>();

vi.mock('../utils/role-access.js', () => ({
    getProtectedStaffRoleIds: () => getProtectedStaffRoleIdsMock(),
}));

vi.mock('./repository.js', () => ({
    awardMessageXp: vi.fn(),
    awardVoiceXp: vi.fn(),
    getEconomyConfig: vi.fn(),
    getEconomyLevelRoleMappings: (guildId: string) => getEconomyLevelRoleMappingsMock(guildId),
    incrementMessageCount: vi.fn(),
    incrementVoiceMinutes: vi.fn(),
}));

vi.mock('./stats-store.js', () => ({
    getStatsExcludedChannelIds: vi.fn(),
    incrementChannelMessageStats: vi.fn(),
    incrementChannelVoiceStats: vi.fn(),
}));

// vi.mock jest hoistowane ponad importy, wiec statyczny import juz widzi atrapy.
const { applyLevelRoleForMember, applyNaturalLevelUpSideEffects } = runtime;

const GUILD_ID = '1240016859521089687';
const USER_ID = '111111111111111111';

const TIER_1 = '1240021238370406400';
const TIER_10 = '1281981826784559125';
const TIER_20 = '1281985072614080532';

function createMappings(): EconomyLevelRoleMapping[] {
    return [
        { guildId: GUILD_ID, roleId: TIER_1, minLevel: 1 },
        { guildId: GUILD_ID, roleId: TIER_10, minLevel: 10 },
        { guildId: GUILD_ID, roleId: TIER_20, minLevel: 20 },
    ] as EconomyLevelRoleMapping[];
}

/** Minimalna atrapa discord.js Collection - kod uzywa has/filter/map. */
class FakeRoleCache {
    constructor(private readonly roleIds: string[]) {}

    has(roleId: string): boolean {
        return this.roleIds.includes(roleId);
    }

    filter(predicate: (role: { id: string }) => boolean): FakeRoleCache {
        return new FakeRoleCache(this.roleIds.filter((roleId) => predicate({ id: roleId })));
    }

    map<T>(mapper: (role: { id: string }) => T): T[] {
        return this.roleIds.map((roleId) => mapper({ id: roleId }));
    }
}

interface GuildStub {
    guild: any;
    addRole: ReturnType<typeof vi.fn>;
    removeRole: ReturnType<typeof vi.fn>;
    fetchMember: ReturnType<typeof vi.fn>;
}

function createGuildStub(currentRoleIds: string[], overrides: { fetchRejects?: Error } = {}): GuildStub {
    const addRole = vi.fn().mockResolvedValue(undefined);
    const removeRole = vi.fn().mockResolvedValue(undefined);
    const member = {
        id: USER_ID,
        roles: { cache: new FakeRoleCache(currentRoleIds), add: addRole, remove: removeRole },
    };

    const fetchMember = overrides.fetchRejects
        ? vi.fn().mockRejectedValue(overrides.fetchRejects)
        : vi.fn().mockResolvedValue(member);

    return {
        guild: { id: GUILD_ID, members: { fetch: fetchMember } },
        addRole,
        removeRole,
        fetchMember,
    };
}

function actionsLogged(): string[] {
    return loggerCalls.map((call) => call.action);
}

beforeEach(() => {
    loggerCalls.length = 0;
    getEconomyLevelRoleMappingsMock.mockReset();
    getProtectedStaffRoleIdsMock.mockReset();
    getProtectedStaffRoleIdsMock.mockResolvedValue(new Set());
    delete process.env.LEVEL_UP_ANNOUNCE_CHANNEL_ID;
});

describe('applyLevelRoleForMember', () => {
    it('nadaje najwyzszy pasujacy prog i loguje level_role.assigned', async () => {
        const stub = createGuildStub([]);

        await applyLevelRoleForMember(stub.guild, USER_ID, 25, createMappings());

        expect(stub.addRole).toHaveBeenCalledWith(TIER_20, expect.any(String));
        expect(actionsLogged()).toContain('level_role.assigned');
    });

    it('zdejmuje nizsze role progowe przy awansie i loguje level_role.removed', async () => {
        const stub = createGuildStub([TIER_1, TIER_10]);

        await applyLevelRoleForMember(stub.guild, USER_ID, 20, createMappings());

        expect(stub.removeRole).toHaveBeenCalledWith([TIER_1, TIER_10], expect.any(String));
        expect(stub.addRole).toHaveBeenCalledWith(TIER_20, expect.any(String));
        expect(actionsLogged()).toContain('level_role.removed');
    });

    it('nie robi nic gdy uzytkownik ma juz wlasciwa role', async () => {
        const stub = createGuildStub([TIER_10]);

        await applyLevelRoleForMember(stub.guild, USER_ID, 12, createMappings());

        expect(stub.addRole).not.toHaveBeenCalled();
        expect(stub.removeRole).not.toHaveBeenCalled();
        expect(actionsLogged()).toContain('level_role.already_current');
    });

    it('loguje level_role.no_matching_tier gdy level jest ponizej najnizszego progu', async () => {
        const stub = createGuildStub([]);

        await applyLevelRoleForMember(stub.guild, USER_ID, 0, createMappings());

        expect(stub.addRole).not.toHaveBeenCalled();
        expect(actionsLogged()).toContain('level_role.no_matching_tier');
    });

    it('loguje level_role.skipped_no_mappings przy pustej liscie mapowan', async () => {
        const stub = createGuildStub([]);

        await applyLevelRoleForMember(stub.guild, USER_ID, 25, []);

        expect(stub.fetchMember).not.toHaveBeenCalled();
        expect(actionsLogged()).toContain('level_role.skipped_no_mappings');
    });

    it('loguje level_role.member_fetch_failed i nie rzuca gdy fetch padnie', async () => {
        const stub = createGuildStub([], { fetchRejects: new Error('Unknown Member') });

        await expect(applyLevelRoleForMember(stub.guild, USER_ID, 25, createMappings())).resolves.toBeUndefined();

        expect(actionsLogged()).toContain('level_role.member_fetch_failed');
    });

    it('loguje level_role.assign_failed jako error gdy brakuje MANAGE_ROLES', async () => {
        const stub = createGuildStub([]);
        stub.addRole.mockRejectedValue(new Error('Missing Permissions'));

        await expect(applyLevelRoleForMember(stub.guild, USER_ID, 25, createMappings())).resolves.toBeUndefined();

        const failure = loggerCalls.find((call) => call.action === 'level_role.assign_failed');
        expect(failure).toBeDefined();
        expect(failure?.level).toBe('error');
        expect(failure?.context).toMatchObject({ guildId: GUILD_ID, userId: USER_ID, roleId: TIER_20 });
    });

    it('loguje level_role.remove_failed i mimo to probuje nadac nowa role', async () => {
        const stub = createGuildStub([TIER_1]);
        stub.removeRole.mockRejectedValue(new Error('Missing Permissions'));

        await applyLevelRoleForMember(stub.guild, USER_ID, 20, createMappings());

        expect(actionsLogged()).toContain('level_role.remove_failed');
        expect(stub.addRole).toHaveBeenCalledWith(TIER_20, expect.any(String));
    });
});

describe('applyNaturalLevelUpSideEffects', () => {
    const awardResult = {
        userId: USER_ID,
        currentLevel: 20,
        levelsGained: 1,
    } as EconomyXpAwardResult;

    it('nie dotyka rol gdy nie bylo awansu', async () => {
        const stub = createGuildStub([]);
        getEconomyLevelRoleMappingsMock.mockResolvedValue(createMappings());

        await applyNaturalLevelUpSideEffects(stub.guild, { ...awardResult, levelsGained: 0 });

        expect(stub.fetchMember).not.toHaveBeenCalled();
        expect(stub.addRole).not.toHaveBeenCalled();
    });

    it('odfiltrowuje role chronione (rola supportu) z mapowan', async () => {
        getProtectedStaffRoleIdsMock.mockResolvedValue(new Set([TIER_20]));
        const stub = createGuildStub([]);
        getEconomyLevelRoleMappingsMock.mockResolvedValue(createMappings());

        await applyNaturalLevelUpSideEffects(stub.guild, awardResult);

        expect(stub.addRole).toHaveBeenCalledWith(TIER_10, expect.any(String));
        expect(stub.addRole).not.toHaveBeenCalledWith(TIER_20, expect.any(String));
    });

    it('nadaje role na podstawie mapowan pobranych z repozytorium', async () => {
        const stub = createGuildStub([]);
        getEconomyLevelRoleMappingsMock.mockResolvedValue(createMappings());

        await applyNaturalLevelUpSideEffects(stub.guild, awardResult);

        expect(getEconomyLevelRoleMappingsMock).toHaveBeenCalledWith(GUILD_ID);
        expect(stub.addRole).toHaveBeenCalledWith(TIER_20, expect.any(String));
    });
});
