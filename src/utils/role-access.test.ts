import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPermissionStore, type PermissionStore } from '../permissions/permission-store.js';

let store: PermissionStore;
vi.mock('../permissions/permission-store.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../permissions/permission-store.js')>()),
    getPermissionStore: vi.fn(async () => store),
}));

import {
    ensureDashboardAccess,
    ensureSectionAccess,
    getProtectedStaffRoleIds,
    getSupportRoleIds,
    getTicketStaffUserIds,
} from './role-access.js';

const OWNER = '111111111111111111';
const STAFF = '222222222222222222';
const STRANGER = '333333333333333333';
const ROLE = '555555555555555555';

function createInteraction(userId: string) {
    const reply = vi.fn().mockResolvedValue(undefined);
    return { interaction: { user: { id: userId }, replied: false, deferred: false, reply, followUp: vi.fn() } as any, reply };
}

beforeEach(async () => {
    process.env.OWNER_ID = OWNER;
    store = await createPermissionStore(':memory:');
    await store.setSections(STAFF, ['economy-leaderboard', 'ticket-history'], OWNER);
});

describe('ensureSectionAccess', () => {
    it('przepuszcza ownera do kazdej sekcji bez odpowiedzi', async () => {
        const { interaction, reply } = createInteraction(OWNER);

        expect(await ensureSectionAccess(interaction, 'timeouts-system')).toBe(true);
        expect(reply).not.toHaveBeenCalled();
    });

    it('przepuszcza staff z nadana sekcja', async () => {
        const { interaction } = createInteraction(STAFF);
        expect(await ensureSectionAccess(interaction, 'economy-leaderboard')).toBe(true);
    });

    it('odmawia staff bez tej sekcji i odpowiada ephemeral', async () => {
        const { interaction, reply } = createInteraction(STAFF);

        expect(await ensureSectionAccess(interaction, 'timeouts-system')).toBe(false);
        expect(reply).toHaveBeenCalledWith(expect.objectContaining({ flags: 64 }));
    });

    it('odmawia uzytkownikowi bez wpisu', async () => {
        const { interaction, reply } = createInteraction(STRANGER);

        expect(await ensureSectionAccess(interaction, 'economy-leaderboard')).toBe(false);
        expect(reply).toHaveBeenCalledTimes(1);
    });

    it('odmawia (fail closed), gdy baza uprawnien nie dziala', async () => {
        const { getPermissionStore } = await import('../permissions/permission-store.js');
        vi.mocked(getPermissionStore).mockRejectedValueOnce(new Error('db down'));
        const { interaction, reply } = createInteraction(STAFF);

        expect(await ensureSectionAccess(interaction, 'economy-leaderboard')).toBe(false);
        expect(reply).toHaveBeenCalledTimes(1);
    });

    it('uzywa followUp, gdy interakcja juz zostala odroczona', async () => {
        const { interaction } = createInteraction(STRANGER);
        interaction.deferred = true;
        interaction.followUp.mockResolvedValue(undefined);

        await ensureSectionAccess(interaction, 'shop');
        expect(interaction.followUp).toHaveBeenCalledTimes(1);
        expect(interaction.reply).not.toHaveBeenCalled();
    });
});

describe('ensureDashboardAccess', () => {
    it('przepuszcza ownera i kazdego staff, odrzuca reszte', async () => {
        expect(await ensureDashboardAccess(createInteraction(OWNER).interaction)).toBe(true);
        expect(await ensureDashboardAccess(createInteraction(STAFF).interaction)).toBe(true);
        expect(await ensureDashboardAccess(createInteraction(STRANGER).interaction)).toBe(false);
    });
});

describe('rola supportu', () => {
    it('jest pusta, dopoki owner jej nie ustawi', async () => {
        expect(await getSupportRoleIds()).toEqual([]);
        expect(await getProtectedStaffRoleIds()).toEqual(new Set());
    });

    it('zwraca role ustawiona w panelu', async () => {
        await store.setSetting('support_role_id', ROLE, OWNER);

        expect(await getSupportRoleIds()).toEqual([ROLE]);
        expect(await getProtectedStaffRoleIds()).toEqual(new Set([ROLE]));
    });
});

describe('getTicketStaffUserIds', () => {
    it('zawiera ownera i uzytkownikow z dostepem do ticketow, bez pozostalych', async () => {
        const other = '666666666666666666';
        await store.setSections(other, ['shop'], OWNER);

        const ids = await getTicketStaffUserIds();
        expect(ids).toContain(OWNER);
        expect(ids).toContain(STAFF);
        expect(ids).not.toContain(other);
    });
});
