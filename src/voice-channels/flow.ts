import type { VoiceState } from 'discord.js';
import { getTemporaryVoiceConfig } from './constants.js';
import { cleanupTemporaryVoiceChannelIfEmpty, ensureTemporaryVoiceChannelForMember } from './service.js';

let configErrorAlreadyLogged = false;

function getConfigOrNull(): ReturnType<typeof getTemporaryVoiceConfig> | null {
    try {
        return getTemporaryVoiceConfig();
    } catch (error) {
        if (!configErrorAlreadyLogged) {
            console.error('❌  Moduł tymczasowych kanałów voice jest wyłączony:', error);
            configErrorAlreadyLogged = true;
        }

        return null;
    }
}

export async function handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const config = getConfigOrNull();
    if (!config) {
        return;
    }

    const member = newState.member ?? oldState.member;
    if (member?.user.bot) {
        return;
    }

    const previousChannelId = oldState.channelId;
    const currentChannelId = newState.channelId;

    if (previousChannelId === currentChannelId) {
        return;
    }

    if (currentChannelId === config.triggerChannelId) {
        await ensureTemporaryVoiceChannelForMember(newState);
    }

    const finalChannelId = (newState.member ?? oldState.member)?.voice.channelId ?? currentChannelId;

    if (previousChannelId && previousChannelId !== currentChannelId && previousChannelId !== finalChannelId) {
        await cleanupTemporaryVoiceChannelIfEmpty(newState.guild, previousChannelId);
    }
}
