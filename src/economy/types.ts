export type EconomyLevelingMode = 'progressive' | 'linear';
export type EconomyLevelingCurve = 'default' | 'formula_v2';

export interface EconomyConfig {
    dailyMinCoins: number;
    dailyMaxCoins: number;
    dailyStreakIncrement: number;
    dailyStreakMaxDays: number;
    dailyStreakGraceHours: number;
    dailyMessages: string[];
    levelingMode: EconomyLevelingMode;
    levelingCurve: EconomyLevelingCurve;
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
    messageCount: number;
    voiceMinutes: number;
    dailyStreak: number;
    lastDailyClaimAt: number | null;
    createdAt: number;
    updatedAt: number;
}

export interface EconomyLevelRoleMapping {
    guildId: string;
    roleId: string;
    minLevel: number;
    createdAt: number;
    updatedAt: number;
}

export interface EconomyLevelRoleMappingInput {
    roleId: string;
    minLevel: number;
}

export interface EconomyTimeoutRecord {
    id: number;
    guildId: string;
    userId: string;
    reason: string;
    muteRoleId: string;
    createdByUserId: string;
    createdAt: number;
    expiresAt: number;
    isActive: boolean;
    releasedAt: number | null;
    releasedByUserId: string | null;
    releaseReason: string | null;
}

export interface EconomyTimeoutCreateInput {
    guildId: string;
    userId: string;
    reason: string;
    muteRoleId: string;
    createdByUserId: string;
    createdAt: number;
    expiresAt: number;
}

export interface EconomyTimeoutReleaseInput {
    guildId: string;
    timeoutId: number;
    releasedAt: number;
    releasedByUserId: string;
    releaseReason: string;
}

export interface EconomyCsvImportResult {
    importedRows: number;
    insertedRows: number;
    updatedRows: number;
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

export type EconomyAdminOperation = 'add_coins' | 'remove_coins' | 'reset_coins' | 'reset_level' | 'add_xp' | 'add_levels';

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
    messageCount: number;
    voiceMinutes: number;
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
