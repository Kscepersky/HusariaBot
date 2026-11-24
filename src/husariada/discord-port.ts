import { AttachmentBuilder, ChannelType, type Client, type Message, type TextChannel } from 'discord.js';
import { createLogger } from '../utils/logger.js';
import {
    buildAnswerButtons,
    buildIntroEmbed,
    buildLeaderboardEmbed,
    buildLobbyEmbed,
    buildPausedEmbed,
    buildQuestionEmbed,
    buildResultsEmbeds,
    buildResumedEmbed,
    buildRevealEmbed,
    buildWinnerEmbed,
    setHusariadaBrandEmoji,
} from './embeds.js';
import { getGuildEmoji } from '../utils/guild-emojis.js';
import type { HusariadaChannelPort } from './engine-types.js';
import { questionImageAttachmentName, resolveQuestionImagePath } from './images.js';
import { renderPodiumImage } from './podium-renderer.js';
import type { Standing } from './types.js';

const PODIUM_FILE_NAME = 'husariada-podium.png';
/** Bezpiecznik: max 50 x 100 wiadomosci na jedno czyszczenie. */
const PURGE_MAX_BATCHES = 50;
const BRAND_EMOJI_NAMES = ['G2Hussars', 'g2hussars', 'G2_Hussars'] as const;

function resolveBrandEmoji(channel: TextChannel): string | null {
    for (const name of BRAND_EMOJI_NAMES) {
        const emoji = getGuildEmoji(channel.guild, name);
        if (emoji) return emoji;
    }
    return null;
}
const UNKNOWN_MESSAGE_CODE = 10008;
const portLogger = createLogger('husariada:discord');

async function renderPodiumAttachment(title: string, subtitle: string, standings: readonly Standing[]): Promise<AttachmentBuilder | null> {
    if (standings.length === 0) {
        return null;
    }
    try {
        const buffer = await renderPodiumImage({ title, subtitle, standings: standings.slice(0, 3) });
        return new AttachmentBuilder(buffer, { name: PODIUM_FILE_NAME, description: subtitle });
    } catch (error) {
        portLogger.warn('HUSARIADA_PODIUM_RENDER_FAILED', 'Nie udalo sie wyrenderowac podium - wysylam sam tekst.', {}, error);
        return null;
    }
}

function isUnknownMessage(error: unknown): boolean {
    return (error as { code?: number })?.code === UNKNOWN_MESSAGE_CODE;
}

