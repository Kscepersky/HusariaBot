import { createCanvas, type CanvasRenderingContext2D, type Image } from 'canvas';
import { HusariaColors } from '../utils/husaria-theme.js';
import {
    FONT_STACK,
    drawBackground,
    registerFontsOnce,
    roundedRectPath,
    toHexColor,
    tryFetchImage,
    type CardLayout,
} from './card-canvas.js';
import type { LolMatchSummary, LolProfile, LolRank } from './lol-profile.js';

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 600;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_NAME_LENGTH = 18;
const PROFILE_ICON_SIZE = 128;
const MAIN_ICON_SIZE = 84;
const MAIN_COLUMN_WIDTH = 170;
const MAINS_X = 640;
const TILE_WIDTH = 208;
const TILE_HEIGHT = 240;
const TILE_GAP = 12;
const TILES_Y = 316;
const TILE_ICON_SIZE = 72;
const WIN_COLOR = '#57F287';
const LOSS_COLOR = '#ED4245';
const REMAKE_COLOR = '#99AAB5';
const MUTED_TEXT = 'rgba(255, 255, 255, 0.62)';

const CARD_LAYOUT: CardLayout = {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    outerPadding: 24,
    panelRadius: 14,
};

const TIER_STYLES: Readonly<Record<string, { label: string; color: string }>> = {
    IRON: { label: 'Żelazo', color: '#8A8A8A' },
    BRONZE: { label: 'Brąz', color: '#B87A4B' },
    SILVER: { label: 'Srebro', color: '#A9B4C0' },
    GOLD: { label: 'Złoto', color: '#E6B93E' },
    PLATINUM: { label: 'Platyna', color: '#3FC1B0' },
    EMERALD: { label: 'Szmaragd', color: '#2EC27E' },
    DIAMOND: { label: 'Diament', color: '#5B9BEF' },
    MASTER: { label: 'Mistrz', color: '#B56BF0' },
    GRANDMASTER: { label: 'Arcymistrz', color: '#E0524D' },
    CHALLENGER: { label: 'Pretendent', color: '#F2D27A' },
};
const APEX_TIERS = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

function truncate(text: string, maxLength: number): string {
    const trimmed = text.trim();
    return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 3)}...`;
}

export function formatPoints(points: number): string {
    if (points >= 1_000_000) {
        return `${(points / 1_000_000).toFixed(2)}M`;
    }

    return points >= 1000 ? `${Math.round(points / 1000)}k` : String(points);
}

export function formatDuration(totalSeconds: number): string {
    const seconds = Math.max(0, Math.round(totalSeconds));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function drawImageOrPlaceholder(
    context: CanvasRenderingContext2D,
    image: Image | null | undefined,
    x: number,
    y: number,
    size: number,
    radius: number,
): void {
    context.save();
    roundedRectPath(context, x, y, size, size, radius);
    context.clip();
    if (image) {
        context.drawImage(image, x, y, size, size);
    } else {
        context.fillStyle = '#31353F';
        context.fillRect(x, y, size, size);
    }
    context.restore();
}

function drawProfileHeader(context: CanvasRenderingContext2D, profile: LolProfile, icon: Image | null | undefined): void {
    const centerX = 64 + PROFILE_ICON_SIZE / 2;
    const centerY = 56 + PROFILE_ICON_SIZE / 2;

    context.beginPath();
    context.arc(centerX, centerY, PROFILE_ICON_SIZE / 2 + 5, 0, Math.PI * 2);
    context.fillStyle = toHexColor(HusariaColors.GOLD);
    context.fill();
    context.save();
    context.beginPath();
    context.arc(centerX, centerY, PROFILE_ICON_SIZE / 2, 0, Math.PI * 2);
    context.clip();
    if (icon) {
        context.drawImage(icon, 64, 56, PROFILE_ICON_SIZE, PROFILE_ICON_SIZE);
    } else {
        context.fillStyle = '#31353F';
        context.fillRect(64, 56, PROFILE_ICON_SIZE, PROFILE_ICON_SIZE);
    }
    context.restore();

    roundedRectPath(context, centerX - 42, 56 + PROFILE_ICON_SIZE - 14, 84, 30, 15);
    context.fillStyle = 'rgba(12, 15, 20, 0.92)';
    context.fill();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = toHexColor(HusariaColors.WHITE);
    context.font = `700 18px ${FONT_STACK}`;
    context.fillText(String(profile.level), centerX, 56 + PROFILE_ICON_SIZE + 1);

    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    const name = truncate(profile.gameName, MAX_NAME_LENGTH);
    context.fillStyle = toHexColor(HusariaColors.WHITE);
    context.font = `700 40px ${FONT_STACK}`;
    context.fillText(name, 224, 96);
    const nameWidth = context.measureText(name).width;
    context.fillStyle = MUTED_TEXT;
    context.font = `600 24px ${FONT_STACK}`;
    context.fillText(`#${profile.tagLine}`, 224 + nameWidth + 8, 96);
    context.font = `600 18px ${FONT_STACK}`;
    context.fillText(`${profile.regionLabel}`, 224, 126);
}

