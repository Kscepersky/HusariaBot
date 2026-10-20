import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const renderPknCard = vi.hoisted(() => vi.fn());
const recordPknMatch = vi.hoisted(() => vi.fn());
vi.mock('./pkn-card-renderer.js', () => ({ renderPknCard }));
vi.mock('../economy/pkn-store.js', () => ({ recordPknMatch }));

import {
    PKN_ACCEPT_TIMEOUT_MS,
    PKN_PICK_TIMEOUT_MS,
    handlePknButton,
    resetPknGamesForTests,
    startPknChallenge,
} from './pkn-game.js';
import { pknCommand } from './pkn.js';

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
    renderPknCard.mockReset().mockResolvedValue(Buffer.from('png'));
    recordPknMatch.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
    resetPknGamesForTests();
    vi.useRealTimers();
});

async function startAndAccept() {
    const command = buildCommand(alice, bob);
    await startPknChallenge(command);
    await handlePknButton(buildButton(bob, 'pkn:accept:game-1'));
    return command;
}

describe('pknCommand', () => {
    it('ma wymagana opcje osoba', () => {
        const json = pknCommand.data.toJSON();
        expect(json.name).toBe('pkn');
        expect(json.options?.map((option) => option.name)).toEqual(['osoba']);
        expect(json.options?.[0]?.required).toBe(true);
    });
});

describe('startPknChallenge', () => {
    it.each([
        ['wyzwanie samego siebie', () => buildCommand(alice, alice)],
        ['wyzwanie bota', () => buildCommand(alice, buildUser('9', { bot: true }))],
        ['uzycie poza serwerem', () => buildCommand(alice, bob, { guildId: null })],
    ])('odrzuca: %s', async (_label, build) => {
        const command = build();
        await startPknChallenge(command);

        expect(command.reply.mock.calls[0][0].content).toContain('❌');
        expect(command.reply.mock.calls[0][0].components).toBeUndefined();
    });

    it('wysyla wyzwanie z przyciskami', async () => {
        const command = buildCommand(alice, bob);
        await startPknChallenge(command);

        expect(command.reply.mock.calls[0][0].components).toHaveLength(1);
    });

    it('blokuje drugie rownolegle wyzwanie tej samej pary', async () => {
        await startPknChallenge(buildCommand(alice, bob));
        const second = buildCommand(bob, alice, { id: 'game-2' });
        await startPknChallenge(second);

        expect(second.reply.mock.calls[0][0].content).toContain('trwa juz pojedynek');
    });
});

