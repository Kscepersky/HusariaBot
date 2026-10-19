import { beforeEach, describe, expect, it, vi } from 'vitest';

const renderShipCard = vi.hoisted(() => vi.fn());
vi.mock('./ship-card-renderer.js', () => ({ renderShipCard }));

import { zeswatajCommand } from './zeswataj.js';

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

function buildInteraction(
    caller: ReturnType<typeof buildUser>,
    first: ReturnType<typeof buildUser>,
    second: ReturnType<typeof buildUser>,
    guildId: string | null = 'guild-1',
) {
    return {
        guildId,
        commandName: 'zeswataj',
        user: caller,
        options: { getUser: (name: string) => (name === 'pierwsza' ? first : second) },
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
    } as any;
}

beforeEach(() => {
    renderShipCard.mockReset();
    renderShipCard.mockResolvedValue(Buffer.from('png'));
});

describe('zeswatajCommand', () => {
    it('ma dwie wymagane opcje: pierwsza i druga', () => {
        const json = zeswatajCommand.data.toJSON();
        expect(json.name).toBe('zeswataj');
        expect(json.options?.map((option) => option.name)).toEqual(['pierwsza', 'druga']);
        expect(json.options?.every((option) => option.required)).toBe(true);
    });

    it('swata wskazane osoby, a nie osobe wywolujaca', async () => {
        const interaction = buildInteraction(buildUser('1'), buildUser('2'), buildUser('3'));

        await zeswatajCommand.execute(interaction);

        const input = renderShipCard.mock.calls[0][0];
        expect(input.firstName).toBe('user-2');
        expect(input.secondName).toBe('user-3');
        expect(input.percent).toBeGreaterThanOrEqual(0);
        expect(input.percent).toBeLessThanOrEqual(100);
    });

    it('podpisuje embed osoba swatajaca', async () => {
        const interaction = buildInteraction(buildUser('1', { globalName: 'Swat' }), buildUser('2'), buildUser('3'));

        await zeswatajCommand.execute(interaction);

        const embed = interaction.editReply.mock.calls[0][0].embeds[0].toJSON();
        expect(embed.footer?.text).toBe('Swatem jest Swat');
        expect(embed.title).toContain('user-2 + user-3');
    });

    it('odrzuca wywolanie poza serwerem', async () => {
        const interaction = buildInteraction(buildUser('1'), buildUser('2'), buildUser('3'), null);

        await zeswatajCommand.execute(interaction);

        expect(interaction.reply).toHaveBeenCalledTimes(1);
        expect(interaction.deferReply).not.toHaveBeenCalled();
    });
});