function drawRank(context: CanvasRenderingContext2D, rank: LolRank | null): void {
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';

    if (!rank) {
        context.fillStyle = MUTED_TEXT;
        context.font = `700 34px ${FONT_STACK}`;
        context.fillText('Bez rangi', 224, 190);
        context.font = `400 20px ${FONT_STACK}`;
        context.fillText('Solo/Duo · brak rozegranych meczów rankingowych', 224, 222);
        return;
    }

    const style = TIER_STYLES[rank.tier] ?? { label: rank.tier, color: toHexColor(HusariaColors.WHITE) };
    const title = APEX_TIERS.has(rank.tier) ? style.label : `${style.label} ${rank.division}`;

    context.fillStyle = style.color;
    context.font = `700 44px ${FONT_STACK}`;
    context.fillText(title, 224, 192);
    const titleWidth = context.measureText(title).width;
    context.fillStyle = toHexColor(HusariaColors.WHITE);
    context.font = `600 26px ${FONT_STACK}`;
    context.fillText(`${rank.lp} LP`, 224 + titleWidth + 16, 192);

    const games = rank.wins + rank.losses;
    const winrate = games > 0 ? Math.round((rank.wins / games) * 100) : 0;
    context.fillStyle = 'rgba(255, 255, 255, 0.84)';
    context.font = `400 20px ${FONT_STACK}`;
    context.fillText(`Solo/Duo · ${rank.wins}W ${rank.losses}L · ${winrate}% WR`, 224, 226);

    const barWidth = 360;
    roundedRectPath(context, 224, 242, barWidth, 12, 6);
    context.fillStyle = LOSS_COLOR;
    context.fill();
    if (rank.wins > 0) {
        roundedRectPath(context, 224, 242, Math.max(12, (barWidth * rank.wins) / games), 12, 6);
        context.fillStyle = WIN_COLOR;
        context.fill();
    }
}

function drawMains(context: CanvasRenderingContext2D, profile: LolProfile, images: Map<string, Image | null>): void {
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = MUTED_TEXT;
    context.font = `600 18px ${FONT_STACK}`;
    context.fillText('NAJCZĘŚCIEJ GRANE (MASTERY)', MAINS_X, 76);

    if (profile.mains.length === 0) {
        context.font = `400 20px ${FONT_STACK}`;
        context.fillText('Brak danych o mastery', MAINS_X, 130);
        return;
    }

    profile.mains.forEach((main, index) => {
        const x = MAINS_X + index * MAIN_COLUMN_WIDTH;
        drawImageOrPlaceholder(context, images.get(main.iconUrl), x, 96, MAIN_ICON_SIZE, 14);
        context.fillStyle = toHexColor(HusariaColors.WHITE);
        context.font = `700 20px ${FONT_STACK}`;
        context.fillText(truncate(main.name, 12), x, 208);
        context.fillStyle = toHexColor(HusariaColors.GOLD);
        context.font = `600 18px ${FONT_STACK}`;
        context.fillText(`M${main.level} · ${formatPoints(main.points)}`, x, 234);
    });
}

