import type { TemporaryVoiceConfig } from './types.js';

let cachedConfig: TemporaryVoiceConfig | null = null;

function requireEnv(name: string): string {
    const value = process.env[name]?.trim();

    if (!value) {
        throw new Error(`Brakujaca zmienna srodowiskowa: ${name}`);
    }

    return value;
}

function readOptionalEnv(name: string): string | null {
    const value = process.env[name]?.trim();
    return value && value.length > 0 ? value : null;
}

function toUniqueRoleIds(roleIds: Array<string | null | undefined>): string[] {
    return [...new Set(roleIds.filter((roleId): roleId is string => typeof roleId === 'string' && roleId.length > 0))];
}

export function getTemporaryVoiceConfig(): TemporaryVoiceConfig {
    if (cachedConfig) {
        return cachedConfig;
    }

    const managerRoleIds = Object.freeze(toUniqueRoleIds([
        requireEnv('ADMIN_ROLE_ID'),
        requireEnv('MODERATOR_ROLE_ID'),
        readOptionalEnv('COMMUNITY_MANAGER_ROLE_ID'),
        readOptionalEnv('DEV_ROLE_ID'),
    ]));

    cachedConfig = {
        triggerChannelId: requireEnv('VOICE_TRIGGER_CHANNEL_ID'),
        categoryId: requireEnv('VOICE_CATEGORY_ID'),
        managerRoleIds,
    };

    return cachedConfig;
}

export function resetTemporaryVoiceConfigCacheForTests(): void {
    cachedConfig = null;
}
