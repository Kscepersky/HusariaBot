import type { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    if (req.session.user) {
        next();
        return;
    }

    // API ma zwracac JSON, a nie przekierowanie do HTML-owej strony logowania.
    if (req.originalUrl.startsWith('/api')) {
        res.status(401).json({ error: 'Brak autoryzacji.' });
        return;
    }

    res.redirect('/auth/login');
}
