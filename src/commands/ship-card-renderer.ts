import { createCanvas, type CanvasRenderingContext2D } from 'canvas';
import { HusariaColors } from '../utils/husaria-theme.js';
import {
    FONT_STACK,
    drawBackground,
    loadAvatarImageWithTimeout,
    registerFontsOnce,
    roundedRectPath,
    toHexColor,
    type CardLayout,
} from './card-canvas.js';

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 400;
const AVATAR_SIZE = 190;
const AVATAR_RING_WIDTH = 6;
const AVATAR_TOP = 52;
const AVATAR_CENTER_OFFSET = 250;
const NAME_BASELINE_Y = 284;
const BAR_X = 120;
const BAR_Y = 318;
const BAR_HEIGHT = 34;
const MAX_NAME_LENGTH = 18;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const CARD_LAYOUT: CardLayout = {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    outerPadding: 24,
    panelRadius: 14,
};

export interface ShipCardRenderInput {
    firstName: string;
    secondName: string;
    firstAvatarUrl?: string;
    secondAvatarUrl?: string;
    percent: number;
}

function truncateName(username: string): string {
    const trimmed = username.trim();
    if (trimmed.length <= MAX_NAME_LENGTH) {
        return trimmed || 'Nieznany';
    }

    return `${trimmed.slice(0, MAX_NAME_LENGTH - 3)}...`;
}

function normalizePercent(percent: number): number {
    return Math.min(100, Math.max(0, Math.round(Number.isFinite(percent) ? percent : 0)));
}

async function drawAvatar(
    context: CanvasRenderingContext2D,
    centerX: number,
    avatarUrl: string | undefined,
): Promise<void> {
    const radius = AVATAR_SIZE / 2;
    const centerY = AVATAR_TOP + radius;

    context.beginPath();
    context.arc(centerX, centerY, radius + AVATAR_RING_WIDTH, 0, Math.PI * 2);
    context.closePath();
    context.fillStyle = toHexColor(HusariaColors.RED);
    context.fill();

    context.save();
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.closePath();
    context.clip();

    let drawn = false;
    if (avatarUrl) {
        try {
            const image = await loadAvatarImageWithTimeout(avatarUrl);
            context.drawImage(image, centerX - radius, AVATAR_TOP, AVATAR_SIZE, AVATAR_SIZE);
            drawn = true;
        } catch {
            // Placeholder ponizej.
        }
    }

    if (!drawn) {
        context.fillStyle = '#31353F';
        context.fillRect(centerX - radius, AVATAR_TOP, AVATAR_SIZE, AVATAR_SIZE);
    }

    context.restore();
}

/** Wynik w stylu licznika levelu z /level: maly podpis + duza czerwona liczba. */
function drawScore(context: CanvasRenderingContext2D, percent: number): void {
    const centerX = CARD_WIDTH / 2;

    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';

    context.fillStyle = 'rgba(255, 255, 255, 0.84)';
    context.font = `600 24px ${FONT_STACK}`;
    context.fillText('KOMPATYBILNOSC', centerX, 96);

    context.fillStyle = toHexColor(HusariaColors.RED);
    context.font = `700 100px ${FONT_STACK}`;
    context.fillText(`${percent}%`, centerX, 198);
}

function drawNames(context: CanvasRenderingContext2D, firstName: string, secondName: string): void {
    const centerX = CARD_WIDTH / 2;

    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.fillStyle = toHexColor(HusariaColors.WHITE);
    context.font = `700 34px ${FONT_STACK}`;
    context.fillText(firstName, centerX - AVATAR_CENTER_OFFSET, NAME_BASELINE_Y);
    context.fillText(secondName, centerX + AVATAR_CENTER_OFFSET, NAME_BASELINE_Y);
}

function drawProgressBar(context: CanvasRenderingContext2D, percent: number): void {
    const barWidth = CARD_WIDTH - BAR_X * 2;

    roundedRectPath(context, BAR_X, BAR_Y, barWidth, BAR_HEIGHT, BAR_HEIGHT / 2);
    context.fillStyle = 'rgba(22, 26, 33, 0.94)';
    context.fill();

    const filledWidth = Math.round((barWidth * percent) / 100);
    if (filledWidth > 0) {
        const gradient = context.createLinearGradient(BAR_X, BAR_Y, BAR_X + barWidth, BAR_Y);
        gradient.addColorStop(0, toHexColor(HusariaColors.RED));
        gradient.addColorStop(1, toHexColor(HusariaColors.GOLD));

        roundedRectPath(context, BAR_X, BAR_Y, Math.max(filledWidth, BAR_HEIGHT), BAR_HEIGHT, BAR_HEIGHT / 2);
        context.fillStyle = gradient;
        context.fill();
    }

    roundedRectPath(context, BAR_X, BAR_Y, barWidth, BAR_HEIGHT, BAR_HEIGHT / 2);
    context.lineWidth = 2;
    context.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    context.stroke();
}

export async function renderShipCard(input: ShipCardRenderInput): Promise<Buffer> {
    registerFontsOnce();
    const percent = normalizePercent(input.percent);
    const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
    const context = canvas.getContext('2d');

    await drawBackground(context, CARD_LAYOUT);
    await drawAvatar(context, CARD_WIDTH / 2 - AVATAR_CENTER_OFFSET, input.firstAvatarUrl);
    await drawAvatar(context, CARD_WIDTH / 2 + AVATAR_CENTER_OFFSET, input.secondAvatarUrl);
    drawScore(context, percent);
    drawNames(context, truncateName(input.firstName), truncateName(input.secondName));
    drawProgressBar(context, percent);

    const outputBuffer = canvas.toBuffer('image/png');
    if (outputBuffer.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('Generated ship image exceeds allowed size limit.');
    }

    return outputBuffer;
}
