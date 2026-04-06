import { createCanvas, loadImage, type CanvasRenderingContext2D, type Image } from 'canvas';
import { join } from 'node:path';
import { HusariaColors } from '../utils/husaria-theme.js';

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 400;
const OUTER_PADDING = 24;
const PANEL_RADIUS = 14;
const AVATAR_SIZE = 170;
const AVATAR_RING_WIDTH = 6;
const PROGRESS_BAR_HEIGHT = 44;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const AVATAR_LOAD_TIMEOUT_MS = 1200;
const MAX_NAME_LENGTH = 20;
const BACKGROUND_IMAGE_PATH = join(__dirname, '..', '..', 'img', 'hussars_banner.png');
let cachedBackgroundImagePromise: Promise<Image> | null = null;

export interface LevelCardRenderInput {
    username: string;
    avatarUrl?: string;
    rank?: number | null;
    level: number;
    totalXp: number;
    xpIntoCurrentLevel: number;
    xpForNextLevel: number;
    xpToNextLevel: number;
}

interface NormalizedCardInput {
    username: string;
    avatarUrl?: string;
    rank: number | null;
    level: number;
    totalXp: number;
    xpIntoCurrentLevel: number;
    xpForNextLevel: number;
    xpToNextLevel: number;
    progress: number;
    percent: number;
}

function toHexColor(color: number): string {
    return `#${color.toString(16).padStart(6, '0')}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function truncateName(username: string): string {
    const trimmed = username.trim();
    if (trimmed.length <= MAX_NAME_LENGTH) {
        return trimmed || 'Nieznany';
    }

    return `${trimmed.slice(0, MAX_NAME_LENGTH - 3)}...`;
}

function formatCompactXp(value: number): string {
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(2)}M`;
    }

    if (value >= 1_000) {
        return `${(value / 1_000).toFixed(2)}K`;
    }

    return `${value}`;
}

function roundedRectPath(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
): void {
    const rounded = Math.max(0, Math.min(radius, width / 2, height / 2));
    context.beginPath();
    context.moveTo(x + rounded, y);
    context.lineTo(x + width - rounded, y);
    context.quadraticCurveTo(x + width, y, x + width, y + rounded);
    context.lineTo(x + width, y + height - rounded);
    context.quadraticCurveTo(x + width, y + height, x + width - rounded, y + height);
    context.lineTo(x + rounded, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - rounded);
    context.lineTo(x, y + rounded);
    context.quadraticCurveTo(x, y, x + rounded, y);
    context.closePath();
}

function drawPanel(context: CanvasRenderingContext2D): void {
    const panelX = OUTER_PADDING;
    const panelY = OUTER_PADDING;
    const panelWidth = CARD_WIDTH - OUTER_PADDING * 2;
    const panelHeight = CARD_HEIGHT - OUTER_PADDING * 2;

    roundedRectPath(context, panelX, panelY, panelWidth, panelHeight, PANEL_RADIUS);
    context.fillStyle = 'rgba(18, 22, 29, 0.70)';
    context.fill();

    roundedRectPath(context, panelX, panelY, panelWidth, panelHeight, PANEL_RADIUS);
    context.lineWidth = 2;
    context.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    context.stroke();
}

function normalizeInput(input: LevelCardRenderInput): NormalizedCardInput {
    const xpForNextLevel = Math.max(1, Math.floor(input.xpForNextLevel));
    const xpIntoCurrentLevel = clamp(Math.floor(input.xpIntoCurrentLevel), 0, xpForNextLevel);
    const progress = clamp(xpIntoCurrentLevel / xpForNextLevel, 0, 1);
    const percent = Math.round(progress * 100);

    return {
        username: truncateName(input.username),
        avatarUrl: input.avatarUrl,
        rank: Number.isFinite(Number(input.rank)) && Number(input.rank) > 0
            ? Math.floor(Number(input.rank))
            : null,
        level: Math.max(0, Math.floor(input.level)),
        totalXp: Math.max(0, Math.floor(input.totalXp)),
        xpIntoCurrentLevel,
        xpForNextLevel,
        xpToNextLevel: Math.max(0, Math.floor(input.xpToNextLevel)),
        progress,
        percent,
    };
}

