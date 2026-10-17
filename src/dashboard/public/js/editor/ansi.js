// Kolory ANSI dla kreatora publikacji. Discord renderuje je w blokach ```ansi.
// Moduł jest czystą logiką (bez DOM), dzięki czemu da się go testować w Node.
(function (global) {
  const ESC = '\u001b'
  const RESET_CODE = 0
  const BOLD_CODE = 1
  const UNDERLINE_CODE = 4

  // Palety zgodne z tym, co faktycznie rysuje klient Discorda.
  const FOREGROUND_COLORS = [
    { code: 30, key: 'gray', css: '#4f545c' },
    { code: 31, key: 'red', css: '#dc322f' },
    { code: 32, key: 'green', css: '#859900' },
    { code: 33, key: 'yellow', css: '#b58900' },
    { code: 34, key: 'blue', css: '#268bd2' },
    { code: 35, key: 'pink', css: '#d33682' },
    { code: 36, key: 'cyan', css: '#2aa198' },
    { code: 37, key: 'white', css: '#ffffff' },
  ]

  const BACKGROUND_COLORS = [
    { code: 40, key: 'darkBlue', css: '#002b36' },
    { code: 41, key: 'orange', css: '#cb4b16' },
    { code: 42, key: 'marbleBlue', css: '#586e75' },
    { code: 43, key: 'turquoise', css: '#657b83' },
    { code: 44, key: 'gray', css: '#839496' },
    { code: 45, key: 'indigo', css: '#6c71c4' },
    { code: 46, key: 'lightGray', css: '#93a1a1' },
    { code: 47, key: 'white', css: '#fdf6e3' },
  ]

  // Efekty kolorują tekst znak po znaku. `cycle` powtarza kolory w kółko (tęcza),
  // `stretch` rozciąga je na całe zaznaczenie (płynniejszy gradient).
  const EFFECTS = [
    { key: 'rainbow', mode: 'cycle', codes: [31, 33, 32, 36, 34, 35] },
    { key: 'fire', mode: 'stretch', codes: [37, 33, 31] },
    { key: 'ocean', mode: 'stretch', codes: [37, 36, 34] },
    { key: 'sunset', mode: 'stretch', codes: [33, 31, 35, 34] },
    { key: 'forest', mode: 'stretch', codes: [33, 32, 36] },
    { key: 'neon', mode: 'cycle', codes: [35, 36] },
    { key: 'poland', mode: 'stretch', codes: [37, 31] },
    { key: 'husaria', mode: 'cycle', codes: [31, 30], extra: [40] },
  ]

  const FENCE = '```'
  const ANSI_FENCE_OPEN = '```ansi\n'

  const SGR_PATTERN = /\u001b\[([0-9;]*)m/g

  function cssForCode(palette, code) {
    const match = palette.find((entry) => entry.code === code)
    return match ? match.css : null
  }

  function wrap(text, codes) {
    const sequence = codes.join(';')
    return `${ESC}[${sequence}m${text}${ESC}[${RESET_CODE}m`
  }

  function stripAnsi(text) {
    return String(text ?? '').replace(SGR_PATTERN, '')
  }

  // Zwraca true, gdy pozycja `index` leży wewnątrz otwartego bloku ```ansi.
  function isInsideAnsiFence(value, index) {
    const before = value.slice(0, index)
    let fenceCount = 0
    let lastFenceAt = -1
    let position = before.indexOf(FENCE)

    while (position !== -1) {
      fenceCount += 1
      lastFenceAt = position
      position = before.indexOf(FENCE, position + FENCE.length)
    }

    if (fenceCount % 2 === 0) {
      return false
    }

    return /^ansi(\r?\n|$)/.test(before.slice(lastFenceAt + FENCE.length))
  }

  // Bloki ``` Discord rozpoznaje na początku linii, więc w razie potrzeby dokładamy znaki nowej linii.
  function fenceLayout(source, start, end) {
    const leading = start > 0 && source[start - 1] !== '\n' ? '\n' : ''
    const trailing = end < source.length && source[end] !== '\n' ? '\n' : ''
    return { leading, trailing }
  }

  const DEFAULT_STATE = { fg: null, bg: null, bold: false, underline: false }

  function sameState(a, b) {
    return a.fg === b.fg && a.bg === b.bg && a.bold === b.bold && a.underline === b.underline
  }

  function stateToCodes(state) {
    return [
      state.bold ? BOLD_CODE : null,
      state.underline ? UNDERLINE_CODE : null,
      state.fg,
      state.bg,
    ].filter((code) => code !== null)
  }

  // Czy przejście wymaga resetu, bo któryś atrybut trzeba wyłączyć (kod koloru tylko nadpisuje kolor).
  function needsReset(from, to) {
    return (from.bold && !to.bold)
      || (from.underline && !to.underline)
      || (from.fg !== null && to.fg === null)
      || (from.bg !== null && to.bg === null)
  }

  // Najkrótsza sekwencja prowadząca z jednego stanu stylu do drugiego.
  function transition(from, to) {
    if (sameState(from, to)) return ''

    if (needsReset(from, to)) {
      const codes = stateToCodes(to)
      const reset = `${ESC}[${RESET_CODE}m`
      return codes.length === 0 ? reset : `${reset}${ESC}[${codes.join(';')}m`
    }

    const changed = [
      to.bold && !from.bold ? BOLD_CODE : null,
      to.underline && !from.underline ? UNDERLINE_CODE : null,
      to.fg !== from.fg ? to.fg : null,
      to.bg !== from.bg ? to.bg : null,
    ].filter((code) => code !== null)

    return `${ESC}[${changed.join(';')}m`
  }

  // Styl obowiązujący tuż przed `index` (tylko wewnątrz otwartego bloku ```ansi).
  function stateBefore(source, index) {
    if (!isInsideAnsiFence(source, index)) return DEFAULT_STATE

    const before = source.slice(0, index)
    const region = before.slice(before.lastIndexOf(FENCE) + FENCE.length)
    const pattern = new RegExp(SGR_PATTERN.source, 'g')

    let state = DEFAULT_STATE
    let match = pattern.exec(region)

    while (match !== null) {
      state = applyCodesToState(state, match[1])
      match = pattern.exec(region)
    }

    return state
  }

  // Przepisuje zaznaczenie znak po znaku, dokładając `codesForChar(i)` do stylu, który
  // już tam jest. Dzięki temu pogrubienie + kolor + tło się łączą, a tekst za zaznaczeniem
  // zachowuje swój pierwotny styl (zwykły reset zdejmowałby też style zewnętrzne).
  function rewriteSelection(source, start, end, codesForChar) {
    const selected = source.slice(start, end)
    const pattern = new RegExp(SGR_PATTERN.source, 'g')

    let state = stateBefore(source, start)
    let emitted = state
    let out = ''
    let charIndex = 0
    let cursor = 0

    const writeText = (text) => {
      for (const char of Array.from(text)) {
        const codes = codesForChar(charIndex)
        const target = codes.length > 0 ? applyCodesToState(state, codes.join(';')) : state
        charIndex += 1
        out += `${transition(emitted, target)}${char}`
        emitted = target
      }
    }

    let match = pattern.exec(selected)

    while (match !== null) {
      writeText(selected.slice(cursor, match.index))
      state = applyCodesToState(state, match[1])
      cursor = match.index + match[0].length
      match = pattern.exec(selected)
    }

    writeText(selected.slice(cursor))

    // Jeśli tuż za zaznaczeniem jest reset, nie ma po co przywracać dawnego stylu.
    const resetFollows = /^\u001b\[0?m/.test(source.slice(end))

    return resetFollows ? out : `${out}${transition(emitted, state)}`
  }

  // Zaznaczenie obejmujące linie ```ansi / ``` nie ma kolorować samych znaczników bloku.
  function excludeFenceMarkers(source, start, end) {
    const selected = source.slice(start, end)
    const opening = selected.match(/^\s*```ansi\r?\n/)
    const closing = selected.slice(opening ? opening[0].length : 0).match(/\r?\n```\s*$/)

    return {
      start: start + (opening ? opening[0].length : 0),
      end: end - (closing ? closing[0].length : 0),
    }
  }

  // Wkleja `inner` w miejsce zaznaczenia (dokładając blok ```ansi poza blokiem) i zwraca
  // zaznaczenie obejmujące wstawiony fragment - dzięki temu od razu można nałożyć kolejny styl.
  function commitInner(source, start, end, inner, caretInInner) {
    let prefix = ''
    let suffix = ''

    if (!isInsideAnsiFence(source, start)) {
      const { leading, trailing } = fenceLayout(source, start, end)
      prefix = `${leading}${ANSI_FENCE_OPEN}`
      suffix = `\n${FENCE}${trailing}`
    }

    const innerStart = start + prefix.length

    return {
      value: `${source.slice(0, start)}${prefix}${inner}${suffix}${source.slice(end)}`,
      selectionStart: caretInInner === undefined ? innerStart : innerStart + caretInInner,
      selectionEnd: caretInInner === undefined ? innerStart + inner.length : innerStart + caretInInner,
    }
  }

  // Nakłada styl na zaznaczenie (łącząc go z istniejącym); poza blokiem ```ansi dodaje blok.
  // Zaznaczenie zostaje na zmienionym tekście. Przy pustym zaznaczeniu kursor ląduje
  // między sekwencją otwierającą a resetem.
  function applyToSelection(value, start, end, codes) {
    const source = String(value ?? '')

    if (start === end) {
      const open = `${ESC}[${codes.join(';')}m`
      return commitInner(source, start, end, `${open}${ESC}[${RESET_CODE}m`, open.length)
    }

    const range = excludeFenceMarkers(source, start, end)
    const inner = rewriteSelection(source, range.start, range.end, () => codes)

    return commitInner(source, range.start, range.end, inner)
  }

  // Wybiera kody kolorów dla kolejnych widocznych znaków (`visibleCount` sztuk).
  function effectCodesFor(effect, visibleCount) {
    const { codes, mode } = effect

    return Array.from({ length: visibleCount }, (_, index) => (
      mode === 'cycle'
        ? codes[index % codes.length]
        : codes[Math.floor((index * codes.length) / visibleCount)]
    ))
  }

  // Kod koloru dla każdego znaku; białe znaki dziedziczą kolor sąsiada, żeby nie mnożyć sekwencji.
  function effectCodesPerChar(plain, effect) {
    const chars = Array.from(plain)
    const visibleCount = chars.filter((char) => !/\s/.test(char)).length
    const colors = effectCodesFor(effect, visibleCount)

    let visibleIndex = 0
    let lastCode = colors[0]

    return chars.map((char) => {
      if (/\s/.test(char)) return lastCode

      lastCode = colors[visibleIndex]
      visibleIndex += 1
      return lastCode
    })
  }

  // Nakłada efekt kolorystyczny na zaznaczenie, zachowując pogrubienie, podkreślenie i tło.
  // Zwraca null, gdy efekt jest nieznany albo zaznaczenie nie zawiera widocznych znaków.
  function applyEffect(value, start, end, effectKey) {
    const effect = EFFECTS.find((entry) => entry.key === effectKey)
    const source = String(value ?? '')
    const range = excludeFenceMarkers(source, start, end)
    const plain = stripAnsi(source.slice(range.start, range.end))

    if (!effect || plain.trim() === '') return null

    const perChar = effectCodesPerChar(plain, effect)
    const inner = rewriteSelection(source, range.start, range.end, (index) => [perChar[index], ...(effect.extra ?? [])])

    return commitInner(source, range.start, range.end, inner)
  }

  // Wstawia pusty blok ```ansi (lub opakowuje w niego zaznaczenie).
  function insertFence(value, start, end) {
    const source = String(value ?? '')
    const selected = source.slice(start, end)
    const { leading, trailing } = fenceLayout(source, start, end)
    const prefix = `${leading}${ANSI_FENCE_OPEN}`
    const inserted = `${prefix}${selected}\n${FENCE}${trailing}`
    const caret = start + prefix.length + selected.length

    return {
      value: `${source.slice(0, start)}${inserted}${source.slice(end)}`,
      selectionStart: caret,
      selectionEnd: caret,
    }
  }

  function applyCodesToState(state, codesText) {
    const codes = codesText === '' ? [RESET_CODE] : codesText.split(';').map(Number)
    let next = { ...state }

    for (const code of codes) {
      if (code === RESET_CODE) {
        next = { fg: null, bg: null, bold: false, underline: false }
      } else if (code === BOLD_CODE) {
        next.bold = true
      } else if (code === UNDERLINE_CODE) {
        next.underline = true
      } else if (code >= 30 && code <= 37) {
        next.fg = code
      } else if (code >= 40 && code <= 47) {
        next.bg = code
      }
    }

    return next
  }

  function renderSpan(text, state) {
    if (!text) return ''

    const styles = []
    const fg = state.fg === null ? null : cssForCode(FOREGROUND_COLORS, state.fg)
    const bg = state.bg === null ? null : cssForCode(BACKGROUND_COLORS, state.bg)

    if (fg) styles.push(`color:${fg}`)
    if (bg) styles.push(`background-color:${bg}`)
    if (state.bold) styles.push('font-weight:700')
    if (state.underline) styles.push('text-decoration:underline')

    return styles.length > 0
      ? `<span class="ansi-span" style="${styles.join(';')}">${text}</span>`
      : text
  }

  // Wejście musi być już zabezpieczone przed HTML (escapeHtml) - tu powstają tylko <span>
  // ze stałymi kolorami z palet powyżej, więc wartości z tekstu nie trafiają do atrybutów.
  function toHtml(escapedText) {
    const text = String(escapedText ?? '')
    const pattern = new RegExp(SGR_PATTERN.source, 'g')

    let state = { fg: null, bg: null, bold: false, underline: false }
    let html = ''
    let cursor = 0
    let match = pattern.exec(text)

    while (match !== null) {
      html += renderSpan(text.slice(cursor, match.index), state)
      state = applyCodesToState(state, match[1])
      cursor = match.index + match[0].length
      match = pattern.exec(text)
    }

    html += renderSpan(text.slice(cursor), state)

    // Zabłąkane znaki ESC (np. niepełna sekwencja) nie mają wyświetlać się w podglądzie.
    return html.split(ESC).join('')
  }

  global.HusariaAnsi = {
    ESC,
    FOREGROUND_COLORS,
    BACKGROUND_COLORS,
    EFFECTS,
    BOLD_CODE,
    UNDERLINE_CODE,
    RESET_CODE,
    wrap,
    stripAnsi,
    isInsideAnsiFence,
    applyToSelection,
    applyEffect,
    insertFence,
    toHtml,
  }
})(window)
