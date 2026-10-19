import { PermissionFlagsBits } from 'discord.js';
import { getSupportRoleIds, getTicketStaffUserIds } from '../utils/role-access.js';

export interface TicketStaffAccess {
    /** Role pingowane przy nowym tickecie. */
    supportRoleIds: string[];
    /** Nadpisania uprawnien kanalu dla roli supportu i uzytkownikow z dostepem do ticketow. */
    overwrites: { id: string; allow: bigint[] }[];
}

const STAFF_TICKET_PERMISSIONS: bigint[] = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.ManageMessages,
];

export async function resolveTicketStaffAccess(): Promise<TicketStaffAccess> {
    const [supportRoleIds, staffUserIds] = await Promise.all([
        getSupportRoleIds(),
        getTicketStaffUserIds(),
    ]);

    const targetIds = [...new Set([...supportRoleIds, ...staffUserIds])];

    return {
        supportRoleIds,
        overwrites: targetIds.map((id) => ({ id, allow: [...STAFF_TICKET_PERMISSIONS] })),
    };
}
