import express from 'express';
import session from 'express-session';
import { basename, dirname, isAbsolute, join } from 'path';
import { config } from 'dotenv';
import './types.js';
import { authRouter }  from './routes/auth.js';
import { apiRouter }   from './routes/api.js';
import { scheduledRouter } from './routes/scheduled.js';
import { g2MatchesRouter } from './routes/g2-matches.js';
import { pagesRouter } from './routes/pages.js';
import { ensureCsrfTokenForSession, requireCsrfToken } from './middleware/csrf.js';
import { authRateLimiter, globalRateLimiter, mutationRateLimiter } from './middleware/rate-limit.js';
import { SQLiteSessionStore } from './session/sqlite-store.js';
import { initializeDashboardScheduler } from './scheduler/service.js';
import { probePandaScoreApiConnection } from './g2-matches/pandascore-client.js';
import { probeDiscordBotApi } from './discord-api.js';
import { createLogger } from '../utils/logger.js';

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
    'COMMUNITY_MANAGER_ROLE_ID',
    'DEV_ROLE_ID',
    'DASHBOARD_SESSION_SECRET',
    'PANDASCORE_API_KEY',
];

const DASHBOARD_BODY_LIMIT = '12mb';
const DEFAULT_SESSION_TTL_HOURS = 24;
const dashboardLogger = createLogger('dashboard:server');

function parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }

    return parsed;
}

function isEnabled(value: string | undefined): boolean {
    return value === '1' || value?.toLowerCase() === 'true';
}

function resolveSessionDbLocation(): { dir: string; db: string } {
    const configuredPath = process.env.DASHBOARD_SESSION_DB_PATH?.trim() || 'data/dashboard-sessions.sqlite';
    const absolutePath = isAbsolute(configuredPath)
        ? configuredPath
        : join(process.cwd(), configuredPath);

    return {
        dir: dirname(absolutePath),
        db: basename(absolutePath),
    };
}

function isDevLogsEnabled(): boolean {
    const forceDisabled = process.env.DEV_LOGS === '0';
    return process.env.NODE_ENV !== 'production' && !forceDisabled;
}

async function probeDashboardApi(port: number): Promise<number> {
    const response = await fetch(`http://127.0.0.1:${port}/api/me`, { method: 'GET' });
    return response.status;
}

async function runDashboardStartupDiagnostics(port: number): Promise<void> {
    const guildId = process.env.GUILD_ID ?? '';

    dashboardLogger.debug('DASHBOARD_DIAGNOSTICS_START', 'Start diagnostyki uslug dashboardu.', {
        guildId,
        port,
    });

    const [discordResult, pandaResult, apiResult] = await Promise.allSettled([
        probeDiscordBotApi(guildId),
        probePandaScoreApiConnection(),
        probeDashboardApi(port),
    ]);

    if (discordResult.status === 'fulfilled') {
        const discordProbe = discordResult.value;
        const guildStatus = discordProbe.inGuild ? 'OK' : 'BOT POZA GUILD';
        dashboardLogger.debug('DASHBOARD_DIAGNOSTICS_DISCORD_OK', 'Discord Bot API probe OK.', {
            botId: discordProbe.botId,
            botUsername: discordProbe.username,
            guildStatus,
        });
    } else {
        dashboardLogger.warn('DASHBOARD_DIAGNOSTICS_DISCORD_FAIL', 'Discord Bot API probe failed.', {
            guildId,
        }, discordResult.reason);
    }

    if (pandaResult.status === 'fulfilled') {
        dashboardLogger.debug('DASHBOARD_DIAGNOSTICS_PANDASCORE_OK', 'PandaScore API probe OK.', {
            sampleCount: pandaResult.value.sampleCount,
        });
    } else {
        dashboardLogger.warn('DASHBOARD_DIAGNOSTICS_PANDASCORE_FAIL', 'PandaScore API probe failed.', {}, pandaResult.reason);
    }

    if (apiResult.status === 'fulfilled') {
        const status = apiResult.value;
        const healthy = status === 401 || status === 200;
        dashboardLogger.debug('DASHBOARD_DIAGNOSTICS_LOCAL_API', 'Local API probe completed.', {
            status,
            healthy,
        });
    } else {
        dashboardLogger.warn('DASHBOARD_DIAGNOSTICS_LOCAL_API_FAIL', 'Local API probe failed.', {}, apiResult.reason);
    }
}

export function createDashboardApp() {
    for (const key of REQUIRED_ENV) requireEnv(key);

    const { dir: sessionDir, db: sessionDbFile } = resolveSessionDbLocation();
    const sessionTtlHours = parsePositiveInt(process.env.DASHBOARD_SESSION_TTL_HOURS, DEFAULT_SESSION_TTL_HOURS);
    const sessionMaxAgeMs = sessionTtlHours * 60 * 60 * 1000;
    const sessionDbPath = join(sessionDir, sessionDbFile);
    const sessionStore = new SQLiteSessionStore({
        filePath: sessionDbPath,
        defaultTtlMs: sessionMaxAgeMs,
    });

    const app = express();
    if (isEnabled(process.env.DASHBOARD_TRUST_PROXY)) {
        app.set('trust proxy', 1);
    }

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

    app.use(globalRateLimiter);

    app.use(express.json({ limit: DASHBOARD_BODY_LIMIT }));
    app.use(express.urlencoded({ extended: true, limit: DASHBOARD_BODY_LIMIT }));

    app.use(session({
        secret:            requireEnv('DASHBOARD_SESSION_SECRET'),
        store:             sessionStore,
        resave:            false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            maxAge:   sessionMaxAgeMs,
            secure:   process.env.NODE_ENV === 'production',
        },
    }));

    app.use(ensureCsrfTokenForSession);
    app.use('/auth/discord/callback', authRateLimiter);
    app.use('/api', mutationRateLimiter);
    app.use(requireCsrfToken);

    app.get('/api/csrf-token', (req, res) => {
        if (!req.session.user) {
            res.status(401).json({ error: 'Brak autoryzacji.' });
            return;
        }

        res.setHeader('Cache-Control', 'no-store');
        res.json({ csrfToken: req.session.csrfToken });
    });

    app.use('/public', express.static(join(__dirname, 'public')));
    app.use('/img',    express.static(join(__dirname, '..', '..', 'img')));

    app.use('/auth', authRouter);
    app.use('/api',  apiRouter);
    app.use('/api/scheduled', scheduledRouter);
    app.use('/api/g2-matches', g2MatchesRouter);
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
        dashboardLogger.error('DASHBOARD_SCHEDULER_START_FAILED', 'Nie udalo sie uruchomic schedulera dashboardu.', {}, error);
    });

    const server = app.listen(port, () => {
        dashboardLogger.info('DASHBOARD_STARTED', 'Dashboard uruchomiony.', {
            port,
            url: `http://localhost:${port}`,
        });
        if (isDevLogsEnabled()) {
            dashboardLogger.debug('DASHBOARD_DEV_FLAGS', 'Tryb developerski dashboardu.', {
                nodeEnv: process.env.NODE_ENV ?? 'undefined',
                devLogs: process.env.DEV_LOGS ?? 'auto',
            });
            void runDashboardStartupDiagnostics(port);
        }
    });

    server.on('error', (error) => {
        dashboardLogger.fatal('DASHBOARD_SERVER_ERROR', 'Blad uruchamiania serwera dashboardu.', {
            port,
        }, error);
    });
}
