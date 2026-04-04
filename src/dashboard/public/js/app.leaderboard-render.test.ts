import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

class FakeButtonElement {
  disabled = false
}

interface FakeElement {
  innerHTML?: string
  textContent?: string
  value?: string
}

function createMockDom() {
  const elements = new Map<string, FakeElement | FakeButtonElement>([
    ['economy-leaderboard-list', { innerHTML: '' }],
    ['economy-leaderboard-count-label', { textContent: '' }],
    ['economy-leaderboard-page-label', { textContent: '' }],
    ['economy-leaderboard-prev-btn', new FakeButtonElement()],
    ['economy-leaderboard-next-btn', new FakeButtonElement()],
    ['economy-leaderboard-sort', { value: 'xp' }],
  ])

  const documentMock = {
    addEventListener: vi.fn(),
    querySelectorAll: vi.fn(() => []),
    getElementById: (id: string) => elements.get(id) ?? null,
  }

  return {
    elements,
    documentMock,
  }
}

describe('dashboard economy leaderboard render', () => {
  it('renders Discord avatar and display name with fallback placeholder', async () => {
    const { elements, documentMock } = createMockDom()

    const originalDocument = globalThis.document
    const originalFetch = globalThis.fetch
    const originalWindow = (globalThis as Record<string, unknown>).window
    const originalButtonCtor = (globalThis as Record<string, unknown>).HTMLButtonElement

    try {
      ;(globalThis as Record<string, unknown>).document = documentMock
      ;(globalThis as Record<string, unknown>).window = globalThis
      ;(globalThis as Record<string, unknown>).HTMLButtonElement = FakeButtonElement

      const leaderboardPayload = {
        sortBy: 'xp',
        page: 1,
        pageSize: 10,
        totalRows: 2,
        totalPages: 1,
        entries: [
          {
            rank: 1,
            userId: 'u1',
            xp: 420,
            level: 4,
            coins: 210,
            xpIntoLevel: 20,
            xpForNextLevel: 100,
            xpToNextLevel: 80,
            displayName: 'Rotmistrz',
            avatarUrl: 'https://cdn.discordapp.com/avatars/u1/hash.png?size=64',
          },
          {
            rank: 2,
            userId: 'u2',
            xp: 120,
            level: 1,
            coins: 30,
            xpIntoLevel: 20,
            xpForNextLevel: 100,
            xpToNextLevel: 80,
            displayName: '',
            avatarUrl: null,
          },
        ],
      }

      globalThis.fetch = vi.fn(async () => {
        return new Response(JSON.stringify({ leaderboard: leaderboardPayload }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }) as typeof fetch

      const appJsSource = readFileSync(join(process.cwd(), 'src/dashboard/public/js/app.js'), 'utf8')

      const exposeApi = `${appJsSource}\n;globalThis.__dashboardTestApi = { loadEconomyLeaderboard };`
      // eslint-disable-next-line no-new-func
      new Function(exposeApi)()

      const dashboardTestApi = (globalThis as Record<string, unknown>).__dashboardTestApi as {
        loadEconomyLeaderboard: (options?: { silent?: boolean }) => Promise<void>
      }

      await dashboardTestApi.loadEconomyLeaderboard({ silent: true })

      const list = elements.get('economy-leaderboard-list') as FakeElement
      const countLabel = elements.get('economy-leaderboard-count-label') as FakeElement
      const pageLabel = elements.get('economy-leaderboard-page-label') as FakeElement

      expect(countLabel.textContent).toBe('Uzytkownicy: 2')
      expect(pageLabel.textContent).toBe('Strona 1/1')
      expect(list.innerHTML).toContain('Rotmistrz')
      expect(list.innerHTML).toContain('leaderboard-avatar')
      expect(list.innerHTML).toContain('Avatar Rotmistrz')
      expect(list.innerHTML).toContain('leaderboard-avatar-placeholder')
      expect(list.innerHTML).toContain('Uzytkownik u2')
      expect(list.innerHTML).toContain('Postep: 20/100 XP')
      expect(list.innerHTML).toContain('Calkowity XP: 420')
      expect(list.innerHTML).toContain('Coins: 210')
      expect(list.innerHTML).not.toContain('>XP: 420<')
    } finally {
      delete (globalThis as Record<string, unknown>).__dashboardTestApi
      globalThis.fetch = originalFetch

      if (typeof originalDocument === 'undefined') {
        delete (globalThis as Record<string, unknown>).document
      } else {
        ;(globalThis as Record<string, unknown>).document = originalDocument
      }

      if (typeof originalWindow === 'undefined') {
        delete (globalThis as Record<string, unknown>).window
      } else {
        ;(globalThis as Record<string, unknown>).window = originalWindow
      }

      if (typeof originalButtonCtor === 'undefined') {
        delete (globalThis as Record<string, unknown>).HTMLButtonElement
      } else {
        ;(globalThis as Record<string, unknown>).HTMLButtonElement = originalButtonCtor
      }
    }
  })
})
