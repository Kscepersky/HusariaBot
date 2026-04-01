import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import {
    deleteChannelMessage,
    getGuildRoles,
    listImages,
    sendImageToChannel,
    sendMessageToChannel,
} from './discord-api.js';
import {
    buildDashboardAllowedMentions,
    buildDashboardMessagePayload,
    buildDashboardPingPayload,
    buildEmbedJson,
    type EmbedFormData,
} from './embed-handlers.js';

const ALLOWED_UPLOAD_MIME = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
]);
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MIME_EXTENSION: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
};

interface PreparedUpload {
    buffer: Buffer;
    mimeType: string;
}

export interface PublishDashboardPostResult {
    messageId?: string;
    pingMessageId?: string;
    imageMessageId?: string;
    warnings: string[];
}

export interface PublisherContext {
    publishedBy: string;
    publishedByUserId?: string;
}

function imgDirPath(): string {
    return join(__dirname, '..', '..', 'img');
}

function normalizeUploadMimeType(mimeType: string): string {
    const normalized = mimeType.trim().toLowerCase();
    if (normalized === 'image/jpg') {
        return 'image/jpeg';
    }
    return normalized;
}

function normalizeTrimmedString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function isRolePingTarget(target: string): boolean {
    return /^\d{17,20}$/.test(target);
}

async function saveUploadToImageLibrary(buffer: Buffer, mimeType: string): Promise<string> {
    const ext = MIME_EXTENSION[mimeType];
    if (!ext) {
        throw new Error('Unsupported upload MIME type.');
    }

    const filename = `${randomUUID()}${ext}`;
    const targetDir = imgDirPath();

    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, filename), buffer);

    return filename;
}

function parseUploadData(uploadBase64: string): Buffer | null {
    const trimmed = uploadBase64.trim();
    const dataUrlMatch = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(trimmed);

    let base64Data = trimmed;
    if (dataUrlMatch) {
        base64Data = dataUrlMatch[2] ?? '';
    }

    const normalized = base64Data.replace(/\s+/g, '');
    if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+=*$/.test(normalized)) {
        return null;
    }

    return Buffer.from(normalized, 'base64');
}

function detectImageMime(buffer: Buffer): string | null {
    if (
        buffer.length >= 8
        && buffer[0] === 0x89
        && buffer[1] === 0x50
        && buffer[2] === 0x4e
        && buffer[3] === 0x47
        && buffer[4] === 0x0d
        && buffer[5] === 0x0a
        && buffer[6] === 0x1a
        && buffer[7] === 0x0a
    ) {
        return 'image/png';
    }

    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'image/jpeg';
    }

    if (buffer.length >= 6) {
        const gifHeader = buffer.toString('ascii', 0, 6);
        if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
            return 'image/gif';
        }
    }

    return null;
}

