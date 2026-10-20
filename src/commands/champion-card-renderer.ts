import { createCanvas, type CanvasRenderingContext2D, type Image } from 'canvas';
import { HusariaColors } from '../utils/husaria-theme.js';
import {
    FONT_STACK,
    drawRingedAvatar,
    registerFontsOnce,
    roundedRectPath,
    toHexColor,
    tryFetchImage,
} from './card-canvas.js';

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 400;
const CARD_RADIUS = 18;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const TEXT_X = 56;
const TEXT_MAX_WIDTH = 560;
const ICON_SIZE = 84;
const MAX_NAME_LENGTH = 22;
const MAX_USERNAME_LENGTH = 18;
const MAX_BLURB_LENGTH = 400;
const BLURB_LINES_WITH_CAPTION = 3;
const BLURB_LINES_WITHOUT_CAPTION = 5;
const BLURB_LINE_HEIGHT = 28;
const AVATAR_SIZE = 56;

export interface ChampionCardRenderInput {
    championName: string;
    championTitle: string;
    blurb: string;
    caption?: string;
    username: string;
    splashUrl?: string;
    iconUrl?: string;
    avatarUrl?: string;
}

function truncate(text: string, maxLength: number): string {
    const trimmed = text.trim();
    return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
    const lines: string[] = [];
    let current = '';

    for (const word of text.split(/\s+/).filter(Boolean)) {
        const candidate = current ? `${current} ${word}` : word;
        if (current && context.measureText(candidate).width > maxWidth) {
            lines.push(current);
            current = word;
        } else {
            current = candidate;
        }
    }
    if (current) {
        lines.push(current);
    }

    if (lines.length <= maxLines) {
        return lines;
    }

    const visible = lines.slice(0, maxLines);
    visible[maxLines - 1] = `${visible[maxLines - 1]!.replace(/[.,;:!?]+$/, '')}...`;
    return visible;
}

function drawSplash(context: CanvasRenderingContext2D, splash: Image | null): void {
    if (!splash) {
        context.fillStyle = toHexColor(HusariaColors.DARK_GRAY);
        context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
        return;
    }

    const scale = Math.max(CARD_WIDTH / splash.width, CARD_HEIGHT / splash.height);
    const drawWidth = splash.width * scale;
    const drawHeight = splash.height * scale;
    // Twarz postaci na splashach jest zwykle w gornej polowie kadru.
    const drawY = (CARD_HEIGHT - drawHeight) * 0.25;
    context.drawImage(splash, (CARD_WIDTH - drawWidth) / 2, drawY, drawWidth, drawHeight);
}

