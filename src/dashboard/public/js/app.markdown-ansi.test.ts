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
