import { createCanvas, type CanvasRenderingContext2D } from 'canvas';
import { HusariaColors } from '../utils/husaria-theme.js';
import {
    FONT_STACK,
    drawBackground,
    drawRingedAvatar,
    registerFontsOnce,
    toHexColor,
    type CardLayout,
} from './card-canvas.js';
import { RR_CHAMBERS } from './rr-logic.js';

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 400;
const AVATAR_SIZE = 150;
const AVATAR_RING_WIDTH = 6;
const AVATAR_TOP = 56;
const AVATAR_CENTER_OFFSET = 360;
const NAME_BASELINE_Y = 268;
const SUBLABEL_BASELINE_Y = 312;
const CAPTION_BASELINE_Y = 74;
const DRUM_CENTER_Y = 206;
const DRUM_RADIUS = 104;
const CHAMBER_RING_RADIUS = 64;
const CHAMBER_RADIUS = 25;
const MAX_NAME_LENGTH = 16;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const RED = toHexColor(HusariaColors.RED);
const GOLD = toHexColor(HusariaColors.GOLD);
const WHITE = toHexColor(HusariaColors.WHITE);

const CARD_LAYOUT: CardLayout = {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    outerPadding: 24,
    panelRadius: 14,
};

export type RrCardEvent = 'ready' | 'click' | 'spin' | 'bang';

export interface RrCardRenderInput {
    /** Gracze w kolejnosci: [wyzywajacy, wyzwany]. */
    names: readonly [string, string];
    avatarUrls?: readonly [string | undefined, string | undefined];
    /** Czyja kolej (null po zakonczeniu partii). */
    activeIndex: 0 | 1 | null;
    /** Kto dostal kule - tylko dla zdarzenia "bang". */
    loserIndex?: 0 | 1 | null;
    /** Ile razy pociagnieto spust od ostatniego zakrecenia (na bang wlacznie ze strzalem). */
    firedChambers: number;
    rotation: number;
    event: RrCardEvent;
    /** Ile zakreceni zostalo kazdemu z graczy. */
    spinsLeft: readonly [number, number];
}

function truncateName(username: string): string {
    const trimmed = username.trim();
    if (trimmed.length <= MAX_NAME_LENGTH) {
        return trimmed || 'Nieznany';
    }

    return `${trimmed.slice(0, MAX_NAME_LENGTH - 3)}...`;
}

function chamberPosition(slot: number, centerX: number): { x: number; y: number } {
    const angle = -Math.PI / 2 + (slot * 2 * Math.PI) / RR_CHAMBERS;
    return {
        x: centerX + Math.cos(angle) * CHAMBER_RING_RADIUS,
        y: DRUM_CENTER_Y + Math.sin(angle) * CHAMBER_RING_RADIUS,
    };
}

function drawDrum(context: CanvasRenderingContext2D, input: RrCardRenderInput): void {
    const centerX = CARD_WIDTH / 2;

    context.beginPath();
    context.arc(centerX, DRUM_CENTER_Y, DRUM_RADIUS, 0, Math.PI * 2);
    context.fillStyle = 'rgba(22, 26, 33, 0.96)';
    context.fill();
    context.lineWidth = 5;
    context.strokeStyle = input.event === 'spin' ? GOLD : 'rgba(255, 255, 255, 0.28)';
    context.stroke();

    const fired = Math.min(Math.max(input.firedChambers, 0), RR_CHAMBERS);
    const hitSlot = input.event === 'bang' && fired > 0 ? (fired - 1 + input.rotation) % RR_CHAMBERS : -1;

    for (let slot = 0; slot < RR_CHAMBERS; slot += 1) {
        const { x, y } = chamberPosition(slot, centerX);
        const order = (slot - input.rotation + RR_CHAMBERS) % RR_CHAMBERS;
        const isFired = order < fired;

        context.beginPath();
        context.arc(x, y, CHAMBER_RADIUS, 0, Math.PI * 2);

        if (slot === hitSlot) {
            context.shadowColor = RED;
            context.shadowBlur = 22;
            context.fillStyle = RED;
            context.fill();
            context.shadowBlur = 0;
            context.lineWidth = 3;
            context.strokeStyle = GOLD;
            context.stroke();
        } else if (isFired) {
            context.fillStyle = 'rgba(0, 0, 0, 0.78)';
            context.fill();
            context.lineWidth = 2;
            context.strokeStyle = 'rgba(255, 255, 255, 0.12)';
            context.stroke();
        } else {
            context.fillStyle = 'rgba(255, 255, 255, 0.14)';
            context.fill();
            context.lineWidth = 3;
            context.strokeStyle = 'rgba(255, 255, 255, 0.42)';
            context.stroke();
        }
    }

    context.beginPath();
    context.arc(centerX, DRUM_CENTER_Y, 13, 0, Math.PI * 2);
    context.fillStyle = 'rgba(255, 255, 255, 0.32)';
    context.fill();

    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.fillStyle = 'rgba(255, 255, 255, 0.7)';
    context.font = `600 20px ${FONT_STACK}`;
    context.fillText(`STRZALY: ${fired}/${RR_CHAMBERS}`, centerX, DRUM_CENTER_Y + DRUM_RADIUS + 34);
}

