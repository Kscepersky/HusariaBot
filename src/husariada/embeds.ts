import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import { ANSWER_COUNT, type EventQuestion, type HusariadaEvent, type HusariadaSettings, type Standing } from './types.js';

/** Czyste buildery embedow i przyciskow Husariady (bez wywolan Discorda). */

const CUSTOM_ID_PREFIX = 'hus:a';
const CUSTOM_ID_PATTERN = /^hus:a:([0-9a-f-]{36}):(\d{1,3}):([0-3])$/;
const ANSWER_LETTERS = ['A', 'B', 'C', 'D'] as const;
/** Kolory odpowiedzi jak w Kahoot. */
const ANSWER_EMOJIS = ['🟥', '🟦', '🟨', '🟩'] as const;
const ANSWER_STYLES = [ButtonStyle.Danger, ButtonStyle.Primary, ButtonStyle.Secondary, ButtonStyle.Success] as const;
const MEDALS = ['🥇', '🥈', '🥉'] as const;
const BAR_LENGTH = 12;
const RESULTS_LINES_PER_EMBED = 40;
const BUTTON_LABEL_MAX = 80;
/** Zapasowa ikona, gdy na serwerze nie ma emotki G2Hussars. */
export const FALLBACK_BRAND_EMOJI = '⚔️';
let brandEmoji = FALLBACK_BRAND_EMOJI;

/** Ustawiana przez port Discorda na emotke serwera (G2Hussars). */
export function setHusariadaBrandEmoji(emoji: string | null | undefined): void {
    brandEmoji = emoji && emoji.trim() ? emoji : FALLBACK_BRAND_EMOJI;
}

function title(): string {
    return `${brandEmoji} Husariada`;
}

export interface ParsedAnswerId {
    eventId: string;
    questionIndex: number;
    choiceIndex: number;
}

export interface FastestAnswer {
    userId: string;
    responseMs: number;
    points: number;
}

const toUnix = (timestampMs: number): number => Math.floor(timestampMs / 1000);
const relative = (timestampMs: number): string => `<t:${toUnix(timestampMs)}:R>`;

export function buildAnswerCustomId(eventId: string, questionIndex: number, choiceIndex: number): string {
    return `${CUSTOM_ID_PREFIX}:${eventId}:${questionIndex}:${choiceIndex}`;
}

export function isAnswerCustomId(customId: string): boolean {
    return customId.startsWith(`${CUSTOM_ID_PREFIX}:`);
}

export function parseAnswerCustomId(customId: string): ParsedAnswerId | null {
    const match = customId.match(CUSTOM_ID_PATTERN);
    if (!match) {
        return null;
    }
    return { eventId: match[1], questionIndex: Number(match[2]), choiceIndex: Number(match[3]) };
}

export function answerLabel(index: number): string {
    return `${ANSWER_EMOJIS[index]} ${ANSWER_LETTERS[index]}`;
}

function truncate(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function questionHeader(event: HusariadaEvent, question: EventQuestion): string {
    return `# ${title()} · Pytanie ${question.index + 1}/${event.questionCount}\n### ${question.prompt}`;
}

function rulesText(settings: HusariadaSettings): string {
    return [
        `⏱️ **${settings.timeLimitSec} s** na każde pytanie, jedna odpowiedź na osobę.`,
        `⚡ Im szybciej poprawnie, tym więcej punktów: od **${settings.maxPoints}** do **${Math.round(settings.maxPoints / 2)}** pkt.`,
        '❌ Błędna odpowiedź lub jej brak = **0 pkt**.',
        settings.leaderboardEvery > 0 ? `📊 Co **${settings.leaderboardEvery}** pytań ranking TOP 3.` : null,
    ].filter(Boolean).join('\n');
}

export function buildLobbyEmbed(settings: HusariadaSettings): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(HusariaColors.DARK_GRAY)
        .setDescription(
            `# ${title()}\nAktualnie nie trwa żaden event.\n\n`
            + 'Gdy administracja uruchomi Husariadę, pytania pojawią się na tym kanale. '
            + 'Odpowiadaj przyciskami pod pytaniem — liczy się poprawność i szybkość!\n\n'
            + `**Zasady**\n${rulesText(settings)}`,
        )
        .setFooter({ text: 'Husariada · quiz G2 Hussars' });
}

