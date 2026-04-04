import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./discord-api.js', () => ({
    createGuildVoiceChannel: vi.fn(),
    updateChannelRolePermissions: vi.fn(),
    deleteGuildChannel: vi.fn(),
}));

import {
    createGuildVoiceChannel,
    deleteGuildChannel,
    updateChannelRolePermissions,
} from './discord-api.js';
import {
    closeWatchpartyChannel,
    deleteWatchpartyChannel,
    openWatchpartyChannel,
    tryCreateWatchpartyChannelFromPayload,
} from './watchparty-publisher.js';
import type { EmbedFormData } from './embed-handlers.js';

function buildPayload(overrides: Partial<EmbedFormData> = {}): EmbedFormData {
    return {
        mode: 'embedded',
        channelId: '123456789012345678',
        title: 'Zapowiedz',
        content: 'Tresc',
        watchpartyDraft: {
            enabled: true,
            channelName: 'G2 vs FNC | watchparty',
            startAtLocal: '2099-05-01T20:00',
            endAtLocal: '2099-05-01T22:00',
        },
        ...overrides,
    };
}

describe('tryCreateWatchpartyChannelFromPayload', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2099-05-01T17:30:00.000Z'));
        process.env.GUILD_ID = '123456789012345678';
        process.env.WATCHPARTY_CATEGORY_ID = '123456789012345679';
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('zwraca not_requested gdy watchparty jest wylaczone', async () => {
        const result = await tryCreateWatchpartyChannelFromPayload(buildPayload({
            watchpartyDraft: {
                enabled: false,
            },
        }));

        expect(result).toEqual({
            status: 'not_requested',
            warnings: [],
        });
    });

    it('zwraca failed gdy brakuje GUILD_ID', async () => {
        delete process.env.GUILD_ID;

        const result = await tryCreateWatchpartyChannelFromPayload(buildPayload());

        expect(result.status).toBe('failed');
        expect(result.watchpartyError).toContain('GUILD_ID');
    });

    it('tworzy kanal watchparty ze statusem scheduled przed startem', async () => {
        vi.mocked(createGuildVoiceChannel).mockResolvedValue('watchparty-1');

        const result = await tryCreateWatchpartyChannelFromPayload(buildPayload());

        expect(result).toEqual({
            status: 'scheduled',
            channelId: 'watchparty-1',
            warnings: [],
        });
        expect(vi.mocked(createGuildVoiceChannel)).toHaveBeenCalledWith(
            '123456789012345678',
            expect.objectContaining({
                initiallyOpen: false,
            }),
        );
    });

    it('tworzy kanal watchparty ze statusem open w trakcie okna czasowego', async () => {
        vi.setSystemTime(new Date('2099-05-01T18:30:00.000Z'));
        vi.mocked(createGuildVoiceChannel).mockResolvedValue('watchparty-2');

        const result = await tryCreateWatchpartyChannelFromPayload(buildPayload());

        expect(result).toEqual({
            status: 'open',
            channelId: 'watchparty-2',
            warnings: [],
        });
        expect(vi.mocked(createGuildVoiceChannel)).toHaveBeenCalledWith(
            '123456789012345678',
            expect.objectContaining({
                initiallyOpen: true,
            }),
        );
    });

    it('zwraca failed przy nieprawidlowym przedziale czasu', async () => {
        const result = await tryCreateWatchpartyChannelFromPayload(buildPayload({
            watchpartyDraft: {
                enabled: true,
                channelName: 'Kanał',
                startAtLocal: '2099-05-01T22:00',
                endAtLocal: '2099-05-01T21:00',
            },
        }));

        expect(result.status).toBe('failed');
        expect(result.watchpartyError).toContain('przedział');
    });
});

describe('watchparty channel operations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('otwiera i zamyka kanal przez aktualizacje overwrite @everyone', async () => {
        await openWatchpartyChannel('watchparty-1', '123456789012345678');
        await closeWatchpartyChannel('watchparty-1', '123456789012345678');

        expect(vi.mocked(updateChannelRolePermissions)).toHaveBeenNthCalledWith(1, 'watchparty-1', '123456789012345678', { open: true });
        expect(vi.mocked(updateChannelRolePermissions)).toHaveBeenNthCalledWith(2, 'watchparty-1', '123456789012345678', { open: false });
    });

    it('usuwa kanal watchparty', async () => {
        await deleteWatchpartyChannel('watchparty-1');

        expect(vi.mocked(deleteGuildChannel)).toHaveBeenCalledWith('watchparty-1');
    });
});
