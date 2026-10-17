import type { Response } from 'express';
import { getGuildTextChannels } from './discord-api.js';
import { createLogger } from '../utils/logger.js';

const channelGuardLogger = createLogger('dashboard:channel-guard');

/**
 * Sprawdza, czy kanal docelowy publikacji nalezy do serwera (GUILD_ID) i jest kanalem
 * tekstowym/ogloszeniowym. Sama poprawnosc formatu ID nie wystarcza - bot moze byc
 * na innych serwerach albo miec dostep do kanalow, ktorych nie ma na liscie dashboardu.
 * Zwraca false po wyslaniu odpowiedzi bledu - wywolujacy ma wtedy tylko zakonczyc obsluge.
 */
export async function verifyTargetChannel(channelId: string, res: Response): Promise<boolean> {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return false;
    }

    try {
        const channels = await getGuildTextChannels(guildId);
        if (channels.some((channel) => channel.id === channelId)) {
            return true;
        }
    } catch (error) {
        channelGuardLogger.error('TARGET_CHANNEL_VERIFY_FAILED', 'Nie udalo sie zweryfikowac kanalu docelowego.', { channelId }, error);
        res.status(502).json({ error: 'Nie udało się zweryfikować kanału docelowego.' });
        return false;
    }

    res.status(400).json({ error: 'Wybrany kanał nie istnieje na tym serwerze.' });
    return false;
}
