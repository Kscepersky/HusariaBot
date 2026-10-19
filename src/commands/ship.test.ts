import { beforeEach, describe, expect, it, vi } from 'vitest';

const renderShipCard = vi.hoisted(() => vi.fn());
vi.mock('./ship-card-renderer.js', () => ({ renderShipCard }));

import { shipCommand } from './ship.js';

function buildUser(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        username: `user-${id}`,
        globalName: null,
        bot: false,
        displayAvatarURL: () => `https://cdn.example/${id}.png`,
        ...overrides,
    };
}

function buildInteraction(caller: ReturnType<typeof buildUser>, target: ReturnType<typeof buildUser>, guildId: string | null = 'guild-1') {
    return {
        guildId,
        user: caller,
        options: { getUser: () => target },
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
    } as any;
}

beforeEach(() => {
    renderShipCard.mockReset();
    renderShipCard.mockResolvedValue(Buffer.from('png'));
});

describe('shipCommand', () => {
    it('ma wymagana opcje osoba', () => {
        const json = shipCommand.data.toJSON();
        expect(json.name).toBe('ship');
        expect(json.options?.[0]).toMatchObject({ name: 'osoba', required: true });
    });

    it('odpowiada publicznie embedem z karta i wynikiem z zakresu 0-100', async () => {
        const interaction = buildInteraction(buildUser('1'), buildUser('2'));

        await shipCommand.execute(interaction);

        expect(interaction.deferReply).toHaveBeenCalledWith();
        const payload = interaction.editReply.mock.calls[0][0];
        expect(payload.files).toHaveLength(1);
        expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://ship.png');

        const { percent } = renderShipCard.mock.calls[0][0];
        expect(percent).toBeGreaterThanOrEqual(0);
        expect(percent).toBeLessThanOrEqual(100);
    });

    it('przy kazdym uzyciu losuje wynik na nowo', async () => {
        const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.9);

        await shipCommand.execute(buildInteraction(buildUser('1'), buildUser('2')));
        await shipCommand.execute(buildInteraction(buildUser('1'), buildUser('2')));
        random.mockRestore();

        const [first, second] = renderShipCard.mock.calls.map(([input]) => input.percent);
        expect(first).not.toBe(second);
    });

    it('daje 100% przy shipowaniu samego siebie', async () => {
        const me = buildUser('1');

        await shipCommand.execute(buildInteraction(me, me));

        expect(renderShipCard.mock.calls[0][0].percent).toBe(100);
    });

    it('wraca do samego embeda gdy renderowanie karty sie nie uda', async () => {
        renderShipCard.mockRejectedValueOnce(new Error('canvas boom'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const interaction = buildInteraction(buildUser('1'), buildUser('2'));

        await shipCommand.execute(interaction);
        errorSpy.mockRestore();

        const payload = interaction.editReply.mock.calls[0][0];
        expect(payload.files).toBeUndefined();
        expect(payload.embeds[0].toJSON().title).toContain('Ship');
    });

    it('odrzuca wywolanie poza serwerem', async () => {
        const interaction = buildInteraction(buildUser('1'), buildUser('2'), null);

        await shipCommand.execute(interaction);

        expect(interaction.reply).toHaveBeenCalledTimes(1);
        expect(interaction.deferReply).not.toHaveBeenCalled();
    });
});
