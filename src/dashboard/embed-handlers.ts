import { EmbedBuilder } from 'discord.js';
import { HusariaColors, ColorChoices } from '../utils/husaria-theme.js';
import { parseWarsawDateTimeToTimestamp } from './scheduler/warsaw-time.js';

export type PublishMode = 'embedded' | 'message';
export type ImageMode = 'none' | 'library' | 'upload';

export interface MatchInfoSnapshot {
    matchId: string;
    game: string;
    g2TeamName: string;
    opponent: string;
    tournament: string;
    matchType: string;
    beginAtUtc: string;
    date: string;
    time: string;
}

export interface EventDraftFormData {
    enabled?: boolean;
    title?: string;
    description?: string;
    location?: string;
    startAtLocal?: string;
    endAtLocal?: string;
}

export interface WatchpartyDraftFormData {
    enabled?: boolean;
    channelName?: string;
    startAtLocal?: string;
    endAtLocal?: string;
}

export interface EmbedFormData {
    mode: PublishMode;
    channelId: string;
    mentionRoleEnabled?: boolean;
    mentionRoleId?: string;
    content?: string;
    title?: string;
    colorName?: string;
    imageMode?: ImageMode;
    imageFilename?: string;
    uploadFileName?: string;
    uploadMimeType?: string;
    uploadBase64?: string;
    matchInfo?: MatchInfoSnapshot;
    eventDraft?: EventDraftFormData;
    watchpartyDraft?: WatchpartyDraftFormData;
}

export interface PublishMetadata {
    publishedBy: string;
    publishedByUserId?: string;
    editedAtTimestamp?: number;
    editedBy?: string;
    editedByUserId?: string;
}

export interface DashboardMessagePayload {
    content?: string;
    allowed_mentions?: {
        parse: string[];
        roles?: string[];
        users?: string[];
    };
}

function isValidMode(mode: string): mode is PublishMode {
    return mode === 'embedded' || mode === 'message';
}

