import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadChampionCatalog = vi.fn();
const renderChampionCard = vi.fn();
const loadChampionLore = vi.fn();

vi.mock('./champion-data.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./champion-data.js')>()),
    loadChampionCatalog: (...args: unknown[]) => loadChampionCatalog(...args),
    loadChampionLore: (...args: unknown[]) => loadChampionLore(...args),
}));
vi.mock('./champion-card-renderer.js', () => ({
    renderChampionCard: (...args: unknown[]) => renderChampionCard(...args),
}));

import { championCommand } from './champion.js';

const CATALOG = {
    version: '16.1.1',
    champions: [
        { id: 'Ahri', name: 'Ahri', title: 'Lisica', blurb: 'Opis', tags: ['Mage'] },
        { id: 'Vex', name: 'Vex', title: 'Mroczna Zaloba', blurb: 'Opis Vex', tags: ['Mage'] },
    ],
};

function buildInteraction(userId = '1', guildId: string | null = 'guild-1') {
    return {
        guildId,
        user: {
            id: userId,
            username: 'tester',
            globalName: null,
            displayAvatarURL: () => 'https://example.com/a.png',
        },
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
    } as any;
}

async function runCommand(interaction: ReturnType<typeof buildInteraction>) {
    const run = championCommand.execute(interaction);
    await vi.runAllTimersAsync();
    await run;
}

beforeEach(() => {
    vi.useFakeTimers();
    loadChampionCatalog.mockResolvedValue(CATALOG);
    renderChampionCard.mockResolvedValue(Buffer.from('png'));
    loadChampionLore.mockResolvedValue('Oficjalne lore postaci. Drugie zdanie.');
});

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('championCommand', () => {
    it('nazywa sie champion i nie ma opcji', () => {
        const json = championCommand.data.toJSON();
        expect(json.name).toBe('champion');
        expect(json.options ?? []).toHaveLength(0);
    });

    it('odrzuca uzycie poza serwerem', async () => {
        const interaction = buildInteraction('1', null);

        await runCommand(interaction);

        expect(interaction.reply).toHaveBeenCalled();
        expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    it('wysyla karte jako zalacznik', async () => {
        const interaction = buildInteraction();

        await runCommand(interaction);

        const last = interaction.editReply.mock.calls.at(-1)![0];
        expect(last.files).toHaveLength(1);
        expect(last.embeds[0].toJSON().image.url).toBe('attachment://champion.png');
    });

    it('daje Vex z podpisem specjalnym dla wskazanego uzytkownika', async () => {
        const interaction = buildInteraction('682670238223040673');

        await runCommand(interaction);

        const rendered = renderChampionCard.mock.calls[0]![0];
        expect(rendered.championName).toBe('Vex');
        expect(rendered.caption).toBe('Ty to wiesz, ja to wiem, wszyscy to wiedzą');
        expect(rendered.splashUrl).toContain('/splash/Vex_0.jpg');
    });

    it('uzywa oficjalnego lore, a bez podpisu dla zwyklego uzytkownika', async () => {
        const interaction = buildInteraction('1');

        await runCommand(interaction);

        const rendered = renderChampionCard.mock.calls[0]![0];
        expect(rendered.blurb).toBe('Oficjalne lore postaci. Drugie zdanie.');
        expect(rendered.caption).toBe('');
    });

    it('wraca do blurba gdy lore sie nie pobierze', async () => {
        loadChampionLore.mockResolvedValue(null);
        const interaction = buildInteraction('682670238223040673');

        await runCommand(interaction);

        expect(renderChampionCard.mock.calls[0]![0].blurb).toBe('Opis Vex');
    });

    it('wraca do samego embeda gdy render sie nie uda', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        renderChampionCard.mockRejectedValue(new Error('boom'));
        const interaction = buildInteraction();

        await runCommand(interaction);

        const last = interaction.editReply.mock.calls.at(-1)![0];
        expect(last.embeds).toHaveLength(1);
        expect(last.files).toBeUndefined();
    });

    it('informuje o bledzie gdy nie ma danych z Data Dragona', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        loadChampionCatalog.mockRejectedValue(new Error('offline'));
        const interaction = buildInteraction();

        await runCommand(interaction);

        const last = interaction.editReply.mock.calls.at(-1)![0];
        expect(last.content).toContain('❌');
        expect(last.embeds).toEqual([]);
    });
});
