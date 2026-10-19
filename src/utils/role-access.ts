import {
    ButtonInteraction,
    ChatInputCommandInteraction,
    MessageFlags,
    ModalSubmitInteraction,
} from 'discord.js';
import { canAccess, getOwnerId, resolveUserAccess } from '../permissions/access.js';
import { getPermissionStore, isSnowflake } from '../permissions/permission-store.js';
import type { DashboardSection } from '../dashboard/dashboard-sections.js';
import { createLogger } from './logger.js';

const accessLogger = createLogger('bot:access');

export type SecuredInteraction =
    | ChatInputCommandInteraction
    | ModalSubmitInteraction
    | ButtonInteraction;

export const SECTION_ACCESS_DENIED_MESSAGE =
    '🚫 Nie masz uprawnień do tej funkcji. Poproś ownera bota o nadanie dostępu w panelu uprawnień.';

/**
 * Role Discorda uzywane wylacznie tam, gdzie sam Discord wymaga roli
 * (widocznosc kanalow ticketow, pingi). Ustawiana przez ownera w panelu.
 */
export async function getSupportRoleIds(): Promise<string[]> {
    const store = await getPermissionStore();
    const roleId = await store.getSetting('support_role_id');
    return roleId && isSnowflake(roleId) ? [roleId] : [];
}

/** Role staffu, ktorych nie wolno wiazac z progami leveli (automatyczne nadawanie/odbieranie). */
export async function getProtectedStaffRoleIds(): Promise<Set<string>> {
    return new Set(await getSupportRoleIds());
}

/**
 * Uzytkownicy, ktorzy maja widziec kanaly ticketow niezaleznie od roli:
 * owner oraz kazdy z uprawnieniem do historii ticketow.
 */
export async function getTicketStaffUserIds(): Promise<string[]> {
    const store = await getPermissionStore();
    const entries = await store.list();
    const staffIds = entries
        .filter((entry) => entry.sections.includes('ticket-history'))
        .map((entry) => entry.userId);

    return [...new Set([getOwnerId(), ...staffIds])];
}

export async function userHasSection(userId: string, section: DashboardSection): Promise<boolean> {
    return canAccess(await resolveUserAccess(userId), section);
}

async function replyEphemeral(interaction: SecuredInteraction, content: string): Promise<void> {
    if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function ensureAccess(
    interaction: SecuredInteraction,
    isAllowed: (userId: string) => Promise<boolean>,
    deniedMessage: string,
): Promise<boolean> {
    let allowed = false;
    try {
        allowed = await isAllowed(interaction.user.id);
    } catch (error) {
        // Blad bazy uprawnien = odmowa (fail closed), nigdy dostep.
        accessLogger.error('BOT_ACCESS_VERIFY_FAILED', 'Nie udalo sie zweryfikowac uprawnien uzytkownika.', { actorUserId: interaction.user.id }, error);
    }

    if (allowed) {
        return true;
    }

    await replyEphemeral(interaction, deniedMessage);
    return false;
}

/** Przepuszcza ownera i uzytkownikow z uprawnieniem do danej zakladki. */
export function ensureSectionAccess(
    interaction: SecuredInteraction,
    section: DashboardSection,
    deniedMessage: string = SECTION_ACCESS_DENIED_MESSAGE,
): Promise<boolean> {
    return ensureAccess(interaction, (userId) => userHasSection(userId, section), deniedMessage);
}

/** Przepuszcza kazdego, kto ma jakikolwiek dostep do dashboardu (owner lub staff). */
export function ensureDashboardAccess(
    interaction: SecuredInteraction,
    deniedMessage: string = SECTION_ACCESS_DENIED_MESSAGE,
): Promise<boolean> {
    return ensureAccess(
        interaction,
        async (userId) => (await resolveUserAccess(userId)).role !== null,
        deniedMessage,
    );
}
