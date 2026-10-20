import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const renderTttCard = vi.hoisted(() => vi.fn());
const recordTttMatch = vi.hoisted(() => vi.fn());
vi.mock('./ttt-card-renderer.js', () => ({ renderTttCard }));
vi.mock('../economy/ttt-store.js', () => ({ recordTttMatch }));

import {
    TTT_ACCEPT_TIMEOUT_MS,
    TTT_TURN_TIMEOUT_MS,
    handleTttButton,
    resetTttGamesForTests,
    startTttChallenge,
} from './ttt-game.js';
import { kkCommand } from './kk.js';

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
    } as any;
}

const alice = buildUser('1');
const bob = buildUser('2');
const carol = buildUser('3');

beforeEach(() => {
    vi.useFakeTimers();
    renderTttCard.mockReset().mockResolvedValue(Buffer.from('png'));
    recordTttMatch.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
    resetTttGamesForTests();
    vi.useRealTimers();
});

/** Math.random < 0.5 => wyzywajacy (alice) dostaje X i zaczyna. */
async function startAndAccept(challengerStarts = true) {
    vi.spyOn(Math, 'random').mockReturnValue(challengerStarts ? 0.1 : 0.9);
    const command = buildCommand(alice, bob);
    await startTttChallenge(command);
    const accept = buildButton(bob, 'ttt:accept:game-1');
    await handleTttButton(accept);
    return { command, accept };
}

async function play(moves: Array<[ReturnType<typeof buildUser>, number]>) {
    const buttons = [];
    for (const [user, cell] of moves) {
        const button = buildButton(user, `ttt:move:game-1:${cell}`);
        await handleTttButton(button);
        buttons.push(button);
    }
    return buttons;
}

describe('kkCommand', () => {
    it('ma wymagana opcje osoba', () => {
        const json = kkCommand.data.toJSON();
        expect(json.name).toBe('kk');
        expect(json.options?.map((option) => option.name)).toEqual(['osoba']);
        expect(json.options?.[0]?.required).toBe(true);
    });
});

describe('startTttChallenge', () => {
    it.each([
        ['wyzwanie samego siebie', () => buildCommand(alice, alice)],
        ['wyzwanie bota', () => buildCommand(alice, buildUser('9', { bot: true }))],
        ['uzycie poza serwerem', () => buildCommand(alice, bob, { guildId: null })],
    ])('odrzuca: %s', async (_label, build) => {
        const command = build();
        await startTttChallenge(command);

        expect(command.reply.mock.calls[0][0].content).toContain('❌');
        expect(command.reply.mock.calls[0][0].components).toBeUndefined();
    });

    it('wysyla wyzwanie z przyciskami i blokuje druga gre tej pary', async () => {
        const command = buildCommand(alice, bob);
        await startTttChallenge(command);
        const second = buildCommand(bob, alice, { id: 'game-2' });
        await startTttChallenge(second);

        expect(command.reply.mock.calls[0][0].components).toHaveLength(1);
        expect(second.reply.mock.calls[0][0].content).toContain('trwa juz pojedynek');
    });
});

describe('handleTttButton - przed gra', () => {
    it('ignoruje cudze customId', async () => {
        expect(await handleTttButton(buildButton(alice, 'pkn:accept:game-1'))).toBe(false);
    });

    it('informuje o wygaslej grze', async () => {
        const button = buildButton(alice, 'ttt:accept:unknown');
        expect(await handleTttButton(button)).toBe(true);
        expect(button.reply.mock.calls[0][0].content).toContain('wygasl');
    });

    it('tylko wyzwany moze przyjac pojedynek', async () => {
        await startTttChallenge(buildCommand(alice, bob));
        const challenger = buildButton(alice, 'ttt:accept:game-1');
        await handleTttButton(challenger);

        expect(challenger.update).not.toHaveBeenCalled();
        expect(challenger.reply.mock.calls[0][0].content).toContain('Tylko wyzwany');
    });

    it('odrzucenie konczy gre i zwalnia pare', async () => {
        await startTttChallenge(buildCommand(alice, bob));
        await handleTttButton(buildButton(bob, 'ttt:decline:game-1'));

        const again = buildCommand(alice, bob, { id: 'game-2' });
        await startTttChallenge(again);
        expect(again.reply.mock.calls[0][0].components).toHaveLength(1);
    });

    it('przyjecie pokazuje plansze 3x3 z rzedem poddania', async () => {
        const { accept } = await startAndAccept();
        const rows = accept.update.mock.calls[0][0].components;

        expect(rows).toHaveLength(4);
        expect(rows[0].components).toHaveLength(3);
        expect(rows[3].components).toHaveLength(1);
    });
});