function isValidImageMode(mode: string): mode is ImageMode {
    return mode === 'none' || mode === 'library' || mode === 'upload';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTrimmedString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function sanitizeMetadataLabel(value: string): string {
    const normalized = normalizeTrimmedString(value);

    return normalized
        .replace(/@(everyone|here)\b/gi, '$1')
        .replace(/<@!?(\d{17,20})>/g, 'uzytkownik')
        .replace(/<@&(\d{17,20})>/g, 'rola');
}

function extractRoleMentionIds(content: string): string[] {
    const roleIds = new Set<string>();
    const regex = /<@&(\d{17,20})>/g;

    for (const match of content.matchAll(regex)) {
        const roleId = match[1];
        if (roleId) {
            roleIds.add(roleId);
        }
    }

    return [...roleIds];
}

function extractUserMentionIds(content: string): string[] {
    const userIds = new Set<string>();
    const regex = /<@!?(\d{17,20})>/g;

    for (const match of content.matchAll(regex)) {
        const userId = match[1];
        if (userId) {
            userIds.add(userId);
        }
    }

    return [...userIds];
}

function hasEveryoneOrHereMention(content: string): boolean {
    return /(^|\s)@(everyone|here)\b/.test(content);
}

function isBroadcastPingTarget(target: string): boolean {
    return target === 'everyone' || target === 'here';
}

function formatEditedAtInWarsaw(timestamp: number): string {
    const targetDate = new Date(timestamp);
    const nowDate = new Date();
    const yesterdayDate = new Date(nowDate.getTime() - (24 * 60 * 60 * 1000));

    const dayFormatter = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Warsaw',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });

    const hourFormatter = new Intl.DateTimeFormat('pl-PL', {
        timeZone: 'Europe/Warsaw',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });

    const targetDay = dayFormatter.format(targetDate);
    const todayDay = dayFormatter.format(nowDate);
    const yesterdayDay = dayFormatter.format(yesterdayDate);
    const hourLabel = hourFormatter.format(targetDate);

    if (targetDay === todayDay) {
        return `dzisiaj o ${hourLabel}`;
    }

    if (targetDay === yesterdayDay) {
        return `wczoraj o ${hourLabel}`;
    }

    const dateLabel = new Intl.DateTimeFormat('pl-PL', {
        timeZone: 'Europe/Warsaw',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(targetDate);

    return `${dateLabel} o ${hourLabel}`;
}

function withPublisherFooter(embed: EmbedBuilder, metadata: PublishMetadata): EmbedBuilder {
    if (metadata.editedAtTimestamp) {
        const editorLabel = sanitizeMetadataLabel(metadata.editedBy ?? metadata.publishedBy) || metadata.publishedBy;

        return embed
            .setFooter({ text: `Edytował: ${editorLabel}` })
            .setTimestamp();
    }

    return embed
        .setFooter({ text: `Opublikował: ${metadata.publishedBy}` })
        .setTimestamp();
}

export function buildEmbedJson(data: EmbedFormData, metadata: PublishMetadata): object {
    if (data.mode !== 'embedded') {
        throw new Error('Nie można zbudować embeda dla trybu wiadomości.');
    }

    const color = ColorChoices[data.colorName ?? ''] ?? HusariaColors.RED;
    const normalizedTitle = normalizeTrimmedString(data.title);
    const normalizedContent = normalizeTrimmedString(data.content);

    const description = normalizedTitle
        ? `# **${normalizedTitle}**\n${normalizedContent}`
        : normalizedContent;

    const embed = new EmbedBuilder()
        .setColor(color)
        .setDescription(description);

    return withPublisherFooter(embed, metadata).toJSON();
}

export function buildDashboardAllowedMentions(content: string): DashboardMessagePayload['allowed_mentions'] {
    const roles = extractRoleMentionIds(content);
    const users = extractUserMentionIds(content);
    const parse = hasEveryoneOrHereMention(content) ? ['everyone'] : [];

    return {
        parse,
        ...(roles.length > 0 ? { roles } : {}),
        ...(users.length > 0 ? { users } : {}),
    };
}

export function buildDashboardPingPayload(data: EmbedFormData): DashboardMessagePayload {
    const mentionRoleId = normalizeTrimmedString(data.mentionRoleId);

    if (!data.mentionRoleEnabled || !mentionRoleId) {
        return {};
    }

    if (isBroadcastPingTarget(mentionRoleId)) {
        return {
            content: `@${mentionRoleId}`,
            allowed_mentions: {
                parse: ['everyone'],
            },
        };
    }

    if (!/^\d{17,20}$/.test(mentionRoleId)) {
        return {};
    }

    return {
        content: `<@&${mentionRoleId}>`,
        allowed_mentions: {
            parse: [],
            roles: [mentionRoleId],
        },
    };
}

export function buildDashboardMessagePayload(data: EmbedFormData, metadata: PublishMetadata): DashboardMessagePayload {
    if (data.mode !== 'message') {
        return {};
    }

    const normalizedContent = normalizeTrimmedString(data.content);
    const publisherLabel = metadata.publishedByUserId && /^\d{17,20}$/.test(metadata.publishedByUserId)
        ? `<@${metadata.publishedByUserId}>`
        : metadata.publishedBy;
    const contentWithPublisher = normalizedContent
        ? `${normalizedContent}\n\n*Opublikował*: ${publisherLabel}`
        : `*Opublikował*: ${publisherLabel}`;

    const editedLabel = metadata.editedAtTimestamp
        ? `\n*Edytował*: ${sanitizeMetadataLabel(metadata.editedBy ?? metadata.publishedBy) || metadata.publishedBy}`
        : '';

    const finalContent = `${contentWithPublisher}${editedLabel}`;

    return {
        content: finalContent,
        allowed_mentions: buildDashboardAllowedMentions(finalContent),
    };
}

export function validateEmbedForm(data: EmbedFormData): string | null {
    if (!isValidMode(data.mode)) {
        return 'Nieprawidłowy tryb wiadomości.';
    }

    const normalizedContent = normalizeTrimmedString(data.content);
    if (!normalizedContent) {
        return 'Treść wiadomości jest wymagana.';
    }

    const normalizedTitle = normalizeTrimmedString(data.title);
    if (data.mode === 'embedded' && normalizedTitle.length > 256) {
        return 'Tytuł embeda może mieć maksymalnie 256 znaków.';
    }

    const normalizedMentionRoleId = normalizeTrimmedString(data.mentionRoleId);
    if (data.mentionRoleEnabled) {
        if (!normalizedMentionRoleId) {
            return 'Wybierz rolę do pingowania.';
        }
    }

    if (
        normalizedMentionRoleId
        && !isBroadcastPingTarget(normalizedMentionRoleId)
        && !/^\d{17,20}$/.test(normalizedMentionRoleId)
    ) {
        return 'Wybrana rola ma nieprawidłowy identyfikator.';
    }

    const imageMode = data.imageMode ?? 'none';
    if (!isValidImageMode(imageMode)) {
        return 'Nieprawidłowy tryb grafiki.';
    }

    const normalizedImageFilename = normalizeTrimmedString(data.imageFilename);
    if (imageMode === 'library' && !normalizedImageFilename) {
        return 'Wybierz grafikę z biblioteki.';
    }

    if (imageMode === 'upload') {
        const normalizedUploadFileName = normalizeTrimmedString(data.uploadFileName);
        const normalizedUploadMimeType = normalizeTrimmedString(data.uploadMimeType);
        const normalizedUploadBase64 = normalizeTrimmedString(data.uploadBase64);

        if (!normalizedUploadFileName || !normalizedUploadMimeType || !normalizedUploadBase64) {
            return 'Wgraj plik graficzny.';
        }
    }

    if (!data.channelId) return 'Wybierz kanał docelowy.';

    if (data.matchInfo !== undefined && data.matchInfo !== null) {
        if (!isRecord(data.matchInfo)) {
            return 'Nieprawidłowe dane meczu.';
        }

        const matchId = normalizeTrimmedString(data.matchInfo.matchId);
        if (!matchId) {
            return 'Identyfikator meczu jest wymagany.';
        }
    }

    if (data.eventDraft?.enabled) {
        const title = normalizeTrimmedString(data.eventDraft.title);
        const description = normalizeTrimmedString(data.eventDraft.description);
        const location = normalizeTrimmedString(data.eventDraft.location);
        const startAtLocal = normalizeTrimmedString(data.eventDraft.startAtLocal);
        const endAtLocal = normalizeTrimmedString(data.eventDraft.endAtLocal);

        if (!title) {
            return 'Tytuł wydarzenia Discord jest wymagany.';
        }

        if (!description) {
            return 'Opis wydarzenia Discord jest wymagany.';
        }

        if (!location) {
            return 'Miejsce wydarzenia Discord jest wymagane.';
        }

        const startAtTimestamp = parseWarsawDateTimeToTimestamp(startAtLocal);
        const endAtTimestamp = parseWarsawDateTimeToTimestamp(endAtLocal);

        if (!startAtTimestamp || !endAtTimestamp) {
            return 'Podaj poprawną datę rozpoczęcia i zakończenia wydarzenia (Europe/Warsaw).';
        }

        if (endAtTimestamp <= startAtTimestamp) {
            return 'Data zakończenia wydarzenia musi być późniejsza od startu.';
        }
    }

    if (data.watchpartyDraft?.enabled) {
        const channelName = normalizeTrimmedString(data.watchpartyDraft.channelName);
        const startAtLocal = normalizeTrimmedString(data.watchpartyDraft.startAtLocal);
        const endAtLocal = normalizeTrimmedString(data.watchpartyDraft.endAtLocal);

        if (!channelName) {
            return 'Nazwa kanału watchparty jest wymagana.';
        }

        if (channelName.length > 100) {
            return 'Nazwa kanału watchparty może mieć maksymalnie 100 znaków.';
        }

        const startAtTimestamp = parseWarsawDateTimeToTimestamp(startAtLocal);
        const endAtTimestamp = parseWarsawDateTimeToTimestamp(endAtLocal);

        if (!startAtTimestamp || !endAtTimestamp) {
            return 'Podaj poprawną datę rozpoczęcia i zakończenia watchparty (Europe/Warsaw).';
        }

        if (endAtTimestamp <= startAtTimestamp) {
            return 'Data zakończenia watchparty musi być późniejsza od startu.';
        }
    }

    return null;
}
