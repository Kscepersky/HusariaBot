import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';

vi.mock('../utils/logger.js', () => ({
    createLogger: () => ({
        trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(),
    }),
}));

import { getHoneypotChannelId, handleHoneypotMessage, HONEYPOT_DELETE_MESSAGE_SECONDS } from './honeypot.js';

const HONEYPOT_CHANNEL = '400000000000000001';
const OTHER_CHANNEL = '400000000000000002';
const ADMIN_ROLE = '200000000000000001';
const SPAMMER = '300000000000000001';

interface FakeMessageOptions {
    channelId?: string;
    authorId?: string;
    bot?: boolean;
    webhookId?: string | null;
    roleIds?: string[];
    administrator?: boolean;
    bannable?: boolean;
    withMember?: boolean;
    banError?: Error;
}

function createMessage(options: FakeMessageOptions = {}) {
    const ban = options.banError
        ? vi.fn().mockRejectedValue(options.banError)
        : vi.fn().mockResolvedValue(undefined);
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    const member = options.withMember === false ? null : {
        id: options.authorId ?? SPAMMER,
        bannable: options.bannable ?? true,
        roles: { cache: new Map((options.roleIds ?? []).map((id) => [id, { id }])) },
        permissions: {
            has: (flag: bigint) => flag === PermissionFlagsBits.Administrator && Boolean(options.administrator),
        },
        ban,
    };

    return {
        message: {
            id: '500000000000000001',
            channelId: options.channelId ?? HONEYPOT_CHANNEL,
            guildId: '600000000000000001',
            inGuild: () => true,
            webhookId: options.webhookId ?? null,
            author: { id: options.authorId ?? SPAMMER, bot: options.bot ?? false, tag: 'spammer#0001' },
            member,
            guild: { members: { fetch: vi.fn().mockResolvedValue(member) } },
            delete: deleteMessage,
        } as any,
        ban,
        deleteMessage,
    };
}

beforeEach(() => {
    process.env.HONEYPOT_CHANNEL_ID = HONEYPOT_CHANNEL;
    process.env.ADMIN_ROLE_1_ID = ADMIN_ROLE;
    process.env.OWNER_ID = '111111111111111111';
});

afterEach(() => {
    delete process.env.HONEYPOT_CHANNEL_ID;
    delete process.env.ADMIN_ROLE_1_ID;
    delete process.env.OWNER_ID;
});

describe('getHoneypotChannelId', () => {
    it('zwraca null dla brakujacej lub niepoprawnej wartosci', () => {
        delete process.env.HONEYPOT_CHANNEL_ID;
        expect(getHoneypotChannelId()).toBeNull();
        process.env.HONEYPOT_CHANNEL_ID = 'abc';
        expect(getHoneypotChannelId()).toBeNull();
    });

    it('zwraca ID kanalu', () => {
        expect(getHoneypotChannelId()).toBe(HONEYPOT_CHANNEL);
    });
});

describe('handleHoneypotMessage', () => {
    it('ignoruje wiadomosci z innych kanalow', async () => {
        const { message, ban } = createMessage({ channelId: OTHER_CHANNEL });
        expect(await handleHoneypotMessage(message)).toBe(false);
        expect(ban).not.toHaveBeenCalled();
    });

    it('nic nie robi, gdy honeypot nie jest skonfigurowany', async () => {
        delete process.env.HONEYPOT_CHANNEL_ID;
        const { message, ban } = createMessage();
        expect(await handleHoneypotMessage(message)).toBe(false);
        expect(ban).not.toHaveBeenCalled();
    });

    it('ignoruje boty i webhooki', async () => {
        const bot = createMessage({ bot: true });
        const webhook = createMessage({ webhookId: '700000000000000001' });
        expect(await handleHoneypotMessage(bot.message)).toBe(true);
        expect(await handleHoneypotMessage(webhook.message)).toBe(true);
        expect(bot.ban).not.toHaveBeenCalled();
        expect(webhook.ban).not.toHaveBeenCalled();
    });

    it('banuje autora i kasuje wiadomosci z 24h', async () => {
        const { message, ban } = createMessage();
        expect(await handleHoneypotMessage(message)).toBe(true);
        expect(HONEYPOT_DELETE_MESSAGE_SECONDS).toBe(86_400);
        expect(ban).toHaveBeenCalledWith(expect.objectContaining({ deleteMessageSeconds: 86_400 }));
    });

    it('pobiera membera, gdy nie ma go w wiadomosci', async () => {
        const { message } = createMessage();
        const member = message.member;
        message.member = null;
        message.guild.members.fetch.mockResolvedValue(member);
        await handleHoneypotMessage(message);
        expect(member.ban).toHaveBeenCalled();
    });

    it('nie banuje administracji i zostawia jej wiadomosc', async () => {
        const { message, ban, deleteMessage } = createMessage({ roleIds: [ADMIN_ROLE] });
        expect(await handleHoneypotMessage(message)).toBe(true);
        expect(ban).not.toHaveBeenCalled();
        expect(deleteMessage).not.toHaveBeenCalled();
    });

    it('nie banuje ownera ani osob z uprawnieniem Administrator', async () => {
        const owner = createMessage({ authorId: '111111111111111111' });
        const admin = createMessage({ administrator: true });
        await handleHoneypotMessage(owner.message);
        await handleHoneypotMessage(admin.message);
        expect(owner.ban).not.toHaveBeenCalled();
        expect(admin.ban).not.toHaveBeenCalled();
    });

    it('usuwa wiadomosc, gdy bot nie moze zbanowac autora', async () => {
        const { message, ban, deleteMessage } = createMessage({ bannable: false });
        expect(await handleHoneypotMessage(message)).toBe(true);
        expect(ban).not.toHaveBeenCalled();
        expect(deleteMessage).toHaveBeenCalled();
    });

    it('nie rzuca, gdy ban sie nie powiedzie, i usuwa wiadomosc', async () => {
        const { message, deleteMessage } = createMessage({ banError: new Error('Missing Permissions') });
        await expect(handleHoneypotMessage(message)).resolves.toBe(true);
        expect(deleteMessage).toHaveBeenCalled();
    });
});
