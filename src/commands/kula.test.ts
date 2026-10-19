import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kulaCommand } from './kula.js';
import { NO_ANSWERS, YES_ANSWERS } from './kula-answers.js';

function buildInteraction(question = 'Czy G2 wygra?', guildId: string | null = 'guild-1') {
    return {
        guildId,
        user: { id: '1', username: 'tester', globalName: null },
        options: { getString: () => question },
        reply: vi.fn().mockResolvedValue(undefined),
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
    } as any;
}

async function runCommand(interaction: ReturnType<typeof buildInteraction>) {
    const run = kulaCommand.execute(interaction);
    await vi.runAllTimersAsync();
    await run;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('kulaCommand', () => {
    it('ma wymagana opcje pytanie z limitem dlugosci', () => {
        const option = kulaCommand.data.toJSON().options?.[0] as { name: string; required: boolean; max_length: number };
        expect(option).toMatchObject({ name: 'pytanie', required: true, max_length: 200 });
    });

    it('edytuje wiadomosc kilka razy przed finalna odpowiedzia', async () => {
        const interaction = buildInteraction();

        await runCommand(interaction);

        expect(interaction.deferReply).toHaveBeenCalledWith();
        // 3 klatki animacji + odpowiedz koncowa.
        expect(interaction.editReply).toHaveBeenCalledTimes(4);
        const frames = interaction.editReply.mock.calls.slice(0, 3).map(([payload]: any) => payload.embeds[0].toJSON().description);
        expect(new Set(frames).size).toBe(3);
    });

    it('konczy zielonym embedem z odpowiedzia twierdzaca', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const interaction = buildInteraction();

        await runCommand(interaction);

        const final = interaction.editReply.mock.calls.at(-1)[0].embeds[0].toJSON();
        expect(final.title).toContain('TAK');
        expect(final.description).toContain('Czy G2 wygra?');
        expect(YES_ANSWERS.some((text) => final.description.includes(text))).toBe(true);
    });

    it('konczy czerwonym embedem z odpowiedzia przeczaca', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.999999);
        const interaction = buildInteraction();

        await runCommand(interaction);

        const final = interaction.editReply.mock.calls.at(-1)[0].embeds[0].toJSON();
        expect(final.title).toContain('NIE');
        expect(NO_ANSWERS.some((text) => final.description.includes(text))).toBe(true);
    });

    it('odrzuca wywolanie poza serwerem', async () => {
        const interaction = buildInteraction('Pytanie', null);

        await runCommand(interaction);

        expect(interaction.reply).toHaveBeenCalledTimes(1);
        expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    it('informuje o bledzie, gdy edycja wiadomosci sie nie uda', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const interaction = buildInteraction();
        interaction.editReply.mockRejectedValueOnce(new Error('discord boom'));

        await runCommand(interaction);

        expect(errorSpy).toHaveBeenCalled();
        expect(interaction.editReply.mock.calls.at(-1)[0].content).toContain('Kula');
    });
});
