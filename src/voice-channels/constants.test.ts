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

    it('zwraca konfiguracje z env', () => {
        expect(getTemporaryVoiceConfig()).toEqual({
            triggerChannelId: 'trigger-1',
            categoryId: 'category-1',
        });
    });

    it('rzuca blad gdy brakuje kanalu wyzwalajacego', () => {
        delete process.env.VOICE_TRIGGER_CHANNEL_ID;

        expect(() => getTemporaryVoiceConfig()).toThrow('Brakujaca zmienna srodowiskowa: VOICE_TRIGGER_CHANNEL_ID');
    });
});
