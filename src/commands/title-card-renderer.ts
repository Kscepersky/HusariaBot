import { createCanvas, loadImage, type Canvas, type CanvasRenderingContext2D } from 'canvas';
import { join } from 'node:path';
import { HusariaColors } from '../utils/husaria-theme.js';
import {
    FONT_STACK,
    drawBackground,
    registerFontsOnce,
    toHexColor,
    type CardLayout,
} from './card-canvas.js';

/**
 * Karta z jednym duzym napisem (np. "REGULAMIN") w stylu kart /level i /statylol:
 * to samo tlo i panel, a na nim okragly emblemat z logo i sam tytul, wysrodkowane
 * jako jedna calosc. Uzywana przez /wyslijcanvas i podgladana w /canvastest.
 */

export const TITLE_CARD_WIDTH = 1200;
export const TITLE_CARD_HEIGHT = 400;
const OUTER_PADDING = 24;
const PANEL_RADIUS = 14;
const EMBLEM_SIZE = 170;
const EMBLEM_RING_WIDTH = 6;
const EMBLEM_TEXT_GAP = 44;
/** Poziomy margines wewnatrz panelu - tytul nigdy nie wchodzi w ramke. */
const CONTENT_MARGIN = OUTER_PADDING + 40;
const TITLE_MAX_WIDTH = TITLE_CARD_WIDTH - CONTENT_MARGIN * 2 - EMBLEM_SIZE - EMBLEM_TEXT_GAP;
/** Wysokosc wielkich liter wzgledem rozmiaru czcionki (Noto Sans Bold). */
const CAP_HEIGHT_RATIO = 0.72;
const TITLE_MAX_FONT_SIZE = 132;
const TITLE_MIN_FONT_SIZE = 36;
const TITLE_LETTER_SPACING_RATIO = 0.03;
const MAX_TITLE_LENGTH = 40;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const LOGO_PATH = join(__dirname, '..', '..', 'img', 'DNA.png');
/** Kwadrat wokol hełmu w DNA.png (2000x2000), z zapasem, zeby nic nie uciekalo poza kolo. */
const LOGO_CROP = { x: 150, y: 150, size: 1700 };

const CARD_LAYOUT: CardLayout = {
    width: TITLE_CARD_WIDTH,
    height: TITLE_CARD_HEIGHT,
    outerPadding: OUTER_PADDING,
    panelRadius: PANEL_RADIUS,
};

export interface TitleCardInput {
    title: string;
}

let cachedEmblem: Promise<Canvas | null> | null = null;

/**
 * Logo ma kilka MB - skalujemy je RAZ do kafelka emblematu (2x dla ostrosci).
 * Brak pliku nie blokuje karty, rysujemy wtedy sam ciemny emblemat.
 */
function loadEmblem(): Promise<Canvas | null> {
    if (!cachedEmblem) {
        cachedEmblem = loadImage(LOGO_PATH)
            .then((logo) => {
                const size = EMBLEM_SIZE * 2;
                const tile = createCanvas(size, size);
                tile.getContext('2d').drawImage(logo, LOGO_CROP.x, LOGO_CROP.y, LOGO_CROP.size, LOGO_CROP.size, 0, 0, size, size);
                return tile;
            })
            .catch(() => {
                cachedEmblem = null;
                return null;
            });
    }
    return cachedEmblem;
}

function normalizeText(value: string | undefined, maxLength: number): string {
    return (value ?? '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, maxLength);
}

function drawEmblem(context: CanvasRenderingContext2D, emblem: Canvas | null, emblemX: number): void {
    const radius = EMBLEM_SIZE / 2;
    const centerX = emblemX + radius;
    const centerY = TITLE_CARD_HEIGHT / 2;

    context.beginPath();
    context.arc(centerX, centerY, radius + EMBLEM_RING_WIDTH, 0, Math.PI * 2);
    context.closePath();
    context.fillStyle = 'rgba(8, 10, 14, 0.86)';
    context.fill();

    context.save();
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.closePath();
    context.clip();
    if (emblem) {
        context.drawImage(emblem, emblemX, centerY - radius, EMBLEM_SIZE, EMBLEM_SIZE);
    } else {
        context.fillStyle = '#16191F';
        context.fillRect(emblemX, centerY - radius, EMBLEM_SIZE, EMBLEM_SIZE);
    }
    context.restore();

    context.beginPath();
    context.arc(centerX, centerY, radius - 1, 0, Math.PI * 2);
    context.closePath();
    context.lineWidth = 3;
    context.strokeStyle = toHexColor(HusariaColors.RED);
    context.stroke();
}

function measureSpaced(context: CanvasRenderingContext2D, text: string, spacing: number): number {
    const chars = [...text];
    return chars.reduce((sum, char) => sum + context.measureText(char).width, 0) + spacing * Math.max(0, chars.length - 1);
}

/** Najwiekszy rozmiar czcionki, przy ktorym tytul miesci sie obok emblematu. */
function fitTitleSize(context: CanvasRenderingContext2D, title: string): number {
    for (let size = TITLE_MAX_FONT_SIZE; size > TITLE_MIN_FONT_SIZE; size -= 4) {
        context.font = `700 ${size}px ${FONT_STACK}`;
        if (measureSpaced(context, title, size * TITLE_LETTER_SPACING_RATIO) <= TITLE_MAX_WIDTH) {
            return size;
        }
    }
    return TITLE_MIN_FONT_SIZE;
}

/** Rysuje tytul tak, by emblemat + napis tworzyly jedna, wysrodkowana w poziomie i pionie grupe. */
function drawEmblemAndTitle(context: CanvasRenderingContext2D, emblem: Canvas | null, title: string): void {
    const size = fitTitleSize(context, title);
    const spacing = size * TITLE_LETTER_SPACING_RATIO;
    context.font = `700 ${size}px ${FONT_STACK}`;

    const titleWidth = measureSpaced(context, title, spacing);
    const groupWidth = EMBLEM_SIZE + EMBLEM_TEXT_GAP + titleWidth;
    const emblemX = (TITLE_CARD_WIDTH - groupWidth) / 2;

    drawEmblem(context, emblem, emblemX);

    context.textBaseline = 'alphabetic';
    context.textAlign = 'left';
    context.fillStyle = toHexColor(HusariaColors.WHITE);
    const baseline = TITLE_CARD_HEIGHT / 2 + (size * CAP_HEIGHT_RATIO) / 2;
    let x = emblemX + EMBLEM_SIZE + EMBLEM_TEXT_GAP;
    for (const char of title) {
        context.fillText(char, x, baseline);
        x += context.measureText(char).width + spacing;
    }
}

export async function renderTitleCard(input: TitleCardInput): Promise<Buffer> {
    registerFontsOnce();
    const title = normalizeText(input.title, MAX_TITLE_LENGTH) || 'BANER';

    const canvas = createCanvas(TITLE_CARD_WIDTH, TITLE_CARD_HEIGHT);
    const context = canvas.getContext('2d');

    await drawBackground(context, CARD_LAYOUT);
    drawEmblemAndTitle(context, await loadEmblem(), title);

    const output = canvas.toBuffer('image/png');
    if (output.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('Wygenerowana karta przekracza limit rozmiaru.');
    }
    return output;
}
