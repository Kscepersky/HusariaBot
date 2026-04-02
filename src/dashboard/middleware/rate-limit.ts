import rateLimit from 'express-rate-limit';
import type { NextFunction, Request, Response } from 'express';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }

    return parsed;
}

function isRateLimitDisabled(): boolean {
    if (process.env.NODE_ENV === 'test' && process.env.DASHBOARD_ENABLE_RATE_LIMIT_TESTS !== '1') {
        return true;
    }

    return process.env.DASHBOARD_DISABLE_RATE_LIMIT === '1';
}

const globalLimiter = rateLimit({
    windowMs: parsePositiveInt(process.env.DASHBOARD_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: parsePositiveInt(process.env.DASHBOARD_RATE_LIMIT_MAX, 240),
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isRateLimitDisabled(),
    handler: (_req, res) => {
        res.status(429).json({ error: 'Zbyt wiele zapytan. Sprobuj ponownie pozniej.' });
    },
});

const authCallbackLimiter = rateLimit({
    windowMs: parsePositiveInt(process.env.DASHBOARD_AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: parsePositiveInt(process.env.DASHBOARD_AUTH_RATE_LIMIT_MAX, 30),
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isRateLimitDisabled(),
    handler: (_req, res) => {
        res.redirect('/auth/error?msg=too_many_attempts');
    },
});

const mutationLimiter = rateLimit({
    windowMs: parsePositiveInt(process.env.DASHBOARD_MUTATION_RATE_LIMIT_WINDOW_MS, 60 * 1000),
    max: parsePositiveInt(process.env.DASHBOARD_MUTATION_RATE_LIMIT_MAX, 80),
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isRateLimitDisabled(),
    handler: (_req, res) => {
        res.status(429).json({ error: 'Zbyt wiele operacji modyfikujacych. Poczekaj chwile.' });
    },
});

export function globalRateLimiter(req: Request, res: Response, next: NextFunction): void {
    void globalLimiter(req, res, next);
}

export function authRateLimiter(req: Request, res: Response, next: NextFunction): void {
    void authCallbackLimiter(req, res, next);
}

export function mutationRateLimiter(req: Request, res: Response, next: NextFunction): void {
    if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
        next();
        return;
    }

    void mutationLimiter(req, res, next);
}