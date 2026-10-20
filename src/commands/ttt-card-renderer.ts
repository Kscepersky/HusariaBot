import { createCanvas, type CanvasRenderingContext2D } from 'canvas';
import { HusariaColors } from '../utils/husaria-theme.js';
import {
    FONT_STACK,
    drawBackground,
    drawRingedAvatar,
    registerFontsOnce,
    roundedRectPath,
    toHexColor,
    type CardLayout,
} from './card-canvas.js';
import type { TttBoard, TttMark, TttResult } from './ttt-logic.js';

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 400;
const AVATAR_SIZE = 150;
const AVATAR_RING_WIDTH = 6;
const AVATAR_TOP = 56;
const AVATAR_CENTER_OFFSET = 360;
const NAME_BASELINE_Y = 268;
const MARK_BASELINE_Y = 322;
const CAPTION_BASELINE_Y = 74;
const BOARD_TOP = 92;
const CELL_SIZE = 84;
const MARK_PADDING = 22;
const MAX_NAME_LENGTH = 16;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const X_COLOR = toHexColor(HusariaColors.RED);
const O_COLOR = '#4FA3FF';
const GOLD = toHexColor(HusariaColors.GOLD);

const CARD_LAYOUT: CardLayout = {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    outerPadding: 24,
    panelRadius: 14,
};

export interface TttCardRenderInput {
    /** Gracz grajacy X. */
    xName: string;
    /** Gracz grajacy O. */
    oName: string;
    xAvatarUrl?: string;
    oAvatarUrl?: string;
    board: TttBoard;
    /** Wynik partii; null/undefined = plansza w trakcie (np. walkower). */
    result?: TttResult | null;
    /** Zwyciezca partii, gdy wynik nie wynika z planszy (poddanie, walkower). */
    winnerMark?: TttMark | null;
}

function truncateName(username: string): string {
    const trimmed = username.trim();
    if (trimmed.length <= MAX_NAME_LENGTH) {
        return trimmed || 'Nieznany';
    }

    return `${trimmed.slice(0, MAX_NAME_LENGTH - 3)}...`;
}

function cellCenter(index: number, boardLeft: number): { x: number; y: number } {
    return {
        x: boardLeft + (index % 3) * CELL_SIZE + CELL_SIZE / 2,
        y: BOARD_TOP + Math.floor(index / 3) * CELL_SIZE + CELL_SIZE / 2,
    };
}

function drawGrid(context: CanvasRenderingContext2D, boardLeft: number): void {
    const size = CELL_SIZE * 3;

    roundedRectPath(context, boardLeft - 8, BOARD_TOP - 8, size + 16, size + 16, 16);
    context.fillStyle = 'rgba(22, 26, 33, 0.94)';
    context.fill();

    context.lineWidth = 4;
    context.lineCap = 'round';
    context.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    for (let step = 1; step < 3; step += 1) {
        context.beginPath();
        context.moveTo(boardLeft + step * CELL_SIZE, BOARD_TOP + 10);
        context.lineTo(boardLeft + step * CELL_SIZE, BOARD_TOP + size - 10);
        context.moveTo(boardLeft + 10, BOARD_TOP + step * CELL_SIZE);
        context.lineTo(boardLeft + size - 10, BOARD_TOP + step * CELL_SIZE);
        context.stroke();
    }
}

function drawMark(context: CanvasRenderingContext2D, mark: TttMark, x: number, y: number, dimmed: boolean): void {
    const half = CELL_SIZE / 2 - MARK_PADDING;
    context.globalAlpha = dimmed ? 0.4 : 1;
    context.lineWidth = 9;
    context.lineCap = 'round';

    if (mark === 'X') {
        context.strokeStyle = X_COLOR;
        context.beginPath();
        context.moveTo(x - half, y - half);
        context.lineTo(x + half, y + half);
        context.moveTo(x + half, y - half);
        context.lineTo(x - half, y + half);
        context.stroke();
    } else {
        context.strokeStyle = O_COLOR;
        context.beginPath();
        context.arc(x, y, half + 1, 0, Math.PI * 2);
        context.stroke();
    }

    context.globalAlpha = 1;
}

