import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceState } from 'discord.js';

const {
    getTemporaryVoiceConfigMock,
    ensureTemporaryVoiceChannelForMemberMock,
    cleanupTemporaryVoiceChannelIfEmptyMock,
} = vi.hoisted(() => ({
    getTemporaryVoiceConfigMock: vi.fn(),
    ensureTemporaryVoiceChannelForMemberMock: vi.fn(),
    cleanupTemporaryVoiceChannelIfEmptyMock: vi.fn(),
}));

vi.mock('./constants.js', () => ({
    getTemporaryVoiceConfig: getTemporaryVoiceConfigMock,
}));

vi.mock('./service.js', () => ({
    ensureTemporaryVoiceChannelForMember: ensureTemporaryVoiceChannelForMemberMock,
    cleanupTemporaryVoiceChannelIfEmpty: cleanupTemporaryVoiceChannelIfEmptyMock,
}));

import { handleVoiceStateUpdate } from './flow.js';

function createVoiceState(overrides: Record<string, unknown> = {}): VoiceState {
    return {
        channelId: null,
        guild: { id: 'guild-1' },
        member: {
            user: { bot: false },
            voice: { channelId: null },
        },
        ...overrides,
    } as unknown as VoiceState;
}

describe('handleVoiceStateUpdate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getTemporaryVoiceConfigMock.mockReturnValue({
            triggerChannelId: 'trigger-channel',
            categoryId: 'voice-category',
            managerRoleIds: ['admin-role', 'moderator-role', 'community-manager-role', 'dev-role'],
        });
    });

    it('tworzy lub odzyskuje kanal po wejściu na trigger', async () => {
        const oldState = createVoiceState({ channelId: null });
        const newState = createVoiceState({ channelId: 'trigger-channel' });

        await handleVoiceStateUpdate(oldState, newState);

        expect(ensureTemporaryVoiceChannelForMemberMock).toHaveBeenCalledTimes(1);
        expect(ensureTemporaryVoiceChannelForMemberMock).toHaveBeenCalledWith(newState);
        expect(cleanupTemporaryVoiceChannelIfEmptyMock).not.toHaveBeenCalled();
    });

    it('sprzata poprzedni kanal po opuszczeniu', async () => {
        const oldState = createVoiceState({ channelId: 'managed-channel' });
        const newState = createVoiceState({ channelId: null });

        await handleVoiceStateUpdate(oldState, newState);

        expect(cleanupTemporaryVoiceChannelIfEmptyMock).toHaveBeenCalledTimes(1);
        expect(cleanupTemporaryVoiceChannelIfEmptyMock).toHaveBeenCalledWith(newState.guild, 'managed-channel');
    });

    it('nie sprzata previous channel gdy użytkownik został przeniesiony z triggera z powrotem', async () => {
        const oldState = createVoiceState({
            channelId: 'managed-channel',
            member: { user: { bot: false }, voice: { channelId: 'managed-channel' } },
        });

        const newState = createVoiceState({
            channelId: 'trigger-channel',
            member: { user: { bot: false }, voice: { channelId: 'trigger-channel' } },
        });

        ensureTemporaryVoiceChannelForMemberMock.mockImplementation(async (state: VoiceState) => {
            const member = state.member as unknown as { voice: { channelId: string } };
            member.voice.channelId = 'managed-channel';
        });

        await handleVoiceStateUpdate(oldState, newState);

        expect(ensureTemporaryVoiceChannelForMemberMock).toHaveBeenCalledTimes(1);
        expect(cleanupTemporaryVoiceChannelIfEmptyMock).not.toHaveBeenCalled();
    });

    it('ignoruje eventy botow', async () => {
        const oldState = createVoiceState({ channelId: null });
        const newState = createVoiceState({
            channelId: 'trigger-channel',
            member: { user: { bot: true } },
        });

        await handleVoiceStateUpdate(oldState, newState);

        expect(ensureTemporaryVoiceChannelForMemberMock).not.toHaveBeenCalled();
        expect(cleanupTemporaryVoiceChannelIfEmptyMock).not.toHaveBeenCalled();
    });
});
