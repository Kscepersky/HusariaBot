import { describe, expect, it } from 'vitest';
import {
    buildDashboardAllowedMentions,
    buildDashboardPingPayload,
    buildDashboardMessagePayload,
    buildEmbedJson,
    validateEmbedForm,
    type EmbedFormData,
} from './embed-handlers.js';

describe('validateEmbedForm', () => {
    it('odrzuca nieprawidlowy tryb publikacji', () => {
        const data = {
            mode: 'unknown',
            channelId: '123456789012345678',
            content: 'Tresc',
        } as unknown as EmbedFormData;

        expect(validateEmbedForm(data)).toBe('Nieprawidłowy tryb wiadomości.');
    });

    it('wymaga tresci wiadomosci', () => {
        const data: EmbedFormData = {
            mode: 'message',
            channelId: '123456789012345678',
            content: '   ',
        };

        expect(validateEmbedForm(data)).toBe('Treść wiadomości jest wymagana.');
    });

    it('wymaga wyboru roli gdy ping jest wlaczony', () => {
        const data: EmbedFormData = {
            mode: 'embedded',
            channelId: '123456789012345678',
            title: 'Tytul',
            content: 'Tresc',
            mentionRoleEnabled: true,
            mentionRoleId: '',
        };

        expect(validateEmbedForm(data)).toBe('Wybierz rolę do pingowania.');
    });
    it('wymaga grafiki z biblioteki przy imageMode=library', () => {
        const data: EmbedFormData = {
            mode: 'embedded',
            channelId: '123456789012345678',
            title: 'Tytul',
            content: 'Tresc',
            imageMode: 'library',
            imageFilename: '',
        };

        expect(validateEmbedForm(data)).toBe('Wybierz grafikę z biblioteki.');
    });

    it('wymaga danych uploadu przy imageMode=upload', () => {
        const data: EmbedFormData = {
            mode: 'message',
            channelId: '123456789012345678',
            content: 'Tresc',
            imageMode: 'upload',
            uploadFileName: 'grafika.png',
            uploadMimeType: '',
            uploadBase64: '',
        };

        expect(validateEmbedForm(data)).toBe('Wgraj plik graficzny.');
    });

    it('bezpiecznie odrzuca nieprawidlowe typy pol bez rzucania wyjatku', () => {
        const data = {
            mode: 'message',
            channelId: '123456789012345678',
            content: {},
            imageMode: 'upload',
            uploadFileName: 'a.png',
            uploadMimeType: 'image/png',
            uploadBase64: {},
        } as unknown as EmbedFormData;

        expect(validateEmbedForm(data)).toBe('Treść wiadomości jest wymagana.');
    });

    it('wymaga poprawnych pol wydarzenia Discord gdy opcja eventu jest wlaczona', () => {
        const data: EmbedFormData = {
            mode: 'embedded',
            channelId: '123456789012345678',
            title: 'Tytul',
            content: 'Tresc',
            eventDraft: {
                enabled: true,
                title: 'Mecz tygodnia',
                description: 'Opis',
                location: 'Online',
                startAtLocal: '2026-04-05T20:00',
                endAtLocal: '2026-04-05T19:59',
            },
        };

        expect(validateEmbedForm(data)).toBe('Data zakończenia wydarzenia musi być późniejsza od startu.');
    });
});

