import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PUBLIC_JS = join(process.cwd(), 'src/dashboard/public/js');
const VIEWS = join(process.cwd(), 'src/dashboard/views');

/**
 * Katalogi i runtime i18n sa klasycznymi skryptami przegladarkowymi, wiec
 * wykonujemy je w izolowanym sandboxie z atrapa `window`.
 */
function loadBrowserGlobals(): Record<string, unknown> {
    const sandbox: Record<string, unknown> = {
        console: { warn: () => {}, error: () => {} },
        localStorage: {
            getItem: () => null,
            setItem: () => {},
        },
        document: null,
    };

    for (const file of ['i18n/pl.js', 'i18n/en.js', 'i18n/runtime.js']) {
        const source = readFileSync(join(PUBLIC_JS, file), 'utf8');
        new Function('window', source)(sandbox);
    }

    return sandbox;
}

interface I18nApi {
    t: (key: string, params?: Record<string, unknown>) => string;
    setLanguage: (language: string, options?: { persist?: boolean }) => string;
    getLanguage: () => string;
    isSupported: (language: unknown) => boolean;
}

function loadI18n(): { catalogs: Record<string, Record<string, string>>; api: I18nApi } {
    const sandbox = loadBrowserGlobals();
    return {
        catalogs: sandbox.DASHBOARD_I18N as Record<string, Record<string, string>>,
        api: sandbox.I18n as unknown as I18nApi,
    };
}

describe('katalogi tlumaczen', () => {
    const { catalogs } = loadI18n();

    it('definiuje oba jezyki', () => {
        expect(Object.keys(catalogs).sort()).toEqual(['en', 'pl']);
    });

    it('katalogi pl i en maja identyczny zbior kluczy', () => {
        const plKeys = Object.keys(catalogs.pl).sort();
        const enKeys = Object.keys(catalogs.en).sort();

        expect(enKeys.filter((key) => !plKeys.includes(key))).toEqual([]);
        expect(plKeys.filter((key) => !enKeys.includes(key))).toEqual([]);
    });

    it('zadne tlumaczenie nie jest puste', () => {
        for (const [language, catalog] of Object.entries(catalogs)) {
            for (const [key, value] of Object.entries(catalog)) {
                expect(value.trim(), `${language}.${key} jest puste`).not.toBe('');
            }
        }
    });

    it('tlumaczenia nie zawieraja znacznikow HTML (trafiaja do textContent)', () => {
        for (const [language, catalog] of Object.entries(catalogs)) {
            for (const [key, value] of Object.entries(catalog)) {
                expect(value, `${language}.${key} zawiera HTML`).not.toMatch(/<[a-zA-Z/]/);
            }
        }
    });

    it('kazdy klucz uzyty w widokach istnieje w katalogu polskim', () => {
        const usedKeys = new Set<string>();

        for (const view of ['dashboard.html', 'login.html']) {
            const html = readFileSync(join(VIEWS, view), 'utf8');
            for (const match of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
                usedKeys.add(match[1]);
            }
        }

        expect(usedKeys.size).toBeGreaterThan(300);

        const missing = [...usedKeys].filter((key) => !(key in catalogs.pl));
        expect(missing).toEqual([]);
    });
});

describe('runtime i18n', () => {
    it('tlumaczy klucz w wybranym jezyku', () => {
        const { api } = loadI18n();

        api.setLanguage('en', { persist: false });
        expect(api.t('dashboard.kreator_publikacji')).toBe('Post creator');

        api.setLanguage('pl', { persist: false });
        expect(api.t('dashboard.kreator_publikacji')).toBe('Kreator publikacji');
    });

    it('interpoluje parametry', () => {
        const { api, catalogs } = loadI18n();
        catalogs.pl['test.count'] = 'Zalogowani: {count}';

        api.setLanguage('pl', { persist: false });
        expect(api.t('test.count', { count: 7 })).toBe('Zalogowani: 7');
    });

    it('zostawia nieznany placeholder nietkniety', () => {
        const { api, catalogs } = loadI18n();
        catalogs.pl['test.partial'] = 'A {known} B {unknown}';

        api.setLanguage('pl', { persist: false });
        expect(api.t('test.partial', { known: 'x' })).toBe('A x B {unknown}');
    });

    it('zwraca klucz gdy brak tlumaczenia', () => {
        const { api } = loadI18n();
        expect(api.t('nie.ma.takiego.klucza')).toBe('nie.ma.takiego.klucza');
    });

    it('spada na polski gdy brakuje tlumaczenia angielskiego', () => {
        const { api, catalogs } = loadI18n();
        catalogs.pl['test.only_pl'] = 'Tylko po polsku';

        api.setLanguage('en', { persist: false });
        expect(api.t('test.only_pl')).toBe('Tylko po polsku');
    });

    it('odrzuca nieobslugiwany jezyk i wraca do polskiego', () => {
        const { api } = loadI18n();

        expect(api.isSupported('de')).toBe(false);
        api.setLanguage('de', { persist: false });
        expect(api.getLanguage()).toBe('pl');
    });
});

describe('pokrycie tlumaczen w app.js', () => {
    const APP_JS = join(PUBLIC_JS, 'app.js');

    /** Linie kodu z polskimi znakami poza komentarzami i kluczami i18n. */
    function findUntranslatedLines(): string[] {
        const source = readFileSync(APP_JS, 'utf8').split('\n');
        const diacritics = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
        const offenders: string[] = [];

        source.forEach((line, index) => {
            const trimmed = line.trim();
            if (!diacritics.test(line)) return;
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

            // Polskie znaki dozwolone sa tylko w argumentach toLocaleString('pl-PL')
            // oraz w kluczach kolorow mapowanych na atrybuty data-color w HTML.
            const withoutAllowed = line
                .replace(/'pl-PL'/g, '')
                .replace(/^\s*(biały|złoty|czerwony|szary):/g, '');

            if (diacritics.test(withoutAllowed)) {
                offenders.push(`${index + 1}: ${trimmed.slice(0, 100)}`);
            }
        });

        return offenders;
    }

    it('nie zostawia polskich literalow widocznych dla uzytkownika', () => {
        expect(findUntranslatedLines()).toEqual([]);
    });

    it('tlumaczenia wstawiane w atrybuty HTML nie zawieraja cudzyslowu', () => {
        const { catalogs } = loadI18n();
        const source = readFileSync(APP_JS, 'utf8');

        // Wzorzec: atrybut="${t('klucz')}" - wartosc trafia do innerHTML,
        // wiec cudzyslow pozwolilby wyjsc poza atrybut.
        const attributeKeys = [...source.matchAll(/="\$\{t\('([^']+)'\)\}"/g)].map((match) => match[1]);

        expect(attributeKeys.length).toBeGreaterThan(0);

        for (const key of attributeKeys) {
            for (const language of ['pl', 'en'] as const) {
                expect(catalogs[language][key], `${language}.${key}`).not.toMatch(/["<>]/);
            }
        }
    });

    it('kazdy klucz uzyty przez t() istnieje w obu katalogach', () => {
        const { catalogs } = loadI18n();
        const source = readFileSync(APP_JS, 'utf8');
        const usedKeys = [...source.matchAll(/\bt\('([^']+)'/g)].map((match) => match[1]);

        expect(usedKeys.length).toBeGreaterThan(200);

        expect(usedKeys.filter((key) => !(key in catalogs.pl))).toEqual([]);
        expect(usedKeys.filter((key) => !(key in catalogs.en))).toEqual([]);
    });
});
