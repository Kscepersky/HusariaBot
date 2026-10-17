export const LOG_CATEGORIES = [
    'security',
    'auth',
    'posts',
    'economy',
    'shop',
    'events',
    'bot',
    'system',
] as const;

export type LogCategory = (typeof LOG_CATEGORIES)[number];

const SECURITY_ACTIONS = new Set([
    'DASHBOARD_RATE_LIMIT_HIT',
    'DASHBOARD_LOGIN_PROBE',
    'DASHBOARD_LOGIN_INVALID_STATE',
    'DASHBOARD_LOGIN_NO_ACCESS',
    'DASHBOARD_LOGIN_NOT_MEMBER',
    'DASHBOARD_SECTION_ACCESS_DENIED',
    'DASHBOARD_DEV_ONLY_DENIED',
    'DASHBOARD_KILLSWITCH_TRIGGERED',
    'DASHBOARD_KILLSWITCH_COMPLETED',
]);

const POST_ACTION_PREFIXES = ['EMBED_', 'SCHEDULED_', 'SENT_POST', 'PING_MESSAGE', 'TICKET_'];
const EVENT_ACTION_PREFIXES = ['WATCHPARTY_', 'DISCORD_EVENT', 'G2_'];

/** Przypisuje wpis logu do jednej tematycznej kategorii (do filtrowania w dashboardzie). */
export function categorizeLogEntry(entry: { action: string; scope: string }): LogCategory {
    const { action, scope } = entry;

    if (SECURITY_ACTIONS.has(action) || scope === 'dashboard:rate-limit') {
        return 'security';
    }
    if (action.startsWith('DASHBOARD_LOGIN') || action.startsWith('DASHBOARD_LOGOUT')) {
        return 'auth';
    }
    if (scope === 'economy-level-roles' || action.startsWith('LEVEL_ROLE') || action.startsWith('ECONOMY_') || action.startsWith('LEADERBOARD_')) {
        return 'economy';
    }
    if (scope.includes('shop') || action.startsWith('SHOP_')) {
        return 'shop';
    }
    if (POST_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix))) {
        return 'posts';
    }
    if (EVENT_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix))) {
        return 'events';
    }
    if (scope.startsWith('bot:')) {
        return 'bot';
    }

    return 'system';
}
