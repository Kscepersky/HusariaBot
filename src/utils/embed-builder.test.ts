import { describe, it, expect } from 'vitest';
import { buildHusariaEmbed, parseEmbedOptions, buildGiveawayEmbed, EmbedOptions } from './embed-builder.js';
import { HusariaColors } from './husaria-theme.js';

describe('parseEmbedOptions', () => {
    it('powinien sparsować tytuł i opis', () => {
        const result = parseEmbedOptions({ title: 'Mecz G2', description: 'Jutro o 18:00' });

        expect(result.title).toBe('Mecz G2');
        expect(result.description).toBe('Jutro o 18:00');
    });

    it('powinien ustawić domyślny kolor na RED', () => {
        const result = parseEmbedOptions({ title: 'Test', description: 'Opis' });

        expect(result.color).toBe(HusariaColors.RED);
    });

    it('powinien rozpoznać nazwę koloru "biały"', () => {
        const result = parseEmbedOptions({ title: 'Test', description: 'Opis', colorName: 'biały' });

        expect(result.color).toBe(HusariaColors.WHITE);
    });

    it('powinien rozpoznać nazwę koloru "złoty"', () => {
        const result = parseEmbedOptions({ title: 'Test', description: 'Opis', colorName: 'złoty' });

        expect(result.color).toBe(HusariaColors.GOLD);
    });

    it('powinien fallbackować na RED przy nieznanym kolorze', () => {
        const result = parseEmbedOptions({ title: 'Test', description: 'Opis', colorName: 'fioletowy' });

        expect(result.color).toBe(HusariaColors.RED);
    });

    it('powinien przyciąć whitespace z tytułu i opisu', () => {
        const result = parseEmbedOptions({ title: '  Mecz G2  ', description: '  jutro!  ' });

        expect(result.title).toBe('Mecz G2');
        expect(result.description).toBe('jutro!');
    });
});

describe('buildHusariaEmbed', () => {
    it('powinien ustawić tytuł na embedzie', () => {
        const options: EmbedOptions = {
            title: '📢 Mecz G2 vs T1',
            description: 'Jutro o 18:00 CET!',
            color: HusariaColors.RED,
        };

        const embed = buildHusariaEmbed(options);
        const json = embed.toJSON();

        expect(json.description).toContain('# **📢 Mecz G2 vs T1**');
    });

    it('powinien ustawić opis z wieloma liniami', () => {
        const multiLine = '🔥 Linia pierwsza\n⚡ Linia druga\n🏆 Linia trzecia';
        const options: EmbedOptions = {
            title: 'Ogłoszenie',
            description: multiLine,
            color: HusariaColors.RED,
        };

        const embed = buildHusariaEmbed(options);
        const json = embed.toJSON();

        expect(json.description).toContain(multiLine);
        expect(json.description).toContain('\n');
        expect(json.description).toMatch(/^# \*\*Ogłoszenie\*\*/);
    });

    it('powinien obsługiwać emotki w treści', () => {
        const options: EmbedOptions = {
            title: '🏆 Wyniki',
            description: '🥇 G2 — 1. miejsce\n🥈 T1 — 2. miejsce',
            color: HusariaColors.GOLD,
        };

        const embed = buildHusariaEmbed(options);
        const json = embed.toJSON();

        expect(json.description).toContain('🏆');
        expect(json.description).toContain('🥇');
        expect(json.description).toContain('🥈');
    });

    it('powinien ustawić prawidłowy kolor', () => {
        const options: EmbedOptions = {
            title: 'Test',
            description: 'Opis',
            color: HusariaColors.GOLD,
        };

        const embed = buildHusariaEmbed(options);
        const json = embed.toJSON();

        expect(json.color).toBe(HusariaColors.GOLD);
    });

    it('powinien mieć footer "G2 Hussars"', () => {
        const options: EmbedOptions = {
            title: 'Test',
            description: 'Opis',
            color: HusariaColors.RED,
        };

        const embed = buildHusariaEmbed(options);
        const json = embed.toJSON();

        expect(json.footer?.text).toBe('G2 Hussars');
    });

    it('powinien mieć ustawiony timestamp', () => {
        const options: EmbedOptions = {
            title: 'Test',
            description: 'Opis',
            color: HusariaColors.RED,
        };

        const embed = buildHusariaEmbed(options);
        const json = embed.toJSON();

        expect(json.timestamp).toBeDefined();
    });
});

describe('buildGiveawayEmbed', () => {
    it('powinien zawierać nagrodę w opisie', () => {
        const embed = buildGiveawayEmbed({ prize: 'Skin Prestiżowy', requirements: 'Obserwuj serwer', endsAt: 1743861600 });
        const json  = embed.toJSON();

        expect(json.description).toContain('Skin Prestiżowy');
    });

    it('powinien mieć pole Wymagania', () => {
        const embed = buildGiveawayEmbed({ prize: 'Nagroda', requirements: 'Zostaw reakcję 🎁', endsAt: 1743861600 });
        const json  = embed.toJSON();

        expect(json.fields?.some(f => f.name === '📋 Wymagania')).toBe(true);
    });

    it('powinien mieć pole Koniec z Discord timestamp', () => {
        const embed = buildGiveawayEmbed({ prize: 'Nagroda', requirements: 'Wymagania', endsAt: 1743861600 });
        const json  = embed.toJSON();

        const field = json.fields?.find(f => f.name === '⏰ Koniec');
        expect(field?.value).toContain('<t:1743861600:F>');
        expect(field?.value).toContain('<t:1743861600:R>');
    });

    it('powinien mieć kolor GOLD i footer G2 Hussars', () => {
        const embed = buildGiveawayEmbed({ prize: 'Nagroda', requirements: 'Wymagania', endsAt: 1743861600 });
        const json  = embed.toJSON();

        expect(json.color).toBe(HusariaColors.GOLD);
        expect(json.footer?.text).toBe('G2 Hussars');
    });
});
