import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetEconomyDatabaseForTests } from './database.js';
import {
    addCoinsByAdmin,
    addLevelsByAdmin,
    addXpByAdmin,
    awardMessageXp,
    awardVoiceXp,
    awardWatchpartyVoiceActivity,
    createEconomyTimeout,
    claimDailyReward,
    getActiveEconomyTimeoutForUser,
    getEconomyConfig,
    getEconomyLeaderboardPage,
    getEconomyLevelRoleMappings,
    getEconomyTimeoutById,
    getEconomyUserRankByXp,
    getEconomyUserState,
    getDailyStreakSummary,
    importEconomyCsvSnapshot,
    incrementMessageCount,
    incrementVoiceMinutes,
    listActiveEconomyTimeouts,
    listExpiredActiveEconomyTimeouts,
    removeCoinsByAdmin,
    releaseEconomyTimeout,
    replaceEconomyLevelRoleMappings,
    resetEconomyUsers,
    resetCoinsByAdmin,
    resetLevelByAdmin,
    updateEconomyConfig,
} from './repository.js';

const GUILD_ID = 'guild-1';
const USER_ID = 'user-1';
const RANK_TIERS = [
    { minLevel: 1, maxLevel: 9, levelRewardMultiplier: 3.0, dripRate: 0.08 },
    { minLevel: 10, maxLevel: 19, levelRewardMultiplier: 4.5, dripRate: 0.10 },
    { minLevel: 20, maxLevel: 34, levelRewardMultiplier: 6.0, dripRate: 0.13 },
    { minLevel: 35, maxLevel: 49, levelRewardMultiplier: 8.0, dripRate: 0.17 },
    { minLevel: 50, maxLevel: 74, levelRewardMultiplier: 11.0, dripRate: 0.22 },
    { minLevel: 75, maxLevel: 99, levelRewardMultiplier: 15.0, dripRate: 0.28 },
    { minLevel: 100, maxLevel: 124, levelRewardMultiplier: 20.0, dripRate: 0.35 },
];

function resolveTierForLevel(level: number): { levelRewardMultiplier: number; dripRate: number } {
    const safeLevel = Math.max(1, Math.floor(level));
    const tier = RANK_TIERS.find((candidateTier) => {
        return safeLevel >= candidateTier.minLevel && safeLevel <= candidateTier.maxLevel;
    });

    return tier ?? RANK_TIERS[RANK_TIERS.length - 1];
}

function resolveFormulaV2XpForNextLevel(level: number): number {
    const safeLevel = Math.max(1, Math.floor(level));
    const previousLevel = Math.max(0, safeLevel - 1);

    return Math.max(1, Math.floor(
        100
        + (0.04 * (previousLevel ** 3))
        + (0.8 * (previousLevel ** 2))
        + (2 * previousLevel)
        + 0.5,
    ));
}

function resolveFormulaV2XpToReachLevel(level: number): number {
    const safeLevel = Math.max(1, Math.floor(level));
    let xpSpent = 0;

    for (let currentLevel = 1; currentLevel < safeLevel; currentLevel += 1) {
        xpSpent += resolveFormulaV2XpForNextLevel(currentLevel);
    }

    return xpSpent;
}

function resolveExpectedLevelReward(level: number): number {
    const tier = resolveTierForLevel(level);
    const xpRequiredForLevel = resolveFormulaV2XpToReachLevel(level);
    return Math.floor(50 + (tier.levelRewardMultiplier * Math.sqrt(xpRequiredForLevel)));
}

async function withTempEconomyDb(testFn: (databasePath: string) => Promise<void>): Promise<void> {
    const directoryPath = await mkdtemp(join(tmpdir(), 'husaria-economy-test-'));
    const dbPath = join(directoryPath, 'economy.sqlite');
    const previousDbPath = process.env.ECONOMY_DB_PATH;

    process.env.ECONOMY_DB_PATH = dbPath;
    await resetEconomyDatabaseForTests();

    try {
        await testFn(dbPath);
    } finally {
        await resetEconomyDatabaseForTests();
        if (typeof previousDbPath === 'string') {
            process.env.ECONOMY_DB_PATH = previousDbPath;
        } else {
            delete process.env.ECONOMY_DB_PATH;
        }

        await rm(directoryPath, { recursive: true, force: true });
    }
}

