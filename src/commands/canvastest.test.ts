import { beforeEach, describe, expect, it, vi } from 'vitest';

const OWNER_ID = '100000000000000001';
process.env.OWNER_ID = OWNER_ID;
process.env.PERMISSIONS_DB_PATH = ':memory:';

const renderLevelCard = vi.hoisted(() => vi.fn());
const renderShipCard = vi.hoisted(() => vi.fn());
vi.mock('./level-card-renderer.js', () => ({ renderLevelCard }));
vi.mock('./ship-card-renderer.js', () => ({ renderShipCard }));

import { canvastestCommand } from './canvastest.js';
import { CANVAS_PREVIEWS } from './canvas-previews.js';

function buildUser(id: string) {
    return {
        id,
        username: `user-${id}`,
        globalName: null,
        displayAvatarURL: () => `https://cdn.example/${id}.png`,
    };
}

function buildInteraction(userId: string, card: string | null = null) {
    return {
        user: buildUser(userId),
        client: { user: buildUser('bot') },
        options: { getString: () => card },
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
    } as any;
}

beforeEach(() => {
    renderLevelCard.mockReset().mockResolvedValue(Buffer.from('level'));
    renderShipCard.mockReset().mockResolvedValue(Buffer.from('ship'));
});

describe('canvastestCommand', () => {
    it('udostepnia wybor kazdej zarejestrowanej karty', () => {
        const option = canvastestCommand.data.toJSON().options?.[0] as { choices?: { value: string }[] };
        expect(option.choices?.map((choice) => choice.value)).toEqual(CANVAS_PREVIEWS.map((preview) => preview.key));
    });

    it('odrzuca uzytkownika, ktory nie jest ownerem', async () => {
        const interaction = buildInteraction('200000000000000002');

        await canvastestCommand.execute(interaction);

        expect(interaction.reply).toHaveBeenCalledTimes(1);
        expect(interaction.deferReply).not.toHaveBeenCalled();
        expect(renderLevelCard).not.toHaveBeenCalled();
    });

    it('bez argumentu renderuje wszystkie karty', async () => {
        const interaction = buildInteraction(OWNER_ID);

        await canvastestCommand.execute(interaction);

        const payload = interaction.editReply.mock.calls[0][0];
        expect(payload.files).toHaveLength(CANVAS_PREVIEWS.length);
        expect(renderLevelCard).toHaveBeenCalledTimes(1);
        expect(renderShipCard).toHaveBeenCalledTimes(1);
    });

    it('z argumentem renderuje tylko wybrana karte', async () => {
        const interaction = buildInteraction(OWNER_ID, 'ship');

        await canvastestCommand.execute(interaction);

        expect(interaction.editReply.mock.calls[0][0].files).toHaveLength(1);
        expect(renderShipCard).toHaveBeenCalledTimes(1);
        expect(renderLevelCard).not.toHaveBeenCalled();
    });

    it('zglasza blad jednej karty, ale pokazuje pozostale', async () => {
        renderLevelCard.mockRejectedValueOnce(new Error('canvas boom'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const interaction = buildInteraction(OWNER_ID);

        await canvastestCommand.execute(interaction);
        errorSpy.mockRestore();

        const payload = interaction.editReply.mock.calls[0][0];
        expect(payload.files).toHaveLength(CANVAS_PREVIEWS.length - 1);
        expect(payload.content).toContain('Blad renderowania');
    });
});
