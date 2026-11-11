import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const JS_DIR = join(process.cwd(), 'src/dashboard/public/js')
const ESC = '\u001b'

function extractFunction(source: string, name: string): string {
  const match = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`).exec(source)
  if (!match) throw new Error(`Nie znaleziono funkcji ${name} w app.js`)
  return match[0]
}

function loadRenderMarkdown(): (text: string) => string {
  const sandbox: Record<string, unknown> = {}
  new Function('window', readFileSync(join(JS_DIR, 'editor/ansi.js'), 'utf8'))(sandbox)

  const appSource = readFileSync(join(JS_DIR, 'app.js'), 'utf8')
  const body = [
    extractFunction(appSource, 'escapeHtml'),
    extractFunction(appSource, 'renderDiscordCustomEmojis'),
    extractFunction(appSource, 'renderMarkdown'),
    'return renderMarkdown',
  ].join('\n')

  // Zależności niezwiązane z markdownem zastępujemy atrapami.
  const factory = new Function('window', 'renderDiscordMentions', 'renderDiscordTimestamps', body)
  return factory(sandbox, (text: string) => text, (text: string) => text) as (text: string) => string
}

const renderMarkdown = loadRenderMarkdown()

describe('renderMarkdown - bloki ANSI', () => {
  it('koloruje zawartość bloku ```ansi', () => {
    const html = renderMarkdown(`\`\`\`ansi\n${ESC}[31mczerwony${ESC}[0m\n\`\`\``)

    expect(html).toContain('md-codeblock-ansi')
    expect(html).toContain('color:#dc322f')
    expect(html).toContain('czerwony')
    expect(html).not.toContain(ESC)
  })

  it('nie wykonuje HTML wstrzykniętego do bloku ANSI', () => {
    const html = renderMarkdown(`\`\`\`ansi\n${ESC}[31m<img src=x onerror=alert(1)>${ESC}[0m\n\`\`\``)

    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('zwykły blok kodu pozostaje bez kolorów', () => {
    const html = renderMarkdown('```js\nconst a = 1\n```')

    expect(html).toContain('md-codeblock')
    expect(html).not.toContain('md-codeblock-ansi')
  })
})

function loadLinkHelpers(): {
  normalizeLinkUrl: (raw: unknown) => string | null
  buildMarkdownLink: (text: unknown, url: unknown) => string | null
} {
  const appSource = readFileSync(join(JS_DIR, 'app.js'), 'utf8')
  const pattern = /const BARE_HOST_WITH_PORT_PATTERN = .+\n/.exec(appSource)
  if (!pattern) throw new Error('Nie znaleziono BARE_HOST_WITH_PORT_PATTERN w app.js')

  const body = [
    pattern[0],
    extractFunction(appSource, 'normalizeLinkUrl'),
    extractFunction(appSource, 'buildMarkdownLink'),
    'return { normalizeLinkUrl, buildMarkdownLink }',
  ].join('\n')

  return new Function(body)() as ReturnType<typeof loadLinkHelpers>
}

const { normalizeLinkUrl, buildMarkdownLink } = loadLinkHelpers()

describe('normalizeLinkUrl', () => {
  it('przyjmuje http i https, a adres bez schematu dostaje https', () => {
    expect(normalizeLinkUrl('https://g2esports.com/news')).toBe('https://g2esports.com/news')
    expect(normalizeLinkUrl('http://example.org')).toBe('http://example.org/')
    expect(normalizeLinkUrl('g2esports.com')).toBe('https://g2esports.com/')
    expect(normalizeLinkUrl('  www.example.org/a b ')).toBe('https://www.example.org/a%20b')
    expect(normalizeLinkUrl('example.org:8080/x')).toBe('https://example.org:8080/x')
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
    'file:///etc/passwd',
    'mailto:a@b.pl',
    'ftp://example.org/x',
    'localhost-bez-kropki',
    'https://bezkropki',
    '',
    '   ',
    null,
    undefined,
  ])('odrzuca %s', (value) => {
    expect(normalizeLinkUrl(value)).toBeNull()
  })

  it('koduje nawiasy, zeby nie zamykaly skladni markdown', () => {
    expect(normalizeLinkUrl('https://pl.wikipedia.org/wiki/Husaria_(formacja)')).toBe('https://pl.wikipedia.org/wiki/Husaria_%28formacja%29')
  })
})

