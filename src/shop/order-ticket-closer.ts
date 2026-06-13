import { createLogger } from '../utils/logger.js';
import {
    getGuildAllChannels,
    sendMessageToChannel,
    deleteGuildChannel,
    invalidateGuildAllChannelsCache,
    fetchChannelMessages,
    type DiscordMessage,
} from '../dashboard/discord-api.js';
import {
    persistTicketClosureRecord,
    type TicketTranscriptMessageRecord,
} from '../tickets/history-store.js';

const GUILD_TEXT_CHANNEL_TYPE = 0;
const TICKET_TOPIC_OWNER_REGEX = /ticketOwnerId=(\d{17,20})/;
const TICKET_CLOSE_DELAY_MS = 60_000;

const closerLogger = createLogger('shop:ticket-closer');

export interface CloseOrderTicketParams {
    guildId: string;
    orderId: number;
    notificationMessage: string;
    closedByUserId: string;
    closedByTag: string;
    closeReason: string;
}

function extractOwnerId(topic: string | null | undefined): string | null {
    if (!topic) return null;
    const match = topic.match(TICKET_TOPIC_OWNER_REGEX);
    return match?.[1] ?? null;
}

function toTranscriptRecord(msg: DiscordMessage): TicketTranscriptMessageRecord {
    const tag = msg.author.discriminator === '0'
        ? msg.author.username
        : `${msg.author.username}#${msg.author.discriminator}`;
    return {
        id: msg.id,
        authorId: msg.author.id,
        authorTag: tag,
        content: msg.content,
        createdAt: new Date(msg.timestamp).getTime(),
        attachments: msg.attachments.map((a) => a.url),
    };
}

async function collectTranscriptMessages(channelId: string): Promise<TicketTranscriptMessageRecord[]> {
    const all: DiscordMessage[] = [];
    let beforeId: string | undefined;

    for (;;) {
        const batch = await fetchChannelMessages(channelId, beforeId);
        if (batch.length === 0) break;

        all.push(...batch);
        if (batch.length < 100) break;

        // Discord returns messages in descending ID order; last item is oldest
        beforeId = batch[batch.length - 1]?.id;
    }

    return all
        .map(toTranscriptRecord)
        .sort((a, b) => {
            if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
            return a.id.localeCompare(b.id);
        });
}

export async function closeOrderTicketViaRest(params: CloseOrderTicketParams): Promise<boolean> {
    const supportCategoryId = process.env.SUPPORT_CATEGORY_ID;
    if (!supportCategoryId) {
        closerLogger.warn('TICKET_CLOSER_NO_CATEGORY', 'Brak SUPPORT_CATEGORY_ID — pomijam zamykanie ticketu.', {
            orderId: params.orderId,
        });
        return false;
    }

    invalidateGuildAllChannelsCache(params.guildId);
    const channels = await getGuildAllChannels(params.guildId);

    const suffix = `-${params.orderId}`;
    const ticketChannel = channels.find(
        (ch) => ch.type === GUILD_TEXT_CHANNEL_TYPE
            && ch.parent_id === supportCategoryId
            && ch.name.startsWith('zamowienie-')
            && ch.name.endsWith(suffix),
    );

    if (!ticketChannel) {
        closerLogger.warn('TICKET_CLOSER_CHANNEL_NOT_FOUND', 'Nie znaleziono kanalu zamowienia.', {
            orderId: params.orderId,
            guildId: params.guildId,
        });
        return false;
    }

    await sendMessageToChannel(ticketChannel.id, {
        content: params.notificationMessage,
        allowed_mentions: { parse: ['everyone'] },
    });

    setTimeout(() => {
        void archiveAndDelete({
            guildId: params.guildId,
            orderId: params.orderId,
            channelId: ticketChannel.id,
            channelName: ticketChannel.name,
            channelTopic: ticketChannel.topic,
            closeReason: params.closeReason,
            closedByUserId: params.closedByUserId,
            closedByTag: params.closedByTag,
        });
    }, TICKET_CLOSE_DELAY_MS).unref();

    return true;
}

async function archiveAndDelete(params: {
    guildId: string;
    orderId: number;
    channelId: string;
    channelName: string;
    channelTopic: string | null | undefined;
    closeReason: string;
    closedByUserId: string;
    closedByTag: string;
}): Promise<void> {
    try {
        const transcriptMessages = await collectTranscriptMessages(params.channelId);
        await persistTicketClosureRecord({
            guildId: params.guildId,
            channelId: params.channelId,
            channelName: params.channelName,
            ownerId: extractOwnerId(params.channelTopic),
            closeType: 'admin',
            closeReason: params.closeReason,
            closedByUserId: params.closedByUserId,
            closedByTag: params.closedByTag,
            closedAt: Date.now(),
            transcriptMessages,
        });
    } catch (err) {
        closerLogger.error('TICKET_CLOSER_ARCHIVE_FAILED', 'Nie udalo sie zapisac historii ticketu zamowienia.', {
            guildId: params.guildId,
            orderId: params.orderId,
            channelId: params.channelId,
        }, err);
    }

    await deleteGuildChannel(params.channelId).catch((err) => {
        closerLogger.error('TICKET_CLOSER_DELETE_FAILED', 'Nie udalo sie usunac kanalu ticketu zamowienia.', {
            channelId: params.channelId,
            orderId: params.orderId,
        }, err);
    });
}
