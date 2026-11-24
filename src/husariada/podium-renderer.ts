import { createCanvas, type CanvasRenderingContext2D } from 'canvas';
import {
    FONT_STACK,
    drawBackground,
    drawRingedAvatar,
    registerFontsOnce,
    roundedRectPath,
    type CardLayout,
} from '../commands/card-canvas.js';
import type { Standing } from './types.js';

/** Grafika podium TOP 3 Husariady (ranking posredni i koncowy). */

const WIDTH = 1000;
const HEIGHT = 600;
const LAYOUT: CardLayout = { width: WIDTH, height: HEIGHT, outerPadding: 24, panelRadius: 18 };
const WHITE = '#F5F5F5';
const MUTED = 'rgba(255, 255, 255, 0.62)';
const ACCENT = '#DC143C';
const PODIUM_BASE_Y = HEIGHT - 60;
const COLUMN_WIDTH = 230;
const AVATAR_SIZE = 110;

interface PodiumSlot {
    /** Miejsce na liscie (0 = pierwsze). */
    rank: number;
    centerX: number;
    blockHeight: number;
    color: string;
    label: string;
}

/** Kolejnosc rysowania jak na prawdziwym podium: 2 - 1 - 3. */
const SLOTS: readonly PodiumSlot[] = [
    { rank: 1, centerX: WIDTH / 2 - 260, blockHeight: 120, color: '#C0C0C0', label: '2' },
    { rank: 0, centerX: WIDTH / 2, blockHeight: 170, color: '#FFD700', label: '1' },
    { rank: 2, centerX: WIDTH / 2 + 260, blockHeight: 90, color: '#CD7F32', label: '3' },
];

export interface PodiumInput {
    title: string;
    subtitle: string;
    standings: readonly Standing[];
}

function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (context.measureText(text).width <= maxWidth) {
        return text;
    }
    let trimmed = text;
    while (trimmed.length > 1 && context.measureText(`${trimmed}…`).width > maxWidth) {
        trimmed = trimmed.slice(0, -1);
    }
    return `${trimmed}…`;
}

function drawHeader(context: CanvasRenderingContext2D, input: PodiumInput): void {
    context.textAlign = 'center';
    context.fillStyle = ACCENT;
    context.font = `700 22px ${FONT_STACK}`;
    context.fillText('HUSARIADA', WIDTH / 2, 74);
    context.fillStyle = WHITE;
    context.font = `700 40px ${FONT_STACK}`;
    context.fillText(fitText(context, input.title, WIDTH - 140), WIDTH / 2, 120);
    context.fillStyle = MUTED;
    context.font = `400 22px ${FONT_STACK}`;
    context.fillText(fitText(context, input.subtitle, WIDTH - 140), WIDTH / 2, 152);
}

async function drawSlot(context: CanvasRenderingContext2D, slot: PodiumSlot, entry: Standing | undefined): Promise<void> {
    const blockTop = PODIUM_BASE_Y - slot.blockHeight;
    const blockX = slot.centerX - COLUMN_WIDTH / 2;

    roundedRectPath(context, blockX, blockTop, COLUMN_WIDTH, slot.blockHeight, 12);
    context.fillStyle = entry ? 'rgba(255, 255, 255, 0.10)' : 'rgba(255, 255, 255, 0.04)';
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = slot.color;
    context.stroke();

    context.textAlign = 'center';
    context.fillStyle = slot.color;
    context.font = `700 54px ${FONT_STACK}`;
    context.fillText(slot.label, slot.centerX, blockTop + slot.blockHeight / 2 + 20);

    if (!entry) {
        return;
    }

    const avatarTop = blockTop - AVATAR_SIZE - 92;
    await drawRingedAvatar(context, {
        centerX: slot.centerX,
        top: avatarTop,
        size: AVATAR_SIZE,
        ringWidth: 5,
        ringColor: slot.color,
        avatarUrl: entry.avatarUrl ?? undefined,
    });

    context.fillStyle = WHITE;
    context.font = `600 24px ${FONT_STACK}`;
    context.fillText(fitText(context, entry.displayName, COLUMN_WIDTH + 20), slot.centerX, avatarTop + AVATAR_SIZE + 40);
    context.fillStyle = slot.color;
    context.font = `700 28px ${FONT_STACK}`;
    context.fillText(`${entry.points} pkt`, slot.centerX, avatarTop + AVATAR_SIZE + 76);
}

export async function renderPodiumImage(input: PodiumInput): Promise<Buffer> {
    registerFontsOnce();
    const canvas = createCanvas(WIDTH, HEIGHT);
    const context = canvas.getContext('2d');

    await drawBackground(context, LAYOUT);
    drawHeader(context, input);
    for (const slot of SLOTS) {
        await drawSlot(context, slot, input.standings[slot.rank]);
    }

    return canvas.toBuffer('image/png');
}
