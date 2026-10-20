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
};

export interface ChampionPick {
    champion: ChampionInfo;
    caption: string;
    special: boolean;
}

const DEFAULT_CAPTIONS: readonly string[] = [
    'Ta postac po prostu do Ciebie pasuje.',
    'Rozdarcie przemawia: to Twoja bratnia dusza.',
];

const TAG_CAPTIONS: Readonly<Record<string, readonly string[]>> = {
    Fighter: ['Ruszasz do walki bez planu B.', 'Najpierw uderzasz, pytania potem.'],
    Tank: ['Przyjmujesz ciosy za cala druzyne.', 'Jestes zywa tarcza i nie masz zamiaru zginac.'],
    Mage: ['Wszystko rozwiazujesz magia i cooldownami.', 'Masz do wszystkiego zaklecie.'],
    Assassin: ['Pojawiasz sie znikad i znikasz zanim ktos zareaguje.', 'Cisza, skok, koniec.'],
    Marksman: ['Celujesz z daleka i nigdy nie pudlujesz (w swoich oczach).', 'Dmg z tylu, ego z przodu.'],
    Support: ['Bez Ciebie ta druzyna by nie dala rady.', 'Ward, heal i dobre slowo.'],
};

function hashToInt(input: string): number {
    return createHash('sha256').update(input).digest().readUInt32BE(0);
}

function captionFor(userId: string, champion: ChampionInfo): string {
    const pools = champion.tags
        .map((tag) => TAG_CAPTIONS[tag])
        .filter((pool): pool is readonly string[] => pool !== undefined);
    const pool = pools.length > 0 ? pools[hashToInt(`${userId}:tag`) % pools.length]! : DEFAULT_CAPTIONS;

    return pool[hashToInt(`${userId}:caption`) % pool.length]!;
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
    return { champion, caption: captionFor(userId, champion), special: false };
}
