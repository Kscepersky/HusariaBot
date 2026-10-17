/**
 * Minimalny runtime i18n dashboardu.
 *
 * Ladowany jako klasyczny skrypt PRZED app.js, wystawia globalne `t()` oraz
 * obiekt `window.I18n`. Katalogi (pl.js / en.js) musza byc zaladowane wczesniej.
 */
(function initI18n(global) {
    'use strict';

    var STORAGE_KEY = 'husaria-dashboard-language';
    var FALLBACK_LANGUAGE = 'pl';
    var SUPPORTED = ['pl', 'en'];

    var catalogs = global.DASHBOARD_I18N || {};
    var currentLanguage = FALLBACK_LANGUAGE;
    var changeListeners = [];

    function isSupported(language) {
        return SUPPORTED.indexOf(language) !== -1;
    }

    function readStoredLanguage() {
        try {
            var stored = global.localStorage.getItem(STORAGE_KEY);
            return isSupported(stored) ? stored : null;
        } catch (error) {
            // Prywatny tryb przegladarki blokuje localStorage - nie jest to blad krytyczny.
            return null;
        }
    }

    function writeStoredLanguage(language) {
        try {
            global.localStorage.setItem(STORAGE_KEY, language);
        } catch (error) {
            /* brak trwalego cache - preferencja i tak leci do sesji na serwerze */
        }
    }

    /**
     * Tlumaczy klucz. Brakujacy klucz zwraca sam klucz - widac go od razu w UI,
     * a strona nie wywala sie na undefined.
     */
    function translate(key, params) {
        var catalog = catalogs[currentLanguage] || {};
        var value = catalog[key];

        if (typeof value !== 'string') {
            var fallbackCatalog = catalogs[FALLBACK_LANGUAGE] || {};
            value = typeof fallbackCatalog[key] === 'string' ? fallbackCatalog[key] : null;

            if (value === null) {
                if (global.console && typeof global.console.warn === 'function') {
                    global.console.warn('[i18n] Brak tlumaczenia dla klucza:', key);
                }
                return key;
            }
        }

        if (!params) {
            return value;
        }

        return value.replace(/\{(\w+)\}/g, function replaceParam(match, name) {
            return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match;
        });
    }

    /**
     * Podmienia teksty w poddrzewie DOM. Wolane po kazdym renderze fragmentu,
     * ktory zawiera statyczne znaczniki data-i18n.
     */
    function applyTranslations(root) {
        var scope = root || global.document;
        if (!scope || typeof scope.querySelectorAll !== 'function') {
            return;
        }

        var textNodes = scope.querySelectorAll('[data-i18n]');
        for (var i = 0; i < textNodes.length; i += 1) {
            // textContent, nie innerHTML - tlumaczenie nigdy nie tworzy znacznikow.
            textNodes[i].textContent = translate(textNodes[i].getAttribute('data-i18n'));
        }

        var attributeMap = [
            ['data-i18n-placeholder', 'placeholder'],
            ['data-i18n-title', 'title'],
            ['data-i18n-aria-label', 'aria-label'],
        ];

        for (var a = 0; a < attributeMap.length; a += 1) {
            var dataAttribute = attributeMap[a][0];
            var targetAttribute = attributeMap[a][1];
            var elements = scope.querySelectorAll('[' + dataAttribute + ']');

            for (var e = 0; e < elements.length; e += 1) {
                elements[e].setAttribute(targetAttribute, translate(elements[e].getAttribute(dataAttribute)));
            }
        }

        if (global.document && global.document.documentElement) {
            global.document.documentElement.setAttribute('lang', currentLanguage);
        }
    }

    function getLanguage() {
        return currentLanguage;
    }

    function setLanguage(language, options) {
        var settings = options || {};
        var next = isSupported(language) ? language : FALLBACK_LANGUAGE;
        var changed = next !== currentLanguage;

        currentLanguage = next;

        if (settings.persist !== false) {
            writeStoredLanguage(next);
        }

        applyTranslations(global.document);

        if (changed) {
            for (var i = 0; i < changeListeners.length; i += 1) {
                try {
                    changeListeners[i](next);
                } catch (error) {
                    if (global.console && typeof global.console.error === 'function') {
                        global.console.error('[i18n] Listener zmiany jezyka rzucil blad:', error);
                    }
                }
            }
        }

        return next;
    }

    function onLanguageChange(listener) {
        if (typeof listener === 'function') {
            changeListeners.push(listener);
        }
    }

    global.I18n = {
        t: translate,
        applyTranslations: applyTranslations,
        getLanguage: getLanguage,
        setLanguage: setLanguage,
        onLanguageChange: onLanguageChange,
        readStoredLanguage: readStoredLanguage,
        isSupported: isSupported,
        SUPPORTED: SUPPORTED,
        STORAGE_KEY: STORAGE_KEY,
    };

    global.t = translate;

    // Cache z localStorage stosujemy natychmiast, zeby uniknac mignieca
    // domyslnym jezykiem zanim odpowie /api/me/access.
    var stored = readStoredLanguage();
    if (stored) {
        currentLanguage = stored;

        if (global.document) {
            if (global.document.readyState === 'loading') {
                global.document.addEventListener('DOMContentLoaded', function applyOnReady() {
                    applyTranslations(global.document);
                });
            } else {
                applyTranslations(global.document);
            }
        }
    }
}(window));
