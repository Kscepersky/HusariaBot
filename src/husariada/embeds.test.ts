import { describe, expect, it } from 'vitest';
import { ButtonStyle } from 'discord.js';
import {
    buildAnswerButtons,
    buildAnswerCustomId,
    buildLeaderboardEmbed,
    buildLobbyEmbed,
    buildQuestionEmbed,
    buildResultsEmbeds,
    buildRevealEmbed,
    buildWinnerEmbed,
    FALLBACK_BRAND_EMOJI,
    parseAnswerCustomId,
    setHusariadaBrandEmoji,
} from './embeds.js';
import { DEFAULT_SETTINGS, type EventQuestion, type HusariadaEvent, type Standing } from './types.js';

const EVENT_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const DEADLINE = Date.UTC(2026, 10, 24, 18, 0, 15);

const event: HusariadaEvent = {
    id: EVENT_ID,
    quizId: 'quiz',
    quizTitle: 'Wiedza o G2',
    status: 'running',
    phase: 'question',
    currentIndex: 2,
    questionCount: 10,
    settings: DEFAULT_SETTINGS,
    startedBy: '1',
    createdAt: 0,
    startedAt: 0,
    finishedAt: null,
    questionStartedAt: null,
    questionDeadlineAt: null,
    questionMessageId: null,
    pauseRequested: false,
};

const question: EventQuestion = {
    index: 2,
    questionId: 'q',
    prompt: 'Kto wygrał LEC 2019?',
    answers: ['G2', 'Fnatic', 'Rogue', 'MAD'],
    correctIndex: 0,
    image: null,
};

function standing(place: number, userId: string, points: number): Standing {
    return { place, userId, displayName: `Gracz ${userId}`, avatarUrl: null, points, correctCount: 2, answeredCount: 3, correctResponseMs: 0 };
}

describe('customId odpowiedzi', () => {
    it('koduje i dekoduje event, pytanie i wybor', () => {
        const customId = buildAnswerCustomId(EVENT_ID, 2, 3);
        expect(customId.length).toBeLessThanOrEqual(100);
        expect(parseAnswerCustomId(customId)).toEqual({ eventId: EVENT_ID, questionIndex: 2, choiceIndex: 3 });
    });

    it('odrzuca obce i znieksztalcone ID', () => {
        expect(parseAnswerCustomId('husaria_ticket_open')).toBeNull();
        expect(parseAnswerCustomId(`hus:a:${EVENT_ID}:2:7`)).toBeNull();
        expect(parseAnswerCustomId('hus:a:bad:2:1')).toBeNull();
    });
});

describe('buildQuestionEmbed', () => {
    it('pokazuje numer pytania, odpowiedzi i odliczanie', () => {
        const embed = buildQuestionEmbed({ event, question, deadlineAt: DEADLINE, answeredCount: 4 }).toJSON();
        expect(embed.description).toContain('Pytanie 3/10');
        expect(embed.description).toContain(question.prompt);
        expect(embed.description).toContain(`<t:${Math.floor(DEADLINE / 1000)}:R>`);
        expect(embed.description).toContain('Fnatic');
        expect(embed.footer?.text).toContain('4');
    });

    it('ustawia obrazek, gdy pytanie go ma', () => {
        const embed = buildQuestionEmbed({ event, question, deadlineAt: DEADLINE, answeredCount: 0, imageUrl: 'attachment://x.png' }).toJSON();
        expect(embed.image?.url).toBe('attachment://x.png');
    });
});

describe('buildAnswerButtons', () => {
    it('tworzy 4 przyciski w dwoch rzedach', () => {
        const rows = buildAnswerButtons(EVENT_ID, question);
        const buttons = rows.flatMap((row) => row.toJSON().components);
        expect(rows).toHaveLength(2);
        expect(buttons).toHaveLength(4);
        expect(buttons.every((button) => !button.disabled)).toBe(true);
    });

    it('po odslonieciu wylacza przyciski i wyroznia poprawna odpowiedz', () => {
        const buttons = buildAnswerButtons(EVENT_ID, question, { reveal: true }).flatMap((row) => row.toJSON().components);
        expect(buttons.every((button) => button.disabled)).toBe(true);
        expect(buttons.map((button) => ('style' in button ? button.style : null))).toEqual([
            ButtonStyle.Success, ButtonStyle.Secondary, ButtonStyle.Secondary, ButtonStyle.Secondary,
        ]);
    });
});

describe('buildRevealEmbed', () => {
    it('pokazuje poprawna odpowiedz, rozklad i najszybszego', () => {
        const embed = buildRevealEmbed({
            event, question, distribution: [3, 1, 0, 0],
            fastest: { userId: '42', responseMs: 1234, points: 383 },
        }).toJSON();
        expect(embed.description).toContain('G2');
        expect(embed.description).toContain('75%');
        expect(embed.description).toContain('<@42>');
        expect(embed.description).toContain('1.23 s');
        expect(embed.description).toContain('3/4');
    });

    it('obsluguje brak odpowiedzi', () => {
        const embed = buildRevealEmbed({ event, question, distribution: [0, 0, 0, 0], fastest: null }).toJSON();
        expect(embed.description).toContain('Nikt');
    });
});

describe('ranking i wyniki', () => {
    it('top 3 zawiera medale i punkty', () => {
        const embed = buildLeaderboardEmbed({ event, standings: [standing(1, '1', 900), standing(2, '2', 500)], nextAt: DEADLINE }).toJSON();
        expect(embed.description).toContain('🥇');
        expect(embed.description).toContain('900');
        expect(embed.description).toContain('<@2>');
    });

    it('embed zwyciezcy pokazuje laureata', () => {
        const embed = buildWinnerEmbed({ event, winner: standing(1, '7', 1500), cancelled: false }).toJSON();
        expect(embed.description).toContain('<@7>');
        expect(embed.description).toContain('1500');
    });

    it('dzieli dluga liste wynikow na kilka embedow', () => {
        const standings = Array.from({ length: 120 }, (_, index) => standing(index + 1, String(1000 + index), 1000 - index));
        const embeds = buildResultsEmbeds({ event, standings, cancelled: true });
        expect(embeds.length).toBeGreaterThan(1);
        expect(embeds.every((embed) => (embed.toJSON().description ?? '').length <= 4096)).toBe(true);
        expect(embeds[0].toJSON().description).toContain('przedwcześnie');
    });

    it('lobby informuje o braku eventu', () => {
        expect(buildLobbyEmbed(DEFAULT_SETTINGS).toJSON().description).toContain('nie trwa');
    });

    it('uzywa emotki serwera w tytule, z zapasowa ikona', () => {
        setHusariadaBrandEmoji('<:G2Hussars:123456789012345678>');
        expect(buildLobbyEmbed(DEFAULT_SETTINGS).toJSON().description).toContain('# <:G2Hussars:123456789012345678> Husariada');
        setHusariadaBrandEmoji(null);
        expect(buildLobbyEmbed(DEFAULT_SETTINGS).toJSON().description).toContain(`# ${FALLBACK_BRAND_EMOJI} Husariada`);
    });
});
