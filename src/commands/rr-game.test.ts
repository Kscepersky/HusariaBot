import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const renderRrCard = vi.hoisted(() => vi.fn());
const randomBelow = vi.hoisted(() => vi.fn());
vi.mock('./rr-card-renderer.js', () => ({ renderRrCard }));
vi.mock('./rr-random.js', () => ({ randomBelow }));

import {
    RR_ACCEPT_TIMEOUT_MS,
    RR_TURN_TIMEOUT_MS,
    handleRrButton,
    resetRrGamesForTests,
    startRrChallenge,
} from './rr-game.js';
import { rrCommand } from './rr.js';

function buildUser(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        username: `user-${id}`,
        globalName: null,
        bot: false,
        displayAvatarURL: () => `https://cdn.example/${id}.png`,
        toString: () => `<@${id}>`,
        ...overrides,
    };
}

function buildCommand(
    caller: ReturnType<typeof buildUser>,
    opponent: ReturnType<typeof buildUser>,
    overrides: Record<string, unknown> = {},
) {
    return {
        id: 'game-1',
        guildId: 'guild-1',
        user: caller,
        options: { getUser: () => opponent },
        reply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as any;
}

function buildButton(user: ReturnType<typeof buildUser>, customId: string) {
    return {
        customId,
        user,
        reply: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
    } as any;
}

const alice = buildUser('1');
const bob = buildUser('2');
const carol = buildUser('3');

beforeEach(() => {
    vi.useFakeTimers();
    renderRrCard.mockReset().mockResolvedValue(Buffer.from('png'));
    randomBelow.mockReset().mockReturnValue(0);
});

afterEach(() => {
    resetRrGamesForTests();
    vi.useRealTimers();
});

/**
 * Kolejnosc losowan przy przyjeciu: kto zaczyna (0 = wyzywajacy), pozycja kuli, obrot bebna.
 * Kolejne losowania (po zakreceniu): pozycja kuli, obrot bebna.
 */
async function startAndAccept(options: { starter?: 0 | 1; bulletAt?: number } = {}) {
    randomBelow
        .mockReturnValueOnce(options.starter ?? 0)
        .mockReturnValueOnce(options.bulletAt ?? 5)
        .mockReturnValueOnce(0);
    const command = buildCommand(alice, bob);
    await startRrChallenge(command);
    const accept = buildButton(bob, 'rr:accept:game-1');
    await handleRrButton(accept);
    return { command, accept };
}

async function click(user: ReturnType<typeof buildUser>, action: 'shoot' | 'spin') {
    const button = buildButton(user, `rr:${action}:game-1`);
    await handleRrButton(button);
    return button;
}

describe('rrCommand', () => {
    it('ma wymagana opcje osoba', () => {
        const json = rrCommand.data.toJSON();
        expect(json.name).toBe('rr');
        expect(json.options?.map((option) => option.name)).toEqual(['osoba']);
        expect(json.options?.[0]?.required).toBe(true);
    });
});

describe('startRrChallenge', () => {
    it.each([
        ['wyzwanie samego siebie', () => buildCommand(alice, alice)],
        ['wyzwanie bota', () => buildCommand(alice, buildUser('9', { bot: true }))],
        ['uzycie poza serwerem', () => buildCommand(alice, bob, { guildId: null })],
    ])('odrzuca: %s', async (_label, build) => {
        const command = build();
        await startRrChallenge(command);

        expect(command.reply.mock.calls[0][0].content).toContain('❌');
        expect(command.reply.mock.calls[0][0].components).toBeUndefined();
    });

    it('wysyla wyzwanie i blokuje druga gre tej pary', async () => {
        const command = buildCommand(alice, bob);
        await startRrChallenge(command);
        const second = buildCommand(bob, alice, { id: 'game-2' });
        await startRrChallenge(second);

        expect(command.reply.mock.calls[0][0].components).toHaveLength(1);
        expect(second.reply.mock.calls[0][0].content).toContain('trwa juz pojedynek');
    });
});

describe('handleRrButton - przed gra', () => {
    it('ignoruje cudze customId', async () => {
        expect(await handleRrButton(buildButton(alice, 'ttt:accept:game-1'))).toBe(false);
    });

    it('informuje o wygaslej grze', async () => {
        const button = buildButton(alice, 'rr:shoot:unknown');
        expect(await handleRrButton(button)).toBe(true);
        expect(button.reply.mock.calls[0][0].content).toContain('wygasl');
    });

    it('tylko wyzwany moze przyjac pojedynek', async () => {
        await startRrChallenge(buildCommand(alice, bob));
        const challenger = buildButton(alice, 'rr:accept:game-1');
        await handleRrButton(challenger);

        expect(challenger.deferUpdate).not.toHaveBeenCalled();
        expect(challenger.reply.mock.calls[0][0].content).toContain('Tylko wyzwany');
    });

    it('odrzucenie konczy gre i zwalnia pare', async () => {
        await startRrChallenge(buildCommand(alice, bob));
        await handleRrButton(buildButton(bob, 'rr:decline:game-1'));

        const again = buildCommand(alice, bob, { id: 'game-2' });
        await startRrChallenge(again);
        expect(again.reply.mock.calls[0][0].components).toHaveLength(1);
    });

    it('przyjecie pokazuje karte i dwa przyciski: Strzal oraz Zakrec bebnem', async () => {
        const { accept } = await startAndAccept();
        const payload = accept.editReply.mock.calls[0][0];
        const buttons = payload.components[0].components.map((component: any) => component.data);

        expect(buttons).toHaveLength(2);
        expect(buttons[0].custom_id).toBe('rr:shoot:game-1');
        expect(buttons[1].custom_id).toBe('rr:spin:game-1');
        expect(buttons[1].disabled).toBe(false);
        expect(payload.files).toHaveLength(1);
        expect(renderRrCard.mock.calls[0][0]).toMatchObject({ event: 'ready', activeIndex: 0, firedChambers: 0 });
    });
});

describe('handleRrButton - rozgrywka', () => {
    it('odrzuca ruch gracza, ktory nie ma tury, oraz obcego', async () => {
        await startAndAccept({ starter: 0 });
        const wrongTurn = await click(bob, 'shoot');
        const intruder = await click(carol, 'shoot');

        expect(wrongTurn.reply.mock.calls[0][0].content).toContain('nie Twoja kolej');
        expect(intruder.reply.mock.calls[0][0].content).toContain('nie jest Twoj');
        expect(wrongTurn.deferUpdate).not.toHaveBeenCalled();
    });

    it('pusty strzal przekazuje ture i odslania kolejna komore', async () => {
        await startAndAccept({ starter: 0, bulletAt: 5 });
        const shot = await click(alice, 'shoot');

        expect(shot.deferUpdate).toHaveBeenCalledTimes(1);
        const payload = shot.editReply.mock.calls[0][0];
        expect(payload.embeds[0].data.description).toContain('Klik');
        expect(payload.embeds[0].data.description).toContain('Ruch: <@2>');
        expect(renderRrCard.mock.calls.at(-1)![0]).toMatchObject({ event: 'click', activeIndex: 1, firedChambers: 1 });
    });

    it('trafiony strzal konczy gre wygrana rywala bez przyciskow', async () => {
        await startAndAccept({ starter: 0, bulletAt: 0 });
        const shot = await click(alice, 'shoot');

        const payload = shot.editReply.mock.calls[0][0];
        expect(payload.embeds[0].data.title).toBe('🏆 Wygrywa user-2!');
        expect(payload.components).toEqual([]);
        expect(renderRrCard.mock.calls.at(-1)![0]).toMatchObject({ event: 'bang', loserIndex: 0, activeIndex: null });
    });

    it('zakrecenie przekazuje ture, resetuje beben i wymusza strzal rywala', async () => {
        await startAndAccept({ starter: 0, bulletAt: 5 });
        await click(alice, 'shoot');
        randomBelow.mockReturnValueOnce(0).mockReturnValueOnce(3);
        const spin = await click(bob, 'spin');

        const payload = spin.editReply.mock.calls[0][0];
        const [shootButton, spinButton] = payload.components[0].components.map((component: any) => component.data);
        expect(payload.embeds[0].data.description).toContain('zakrecil beben');
        expect(payload.embeds[0].data.description).toContain('musi strzelic');
        expect(shootButton.disabled).toBeFalsy();
        expect(spinButton.disabled).toBe(true);
        expect(renderRrCard.mock.calls.at(-1)![0]).toMatchObject({
            event: 'spin',
            activeIndex: 0,
            firedChambers: 0,
            rotation: 3,
            spinsLeft: [1, 0],
        });
    });

    it('po zakreceniu rywal nie moze zakrecic ponownie, ale moze strzelic', async () => {
        await startAndAccept({ starter: 0 });
        await click(alice, 'spin');
        const forbidden = await click(bob, 'spin');

        expect(forbidden.reply.mock.calls[0][0].content).toContain('musisz strzelic');
        expect(forbidden.deferUpdate).not.toHaveBeenCalled();

        const shot = await click(bob, 'shoot');
        expect(shot.deferUpdate).toHaveBeenCalledTimes(1);
    });

    it('po wymuszonym strzale zakrecajacy znow ma wolny wybor, ale tylko jedno zakrecenie', async () => {
        await startAndAccept({ starter: 0 });
        randomBelow.mockReturnValue(5);
        await click(alice, 'spin');
        const forced = await click(bob, 'shoot');
        const [, spinButton] = forced.editReply.mock.calls[0][0].components[0].components.map(
            (component: any) => component.data,
        );
        expect(spinButton.disabled).toBe(true);

        const again = await click(alice, 'spin');
        expect(again.reply.mock.calls[0][0].content).toContain('Wykorzystales juz');
    });

    it('szybkie klikniecia nie psuja kolejnosci: drugi klik tego samego gracza jest odrzucony', async () => {
        await startAndAccept({ starter: 0, bulletAt: 5 });
        const first = buildButton(alice, 'rr:shoot:game-1');
        const second = buildButton(alice, 'rr:shoot:game-1');
        await Promise.all([handleRrButton(first), handleRrButton(second)]);

        expect(first.deferUpdate).toHaveBeenCalledTimes(1);
        expect(second.deferUpdate).not.toHaveBeenCalled();
        expect(second.reply.mock.calls[0][0].content).toContain('nie Twoja kolej');
    });

    it('kula trafia najpozniej w 6. strzale bez zakrecen', async () => {
        await startAndAccept({ starter: 0, bulletAt: 5 });
        let last = await click(alice, 'shoot');
        for (const player of [bob, alice, bob, alice]) {
            last = await click(player, 'shoot');
        }
        expect(last.editReply.mock.calls[0][0].components[0].components).toHaveLength(2);

        const final = await click(bob, 'shoot');
        expect(final.editReply.mock.calls[0][0].embeds[0].data.title).toBe('🏆 Wygrywa user-1!');
    });

    it('przy bledzie renderowania wraca do samego embeda', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await startAndAccept({ starter: 0, bulletAt: 5 });
        renderRrCard.mockRejectedValueOnce(new Error('canvas boom'));
        const shot = await click(alice, 'shoot');
        errorSpy.mockRestore();

        const payload = shot.editReply.mock.calls[0][0];
        expect(payload.files).toBeUndefined();
        expect(payload.embeds).toHaveLength(1);
        expect(payload.components).toHaveLength(1);
    });
});

