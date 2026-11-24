import { afterEach, describe, expect, it } from 'vitest';
import {
    buildVerificationChannelName,
    buildVerificationTopic,
    canResolveVerification,
    DEFAULT_MIN_ACCOUNT_AGE_DAYS,
    describeAccountRisk,
    extractVerificationUserId,
    getAccountAgeDays,
    getMinAccountAgeDays,
    getVerificationRoleId,
    requiresVerification,
} from './logic.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const OWNER = '111111111111111111';
const ADMIN_ROLE = '200000000000000001';
const SUBJECT = '300000000000000001';
const ADMIN = '300000000000000002';

afterEach(() => {
    delete process.env.VERIFICATION_ROLE_ID;
    delete process.env.VERIFICATION_MIN_ACCOUNT_AGE_DAYS;
    delete process.env.ADMIN_ROLE_1_ID;
    delete process.env.OWNER_ID;
});

describe('konfiguracja', () => {
    it('getVerificationRoleId zwraca null dla zlej wartosci', () => {
        expect(getVerificationRoleId()).toBeNull();
        process.env.VERIFICATION_ROLE_ID = 'xyz';
        expect(getVerificationRoleId()).toBeNull();
        process.env.VERIFICATION_ROLE_ID = ADMIN_ROLE;
        expect(getVerificationRoleId()).toBe(ADMIN_ROLE);
    });

    it('getMinAccountAgeDays domyslnie 14, akceptuje liczbe calkowita > 0', () => {
        expect(DEFAULT_MIN_ACCOUNT_AGE_DAYS).toBe(14);
        expect(getMinAccountAgeDays()).toBe(14);
        process.env.VERIFICATION_MIN_ACCOUNT_AGE_DAYS = '30';
        expect(getMinAccountAgeDays()).toBe(30);
        process.env.VERIFICATION_MIN_ACCOUNT_AGE_DAYS = '-1';
        expect(getMinAccountAgeDays()).toBe(14);
        process.env.VERIFICATION_MIN_ACCOUNT_AGE_DAYS = 'abc';
        expect(getMinAccountAgeDays()).toBe(14);
    });
});

describe('wiek konta', () => {
    it('liczy pelne dni', () => {
        expect(getAccountAgeDays(NOW - 3.9 * DAY_MS, NOW)).toBe(3);
        expect(getAccountAgeDays(NOW, NOW)).toBe(0);
    });

    it('konto mlodsze niz 14 dni wymaga weryfikacji', () => {
        expect(requiresVerification(NOW - 13 * DAY_MS, NOW, 14)).toBe(true);
        expect(requiresVerification(NOW - 14 * DAY_MS + 1, NOW, 14)).toBe(true);
    });

    it('konto majace 14 dni lub wiecej nie wymaga weryfikacji', () => {
        expect(requiresVerification(NOW - 14 * DAY_MS, NOW, 14)).toBe(false);
        expect(requiresVerification(NOW - 400 * DAY_MS, NOW, 14)).toBe(false);
    });

    it('opisuje ryzyko konta', () => {
        expect(describeAccountRisk(NOW - 2 * 60 * 60 * 1000, NOW).level).toBe('critical');
        expect(describeAccountRisk(NOW - 3 * DAY_MS, NOW).level).toBe('high');
        expect(describeAccountRisk(NOW - 10 * DAY_MS, NOW).level).toBe('medium');
    });
});

describe('kanal weryfikacji', () => {
    it('buduje nazwe kanalu z oczyszczonej nazwy uzytkownika', () => {
        expect(buildVerificationChannelName('Zły.Ziomek!')).toBe('weryfikacja-zyziomek');
        expect(buildVerificationChannelName('!!!')).toBe('weryfikacja-uzytkownik');
    });

    it('zapisuje i odczytuje ID weryfikowanego z topicu', () => {
        const topic = buildVerificationTopic(SUBJECT);
        expect(extractVerificationUserId(topic)).toBe(SUBJECT);
        expect(extractVerificationUserId('ticketOwnerId=300000000000000001')).toBeNull();
        expect(extractVerificationUserId(null)).toBeNull();
    });
});

describe('canResolveVerification', () => {
    it('pozwala osobie z ranga administracyjna', () => {
        process.env.ADMIN_ROLE_1_ID = ADMIN_ROLE;
        expect(canResolveVerification({ actorId: ADMIN, actorRoleIds: [ADMIN_ROLE], actorIsAdministrator: false }, SUBJECT)).toBe(true);
    });

    it('pozwala ownerowi', () => {
        process.env.OWNER_ID = OWNER;
        expect(canResolveVerification({ actorId: OWNER, actorRoleIds: [], actorIsAdministrator: false }, SUBJECT)).toBe(true);
    });

    it('odmawia zwyklemu uzytkownikowi', () => {
        process.env.ADMIN_ROLE_1_ID = ADMIN_ROLE;
        expect(canResolveVerification({ actorId: ADMIN, actorRoleIds: [], actorIsAdministrator: false }, SUBJECT)).toBe(false);
    });

    it('nigdy nie pozwala zweryfikowac samego siebie', () => {
        process.env.ADMIN_ROLE_1_ID = ADMIN_ROLE;
        process.env.OWNER_ID = SUBJECT;
        expect(canResolveVerification({ actorId: SUBJECT, actorRoleIds: [ADMIN_ROLE], actorIsAdministrator: true }, SUBJECT)).toBe(false);
    });
});
