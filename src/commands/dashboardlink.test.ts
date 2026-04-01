import { afterEach, describe, expect, it, vi } from 'vitest';
import { dashboardLinkCommand } from './dashboardlink.js';
import { ADMIN_ROLE_ID } from '../utils/role-access.js';

describe('dashboardLinkCommand', () => {
    const originalDashboardBaseUrl = process.env.DASHBOARD_BASE_URL;

    afterEach(() => {
        process.env.DASHBOARD_BASE_URL = originalDashboardBaseUrl;
    });

    it('wysyla ephemeral embed z przyciskiem linku do dashboardu', async () => {
        process.env.DASHBOARD_BASE_URL = 'https://panel.husaria.example';

        const reply = vi.fn().mockResolvedValue(undefined);
        const interaction = {
            member: {
                roles: [ADMIN_ROLE_ID],
            },
            reply,
        } as any;

        await dashboardLinkCommand.execute(interaction);

        expect(reply).toHaveBeenCalledTimes(1);
        const payload = reply.mock.calls[0]?.[0];
        expect(payload.flags).toBe(64);
        expect(payload.embeds).toHaveLength(1);
        expect(payload.components).toHaveLength(1);

        const button = payload.components[0].toJSON().components[0];
        expect(button.url).toBe('https://panel.husaria.example');
    });

    it('zwraca blad konfiguracji dla nieprawidlowego URL', async () => {
        process.env.DASHBOARD_BASE_URL = 'not-a-url';

        const reply = vi.fn().mockResolvedValue(undefined);
        const interaction = {
            member: {
                roles: [ADMIN_ROLE_ID],
            },
            reply,
        } as any;

        await dashboardLinkCommand.execute(interaction);

        expect(reply).toHaveBeenCalledTimes(1);
        const payload = reply.mock.calls[0]?.[0];
        expect(payload.content).toContain('DASHBOARD_BASE_URL');
        expect(payload.flags).toBe(64);
    });
});