function drawCaption(context: CanvasRenderingContext2D, event: RrCardEvent): void {
    const captions: Record<RrCardEvent, { text: string; color: string }> = {
        ready: { text: 'ROSYJSKA RULETKA', color: WHITE },
        click: { text: 'KLIK...', color: WHITE },
        spin: { text: 'ZAKRECONO BEBEN', color: GOLD },
        bang: { text: 'BANG!', color: RED },
    };
    const caption = captions[event];

    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.fillStyle = caption.color;
    context.font = `700 ${event === 'bang' ? 40 : 32}px ${FONT_STACK}`;
    context.fillText(caption.text, CARD_WIDTH / 2, CAPTION_BASELINE_Y);
}

function drawPlayer(
    context: CanvasRenderingContext2D,
    centerX: number,
    name: string,
    subLabel: { text: string; color: string },
): void {
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';

    context.fillStyle = WHITE;
    context.font = `700 30px ${FONT_STACK}`;
    context.fillText(name, centerX, NAME_BASELINE_Y);

    context.fillStyle = subLabel.color;
    context.font = `600 22px ${FONT_STACK}`;
    context.fillText(subLabel.text, centerX, SUBLABEL_BASELINE_Y);
}

function resolveSubLabel(
    input: RrCardRenderInput,
    index: 0 | 1,
): { text: string; color: string } {
    if (input.event === 'bang') {
        return input.loserIndex === index
            ? { text: 'TRAFIONY', color: RED }
            : { text: 'WYGRYWA', color: GOLD };
    }

    const spins = `ZAKRECENIA: ${input.spinsLeft[index]}`;
    return input.activeIndex === index
        ? { text: `TWOJ RUCH | ${spins}`, color: GOLD }
        : { text: spins, color: 'rgba(255, 255, 255, 0.7)' };
}

export async function renderRrCard(input: RrCardRenderInput): Promise<Buffer> {
    registerFontsOnce();
    const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
    const context = canvas.getContext('2d');

    const names = [truncateName(input.names[0]), truncateName(input.names[1])] as const;
    const positions = [CARD_WIDTH / 2 - AVATAR_CENTER_OFFSET, CARD_WIDTH / 2 + AVATAR_CENTER_OFFSET] as const;
    const isBang = input.event === 'bang';

    await drawBackground(context, CARD_LAYOUT);

    for (const index of [0, 1] as const) {
        const isLoser = isBang && input.loserIndex === index;
        const isGold = isBang ? !isLoser : input.activeIndex === index;
        const avatarUrl = input.avatarUrls?.[index];

        await drawRingedAvatar(context, {
            centerX: positions[index],
            top: AVATAR_TOP,
            size: AVATAR_SIZE,
            ringWidth: AVATAR_RING_WIDTH,
            ringColor: isGold ? GOLD : RED,
            ...(avatarUrl ? { avatarUrl } : {}),
        });

        if (isLoser) {
            context.beginPath();
            context.arc(positions[index], AVATAR_TOP + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
            context.fillStyle = 'rgba(160, 0, 20, 0.5)';
            context.fill();
        }

        drawPlayer(context, positions[index], names[index], resolveSubLabel(input, index));
    }

    drawCaption(context, input.event);
    drawDrum(context, input);

    const outputBuffer = canvas.toBuffer('image/png');
    if (outputBuffer.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('Generated rr image exceeds allowed size limit.');
    }

    return outputBuffer;
}