afterEach(async () => {
    await resetEconomyDatabaseForTests();
});

describe('economy daily repository', () => {
    it('przyznaje daily i zapisuje streak', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 10, 0, 0, 0);
            const claim = await claimDailyReward(
                {
                    guildId: GUILD_ID,
                    userId: USER_ID,
                    displayName: '<@user-1>',
                    nowTimestamp,
                },
                { random: () => 0 },
            );

            expect(claim.status).toBe('claimed');
            if (claim.status !== 'claimed') {
                return;
            }

            expect(claim.baseCoinsRoll).toBe(100);
            expect(claim.coinsAwarded).toBe(100);
            expect(claim.streak).toBe(1);
            expect(claim.multiplier).toBe(1);
            expect(claim.currentCoins).toBe(100);

            const summary = await getDailyStreakSummary(GUILD_ID, USER_ID, nowTimestamp + 1000);
            expect(summary.streak).toBe(1);
            expect(summary.multiplier).toBe(1);
            expect(summary.canClaimNow).toBe(false);
        });
    });

    it('blokuje claim przed uplywem 24h', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 10, 0, 0, 0);

            await claimDailyReward(
                {
                    guildId: GUILD_ID,
                    userId: USER_ID,
                    displayName: '<@user-1>',
                    nowTimestamp,
                },
                { random: () => 0 },
            );

            const secondClaim = await claimDailyReward(
                {
                    guildId: GUILD_ID,
                    userId: USER_ID,
                    displayName: '<@user-1>',
                    nowTimestamp: nowTimestamp + (23 * 60 * 60 * 1000),
                },
                { random: () => 0 },
            );

            expect(secondClaim.status).toBe('cooldown');
            if (secondClaim.status !== 'cooldown') {
                return;
            }

            expect(secondClaim.remainingMs).toBeGreaterThan(0);
            expect(secondClaim.streak).toBe(1);
            expect(secondClaim.multiplier).toBe(1);
        });
    });

    it('zachowuje streak do 48h i resetuje po przekroczeniu', async () => {
        await withTempEconomyDb(async () => {
            const firstClaimAt = Date.UTC(2026, 3, 3, 10, 0, 0, 0);
            const secondClaimAt = firstClaimAt + (28 * 60 * 60 * 1000);
            const thirdClaimAt = secondClaimAt + (49 * 60 * 60 * 1000);

            const firstClaim = await claimDailyReward(
                {
                    guildId: GUILD_ID,
                    userId: USER_ID,
                    displayName: '<@user-1>',
                    nowTimestamp: firstClaimAt,
                },
                { random: () => 0 },
            );

            expect(firstClaim.status).toBe('claimed');

            const secondClaim = await claimDailyReward(
                {
                    guildId: GUILD_ID,
                    userId: USER_ID,
                    displayName: '<@user-1>',
                    nowTimestamp: secondClaimAt,
                },
                { random: () => 0 },
            );

            expect(secondClaim.status).toBe('claimed');
            if (secondClaim.status !== 'claimed') {
                return;
            }

            expect(secondClaim.streak).toBe(2);
            expect(secondClaim.multiplier).toBe(1.05);
            expect(secondClaim.coinsAwarded).toBe(105);

            const thirdClaim = await claimDailyReward(
                {
                    guildId: GUILD_ID,
                    userId: USER_ID,
                    displayName: '<@user-1>',
                    nowTimestamp: thirdClaimAt,
                },
                { random: () => 0 },
            );

            expect(thirdClaim.status).toBe('claimed');
            if (thirdClaim.status !== 'claimed') {
                return;
            }

            expect(thirdClaim.streak).toBe(1);
            expect(thirdClaim.multiplier).toBe(1);
        });
    });

    it('przy rownoleglych claimach przyznaje nagrode tylko raz', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 10, 0, 0, 0);

            const [firstResult, secondResult] = await Promise.all([
                claimDailyReward(
                    {
                        guildId: GUILD_ID,
                        userId: USER_ID,
                        displayName: '<@user-1>',
                        nowTimestamp,
                    },
                    { random: () => 0 },
                ),
                claimDailyReward(
                    {
                        guildId: GUILD_ID,
                        userId: USER_ID,
                        displayName: '<@user-1>',
                        nowTimestamp,
                    },
                    { random: () => 0 },
                ),
            ]);

            const statuses = [firstResult.status, secondResult.status].sort();
            expect(statuses).toEqual(['claimed', 'cooldown']);

            const summary = await getDailyStreakSummary(GUILD_ID, USER_ID, nowTimestamp + 1_000);
            expect(summary.streak).toBe(1);
        });
    });

    it('nie przekracza maksimum coinsow gdy RNG zwraca 1', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 10, 0, 0, 0);
            const result = await claimDailyReward(
                {
                    guildId: GUILD_ID,
                    userId: USER_ID,
                    displayName: '<@user-1>',
                    nowTimestamp,
                },
                { random: () => 1 },
            );

            expect(result.status).toBe('claimed');
            if (result.status !== 'claimed') {
                return;
            }

            expect(result.baseCoinsRoll).toBe(500);
        });
    });

    it('dodaje i usuwa coinsy przez operacje admina', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 10, 0, 0, 0);

            const addResult = await addCoinsByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Konkurs',
                amount: 250,
                nowTimestamp,
            });

            expect(addResult.currentCoins).toBe(250);

            const removeResult = await removeCoinsByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Korekta',
                amount: 100,
                nowTimestamp: nowTimestamp + 1_000,
            });

            expect(removeResult.currentCoins).toBe(150);
        });
    });

    it('dodaje XP przez operacje admina i przelicza level', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 10, 0, 0, 0);

            const mutation = await addXpByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Nagroda eventowa',
                amount: 100,
                nowTimestamp,
            });

            expect(mutation.operation).toBe('add_xp');
            expect(mutation.previousXp).toBe(0);
            expect(mutation.currentXp).toBe(100);
            expect(mutation.currentLevel).toBe(2);
            expect(mutation.currentCoins).toBe(resolveExpectedLevelReward(2));
        });
    });

    it('dodaje levele przez operacje admina i zachowuje postep XP wewnatrz poziomu', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 10, 0, 0, 0);

            await addXpByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Seed XP',
                amount: 120,
                nowTimestamp,
            });

            const mutation = await addLevelsByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Migracja leveli',
                amount: 2,
                nowTimestamp: nowTimestamp + 1_000,
            });

            expect(mutation.operation).toBe('add_levels');
            expect(mutation.previousLevel).toBe(2);
            expect(mutation.currentLevel).toBe(4);
            expect(mutation.currentXp).toBeGreaterThan(mutation.previousXp);
        });
    });

    it('ogranicza bardzo duzy przyrost XP przez operacje admina', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 10, 0, 0, 0);

            const mutation = await addXpByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Masowy import',
                amount: Number.MAX_SAFE_INTEGER,
                nowTimestamp,
            });

            expect(mutation.amount).toBe(1_000_000);
            expect(mutation.currentXp).toBe(1_000_000);
        });
    });

    it('nie schodzi ponizej zera przy usuwaniu coinsow', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 10, 0, 0, 0);

            await addCoinsByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Start',
                amount: 10,
                nowTimestamp,
            });

            const result = await removeCoinsByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Pelna korekta',
                amount: 50,
                nowTimestamp: nowTimestamp + 1_000,
            });

            expect(result.currentCoins).toBe(0);
        });
    });

    it('resetuje coinsy i level przez operacje admina', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 10, 0, 0, 0);

            await addCoinsByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Nagroda',
                amount: 300,
                nowTimestamp,
            });

            const resetCoinsResult = await resetCoinsByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Reset sezonu',
                nowTimestamp: nowTimestamp + 1_000,
            });

            expect(resetCoinsResult.currentCoins).toBe(0);

            const resetLevelResult = await resetLevelByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Reset levelu',
                nowTimestamp: nowTimestamp + 2_000,
            });

            expect(resetLevelResult.currentLevel).toBe(1);
            expect(resetLevelResult.currentXp).toBe(0);
        });
    });

    it('zwraca leaderboard posortowany po coinsach i XP', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 10, 0, 0, 0);

            await addCoinsByAdmin({
                guildId: GUILD_ID,
                targetUserId: 'user-a',
                adminUserId: 'admin-1',
                reason: 'Seed',
                amount: 50,
                nowTimestamp,
            });

            await addCoinsByAdmin({
                guildId: GUILD_ID,
                targetUserId: 'user-b',
                adminUserId: 'admin-1',
                reason: 'Seed',
                amount: 150,
                nowTimestamp: nowTimestamp + 1_000,
            });

            await claimDailyReward({
                guildId: GUILD_ID,
                userId: 'user-b',
                displayName: '<@user-b>',
                nowTimestamp: nowTimestamp + (30 * 60 * 60 * 1000),
            }, { random: () => 0 });

            await claimDailyReward({
                guildId: GUILD_ID,
                userId: 'user-c',
                displayName: '<@user-c>',
                nowTimestamp,
            }, { random: () => 0.8 });

            const coinsPage = await getEconomyLeaderboardPage(GUILD_ID, 'coins', 1, 10);
            expect(coinsPage.entries[0]?.userId).toBe('user-c');

            const xpPage = await getEconomyLeaderboardPage(GUILD_ID, 'xp', 1, 10);
            expect(xpPage.entries[0]?.userId).toBe('user-c');
        });
    });

    it('nalicza XP za wiadomosci i przyznaje coinsy za level up', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 10, 0, 0, 0);

            for (let index = 0; index < 100; index += 1) {
                await awardMessageXp(GUILD_ID, USER_ID, nowTimestamp + index);
            }

            const state = await getEconomyUserState(GUILD_ID, USER_ID, nowTimestamp + 1_000);
            expect(state.xp).toBe(100);
            expect(state.level).toBe(2);
            expect(state.coins).toBe(resolveExpectedLevelReward(2));
        });
    });

    it('aktualizuje konfiguracje ekonomii i zapisuje ja w bazie', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 10, 0, 0, 0);
            const currentConfig = await getEconomyConfig();

            const updatedConfig = await updateEconomyConfig({
                ...currentConfig,
                dailyMinCoins: 120,
                dailyMaxCoins: 600,
                dailyStreakIncrement: 0.1,
                dailyMessages: [
                    '{user} test 1 {coins}',
                    '   ',
                    '{user} test 2 {streak}',
                ],
                levelingMode: 'linear',
                levelingBaseXp: 150,
                levelingExponent: 2,
                xpTextPerMessage: 3,
                xpTextCooldownSeconds: 7,
                xpVoicePerMinute: 6,
                xpVoiceRequireTwoUsers: false,
                xpVoiceAllowSelfMute: false,
                xpVoiceAllowSelfDeaf: true,
                xpVoiceAllowAfk: true,
                levelUpCoinsBase: 30,
                levelUpCoinsPerLevel: 12,
            }, nowTimestamp + 1_000);

            expect(updatedConfig.dailyMinCoins).toBe(120);
            expect(updatedConfig.dailyMaxCoins).toBe(600);
            expect(updatedConfig.dailyStreakIncrement).toBe(0.1);
            expect(updatedConfig.dailyMessages).toEqual(['{user} test 1 {coins}', '{user} test 2 {streak}']);
            expect(updatedConfig.levelingMode).toBe('progressive');
            expect(updatedConfig.levelingCurve).toBe('formula_v2');
            expect(updatedConfig.xpVoiceRequireTwoUsers).toBe(false);
            expect(updatedConfig.xpVoiceAllowSelfMute).toBe(false);
            expect(updatedConfig.xpVoiceAllowSelfDeaf).toBe(true);
            expect(updatedConfig.xpVoiceAllowAfk).toBe(true);

            const reloadedConfig = await getEconomyConfig();
            expect(reloadedConfig).toEqual(updatedConfig);
        });
    });

    it('nalicza drip tylko dla naturalnych zrodel XP', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 10, 0, 0, 0);
            const voiceAward = await awardVoiceXp(GUILD_ID, USER_ID, nowTimestamp, 4);

            expect(voiceAward.awardedXp).toBe(20);
            expect(voiceAward.coinsAwarded).toBe(1);

            const adminMutation = await addXpByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Admin bez drip',
                amount: 20,
                nowTimestamp: nowTimestamp + 1_000,
            });

            expect(adminMutation.currentCoins).toBe(1);
        });
    });

    it('watchparty nalicza naturalny drip, bonus coins i level-up reward', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 10, 30, 0, 0);
            const currentConfig = await getEconomyConfig();
            const updatedConfig = await updateEconomyConfig({
                ...currentConfig,
                xpVoicePerMinute: 100,
                watchpartyXpMultiplier: 1.5,
                watchpartyCoinBonusPerMinute: 2,
            }, nowTimestamp);

            const award = await awardWatchpartyVoiceActivity(
                GUILD_ID,
                USER_ID,
                nowTimestamp + 1_000,
                updatedConfig,
            );

            expect(award.awardedXp).toBe(150);
            expect(award.currentLevel).toBe(2);
            expect(award.coinsAwarded).toBe(resolveExpectedLevelReward(2) + 12 + 2);
        });
    });

    it('poprawnie nalicza level-up rewards na granicach tierow', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 11, 0, 0, 0);
            const mutation = await addLevelsByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Granice tierow',
                amount: 99,
                nowTimestamp,
            });

            let expectedCoins = 0;
            for (let level = 2; level <= 100; level += 1) {
                expectedCoins += resolveExpectedLevelReward(level);
            }

            expect(mutation.currentLevel).toBe(100);
            expect(mutation.currentCoins).toBe(expectedCoins);
        });
    });

    it('dla poziomow 125+ uzywa ostatniego tieru', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 11, 30, 0, 0);

            await addLevelsByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Podbicie do 124',
                amount: 123,
                nowTimestamp,
            });

            const beforeState = await getEconomyUserState(GUILD_ID, USER_ID, nowTimestamp + 1_000);

            await addLevelsByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Przejscie 124->125',
                amount: 1,
                nowTimestamp: nowTimestamp + 2_000,
            });

            const afterState = await getEconomyUserState(GUILD_ID, USER_ID, nowTimestamp + 3_000);

            const expectedLevel125Reward = resolveExpectedLevelReward(125);
            expect(afterState.level).toBe(125);
            expect(afterState.coins - beforeState.coins).toBe(expectedLevel125Reward);
        });
    });

    it('dla krzywej formula_v2 poprawnie przelicza progi leveli', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 10, 0, 0, 0);
            const currentConfig = await getEconomyConfig();

            await updateEconomyConfig({
                ...currentConfig,
                levelingCurve: 'formula_v2',
            }, nowTimestamp);

            const firstMutation = await addXpByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Test formula_v2 #1',
                amount: 202,
                nowTimestamp: nowTimestamp + 1_000,
            });

            expect(firstMutation.currentXp).toBe(202);
            expect(firstMutation.currentLevel).toBe(2);

            const secondMutation = await addXpByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'Test formula_v2 #2',
                amount: 1,
                nowTimestamp: nowTimestamp + 2_000,
            });

            expect(secondMutation.currentXp).toBe(203);
            expect(secondMutation.currentLevel).toBe(3);
        });
    });

    it('resetuje dane ekonomii tylko dla wskazanego guild', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 10, 0, 0, 0);

            await addCoinsByAdmin({
                guildId: 'guild-1',
                targetUserId: 'user-a',
                adminUserId: 'admin-1',
                reason: 'Seed',
                amount: 200,
                nowTimestamp,
            });

            await addCoinsByAdmin({
                guildId: 'guild-1',
                targetUserId: 'user-b',
                adminUserId: 'admin-1',
                reason: 'Seed',
                amount: 300,
                nowTimestamp: nowTimestamp + 100,
            });

            await addCoinsByAdmin({
                guildId: 'guild-2',
                targetUserId: 'user-c',
                adminUserId: 'admin-1',
                reason: 'Seed',
                amount: 400,
                nowTimestamp: nowTimestamp + 200,
            });

            const removedCount = await resetEconomyUsers('guild-1');
            expect(removedCount).toBe(2);

            const guild1User = await getEconomyUserState('guild-1', 'user-a', nowTimestamp + 1_000);
            expect(guild1User.coins).toBe(0);
            expect(guild1User.xp).toBe(0);
            expect(guild1User.level).toBe(1);

            const guild2User = await getEconomyUserState('guild-2', 'user-c', nowTimestamp + 2_000);
            expect(guild2User.coins).toBe(400);
        });
    });

    it('zlicza wiadomosci i minuty VC niezaleznie od XP', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 12, 0, 0, 0);

            await incrementMessageCount(GUILD_ID, USER_ID, nowTimestamp);
            await incrementMessageCount(GUILD_ID, USER_ID, nowTimestamp + 1_000);
            await incrementVoiceMinutes(GUILD_ID, USER_ID, 3, nowTimestamp + 2_000);

            const state = await getEconomyUserState(GUILD_ID, USER_ID, nowTimestamp + 3_000);
            expect(state.messageCount).toBe(2);
            expect(state.voiceMinutes).toBe(3);
        });
    });

    it('importuje CSV jako snapshot i przelicza XP z level + xp_w_levelu', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 12, 0, 0, 0);
            const importResult = await importEconomyCsvSnapshot({
                guildId: GUILD_ID,
                csvContent: [
                    '111111111111111111,1,5,10,15',
                    '222222222222222222,2,10,4,6',
                ].join('\n'),
                nowTimestamp,
            });

            expect(importResult).toEqual({
                importedRows: 2,
                insertedRows: 2,
                updatedRows: 0,
            });

            const userOne = await getEconomyUserState(GUILD_ID, '111111111111111111', nowTimestamp + 1_000);
            const userTwo = await getEconomyUserState(GUILD_ID, '222222222222222222', nowTimestamp + 2_000);

            expect(userOne.level).toBe(1);
            expect(userOne.xp).toBe(5);
            expect(userOne.coins).toBe(0);
            expect(userOne.messageCount).toBe(10);
            expect(userOne.voiceMinutes).toBe(15);

            expect(userTwo.level).toBe(2);
            expect(userTwo.xp).toBe(110);
            expect(userTwo.coins).toBe(resolveExpectedLevelReward(2));
            expect(userTwo.messageCount).toBe(4);
            expect(userTwo.voiceMinutes).toBe(6);

            const updateResult = await importEconomyCsvSnapshot({
                guildId: GUILD_ID,
                csvContent: '111111111111111111,1,8,12,17',
                nowTimestamp: nowTimestamp + 3_000,
            });

            expect(updateResult).toEqual({
                importedRows: 1,
                insertedRows: 0,
                updatedRows: 1,
            });

            const updatedUserOne = await getEconomyUserState(GUILD_ID, '111111111111111111', nowTimestamp + 4_000);
            expect(updatedUserOne.xp).toBe(8);
            expect(updatedUserOne.coins).toBe(0);
            expect(updatedUserOne.messageCount).toBe(12);
            expect(updatedUserOne.voiceMinutes).toBe(17);
        });
    });

    it('import CSV przelicza coinsy na podstawie levelu (np. level 50)', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 12, 30, 0, 0);

            await importEconomyCsvSnapshot({
                guildId: GUILD_ID,
                csvContent: '333333333333333333,50,0,100,200',
                nowTimestamp,
            });

            const importedUser = await getEconomyUserState(GUILD_ID, '333333333333333333', nowTimestamp + 1_000);

            let expectedCoins = 0;
            for (let level = 2; level <= 50; level += 1) {
                expectedCoins += resolveExpectedLevelReward(level);
            }

            expect(importedUser.level).toBe(50);
            expect(importedUser.coins).toBe(expectedCoins);
        });
    });

    it('rollbackuje caly import CSV gdy jeden z wierszy jest bledny', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 12, 0, 0, 0);

            const beforeMutation = await addXpByAdmin({
                guildId: GUILD_ID,
                targetUserId: USER_ID,
                adminUserId: 'admin-1',
                reason: 'seed',
                amount: 200,
                nowTimestamp,
            });

            await expect(importEconomyCsvSnapshot({
                guildId: GUILD_ID,
                csvContent: [
                    `${USER_ID},5,50,99,77`,
                    'invalid-row-without-required-columns',
                ].join('\n'),
                nowTimestamp: nowTimestamp + 1_000,
            })).rejects.toThrow();

            const stateAfterFailedImport = await getEconomyUserState(GUILD_ID, USER_ID, nowTimestamp + 2_000);
            expect(stateAfterFailedImport.xp).toBe(beforeMutation.currentXp);
            expect(stateAfterFailedImport.level).toBe(beforeMutation.currentLevel);
            expect(stateAfterFailedImport.messageCount).toBe(0);
            expect(stateAfterFailedImport.voiceMinutes).toBe(0);
        });
    });

    it('odrzuca import CSV gdy ten sam userId pojawi sie wielokrotnie', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 12, 0, 0, 0);

            await expect(importEconomyCsvSnapshot({
                guildId: GUILD_ID,
                csvContent: [
                    '111111111111111111,1,10,1,1',
                    '111111111111111111,2,10,2,2',
                ].join('\n'),
                nowTimestamp,
            })).rejects.toThrow('wystepuje wielokrotnie');
        });
    });

    it('zwraca rank po XP i zapisuje mapowania rol levelowych', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 12, 0, 0, 0);

            const mappings = await replaceEconomyLevelRoleMappings(
                GUILD_ID,
                [
                    { roleId: '333333333333333333', minLevel: 10 },
                    { roleId: '111111111111111111', minLevel: 2 },
                ],
                nowTimestamp,
            );

            expect(mappings).toHaveLength(2);
            expect(mappings[0]).toMatchObject({ roleId: '111111111111111111', minLevel: 2 });
            expect(mappings[1]).toMatchObject({ roleId: '333333333333333333', minLevel: 10 });

            const loadedMappings = await getEconomyLevelRoleMappings(GUILD_ID);
            expect(loadedMappings).toEqual(mappings);

            await addXpByAdmin({
                guildId: GUILD_ID,
                targetUserId: 'rank-user-a',
                adminUserId: 'admin-1',
                reason: 'rank seed',
                amount: 100,
                nowTimestamp: nowTimestamp + 1_000,
            });

            await addXpByAdmin({
                guildId: GUILD_ID,
                targetUserId: 'rank-user-b',
                adminUserId: 'admin-1',
                reason: 'rank seed',
                amount: 450,
                nowTimestamp: nowTimestamp + 2_000,
            });

            const userARank = await getEconomyUserRankByXp(GUILD_ID, 'rank-user-a', nowTimestamp + 3_000);
            const userBRank = await getEconomyUserRankByXp(GUILD_ID, 'rank-user-b', nowTimestamp + 4_000);

            expect(userARank).toBe(2);
            expect(userBRank).toBe(1);
        });
    });

    it('tworzy timeout i zwraca go na liscie aktywnych timeoutow', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 13, 0, 0, 0);

            const timeout = await createEconomyTimeout({
                guildId: GUILD_ID,
                userId: '111111111111111111',
                reason: 'Flood',
                muteRoleId: '999999999999999999',
                createdByUserId: 'admin-1',
                createdAt: nowTimestamp,
                expiresAt: nowTimestamp + (2 * 60 * 60 * 1000),
            });

            expect(timeout.isActive).toBe(true);

            const activeForUser = await getActiveEconomyTimeoutForUser(GUILD_ID, '111111111111111111');
            expect(activeForUser?.id).toBe(timeout.id);

            const activeTimeouts = await listActiveEconomyTimeouts(GUILD_ID);
            expect(activeTimeouts).toHaveLength(1);
            expect(activeTimeouts[0]?.id).toBe(timeout.id);
        });
    });

    it('blokuje utworzenie drugiego aktywnego timeoutu dla tego samego usera', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 13, 15, 0, 0);

            await createEconomyTimeout({
                guildId: GUILD_ID,
                userId: '111111111111111111',
                reason: 'Pierwszy timeout',
                muteRoleId: '999999999999999999',
                createdByUserId: 'admin-1',
                createdAt: nowTimestamp,
                expiresAt: nowTimestamp + (60 * 60 * 1000),
            });

            await expect(createEconomyTimeout({
                guildId: GUILD_ID,
                userId: '111111111111111111',
                reason: 'Drugi timeout',
                muteRoleId: '999999999999999999',
                createdByUserId: 'admin-2',
                createdAt: nowTimestamp + 1_000,
                expiresAt: nowTimestamp + (2 * 60 * 60 * 1000),
            })).rejects.toThrow('aktywny timeout');
        });
    });

    it('zdejmuje timeout i usuwa go z listy aktywnych', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 13, 30, 0, 0);

            const timeout = await createEconomyTimeout({
                guildId: GUILD_ID,
                userId: '222222222222222222',
                reason: 'Test release',
                muteRoleId: '999999999999999999',
                createdByUserId: 'admin-1',
                createdAt: nowTimestamp,
                expiresAt: nowTimestamp + (3 * 60 * 60 * 1000),
            });

            const released = await releaseEconomyTimeout({
                guildId: GUILD_ID,
                timeoutId: timeout.id,
                releasedAt: nowTimestamp + 5_000,
                releasedByUserId: 'admin-1',
                releaseReason: 'Kara zdjeta',
            });

            expect(released?.isActive).toBe(false);
            expect(released?.releaseReason).toContain('Kara zdjeta');

            const byId = await getEconomyTimeoutById(GUILD_ID, timeout.id);
            expect(byId?.isActive).toBe(false);

            const activeTimeouts = await listActiveEconomyTimeouts(GUILD_ID);
            expect(activeTimeouts).toHaveLength(0);
        });
    });

    it('zwraca wygasle timeouty do automatycznego sprzatania', async () => {
        await withTempEconomyDb(async () => {
            const nowTimestamp = Date.UTC(2026, 3, 3, 14, 0, 0, 0);

            await createEconomyTimeout({
                guildId: 'guild-1',
                userId: '333333333333333333',
                reason: 'Wygasl',
                muteRoleId: '999999999999999999',
                createdByUserId: 'admin-1',
                createdAt: nowTimestamp - (2 * 60 * 60 * 1000),
                expiresAt: nowTimestamp - 1_000,
            });

            await createEconomyTimeout({
                guildId: 'guild-2',
                userId: '444444444444444444',
                reason: 'Jeszcze aktywny',
                muteRoleId: '999999999999999999',
                createdByUserId: 'admin-2',
                createdAt: nowTimestamp,
                expiresAt: nowTimestamp + (60 * 60 * 1000),
            });

            const expiredTimeouts = await listExpiredActiveEconomyTimeouts(nowTimestamp, 20);
            expect(expiredTimeouts).toHaveLength(1);
            expect(expiredTimeouts[0]?.userId).toBe('333333333333333333');
        });
    });
});
