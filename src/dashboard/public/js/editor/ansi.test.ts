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
  applyEffect: (value: string, start: number, end: number, key: string) => {
    value: string
    selectionStart: number
  } | null
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

  describe('applyEffect', () => {
    it('koloruje znaki tęczą i dodaje blok ansi', () => {
      const result = ansi.applyEffect('abc', 0, 3, 'rainbow')

      expect(result?.value).toBe(`\`\`\`ansi\n${ESC}[31ma${ESC}[33mb${ESC}[32mc${ESC}[0m\n\`\`\``)
    })

    it('rozciąga gradient na całe zaznaczenie i grupuje takie same kolory', () => {
      const result = ansi.applyEffect('aabbcc', 0, 6, 'fire')

      expect(result?.value).toContain(`${ESC}[37maa${ESC}[33mbb${ESC}[31mcc${ESC}[0m`)
    })

    it('pomija białe znaki i usuwa wcześniejsze kolory', () => {
      const result = ansi.applyEffect(`${ESC}[31ma b${ESC}[0m`, 0, 12, 'neon')

      expect(ansi.stripAnsi(result?.value ?? '')).toBe('```ansi\na b\n```')
      expect(result?.value).toContain(`${ESC}[35ma ${ESC}[36mb`)
    })

    it('nie dodaje drugiego bloku wewnątrz ```ansi', () => {
      const value = '```ansi\nabc\n```'
      const result = ansi.applyEffect(value, 8, 11, 'ocean')

      expect(result?.value.match(/```ansi/g)).toHaveLength(1)
    })

    it('zwraca null dla pustego zaznaczenia lub nieznanego efektu', () => {
      expect(ansi.applyEffect('abc', 1, 1, 'rainbow')).toBeNull()
      expect(ansi.applyEffect('  ', 0, 2, 'rainbow')).toBeNull()
      expect(ansi.applyEffect('abc', 0, 3, 'nope')).toBeNull()
    })
  })

  describe('łączenie stylów', () => {
    it('łączy pogrubienie, kolor i tło na tym samym tekście', () => {
      const bold = ansi.applyToSelection('abc', 0, 3, [1])
      const color = ansi.applyToSelection(bold.value, 8, 8 + 5 + 3, [31])
      const both = ansi.applyToSelection(color.value, 8, color.value.length - 5, [41])

      expect(ansi.toHtml(both.value)).toContain('color:')
      expect(ansi.toHtml(both.value)).toContain('background-color:')
      expect(ansi.toHtml(both.value)).toContain('font-weight:700')
    })

    it('zachowuje styl zewnętrzny po wewnętrznym fragmencie', () => {
      const value = `\`\`\`ansi\n${ESC}[1mabcd${ESC}[0m\n\`\`\``
      const result = ansi.applyToSelection(value, 8 + 4 + 1, 8 + 4 + 3, [31])

      expect(result.value).toContain(`${ESC}[1ma${ESC}[31mbc${ESC}[0m${ESC}[1md${ESC}[0m`)
    })

    it('efekt zachowuje pogrubienie', () => {
      const value = `\`\`\`ansi\n${ESC}[1mab${ESC}[0m\n\`\`\``
      const result = ansi.applyEffect(value, 8, 8 + 4 + 2 + 4, 'neon')

      expect(result?.value).toContain(`${ESC}[1;35ma${ESC}[36mb${ESC}[0m`)
    })
  })

  it('efekt Polska to biel przechodząca w czerwień', () => {
    const result = ansi.applyEffect('abcd', 0, 4, 'poland')

    expect(result?.value).toContain(`${ESC}[37mab${ESC}[31mcd${ESC}[0m`)
  })

  it('efekt Husaria to czerwień na przemian z ciemną szarością na ciemnym tle', () => {
    const result = ansi.applyEffect('abc', 0, 3, 'husaria')

    expect(result?.value).toContain(`${ESC}[31;40ma${ESC}[30mb${ESC}[31mc${ESC}[0m`)
  })

  describe('kolejne style bez ponownego zaznaczania', () => {
    it('po nałożeniu koloru zaznaczenie zostaje na tekście, więc tło dokłada się do niego', () => {
      const color = ansi.applyToSelection('abc', 0, 3, [32])
      const both = ansi.applyToSelection(color.value, color.selectionStart, color.selectionEnd, [41])

      expect(both.value).toBe(`\`\`\`ansi\n${ESC}[32;41mabc${ESC}[0m\n\`\`\``)
      expect(both.value.match(/```ansi/g)).toHaveLength(1)
    })

    it('trzeci styl też się dokłada, a w podglądzie są wszystkie trzy', () => {
      const color = ansi.applyToSelection('abc', 0, 3, [32])
      const background = ansi.applyToSelection(color.value, color.selectionStart, color.selectionEnd, [41])
      const bold = ansi.applyToSelection(background.value, background.selectionStart, background.selectionEnd, [1])
      const html = ansi.toHtml(bold.value)

      expect(html).toContain('color:')
      expect(html).toContain('background-color:')
      expect(html).toContain('font-weight:700')
    })

    it('nie koloruje znaczników bloku, gdy zaznaczono cały blok', () => {
      const color = ansi.applyToSelection('abc', 0, 3, [32])
      const result = ansi.applyToSelection(color.value, 0, color.value.length, [41])

      expect(result.value).toBe(`\`\`\`ansi\n${ESC}[32;41mabc${ESC}[0m\n\`\`\``)
    })
  })
})
