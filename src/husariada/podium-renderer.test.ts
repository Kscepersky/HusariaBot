import { describe, expect, it, vi } from 'vitest';
import { renderPodiumImage } from './podium-renderer.js';
import type { Standing } from './types.js';

function standing(place: number, name: string, points: number): Standing {
    return { place, userId: String(place), displayName: name, avatarUrl: null, points, correctCount: 1, answeredCount: 1, correctResponseMs: 0 };
}

describe('renderPodiumImage', () => {
    it('renderuje PNG dla pelnego podium', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const buffer = await renderPodiumImage({
            title: 'Wiedza o G2',
            subtitle: 'TOP 3 po 5/10 pytaniach',
            standings: [standing(1, 'Bardzo długi nick gracza husarii', 1500), standing(2, 'Bob', 900), standing(3, 'Cezary', 400)],
        });
        expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });

    it('renderuje podium z mniejsza liczba graczy', async () => {
        const buffer = await renderPodiumImage({ title: 'Q', subtitle: 'S', standings: [standing(1, 'Ala', 100)] });
        expect(buffer.length).toBeGreaterThan(1000);
    });
});
