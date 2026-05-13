import { Router, type Request } from 'express';
import { config } from 'dotenv';
import { join } from 'node:path';
import {
    exchangeCode,
    getDiscordUser,
    getGuildMember,
    hasRequiredRole,
    hasDevRole,
    resolveDashboardRole,
} from '../discord-api.js';
import type { SessionUser } from '../types.js';
import { createLogger } from '../../utils/logger.js';
import { cacheDiscordUser } from '../../utils/discord-user-cache.js';
import { forceLogoutAllActiveSessions, recordSessionEvent } from '../session/session-events.js';

config();

export const authRouter = Router();

const SCOPES      = 'identify';
const GUILD_ID    = process.env.GUILD_ID!;
const VIEWS = join(__dirname, '..', 'views');
const authLogger = createLogger('dashboard:auth');
const LOGIN_INIT_THROTTLE_MS = 5 * 60 * 1000;
const BOT_UA_PATTERN = /bot|crawler|spider|scan|curl|wget|python-requests|go-http-client|axios|okhttp|scrapy|libwww|httpclient|headless/i;
const loginInitLogCache = new Map<string, number>();

function buildRequestPath(req: Request): string {
    return `${req.baseUrl}${req.path}`;
}

function buildAuthLogContext(req: Request, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        requestId: req.requestId,
        ip: req.ip,
        userAgent: req.get('user-agent') ?? '',
        referer: req.get('referer') ?? '',
        method: req.method,
        path: buildRequestPath(req),
        ...extra,
    };
}

function isLikelyBotUserAgent(userAgent: string): boolean {
    return BOT_UA_PATTERN.test(userAgent.toLowerCase());
}

function shouldThrottleLoginInit(key: string, nowMs: number): boolean {
    const lastLogAt = loginInitLogCache.get(key) ?? 0;
    if (nowMs - lastLogAt < LOGIN_INIT_THROTTLE_MS) {
        return true;
    }

    loginInitLogCache.set(key, nowMs);
    if (loginInitLogCache.size > 5000) {
        for (const [cacheKey, timestamp] of loginInitLogCache.entries()) {
            if (nowMs - timestamp > LOGIN_INIT_THROTTLE_MS * 2) {
                loginInitLogCache.delete(cacheKey);
            }
        }
    }

    return false;
}

