import { describe, expect, it } from 'vitest';
import { renderChampionCard } from './champion-card-renderer.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const BASE_INPUT = {
    championName: 'Vex',
    championTitle: 'Mroczna Zaloba',
    blurb: 'Yordle o ponurym usposobieniu, ktory zyje w cieniu.',
    caption: 'Ty to wiesz, ja to wiem, wszyscy to wiedzą',
    username: 'Ala',
};

describe('renderChampionCard', () => {
    it('zwraca poprawny PNG nawet gdy obrazy sie nie zaladuja', async () => {
        const result = await renderChampionCard({
            ...BASE_INPUT,
            splashUrl: 'not-a-valid-url',
            iconUrl: 'also-invalid',
            avatarUrl: 'nope',
        });

        expect(result.byteLength).toBeGreaterThan(1000);
        expect(result.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    });

    it('radzi sobie z bardzo dlugimi tekstami', async () => {
        const result = await renderChampionCard({
            ...BASE_INPUT,
            championName: 'BardzoDlugaNazwaPostaciKtoraNieMiesciSie',
            blurb: 'Lorem ipsum dolor sit amet '.repeat(40),
            caption: 'Podpis '.repeat(40),
            username: 'BardzoDlugiNickKtoryPowinienZostacPrzyciety',
        });

        expect(result.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    });
});
