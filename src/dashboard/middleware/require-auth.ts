import type { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    if (req.session.user) {
        next();
        return;
    }
    res.redirect('/auth/discord');
}
