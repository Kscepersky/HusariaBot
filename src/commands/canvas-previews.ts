import type { User } from 'discord.js';
import { getResult } from './ttt-logic.js';

export interface CanvasPreviewContext {
    /** Osoba uruchamiajaca podglad - jej nick i awatar trafiaja na karty. */
    user: User;
    /** Druga osoba na kartach dwuosobowych (np. konto bota). */
    partner: User;
}

export interface CanvasPreview {
    key: string;
    label: string;
    render: (context: CanvasPreviewContext) => Promise<Buffer>;
}

function name(user: User): string {
    return user.globalName ?? user.username;
}

function avatar(user: User): string {
    return user.displayAvatarURL({ extension: 'png', forceStatic: true, size: 256 });
}

/**
 * Rejestr kart do podgladu w /canvastest. Nowa komenda z canvasem = jeden wpis tutaj;
 * renderery sa importowane leniwie, tak jak w samych komendach.
 */
export const CANVAS_PREVIEWS: readonly CanvasPreview[] = [
    {
        key: 'level',
        label: 'Level (/level)',
        async render({ user }) {
            const { renderLevelCard } = await import('./level-card-renderer.js');
            return renderLevelCard({
                username: name(user),
                avatarUrl: avatar(user),
                rank: 3,
                level: 12,
                totalXp: 4820,
                xpIntoCurrentLevel: 140,
                xpForNextLevel: 260,
                xpToNextLevel: 120,
            });
        },
    },
    {
        key: 'ship',
        label: 'Ship (/ship, /zeswataj)',
        async render({ user, partner }) {
            const { renderShipCard } = await import('./ship-card-renderer.js');
            return renderShipCard({
                firstName: name(user),
                secondName: name(partner),
                firstAvatarUrl: avatar(user),
                secondAvatarUrl: avatar(partner),
                percent: 73,
            });
        },
    },
    {
        key: 'pkn',
        label: 'Papier kamien nozyce (/pkn)',
        async render({ user, partner }) {
            const { renderPknCard } = await import('./pkn-card-renderer.js');
            return renderPknCard({
                firstName: name(user),
                secondName: name(partner),
                firstAvatarUrl: avatar(user),
                secondAvatarUrl: avatar(partner),
                firstMove: 'paper',
                secondMove: 'rock',
                outcome: 'first',
            });
        },
    },
    {
        key: 'ttt',
        label: 'Kolko i krzyzyk (/kk)',
        async render({ user, partner }) {
            const { renderTttCard } = await import('./ttt-card-renderer.js');
            const board = ['X', 'O', 'X', 'O', 'X', 'O', null, null, 'X'] as const;
            return renderTttCard({
                xName: name(user),
                oName: name(partner),
                xAvatarUrl: avatar(user),
                oAvatarUrl: avatar(partner),
                board,
                result: getResult(board),
            });
        },
    },
    {
        key: 'rr',
        label: 'Rosyjska ruletka (/rr)',
        async render({ user, partner }) {
            const { renderRrCard } = await import('./rr-card-renderer.js');
            return renderRrCard({
                names: [name(user), name(partner)],
                avatarUrls: [avatar(user), avatar(partner)],
                activeIndex: 1,
                firedChambers: 3,
                rotation: 2,
                event: 'click',
                spinsLeft: [1, 0],
            });
        },
    },
    {
        key: 'champion',
        label: 'Champion (/champion)',
        async render({ user }) {
            const { renderChampionCard } = await import('./champion-card-renderer.js');
            return renderChampionCard({
                championName: 'Vex',
                championTitle: 'Mroczna Żałoba',
                blurb: 'Yordle o ponurym usposobieniu, który żyje w cieniu własnego smutku.',
                caption: 'Ty to wiesz, ja to wiem, wszyscy to wiedzą',
                username: name(user),
                avatarUrl: avatar(user),
                splashUrl: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Vex_0.jpg',
                iconUrl: 'https://ddragon.leagueoflegends.com/cdn/16.1.1/img/champion/Vex.png',
            });
        },
    },
    {
        key: 'statylol',
        label: 'Statystyki LoL (/statylol)',
        async render() {
            const { renderStatyLolCard } = await import('./statylol-card-renderer.js');
            const version = '16.1.1';
            const icon = (id: string) => `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${id}.png`;
            const game = (championName: string, id: string, win: boolean, kills: number, deaths: number, assists: number) => ({
                championName, iconUrl: icon(id), win, remake: false, kills, deaths, assists,
                cs: 190, durationSec: 1840, queueLabel: 'Solo/Duo',
            });
            return renderStatyLolCard({
                gameName: 'Przykład', tagLine: 'EUNE', regionLabel: 'EUNE', level: 412,
                profileIconUrl: `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/29.png`,
                rank: { tier: 'EMERALD', division: 'III', lp: 54, wins: 112, losses: 98 },
                mains: [
                    { name: 'Viego', iconUrl: icon('Viego'), level: 7, points: 312450 },
                    { name: 'Vex', iconUrl: icon('Vex'), level: 7, points: 120300 },
                    { name: 'Volibear', iconUrl: icon('Volibear'), level: 6, points: 98000 },
                ],
                matches: [
                    game('Viego', 'Viego', true, 12, 3, 8),
                    game('Vex', 'Vex', false, 4, 9, 5),
                    game('Volibear', 'Volibear', true, 7, 2, 14),
                    game('Garen', 'Garen', false, 3, 6, 2),
                    game('Ahri', 'Ahri', true, 9, 1, 11),
                ],
            });
        },
    },
];

export function findCanvasPreview(key: string): CanvasPreview | undefined {
    return CANVAS_PREVIEWS.find((preview) => preview.key === key);
}
