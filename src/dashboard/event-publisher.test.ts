import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./discord-api.js', () => {
    return {
        hasBotManageEventsPermission: vi.fn(),
        createExternalGuildScheduledEvent: vi.fn(),
    };
});

import {
    createExternalGuildScheduledEvent,
    hasBotManageEventsPermission,
} from './discord-api.js';
import { tryCreateDiscordEventFromPayload } from './event-publisher.js';
import type { EmbedFormData } from './embed-handlers.js';

function buildPayload(overrides: Partial<EmbedFormData> = {}): EmbedFormData {
    return {
        mode: 'embedded',
        channelId: '123456789012345678',
        title: 'Zapowiedz',
        content: 'Tresc',
        eventDraft: {
            enabled: true,
            title: 'Mecz tygodnia',
            description: 'Opis wydarzenia',
            location: 'Online',
            startAtLocal: '2099-05-01T20:00',
            endAtLocal: '2099-05-01T22:00',
        },
        ...overrides,
    };
}

describe('tryCreateDiscordEventFromPayload', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.GUILD_ID = '123456789012345678';
    });

    it('zwraca not_requested gdy event jest wylaczony', async () => {
        const result = await tryCreateDiscordEventFromPayload({
            mode: 'message',
            channelId: '123456789012345678',
            content: 'Brak eventu',
            eventDraft: {
                enabled: false,
            },
        });

        expect(result).toEqual({
            status: 'not_requested',
            warnings: [],
        });
    });

    it('zwraca failed dla nieprawidlowych dat eventu', async () => {
        const result = await tryCreateDiscordEventFromPayload(buildPayload({
            eventDraft: {
                enabled: true,
                title: 'Mecz tygodnia',
                description: 'Opis wydarzenia',
                location: 'Online',
                startAtLocal: 'invalid',
                endAtLocal: 'invalid',
            },
        }));

        expect(result.status).toBe('failed');
        expect(result.eventError).toContain('Nieprawidłowa data');
        expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('zwraca failed gdy bot nie ma uprawnienia Manage Events', async () => {
        vi.mocked(hasBotManageEventsPermission).mockResolvedValue(false);

        const result = await tryCreateDiscordEventFromPayload(buildPayload());

        expect(result.status).toBe('failed');
        expect(result.eventError).toContain('Manage Events');
    });

    it('tworzy event gdy uprawnienia sa poprawne', async () => {
        vi.mocked(hasBotManageEventsPermission).mockResolvedValue(true);
        vi.mocked(createExternalGuildScheduledEvent).mockResolvedValue('event-123');

        const result = await tryCreateDiscordEventFromPayload(buildPayload());

        expect(result).toEqual({
            status: 'created',
            eventId: 'event-123',
            warnings: [],
        });
    });
});