function drawShade(context: CanvasRenderingContext2D): void {
    const gradient = context.createLinearGradient(0, 0, CARD_WIDTH, 0);
    gradient.addColorStop(0, 'rgba(8, 10, 14, 0.94)');
    gradient.addColorStop(0.5, 'rgba(8, 10, 14, 0.78)');
    gradient.addColorStop(1, 'rgba(8, 10, 14, 0.10)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
}

function drawFrame(context: CanvasRenderingContext2D): void {
    roundedRectPath(context, 1, 1, CARD_WIDTH - 2, CARD_HEIGHT - 2, CARD_RADIUS);
    context.lineWidth = 2;
    context.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    context.stroke();
}

function drawIconAndName(context: CanvasRenderingContext2D, input: ChampionCardRenderInput, icon: Image | null): void {
    const iconTop = 44;
    const radius = ICON_SIZE / 2;

    context.beginPath();
    context.arc(TEXT_X + radius, iconTop + radius, radius + 4, 0, Math.PI * 2);
    context.fillStyle = toHexColor(HusariaColors.GOLD);
    context.fill();

    context.save();
    context.beginPath();
    context.arc(TEXT_X + radius, iconTop + radius, radius, 0, Math.PI * 2);
    context.clip();
    if (icon) {
        context.drawImage(icon, TEXT_X, iconTop, ICON_SIZE, ICON_SIZE);
    } else {
        context.fillStyle = '#31353F';
        context.fillRect(TEXT_X, iconTop, ICON_SIZE, ICON_SIZE);
    }
    context.restore();

    const nameX = TEXT_X + ICON_SIZE + 24;
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = 'rgba(255, 255, 255, 0.72)';
    context.font = `600 20px ${FONT_STACK}`;
    context.fillText('TWOJA POSTAĆ', nameX, 70);

    context.fillStyle = toHexColor(HusariaColors.WHITE);
    context.font = `700 46px ${FONT_STACK}`;
    context.fillText(truncate(input.championName, MAX_NAME_LENGTH), nameX, 118);
}

function drawDescription(context: CanvasRenderingContext2D, input: ChampionCardRenderInput): void {
    context.textAlign = 'left';
    context.fillStyle = toHexColor(HusariaColors.GOLD);
    context.font = `600 26px ${FONT_STACK}`;
    context.fillText(truncate(input.championTitle, 40), TEXT_X, 176);

    context.fillStyle = 'rgba(255, 255, 255, 0.86)';
    context.font = `400 20px ${FONT_STACK}`;
    const lines = wrapText(context, truncate(input.blurb, MAX_BLURB_LENGTH), TEXT_MAX_WIDTH, input.caption ? BLURB_LINES_WITH_CAPTION : BLURB_LINES_WITHOUT_CAPTION);
    lines.forEach((line, index) => context.fillText(line, TEXT_X, 214 + index * BLURB_LINE_HEIGHT));

    if (!input.caption) {
        return;
    }

    context.fillStyle = '#FF5A78';
    context.font = `italic 600 22px ${FONT_STACK}`;
    const captionLines = wrapText(context, `„${truncate(input.caption, 90)}”`, TEXT_MAX_WIDTH, 2);
    captionLines.forEach((line, index) => context.fillText(line, TEXT_X, 330 + index * 28));
}

async function drawUserBadge(context: CanvasRenderingContext2D, input: ChampionCardRenderInput): Promise<void> {
    const name = truncate(input.username || 'Nieznany', MAX_USERNAME_LENGTH);
    context.font = `700 22px ${FONT_STACK}`;
    const nameWidth = context.measureText(name).width;
    const badgeWidth = AVATAR_SIZE + nameWidth + 44;
    const badgeX = CARD_WIDTH - badgeWidth - 28;
    const badgeY = CARD_HEIGHT - AVATAR_SIZE - 28;

    roundedRectPath(context, badgeX, badgeY - 6, badgeWidth, AVATAR_SIZE + 12, (AVATAR_SIZE + 12) / 2);
    context.fillStyle = 'rgba(12, 15, 20, 0.72)';
    context.fill();

    await drawRingedAvatar(context, {
        centerX: badgeX + 6 + AVATAR_SIZE / 2,
        top: badgeY,
        size: AVATAR_SIZE,
        ringWidth: 2,
        ringColor: toHexColor(HusariaColors.RED),
        ...(input.avatarUrl ? { avatarUrl: input.avatarUrl } : {}),
    });

    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillStyle = toHexColor(HusariaColors.WHITE);
    context.fillText(name, badgeX + AVATAR_SIZE + 20, badgeY + AVATAR_SIZE / 2);
    context.textBaseline = 'alphabetic';
}

export async function renderChampionCard(input: ChampionCardRenderInput): Promise<Buffer> {
    registerFontsOnce();
    const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
    const context = canvas.getContext('2d');

    const [splash, icon] = await Promise.all([tryFetchImage(input.splashUrl), tryFetchImage(input.iconUrl)]);

    context.save();
    roundedRectPath(context, 0, 0, CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS);
    context.clip();
    drawSplash(context, splash);
    drawShade(context);
    context.restore();

    drawFrame(context);
    drawIconAndName(context, input, icon);
    drawDescription(context, input);
    await drawUserBadge(context, input);

    const outputBuffer = canvas.toBuffer('image/png');
    if (outputBuffer.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('Generated champion image exceeds allowed size limit.');
    }

    return outputBuffer;
}