describe('buildDashboardMessagePayload', () => {
    it('zwraca pusty payload dla trybu embedded', () => {
        const data: EmbedFormData = {
            mode: 'embedded',
            channelId: '123456789012345678',
            title: 'Tytul',
            content: 'Tresc',
        };

        expect(buildDashboardMessagePayload(data, {
            publishedBy: 'Admin',
            publishedByUserId: '123456789012345678',
        })).toEqual({});
    });

    it('zwraca payload dla zwyklej wiadomosci wraz z rola z tresci', () => {
        const data: EmbedFormData = {
            mode: 'message',
            channelId: '123456789012345678',
            content: 'Witajcie <@&123456789012345678>',
        };

        expect(buildDashboardMessagePayload(data, {
            publishedBy: 'Admin',
            publishedByUserId: '123456789012345680',
        })).toEqual({
            content: 'Witajcie <@&123456789012345678>\n\n*Opublikował*: <@123456789012345680>',
            allowed_mentions: {
                parse: [],
                roles: ['123456789012345678'],
                users: ['123456789012345680'],
            },
        });
    });

    it('dodaje users i parse everyone dla mentionow user/everyone', () => {
        const data: EmbedFormData = {
            mode: 'message',
            channelId: '123456789012345678',
            content: 'Hej <@123456789012345679> @everyone',
        };

        expect(buildDashboardMessagePayload(data, {
            publishedBy: 'Admin',
            publishedByUserId: '123456789012345680',
        })).toEqual({
            content: 'Hej <@123456789012345679> @everyone\n\n*Opublikował*: <@123456789012345680>',
            allowed_mentions: {
                parse: ['everyone'],
                users: ['123456789012345679', '123456789012345680'],
            },
        });
    });

    it('dopina linie edycji dla recznie edytowanej wiadomosci', () => {
        const data: EmbedFormData = {
            mode: 'message',
            channelId: '123456789012345678',
            content: 'Aktualizacja posta',
        };

        const payload = buildDashboardMessagePayload(data, {
            publishedBy: 'Admin',
            publishedByUserId: '123456789012345680',
            editedAtTimestamp: Date.now(),
        });

        expect(payload.content).toContain('*Edytowano*:');
    });
});

describe('buildDashboardAllowedMentions', () => {
    it('obsluguje role, usera i @here', () => {
        expect(buildDashboardAllowedMentions('A <@&123456789012345678> <@!123456789012345679> @here')).toEqual({
            parse: ['everyone'],
            roles: ['123456789012345678'],
            users: ['123456789012345679'],
        });
    });
});

describe('buildDashboardPingPayload', () => {
    it('zwraca ping payload dla wybranej roli', () => {
        const data: EmbedFormData = {
            mode: 'message',
            channelId: '123456789012345678',
            content: 'Tresc',
            mentionRoleEnabled: true,
            mentionRoleId: '123456789012345678',
        };

        expect(buildDashboardPingPayload(data)).toEqual({
            content: '<@&123456789012345678>',
            allowed_mentions: {
                parse: [],
                roles: ['123456789012345678'],
            },
        });
    });

    it('zwraca ping payload dla @everyone', () => {
        const data: EmbedFormData = {
            mode: 'message',
            channelId: '123456789012345678',
            content: 'Tresc',
            mentionRoleEnabled: true,
            mentionRoleId: 'everyone',
        };

        expect(buildDashboardPingPayload(data)).toEqual({
            content: '@everyone',
            allowed_mentions: {
                parse: ['everyone'],
            },
        });
    });
});

describe('buildEmbedJson', () => {
    it('dodaje stopke z autorem publikacji bez dodatkowego pola', () => {
        const json = buildEmbedJson(
            {
                mode: 'embedded',
                channelId: '123456789012345678',
                title: 'Wazne',
                content: 'Info',
            },
            { publishedBy: 'Admin', publishedByUserId: '123456789012345678' },
        ) as { footer?: { text?: string }; timestamp?: string; fields?: Array<{ name?: string; value?: string }> };

        expect(json.footer?.text).toBe('Opublikował: Admin');
        expect(json.fields).toBeUndefined();
        expect(json.timestamp).toBeDefined();
    });

    it('zastepuje stopke informacja o edycji po recznej zmianie', () => {
        const json = buildEmbedJson(
            {
                mode: 'embedded',
                channelId: '123456789012345678',
                title: 'Wazne',
                content: 'Info',
            },
            {
                publishedBy: 'Admin',
                publishedByUserId: '123456789012345678',
                editedAtTimestamp: Date.now(),
            },
        ) as { footer?: { text?: string } };

        expect(json.footer?.text?.startsWith('Edytowano ')).toBe(true);
    });
});
