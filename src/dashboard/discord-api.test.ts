import { afterEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

afterEach(() => {
  process.env.DISCORD_TOKEN = ORIGINAL_ENV.DISCORD_TOKEN
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('hasBotManageEventsPermission', () => {
  it('returns true when bot has Administrator permission via role', async () => {
    process.env.DISCORD_TOKEN = 'test-token'

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/users/@me')) {
        return jsonResponse({ id: 'bot-user', username: 'bot' })
      }

      if (url.includes('/guilds/123/roles')) {
        return jsonResponse([
          { id: '123', name: '@everyone', permissions: '0', position: 0, managed: false },
          { id: 'admin-role', name: 'Admin', permissions: '8', position: 1, managed: false },
        ])
      }

      if (url.includes('/guilds/123/members/bot-user')) {
        return jsonResponse({
          roles: ['admin-role'],
          nick: null,
        })
      }

      return jsonResponse({}, 404)
    }))

    const { hasBotManageEventsPermission } = await import('./discord-api.js')

    await expect(hasBotManageEventsPermission('123')).resolves.toBe(true)
  })

  it('returns true when only @everyone role has Manage Events', async () => {
    process.env.DISCORD_TOKEN = 'test-token'

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/users/@me')) {
        return jsonResponse({ id: 'bot-user', username: 'bot' })
      }

      if (url.includes('/guilds/123/roles')) {
        return jsonResponse([
          { id: '123', name: '@everyone', permissions: '8589934592', position: 0, managed: false },
          { id: 'normal-role', name: 'Member', permissions: '0', position: 1, managed: false },
        ])
      }

      if (url.includes('/guilds/123/members/bot-user')) {
        return jsonResponse({
          roles: ['normal-role'],
          nick: null,
        })
      }

      return jsonResponse({}, 404)
    }))

    const { hasBotManageEventsPermission } = await import('./discord-api.js')

    await expect(hasBotManageEventsPermission('123')).resolves.toBe(true)
  })

  it('returns false when bot has neither Administrator nor Manage Events', async () => {
    process.env.DISCORD_TOKEN = 'test-token'

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/users/@me')) {
        return jsonResponse({ id: 'bot-user', username: 'bot' })
      }

      if (url.includes('/guilds/123/roles')) {
        return jsonResponse([
          { id: '123', name: '@everyone', permissions: '0', position: 0, managed: false },
          { id: 'normal-role', name: 'Member', permissions: '0', position: 1, managed: false },
        ])
      }

      if (url.includes('/guilds/123/members/bot-user')) {
        return jsonResponse({
          roles: ['normal-role'],
          nick: null,
        })
      }

      return jsonResponse({}, 404)
    }))

    const { hasBotManageEventsPermission } = await import('./discord-api.js')

    await expect(hasBotManageEventsPermission('123')).resolves.toBe(false)
  })
})
