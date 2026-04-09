import { Router } from 'express';
import { config } from 'dotenv';
import {
    exchangeCode,
    getDiscordUser,
    getGuildMember,
    hasRequiredRole,
} from '../discord-api.js';
import type { SessionUser } from '../types.js';
import { createLogger } from '../../utils/logger.js';

config();

export const authRouter = Router();

const SCOPES      = 'identify';
const GUILD_ID    = process.env.GUILD_ID!;
const authLogger = createLogger('dashboard:auth');

authRouter.get('/discord', (req, res) => {
    const state = crypto.randomUUID();
    req.session.oauthState = state;

    authLogger.info('DASHBOARD_LOGIN_INITIATED', 'Uzytkownik rozpoczal logowanie do dashboardu.');

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
        authLogger.warn('DASHBOARD_LOGIN_INVALID_STATE', 'Odrzucono logowanie dashboardu przez nieprawidlowy OAuth state.', {
            hasCode: Boolean(code),
            hasState: Boolean(state),
        });
        res.redirect('/auth/error?msg=invalid_state');
        return;
    }

    delete req.session.oauthState;

    try {
        const accessToken  = await exchangeCode(code, process.env.DISCORD_REDIRECT_URI!);
        const discordUser  = await getDiscordUser(accessToken);
        const member       = await getGuildMember(discordUser.id, GUILD_ID);

        if (!member) {
            authLogger.warn('DASHBOARD_LOGIN_NOT_MEMBER', 'Odrzucono logowanie: uzytkownik nie jest czlonkiem guildii.', {
                targetUserId: discordUser.id,
            });
            res.redirect('/auth/error?msg=not_member');
            return;
        }

        if (!hasRequiredRole(member)) {
            authLogger.warn('DASHBOARD_LOGIN_NO_ACCESS', 'Odrzucono logowanie: brak wymaganej roli dashboardu.', {
                targetUserId: discordUser.id,
            });
            res.redirect('/auth/error?msg=no_access');
            return;
        }

        const sessionUser: SessionUser = {
            id:         discordUser.id,
            username:   discordUser.username,
            globalName: discordUser.global_name,
            avatar:     discordUser.avatar,
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
        authLogger.info('DASHBOARD_LOGIN_SUCCESS', 'Uzytkownik zalogowal sie do dashboardu.', {
            actorUserId: sessionUser.id,
            username: sessionUser.username,
        });
        res.redirect('/');
    } catch (err) {
        console.error('OAuth2 callback error:', err);
        authLogger.error('DASHBOARD_LOGIN_FAILED', 'Logowanie do dashboardu zakonczone bledem.', undefined, err);
        res.redirect('/auth/error?msg=auth_failed');
    }
});

authRouter.post('/logout', (req, res) => {
    const actorUserId = req.session.user?.id;

    req.session.destroy((err) => {
        if (err) {
            console.error('Session destroy error:', err);
            authLogger.error('DASHBOARD_LOGOUT_FAILED', 'Nie udalo sie zakonczyc sesji dashboardu.', {
                actorUserId,
            }, err);
            res.status(500).json({ error: 'Nie udało się zakończyć sesji.' });
            return;
        }

        authLogger.info('DASHBOARD_LOGOUT_SUCCESS', 'Uzytkownik wylogowal sie z dashboardu.', {
            actorUserId,
        });
        res.json({ success: true });
    });
});

authRouter.get('/login', (_req, res) => {
    res.redirect('/auth/discord');
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
    <p>${message}</p>
    <a href="/auth/discord">Zaloguj się ponownie</a>
  </div>
</body>
</html>`;
}
