import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
    createLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { handleHusariadaButton, startHusariadaRuntime } from './runtime.js';
import { buildAnswerCustomId } from './embeds.js';

function button(customId: string) {
    return { customId, reply: vi.fn().mockResolvedValue(undefined) } as any;
}

describe('handleHusariadaButton', () => {
    it('ignoruje przyciski spoza Husariady', async () => {
        expect(await handleHusariadaButton(button('husaria_ticket_open'))).toBe(false);
    });

    it('odpowiada prywatnie, gdy silnik nie dziala', async () => {
        const interaction = button(buildAnswerCustomId('0f8fad5b-d9cb-469f-a165-70867728950e', 0, 1));
        expect(await handleHusariadaButton(interaction)).toBe(true);
        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('nieaktywne') }));
    });
});

describe('startHusariadaRuntime', () => {
    it('bez kanalu nic nie uruchamia', () => {
        delete process.env.HUSARIADA_CHANNEL_ID;
        const stop = startHusariadaRuntime({} as any);
        expect(() => stop()).not.toThrow();
    });
});
