export interface ShipVerdict {
    min: number;
    max: number;
    emoji: string;
    text: string;
}

/** Przedzialy musza pokrywac 0-100 bez dziur (pilnuje tego test). */
export const SHIP_VERDICTS: readonly ShipVerdict[] = [
    { min: 0, max: 9, emoji: '💀', text: 'Lepiej omijajcie sie szerokim lukiem.' },
    { min: 10, max: 29, emoji: '🧊', text: 'Chemia jak na lekcji w piatek o 7:10.' },
    { min: 30, max: 49, emoji: '😬', text: 'Moze kiedys... jak jedno z Was sie zmieni.' },
    { min: 50, max: 69, emoji: '🙂', text: 'Calkiem calkiem, mozna sprobowac.' },
    { min: 70, max: 89, emoji: '😍', text: 'Zaczynam slyszec dzwony weselne!' },
    { min: 90, max: 99, emoji: '🔥', text: 'Zamawiajcie sale i orkiestre!' },
    { min: 100, max: 100, emoji: '💍', text: 'Przeznaczenie. Nie ma co dyskutowac.' },
];

/** Losuje wynik 0-100 wlacznie; `random` pozwala wstrzyknac generator w testach. */
export function rollShipPercent(random: () => number = Math.random): number {
    return Math.min(100, Math.floor(random() * 101));
}

export function resolveShipVerdict(percent: number): ShipVerdict {
    const clamped = Math.min(100, Math.max(0, Math.round(percent)));
    return SHIP_VERDICTS.find((verdict) => clamped >= verdict.min && clamped <= verdict.max)
        ?? SHIP_VERDICTS[0]!;
}
