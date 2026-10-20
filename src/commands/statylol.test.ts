import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RiotApiError } from './riot-api.js';

const loadChampionCatalog = vi.fn();
const buildLolProfile = vi.fn();
const renderStatyLolCard = vi.fn();

vi.mock('./champion-data.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./champion-data.js')>()),
    loadChampionCatalog: (...args: unknown[]) => loadChampionCatalog(...args),
}));
vi.mock('./lol-profile.js', () => ({
    NO_LOL_PROFILE_MESSAGE: 'NO_LOL_PROFILE',
    buildLolProfile: (...args: unknown[]) => buildLolProfile(...args),
}));
vi.mock('./statylol-card-renderer.js', () => ({
    renderStatyLolCard: (...args: unknown[]) => renderStatyLolCard(...args),
}));

import { statylolCommand } from './statylol.js';

const PROFILE = {
    gameName: 'Nick', tagLine: 'EUNE', regionLabel: 'EUNE', level: 100, profileIconUrl: '',
    rank: null, mains: [], matches: [],
};

function buildInteraction(riottag = 'Nick#EUNE', region: string | null = null, guildId: string | null = 'guild-1') {
    return {
        guildId,
        user: { id: '1', username: 'tester', globalName: null },
        options: {
            getString: (name: string) => (name === 'riottag' ? riottag : region),
        },
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
    } as any;
}

beforeEach(() => {
    process.env.RIOT_API_KEY = 'RGAPI-test';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    loadChampionCatalog.mockResolvedValue({ version: '16.1.1', champions: [] });
    buildLolProfile.mockResolvedValue(PROFILE);
    renderStatyLolCard.mockResolvedValue(Buffer.from('png'));
});

afterEach(() => {
    delete process.env.RIOT_API_KEY;
    delete process.env.RIOT_DEFAULT_REGION;
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

function lastReply(interaction: ReturnType<typeof buildInteraction>) {
    return interaction.editReply.mock.calls.at(-1)![0];
}

describe('statylolCommand', () => {
    it('ma wymagana opcje riottag i opcjonalny region', () => {
        const options = statylolCommand.data.toJSON().options as Array<{ name: string; required?: boolean }>;
        expect(options.find((option) => option.name === 'riottag')?.required).toBe(true);
        expect(options.find((option) => option.name === 'region')?.required).toBeFalsy();
    });

    it('odrzuca uzycie poza serwerem', async () => {
        const interaction = buildInteraction('Nick#EUNE', null, null);

        await statylolCommand.execute(interaction);

        expect(interaction.reply).toHaveBeenCalled();
        expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    it('informuje o braku klucza API', async () => {
        delete process.env.RIOT_API_KEY;
        const interaction = buildInteraction();

        await statylolCommand.execute(interaction);

        expect(interaction.reply.mock.calls[0]![0].content).toContain('RIOT_API_KEY');
        expect(buildLolProfile).not.toHaveBeenCalled();
    });

    it('odrzuca niepoprawny format Riot ID', async () => {
        const interaction = buildInteraction('bez-tagu');

        await statylolCommand.execute(interaction);

        expect(interaction.reply.mock.calls[0]![0].content).toContain('Nick#TAG');
        expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    it('wysyla karte z domyslnym regionem EUNE', async () => {
        const interaction = buildInteraction();

        await statylolCommand.execute(interaction);

        expect(buildLolProfile.mock.calls[0]![3]).toBe('eune');
        expect(lastReply(interaction).files).toHaveLength(1);
        expect(lastReply(interaction).embeds[0].toJSON().image.url).toBe('attachment://statylol.png');
    });

    it('uzywa wybranego regionu', async () => {
        await statylolCommand.execute(buildInteraction('Nick#EUW', 'euw'));

        expect(buildLolProfile.mock.calls[0]![3]).toBe('euw');
    });

    it('zwraca czytelny komunikat dla 404, 403 i 429', async () => {
        for (const [status, fragment] of [[404, 'Nie znaleziono'], [404, 'nie ma profilu'], [403, 'klucz'], [429, 'limit']] as const) {
            buildLolProfile.mockRejectedValueOnce(new RiotApiError(status, fragment === 'nie ma profilu' ? 'NO_LOL_PROFILE' : 'x'));
            const interaction = buildInteraction();

            await statylolCommand.execute(interaction);

            expect(lastReply(interaction).content.toLowerCase()).toContain(fragment.toLowerCase());
        }
    });

    it('wraca do samego embeda gdy render sie nie uda', async () => {
        renderStatyLolCard.mockRejectedValue(new Error('boom'));
        const interaction = buildInteraction();

        await statylolCommand.execute(interaction);

        expect(lastReply(interaction).embeds).toHaveLength(1);
        expect(lastReply(interaction).files).toBeUndefined();
    });
});
