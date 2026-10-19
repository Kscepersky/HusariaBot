import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getGuildMember } from '../discord-api.js';
import { canAccess, isOwner, resolveUserAccess, type UserAccess } from '../../permissions/access.js';
import type { DashboardSection } from '../dashboard-sections.js';
import { createLogger } from '../../utils/logger.js';

const accessLogger = createLogger('dashboard-access');

const NO_ACCESS: UserAccess = { role: null, sections: [] };

/**
 * Ustala aktualny dostep uzytkownika na podstawie bazy uprawnien i swiezych
 * danych z Discorda. Celowo NIE ufa niczemu z sesji poza ID uzytkownika -
 * uprawnienia moglyby zostac odebrane juz po zalogowaniu.
 *
 * Owner jest rozpoznawany wylacznie po `OWNER_ID` z env. Pozostali musza
 * dodatkowo nadal byc czlonkami guildii (wyrzucony/zbanowany traci dostep
 * natychmiast, nawet jesli ma wpis w bazie).
 */
export async function resolveCurrentAccess(req: Request): Promise<UserAccess> {
    const userId = req.session.user?.id;
    if (!userId) {
        return NO_ACCESS;
    }

    if (isOwner(userId)) {
        return resolveUserAccess(userId);
    }

    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        return NO_ACCESS;
    }

    const member = await getGuildMember(userId, guildId);
    return member ? resolveUserAccess(userId) : NO_ACCESS;
}

function respondInternalError(
    res: Response,
    code: string,
    message: string,
    context: Record<string, unknown>,
    error: unknown,
): void {
    accessLogger.error(code, message, context, error);
    res.status(502).json({ error: 'Nie udało się zweryfikować uprawnień użytkownika.' });
}

/**
 * Przepuszcza zadanie tylko wtedy, gdy uzytkownik ma dostep do danej sekcji
 * dashboardu. Jedyny mechanizm autoryzacji, ktoremu wolno ufac - ukrywanie
 * zakladek we froncie jest wylacznie kosmetyka.
 */
export function requireSectionAccess(section: DashboardSection): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = req.session.user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Brak autoryzacji.' });
            return;
        }

        try {
            const access = await resolveCurrentAccess(req);

            if (!canAccess(access, section)) {
                accessLogger.warn('DASHBOARD_SECTION_ACCESS_DENIED', 'Odmowa dostepu do sekcji dashboardu.', {
                    actorUserId: userId,
                    actorUserRole: access.role ?? 'none',
                    section,
                    path: req.originalUrl,
                    method: req.method,
                });
                res.status(403).json({ error: 'Brak uprawnień do wykonania tej operacji.' });
                return;
            }

            next();
        } catch (error) {
            respondInternalError(
                res,
                'DASHBOARD_SECTION_ACCESS_VERIFY_FAILED',
                'Nie udalo sie zweryfikowac dostepu do sekcji dashboardu.',
                { actorUserId: userId, section },
                error,
            );
        }
    };
}

/**
 * Przepuszcza tylko ownera. Dla operacji destrukcyjnych, konfiguracyjnych
 * i panelu uprawnien - nie da sie tego nikomu nadac.
 */
export function requireOwner(): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = req.session.user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Brak autoryzacji.' });
            return;
        }

        if (isOwner(userId)) {
            next();
            return;
        }

        accessLogger.warn('DASHBOARD_OWNER_ONLY_DENIED', 'Odmowa dostepu do operacji tylko dla ownera.', {
            actorUserId: userId,
            path: req.originalUrl,
            method: req.method,
        });
        res.status(403).json({ error: 'Brak uprawnień do wykonania tej operacji.' });
    };
}
