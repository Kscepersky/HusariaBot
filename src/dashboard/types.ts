export interface SessionUser {
    id: string;
    username: string;
    globalName: string | null;
    avatar: string | null;
}

declare module 'express-session' {
    interface SessionData {
        user?: SessionUser;
        oauthState?: string;
        csrfToken?: string;
    }
}