function drawMatchTile(
    context: CanvasRenderingContext2D,
    match: LolMatchSummary,
    x: number,
    icon: Image | null | undefined,
): void {
    const accent = match.remake ? REMAKE_COLOR : match.win ? WIN_COLOR : LOSS_COLOR;
    const result = match.remake ? 'REMAKE' : match.win ? 'WYGRANA' : 'PORAŻKA';

    context.save();
    roundedRectPath(context, x, TILES_Y, TILE_WIDTH, TILE_HEIGHT, 12);
    context.clip();
    context.fillStyle = 'rgba(22, 26, 33, 0.88)';
    context.fillRect(x, TILES_Y, TILE_WIDTH, TILE_HEIGHT);
    context.fillStyle = accent;
    context.fillRect(x, TILES_Y, TILE_WIDTH, 8);
    context.restore();

    drawImageOrPlaceholder(context, icon, x + 16, TILES_Y + 28, TILE_ICON_SIZE, 12);

    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = accent;
    context.font = `700 20px ${FONT_STACK}`;
    context.fillText(result, x + 100, TILES_Y + 58);
    context.fillStyle = MUTED_TEXT;
    context.font = `400 16px ${FONT_STACK}`;
    context.fillText(match.queueLabel, x + 100, TILES_Y + 84);

    context.fillStyle = toHexColor(HusariaColors.WHITE);
    context.font = `700 20px ${FONT_STACK}`;
    context.fillText(truncate(match.championName, 14), x + 16, TILES_Y + 136);
    context.font = `700 30px ${FONT_STACK}`;
    context.fillText(`${match.kills} / ${match.deaths} / ${match.assists}`, x + 16, TILES_Y + 174);

    const kda = (match.kills + match.assists) / Math.max(1, match.deaths);
    context.fillStyle = 'rgba(255, 255, 255, 0.78)';
    context.font = `400 18px ${FONT_STACK}`;
    context.fillText(`${kda.toFixed(1)} KDA · ${match.cs} CS`, x + 16, TILES_Y + 204);
    context.fillStyle = MUTED_TEXT;
    context.fillText(formatDuration(match.durationSec), x + 16, TILES_Y + 228);
}

function drawMatches(context: CanvasRenderingContext2D, profile: LolProfile, images: Map<string, Image | null>): void {
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = MUTED_TEXT;
    context.font = `600 18px ${FONT_STACK}`;
    context.fillText('OSTATNIE MECZE', 56, 298);

    if (profile.matches.length === 0) {
        context.font = `400 22px ${FONT_STACK}`;
        context.fillText('Brak ostatnich meczów do wyświetlenia', 56, 360);
        return;
    }

    profile.matches.forEach((match, index) => {
        drawMatchTile(context, match, 56 + index * (TILE_WIDTH + TILE_GAP), images.get(match.iconUrl));
    });
}

export async function renderStatyLolCard(profile: LolProfile): Promise<Buffer> {
    registerFontsOnce();
    const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
    const context = canvas.getContext('2d');

    const urls = [...new Set([
        profile.profileIconUrl,
        ...profile.mains.map((main) => main.iconUrl),
        ...profile.matches.map((match) => match.iconUrl),
    ].filter(Boolean))];
    const loaded = await Promise.all(urls.map(async (url) => [url, await tryFetchImage(url)] as const));
    const images = new Map<string, Image | null>(loaded);

    await drawBackground(context, CARD_LAYOUT);
    drawProfileHeader(context, profile, images.get(profile.profileIconUrl));
    drawRank(context, profile.rank);
    drawMains(context, profile, images);
    drawMatches(context, profile, images);

    const outputBuffer = canvas.toBuffer('image/png');
    if (outputBuffer.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('Generated statylol image exceeds allowed size limit.');
    }

    return outputBuffer;
}
