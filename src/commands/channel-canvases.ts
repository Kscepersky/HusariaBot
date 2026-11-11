export interface ChannelCanvas {
    key: string;
    label: string;
    fileName: string;
    render: () => Promise<Buffer>;
}

/**
 * Canvasy, ktore bot moze wyslac na kanal (/wyslijcanvas) i ktore automatycznie
 * trafiaja tez do podgladu w /canvastest. Nowy baner = jeden wpis tutaj
 * (po zmianie trzeba ponownie zrobic `npm run deploy`, zeby doszedl wybor w Discordzie).
 * Renderer ladujemy leniwie, tak jak w canvas-previews.
 */
export const CHANNEL_CANVASES: readonly ChannelCanvas[] = [
    {
        key: 'regulamin',
        label: 'REGULAMIN',
        fileName: 'regulamin.png',
        async render() {
            const { renderTitleCard } = await import('./title-card-renderer.js');
            return renderTitleCard({ title: 'REGULAMIN' });
        },
    },
];
