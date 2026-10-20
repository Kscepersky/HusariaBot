import { createHash } from 'node:crypto';
import type { ChampionInfo } from './champion-data.js';

export interface SpecialChampionUser {
    championId: string;
    caption: string;
}

/** Uzytkownicy z przypisana na sztywno postacia (klucz: ID Discorda). */
export const SPECIAL_USERS: Readonly<Record<string, SpecialChampionUser>> = {
    '682670238223040673': {
        championId: 'Vex',
        caption: 'Ty to wiesz, ja to wiem, wszyscy to wiedzą',
    },
    '553684841808527360': {
        championId: 'Volibear',
        caption: 'stable',
    },
};

export interface ChampionPick {
    champion: ChampionInfo;
    /** Podpis tylko dla uzytkownikow ze SPECIAL_USERS; dla reszty pusty. */
    caption: string;
    special: boolean;
}

/** Zmiana wartosci losuje wszystkim uzytkownikom nowe postacie (nadal deterministycznie). */
const PICK_SEED = 'v2';

function hashToInt(input: string): number {
    return createHash('sha256').update(`${PICK_SEED}:${input}`).digest().readUInt32BE(0);
}

/** Deterministycznie dobiera postac do uzytkownika; lista jest sortowana po ID, wiec kolejnosc wejscia nie ma znaczenia. */
export function pickChampion(userId: string, champions: readonly ChampionInfo[]): ChampionPick {
    if (champions.length === 0) {
        throw new Error('Champion list is empty.');
    }

    const sorted = [...champions].sort((a, b) => a.id.localeCompare(b.id));
    const special = SPECIAL_USERS[userId];

    if (special) {
        const forced = sorted.find((champion) => champion.id === special.championId);
        const champion = forced ?? sorted[hashToInt(userId) % sorted.length]!;
        return { champion, caption: special.caption, special: true };
    }

    const champion = sorted[hashToInt(userId) % sorted.length]!;
    return { champion, caption: '', special: false };
}
