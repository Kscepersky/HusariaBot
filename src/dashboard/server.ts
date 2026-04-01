import express from 'express';
import session from 'express-session';
import { join } from 'path';
import { config } from 'dotenv';
import './types.js';
import { authRouter }  from './routes/auth.js';
import { apiRouter }   from './routes/api.js';
import { scheduledRouter } from './routes/scheduled.js';
import { pagesRouter } from './routes/pages.js';
import { initializeDashboardScheduler } from './scheduler/service.js';

config();

function requireEnv(name: string): string {
    const val = process.env[name];
    if (!val) throw new Error(`Brakuje zmiennej środowiskowej: ${name}`);
    return val;
}

const REQUIRED_ENV = [
    'DISCORD_TOKEN',
    'CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'DISCORD_REDIRECT_URI',
    'GUILD_ID',
    'ADMIN_ROLE_ID',
    'MODERATOR_ROLE_ID',
    'DASHBOARD_SESSION_SECRET',
];

const DASHBOARD_BODY_LIMIT = '12mb';

export function createDashboardApp() {
    for (const key of REQUIRED_ENV) requireEnv(key);

    const app = express();

    // Security headers
    app.use((_req, res, next) => {
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader(
            'Content-Security-Policy',
            "default-src 'self'; img-src 'self' https://cdn.discordapp.com data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'"
        );
        next();
    });

    app.use(express.json({ limit: DASHBOARD_BODY_LIMIT }));
    app.use(express.urlencoded({ extended: true, limit: DASHBOARD_BODY_LIMIT }));

    app.use(session({
        secret:            requireEnv('DASHBOARD_SESSION_SECRET'),
        resave:            false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            maxAge:   24 * 60 * 60 * 1000,
            secure:   process.env.NODE_ENV === 'production',
        },
    }));

    app.use('/public', express.static(join(__dirname, 'public')));
    app.use('/img',    express.static(join(__dirname, '..', '..', 'img')));

    app.use('/auth', authRouter);
    app.use('/api',  apiRouter);
    app.use('/api/scheduled', scheduledRouter);
    app.use('/',     pagesRouter);

    app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (
            err
            && typeof err === 'object'
            && 'type' in err
            && (err as { type?: string }).type === 'entity.too.large'
        ) {
            res.status(413).json({ error: 'Przesłane dane są zbyt duże.' });
            return;
        }

        next(err);
    });

    return app;
}

export function startDashboard(): void {
    const port = parseInt(process.env.DASHBOARD_PORT ?? '3000', 10);
    const app  = createDashboardApp();

    void initializeDashboardScheduler().catch((error) => {
        console.error('❌  Nie udało się uruchomić schedulera dashboardu:', error);
    });

    app.listen(port, () => {
        console.log('──────────────────────────────────────');
        console.log(`🌐  Dashboard dostępny na http://localhost:${port}`);
        console.log('──────────────────────────────────────');
    });
}
