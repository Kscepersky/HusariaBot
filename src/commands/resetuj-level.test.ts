import { describe, expect, it, vi } from 'vitest';
import { resetujLevelCommand } from './resetuj-level.js';
import { ADMIN_ROLE_ID } from '../utils/role-access.js';

describe('resetujLevelCommand', () => {
    it('wyswietla potwierdzenie z przyciskami', async () => {
        const reply = vi.fn().mockResolvedValue(undefined);
        const interaction = {
            member: { roles: [ADMIN_ROLE_ID] },
            options: {
                getUser: () => ({ id: 'user-1' }),
            },
            reply,
        } as any;

        await resetujLevelCommand.execute(interaction);

        expect(reply).toHaveBeenCalledTimes(1);
        const payload = reply.mock.calls[0]?.[0];
        expect(payload.flags).toBe(64);
        expect(payload.components).toHaveLength(1);
        expect(payload.embeds).toHaveLength(1);
    });
});
