function isValidDashboardUrl(value: string): boolean {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Bazowy adres dashboardu z `DASHBOARD_BASE_URL` (bez koncowego `/`).
 * W produkcji brak lub zly format = `null`; lokalnie fallback na localhost.
 */
export function resolveDashboardUrl(): string | null {
    const configuredUrl = process.env.DASHBOARD_BASE_URL?.trim() ?? '';
    if (configuredUrl) {
        return isValidDashboardUrl(configuredUrl) ? configuredUrl.replace(/\/+$/, '') : null;
    }

    if (process.env.NODE_ENV === 'production') {
        return null;
    }

    const port = process.env.DASHBOARD_PORT?.trim() || '3000';
    return `http://localhost:${port}`;
}

/** Link otwierajacy konkretny task w dashboardzie (obslugiwany przez front po hashu). */
export function buildTaskDeepLink(taskId: string): string | null {
    const base = resolveDashboardUrl();
    return base ? `${base}/#tasks/${encodeURIComponent(taskId)}` : null;
}

export function buildTasksSectionLink(): string | null {
    const base = resolveDashboardUrl();
    return base ? `${base}/#tasks` : null;
}