export async function publishDashboardPost(
    data: EmbedFormData,
    publisher: PublisherContext,
): Promise<PublishDashboardPostResult> {
    let publishData: EmbedFormData = { ...data };
    let warnings: string[] = [];

    const pingTarget = normalizeTrimmedString(publishData.mentionRoleId);
    if (publishData.mentionRoleEnabled && pingTarget && isRolePingTarget(pingTarget)) {
        try {
            const roles = await getGuildRoles(process.env.GUILD_ID!);
            const targetRole = roles.find((role) => role.id === pingTarget);

            if (!targetRole) {
                warnings = [...warnings, 'Wybrana rola do pingu nie istnieje. Publikacja została wysłana bez pingu.'];
                publishData = {
                    ...publishData,
                    mentionRoleEnabled: false,
                    mentionRoleId: '',
                };
            }
        } catch (roleErr) {
            console.error('Failed to verify ping role:', roleErr);
            warnings = [...warnings, 'Nie udało się zweryfikować roli do pingu. Publikacja została wysłana bez pingu.'];
            publishData = {
                ...publishData,
                mentionRoleEnabled: false,
                mentionRoleId: '',
            };
        }
    }

    if (publishData.imageMode === 'library' && publishData.imageFilename) {
        const availableImages = listImages();
        if (!availableImages.includes(publishData.imageFilename)) {
            throw new Error('Wybrany obraz z biblioteki nie istnieje.');
        }
    }

    let preparedUpload: PreparedUpload | null = null;
    if (
        publishData.imageMode === 'upload'
        && publishData.uploadBase64
        && publishData.uploadFileName
        && publishData.uploadMimeType
    ) {
        const normalizedUploadMimeType = normalizeUploadMimeType(publishData.uploadMimeType);

        if (!ALLOWED_UPLOAD_MIME.has(normalizedUploadMimeType)) {
            throw new Error('Nieobsługiwany format pliku graficznego.');
        }

        const imageBuffer = parseUploadData(publishData.uploadBase64);
        if (!imageBuffer || !imageBuffer.length) {
            throw new Error('Wgrany plik graficzny ma nieprawidłowy format.');
        }

        if (imageBuffer.length > MAX_UPLOAD_BYTES) {
            throw new Error('Wgrany plik jest za duży (max 8 MB).');
        }

        const detectedMime = detectImageMime(imageBuffer);
        if (!detectedMime || detectedMime !== normalizedUploadMimeType) {
            throw new Error('Zawartość pliku nie zgadza się z typem obrazu.');
        }

        preparedUpload = {
            buffer: imageBuffer,
            mimeType: detectedMime,
        };
    }

    const pingPayload = buildDashboardPingPayload(publishData);
    let messageId: string | undefined;
    let pingMessageId: string | undefined;
    let imageMessageId: string | undefined;

    if (pingPayload.content) {
        try {
            pingMessageId = await sendMessageToChannel(publishData.channelId, pingPayload);
        } catch (pingErr) {
            console.error('Failed to send ping message:', pingErr);
            warnings = [...warnings, 'Nie udało się wysłać pingu. Główna publikacja została wysłana bez pingu.'];
        }
    }

    if (publishData.mode === 'embedded') {
        const embedJson = buildEmbedJson(publishData, publisher);
        const normalizedContent = normalizeTrimmedString(publishData.content);

        try {
            messageId = await sendMessageToChannel(publishData.channelId, {
                embeds: [embedJson],
                allowed_mentions: buildDashboardAllowedMentions(normalizedContent),
            });
        } catch (messageErr) {
            if (pingMessageId) {
                await deleteChannelMessage(publishData.channelId, pingMessageId).catch((deleteErr) => {
                    console.error('Failed to rollback ping message:', deleteErr);
                });
            }
            throw messageErr;
        }
    } else {
        const messagePayload = buildDashboardMessagePayload(publishData, publisher);

        try {
            messageId = await sendMessageToChannel(publishData.channelId, messagePayload);
        } catch (messageErr) {
            if (pingMessageId) {
                await deleteChannelMessage(publishData.channelId, pingMessageId).catch((deleteErr) => {
                    console.error('Failed to rollback ping message:', deleteErr);
                });
            }
            throw messageErr;
        }
    }

    if (publishData.imageMode === 'library' && publishData.imageFilename) {
        try {
            imageMessageId = await sendImageToChannel(publishData.channelId, publishData.imageFilename);
        } catch (imageErr) {
            console.error('Failed to send library image:', imageErr);
            warnings = [...warnings, 'Wiadomość została opublikowana, ale nie udało się wysłać grafiki z biblioteki.'];
        }
    }

    if (publishData.imageMode === 'upload' && preparedUpload) {
        let storedFilename: string | null = null;
        try {
            storedFilename = await saveUploadToImageLibrary(preparedUpload.buffer, preparedUpload.mimeType);
            imageMessageId = await sendImageToChannel(publishData.channelId, storedFilename);
        } catch (imageErr) {
            if (storedFilename) {
                await unlink(join(imgDirPath(), storedFilename)).catch((deleteErr) => {
                    console.error('Failed to cleanup stored upload after send error:', deleteErr);
                });
            }
            console.error('Failed to send uploaded image:', imageErr);
            warnings = [...warnings, 'Wiadomość została opublikowana, ale nie udało się wysłać wgranej grafiki.'];
        }
    }

    return {
        messageId,
        pingMessageId,
        imageMessageId,
        warnings,
    };
}
