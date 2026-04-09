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

describe('listGuildScheduledEvents', () => {
  it('returns cached events when Discord responds with 429 after cache TTL', async () => {
    process.env.DISCORD_TOKEN = 'test-token'

    let currentNow = 0
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => currentNow)

    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return jsonResponse([
          {
            id: 'event-1',
            guild_id: '123',
            name: 'Test Event',
            status: 1,
            scheduled_start_time: '2099-04-01T18:00:00.000Z',
            entity_type: 3,
          },
        ])
      }

      return jsonResponse({
        message: 'You are being rate limited.',
        retry_after: 5,
        global: false,
      }, 429)
    })

    vi.stubGlobal('fetch', fetchMock)

    const { listGuildScheduledEvents } = await import('./discord-api.js')

    const firstResult = await listGuildScheduledEvents('123')

    currentNow = 16_000
    const secondResult = await listGuildScheduledEvents('123')

    currentNow = 16_100
    const thirdResult = await listGuildScheduledEvents('123')

    expect(firstResult).toHaveLength(1)
    expect(secondResult).toEqual(firstResult)
    expect(thirdResult).toEqual(firstResult)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    nowSpy.mockRestore()
  })

  it('returns cached empty snapshot during 429 cooldown when empty list was fetched successfully before', async () => {
    process.env.DISCORD_TOKEN = 'test-token'

    let currentNow = 0
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => currentNow)

    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return jsonResponse([])
      }

      return jsonResponse({
        message: 'You are being rate limited.',
        retry_after: 5,
        global: false,
      }, 429)
    })

    vi.stubGlobal('fetch', fetchMock)

    const { listGuildScheduledEvents } = await import('./discord-api.js')

    const firstResult = await listGuildScheduledEvents('123')

    currentNow = 16_000
    const secondResult = await listGuildScheduledEvents('123')

    currentNow = 16_500
    const thirdResult = await listGuildScheduledEvents('123')

    expect(firstResult).toEqual([])
    expect(secondResult).toEqual([])
    expect(thirdResult).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)

    nowSpy.mockRestore()
  })

  it('throws rate-limit error during 429 cooldown when no cache exists', async () => {
    process.env.DISCORD_TOKEN = 'test-token'

    const nowValues = [1000, 1200]
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowValues.shift() ?? 1200)

    const fetchMock = vi.fn(async () => {
      return jsonResponse({
        message: 'You are being rate limited.',
        retry_after: 5,
        global: false,
      }, 429)
    })

    vi.stubGlobal('fetch', fetchMock)

    const { listGuildScheduledEvents } = await import('./discord-api.js')

    await expect(listGuildScheduledEvents('123')).rejects.toThrow('Discord events endpoint is rate limited.')
    await expect(listGuildScheduledEvents('123')).rejects.toThrow('Discord events endpoint is rate limited.')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    nowSpy.mockRestore()
  })
})

describe('updateGuildMemberRoles', () => {
  it('patches guild member with deduplicated role list', async () => {
    process.env.DISCORD_TOKEN = 'test-token'

    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    const { updateGuildMemberRoles } = await import('./discord-api.js')

    await expect(updateGuildMemberRoles(
      '123456789012345678',
      '987654321098765432',
      ['111111111111111111', '111111111111111111', 'bad-role-id'],
    )).resolves.toBe('updated')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/v10/guilds/123456789012345678/members/987654321098765432',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: 'Bot test-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ roles: ['111111111111111111'] }),
      }),
    )
  })

  it('returns without error when member is missing (404)', async () => {
    process.env.DISCORD_TOKEN = 'test-token'

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 404)))

    const { updateGuildMemberRoles } = await import('./discord-api.js')
    await expect(updateGuildMemberRoles(
      '123456789012345678',
      '987654321098765432',
      ['111111111111111111'],
    )).resolves.toBe('not_found')
  })
})

describe('getDiscordUserById', () => {
  it('returns null and skips fetch for invalid user id', async () => {
    process.env.DISCORD_TOKEN = 'test-token'

    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    const { getDiscordUserById } = await import('./discord-api.js')

    await expect(getDiscordUserById('not-a-snowflake')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('getGuildMember', () => {
  it('throws DiscordRateLimitedError with retry-after when Discord responds 429', async () => {
    process.env.DISCORD_TOKEN = 'test-token'

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        message: 'You are being rate limited.',
        retry_after: 3,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'retry-after': '3',
        },
      },
    )))

    const { getGuildMember, DiscordRateLimitedError } = await import('./discord-api.js')

    await expect(getGuildMember('987654321098765432', '123456789012345678')).rejects.toBeInstanceOf(DiscordRateLimitedError)
  })
})
