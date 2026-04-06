import { config } from 'dotenv';
import {
    BaseInteraction,
    ButtonInteraction,
    ChatInputCommandInteraction,
    MessageFlags,
    ModalSubmitInteraction,
} from 'discord.js';

config();

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Brakująca zmienna środowiskowa: ${name}`);
    }
    return value;
}

function readOptionalEnv(name: string): string | null {
    const value = process.env[name]?.trim();
    return value && value.length > 0 ? value : null;
}

function toUniqueRoleIds(roleIds: Array<string | null | undefined>): string[] {
    return [...new Set(roleIds.filter((roleId): roleId is string => typeof roleId === 'string' && roleId.length > 0))];
}

export const ADMIN_ROLE_ID = requireEnv('ADMIN_ROLE_ID');
export const MODERATOR_ROLE_ID = requireEnv('MODERATOR_ROLE_ID');
export const COMMUNITY_MANAGER_ROLE_ID = readOptionalEnv('COMMUNITY_MANAGER_ROLE_ID');
export const DEV_ROLE_ID = readOptionalEnv('DEV_ROLE_ID');

export const SUPPORT_ROLE_IDS = toUniqueRoleIds([
    ADMIN_ROLE_ID,
    MODERATOR_ROLE_ID,
    COMMUNITY_MANAGER_ROLE_ID,
]);

export const SUPPORT_AND_DEV_ROLE_IDS = toUniqueRoleIds([
    ...SUPPORT_ROLE_IDS,
    DEV_ROLE_ID,
]);

export const SUPPORT_ACCESS_DENIED_MESSAGE =
    '🚫 Ta funkcja jest dostępna tylko dla ról **Zarząd**, **Moderator**, **Community Manager** i **Dev**.';

export type SecuredInteraction =
    | ChatInputCommandInteraction
    | ModalSubmitInteraction
    | ButtonInteraction;

export function hasSupportRoleIds(roleIds: readonly string[]): boolean {
    return SUPPORT_ROLE_IDS.some((requiredRoleId) => roleIds.includes(requiredRoleId));
}

export function hasRequiredRoleIds(roleIds: readonly string[]): boolean {
    return SUPPORT_AND_DEV_ROLE_IDS.some((requiredRoleId) => roleIds.includes(requiredRoleId));
}

function extractRoleIds(member: unknown): string[] {
    if (!member || typeof member !== 'object') {
        return [];
    }

    const candidate = member as { roles?: unknown };
    if (!candidate.roles) {
        return [];
    }

    if (Array.isArray(candidate.roles)) {
        return candidate.roles.filter((roleId): roleId is string => typeof roleId === 'string');
    }

    if (typeof candidate.roles === 'object' && candidate.roles !== null) {
        const roleManager = candidate.roles as {
            cache?: { keys: () => IterableIterator<string>; has?: (roleId: string) => boolean };
            has?: (roleId: string) => boolean;
        };

        if (typeof roleManager.has === 'function') {
            return SUPPORT_AND_DEV_ROLE_IDS.filter((roleId) => roleManager.has?.(roleId));
        }

        if (roleManager.cache && typeof roleManager.cache.has === 'function') {
            return SUPPORT_AND_DEV_ROLE_IDS.filter((roleId) => roleManager.cache?.has?.(roleId));
        }

        if (roleManager.cache && typeof roleManager.cache.keys === 'function') {
            return Array.from(roleManager.cache.keys());
        }
    }

    return [];
}

export function interactionHasSupportRole(interaction: BaseInteraction): boolean {
    const roleIds = extractRoleIds((interaction as { member?: unknown }).member);
    return hasRequiredRoleIds(roleIds);
}

async function replyEphemeral(interaction: SecuredInteraction, content: string): Promise<void> {
    if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

export async function ensureSupportRole(
    interaction: SecuredInteraction,
    deniedMessage: string = SUPPORT_ACCESS_DENIED_MESSAGE,
): Promise<boolean> {
    if (interactionHasSupportRole(interaction)) {
        return true;
    }

    await replyEphemeral(interaction, deniedMessage);
    return false;
}