describe('timeouty', () => {
    it('wygasa nieprzyjete wyzwanie', async () => {
        const command = buildCommand(alice, bob);
        await startRrChallenge(command);

        await vi.advanceTimersByTimeAsync(RR_ACCEPT_TIMEOUT_MS);

        expect(command.editReply).toHaveBeenCalledTimes(1);
        expect(command.editReply.mock.calls[0][0].components).toEqual([]);
    });

    it('bezczynny gracz ma spust pociagniety automatycznie', async () => {
        const { command } = await startAndAccept({ starter: 0, bulletAt: 5 });

        await vi.advanceTimersByTimeAsync(RR_TURN_TIMEOUT_MS);

        expect(command.editReply).toHaveBeenCalledTimes(1);
        expect(renderRrCard.mock.calls.at(-1)![0]).toMatchObject({ event: 'click', activeIndex: 1 });
    });

    it('wykonanie ruchu odnawia timer tury', async () => {
        const { command } = await startAndAccept({ starter: 0, bulletAt: 5 });
        await vi.advanceTimersByTimeAsync(RR_TURN_TIMEOUT_MS - 1_000);
        await click(alice, 'shoot');
        await vi.advanceTimersByTimeAsync(RR_TURN_TIMEOUT_MS - 1_000);

        expect(command.editReply).not.toHaveBeenCalled();
    });

    it('zakonczona gra nie wygasa pozniej', async () => {
        const { command } = await startAndAccept({ starter: 0, bulletAt: 0 });
        await click(alice, 'shoot');

        await vi.advanceTimersByTimeAsync(RR_TURN_TIMEOUT_MS * 2);

        expect(command.editReply).not.toHaveBeenCalled();
    });
});
