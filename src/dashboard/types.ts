import type { DashboardLanguage, DashboardRole } from './dashboard-sections.js';

export interface SessionUser {
    id: string;
    username: string;
    globalName: string | null;
    avatar: string | null;
    dashboardRole?: DashboardRole;
}

declare module 'express-session' {
    interface SessionData {
        user?: SessionUser;
        oauthState?: string;
        csrfToken?: string;
        /** Jezyk wybrany recznie przez uzytkownika. Brak = domyslny dla roli. */
        language?: DashboardLanguage;
    }
}

declare module 'express-serve-static-core' {
    interface Request {
        requestId?: string;
    }
}
