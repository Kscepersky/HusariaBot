import { describe, expect, it } from 'vitest';
import { renderRrCard, type RrCardEvent } from './rr-card-renderer.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

describe('renderRrCard', () => {
    it.each<RrCardEvent>(['ready', 'click', 'spin', 'bang'])('renderuje poprawny PNG dla zdarzenia %s', async (event) => {
        const result = await renderRrCard({
            names: ['Ala', 'Ola'],
            activeIndex: event === 'bang' ? null : 0,
            loserIndex: event === 'bang' ? 1 : null,
            firedChambers: event === 'ready' || event === 'spin' ? 0 : 3,
            rotation: 2,
            event,
            spinsLeft: [1, 0],
        });

        expect(result.byteLength).toBeGreaterThan(1000);
        expect(result.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    });

    it('radzi sobie ze skrajnymi wartosciami, dlugim nickiem i zlym URL awatara', async () => {
        const result = await renderRrCard({
            names: ['BardzoDlugiNickKtoryPowinienZostacPrzyciety', ''],
            avatarUrls: ['not-a-valid-avatar-url', undefined],
            activeIndex: 1,
            firedChambers: 99,
            rotation: 7,
            event: 'click',
            spinsLeft: [0, 0],
        });

        expect(result.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    });
});