describe('handleTttButton - rozgrywka', () => {
    it('odrzuca ruch gracza, ktory nie ma tury, oraz obcego', async () => {
        await startAndAccept();
        const wrongTurn = buildButton(bob, 'ttt:move:game-1:0');
        await handleTttButton(wrongTurn);
        const intruder = buildButton(carol, 'ttt:move:game-1:0');
        await handleTttButton(intruder);

        expect(wrongTurn.reply.mock.calls[0][0].content).toContain('nie Twoja kolej');
        expect(intruder.reply.mock.calls[0][0].content).toContain('nie jest Twoj');
        expect(wrongTurn.update).not.toHaveBeenCalled();
    });

    it('po ruchu zmienia ture i zaznacza pole', async () => {
        await startAndAccept();
        const [move] = await play([[alice, 4]]);
        const payload = move!.update.mock.calls[0][0];

        expect(payload.embeds[0].data.description).toContain('<@2>');
        expect(payload.components[1].components[1].data.disabled).toBe(true);
    });

    it('odrzuca zajete pole bez zmiany tury', async () => {
        await startAndAccept();
        await play([[alice, 4]]);
        const taken = buildButton(bob, 'ttt:move:game-1:4');
        await handleTttButton(taken);

        expect(taken.reply.mock.calls[0][0].content).toContain('zajete');
        expect(taken.update).not.toHaveBeenCalled();
    });

    it('rozstrzyga wygrana wyzywajacego, zapisuje wynik i rysuje karte', async () => {
        await startAndAccept(true);
        const buttons = await play([[alice, 0], [bob, 3], [alice, 1], [bob, 4], [alice, 2]]);
        const last = buttons[buttons.length - 1]!;

        expect(recordTttMatch).toHaveBeenCalledWith('guild-1', '1', '2', 'first');
        expect(renderTttCard.mock.calls[0][0].result).toMatchObject({ kind: 'win', mark: 'X' });
        expect(last.update.mock.calls[0][0].files).toHaveLength(1);
        expect(last.update.mock.calls[0][0].components).toEqual([]);
        expect(last.update.mock.calls[0][0].embeds[0].data.title).toBe('🏆 Wygrywa user-1!');
    });

    it('zapisuje wygrana wyzwanego, gdy to on ma X i zaczyna', async () => {
        await startAndAccept(false);
        await play([[bob, 0], [alice, 3], [bob, 1], [alice, 4], [bob, 2]]);

        expect(recordTttMatch).toHaveBeenCalledWith('guild-1', '1', '2', 'second');
    });

    it('zapisuje remis', async () => {
        await startAndAccept(true);
        await play([
            [alice, 0], [bob, 1], [alice, 2],
            [bob, 4], [alice, 3], [bob, 5],
            [alice, 7], [bob, 6], [alice, 8],
        ]);

        expect(recordTttMatch).toHaveBeenCalledWith('guild-1', '1', '2', 'draw');
    });

    it('poddanie daje wygrana przeciwnikowi', async () => {
        await startAndAccept();
        const surrender = buildButton(alice, 'ttt:surrender:game-1');
        await handleTttButton(surrender);

        expect(recordTttMatch).toHaveBeenCalledWith('guild-1', '1', '2', 'second');
        expect(surrender.update.mock.calls[0][0].embeds[0].data.title).toContain('sie poddaje');
    });

    it('obcy nie moze sie poddac za gracza', async () => {
        await startAndAccept();
        const intruder = buildButton(carol, 'ttt:surrender:game-1');
        await handleTttButton(intruder);

        expect(recordTttMatch).not.toHaveBeenCalled();
        expect(intruder.reply).toHaveBeenCalledTimes(1);
    });

    it('przy bledzie renderowania wraca do samego embeda', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        renderTttCard.mockRejectedValueOnce(new Error('canvas boom'));
        await startAndAccept(true);
        const buttons = await play([[alice, 0], [bob, 3], [alice, 1], [bob, 4], [alice, 2]]);
        errorSpy.mockRestore();

        const payload = buttons[buttons.length - 1]!.update.mock.calls[0][0];
        expect(payload.files).toBeUndefined();
        expect(payload.embeds).toHaveLength(1);
    });
});

describe('timeouty', () => {
    it('wygasa nieprzyjete wyzwanie bez wpisu do rankingu', async () => {
        const command = buildCommand(alice, bob);
        await startTttChallenge(command);

        await vi.advanceTimersByTimeAsync(TTT_ACCEPT_TIMEOUT_MS);

        expect(command.editReply).toHaveBeenCalledTimes(1);
        expect(recordTttMatch).not.toHaveBeenCalled();
    });

    it('walkower: bezczynny gracz przegrywa', async () => {
        const { command } = await startAndAccept(true);

        await vi.advanceTimersByTimeAsync(TTT_TURN_TIMEOUT_MS);

        expect(recordTttMatch).toHaveBeenCalledWith('guild-1', '1', '2', 'second');
        expect(command.editReply.mock.calls[0][0].embeds[0].data.title).toContain('Walkower');
    });

    it('wykonanie ruchu odnawia timer tury', async () => {
        const { command } = await startAndAccept(true);
        await vi.advanceTimersByTimeAsync(TTT_TURN_TIMEOUT_MS - 1_000);
        await play([[alice, 0]]);
        await vi.advanceTimersByTimeAsync(TTT_TURN_TIMEOUT_MS - 1_000);

        expect(command.editReply).not.toHaveBeenCalled();
    });

    it('zakonczona gra nie wygasa pozniej', async () => {
        const { command } = await startAndAccept(true);
        await play([[alice, 0], [bob, 3], [alice, 1], [bob, 4], [alice, 2]]);

        await vi.advanceTimersByTimeAsync(TTT_TURN_TIMEOUT_MS * 2);

        expect(command.editReply).not.toHaveBeenCalled();
        expect(recordTttMatch).toHaveBeenCalledTimes(1);
    });
});
