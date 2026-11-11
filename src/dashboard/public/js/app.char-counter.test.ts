import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDashboardMessagePayload, buildEmbedJson, type EmbedFormData } from '../../embed-handlers.js'

const JS_DIR = join(process.cwd(), 'src/dashboard/public/js')

interface PostLengthStatus {
  length: number
  limit: number
  over: boolean
  warning: boolean
  excess: number
  isEmbed: boolean
}

function extractFunction(source: string, name: string): string {
  const match = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`).exec(source)
  if (!match) throw new Error(`Nie znaleziono funkcji ${name} w app.js`)
  return match[0]
}

function extractConst(source: string, name: string): string {
  const match = new RegExp(`const ${name} = .+\\n`).exec(source)
  if (!match) throw new Error(`Nie znaleziono stalej ${name} w app.js`)
  return match[0]
}

function loadStatusFunction(): (mode: string, title: string, content: string) => PostLengthStatus {
  const source = readFileSync(join(JS_DIR, 'app.js'), 'utf8')
  const body = [
    extractConst(source, 'POST_LENGTH_LIMITS'),
    extractConst(source, 'POST_LENGTH_WARNING_RATIO'),
    extractConst(source, 'PUBLISHER_MENTION_MAX_LENGTH'),
    extractFunction(source, 'getPostLengthStatus'),
    'return getPostLengthStatus',
  ].join('\n')
  return new Function(body)() as ReturnType<typeof loadStatusFunction>
}

const getPostLengthStatus = loadStatusFunction()

describe('getPostLengthStatus - embed', () => {
  it('bez tytulu liczy sama tresc (po przycieciu bialych znakow)', () => {
    const status = getPostLengthStatus('embedded', '', '  Siema  ')
    expect(status).toMatchObject({ length: 5, limit: 4096, over: false, warning: false, excess: 0, isEmbed: true })
  })

  it('z tytulem dolicza naglowek "# **tytul**\\n"', () => {
    expect(getPostLengthStatus('embedded', 'Tytul', 'abc').length).toBe('# **Tytul**\nabc'.length)
    expect(getPostLengthStatus('embedded', '   ', 'abc').length).toBe(3)
  })

  it('ostrzega od 90% limitu, a przekroczenie liczy nadmiar', () => {
    expect(getPostLengthStatus('embedded', '', 'x'.repeat(3600))).toMatchObject({ warning: false, over: false })
    expect(getPostLengthStatus('embedded', '', 'x'.repeat(3700))).toMatchObject({ warning: true, over: false })
    expect(getPostLengthStatus('embedded', '', 'x'.repeat(4096))).toMatchObject({ warning: true, over: false, excess: 0 })
    expect(getPostLengthStatus('embedded', '', 'x'.repeat(4100))).toMatchObject({ warning: false, over: true, excess: 4 })
  })

  it('tytul wlicza sie do limitu', () => {
    const body = 'x'.repeat(4090)
    expect(getPostLengthStatus('embedded', '', body).over).toBe(false)
    expect(getPostLengthStatus('embedded', 'Tytul', body).over).toBe(true)
  })

  it('emoji liczy sie jako 2 jednostki, tak jak w walidacji Discorda', () => {
    expect(getPostLengthStatus('embedded', '', '😀').length).toBe(2)
  })
})

describe('getPostLengthStatus - wiadomosc', () => {
  it('ma limit 2000, ignoruje tytul i dolicza dopisek Opublikowal', () => {
    const status = getPostLengthStatus('message', 'Ignorowany tytul', 'abc')
    expect(status.limit).toBe(2000)
    expect(status.isEmbed).toBe(false)
    expect(status.length).toBe('abc\n\n*Opublikował*: '.length + 22)
  })

  it('przekroczenie wykrywa z uwzglednieniem dopisku', () => {
    expect(getPostLengthStatus('message', '', 'x'.repeat(1950)).over).toBe(false)
    expect(getPostLengthStatus('message', '', 'x'.repeat(1970)).over).toBe(true)
  })
})

describe('licznik zgadza sie z tym, co buduje serwer', () => {
  const metadata = { publishedBy: 'Tester', publishedByUserId: '682670238223040673' }
  const base: EmbedFormData = { mode: 'embedded', channelId: '1240025608390574253', title: '', content: '' } as EmbedFormData

  it.each([
    ['sama tresc', '', 'Krotka tresc'],
    ['z tytulem', 'Regulamin', 'Punkt 1.\nPunkt 2.'],
    ['z emoji i markdown', 'Ogłoszenie 🎉', '**pogrubione** [link](https://example.org) 😀'],
    ['dluga tresc', 'T', 'x'.repeat(3000)],
  ])('embed (%s): dlugosc = dlugosc opisu embeda', (_label, title, content) => {
    const embed = buildEmbedJson({ ...base, title, content }, metadata) as { data?: { description?: string }; description?: string }
    const description = embed.description ?? embed.data?.description ?? ''
    expect(getPostLengthStatus('embedded', title, content).length).toBe(description.length)
  })

  it.each([
    ['krotka', 'Cos tam'],
    ['dluga', 'y'.repeat(1500)],
  ])('wiadomosc (%s): licznik nie jest mniejszy od rzeczywistej tresci i rozni sie o najwyzej 1 znak', (_label, content) => {
    const payload = buildDashboardMessagePayload({ ...base, mode: 'message', content }, metadata)
    const actual = (payload.content ?? '').length
    const counted = getPostLengthStatus('message', '', content).length

    expect(counted).toBeGreaterThanOrEqual(actual)
    expect(counted - actual).toBeLessThanOrEqual(1)
  })
})
