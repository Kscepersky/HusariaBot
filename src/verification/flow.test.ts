import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

const SUPPORT_CATEGORY = '900000000000000001';
vi.mock('../tickets/constants.js', () => ({ SUPPORT_CATEGORY_ID: '900000000000000001' }));
const archiveTicketClosure = vi.fn().mockResolvedValue(undefined);
vi.mock('../tickets/flow.js', () => ({ archiveTicketClosure: (...args: unknown[]) => archiveTicketClosure(...args) }));
vi.mock('../utils/logger.js', () => ({
    createLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import {
    handleVerificationButton,
    handleVerificationMemberJoin,
    handleVerificationMemberLeave,
} from './flow.js';
import {
    VERIFICATION_APPROVE_BUTTON_ID,
    VERIFICATION_REJECT_BUTTON_ID,
    VERIFICATION_REJECT_CONFIRM_ID,
} from './constants.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const GUILD_ID = '600000000000000001';
const VERIFY_ROLE = '700000000000000001';
const ADMIN_ROLE = '200000000000000001';
const SUBJECT = '300000000000000001';
const ADMIN = '300000000000000002';
const RANDOM = '300000000000000003';

function createMember(id: string, roleIds: string[] = [], options: { createdTimestamp?: number; administrator?: boolean } = {}) {
    return {
        id,
        joinedTimestamp: NOW,
        user: {
            id, username: `user${id.slice(-1)}`, globalName: null, avatar: null, bot: false,
            createdTimestamp: options.createdTimestamp ?? NOW - 2 * DAY_MS,
            displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
            flags: { toArray: () => [] },
        },
        roles: {
            cache: new Map(roleIds.map((roleId) => [roleId, { id: roleId }])),
            add: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
        },
        permissions: { has: (flag: bigint) => flag === PermissionFlagsBits.Administrator && Boolean(options.administrator) },
    };
}

function createVerificationChannel(subjectId: string) {
    return {
        id: '800000000000000001',
        type: ChannelType.GuildText,
        parentId: SUPPORT_CATEGORY,
        name: 'weryfikacja-nowy',
        topic: `verificationUserId=${subjectId}`,
        deletable: true,
        send: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        guild: undefined as unknown,
    };
}

function createGuild(members: Record<string, ReturnType<typeof createMember>>, existingChannels: unknown[] = []) {
    const createdChannel = createVerificationChannel(SUBJECT);
    const guild = {
        id: GUILD_ID,
        name: 'G2 Hussars',
        client: { user: { id: '999999999999999999', tag: 'HusariaBot#0001' } },
        roles: { cache: new Map([[ADMIN_ROLE, { id: ADMIN_ROLE }]]) },
        members: {
            me: { id: '999999999999999999' },
            fetch: vi.fn(async (id: string) => {
                const member = members[id];
                if (!member) throw new Error('Unknown Member');
                return member;
            }),
        },
        channels: {
            fetch: vi.fn().mockResolvedValue(new Map(existingChannels.map((channel, index) => [String(index), channel]))),
            create: vi.fn().mockResolvedValue(createdChannel),
        },
        bans: { create: vi.fn().mockResolvedValue(undefined) },
    };
    createdChannel.guild = guild;
    for (const channel of existingChannels as { guild: unknown }[]) {
        channel.guild = guild;
    }
    return { guild, createdChannel };
}

function createButton(customId: string, actorId: string, guild: ReturnType<typeof createGuild>['guild'], channel: unknown) {
    const dmSend = vi.fn().mockResolvedValue(undefined);
    return {
        customId,
        user: { id: actorId, tag: `actor${actorId.slice(-1)}#0001` },
        guild,
        channel,
        client: { users: { fetch: vi.fn().mockResolvedValue({ send: dmSend }) } },
        reply: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
    } as any;
}

beforeEach(() => {
    process.env.VERIFICATION_ROLE_ID = VERIFY_ROLE;
    process.env.ADMIN_ROLE_1_ID = ADMIN_ROLE;
    process.env.OWNER_ID = '111111111111111111';
    archiveTicketClosure.mockClear();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    delete process.env.VERIFICATION_ROLE_ID;
    delete process.env.ADMIN_ROLE_1_ID;
    delete process.env.OWNER_ID;
});

describe('handleVerificationMemberJoin', () => {
    it('nadaje range i tworzy ticket z pingiem administracji dla mlodego konta', async () => {
        const subject = createMember(SUBJECT);
        const { guild, createdChannel } = createGuild({ [SUBJECT]: subject });

        await handleVerificationMemberJoin({ ...subject, guild } as any, NOW);

        expect(subject.roles.add).toHaveBeenCalledWith(VERIFY_ROLE, expect.any(String));
        expect(guild.channels.create).toHaveBeenCalledWith(expect.objectContaining({
            parent: SUPPORT_CATEGORY,
            topic: `verificationUserId=${SUBJECT}`,
        }));
        const sent = createdChannel.send.mock.calls[0][0];
        expect(sent.content).toContain(`<@&${ADMIN_ROLE}>`);
        expect(sent.allowedMentions.roles).toEqual([ADMIN_ROLE]);
        expect(sent.components).toHaveLength(1);
    });

    it('pomija konto starsze niz 14 dni', async () => {
        const subject = createMember(SUBJECT, [], { createdTimestamp: NOW - 30 * DAY_MS });
        const { guild } = createGuild({ [SUBJECT]: subject });

        await handleVerificationMemberJoin({ ...subject, guild } as any, NOW);

        expect(subject.roles.add).not.toHaveBeenCalled();
        expect(guild.channels.create).not.toHaveBeenCalled();
    });

    it('nie robi nic, gdy rola weryfikacji nie jest skonfigurowana', async () => {
        delete process.env.VERIFICATION_ROLE_ID;
        const subject = createMember(SUBJECT);
        const { guild } = createGuild({ [SUBJECT]: subject });
        await handleVerificationMemberJoin({ ...subject, guild } as any, NOW);
        expect(subject.roles.add).not.toHaveBeenCalled();
    });

    it('nie tworzy drugiego ticketu, gdy juz istnieje', async () => {
        const subject = createMember(SUBJECT);
        const { guild } = createGuild({ [SUBJECT]: subject }, [createVerificationChannel(SUBJECT)]);
        await handleVerificationMemberJoin({ ...subject, guild } as any, NOW);
        expect(guild.channels.create).not.toHaveBeenCalled();
    });
});

describe('handleVerificationButton', () => {
    it('ignoruje obce przyciski', async () => {
        const { guild } = createGuild({});
        expect(await handleVerificationButton(createButton('other', ADMIN, guild, null))).toBe(false);
    });

    it('odmawia weryfikowanemu kliknieciu wlasnej akceptacji', async () => {
        const channel = createVerificationChannel(SUBJECT);
        const subject = createMember(SUBJECT);
        const { guild } = createGuild({ [SUBJECT]: subject }, [channel]);
        const interaction = createButton(VERIFICATION_APPROVE_BUTTON_ID, SUBJECT, guild, channel);

        await handleVerificationButton(interaction);

        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Tylko administracja') }));
        expect(subject.roles.remove).not.toHaveBeenCalled();
    });

    it('odmawia osobie bez rangi administracyjnej', async () => {
        const channel = createVerificationChannel(SUBJECT);
        const { guild } = createGuild({ [RANDOM]: createMember(RANDOM) }, [channel]);
        const interaction = createButton(VERIFICATION_REJECT_CONFIRM_ID, RANDOM, guild, channel);

        await handleVerificationButton(interaction);

        expect(guild.bans.create).not.toHaveBeenCalled();
    });

    it('akceptacja zdejmuje range, archiwizuje i usuwa kanal', async () => {
        const channel = createVerificationChannel(SUBJECT);
        const subject = createMember(SUBJECT, [VERIFY_ROLE]);
        const { guild } = createGuild({ [SUBJECT]: subject, [ADMIN]: createMember(ADMIN, [ADMIN_ROLE]) }, [channel]);
        const interaction = createButton(VERIFICATION_APPROVE_BUTTON_ID, ADMIN, guild, channel);

        const pending = handleVerificationButton(interaction);
        await vi.runAllTimersAsync();
        await pending;

        expect(subject.roles.remove).toHaveBeenCalledWith(VERIFY_ROLE, expect.any(String));
        expect(archiveTicketClosure).toHaveBeenCalledWith(expect.objectContaining({ ownerId: SUBJECT, closeType: 'admin' }));
        expect(channel.delete).toHaveBeenCalled();
    });

    it('przycisk odrzucenia najpierw prosi o potwierdzenie', async () => {
        const channel = createVerificationChannel(SUBJECT);
        const { guild } = createGuild({ [ADMIN]: createMember(ADMIN, [ADMIN_ROLE]) }, [channel]);
        const interaction = createButton(VERIFICATION_REJECT_BUTTON_ID, ADMIN, guild, channel);

        await handleVerificationButton(interaction);

        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('zbanować') }));
        expect(guild.bans.create).not.toHaveBeenCalled();
    });

    it('potwierdzone odrzucenie banuje i zamyka kanal', async () => {
        const channel = createVerificationChannel(SUBJECT);
        const { guild } = createGuild({ [ADMIN]: createMember(ADMIN, [ADMIN_ROLE]) }, [channel]);
        const interaction = createButton(VERIFICATION_REJECT_CONFIRM_ID, ADMIN, guild, channel);

        const pending = handleVerificationButton(interaction);
        await vi.runAllTimersAsync();
        await pending;

        expect(guild.bans.create).toHaveBeenCalledWith(SUBJECT, expect.objectContaining({ reason: expect.any(String) }));
        expect(channel.delete).toHaveBeenCalled();
    });

    it('nie zamyka kanalu, gdy ban sie nie powiedzie', async () => {
        const channel = createVerificationChannel(SUBJECT);
        const { guild } = createGuild({ [ADMIN]: createMember(ADMIN, [ADMIN_ROLE]) }, [channel]);
        guild.bans.create.mockRejectedValue(new Error('Missing Permissions'));
        const interaction = createButton(VERIFICATION_REJECT_CONFIRM_ID, ADMIN, guild, channel);

        const pending = handleVerificationButton(interaction);
        await vi.runAllTimersAsync();
        await pending;

        expect(interaction.followUp).toHaveBeenCalled();
        expect(channel.delete).not.toHaveBeenCalled();
    });
});

describe('handleVerificationMemberLeave', () => {
    it('sprzata ticket osoby, ktora wyszla z serwera', async () => {
        const channel = createVerificationChannel(SUBJECT);
        const { guild } = createGuild({}, [channel]);

        await handleVerificationMemberLeave({ id: SUBJECT, guild } as any);

        expect(archiveTicketClosure).toHaveBeenCalled();
        expect(channel.delete).toHaveBeenCalled();
    });
});
