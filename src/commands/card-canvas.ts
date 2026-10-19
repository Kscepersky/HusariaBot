import { loadImage, registerFont, type CanvasRenderingContext2D, type Image } from 'canvas';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { HusariaColors } from '../utils/husaria-theme.js';

/** Wspolne klocki kart renderowanych na canvasie (/level, /ship). */

const AVATAR_LOAD_TIMEOUT_MS = 1200;
const FONT_DIR = join(__dirname, '..', '..', 'fonts');
const FONT_FAMILY_BASE = 'Husaria Sans';
const FONT_FAMILY_EMOJI = 'Husaria Emoji';
export const FONT_STACK = `"${FONT_FAMILY_BASE}", "${FONT_FAMILY_EMOJI}", "Noto Sans", "Noto Color Emoji", "Segoe UI Emoji", sans-serif`;
const BACKGROUND_IMAGE_PATH = join(__dirname, '..', '..', 'img', 'DNA-BANNER.png');
let cachedBackgroundImagePromise: Promise<Image> | null = null;
let fontsRegistered = false;

export interface CardLayout {
    width: number;
    height: number;
    outerPadding: number;
    panelRadius: number;
}

export function registerFontsOnce(): void {
    if (fontsRegistered) {
        return;
    }

    fontsRegistered = true;

    const candidates = [
        { path: join(FONT_DIR, 'NotoSans-Regular.ttf'), family: FONT_FAMILY_BASE, weight: '400' },
        { path: join(FONT_DIR, 'NotoSans-SemiBold.ttf'), family: FONT_FAMILY_BASE, weight: '600' },
        { path: join(FONT_DIR, 'NotoSans-Bold.ttf'), family: FONT_FAMILY_BASE, weight: '700' },
        { path: join(FONT_DIR, 'NotoColorEmoji.ttf'), family: FONT_FAMILY_EMOJI },
        { path: '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf', family: FONT_FAMILY_BASE, weight: '400' },
        { path: '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf', family: FONT_FAMILY_BASE, weight: '700' },
        { path: '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf', family: FONT_FAMILY_EMOJI },
    ];

    let registeredAny = false;
    const registeredKeys = new Set<string>();

    for (const candidate of candidates) {
        if (!existsSync(candidate.path)) {
            continue;
        }

        const weight = candidate.weight ?? '400';
        const key = `${candidate.family}:${weight}`;
        if (registeredKeys.has(key)) {
            continue;
        }

        try {
            registerFont(candidate.path, {
                family: candidate.family,
                ...(candidate.weight ? { weight: candidate.weight } : {}),
            });
            registeredAny = true;
            registeredKeys.add(key);
        } catch (error) {
            console.warn('Failed to register font for card rendering:', candidate.path, error);
        }
    }

    if (!registeredAny) {
        console.warn('No custom fonts found for card rendering. Falling back to system fonts.');
    }
}

export function toHexColor(color: number): string {
    return `#${color.toString(16).padStart(6, '0')}`;
}

export function roundedRectPath(
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

function drawPanel(context: CanvasRenderingContext2D, layout: CardLayout): void {
    const panelX = layout.outerPadding;
    const panelY = layout.outerPadding;
    const panelWidth = layout.width - layout.outerPadding * 2;
    const panelHeight = layout.height - layout.outerPadding * 2;

    roundedRectPath(context, panelX, panelY, panelWidth, panelHeight, layout.panelRadius);
    context.fillStyle = 'rgba(18, 22, 29, 0.70)';
    context.fill();

    roundedRectPath(context, panelX, panelY, panelWidth, panelHeight, layout.panelRadius);
    context.lineWidth = 2;
    context.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    context.stroke();
}

function loadBackgroundImage(): Promise<Image> {
    if (!cachedBackgroundImagePromise) {
        cachedBackgroundImagePromise = loadImage(BACKGROUND_IMAGE_PATH);
    }

    return cachedBackgroundImagePromise;
}

export async function loadAvatarImageWithTimeout(avatarUrl: string): Promise<Image> {
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

export async function drawBackground(context: CanvasRenderingContext2D, layout: CardLayout): Promise<void> {
    try {
        const backgroundImage = await loadBackgroundImage();
        const scale = Math.max(layout.width / backgroundImage.width, layout.height / backgroundImage.height);
        const drawWidth = backgroundImage.width * scale;
        const drawHeight = backgroundImage.height * scale;
        const drawX = (layout.width - drawWidth) / 2;
        const drawY = (layout.height - drawHeight) / 2;

        context.drawImage(backgroundImage, drawX, drawY, drawWidth, drawHeight);
    } catch {
        cachedBackgroundImagePromise = null;
        context.fillStyle = toHexColor(HusariaColors.DARK_GRAY);
        context.fillRect(0, 0, layout.width, layout.height);
    }

    const overlayGradient = context.createLinearGradient(0, 0, layout.width, layout.height);
    overlayGradient.addColorStop(0, 'rgba(8, 10, 14, 0.74)');
    overlayGradient.addColorStop(1, 'rgba(12, 15, 20, 0.64)');

    context.fillStyle = overlayGradient;
    context.fillRect(0, 0, layout.width, layout.height);

    drawPanel(context, layout);
}
