import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    championIconUrl,
    championSplashUrl,
    clearChampionCatalogCache,
    loadChampionCatalog,
} from './champion-data.js';

const VERSIONS = ['16.1.1', '16.0.1'];
const CHAMPION_JSON = {
    data: {
        Vex: { id: 'Vex', name: 'Vex', title: 'Mroczna Zaloba', blurb: 'Opis Vex', tags: ['Mage'] },
        MonkeyKing: { id: 'MonkeyKing', name: 'Wukong', title: 'Krol Malp', blurb: 'Opis', tags: ['Fighter'] },
    },
};

function jsonResponse(body: unknown, ok = true): Response {
    return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

function okFetch() {
    return vi.fn(async (url: string | URL | Request) =>
        String(url).endsWith('versions.json') ? jsonResponse(VERSIONS) : jsonResponse(CHAMPION_JSON));
}

beforeEach(() => {
    clearChampionCatalogCache();
});

describe('champion-data', () => {
    it('buduje poprawne URL-e splasha i ikony', () => {
        expect(championSplashUrl('Vex')).toBe('https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Vex_0.jpg');
        expect(championIconUrl('16.1.1', 'Vex')).toBe('https://ddragon.leagueoflegends.com/cdn/16.1.1/img/champion/Vex.png');
    });

    it('parsuje liste postaci z najnowszej wersji', async () => {
        const fetchFn = okFetch();
        const catalog = await loadChampionCatalog(fetchFn as unknown as typeof fetch);

        expect(catalog.version).toBe('16.1.1');
        expect(catalog.champions.map((champion) => champion.id).sort()).toEqual(['MonkeyKing', 'Vex']);
        expect(catalog.champions.find((champion) => champion.id === 'MonkeyKing')?.name).toBe('Wukong');
        expect(String(fetchFn.mock.calls[1]![0])).toContain('/cdn/16.1.1/data/pl_PL/champion.json');
    });

    it('uzywa cache przy kolejnym wywolaniu', async () => {
        const fetchFn = okFetch();
        await loadChampionCatalog(fetchFn as unknown as typeof fetch);
        await loadChampionCatalog(fetchFn as unknown as typeof fetch);

        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('zwraca stary cache gdy odswiezenie sie nie uda', async () => {
        let now = 1_000;
        const first = await loadChampionCatalog(okFetch() as unknown as typeof fetch, () => now);
        now += 48 * 60 * 60 * 1000;
        const failing = vi.fn(async () => { throw new Error('offline'); });

        const second = await loadChampionCatalog(failing as unknown as typeof fetch, () => now);

        expect(second).toEqual(first);
    });

    it('rzuca bledem bez cache gdy ddragon nie dziala', async () => {
        const failing = vi.fn(async () => jsonResponse({}, false));

        await expect(loadChampionCatalog(failing as unknown as typeof fetch)).rejects.toThrow();
    });

    it('odrzuca niepoprawny format odpowiedzi', async () => {
        const fetchFn = vi.fn(async (url: string | URL | Request) =>
            String(url).endsWith('versions.json') ? jsonResponse(VERSIONS) : jsonResponse({ data: {} }));

        await expect(loadChampionCatalog(fetchFn as unknown as typeof fetch)).rejects.toThrow();
    });
});
