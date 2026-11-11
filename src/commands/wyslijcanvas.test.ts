import { beforeEach, describe, expect, it, vi } from 'vitest';

const OWNER_ID = '100000000000000001';
const OUTSIDER_ID = '100000000000000009';
process.env.OWNER_ID = OWNER_ID;
process.env.PERMISSIONS_DB_PATH = ':memory:';

const renderTitleCard = vi.hoisted(() => vi.fn());
vi.mock('./title-card-renderer.js', () => ({ renderTitleCard }));

import { CHANNEL_CANVASES } from './channel-canvases.js';
import { wyslijCanvasCommand } from './wyslijcanvas.js';

function buildInteraction(userId: string, options: { canvas?: string | null; channel?: unknown } = {}) {
    const send = vi.fn().mockResolvedValue(undefined);
    const channel = 'channel' in options ? options.channel : { isTextBased: () => true, send };
    return {
        user: { id: userId },
        channelId: '300000000000000001',
        channel,
        options: { getString: vi.fn(() => options.canvas ?? null) },
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        send,
    } as any;
}

beforeEach(() => {
    renderTitleCard.mockReset().mockResolvedValue(Buffer.from('png-bytes'));
});

describe('definicja komendy', () => {
    it('ma nazwe /wyslijcanvas i wybor REGULAMIN', () => {
        const json = wyslijCanvasCommand.data.toJSON();
        const option = json.options?.[0] as { name: string; required?: boolean; choices?: { name: string; value: string }[] };

        expect(json.name).toBe('wyslijcanvas');
        expect(option.name).toBe('canvas');
        expect(option.required).toBeFalsy();
        expect(option.choices).toEqual(CHANNEL_CANVASES.map((canvas) => ({ name: canvas.label, value: canvas.key })));
        expect(option.choices?.[0]).toEqual({ name: 'REGULAMIN', value: 'regulamin' });
    });

    it('nie jest dostepna w DM', () => {
        expect(wyslijCanvasCommand.data.toJSON().dm_permission).toBe(false);
    });
});

describe('/wyslijcanvas', () => {
    it('odmawia osobie bez uprawnien i nic nie renderuje ani nie wysyla', async () => {
        const interaction = buildInteraction(OUTSIDER_ID);

        await wyslijCanvasCommand.execute(interaction);

        expect(interaction.reply).toHaveBeenCalledTimes(1);
        expect(interaction.reply.mock.calls[0][0].flags).toBe(64);
        expect(renderTitleCard).not.toHaveBeenCalled();
        expect(interaction.send).not.toHaveBeenCalled();
    });

    it('wysyla REGULAMIN jako plik PNG na kanal, a potwierdzenie jest tylko dla autora', async () => {
        const interaction = buildInteraction(OWNER_ID);

        await wyslijCanvasCommand.execute(interaction);

        expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
        expect(renderTitleCard).toHaveBeenCalledWith({ title: 'REGULAMIN' });
        expect(interaction.send).toHaveBeenCalledTimes(1);

        const payload = interaction.send.mock.calls[0][0];
        expect(payload.files).toHaveLength(1);
        expect(payload.files[0].name).toBe('regulamin.png');
        expect(payload.files[0].attachment).toEqual(Buffer.from('png-bytes'));
        expect(payload.content).toBeUndefined();

        expect(interaction.editReply.mock.calls[0][0].content).toContain('REGULAMIN');
    });

    it('wybrany canvas jest uzywany', async () => {
        const interaction = buildInteraction(OWNER_ID, { canvas: 'regulamin' });
        await wyslijCanvasCommand.execute(interaction);
        expect(interaction.send).toHaveBeenCalledTimes(1);
    });

    it('nieznany canvas = blad bez wysylki', async () => {
        const interaction = buildInteraction(OWNER_ID, { canvas: 'nie-ma' });

        await wyslijCanvasCommand.execute(interaction);

        expect(interaction.reply.mock.calls[0][0].content).toContain('Nieznany');
        expect(interaction.send).not.toHaveBeenCalled();
    });

    it('kanal bez wysylania wiadomosci = blad', async () => {
        const interaction = buildInteraction(OWNER_ID, { channel: { isTextBased: () => false } });

        await wyslijCanvasCommand.execute(interaction);

        expect(interaction.reply.mock.calls[0][0].content).toContain('nie obsługuje');
        expect(renderTitleCard).not.toHaveBeenCalled();
    });

    it('brak kanalu (null) = blad', async () => {
        const interaction = buildInteraction(OWNER_ID, { channel: null });
        await wyslijCanvasCommand.execute(interaction);
        expect(interaction.reply.mock.calls[0][0].content).toContain('nie obsługuje');
    });

    it('blad renderu nie wysyla nic na kanal i informuje autora', async () => {
        renderTitleCard.mockRejectedValue(new Error('canvas padl'));
        const interaction = buildInteraction(OWNER_ID);

        await wyslijCanvasCommand.execute(interaction);

        expect(interaction.send).not.toHaveBeenCalled();
        expect(interaction.editReply.mock.calls[0][0].content).toContain('Nie udało się wygenerować');
    });

    it('brak uprawnien bota na kanale daje czytelny komunikat', async () => {
        const interaction = buildInteraction(OWNER_ID);
        interaction.send.mockRejectedValue(Object.assign(new Error('Missing Permissions'), { code: 50013 }));

        await wyslijCanvasCommand.execute(interaction);

        expect(interaction.editReply.mock.calls[0][0].content).toContain('Bot nie ma uprawnień');
    });

    it('inny blad wysylki daje ogolny komunikat', async () => {
        const interaction = buildInteraction(OWNER_ID);
        interaction.send.mockRejectedValue(new Error('boom'));

        await wyslijCanvasCommand.execute(interaction);

        expect(interaction.editReply.mock.calls[0][0].content).toContain('Nie udało się wysłać');
    });
});
