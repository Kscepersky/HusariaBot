import { describe, expect, it } from 'vitest';
import { shouldAwardVoiceXpByRule } from './runtime.js';
import type { EconomyConfig } from './types.js';

const baseConfig: EconomyConfig = {
    dailyMinCoins: 100,
    dailyMaxCoins: 500,
    dailyStreakIncrement: 0.05,
    dailyStreakMaxDays: 30,
    dailyStreakGraceHours: 48,
    dailyMessages: ['test'],
    levelingMode: 'progressive',
    levelingBaseXp: 100,
    levelingExponent: 1.5,
    xpTextPerMessage: 1,
    xpTextCooldownSeconds: 5,
    xpVoicePerMinute: 5,
    xpVoiceRequireTwoUsers: true,
    xpVoiceAllowSelfMute: true,
    xpVoiceAllowSelfDeaf: false,
    xpVoiceAllowAfk: false,
    watchpartyXpMultiplier: 1,
    watchpartyCoinBonusPerMinute: 0,
    levelUpCoinsBase: 25,
    levelUpCoinsPerLevel: 10,
};

describe('shouldAwardVoiceXpByRule', () => {
    it('zwraca false gdy mniej niz 2 osoby przy wymaganym limicie', () => {
        const result = shouldAwardVoiceXpByRule(baseConfig, {
            isBot: false,
            selfMute: false,
            selfDeaf: false,
            isAfk: false,
            eligibleMemberCount: 1,
        });

        expect(result).toBe(false);
    });

    it('zwraca false dla self-deaf gdy konfiguracja blokuje', () => {
        const result = shouldAwardVoiceXpByRule(baseConfig, {
            isBot: false,
            selfMute: false,
            selfDeaf: true,
            isAfk: false,
            eligibleMemberCount: 2,
        });

        expect(result).toBe(false);
    });

    it('zwraca true dla poprawnego przypadku', () => {
        const result = shouldAwardVoiceXpByRule(baseConfig, {
            isBot: false,
            selfMute: true,
            selfDeaf: false,
            isAfk: false,
            eligibleMemberCount: 2,
        });

        expect(result).toBe(true);
    });
});
