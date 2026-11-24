import { createCanvas, loadImage, type Canvas, type CanvasRenderingContext2D } from 'canvas';
import { join } from 'node:path';
import { HusariaColors } from '../utils/husaria-theme.js';
import {
    FONT_STACK,
    drawBackground,
    registerFontsOnce,
    roundedRectPath,
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

const KICKER_FONT_SIZE = 44;
const KICKER_GAP = 24;
const SUBTITLE_MAX_FONT_SIZE = 28;
const SUBTITLE_MIN_FONT_SIZE = 16;
const SUBTITLE_GAP = 28;
const MAX_SUBTITLE_LENGTH = 90;
const HAZARD_BAND_HEIGHT = 16;
const HAZARD_STRIPE_WIDTH = 26;
const SUBTITLE_COLOR = 'rgba(255, 255, 255, 0.72)';

export type TitleCardVariant = 'default' | 'warning';

export interface TitleCardInput {
    title: string;
    /** Maly czerwony napis nad tytulem (np. "UWAGA!"). */
    kicker?: string;
    /** Linijka wyjasnienia pod tytulem. */
    subtitle?: string;
    /** `warning` dorysowuje czerwono-czarne pasy ostrzegawcze u gory i dolu panelu. */
    variant?: TitleCardVariant;
}

interface TitleTexts {
    kicker: string;
    title: string;
    subtitle: string;
    /** Rysowany wektorowo trojkat ostrzegawczy przed nadtytulem. */
    warningIcon: boolean;
}

const WARNING_ICON_GAP = 14;

/** Trojkat z wykrzyknikiem (rysowany, bo glif emoji ⚠ nie skaluje sie poprawnie). */
function drawWarningIcon(context: CanvasRenderingContext2D, x: number, baseline: number, height: number): number {
    const width = height * 1.15;
    const top = baseline - height;
    context.beginPath();
    context.moveTo(x + width / 2, top);
    context.lineTo(x + width, baseline);
    context.lineTo(x, baseline);
    context.closePath();
    context.fillStyle = toHexColor(HusariaColors.RED);
    context.fill();

    context.fillStyle = '#0B0D11';
    const barWidth = height * 0.13;
    context.fillRect(x + width / 2 - barWidth / 2, top + height * 0.32, barWidth, height * 0.36);
    context.fillRect(x + width / 2 - barWidth / 2, top + height * 0.76, barWidth, height * 0.12);
    return width + WARNING_ICON_GAP;
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

function drawSpaced(context: CanvasRenderingContext2D, text: string, x: number, baseline: number, spacing: number): void {
    let cursor = x;
    for (const char of text) {
        context.fillText(char, cursor, baseline);
        cursor += context.measureText(char).width + spacing;
    }
}

function fitSubtitleSize(context: CanvasRenderingContext2D, subtitle: string): number {
    for (let size = SUBTITLE_MAX_FONT_SIZE; size > SUBTITLE_MIN_FONT_SIZE; size -= 2) {
        context.font = `600 ${size}px ${FONT_STACK}`;
        if (context.measureText(subtitle).width <= TITLE_MAX_WIDTH) {
            return size;
        }
    }
    return SUBTITLE_MIN_FONT_SIZE;
}

/**
 * Rysuje emblemat i blok tekstu (nadtytul, tytul, podtytul) jako jedna grupe,
 * wysrodkowana w poziomie i pionie. Bez nadtytulu i podtytulu uklad jest taki jak dawniej.
 */
function drawEmblemAndTitle(context: CanvasRenderingContext2D, emblem: Canvas | null, texts: TitleTexts): void {
    const size = fitTitleSize(context, texts.title);
    const spacing = size * TITLE_LETTER_SPACING_RATIO;
    context.font = `700 ${size}px ${FONT_STACK}`;
    const titleWidth = measureSpaced(context, texts.title, spacing);

    const kickerSpacing = KICKER_FONT_SIZE * 0.08;
    context.font = `700 ${KICKER_FONT_SIZE}px ${FONT_STACK}`;
    const kickerCapHeight = KICKER_FONT_SIZE * CAP_HEIGHT_RATIO;
    const iconWidth = texts.kicker && texts.warningIcon ? kickerCapHeight * 1.15 + WARNING_ICON_GAP : 0;
    const kickerWidth = texts.kicker ? iconWidth + measureSpaced(context, texts.kicker, kickerSpacing) : 0;

    const subtitleSize = texts.subtitle ? fitSubtitleSize(context, texts.subtitle) : 0;
    context.font = `600 ${subtitleSize}px ${FONT_STACK}`;
    const subtitleWidth = texts.subtitle ? context.measureText(texts.subtitle).width : 0;

    const textWidth = Math.max(titleWidth, kickerWidth, subtitleWidth);
    const groupWidth = EMBLEM_SIZE + EMBLEM_TEXT_GAP + textWidth;
    const emblemX = (TITLE_CARD_WIDTH - groupWidth) / 2;
    const textX = emblemX + EMBLEM_SIZE + EMBLEM_TEXT_GAP;

    drawEmblem(context, emblem, emblemX);

    const kickerHeight = texts.kicker ? KICKER_FONT_SIZE * CAP_HEIGHT_RATIO + KICKER_GAP : 0;
    const titleHeight = size * CAP_HEIGHT_RATIO;
    const subtitleHeight = texts.subtitle ? SUBTITLE_GAP + subtitleSize * CAP_HEIGHT_RATIO : 0;
    let top = TITLE_CARD_HEIGHT / 2 - (kickerHeight + titleHeight + subtitleHeight) / 2;

    context.textBaseline = 'alphabetic';
    context.textAlign = 'left';

    if (texts.kicker) {
        context.font = `700 ${KICKER_FONT_SIZE}px ${FONT_STACK}`;
        context.fillStyle = toHexColor(HusariaColors.RED);
        const kickerBaseline = top + kickerCapHeight;
        const offset = texts.warningIcon ? drawWarningIcon(context, textX, kickerBaseline, kickerCapHeight) : 0;
        context.fillStyle = toHexColor(HusariaColors.RED);
        drawSpaced(context, texts.kicker, textX + offset, kickerBaseline, kickerSpacing);
        top += kickerHeight;
    }

    context.font = `700 ${size}px ${FONT_STACK}`;
    context.fillStyle = toHexColor(HusariaColors.WHITE);
    drawSpaced(context, texts.title, textX, top + titleHeight, spacing);
    top += titleHeight;

    if (texts.subtitle) {
        context.font = `600 ${subtitleSize}px ${FONT_STACK}`;
        context.fillStyle = SUBTITLE_COLOR;
        context.fillText(texts.subtitle, textX, top + subtitleHeight);
    }
}

/** Czerwono-czarne pasy ostrzegawcze przy gornej i dolnej krawedzi panelu. */
function drawHazardBands(context: CanvasRenderingContext2D): void {
    const panelX = OUTER_PADDING;
    const panelWidth = TITLE_CARD_WIDTH - OUTER_PADDING * 2;
    const panelHeight = TITLE_CARD_HEIGHT - OUTER_PADDING * 2;

    context.save();
    roundedRectPath(context, panelX, OUTER_PADDING, panelWidth, panelHeight, PANEL_RADIUS);
    context.clip();

    for (const bandY of [OUTER_PADDING, TITLE_CARD_HEIGHT - OUTER_PADDING - HAZARD_BAND_HEIGHT]) {
        context.fillStyle = '#0B0D11';
        context.fillRect(panelX, bandY, panelWidth, HAZARD_BAND_HEIGHT);
        context.fillStyle = toHexColor(HusariaColors.RED);
        for (let x = panelX - HAZARD_BAND_HEIGHT; x < panelX + panelWidth; x += HAZARD_STRIPE_WIDTH * 2) {
            context.beginPath();
            context.moveTo(x, bandY + HAZARD_BAND_HEIGHT);
            context.lineTo(x + HAZARD_BAND_HEIGHT, bandY);
            context.lineTo(x + HAZARD_BAND_HEIGHT + HAZARD_STRIPE_WIDTH, bandY);
            context.lineTo(x + HAZARD_STRIPE_WIDTH, bandY + HAZARD_BAND_HEIGHT);
            context.closePath();
            context.fill();
        }
    }
    context.restore();
}

export async function renderTitleCard(input: TitleCardInput): Promise<Buffer> {
    registerFontsOnce();
    const texts: TitleTexts = {
        title: normalizeText(input.title, MAX_TITLE_LENGTH) || 'BANER',
        kicker: normalizeText(input.kicker, MAX_TITLE_LENGTH),
        subtitle: normalizeText(input.subtitle, MAX_SUBTITLE_LENGTH),
        warningIcon: input.variant === 'warning',
    };

    const canvas = createCanvas(TITLE_CARD_WIDTH, TITLE_CARD_HEIGHT);
    const context = canvas.getContext('2d');

    await drawBackground(context, CARD_LAYOUT);
    if (input.variant === 'warning') {
        drawHazardBands(context);
    }
    drawEmblemAndTitle(context, await loadEmblem(), texts);

    const output = canvas.toBuffer('image/png');
    if (output.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('Wygenerowana karta przekracza limit rozmiaru.');
    }
    return output;
}
