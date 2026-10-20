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
];

export function findCanvasPreview(key: string): CanvasPreview | undefined {
    return CANVAS_PREVIEWS.find((preview) => preview.key === key);
}
