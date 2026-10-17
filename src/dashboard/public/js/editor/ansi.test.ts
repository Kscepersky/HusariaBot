import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface AnsiApi {
  wrap: (text: string, codes: number[]) => string
  stripAnsi: (text: string) => string
  isInsideAnsiFence: (value: string, index: number) => boolean
  applyToSelection: (value: string, start: number, end: number, codes: number[]) => {
    value: string
    selectionStart: number
    selectionEnd: number
  }
  insertFence: (value: string, start: number, end: number) => { value: string; selectionStart: number }
  toHtml: (text: string) => string
}

function loadAnsi(): AnsiApi {
  const sandbox: Record<string, unknown> = {}
  const source = readFileSync(join(process.cwd(), 'src/dashboard/public/js/editor/ansi.js'), 'utf8')
  new Function('window', source)(sandbox)
  return sandbox.HusariaAnsi as AnsiApi
}

const ESC = '\u001b'
const ansi = loadAnsi()

describe('HusariaAnsi', () => {
  it('owija tekst sekwencją i resetem', () => {
    expect(ansi.wrap('x', [1, 31])).toBe(`${ESC}[1;31mx${ESC}[0m`)
  })

  it('usuwa sekwencje przy stripAnsi', () => {
    expect(ansi.stripAnsi(`${ESC}[31mczerwony${ESC}[0m`)).toBe('czerwony')
  })

  it('automatycznie dodaje blok ```ansi poza blokiem', () => {
    const result = ansi.applyToSelection('Witaj świecie', 6, 13, [32])

    expect(result.value).toBe(`Witaj \n\`\`\`ansi\n${ESC}[32mświecie${ESC}[0m\n\`\`\``)
  })

  it('zaczyna blok od nowej linii i oddziela tekst po bloku', () => {
    const result = ansi.applyToSelection('foo bar baz', 4, 7, [31])

    expect(result.value).toBe(`foo \n\`\`\`ansi\n${ESC}[31mbar${ESC}[0m\n\`\`\`\n baz`)
  })

  it('przy pustym zaznaczeniu ustawia kursor między sekwencjami', () => {
    const result = ansi.applyToSelection('```ansi\n\n```', 8, 8, [31])
    const caretMarker = result.value.slice(0, result.selectionStart)

    expect(caretMarker.endsWith(`${ESC}[31m`)).toBe(true)
    expect(result.value.slice(result.selectionStart).startsWith(`${ESC}[0m`)).toBe(true)
  })

  it('nie dubluje bloku, gdy zaznaczenie jest już w ```ansi', () => {
    const value = '```ansi\ntekst\n```'
    const result = ansi.applyToSelection(value, 8, 13, [31])

    expect(result.value).toBe(`\`\`\`ansi\n${ESC}[31mtekst${ESC}[0m\n\`\`\``)
  })

  it('rozpoznaje zwykły blok kodu jako niebędący ANSI', () => {
    const value = '```js\nkod\n```'
    expect(ansi.isInsideAnsiFence(value, 6)).toBe(false)
  })

  it('nie uznaje za wnętrze bloku pozycji za zamkniętym blokiem', () => {
    const value = '```ansi\na\n```\nkoniec'
    expect(ansi.isInsideAnsiFence(value, value.length)).toBe(false)
  })

  it('wstawia pusty blok i ustawia kursor w środku', () => {
    const result = ansi.insertFence('', 0, 0)

    expect(result.value).toBe('```ansi\n\n```')
    expect(result.selectionStart).toBe(8)
  })

  it('renderuje kolory jako span ze stałych palet', () => {
    const html = ansi.toHtml(`${ESC}[1;31mA${ESC}[0m B`)

    expect(html).toContain('color:#dc322f')
    expect(html).toContain('font-weight:700')
    expect(html.endsWith(' B')).toBe(true)
  })

  it('nie przenosi niezaufanego tekstu do atrybutów i usuwa zabłąkane ESC', () => {
    const html = ansi.toHtml(`${ESC}[99mx${ESC}[2J&lt;b&gt;`)

    expect(html).not.toContain(ESC)
    expect(html).not.toContain('style=')
    expect(html).toContain('&lt;b&gt;')
  })
})
