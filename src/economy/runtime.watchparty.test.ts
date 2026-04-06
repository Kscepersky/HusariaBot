import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection } from 'discord.js';

vi.mock('./repository.js', () => ({
    awardMessageXp: vi.fn(),
    awardVoiceXp: vi.fn(),
    awardWatchpartyVoiceActivity: vi.fn(),
    getEconomyLevelRoleMappings: vi.fn(),
    getEconomyConfig: vi.fn(),
    incrementMessageCount: vi.fn(),
    incrementVoiceMinutes: vi.fn(),
}));

vi.mock('../dashboard/scheduler/store.js', () => ({
    listScheduledPosts: vi.fn(),
}));

import {
    awardVoiceXp,
    awardWatchpartyVoiceActivity,
    getEconomyConfig,
    getEconomyLevelRoleMappings,
    incrementVoiceMinutes,
} from './repository.js';
import { listScheduledPosts } from '../dashboard/scheduler/store.js';
import { startEconomyVoiceXpTicker, resetEconomyRuntimeForTests } from './runtime.js';

function buildVoiceMember(memberId: string, channelId: string) {
    return {
        id: memberId,
        user: { bot: false },
        voice: {
            selfMute: false,
            selfDeaf: false,
            channelId,
        },
    };
}

function buildClientWithSingleVoiceChannel(channelId: string): any {
    const member = buildVoiceMember('user-1', channelId);
    const members = new Collection([[member.id, member]]);

    const channel = {
        id: channelId,
        isVoiceBased: () => true,
        members,
    };

    const channels = new Collection([[channelId, channel]]);
    const guild = {
        id: 'guild-1',
        afkChannelId: null,
        channels: {
            cache: channels,
        },
    };

    const guilds = new Collection([[guild.id, guild]]);
    return {
        guilds: {
            cache: guilds,
        },
    };
}

describe('economy runtime watchparty voice awards', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        resetEconomyRuntimeForTests();

        vi.mocked(getEconomyConfig).mockResolvedValue({
            dailyMinCoins: 100,
            dailyMaxCoins: 500,
            dailyStreakIncrement: 0.05,
            dailyStreakMaxDays: 30,
            dailyStreakGraceHours: 48,
            dailyMessages: ['test'],
            levelingMode: 'progressive',
            levelingCurve: 'default',
            levelingBaseXp: 100,
            levelingExponent: 1.5,
            xpTextPerMessage: 1,
            xpTextCooldownSeconds: 5,
            xpVoicePerMinute: 5,
            xpVoiceRequireTwoUsers: false,
            xpVoiceAllowSelfMute: true,
            xpVoiceAllowSelfDeaf: true,
            xpVoiceAllowAfk: true,
            watchpartyXpMultiplier: 1.5,
            watchpartyCoinBonusPerMinute: 2,
            levelUpCoinsBase: 25,
            levelUpCoinsPerLevel: 10,
        });
        vi.mocked(getEconomyLevelRoleMappings).mockResolvedValue([]);
        vi.mocked(awardVoiceXp).mockResolvedValue({
            guildId: 'guild-1',
            userId: 'user-1',
            awardedXp: 5,
            previousXp: 0,
            currentXp: 5,
            previousLevel: 1,
            currentLevel: 1,
            levelsGained: 0,
            coinsAwarded: 0,
            currentCoins: 0,
            createdAt: Date.now(),
        });
        vi.mocked(awardWatchpartyVoiceActivity).mockResolvedValue({
            guildId: 'guild-1',
            userId: 'user-1',
            awardedXp: 7,
            previousXp: 0,
            currentXp: 7,
            previousLevel: 1,
            currentLevel: 1,
            levelsGained: 0,
            coinsAwarded: 2,
            currentCoins: 2,
            createdAt: Date.now(),
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('dla otwartego watchparty nalicza tylko sciezke watchparty bez normalnego VC XP', async () => {
        const client = buildClientWithSingleVoiceChannel('watchparty-channel-1');
        vi.mocked(listScheduledPosts).mockResolvedValue([
            {
                id: 'post-1',
                status: 'sent',
                watchpartyStatus: 'open',
                watchpartyChannelId: 'watchparty-channel-1',
            } as any,
        ]);

        const stopTicker = startEconomyVoiceXpTicker(client);
        await vi.advanceTimersByTimeAsync(60_000);
        stopTicker();

        expect(vi.mocked(awardWatchpartyVoiceActivity)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(awardVoiceXp)).not.toHaveBeenCalled();
        expect(vi.mocked(incrementVoiceMinutes)).toHaveBeenCalledTimes(1);
    });

    it('dla zwyklego VC nalicza standardowy VC XP', async () => {
        const client = buildClientWithSingleVoiceChannel('normal-channel-1');
        vi.mocked(listScheduledPosts).mockResolvedValue([]);

        const stopTicker = startEconomyVoiceXpTicker(client);
        await vi.advanceTimersByTimeAsync(60_000);
        stopTicker();

        expect(vi.mocked(awardVoiceXp)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(awardWatchpartyVoiceActivity)).not.toHaveBeenCalled();
        expect(vi.mocked(incrementVoiceMinutes)).toHaveBeenCalledTimes(1);
    });
});