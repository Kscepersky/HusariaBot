import { describe, it, expect, vi } from 'vitest';
import { embedCommand, EMBED_MODAL_ZGLOSZENIA } from './embed.js';
import { ADMIN_ROLE_ID } from '../utils/role-access.js';

describe('embedCommand', () => {
    it('powinien otworzyć modal zgłoszeń po wyborze opcji zgloszenia', async () => {
        const showModal = vi.fn().mockResolvedValue(undefined);

        const typeInteraction = {
            values: ['zgloszenia'],
            showModal,
        };

        const interaction = {
            member: {
                roles: [ADMIN_ROLE_ID],
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
