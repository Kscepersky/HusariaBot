import { describe, it, expect, vi } from 'vitest';
import { embedCommand, EMBED_MODAL_ZGLOSZENIA } from './embed.js';

describe('embedCommand', () => {
    it('powinien otworzyć modal zgłoszeń po wyborze opcji zgloszenia', async () => {
        const showModal = vi.fn().mockResolvedValue(undefined);

        const typeInteraction = {
            values: ['zgloszenia'],
            showModal,
        };

        const interaction = {
            memberPermissions: {
                has: vi.fn().mockReturnValue(true),
            },
            reply: vi.fn().mockResolvedValue({
                resource: {
                    message: {
                        awaitMessageComponent: vi.fn().mockResolvedValue(typeInteraction),
                    },
                },
            }),
            editReply: vi.fn(),
        } as any;

        await embedCommand.execute(interaction);

        expect(showModal).toHaveBeenCalledTimes(1);
        const modal = showModal.mock.calls[0]?.[0];
        expect(modal?.toJSON().custom_id).toBe(EMBED_MODAL_ZGLOSZENIA);
    });
});
