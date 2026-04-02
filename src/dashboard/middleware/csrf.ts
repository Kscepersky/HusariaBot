import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const CSRF_HEADER = 'x-csrf-token';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function generateCsrfToken(): string {
    return randomBytes(32).toString('hex');
}

function getRequestToken(req: Request): string {
    const headerToken = req.headers[CSRF_HEADER];
    if (typeof headerToken === 'string') {
        return headerToken;
    }

    if (Array.isArray(headerToken) && headerToken.length > 0) {
        const firstToken = headerToken[0];
        return typeof firstToken === 'string' ? firstToken : '';
    }

    const bodyToken = (req.body && typeof req.body === 'object')
        ? (req.body as Record<string, unknown>).csrfToken
        : undefined;

    return typeof bodyToken === 'string' ? bodyToken : '';
}

function isProtectedMutationRequest(req: Request): boolean {
    const method = req.method.toUpperCase();
    const lowerCasePath = req.path.toLowerCase();
    const normalizedPath = lowerCasePath.replace(/\/+$/, '') || '/';

    if (!MUTATING_METHODS.has(method)) {
        return false;
    }

    if (normalizedPath.startsWith('/api')) {
        return true;
    }

    return normalizedPath === '/auth/logout' && method === 'POST';
}

function secureCompareToken(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
}

export function ensureCsrfTokenForSession(req: Request, _res: Response, next: NextFunction): void {
    if (req.session.user && !req.session.csrfToken) {
        req.session.csrfToken = generateCsrfToken();
    }

    next();
}

export function requireCsrfToken(req: Request, res: Response, next: NextFunction): void {
    if (!isProtectedMutationRequest(req)) {
        next();
        return;
    }

    if (!req.session.user) {
        next();
        return;
    }

    const sessionToken = req.session.csrfToken;
    const requestToken = getRequestToken(req);

    if (!sessionToken || !requestToken || !secureCompareToken(requestToken, sessionToken)) {
        res.status(403).json({ error: 'Nieprawidlowy token CSRF.' });
        return;
    }

    next();
}