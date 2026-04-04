export type EconomyLevelingMode = 'progressive' | 'linear';

export interface EconomyConfig {
    dailyMinCoins: number;
    dailyMaxCoins: number;
    dailyStreakIncrement: number;
    dailyStreakMaxDays: number;
    dailyStreakGraceHours: number;
    dailyMessages: string[];
    levelingMode: EconomyLevelingMode;
    levelingBaseXp: number;
    levelingExponent: number;
    xpTextPerMessage: number;
    xpTextCooldownSeconds: number;
    xpVoicePerMinute: number;
    xpVoiceRequireTwoUsers: boolean;
    xpVoiceAllowSelfMute: boolean;
    xpVoiceAllowSelfDeaf: boolean;
    xpVoiceAllowAfk: boolean;
    watchpartyXpMultiplier: number;
    watchpartyCoinBonusPerMinute: number;
    levelUpCoinsBase: number;
    levelUpCoinsPerLevel: number;
}

export interface EconomyUserState {
    guildId: string;
    userId: string;
    xp: number;
    level: number;
    coins: number;
    dailyStreak: number;
    lastDailyClaimAt: number | null;
    createdAt: number;
    updatedAt: number;
}

export interface DailyClaimContext {
    guildId: string;
    userId: string;
    displayName: string;
    nowTimestamp: number;
}

export interface DailyClaimSuccess {
    status: 'claimed';
    coinsAwarded: number;
    baseCoinsRoll: number;
    multiplier: number;
    streak: number;
    currentCoins: number;
    nextClaimAt: number;
    message: string;
}

export interface DailyClaimCooldown {
    status: 'cooldown';
    retryAt: number;
    remainingMs: number;
    streak: number;
    multiplier: number;
}

export type DailyClaimResult = DailyClaimSuccess | DailyClaimCooldown;

export interface DailyStreakSummary {
    streak: number;
    multiplier: number;
    canClaimNow: boolean;
    nextClaimAt: number | null;
    lastClaimAt: number | null;
}

export type EconomyAdminOperation = 'add_coins' | 'remove_coins' | 'reset_coins' | 'reset_level' | 'add_xp';

export interface EconomyAdminMutationResult {
    guildId: string;
    userId: string;
    operation: EconomyAdminOperation;
    amount: number;
    previousCoins: number;
    currentCoins: number;
    previousXp: number;
    currentXp: number;
    previousLevel: number;
    currentLevel: number;
    createdAt: number;
}

export type EconomyLeaderboardSortBy = 'xp' | 'coins';

export interface EconomyLeaderboardEntry {
    rank: number;
    userId: string;
    xp: number;
    level: number;
    coins: number;
    xpIntoLevel: number;
    xpForNextLevel: number;
    xpToNextLevel: number;
    displayName?: string;
    avatarUrl?: string | null;
}

export interface EconomyLeaderboardPage {
    sortBy: EconomyLeaderboardSortBy;
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
    entries: EconomyLeaderboardEntry[];
}

export interface EconomyXpAwardResult {
    guildId: string;
    userId: string;
    awardedXp: number;
    previousXp: number;
    currentXp: number;
    previousLevel: number;
    currentLevel: number;
    levelsGained: number;
    coinsAwarded: number;
    currentCoins: number;
    createdAt: number;
}
