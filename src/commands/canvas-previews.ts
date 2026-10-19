import type { User } from 'discord.js';

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
];

export function findCanvasPreview(key: string): CanvasPreview | undefined {
    return CANVAS_PREVIEWS.find((preview) => preview.key === key);
}
