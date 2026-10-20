import { describe, expect, it } from 'vitest';
import { pickChampion, SPECIAL_USERS } from './champion-pick.js';
import type { ChampionInfo } from './champion-data.js';

const VEX_USER_ID = '682670238223040673';

function champ(id: string, tags: string[] = ['Mage']): ChampionInfo {
    return { id, name: id, title: `Tytul ${id}`, blurb: `Opis ${id}`, tags };
}

const CHAMPIONS: ChampionInfo[] = [
    champ('Ahri'), champ('Garen', ['Fighter', 'Tank']), champ('Jinx', ['Marksman']),
    champ('Vex'), champ('Zed', ['Assassin']), champ('Lux', ['Mage', 'Support']),
];

describe('pickChampion', () => {
    it('zwraca ta sama postac dla tego samego uzytkownika', () => {
        const first = pickChampion('123456789', CHAMPIONS);
        const second = pickChampion('123456789', [...CHAMPIONS].reverse());

        expect(second.champion.id).toBe(first.champion.id);
        expect(second.caption).toBe(first.caption);
        expect(first.special).toBe(false);
    });

    it('zawsze daje Vex z podpisem specjalnym dla wskazanego uzytkownika', () => {
        const result = pickChampion(VEX_USER_ID, CHAMPIONS);

        expect(result.champion.id).toBe('Vex');
        expect(result.caption).toBe('Ty to wiesz, ja to wiem, wszyscy to wiedzą');
        expect(result.special).toBe(true);
        expect(SPECIAL_USERS[VEX_USER_ID]?.championId).toBe('Vex');
    });

    it('wybiera rozne postacie dla roznych uzytkownikow', () => {
        const picked = new Set<string>();
        for (let index = 0; index < 200; index += 1) {
            picked.add(pickChampion(`${1000 + index}`, CHAMPIONS).champion.id);
        }

        expect(picked.size).toBeGreaterThan(3);
    });

    it('dobiera podpis do tagow postaci i nie jest pusty', () => {
        const result = pickChampion('42', [champ('Garen', ['Fighter'])]);

        expect(result.caption.length).toBeGreaterThan(0);
    });

    it('rzuca bledem dla pustej listy', () => {
        expect(() => pickChampion('1', [])).toThrow();
    });

    it('wraca do hasha, gdy specjalnej postaci nie ma na liscie', () => {
        const result = pickChampion(VEX_USER_ID, [champ('Ahri')]);

        expect(result.champion.id).toBe('Ahri');
        expect(result.caption).toBe('Ty to wiesz, ja to wiem, wszyscy to wiedzą');
    });
});
