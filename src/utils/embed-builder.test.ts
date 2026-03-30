import { describe, it, expect } from 'vitest';
import {
    buildHusariaEmbed,
    parseEmbedOptions,
    buildGiveawayEmbed,
    buildWelcomeEmbed,
    buildMatchEmbed,
    buildResultEmbed,
    buildRulebookEmbed,
    EmbedOptions,
} from './embed-builder.js';
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

    it('nie powinien mieć stopki', () => {
        const options: EmbedOptions = {
            title: 'Test',
            description: 'Opis',
            color: HusariaColors.RED,
        };

        const embed = buildHusariaEmbed(options);
        const json = embed.toJSON();

        expect(json.footer).toBeUndefined();
    });

    it('nie powinien mieć timestamp', () => {
        const options: EmbedOptions = {
            title: 'Test',
            description: 'Opis',
            color: HusariaColors.RED,
        };

        const embed = buildHusariaEmbed(options);
        const json = embed.toJSON();

        expect(json.timestamp).toBeUndefined();
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

    it('powinien mieć kolor GOLD i brak stopki', () => {
        const embed = buildGiveawayEmbed({ prize: 'Nagroda', requirements: 'Wymagania', endsAt: 1743861600 });
        const json  = embed.toJSON();

        expect(json.color).toBe(HusariaColors.GOLD);
        expect(json.footer).toBeUndefined();
        expect(json.timestamp).toBeUndefined();
    });
});

describe('buildMatchEmbed', () => {
    it('nie powinien mieć stopki ani timestamp', () => {
        const embed = buildMatchEmbed({
            g2Emoji: '<:g2:123>',
            gameEmoji: '<:lol:321>',
            gameName: 'League of Legends',
            rival: 'T1',
            competition: 'MSI',
            timestamp: 1743861600,
        });
        const json = embed.toJSON();

        expect(json.footer).toBeUndefined();
        expect(json.timestamp).toBeUndefined();
    });
});

describe('buildResultEmbed', () => {
    it('nie powinien mieć stopki ani timestamp', () => {
        const embed = buildResultEmbed({
            gameEmoji: '<:lol:321>',
            gameName: 'League of Legends',
            rival: 'T1',
            score: '2:1',
            competition: 'MSI',
            isWin: true,
        });
        const json = embed.toJSON();

        expect(json.footer).toBeUndefined();
        expect(json.timestamp).toBeUndefined();
    });
});

describe('buildWelcomeEmbed', () => {
    it('powinien zawierać tytuł powitalny z emoji', () => {
        const embed = buildWelcomeEmbed({
            g2Emoji: '<:g2:1234567890>',
            message: 'Wiadmość powitalna',
            memberCount: 321,
        });
        const json = embed.toJSON();

        expect(json.description).toContain('# **<:g2:1234567890> Witaj na Husarii!**');
    });

    it('powinien zawierać treść wiadomości powitalnej', () => {
        const embed = buildWelcomeEmbed({
            g2Emoji: '',
            message: 'Wiadmość powitalna',
            memberCount: 321,
        });
        const json = embed.toJSON();

        expect(json.description).toContain('Wiadmość powitalna');
    });

    it('powinien mieć pole Liczba Husarzy', () => {
        const embed = buildWelcomeEmbed({
            g2Emoji: '',
            message: 'Wiadmość powitalna',
            memberCount: 321,
        });
        const json = embed.toJSON();

        const field = json.fields?.find(f => f.name === 'Liczba Husarzy');
        expect(field?.value).toContain('321');
    });

    it('powinien ustawić tylko banner jako attachment://', () => {
        const embed = buildWelcomeEmbed({
            g2Emoji: '',
            message: 'Wiadmość powitalna',
            memberCount: 321,
        });
        const json = embed.toJSON();

        expect(json.thumbnail).toBeUndefined();
        expect(json.image?.url).toBe('attachment://hussars_banner.png');
    });
});

describe('buildRulebookEmbed', () => {
    it('powinien zawierać tytuł regulaminu z emoji', () => {
        const embed = buildRulebookEmbed({
            rulesEmoji: '📜',
            message: '1. Szanuj innych\n2. No toxicity',
        });
        const json = embed.toJSON();

        expect(json.description).toContain('📜 Regulamin Serwera G2 Hussars');
    });

    it('powinien zawierać treść regulaminu', () => {
        const embed = buildRulebookEmbed({
            rulesEmoji: '📜',
            message: '1. Szanuj innych\n2. No toxicity',
        });
        const json = embed.toJSON();

        expect(json.description).toContain('1. Szanuj innych');
        expect(json.description).toContain('2. No toxicity');
    });

    it('nie powinien mieć żadnych grafik', () => {
        const embed = buildRulebookEmbed({
            rulesEmoji: '📜',
            message: 'Treść',
        });
        const json = embed.toJSON();

        expect(json.thumbnail).toBeUndefined();
        expect(json.image).toBeUndefined();
    });

    it('nie powinien mieć stopki ani timestamp', () => {
        const embed = buildRulebookEmbed({
            rulesEmoji: '📜',
            message: 'Treść',
        });
        const json = embed.toJSON();

        expect(json.footer).toBeUndefined();
        expect(json.timestamp).toBeUndefined();
    });
});
