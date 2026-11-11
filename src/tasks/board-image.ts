import { describeUsers } from '../dashboard/user-summaries.js';
import { resolveDashboardUrl } from '../utils/dashboard-url.js';
import { buildBoardAltText, renderTaskBoardImage, type BoardUser } from './board-renderer.js';
import type { BoardImage } from './board.js';
import type { Task } from './types.js';

function avatarUrlFor(userId: string, avatarHash: string | null): string {
    if (avatarHash) {
        return `https://cdn.discordapp.com/avatars/${encodeURIComponent(userId)}/${encodeURIComponent(avatarHash)}.png?size=64`;
    }

    // Domyslny awatar Discorda zalezy od ID (nowy system nazw: (id >> 22) % 6).
    let index = 0;
    try {
        index = Number((BigInt(userId) >> 22n) % 6n);
    } catch {
        index = 0;
    }
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function footerText(): string {
    const base = resolveDashboardUrl();
    let host = '';
    try {
        host = base ? new URL(base).host : '';
    } catch {
        host = '';
    }
    return host ? `Dodawaj i kończ taski w dashboardzie · ${host}` : 'Dodawaj i kończ taski w dashboardzie';
}

/** Pobiera nazwy i awatary osób z listy, rysuje kartę i zwraca ją razem z alt-textem. */
export async function renderBoardImageForTasks(tasks: readonly Task[]): Promise<BoardImage> {
    const ids = tasks.map((task) => task.assigneeId);
    const summaries = await describeUsers(ids);
    const users: Record<string, BoardUser> = Object.fromEntries(
        Object.values(summaries).map((summary) => [
            summary.id,
            {
                name: summary.globalName ?? summary.username ?? `Użytkownik ${summary.id.slice(-4)}`,
                avatarUrl: avatarUrlFor(summary.id, summary.avatar),
            },
        ]),
    );

    const now = Date.now();
    return {
        data: await renderTaskBoardImage({ tasks, users, now, footerText: footerText() }),
        altText: buildBoardAltText(tasks, users, now),
    };
}
