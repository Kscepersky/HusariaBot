import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type Item = [string, string, string, string]
interface Group { key: string; pl: string; en: string; items: Item[] }
interface SearchApi {
  normalizeQuery: (value: string) => string
  buildIndex: (groups: Group[]) => unknown[]
  search: (index: unknown[], query: string, limit?: number) => Item[]
  displayName: (item: Item, language: string) => string
  groupLabel: (group: Group, language: string) => string
  pushRecent: (recent: string[], emoji: string) => string[]
  loadRecent: (storage: unknown) => string[]
  saveRecent: (storage: unknown, recent: string[]) => void
}

const jsDir = join(process.cwd(), 'src/dashboard/public/js/editor')

function load(): { api: SearchApi; groups: Group[] } {
  const sandbox: Record<string, unknown> = {}
  for (const file of ['emoji-data.js', 'emoji-search.js']) {
    new Function('window', readFileSync(join(jsDir, file), 'utf8'))(sandbox)
  }
  return { api: sandbox.HusariaEmojiSearch as SearchApi, groups: sandbox.HusariaUnicodeEmojis as Group[] }
}

const { api, groups } = load()

describe('HusariaEmojiSearch', () => {
  it('dane zawierają wszystkie główne kategorie z niepustymi pozycjami', () => {
    expect(groups.length).toBeGreaterThanOrEqual(9)
    expect(groups.every((group) => group.items.length > 0)).toBe(true)
  })

  it('normalizuje polskie znaki i wielkość liter', () => {
    expect(api.normalizeQuery('  ŚMIECH Łódź ')).toBe('smiech lodz')
  })

  it('znajduje emotkę po polskiej i angielskiej nazwie', () => {
    const index = api.buildIndex(groups)

    expect(api.search(index, 'serce').length).toBeGreaterThan(0)
    expect(api.search(index, 'heart').length).toBeGreaterThan(0)
    expect(api.search(index, 'zzzzniematakiej')).toEqual([])
  })

  it('wymaga dopasowania wszystkich słów i respektuje limit', () => {
    const index = api.buildIndex(groups)

    expect(api.search(index, 'heart', 3).length).toBeLessThanOrEqual(3)
    expect(api.search(index, '')).toEqual([])
  })

  it('wybiera nazwę wg języka z fallbackiem', () => {
    const item: Item = ['😀', 'grinning', '', '']
    expect(api.displayName(item, 'pl')).toBe('grinning')
    expect(api.displayName(['😀', 'grinning', 'uśmiech', ''], 'pl')).toBe('uśmiech')
  })

  it('pushRecent nie mutuje listy, usuwa duplikaty i ogranicza długość', () => {
    const original = ['a', 'b']
    const next = api.pushRecent(original, 'b')

    expect(next).toEqual(['b', 'a'])
    expect(original).toEqual(['a', 'b'])
    expect(api.pushRecent(Array.from({ length: 30 }, (_v, i) => String(i)), 'x').length).toBe(24)
  })

  it('odporny na zepsuty lub zablokowany localStorage', () => {
    expect(api.loadRecent({ getItem: () => 'nie-json' })).toEqual([])
    expect(api.loadRecent({ getItem: () => { throw new Error('blocked') } })).toEqual([])
    expect(() => api.saveRecent({ setItem: () => { throw new Error('quota') } }, ['x'])).not.toThrow()
  })
})
