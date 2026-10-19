export type KulaVerdict = 'yes' | 'no';

export interface KulaAnswer {
    verdict: KulaVerdict;
    text: string;
}

export const YES_ANSWERS: readonly string[] = [
    'Tak.',
    'Zdecydowanie tak!',
    'Bez dwoch zdan - tak.',
    'Gwiazdy mowia: tak.',
    'Wszystkie znaki wskazuja na tak.',
    'Pewnie, ze tak!',
    'Tak, ale nie mow nikomu, ze to ode mnie.',
    'Husaria przytakuje.',
];

export const NO_ANSWERS: readonly string[] = [
    'Nie.',
    'Zdecydowanie nie!',
    'Nawet o tym nie mysl - nie.',
    'Gwiazdy mowia: nie.',
    'Wszystkie znaki wskazuja na nie.',
    'Szanse bliskie zeru. Czyli nie.',
    'Nie, i to nie podlega negocjacjom.',
    'Husaria kreci glowa.',
];

/** Komunikaty z "czytania w myslach" - kazdy wariant dziala jako pojedyncza klatka animacji. */
export const ANIMATION_MESSAGES: readonly string[] = [
    'Kula sie rozgrzewa...',
    'Czytam Ci w myslach... ciemno tu...',
    'Pytam duchy husarii o zdanie...',
    'Przeciagam sie i pocieram kule...',
    'Dzwonie po rade do wujka dobra rada...',
    'Odganiam muche z kuli... zaraz wracam...',
    'Mgla sie rozchodzi... chyba cos widze...',
    'Sprawdzam, co na to cebulowa wrozka...',
    'Laduje ukryta wiedze: 69%...',
    'Skanuje Twoja dusze... ojej, ile tam tabów...',
];

/** Losuje Tak/Nie 50/50; `random` pozwala wstrzyknac generator w testach. */
export function rollKulaAnswer(random: () => number = Math.random): KulaAnswer {
    const verdict: KulaVerdict = random() < 0.5 ? 'yes' : 'no';
    const pool = verdict === 'yes' ? YES_ANSWERS : NO_ANSWERS;
    const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));

    return { verdict, text: pool[index]! };
}

/** Zwraca `count` roznych komunikatow animacji w losowej kolejnosci. */
export function pickAnimationMessages(count: number, random: () => number = Math.random): string[] {
    const shuffled = [...ANIMATION_MESSAGES];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
    }

    return shuffled.slice(0, Math.max(0, count));
}
