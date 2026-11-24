import { isSnowflake } from '../permissions/permission-store.js';

/** Kanal #husariada z `HUSARIADA_CHANNEL_ID` (wspolne dla bota i dashboardu). */
export function getHusariadaChannelId(): string | null {
    const value = process.env.HUSARIADA_CHANNEL_ID?.trim();
    return isSnowflake(value) ? value : null;
}
