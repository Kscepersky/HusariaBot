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
import {
    ALLOWED_UPLOAD_MIME,
    ImageUploadValidationError,
    MAX_UPLOAD_BYTES,
    MIME_EXTENSION,
    detectImageMime,
    normalizeUploadMimeType,
    parseUploadData,
    validateSvgSafety,
} from './image-upload.js';
import { createLogger } from '../utils/logger.js';

const publishLogger = createLogger('dashboard:publish-flow');

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
    editedAtTimestamp?: number;
}

function imgDirPath(): string {
    return join(__dirname, '..', '..', 'img');
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
            publishLogger.warn('PING_ROLE_VERIFY_FAILED', 'Nie udalo sie zweryfikowac roli do pingu.', {
                channelId: publishData.channelId,
                roleId: pingTarget,
                publishedByUserId: publisher.publishedByUserId,
            }, roleErr);
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
            throw new ImageUploadValidationError('Wybrany obraz z biblioteki nie istnieje.');
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
            throw new ImageUploadValidationError('Nieobsługiwany format pliku graficznego.');
        }

        const imageBuffer = parseUploadData(publishData.uploadBase64);
        if (!imageBuffer || !imageBuffer.length) {
            throw new ImageUploadValidationError('Wgrany plik graficzny ma nieprawidłowy format.');
        }

        if (imageBuffer.length > MAX_UPLOAD_BYTES) {
            throw new ImageUploadValidationError('Wgrany plik jest za duzy (max 20 MB).');
        }

        const detectedMime = detectImageMime(imageBuffer);
        if (!detectedMime || detectedMime !== normalizedUploadMimeType) {
            throw new ImageUploadValidationError('Zawartość pliku nie zgadza się z typem obrazu.');
        }

        if (detectedMime === 'image/svg+xml') {
            validateSvgSafety(imageBuffer);
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
            publishLogger.error('PING_MESSAGE_SEND_FAILED', 'Nie udalo sie wyslac wiadomosci ping przed postem.', {
                channelId: publishData.channelId,
                mode: publishData.mode,
                publishedByUserId: publisher.publishedByUserId,
            }, pingErr);
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
            publishLogger.error('EMBED_SEND_FAILED', 'Nie udalo sie wyslac embeda do kanalu Discord.', {
                channelId: publishData.channelId,
                mode: publishData.mode,
                publishedByUserId: publisher.publishedByUserId,
            }, messageErr);
            if (pingMessageId) {
                await deleteChannelMessage(publishData.channelId, pingMessageId).catch((deleteErr) => {
                    publishLogger.error('PING_MESSAGE_ROLLBACK_FAILED', 'Nie udalo sie cofnac wiadomosci ping po nieudanym wysylaniu embeda.', {
                        channelId: publishData.channelId,
                        pingMessageId,
                        publishedByUserId: publisher.publishedByUserId,
                    }, deleteErr);
                });
            }
            throw messageErr;
        }
    } else {
        const messagePayload = buildDashboardMessagePayload(publishData, publisher);

        try {
            messageId = await sendMessageToChannel(publishData.channelId, messagePayload);
        } catch (messageErr) {
            publishLogger.error('MESSAGE_SEND_FAILED', 'Nie udalo sie wyslac wiadomosci do kanalu Discord.', {
                channelId: publishData.channelId,
                mode: publishData.mode,
                publishedByUserId: publisher.publishedByUserId,
            }, messageErr);
            if (pingMessageId) {
                await deleteChannelMessage(publishData.channelId, pingMessageId).catch((deleteErr) => {
                    publishLogger.error('PING_MESSAGE_ROLLBACK_FAILED', 'Nie udalo sie cofnac wiadomosci ping po nieudanym wysylaniu wiadomosci.', {
                        channelId: publishData.channelId,
                        pingMessageId,
                        publishedByUserId: publisher.publishedByUserId,
                    }, deleteErr);
                });
            }
            throw messageErr;
        }
    }

    if (publishData.imageMode === 'library' && publishData.imageFilename) {
        try {
            imageMessageId = await sendImageToChannel(publishData.channelId, publishData.imageFilename);
        } catch (imageErr) {
            publishLogger.error('LIBRARY_IMAGE_SEND_FAILED', 'Nie udalo sie wyslac grafiki z biblioteki do kanalu Discord.', {
                channelId: publishData.channelId,
                imageFilename: publishData.imageFilename,
                messageId,
                publishedByUserId: publisher.publishedByUserId,
            }, imageErr);
            warnings = [...warnings, 'Wiadomość została opublikowana, ale nie udało się wysłać grafiki z biblioteki.'];
        }
    }

    if (publishData.imageMode === 'upload' && preparedUpload) {
        let storedFilename: string | null = null;
        try {
            storedFilename = await saveUploadToImageLibrary(preparedUpload.buffer, preparedUpload.mimeType);
            imageMessageId = await sendImageToChannel(publishData.channelId, storedFilename);
        } catch (imageErr) {
            publishLogger.error('UPLOADED_IMAGE_SEND_FAILED', 'Nie udalo sie wyslac wgranej grafiki do kanalu Discord.', {
                channelId: publishData.channelId,
                storedFilename,
                messageId,
                publishedByUserId: publisher.publishedByUserId,
            }, imageErr);
            if (storedFilename) {
                await unlink(join(imgDirPath(), storedFilename)).catch((deleteErr) => {
                    publishLogger.warn('UPLOADED_IMAGE_CLEANUP_FAILED', 'Nie udalo sie usunac wgranego pliku po bledzie wysylania.', {
                        channelId: publishData.channelId,
                        storedFilename,
                    }, deleteErr);
                });
            }
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
