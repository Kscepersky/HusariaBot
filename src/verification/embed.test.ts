import { describe, expect, it } from 'vitest';
import { buildVerificationButtons, buildVerificationEmbed, type VerificationProfile } from './embed.js';
import { VERIFICATION_APPROVE_BUTTON_ID, VERIFICATION_REJECT_BUTTON_ID } from './constants.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);

const profile: VerificationProfile = {
    userId: '300000000000000001',
    username: 'nowy_gracz',
    globalName: 'Nowy Gracz',
    avatarUrl: 'https://cdn.discordapp.com/avatars/1/abc.png?size=256',
    hasCustomAvatar: true,
    createdTimestamp: NOW - 3 * DAY_MS,
    joinedTimestamp: NOW,
    isBot: false,
    badges: ['HypeSquadOnlineHouse1'],
};

describe('buildVerificationEmbed', () => {
    it('zawiera avatar, wiek konta i daty w formacie Discorda', () => {
        const embed = buildVerificationEmbed(profile, NOW, 14).toJSON();
        const fieldText = (embed.fields ?? []).map((field) => `${field.name}: ${field.value}`).join('\n');

        expect(embed.thumbnail?.url).toBe(profile.avatarUrl);
        expect(embed.description).toContain('Weryfikacja');
        expect(fieldText).toContain(`<@${profile.userId}>`);
        expect(fieldText).toContain(profile.userId);
        expect(fieldText).toContain('3 dni');
        expect(fieldText).toContain(`<t:${Math.floor(profile.createdTimestamp / 1000)}:F>`);
        expect(fieldText).toContain('Wysokie');
        expect(fieldText).toContain('HypeSquad Bravery');
        expect(fieldText).toContain('Własny');
    });

    it('obsluguje brak odznak i domyslny avatar', () => {
        const embed = buildVerificationEmbed({ ...profile, badges: [], hasCustomAvatar: false, joinedTimestamp: null }, NOW, 14).toJSON();
        const fieldText = (embed.fields ?? []).map((field) => field.value).join('\n');
        expect(fieldText).toContain('Brak');
        expect(fieldText).toContain('Domyślny');
    });
});

describe('buildVerificationButtons', () => {
    it('ma przycisk akceptacji i odrzucenia', () => {
        const row = buildVerificationButtons().toJSON();
        const ids = row.components.map((component) => ('custom_id' in component ? component.custom_id : null));
        expect(ids).toEqual([VERIFICATION_APPROVE_BUTTON_ID, VERIFICATION_REJECT_BUTTON_ID]);
    });
});
