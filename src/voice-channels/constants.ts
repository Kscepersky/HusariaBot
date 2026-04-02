import type { TemporaryVoiceConfig } from './types.js';

let cachedConfig: TemporaryVoiceConfig | null = null;

function requireEnv(name: string): string {
    const value = process.env[name]?.trim();

    if (!value) {
        throw new Error(`Brakujaca zmienna srodowiskowa: ${name}`);
    }

    return value;
}

export function getTemporaryVoiceConfig(): TemporaryVoiceConfig {
    if (cachedConfig) {
        return cachedConfig;
    }

    cachedConfig = {
        triggerChannelId: requireEnv('VOICE_TRIGGER_CHANNEL_ID'),
        categoryId: requireEnv('VOICE_CATEGORY_ID'),
    };

    return cachedConfig;
}

export function resetTemporaryVoiceConfigCacheForTests(): void {
    cachedConfig = null;
}