describe('handlePknButton', () => {
    it('ignoruje cudze customId', async () => {
        expect(await handlePknButton(buildButton(alice, 'economy_leaderboard:xp:1'))).toBe(false);
    });

    it('informuje o wygaslej grze', async () => {
        const button = buildButton(alice, 'pkn:accept:unknown');
        expect(await handlePknButton(button)).toBe(true);
        expect(button.reply.mock.calls[0][0].content).toContain('wygasl');
    });

    it('tylko wyzwany moze przyjac pojedynek', async () => {
        await startPknChallenge(buildCommand(alice, bob));

        const intruder = buildButton(carol, 'pkn:accept:game-1');
        await handlePknButton(intruder);
        const challenger = buildButton(alice, 'pkn:accept:game-1');
        await handlePknButton(challenger);

        expect(intruder.update).not.toHaveBeenCalled();
        expect(challenger.update).not.toHaveBeenCalled();
        expect(challenger.reply.mock.calls[0][0].content).toContain('Tylko wyzwany');
    });

    it('odrzucenie konczy gre i zwalnia pare', async () => {
        await startPknChallenge(buildCommand(alice, bob));
        const decline = buildButton(bob, 'pkn:decline:game-1');
        await handlePknButton(decline);

        expect(decline.update).toHaveBeenCalledTimes(1);
        const again = buildCommand(alice, bob, { id: 'game-2' });
        await startPknChallenge(again);
        expect(again.reply.mock.calls[0][0].components).toHaveLength(1);
    });

    it('obcy nie moze wybierac ruchu', async () => {
        await startAndAccept();
        const intruder = buildButton(carol, 'pkn:pick:game-1:rock');
        await handlePknButton(intruder);

        expect(intruder.reply.mock.calls[0][0].content).toContain('nie jest Twoj');
    });

    it('nie pozwala zmienic raz wybranego ruchu', async () => {
        await startAndAccept();
        await handlePknButton(buildButton(alice, 'pkn:pick:game-1:rock'));
        const second = buildButton(alice, 'pkn:pick:game-1:paper');
        await handlePknButton(second);

        expect(second.reply.mock.calls[0][0].content).toContain('Juz wybrales');
        expect(recordPknMatch).not.toHaveBeenCalled();
    });

    it('rozstrzyga pojedynek, zapisuje wynik i rysuje karte', async () => {
        await startAndAccept();
        const first = buildButton(alice, 'pkn:pick:game-1:paper');
        await handlePknButton(first);
        expect(first.reply.mock.calls[0][0].content).toContain('Papier');

        const last = buildButton(bob, 'pkn:pick:game-1:rock');
        await handlePknButton(last);

        expect(recordPknMatch).toHaveBeenCalledWith('guild-1', '1', '2', 'first');
        expect(renderPknCard.mock.calls[0][0]).toMatchObject({
            firstMove: 'paper',
            secondMove: 'rock',
            outcome: 'first',
        });
        expect(last.update.mock.calls[0][0].files).toHaveLength(1);
        expect(last.update.mock.calls[0][0].components).toEqual([]);
        const embed = last.update.mock.calls[0][0].embeds[0].data;
        expect(embed.title).toBe('🏆 Wygrywa user-1!');
        expect(embed.description).toBe('Papier vs Kamien');
    });

    it('wynik nie zalezy od kolejnosci klikniec', async () => {
        await startAndAccept();
        await handlePknButton(buildButton(bob, 'pkn:pick:game-1:scissors'));
        await handlePknButton(buildButton(alice, 'pkn:pick:game-1:rock'));

        expect(recordPknMatch).toHaveBeenCalledWith('guild-1', '1', '2', 'first');
    });

    it('zapisuje remis', async () => {
        await startAndAccept();
        await handlePknButton(buildButton(alice, 'pkn:pick:game-1:rock'));
        await handlePknButton(buildButton(bob, 'pkn:pick:game-1:rock'));

        expect(recordPknMatch).toHaveBeenCalledWith('guild-1', '1', '2', 'draw');
    });

    it('przy bledzie renderowania wraca do samego embeda', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        renderPknCard.mockRejectedValueOnce(new Error('canvas boom'));
        await startAndAccept();
        await handlePknButton(buildButton(alice, 'pkn:pick:game-1:rock'));
        const last = buildButton(bob, 'pkn:pick:game-1:paper');
        await handlePknButton(last);
        errorSpy.mockRestore();

        expect(last.update.mock.calls[0][0].files).toBeUndefined();
        expect(last.update.mock.calls[0][0].embeds).toHaveLength(1);
    });
});

describe('timeouty', () => {
    it('wygasa nieprzyjete wyzwanie', async () => {
        const command = buildCommand(alice, bob);
        await startPknChallenge(command);

        await vi.advanceTimersByTimeAsync(PKN_ACCEPT_TIMEOUT_MS);

        expect(command.editReply).toHaveBeenCalledTimes(1);
        expect(command.editReply.mock.calls[0][0].components).toEqual([]);
    });

    it('wygasa gra, w ktorej nikt nie wybral ruchu, bez zapisu do rankingu', async () => {
        const command = await startAndAccept();

        await vi.advanceTimersByTimeAsync(PKN_PICK_TIMEOUT_MS);

        expect(command.editReply).toHaveBeenCalledTimes(1);
        expect(recordPknMatch).not.toHaveBeenCalled();
    });

    it('rozstrzygnieta gra nie wygasa pozniej', async () => {
        const command = await startAndAccept();
        await handlePknButton(buildButton(alice, 'pkn:pick:game-1:rock'));
        await handlePknButton(buildButton(bob, 'pkn:pick:game-1:paper'));

        await vi.advanceTimersByTimeAsync(PKN_PICK_TIMEOUT_MS * 2);

        expect(command.editReply).not.toHaveBeenCalled();
    });
});