authRouter.get('/discord', (req, res) => {
    const state = crypto.randomUUID();
    req.session.oauthState = state;

    const userAgent = req.get('user-agent') ?? '';
    const referer = req.get('referer') ?? '';
    const source = String(req.query.source ?? '').toLowerCase();
    const initiatedFromLogin = source === 'login' || referer.includes('/auth/login');
    const isBotUa = isLikelyBotUserAgent(userAgent);
    const throttleKey = `${req.ip ?? 'unknown'}:${userAgent.slice(0, 120)}`;
    const context = buildAuthLogContext(req, {
        source: initiatedFromLogin ? 'login' : 'direct',
        isBotUserAgent: isBotUa,
    });

    if (initiatedFromLogin && !isBotUa) {
        authLogger.info('DASHBOARD_LOGIN_INITIATED', 'Uzytkownik rozpoczal logowanie do dashboardu.', context);
    } else if (!shouldThrottleLoginInit(throttleKey, Date.now())) {
        authLogger.warn('DASHBOARD_LOGIN_PROBE', 'Podejrzane wejscie na logowanie dashboardu.', context);
    }

    const params = new URLSearchParams({
        client_id:     process.env.CLIENT_ID!,
        redirect_uri:  process.env.DISCORD_REDIRECT_URI!,
        response_type: 'code',
        scope:         SCOPES,
        state,
    });

    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

authRouter.get('/discord/callback', async (req, res) => {
    const { code, state } = req.query as { code?: string; state?: string };

    if (!code || !state || state !== req.session.oauthState) {
        authLogger.warn('DASHBOARD_LOGIN_INVALID_STATE', 'Odrzucono logowanie dashboardu przez nieprawidlowy OAuth state.', buildAuthLogContext(req, {
            hasCode: Boolean(code),
            hasState: Boolean(state),
        }));
        res.redirect('/auth/error?msg=invalid_state');
        return;
    }

    delete req.session.oauthState;

    try {
        const accessToken  = await exchangeCode(code, process.env.DISCORD_REDIRECT_URI!);
        const discordUser  = await getDiscordUser(accessToken);
        const member       = await getGuildMember(discordUser.id, GUILD_ID);

        if (!member) {
            authLogger.warn('DASHBOARD_LOGIN_NOT_MEMBER', 'Odrzucono logowanie: uzytkownik nie jest czlonkiem guildii.', buildAuthLogContext(req, {
                targetUserId: discordUser.id,
            }));
            res.redirect('/auth/error?msg=not_member');
            return;
        }

        if (!hasRequiredRole(member)) {
            authLogger.warn('DASHBOARD_LOGIN_NO_ACCESS', 'Odrzucono logowanie: brak wymaganej roli dashboardu.', buildAuthLogContext(req, {
                targetUserId: discordUser.id,
            }));
            res.redirect('/auth/error?msg=no_access');
            return;
        }

        const sessionUser: SessionUser = {
            id:           discordUser.id,
            username:     discordUser.username,
            globalName:   discordUser.global_name,
            avatar:       discordUser.avatar,
            dashboardRole: resolveDashboardRole(member),
        };

        await new Promise<void>((resolve, reject) => {
            req.session.regenerate((sessionError) => {
                if (sessionError) {
                    reject(sessionError);
                    return;
                }
                resolve();
            });
        });

        req.session.user = sessionUser;
        cacheDiscordUser(sessionUser.id, sessionUser.username, sessionUser.globalName ?? null, sessionUser.avatar ?? null, sessionUser.dashboardRole ?? null);
        void recordSessionEvent({
            eventType: 'login',
            userId: sessionUser.id,
            username: sessionUser.username,
            globalName: sessionUser.globalName ?? null,
            avatarHash: sessionUser.avatar ?? null,
            dashboardRole: resolveDashboardRole(member),
            ip: req.ip ?? '',
            userAgent: req.get('user-agent') ?? '',
            createdAt: Date.now(),
        }).catch((error) => {
            authLogger.warn('SESSION_EVENT_RECORD_FAILED', 'Nie udalo sie zapisac zdarzenia sesji (login).', { actorUserId: sessionUser.id }, error);
        });
        authLogger.info('DASHBOARD_LOGIN_SUCCESS', 'Uzytkownik zalogowal sie do dashboardu.', buildAuthLogContext(req, {
            actorUserId: sessionUser.id,
            username: sessionUser.username,
        }));
        res.redirect('/');
    } catch (err) {
        authLogger.error('DASHBOARD_LOGIN_FAILED', 'Logowanie do dashboardu zakonczone bledem.', buildAuthLogContext(req), err);
        res.redirect('/auth/error?msg=auth_failed');
    }
});

authRouter.post('/logout', (req, res) => {
    const logoutUser = req.session.user;
    const actorUserId = logoutUser?.id;

    req.session.destroy((err) => {
        if (err) {
            authLogger.error('DASHBOARD_LOGOUT_FAILED', 'Nie udalo sie zakonczyc sesji dashboardu.', {
                actorUserId,
                ...buildAuthLogContext(req),
            }, err);
            res.status(500).json({ error: 'Nie udało się zakończyć sesji.' });
            return;
        }

        if (logoutUser) {
            void recordSessionEvent({
                eventType: 'logout',
                userId: logoutUser.id,
                username: logoutUser.username,
                globalName: logoutUser.globalName ?? null,
                avatarHash: logoutUser.avatar ?? null,
                dashboardRole: logoutUser.dashboardRole ?? null,
                ip: req.ip ?? '',
                userAgent: req.get('user-agent') ?? '',
                createdAt: Date.now(),
            }).catch((error) => {
                authLogger.warn('SESSION_EVENT_RECORD_FAILED', 'Nie udalo sie zapisac zdarzenia sesji (logout).', { actorUserId }, error);
            });
        }

        authLogger.info('DASHBOARD_LOGOUT_SUCCESS', 'Uzytkownik wylogowal sie z dashboardu.', {
            actorUserId,
            ...buildAuthLogContext(req),
        });
        res.json({ success: true });
    });
});

authRouter.get('/login', (req, res) => {
    if (req.session.user) {
        res.redirect('/');
        return;
    }

    res.sendFile(join(VIEWS, 'login.html'));
});

authRouter.post('/killswitch', async (req, res) => {
    const actor = req.session.user;

    if (!actor) {
        res.status(401).json({ error: 'Brak autoryzacji.' });
        return;
    }

    try {
        const member = await getGuildMember(actor.id, GUILD_ID);
        if (!member || !hasDevRole(member)) {
            authLogger.warn('DASHBOARD_KILLSWITCH_DENIED', 'Odrzucono killswitch: brak roli Dev.', buildAuthLogContext(req, {
                actorUserId: actor.id,
            }));
            res.status(403).json({ error: 'Brak uprawnień. Wymagana rola Dev.' });
            return;
        }
    } catch (err) {
        authLogger.error('DASHBOARD_KILLSWITCH_ROLE_CHECK_FAILED', 'Nie udalo sie zweryfikowac roli dla killswitch.', buildAuthLogContext(req), err);
        res.status(502).json({ error: 'Nie udało się zweryfikować uprawnień.' });
        return;
    }

    authLogger.warn('DASHBOARD_KILLSWITCH_TRIGGERED', 'Killswitch sesji uruchomiony przez administratora.', buildAuthLogContext(req, {
        actorUserId: actor.id,
        username: actor.username,
    }));

    if (typeof req.sessionStore.clear !== 'function') {
        authLogger.error('DASHBOARD_KILLSWITCH_UNSUPPORTED', 'Session store nie obsluguje metody clear.', buildAuthLogContext(req));
        res.status(500).json({ error: 'Session store nie obsługuje czyszczenia sesji.' });
        return;
    }

    const loggedOutCount = await forceLogoutAllActiveSessions(actor.id).catch((err) => {
        authLogger.warn('DASHBOARD_KILLSWITCH_EVENTS_FAILED', 'Nie udalo sie zapisac zdarzen wylogowania dla killswitch.', { actorUserId: actor.id }, err);
        return 0;
    });

    await new Promise<void>((resolve, reject) => {
        req.sessionStore.clear!((err?: unknown) => {
            if (err) {
                reject(err);
                return;
            }

            resolve();
        });
    });

    authLogger.warn('DASHBOARD_KILLSWITCH_COMPLETED', 'Killswitch sesji zakonczony pomyslnie.', buildAuthLogContext(req, {
        actorUserId: actor.id,
        loggedOutCount,
    }));

    res.json({ success: true, loggedOutCount });
});

const ERROR_MESSAGES: Record<string, string> = {
    no_access:     'Nie masz uprawnień. Wymagana rola: Zarząd, Moderator, Community Manager lub Dev.',
    not_member:    'Nie jesteś członkiem tego serwera Discord.',
    invalid_state: 'Błąd autoryzacji — nieprawidłowy stan. Spróbuj ponownie.',
    auth_failed:   'Logowanie nie powiodło się. Spróbuj ponownie.',
    too_many_attempts: 'Za dużo prób logowania. Poczekaj chwilę i spróbuj ponownie.',
};

authRouter.get('/error', (req, res) => {
    const key = req.query.msg as string;
    const message = ERROR_MESSAGES[key] ?? 'Wystąpił nieznany błąd.';
    res.status(403).send(buildErrorHtml(message));
});

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildErrorHtml(message: string): string {
    return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Brak dostępu — HusariaBot</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;
         background:#1a1c1f;font-family:'Segoe UI',sans-serif;color:#f5f5f5}
    .card{background:#2c2f33;border-radius:16px;padding:48px;text-align:center;
          max-width:440px;border:1px solid rgba(220,20,60,.3);
          box-shadow:0 8px 32px rgba(0,0,0,.5)}
    .icon{font-size:56px;margin-bottom:20px}
    h1{color:#dc143c;font-size:22px;margin-bottom:12px}
    p{color:#99aab5;line-height:1.6;margin-bottom:28px}
    a{display:inline-block;padding:12px 28px;background:#dc143c;color:#fff;
      text-decoration:none;border-radius:8px;font-weight:600;transition:background .2s}
    a:hover{background:#b91030}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🚫</div>
    <h1>Brak dostępu</h1>
    <p>${escapeHtml(message)}</p>
        <a href="/auth/login">Zaloguj sie ponownie</a>
  </div>
</body>
</html>`;
}