export function buildIntroEmbed(event: HusariadaEvent, startsAt: number): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(HusariaColors.GOLD)
        .setDescription(
            `# ${title()} startuje!\n## ${event.quizTitle}\n`
            + `📝 Pytań: **${event.questionCount}**\n🚀 Pierwsze pytanie ${relative(startsAt)}\n\n`
            + `**Zasady**\n${rulesText(event.settings)}`,
        );
}

export function buildQuestionEmbed(input: {
    event: HusariadaEvent;
    question: EventQuestion;
    deadlineAt: number;
    answeredCount: number;
    imageUrl?: string | null;
}): EmbedBuilder {
    const answers = input.question.answers.map((answer, index) => `${answerLabel(index)} — **${answer}**`).join('\n');
    const embed = new EmbedBuilder()
        .setColor(HusariaColors.RED)
        .setDescription(`${questionHeader(input.event, input.question)}\n\n${answers}\n\n⏱️ Koniec czasu ${relative(input.deadlineAt)}`)
        .setFooter({ text: `Odpowiedzi: ${input.answeredCount} · max ${input.event.settings.maxPoints} pkt` });
    if (input.imageUrl) {
        embed.setImage(input.imageUrl);
    }
    return embed;
}

export function buildAnswerButtons(
    eventId: string,
    question: EventQuestion,
    options: { reveal?: boolean } = {},
): ActionRowBuilder<ButtonBuilder>[] {
    const buttons = Array.from({ length: ANSWER_COUNT }, (_, index) => {
        const style = options.reveal
            ? (index === question.correctIndex ? ButtonStyle.Success : ButtonStyle.Secondary)
            : ANSWER_STYLES[index];
        return new ButtonBuilder()
            .setCustomId(buildAnswerCustomId(eventId, question.index, index))
            .setEmoji(ANSWER_EMOJIS[index])
            .setLabel(truncate(`${ANSWER_LETTERS[index]}: ${question.answers[index]}`, BUTTON_LABEL_MAX))
            .setStyle(style)
            .setDisabled(Boolean(options.reveal));
    });
    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(0, 2)),
        new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(2, 4)),
    ];
}

function progressBar(share: number): string {
    const filled = Math.round(share * BAR_LENGTH);
    return `${'▰'.repeat(filled)}${'▱'.repeat(BAR_LENGTH - filled)}`;
}

export function buildRevealEmbed(input: {
    event: HusariadaEvent;
    question: EventQuestion;
    distribution: readonly number[];
    fastest: FastestAnswer | null;
    imageUrl?: string | null;
}): EmbedBuilder {
    const { question, distribution } = input;
    const total = distribution.reduce((sum, count) => sum + count, 0);
    const correctCount = distribution[question.correctIndex] ?? 0;
    const stats = question.answers.map((answer, index) => {
        const count = distribution[index] ?? 0;
        const share = total > 0 ? count / total : 0;
        const marker = index === question.correctIndex ? '✅' : '▫️';
        return `${marker} ${answerLabel(index)} — ${answer}\n\`${progressBar(share)}\` **${count}** (${Math.round(share * 100)}%)`;
    }).join('\n');
    const fastest = input.fastest
        ? `⚡ Najszybciej: <@${input.fastest.userId}> — ${(input.fastest.responseMs / 1000).toFixed(2)} s (+${input.fastest.points} pkt)`
        : '😶 Nikt nie odpowiedział poprawnie.';
    const summary = total > 0
        ? `🎯 Poprawnie: **${correctCount}/${total}**`
        : '📭 Nikt nie odpowiedział na to pytanie.';

    const embed = new EmbedBuilder()
        .setColor(HusariaColors.GREEN)
        .setDescription(
            `${questionHeader(input.event, question)}\n\n`
            + `**Poprawna odpowiedź:** ${answerLabel(question.correctIndex)} — **${question.answers[question.correctIndex]}**\n\n`
            + `${stats}\n\n${summary}\n${fastest}`,
        );
    if (input.imageUrl) {
        embed.setImage(input.imageUrl);
    }
    return embed;
}

