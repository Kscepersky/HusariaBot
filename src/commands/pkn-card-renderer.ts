import { createCanvas, type CanvasRenderingContext2D } from 'canvas';
import { HusariaColors } from '../utils/husaria-theme.js';
import {
    FONT_STACK,
    drawBackground,
    loadAvatarImageWithTimeout,
    registerFontsOnce,
    toHexColor,
    type CardLayout,
} from './card-canvas.js';
import { PKN_MOVE_LABEL, type PknMove, type PknOutcome } from './pkn-logic.js';

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 400;
const AVATAR_SIZE = 150;
const AVATAR_RING_WIDTH = 6;
const AVATAR_TOP = 48;
const AVATAR_CENTER_OFFSET = 300;
const NAME_BASELINE_Y = 258;
const MOVE_CAPTION_BASELINE_Y = 306;
const MOVE_LABEL_BASELINE_Y = 352;
const MAX_NAME_LENGTH = 16;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const CARD_LAYOUT: CardLayout = {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    outerPadding: 24,
    panelRadius: 14,
};

export interface PknCardRenderInput {
    firstName: string;
    secondName: string;
    firstAvatarUrl?: string;
    secondAvatarUrl?: string;
    firstMove: PknMove;
    secondMove: PknMove;
    outcome: PknOutcome;
}

function truncateName(username: string): string {
    const trimmed = username.trim();
    if (trimmed.length <= MAX_NAME_LENGTH) {
        return trimmed || 'Nieznany';
    }

    return `${trimmed.slice(0, MAX_NAME_LENGTH - 3)}...`;
}

async function drawAvatar(
    context: CanvasRenderingContext2D,
    centerX: number,
    avatarUrl: string | undefined,
    ringColor: string,
): Promise<void> {
    const radius = AVATAR_SIZE / 2;
    const centerY = AVATAR_TOP + radius;

    context.beginPath();
    context.arc(centerX, centerY, radius + AVATAR_RING_WIDTH, 0, Math.PI * 2);
    context.closePath();
    context.fillStyle = ringColor;
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

function drawPlayer(
    context: CanvasRenderingContext2D,
    centerX: number,
    name: string,
    move: PknMove,
): void {
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';

    context.fillStyle = toHexColor(HusariaColors.WHITE);
    context.font = `700 30px ${FONT_STACK}`;
    context.fillText(name, centerX, NAME_BASELINE_Y);

    context.fillStyle = 'rgba(255, 255, 255, 0.84)';
    context.font = `600 20px ${FONT_STACK}`;
    context.fillText('WYBRAL', centerX, MOVE_CAPTION_BASELINE_Y);

    context.fillStyle = toHexColor(HusariaColors.RED);
    context.font = `700 44px ${FONT_STACK}`;
    context.fillText(PKN_MOVE_LABEL[move].toUpperCase(), centerX, MOVE_LABEL_BASELINE_Y);
}

/** Srodek karty: duzy napis wyniku + zwyciezca, w stylu licznika z /ship. */
function drawVerdict(
    context: CanvasRenderingContext2D,
    outcome: PknOutcome,
    firstName: string,
    secondName: string,
): void {
    const centerX = CARD_WIDTH / 2;
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';

    if (outcome === 'draw') {
        context.fillStyle = 'rgba(255, 255, 255, 0.84)';
        context.font = `600 24px ${FONT_STACK}`;
        context.fillText('PAPIER KAMIEN NOZYCE', centerX, 120);

        context.fillStyle = toHexColor(HusariaColors.RED);
        context.font = `700 84px ${FONT_STACK}`;
        context.fillText('REMIS', centerX, 224);
        return;
    }

    context.fillStyle = 'rgba(255, 255, 255, 0.84)';
    context.font = `600 24px ${FONT_STACK}`;
    context.fillText('WYGRYWA', centerX, 120);

    context.fillStyle = toHexColor(HusariaColors.GOLD);
    context.font = `700 44px ${FONT_STACK}`;
    context.fillText(outcome === 'first' ? firstName : secondName, centerX, 190);

    context.fillStyle = toHexColor(HusariaColors.RED);
    context.font = `700 60px ${FONT_STACK}`;
    context.fillText('VS', centerX, 262);
}

export async function renderPknCard(input: PknCardRenderInput): Promise<Buffer> {
    registerFontsOnce();
    const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
    const context = canvas.getContext('2d');

    const firstName = truncateName(input.firstName);
    const secondName = truncateName(input.secondName);
    const red = toHexColor(HusariaColors.RED);
    const gold = toHexColor(HusariaColors.GOLD);
    const firstRing = input.outcome === 'first' ? gold : red;
    const secondRing = input.outcome === 'second' ? gold : red;

    await drawBackground(context, CARD_LAYOUT);
    await drawAvatar(context, CARD_WIDTH / 2 - AVATAR_CENTER_OFFSET, input.firstAvatarUrl, firstRing);
    await drawAvatar(context, CARD_WIDTH / 2 + AVATAR_CENTER_OFFSET, input.secondAvatarUrl, secondRing);
    drawPlayer(context, CARD_WIDTH / 2 - AVATAR_CENTER_OFFSET, firstName, input.firstMove);
    drawPlayer(context, CARD_WIDTH / 2 + AVATAR_CENTER_OFFSET, secondName, input.secondMove);
    drawVerdict(context, input.outcome, firstName, secondName);

    const outputBuffer = canvas.toBuffer('image/png');
    if (outputBuffer.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('Generated pkn image exceeds allowed size limit.');
    }

    return outputBuffer;
}
