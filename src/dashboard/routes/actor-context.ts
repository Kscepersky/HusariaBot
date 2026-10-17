import type { SessionUser } from '../types.js';

export function buildActorContext(user: SessionUser | undefined): { actorUserId?: string; actorUserName?: string; actorUserRole?: string } {
    if (!user) return {};
    return {
        actorUserId: user.id,
        actorUserName: user.globalName ?? user.username,
        actorUserRole: user.dashboardRole,
    };
}
