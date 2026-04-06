import { describe, expect, it } from 'vitest';
import {
    ADMIN_ROLE_ID,
    COMMUNITY_MANAGER_ROLE_ID,
    DEV_ROLE_ID,
    MODERATOR_ROLE_ID,
    hasRequiredRoleIds,
    hasSupportRoleIds,
    interactionHasSupportRole,
} from './role-access.js';

describe('hasRequiredRoleIds', () => {
    it('zwraca true dla roli Zarząd', () => {
        expect(hasRequiredRoleIds([ADMIN_ROLE_ID])).toBe(true);
    });

    it('zwraca true dla roli Moderator', () => {
        expect(hasRequiredRoleIds([MODERATOR_ROLE_ID])).toBe(true);
    });

    it('zwraca true dla roli Community Manager gdy jest skonfigurowana', () => {
        if (!COMMUNITY_MANAGER_ROLE_ID) {
            expect(hasRequiredRoleIds(['1234567890'])).toBe(false);
            return;
        }

        expect(hasRequiredRoleIds([COMMUNITY_MANAGER_ROLE_ID])).toBe(true);
        expect(hasSupportRoleIds([COMMUNITY_MANAGER_ROLE_ID])).toBe(true);
    });

    it('zwraca true dla roli Dev gdy jest skonfigurowana', () => {
        if (!DEV_ROLE_ID) {
            expect(hasRequiredRoleIds(['1234567890'])).toBe(false);
            return;
        }

        expect(hasRequiredRoleIds([DEV_ROLE_ID])).toBe(true);
        expect(hasSupportRoleIds([DEV_ROLE_ID])).toBe(false);
    });

    it('zwraca false dla innych ról', () => {
        expect(hasRequiredRoleIds(['1234567890'])).toBe(false);
    });
});

describe('interactionHasSupportRole', () => {
    it('obsługuje APIInteractionGuildMember roles[]', () => {
        const interaction = {
            member: { roles: [ADMIN_ROLE_ID] },
        } as any;

        expect(interactionHasSupportRole(interaction)).toBe(true);
    });

    it('obsługuje member z role managerem cache', () => {
        const interaction = {
            member: {
                roles: {
                    cache: new Map([[MODERATOR_ROLE_ID, {}]]),
                },
            },
        } as any;

        expect(interactionHasSupportRole(interaction)).toBe(true);
    });

    it('zwraca false bez danych o rolach', () => {
        const interaction = { member: null } as any;
        expect(interactionHasSupportRole(interaction)).toBe(false);
    });
});
