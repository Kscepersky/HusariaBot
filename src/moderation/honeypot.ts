import { PermissionFlagsBits, type GuildMember, type Message } from 'discord.js';
import { isSnowflake } from '../permissions/permission-store.js';
import { createLogger } from '../utils/logger.js';
import { isModerationExempt } from './admin-roles.js';

/** Ile sekund wiadomosci wstecz kasujemy przy banie (24h). */
export const HONEYPOT_DELETE_MESSAGE_SECONDS = 86_400;
const HONEYPOT_BAN_REASON = 'Honeypot: wiadomosc na kanale-pulapce (spam / przejete konto).';

const honeypotLogger = createLogger('moderation:honeypot');

export function getHoneypotChannelId(): string | null {
    const value = process.env.HONEYPOT_CHANNEL_ID?.trim();
    return isSnowflake(value) ? value : null;
}

async function resolveMember(message: Message): Promise<GuildMember | null> {
    if (message.member) {
        return message.member;
    }
    return message.guild?.members.fetch(message.author.id).catch(() => null) ?? null;
}

async function deleteMessageSafely(message: Message): Promise<void> {
    await message.delete().catch((error: unknown) => {
        honeypotLogger.warn('HONEYPOT_DELETE_FAILED', 'Nie udalo sie usunac wiadomosci z kanalu-pulapki.', {
            channelId: message.channelId,
            messageId: message.id,
        }, error);
    });
}

function isMemberExempt(member: GuildMember): boolean {
    return isModerationExempt({
        userId: member.id,
        roleIds: [...member.roles.cache.keys()],
        hasAdministratorPermission: member.permissions.has(PermissionFlagsBits.Administrator),
    });
}

/**
 * Obsluguje wiadomosc na kanale-pulapce: autor dostaje bana, a jego wiadomosci z 24h sa kasowane.
 * Zwraca true, gdy wiadomosc dotyczyla honeypota (dalsza obsluga, np. XP, ma zostac pominieta).
 */
export async function handleHoneypotMessage(message: Message): Promise<boolean> {
    const channelId = getHoneypotChannelId();
    if (!channelId || message.channelId !== channelId || !message.inGuild()) {
        return false;
    }

    if (message.author.bot || message.webhookId) {
        return true;
    }

    const member = await resolveMember(message);
    const context = { guildId: message.guildId, channelId, actorUserId: message.author.id };

    if (!member) {
        honeypotLogger.warn('HONEYPOT_MEMBER_MISSING', 'Autor wiadomosci nie jest juz na serwerze.', context);
        await deleteMessageSafely(message);
        return true;
    }

    if (isMemberExempt(member)) {
        honeypotLogger.info('HONEYPOT_EXEMPT', 'Pominieto osobe z administracji na kanale-pulapce.', context);
        return true;
    }

    if (!member.bannable) {
        honeypotLogger.error('HONEYPOT_NOT_BANNABLE', 'Bot nie moze zbanowac autora (uprawnienia lub hierarchia rol).', context);
        await deleteMessageSafely(message);
        return true;
    }

    try {
        await member.ban({ deleteMessageSeconds: HONEYPOT_DELETE_MESSAGE_SECONDS, reason: HONEYPOT_BAN_REASON });
        honeypotLogger.warn('HONEYPOT_BANNED', 'Zbanowano autora wiadomosci na kanale-pulapce.', {
            ...context,
            actorTag: message.author.tag,
        });
    } catch (error) {
        honeypotLogger.error('HONEYPOT_BAN_FAILED', 'Nie udalo sie zbanowac autora wiadomosci na kanale-pulapce.', context, error);
        await deleteMessageSafely(message);
    }

    return true;
}
