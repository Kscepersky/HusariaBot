import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getTemporaryVoiceConfig, resetTemporaryVoiceConfigCacheForTests } from './constants.js';

const originalEnv = { ...process.env };

function setRequiredVoiceEnv(): void {
    process.env.VOICE_TRIGGER_CHANNEL_ID = 'trigger-1';
    process.env.VOICE_CATEGORY_ID = 'category-1';
}

describe('temporary voice constants', () => {
    beforeEach(() => {
        process.env = { ...originalEnv };
        resetTemporaryVoiceConfigCacheForTests();
        setRequiredVoiceEnv();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        resetTemporaryVoiceConfigCacheForTests();
    });

    it('rzuca blad gdy brakuje wymaganej roli admina', () => {
        delete process.env.ADMIN_ROLE_ID;
        process.env.MODERATOR_ROLE_ID = 'moderator-role';

        expect(() => getTemporaryVoiceConfig()).toThrow('Brakujaca zmienna srodowiskowa: ADMIN_ROLE_ID');
    });

    it('rzuca blad gdy brakuje wymaganej roli moderatora', () => {
        process.env.ADMIN_ROLE_ID = 'admin-role';
        delete process.env.MODERATOR_ROLE_ID;

        expect(() => getTemporaryVoiceConfig()).toThrow('Brakujaca zmienna srodowiskowa: MODERATOR_ROLE_ID');
    });

    it('pomija puste opcjonalne role i deduplikuje role managerow', () => {
        process.env.ADMIN_ROLE_ID = 'admin-role';
        process.env.MODERATOR_ROLE_ID = 'moderator-role';
        process.env.COMMUNITY_MANAGER_ROLE_ID = '   ';
        process.env.DEV_ROLE_ID = 'admin-role';

        const config = getTemporaryVoiceConfig();

        expect(config.managerRoleIds).toEqual(['admin-role', 'moderator-role']);
    });

    it('zwraca niemutowalna liste managerRoleIds', () => {
        process.env.ADMIN_ROLE_ID = 'admin-role';
        process.env.MODERATOR_ROLE_ID = 'moderator-role';
        process.env.COMMUNITY_MANAGER_ROLE_ID = 'community-role';
        process.env.DEV_ROLE_ID = 'dev-role';

        const config = getTemporaryVoiceConfig();

        expect(Object.isFrozen(config.managerRoleIds)).toBe(true);
    });
});