function loadBackgroundImage(): Promise<Image> {
    if (!cachedBackgroundImagePromise) {
        cachedBackgroundImagePromise = loadImage(BACKGROUND_IMAGE_PATH);
    }

    return cachedBackgroundImagePromise;
}

async function loadAvatarImageWithTimeout(avatarUrl: string): Promise<Image> {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
        abortController.abort();
    }, AVATAR_LOAD_TIMEOUT_MS);

    try {
        const response = await fetch(avatarUrl, {
            signal: abortController.signal,
        });
        if (!response.ok) {
            throw new Error(`Avatar request failed with status ${response.status}.`);
        }

        const avatarBytes = await response.arrayBuffer();
        return loadImage(Buffer.from(avatarBytes));
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error('Avatar image load timed out.');
        }

        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function drawBackground(context: CanvasRenderingContext2D): Promise<void> {
    try {
        const backgroundImage = await loadBackgroundImage();
        const scale = Math.max(CARD_WIDTH / backgroundImage.width, CARD_HEIGHT / backgroundImage.height);
        const drawWidth = backgroundImage.width * scale;
        const drawHeight = backgroundImage.height * scale;
        const drawX = (CARD_WIDTH - drawWidth) / 2;
        const drawY = (CARD_HEIGHT - drawHeight) / 2;

        context.drawImage(backgroundImage, drawX, drawY, drawWidth, drawHeight);
    } catch {
        cachedBackgroundImagePromise = null;
        context.fillStyle = toHexColor(HusariaColors.DARK_GRAY);
        context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
    }

    const overlayGradient = context.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
    overlayGradient.addColorStop(0, 'rgba(8, 10, 14, 0.74)');
    overlayGradient.addColorStop(1, 'rgba(12, 15, 20, 0.64)');

    context.fillStyle = overlayGradient;
    context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    drawPanel(context);
}

