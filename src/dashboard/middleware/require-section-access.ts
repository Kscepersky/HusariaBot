import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getGuildMember, resolveDashboardRole } from '../discord-api.js';
import { canAccessSection, resolveAllowedSections, type DashboardRole, type DashboardSection } from '../dashboard-sections.js';
import { createLogger } from '../../utils/logger.js';

const accessLogger = createLogger('dashboard-access');

/**
 * Ustala aktualna role uzytkownika na podstawie swiezych danych z Discorda.
 * Celowo NIE ufa `req.session.user.dashboardRole` - rola w Discordzie mogla
 * zostac odebrana juz po zalogowaniu.
 */
export async function resolveCurrentDashboardRole(req: Request): Promise<DashboardRole | null> {
    const guildId = process.env.GUILD_ID;
    const userId = req.session.user?.id;

    if (!guildId || !userId) {
        return null;
    }

    const member = await getGuildMember(userId, guildId);
    return member ? resolveDashboardRole(member) : null;
}

/**
 * Przepuszcza zadanie tylko wtedy, gdy rola uzytkownika ma dostep do danej
 * sekcji dashboardu. Jedyny mechanizm autoryzacji, ktoremu wolno ufac -
 * ukrywanie zakladek we froncie jest wylacznie kosmetyka.
 */
export function requireSectionAccess(section: DashboardSection): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const guildId = process.env.GUILD_ID;
        if (!guildId) {
            res.status(500).json({ error: 'Brakuje GUILD_ID.' });
            return;
        }

        const userId = req.session.user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Brak autoryzacji.' });
            return;
        }

        try {
            const role = await resolveCurrentDashboardRole(req);

            if (!role || !canAccessSection(role, section)) {
                accessLogger.warn('DASHBOARD_SECTION_ACCESS_DENIED', 'Odmowa dostepu do sekcji dashboardu.', {
                    actorUserId: userId,
                    actorUserRole: role ?? 'unknown',
                    section,
                    path: req.originalUrl,
                    method: req.method,
                });
                res.status(403).json({ error: 'Brak uprawnień do wykonania tej operacji.' });
                return;
            }

            next();
        } catch (error) {
            accessLogger.error(
                'DASHBOARD_SECTION_ACCESS_VERIFY_FAILED',
                'Nie udalo sie zweryfikowac dostepu do sekcji dashboardu.',
                { actorUserId: userId, section },
                error,
            );
            res.status(502).json({ error: 'Nie udało się zweryfikować uprawnień użytkownika.' });
        }
    };
}

/**
 * Przepuszcza tylko role `dev`. Dla operacji destrukcyjnych lub konfiguracyjnych,
 * do ktorych sekcja (np. server-stats) jest dostepna szerszej grupie tylko do odczytu.
 */
export function requireDevRole(): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = req.session.user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Brak autoryzacji.' });
            return;
        }

        try {
            const role = await resolveCurrentDashboardRole(req);

            if (role !== 'dev') {
                accessLogger.warn('DASHBOARD_DEV_ONLY_DENIED', 'Odmowa dostepu do operacji tylko dla roli dev.', {
                    actorUserId: userId,
                    actorUserRole: role ?? 'unknown',
                    path: req.originalUrl,
                    method: req.method,
                });
                res.status(403).json({ error: 'Brak uprawnień do wykonania tej operacji.' });
                return;
            }

            next();
        } catch (error) {
            accessLogger.error('DASHBOARD_DEV_ONLY_VERIFY_FAILED', 'Nie udalo sie zweryfikowac roli dev.', { actorUserId: userId }, error);
            res.status(502).json({ error: 'Nie udało się zweryfikować uprawnień użytkownika.' });
        }
    };
}

export { resolveAllowedSections };
