import { describe, expect, it } from 'vitest';
import {
    ADMIN_ROLE_ID,
    MODERATOR_ROLE_ID,
    hasRequiredRoleIds,
    interactionHasSupportRole,
} from './role-access.js';

describe('hasRequiredRoleIds', () => {
    it('zwraca true dla roli Zarząd', () => {
        expect(hasRequiredRoleIds([ADMIN_ROLE_ID])).toBe(true);
    });

    it('zwraca true dla roli Moderator', () => {
        expect(hasRequiredRoleIds([MODERATOR_ROLE_ID])).toBe(true);
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
