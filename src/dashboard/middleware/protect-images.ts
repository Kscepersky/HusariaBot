import type { NextFunction, Request, Response } from 'express';
import { createLogger } from '../../utils/logger.js';
import { resolveCurrentAccess } from './require-section-access.js';

const imageAccessLogger = createLogger('dashboard:image-access');

/**
 * Jedyne pliki z `/img` dostepne bez logowania - potrzebne stronie logowania
 * (logo i favicon). Cala reszta biblioteki grafik (w tym wgrane zapowiedzi,
 * ktore moga byc jeszcze nieopublikowane) wymaga zywej sesji z dostepem do panelu.
 */
export const PUBLIC_IMAGE_PATHS: ReadonlySet<string> = new Set(['/DNA.png']);

function decodedPath(req: Request): string | null {
    try {
        return decodeURIComponent(req.path);
    } catch {
        return null;
    }
}

/**
 * Montowany przed `express.static('/img')`. Porownanie sciezki jest dokladne
 * (bez normalizacji i bez zmiany wielkosci liter), wiec kazdy dziwny wariant
 * (`/./DNA.png`, `/dna.png`, `/../x`) trafia na sciezke wymagajaca logowania.
 */
export async function requireImageAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
    const path = decodedPath(req);
    if (path !== null && PUBLIC_IMAGE_PATHS.has(path)) {
        next();
        return;
    }

    const userId = req.session?.user?.id;
    if (!userId) {
        res.status(401).json({ error: 'Brak autoryzacji.' });
        return;
    }

    try {
        // Swieze uprawnienia, nie sama sesja: wyrzucony z serwera lub z odebranym dostepem traci grafiki od razu.
        const access = await resolveCurrentAccess(req);
        if (!access.role) {
            res.status(403).json({ error: 'Brak uprawnień do wykonania tej operacji.' });
            return;
        }
    } catch (error) {
        imageAccessLogger.error('IMAGE_ACCESS_VERIFY_FAILED', 'Nie udalo sie zweryfikowac dostepu do grafiki.', { actorUserId: userId }, error);
        res.status(502).json({ error: 'Nie udało się zweryfikować uprawnień użytkownika.' });
        return;
    }

    // Plik z sesji nie moze trafic do wspolnych cache'y posrednich (proxy, CDN).
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Vary', 'Cookie');
    next();
}
