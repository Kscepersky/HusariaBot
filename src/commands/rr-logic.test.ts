import { describe, expect, it } from 'vitest';
import { RR_CHAMBERS, loadRevolver, pullTrigger } from './rr-logic.js';

describe('loadRevolver', () => {
    it('losuje pozycje kuli i obrot bebna z zakresu komor', () => {
        const calls: number[] = [];
        const revolver = loadRevolver((max) => {
            calls.push(max);
            return calls.length === 1 ? 4 : 2;
        });

        expect(calls).toEqual([RR_CHAMBERS, RR_CHAMBERS]);
        expect(revolver).toEqual({ bulletAt: 4, pulls: 0, rotation: 2 });
    });
});

describe('pullTrigger', () => {
    it('trafia dokladnie w pociagniecie bulletAt i nie mutuje bebna', () => {
        const start = { bulletAt: 2, pulls: 0, rotation: 0 };
        const first = pullTrigger(start);
        const second = pullTrigger(first.revolver);
        const third = pullTrigger(second.revolver);

        expect([first.hit, second.hit, third.hit]).toEqual([false, false, true]);
        expect(start.pulls).toBe(0);
        expect(third.revolver.pulls).toBe(3);
    });

    it('kazda pozycja kuli konczy sie trafieniem najpozniej w 6. strzale', () => {
        for (let bulletAt = 0; bulletAt < RR_CHAMBERS; bulletAt += 1) {
            let revolver = { bulletAt, pulls: 0, rotation: 0 };
            let shots = 0;
            let hit = false;
            while (!hit) {
                ({ revolver, hit } = pullTrigger(revolver));
                shots += 1;
            }
            expect(shots).toBe(bulletAt + 1);
        }
    });
});