function drawBoard(
    context: CanvasRenderingContext2D,
    board: TttBoard,
    winningLine: readonly number[] | null,
): void {
    const boardLeft = (CARD_WIDTH - CELL_SIZE * 3) / 2;
    drawGrid(context, boardLeft);

    board.forEach((cell, index) => {
        if (cell === null) {
            return;
        }

        const { x, y } = cellCenter(index, boardLeft);
        drawMark(context, cell, x, y, winningLine !== null && !winningLine.includes(index));
    });

    if (winningLine && winningLine.length === 3) {
        const start = cellCenter(winningLine[0]!, boardLeft);
        const end = cellCenter(winningLine[2]!, boardLeft);
        context.lineWidth = 10;
        context.lineCap = 'round';
        context.strokeStyle = GOLD;
        context.shadowColor = GOLD;
        context.shadowBlur = 18;
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
        context.shadowBlur = 0;
    }
}

function drawPlayer(context: CanvasRenderingContext2D, centerX: number, name: string, mark: TttMark): void {
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';

    context.fillStyle = toHexColor(HusariaColors.WHITE);
    context.font = `700 30px ${FONT_STACK}`;
    context.fillText(name, centerX, NAME_BASELINE_Y);

    context.fillStyle = mark === 'X' ? X_COLOR : O_COLOR;
    context.font = `700 44px ${FONT_STACK}`;
    context.fillText(mark, centerX, MARK_BASELINE_Y);
}

function drawCaption(context: CanvasRenderingContext2D, text: string, color: string): void {
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.fillStyle = color;
    context.font = `700 32px ${FONT_STACK}`;
    context.fillText(text, CARD_WIDTH / 2, CAPTION_BASELINE_Y);
}

export async function renderTttCard(input: TttCardRenderInput): Promise<Buffer> {
    registerFontsOnce();
    const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
    const context = canvas.getContext('2d');

    const xName = truncateName(input.xName);
    const oName = truncateName(input.oName);
    const winnerMark = input.result?.kind === 'win' ? input.result.mark : (input.winnerMark ?? null);
    const winningLine = input.result?.kind === 'win' ? input.result.line : null;
    const red = toHexColor(HusariaColors.RED);

    await drawBackground(context, CARD_LAYOUT);
    await drawRingedAvatar(context, {
        centerX: CARD_WIDTH / 2 - AVATAR_CENTER_OFFSET,
        top: AVATAR_TOP,
        size: AVATAR_SIZE,
        ringWidth: AVATAR_RING_WIDTH,
        ringColor: winnerMark === 'X' ? GOLD : red,
        ...(input.xAvatarUrl ? { avatarUrl: input.xAvatarUrl } : {}),
    });
    await drawRingedAvatar(context, {
        centerX: CARD_WIDTH / 2 + AVATAR_CENTER_OFFSET,
        top: AVATAR_TOP,
        size: AVATAR_SIZE,
        ringWidth: AVATAR_RING_WIDTH,
        ringColor: winnerMark === 'O' ? GOLD : red,
        ...(input.oAvatarUrl ? { avatarUrl: input.oAvatarUrl } : {}),
    });

    drawPlayer(context, CARD_WIDTH / 2 - AVATAR_CENTER_OFFSET, xName, 'X');
    drawPlayer(context, CARD_WIDTH / 2 + AVATAR_CENTER_OFFSET, oName, 'O');
    drawBoard(context, input.board, winningLine);

    if (winnerMark) {
        drawCaption(context, `WYGRYWA ${winnerMark === 'X' ? xName : oName}`.toUpperCase(), GOLD);
    } else {
        drawCaption(context, 'REMIS', 'rgba(255, 255, 255, 0.84)');
    }

    const outputBuffer = canvas.toBuffer('image/png');
    if (outputBuffer.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('Generated ttt image exceeds allowed size limit.');
    }

    return outputBuffer;
}
