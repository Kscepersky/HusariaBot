import { vi } from 'vitest';
import * as access from '../../permissions/access.js';
import { ASSIGNABLE_SECTIONS, DASHBOARD_SECTIONS, type DashboardSection } from '../dashboard-sections.js';

/** Dawne role z Discorda, mapowane na nowy model dostepu (do uzycia w testach tras). */
export type TestRole = 'dev' | 'admin' | 'moderator' | 'community_manager' | 'g2staff' | 'member';

const LIMITED_STAFF_SECTIONS: readonly DashboardSection[] = [
    'embed-creator',
    'scheduled-posts',
    'sent-posts',
    'events',
    'g2-matches',
    'economy-leaderboard',
    'image-library',
    'server-stats',
];

function accessForRole(role: TestRole): access.UserAccess {
    switch (role) {
        case 'dev':
            return { role: 'owner', sections: DASHBOARD_SECTIONS };
        case 'g2staff':
            return { role: 'staff', sections: LIMITED_STAFF_SECTIONS };
        case 'member':
            return { role: null, sections: [] };
        default:
            return { role: 'staff', sections: ASSIGNABLE_SECTIONS };
    }
}

/**
 * Wymaga, by plik testu zmockowal `permissions/access.js` (isOwner i resolveUserAccess jako vi.fn).
 * `dev` = owner, pozostale role = staff z odpowiednim zestawem sekcji.
 */
export function applyTestRole(role: TestRole): void {
    vi.mocked(access.isOwner).mockReturnValue(role === 'dev');
    vi.mocked(access.resolveUserAccess).mockResolvedValue(accessForRole(role));
}