describe('buildMarkdownLink', () => {
  it('sklada [tekst](adres)', () => {
    expect(buildMarkdownLink('nasz regulamin', 'example.org/rules')).toBe('[nasz regulamin](https://example.org/rules)')
  })

  it('pusty tekst = sam adres', () => {
    expect(buildMarkdownLink('  ', 'https://example.org/')).toBe('[https://example.org/](https://example.org/)')
  })

  it('escapuje nawiasy kwadratowe i ukosniki w tekscie i sklada go w jedna linie', () => {
    expect(buildMarkdownLink('a [b] \\ c\nd', 'example.org')).toBe('[a \\[b\\] \\\\ c d](https://example.org/)')
  })

  it('niepoprawny adres = null (nic nie jest wstawiane)', () => {
    expect(buildMarkdownLink('x', 'javascript:alert(1)')).toBeNull()
  })

  it('wynik da sie wyrenderowac z powrotem do tego samego linku', () => {
    const markdown = buildMarkdownLink('a [b] c', 'https://pl.wikipedia.org/wiki/Husaria_(formacja)') as string
    const html = renderMarkdown(markdown)
    expect(html).toContain('>a [b] c</a>')
    expect(html).toContain('href="https://pl.wikipedia.org/wiki/Husaria_%28formacja%29"')
  })
})

describe('renderMarkdown - linki', () => {
  it('renderuje link jako bezpieczne <a> otwierane w nowej karcie', () => {
    const html = renderMarkdown('Zobacz [regulamin](https://example.org/rules) teraz')
    expect(html).toBe('Zobacz <a class="md-link" href="https://example.org/rules" target="_blank" rel="noopener noreferrer nofollow">regulamin</a> teraz')
  })

  it('podkreslenia i gwiazdki w adresie nie sa zamieniane na formatowanie', () => {
    const html = renderMarkdown('[x](https://example.org/a_b_c/*d*/~~e~~)')
    expect(html).toContain('href="https://example.org/a_b_c/*d*/~~e~~"')
    expect(html).not.toContain('<em>')
    expect(html).not.toContain('<s>')
  })

  it('formatowanie w tekscie linku dziala', () => {
    expect(renderMarkdown('[**pilne**](https://example.org)')).toContain('<strong>pilne</strong></a>')
  })

  it('nie renderuje linkow o innym schemacie niz http(s)', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'ftp://example.org', 'mailto:a@b.pl']) {
      const html = renderMarkdown(`[klik](${url})`)
      expect(html).not.toContain('<a ')
      expect(html).not.toContain('href=')
    }
  })

  it('HTML w tekscie i adresie jest escapowany, a atrybutu nie da sie wylamac', () => {
    const textXss = renderMarkdown('[<img src=x onerror=alert(1)>](https://example.org)')
    expect(textXss).not.toContain('<img')

    const attributeBreak = renderMarkdown('[x](https://example.org" onmouseover="alert(1))')
    expect(attributeBreak).not.toContain('<a ')
    expect(attributeBreak).not.toContain('onmouseover="')

    // Cudzyslow w adresie staje sie encja, wiec tekst "onmouseover=" zostaje WEWNATRZ wartosci href
    // i tag ma dokladnie te cztery atrybuty, ktore ustawia kod.
    const quoted = renderMarkdown('[x](https://example.org/"onmouseover=alert(1))')
    expect(quoted).toMatch(/^<a class="md-link" href="[^"]*&quot;onmouseover=alert\(1" target="_blank" rel="noopener noreferrer nofollow">x<\/a>/)
    expect(quoted.match(/<a [^>]*>/)?.[0].split('"').length).toBe(9)
  })

  it('wielokrotne linki w jednej tresci dostaja wlasne adresy', () => {
    const html = renderMarkdown('[a](https://one.example) i [b](https://two.example)')
    expect(html).toContain('href="https://one.example"')
    expect(html).toContain('href="https://two.example"')
  })

  it('link w bloku kodu zostaje tekstem', () => {
    const html = renderMarkdown('```\n[a](https://example.org)\n```')
    expect(html).not.toContain('<a ')
  })

  it('tekst uzytkownika udajacy znacznik zastepczy nie podmienia adresow', () => {
    const html = renderMarkdown('@@LINKURL0@@')
    expect(html).not.toContain('href')
  })
})
