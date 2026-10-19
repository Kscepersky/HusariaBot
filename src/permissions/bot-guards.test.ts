import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPermissionStore, type PermissionStore } from './permission-store.js';

let store: PermissionStore;
vi.mock('./permission-store.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./permission-store.js')>()),
    getPermissionStore: vi.fn(async () => store),
}));

import { pingCommand } from '../commands/ping.js';
import { sendImgCommand } from '../commands/sendimg.js';
import { ticketyConfigCommand } from '../commands/ticketyconfig.js';
import { dashboardLinkCommand } from '../commands/dashboardlink.js';
import { dodajCoinsyCommand } from '../commands/dodaj-coinsy.js';
import { dodajXpCommand } from '../commands/dodaj-xp.js';
import { usunCoinsyCommand } from '../commands/usun-coinsy.js';
import { resetujLevelCommand } from '../commands/resetuj-level.js';
import { resetujCoinsyCommand } from '../commands/resetuj-coinsy.js';
import { muteCommand } from '../commands/mute.js';
import { buildEconomyResetCustomId, handleEconomyResetButton } from '../economy/admin-reset-buttons.js';
import {
    handleAdminCloseReasonModalSubmit,
    handleAdminCloseTicketButton,
    handleAdminCloseTicketCancel,
    handleAdminCloseTicketConfirm,
    handleTicketsConfigModalSubmit,
} from '../tickets/flow.js';
import {
    TICKET_CLOSE_ADMIN_BUTTON_ID,
    TICKET_CLOSE_ADMIN_CANCEL_ID,
    TICKET_CLOSE_ADMIN_CONFIRM_ID,
    TICKET_CLOSE_ADMIN_REASON_MODAL_ID,
    TICKETS_CONFIG_MODAL_ID,
} from '../tickets/constants.js';

/**
 * Kazda uprzywilejowana komenda/przycisk bota ma odmowic uzytkownikowi bez
 * uprawnien (zupelnie obcemu oraz staffowi z inna zakladka) PRZED jakakolwiek
 * praca - w szczegolnosci przed odczytem opcji i przed odroczeniem odpowiedzi.
 */

const OWNER = '111111111111111111';
const STAFF_OTHER_TAB = '222222222222222222';
const STRANGER = '333333333333333333';
const VICTIM = '444444444444444444';

type Handler = (interaction: never) => Promise<unknown>;

const PRIVILEGED: Array<[string, Handler, Record<string, unknown>?]> = [
    ['/ping', pingCommand.execute as Handler],
    ['/sendimg', sendImgCommand.execute as Handler],
    ['/ticketyconfig', ticketyConfigCommand.execute as Handler],
    ['/dashboard', dashboardLinkCommand.execute as Handler],
    ['/dodaj-coinsy', dodajCoinsyCommand.execute as Handler],
    ['/dodaj-xp', dodajXpCommand.execute as Handler],
    ['/usun-coinsy', usunCoinsyCommand.execute as Handler],
    ['/resetuj-level', resetujLevelCommand.execute as Handler],
    ['/resetuj-coinsy', resetujCoinsyCommand.execute as Handler],
    ['/mute', muteCommand.execute as Handler],
    ['przycisk resetu ekonomii (potwierdz)', handleEconomyResetButton as Handler, { customId: buildEconomyResetCustomId('coins', 'confirm', VICTIM) }],
    ['przycisk zamkniecia ticketu (admin)', handleAdminCloseTicketButton as Handler, { customId: TICKET_CLOSE_ADMIN_BUTTON_ID }],
    ['potwierdzenie zamkniecia ticketu (admin)', handleAdminCloseTicketConfirm as Handler, { customId: TICKET_CLOSE_ADMIN_CONFIRM_ID }],
    ['modal powodu zamkniecia ticketu (admin)', handleAdminCloseReasonModalSubmit as Handler, { customId: TICKET_CLOSE_ADMIN_REASON_MODAL_ID }],
    ['modal konfiguracji ticketow', handleTicketsConfigModalSubmit as Handler, { customId: TICKETS_CONFIG_MODAL_ID }],
];

function buildInteraction(userId: string, extra: Record<string, unknown> = {}) {
    const calls = {
        reply: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        showModal: vi.fn().mockResolvedValue(undefined),
    };

    const interaction = {
        user: { id: userId },
        // Role Discorda nie moga dawac dostepu - nawet "administratorskie".
        member: { roles: ['admin', 'moderator', 'dev'], permissions: { has: () => true } },
        guildId: '999999999999999999',
        replied: false,
        deferred: false,
        ...calls,
        ...extra,
        // Odczyt opcji/pol przed sprawdzeniem uprawnien = blad.
        options: new Proxy({}, { get() { throw new Error('opcje odczytane przed sprawdzeniem uprawnien'); } }),
        fields: new Proxy({}, { get() { throw new Error('pola odczytane przed sprawdzeniem uprawnien'); } }),
    };

    return { interaction, calls };
}

beforeEach(async () => {
    process.env.OWNER_ID = OWNER;
    store = await createPermissionStore(':memory:');
    await store.setSections(STAFF_OTHER_TAB, ['events'], OWNER);
});

describe.each([
    ['obcy', STRANGER],
    ['staff z inna zakladka', STAFF_OTHER_TAB],
])('%s', (_label, userId) => {
    // /dashboard jest dostepna dla kazdego z jakimkolwiek dostepem, wiec staff z "events" ja ma.
    const cases = PRIVILEGED.filter(([name]) => !(userId === STAFF_OTHER_TAB && name === '/dashboard'));

    it.each(cases)('%s zostaje odrzucone', async (_name, handler, extra) => {
        const { interaction, calls } = buildInteraction(userId, extra);

        await handler(interaction as never);

        expect(calls.reply).toHaveBeenCalledTimes(1);
        expect(calls.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: 64, content: expect.stringContaining('🚫') }));
        expect(calls.update).not.toHaveBeenCalled();
        expect(calls.deferReply).not.toHaveBeenCalled();
        expect(calls.deferUpdate).not.toHaveBeenCalled();
        expect(calls.showModal).not.toHaveBeenCalled();
    });
});

describe('przycisk anulowania zamkniecia ticketu', () => {
    it('jest bezpieczny dla obcego (tylko usuwa wlasna ephemeral wiadomosc)', async () => {
        const { interaction } = buildInteraction(STRANGER, { customId: TICKET_CLOSE_ADMIN_CANCEL_ID });
        await expect(handleAdminCloseTicketCancel(interaction as never)).resolves.not.toThrow();
    });
});
