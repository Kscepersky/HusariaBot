import { config } from 'dotenv';

config();

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Brakująca zmienna środowiskowa: ${name}`);
    }
    return value;
}

export const SUPPORT_CATEGORY_ID = requireEnv('SUPPORT_CATEGORY_ID');

export const TICKETS_CONFIG_MODAL_ID = 'husaria_tickets_config_modal';
export const TICKETS_CONFIG_DESCRIPTION_FIELD = 'tickets_config_description';

export const TICKETS_OPEN_BUTTON_ID = 'husaria_ticket_open';
export const TICKET_CLOSE_USER_BUTTON_ID = 'husaria_ticket_close_user';
export const TICKET_CLOSE_ADMIN_BUTTON_ID = 'husaria_ticket_close_admin';

export const TICKET_CLOSE_USER_CONFIRM_ID = 'husaria_ticket_close_user_confirm';
export const TICKET_CLOSE_USER_CANCEL_ID = 'husaria_ticket_close_user_cancel';
export const TICKET_CLOSE_USER_DM_BUTTON_PREFIX = 'husaria_ticket_close_user_dm';
export const TICKET_CLOSE_USER_DM_CONFIRM_PREFIX = 'husaria_ticket_close_user_dm_confirm';
export const TICKET_CLOSE_USER_DM_CANCEL_PREFIX = 'husaria_ticket_close_user_dm_cancel';

export const TICKET_CLOSE_ADMIN_CONFIRM_ID = 'husaria_ticket_close_admin_confirm';
export const TICKET_CLOSE_ADMIN_CANCEL_ID = 'husaria_ticket_close_admin_cancel';

export const TICKET_CLOSE_ADMIN_REASON_MODAL_ID = 'husaria_ticket_close_admin_reason_modal';
export const TICKET_CLOSE_ADMIN_REASON_FIELD = 'ticket_close_admin_reason';
