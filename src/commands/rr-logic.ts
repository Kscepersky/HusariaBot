export const RR_CHAMBERS = 6;
export const RR_SPINS_PER_PLAYER = 1;

export type RandomBelow = (maxExclusive: number) => number;

export interface Revolver {
    /** Ktory z kolei strzal od ostatniego zakrecenia trafia w kule (0-5). */
    bulletAt: number;
    /** Ile razy pociagnieto spust od ostatniego zakrecenia. */
    pulls: number;
    /** Obrot bebna - tylko do rysowania karty. */
    rotation: number;
}

/** Laduje jedna kule i zakreca beben: kula trafia w losowe z 6 kolejnych pociagniec. */
export function loadRevolver(random: RandomBelow): Revolver {
    return { bulletAt: random(RR_CHAMBERS), pulls: 0, rotation: random(RR_CHAMBERS) };
}

export function pullTrigger(revolver: Revolver): { revolver: Revolver; hit: boolean } {
    return {
        revolver: { ...revolver, pulls: revolver.pulls + 1 },
        hit: revolver.pulls === revolver.bulletAt,
    };
}
