import express from 'express';
import session from 'express-session';
import { join } from 'path';
import { config } from 'dotenv';
import './types.js';
import { authRouter }  from './routes/auth.js';
import { apiRouter }   from './routes/api.js';
import { scheduledRouter } from './routes/scheduled.js';
import { g2MatchesRouter } from './routes/g2-matches.js';
import { matchAnnouncementsRouter } from './routes/match-announcements.js';
import { pagesRouter } from './routes/pages.js';
import { initializeDashboardScheduler } from './scheduler/service.js';
import { initializeMatchAnnouncementScheduler } from './match-announcements/service.js';
import { probePandaScoreApiConnection } from './g2-matches/pandascore-client.js';
import { probeDiscordBotApi } from './discord-api.js';

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
    'PANDASCORE_API_KEY',
];

const DASHBOARD_BODY_LIMIT = '12mb';

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

    console.log('🔎  [DEV][DASHBOARD] Start diagnostyki usług...');

    const [discordResult, pandaResult, apiResult] = await Promise.allSettled([
        probeDiscordBotApi(guildId),
        probePandaScoreApiConnection(),
        probeDashboardApi(port),
    ]);

    if (discordResult.status === 'fulfilled') {
        const discordProbe = discordResult.value;
        const guildStatus = discordProbe.inGuild ? 'OK' : 'BOT POZA GUILD';
        console.log(`✅  [DEV][DASHBOARD] Discord Bot API: OK | bot=${discordProbe.username} (${discordProbe.botId}) | guild=${guildStatus}`);
    } else {
        console.warn(`⚠️  [DEV][DASHBOARD] Discord Bot API: FAIL | ${String(discordResult.reason)}`);
    }

    if (pandaResult.status === 'fulfilled') {
        console.log(`✅  [DEV][DASHBOARD] PandaScore API: OK | sampleCount=${pandaResult.value.sampleCount}`);
    } else {
        console.warn(`⚠️  [DEV][DASHBOARD] PandaScore API: FAIL | ${String(pandaResult.reason)}`);
    }

    if (apiResult.status === 'fulfilled') {
        const status = apiResult.value;
        const healthy = status === 401 || status === 200;
        const symbol = healthy ? '✅' : '⚠️';
        console.log(`${symbol}  [DEV][DASHBOARD] Local API /api/me status=${status}${healthy ? ' (expected before login)' : ''}`);
    } else {
        console.warn(`⚠️  [DEV][DASHBOARD] Local API probe failed | ${String(apiResult.reason)}`);
    }
}

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
    app.use('/api/g2-matches', g2MatchesRouter);
    app.use('/api/match-announcements', matchAnnouncementsRouter);
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

    void initializeMatchAnnouncementScheduler().catch((error) => {
        console.error('❌  Nie udało się uruchomić schedulera ogłoszeń meczowych:', error);
    });

    const server = app.listen(port, () => {
        console.log('──────────────────────────────────────');
        console.log(`🌐  Dashboard dostępny na http://localhost:${port}`);
        if (isDevLogsEnabled()) {
            console.log(`🧪  [DEV][DASHBOARD] NODE_ENV=${process.env.NODE_ENV ?? 'undefined'} | DEV_LOGS=${process.env.DEV_LOGS ?? 'auto'}`);
            void runDashboardStartupDiagnostics(port);
        }
        console.log('──────────────────────────────────────');
    });

    server.on('error', (error) => {
        console.error('❌  Błąd uruchamiania serwera dashboardu:', error);
    });
}