/** Implementacja portu silnika na kanale #husariada. */
export function createDiscordChannelPort(client: Client, channelId: string): HusariadaChannelPort {
    const questionMessages = new Map<string, Message>();

    async function getChannel(): Promise<TextChannel> {
        const channel = await client.channels.fetch(channelId);
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error('Kanal Husariady nie istnieje albo nie jest kanalem tekstowym.');
        }
        setHusariadaBrandEmoji(resolveBrandEmoji(channel));
        return channel;
    }

    /** Usuwa wszystkie wiadomosci z kanalu: hurtowo te z ostatnich 14 dni, starsze pojedynczo. */
    async function purgeChannel(): Promise<number> {
        const channel = await getChannel();
        let removed = 0;
        for (let batch = 0; batch < PURGE_MAX_BATCHES; batch += 1) {
            const messages = await channel.messages.fetch({ limit: 100 });
            if (messages.size === 0) break;

            const deleted = await channel.bulkDelete(messages, true);
            removed += deleted.size;
            const tooOld = messages.filter((message) => !deleted.has(message.id));
            for (const message of tooOld.values()) {
                await message.delete().catch((error: unknown) => {
                    if (!isUnknownMessage(error)) throw error;
                });
                removed += 1;
            }
            if (messages.size < 100) break;
        }
        questionMessages.clear();
        return removed;
    }

    async function getQuestionMessage(messageId: string): Promise<Message> {
        const cached = questionMessages.get(messageId);
        if (cached) return cached;
        return (await getChannel()).messages.fetch(messageId);
    }

    /** Po edycji obrazek z pierwotnej wiadomosci jest dostepny pod adresem CDN. */
    function existingImageUrl(message: Message): string | null {
        return message.embeds[0]?.image?.url ?? null;
    }

    return {
        async clearChannel() {
            const removed = await purgeChannel();
            portLogger.info('HUSARIADA_CHANNEL_CLEARED', 'Wyczyszczono kanal Husariady po evencie.', { channelId, removed });
        },

        async upsertLobby(existingMessageId, settings) {
            const channel = await getChannel();
            const embeds = [buildLobbyEmbed(settings)];
            if (existingMessageId) {
                try {
                    const message = await channel.messages.fetch(existingMessageId);
                    await message.edit({ embeds, components: [] });
                    return message.id;
                } catch (error) {
                    if (!isUnknownMessage(error)) throw error;
                }
            }
            return (await channel.send({ embeds })).id;
        },

        async deleteMessage(messageId) {
            try {
                await (await getChannel()).messages.delete(messageId);
            } catch (error) {
                if (!isUnknownMessage(error)) throw error;
            }
        },

        async sendIntro(event, startsAt) {
            await (await getChannel()).send({ embeds: [buildIntroEmbed(event, startsAt)] });
        },

        async sendQuestion(event, question, deadlineAt) {
            const files = question.image
                ? [new AttachmentBuilder(resolveQuestionImagePath(question.image), { name: questionImageAttachmentName(question.image) })]
                : [];
            const imageUrl = question.image ? `attachment://${questionImageAttachmentName(question.image)}` : null;
            const message = await (await getChannel()).send({
                embeds: [buildQuestionEmbed({ event, question, deadlineAt, answeredCount: 0, imageUrl })],
                components: buildAnswerButtons(event.id, question),
                files,
            });
            questionMessages.set(message.id, message);
            return { messageId: message.id, createdAt: message.createdTimestamp };
        },

        async updateQuestionProgress(messageId, event, question, deadlineAt, answeredCount) {
            const message = await getQuestionMessage(messageId);
            await message.edit({
                embeds: [buildQuestionEmbed({ event, question, deadlineAt, answeredCount, imageUrl: existingImageUrl(message) })],
            });
        },

        async revealQuestion(messageId, event, question, distribution, fastest) {
            const message = await getQuestionMessage(messageId);
            questionMessages.delete(messageId);
            await message.edit({
                embeds: [buildRevealEmbed({ event, question, distribution, fastest, imageUrl: existingImageUrl(message) })],
                components: buildAnswerButtons(event.id, question, { reveal: true }),
            });
        },

        async sendLeaderboard(event, standings, nextAt) {
            const subtitle = `TOP 3 po ${event.currentIndex + 1}/${event.questionCount} pytaniach`;
            const podium = await renderPodiumAttachment(event.quizTitle, subtitle, standings);
            await (await getChannel()).send({
                embeds: [buildLeaderboardEmbed({ event, standings, nextAt, imageUrl: podium ? `attachment://${PODIUM_FILE_NAME}` : null })],
                files: podium ? [podium] : [],
            });
        },

        async sendPaused(reason) {
            await (await getChannel()).send({ embeds: [buildPausedEmbed(reason)] });
        },

        async sendResumed(nextAt) {
            await (await getChannel()).send({ embeds: [buildResumedEmbed(nextAt)] });
        },

        async sendResults(event, standings, cancelled) {
            const channel = await getChannel();
            const podium = await renderPodiumAttachment(event.quizTitle, 'Wyniki końcowe', standings);
            await channel.send({
                embeds: [buildWinnerEmbed({
                    event, winner: standings[0] ?? null, cancelled, imageUrl: podium ? `attachment://${PODIUM_FILE_NAME}` : null,
                })],
                files: podium ? [podium] : [],
            });
            // Jeden embed na wiadomosc - limit 6000 znakow na wiadomosc przy dlugiej liscie.
            for (const embed of buildResultsEmbeds({ event, standings, cancelled })) {
                await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
            }
        },
    };
}