async function drawAvatar(context: CanvasRenderingContext2D, avatarUrl: string | undefined): Promise<void> {
    const avatarX = OUTER_PADDING + 26;
    const avatarY = (CARD_HEIGHT - AVATAR_SIZE) / 2;
    const avatarRadius = AVATAR_SIZE / 2;

    context.beginPath();
    context.arc(avatarX + avatarRadius, avatarY + avatarRadius, avatarRadius + AVATAR_RING_WIDTH, 0, Math.PI * 2);
    context.closePath();
    context.fillStyle = 'rgba(8, 10, 14, 0.86)';
    context.fill();

    context.save();
    context.beginPath();
    context.arc(avatarX + avatarRadius, avatarY + avatarRadius, avatarRadius, 0, Math.PI * 2);
    context.closePath();
    context.clip();

    if (avatarUrl) {
        try {
            const avatarImage = await loadAvatarImageWithTimeout(avatarUrl);
            context.drawImage(avatarImage, avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
            context.restore();
            return;
        } catch {
            // Keep placeholder fallback below.
        }
    }

    context.fillStyle = '#31353F';
    context.fillRect(avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
    context.restore();

    context.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    context.lineWidth = AVATAR_RING_WIDTH;
    context.beginPath();
    context.arc(avatarX + avatarRadius, avatarY + avatarRadius, avatarRadius - AVATAR_RING_WIDTH / 2, 0, Math.PI * 2);
    context.closePath();
    context.stroke();

    context.beginPath();
    context.arc(avatarX + AVATAR_SIZE - 10, avatarY + AVATAR_SIZE - 10, 25, 0, Math.PI * 2);
    context.closePath();
    context.fillStyle = toHexColor(HusariaColors.RED);
    context.fill();
    context.lineWidth = 5;
    context.strokeStyle = 'rgba(10, 12, 16, 0.92)';
    context.stroke();
}

function drawTextAndProgress(context: CanvasRenderingContext2D, data: NormalizedCardInput): void {
    const white = toHexColor(HusariaColors.WHITE);
    const red = toHexColor(HusariaColors.RED);
    const lightGray = toHexColor(HusariaColors.LIGHT_GRAY);
    const gold = toHexColor(HusariaColors.GOLD);

    const avatarX = OUTER_PADDING + 26;
    const textStartX = avatarX + AVATAR_SIZE + 36;
    const rightEdgeX = CARD_WIDTH - OUTER_PADDING - 34;
    const progressX = textStartX;
    const progressY = 216;
    const progressBarWidth = rightEdgeX - progressX;

    context.textBaseline = 'alphabetic';
    context.textAlign = 'left';

    context.fillStyle = 'rgba(255, 255, 255, 0.84)';
    context.font = '600 24px sans-serif';
    const rankLabel = data.rank === null ? '#-' : `#${data.rank}`;
    context.fillText(`RANKING XP ${rankLabel}`, textStartX, 84);

    context.fillStyle = white;
    context.font = '700 58px sans-serif';
    context.fillText(data.username, textStartX, 146);

    context.textAlign = 'right';
    context.fillStyle = lightGray;
    context.font = '600 52px sans-serif';
    const levelText = `${data.level}`;
    context.font = '700 88px sans-serif';
    const levelWidth = context.measureText(levelText).width;
    const levelLabelGap = 26;
    const levelLabelRightX = Math.max(progressX + 280, rightEdgeX - levelWidth - levelLabelGap);

    context.fillStyle = lightGray;
    context.font = '600 52px sans-serif';
    context.fillText('LEVEL', levelLabelRightX, 132);

    context.fillStyle = red;
    context.font = '700 88px sans-serif';
    context.fillText(levelText, rightEdgeX, 132);

    context.fillStyle = 'rgba(255, 255, 255, 0.87)';
    context.font = '600 38px sans-serif';
    context.fillText(`${formatCompactXp(data.xpIntoCurrentLevel)} / ${formatCompactXp(data.xpForNextLevel)} XP`, rightEdgeX, 194);

    context.textAlign = 'left';

    roundedRectPath(context, progressX, progressY, progressBarWidth, PROGRESS_BAR_HEIGHT, PROGRESS_BAR_HEIGHT / 2);
    context.fillStyle = 'rgba(22, 26, 33, 0.94)';
    context.fill();

    const filledWidth = Math.round(progressBarWidth * data.progress);
    if (filledWidth > 0) {
        const fillGradient = context.createLinearGradient(progressX, progressY, progressX + progressBarWidth, progressY);
        fillGradient.addColorStop(0, red);
        fillGradient.addColorStop(1, gold);

        roundedRectPath(context, progressX, progressY, filledWidth, PROGRESS_BAR_HEIGHT, PROGRESS_BAR_HEIGHT / 2);
        context.fillStyle = fillGradient;
        context.fill();
    }

    roundedRectPath(context, progressX, progressY, progressBarWidth, PROGRESS_BAR_HEIGHT, PROGRESS_BAR_HEIGHT / 2);
    context.lineWidth = 2;
    context.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    context.stroke();

    context.font = '600 26px sans-serif';
    context.fillStyle = white;
    context.fillText(`Do kolejnego poziomu: ${data.xpToNextLevel} XP`, progressX, progressY + 88);

    context.textAlign = 'right';
    context.fillStyle = gold;
    context.fillText(`${data.percent}%`, rightEdgeX, progressY + 88);
}

export async function renderLevelCard(input: LevelCardRenderInput): Promise<Buffer> {
    const data = normalizeInput(input);
    const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
    const context = canvas.getContext('2d');

    await drawBackground(context);
    await drawAvatar(context, data.avatarUrl);
    drawTextAndProgress(context, data);

    const outputBuffer = canvas.toBuffer('image/png');
    if (outputBuffer.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('Generated level image exceeds allowed size limit.');
    }

    return outputBuffer;
}