function standingLine(entry: Standing, questionCount: number): string {
    const medal = entry.place <= MEDALS.length ? MEDALS[entry.place - 1] : `\`#${entry.place}\``;
    return `${medal} <@${entry.userId}> — **${entry.points} pkt** · ✅ ${entry.correctCount}/${questionCount}`;
}

export function buildLeaderboardEmbed(input: {
    event: HusariadaEvent;
    standings: readonly Standing[];
    nextAt: number;
    imageUrl?: string | null;
}): EmbedBuilder {
    const answered = input.event.currentIndex + 1;
    const lines = input.standings.slice(0, 3).map((entry) => standingLine(entry, input.event.questionCount));
    const embed = new EmbedBuilder()
        .setColor(HusariaColors.GOLD)
        .setDescription(
            `# 📊 TOP 3 po ${answered}/${input.event.questionCount} pytaniach\n\n`
            + `${lines.length > 0 ? lines.join('\n') : 'Nikt jeszcze nie zdobył punktów.'}\n\n`
            + `⏭️ Kolejne pytanie ${relative(input.nextAt)}`,
        );
    if (input.imageUrl) {
        embed.setImage(input.imageUrl);
    }
    return embed;
}

export function buildPausedEmbed(reason: string): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(HusariaColors.LIGHT_GRAY)
        .setDescription(`# ⏸️ Husariada wstrzymana\n${reason}`);
}

export function buildResumedEmbed(nextAt: number): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(HusariaColors.GOLD)
        .setDescription(`# ▶️ Wznawiamy Husariadę!\nKolejne pytanie ${relative(nextAt)}`);
}

export function buildWinnerEmbed(input: {
    event: HusariadaEvent;
    winner: Standing | null;
    cancelled: boolean;
    imageUrl?: string | null;
}): EmbedBuilder {
    const embed = new EmbedBuilder().setColor(HusariaColors.GOLD);
    const header = `# 🏆 Koniec Husariady!\n## ${input.event.quizTitle}`;
    if (!input.winner) {
        return embed.setDescription(`${header}\n\nNikt nie wziął udziału w tej edycji. 😢`);
    }
    const { winner } = input;
    embed.setDescription(
        `${header}\n\n### Zwycięzca: <@${winner.userId}>\n`
        + `🏅 **${winner.points} pkt** · ✅ ${winner.correctCount}/${input.event.questionCount} poprawnych\n\n`
        + 'Gratulacje! 🎉',
    );
    if (winner.avatarUrl) {
        embed.setThumbnail(winner.avatarUrl);
    }
    if (input.imageUrl) {
        embed.setImage(input.imageUrl);
    }
    return embed;
}

/** Pelna lista uczestnikow, podzielona na embedy mieszczace sie w limicie opisu. */
export function buildResultsEmbeds(input: { event: HusariadaEvent; standings: readonly Standing[]; cancelled: boolean }): EmbedBuilder[] {
    const lines = input.standings.map((entry) => standingLine(entry, input.event.questionCount));
    const note = input.cancelled ? '\n⚠️ Event zakończony przedwcześnie przez administrację.' : '';
    const chunks: string[][] = [];
    for (let start = 0; start < lines.length; start += RESULTS_LINES_PER_EMBED) {
        chunks.push(lines.slice(start, start + RESULTS_LINES_PER_EMBED));
    }
    if (chunks.length === 0) {
        chunks.push(['Brak uczestników.']);
    }
    return chunks.map((chunk, index) => new EmbedBuilder()
        .setColor(HusariaColors.RED)
        .setDescription(
            index === 0
                ? `# 📋 Wyniki Husariady\n**${input.event.quizTitle}** · uczestników: **${input.standings.length}**${note}\n\n${chunk.join('\n')}`
                : chunk.join('\n'),
        ));
}
