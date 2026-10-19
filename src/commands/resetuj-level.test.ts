import { describe, expect, it, vi } from 'vitest';
import { resetujLevelCommand } from './resetuj-level.js';

const OWNER_ID = '100000000000000001';
process.env.OWNER_ID = OWNER_ID;
process.env.PERMISSIONS_DB_PATH = ':memory:';

describe('resetujLevelCommand', () => {
    it('wyswietla potwierdzenie z przyciskami', async () => {
        const reply = vi.fn().mockResolvedValue(undefined);
        const interaction = {
            user: { id: OWNER_ID },
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
