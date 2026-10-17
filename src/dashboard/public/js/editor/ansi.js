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

  // Owija zaznaczenie sekwencją ANSI; poza blokiem ```ansi dodaje blok automatycznie.
  // Przy pustym zaznaczeniu kursor ląduje między sekwencją otwierającą a resetem.
  function applyToSelection(value, start, end, codes) {
    const source = String(value ?? '')
    const selected = source.slice(start, end)
    const open = `${ESC}[${codes.join(';')}m`
    const inner = `${open}${selected}${ESC}[${RESET_CODE}m`
    const insideFence = isInsideAnsiFence(source, start)

    let inserted = inner
    let caretOffset = selected ? inner.length : open.length

    if (!insideFence) {
      const { leading, trailing } = fenceLayout(source, start, end)
      const prefix = `${leading}${ANSI_FENCE_OPEN}`
      inserted = `${prefix}${inner}\n${FENCE}${trailing}`
      caretOffset = selected ? inserted.length : prefix.length + open.length
    }

    const caret = start + caretOffset

    return {
      value: `${source.slice(0, start)}${inserted}${source.slice(end)}`,
      selectionStart: caret,
      selectionEnd: caret,
    }
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
    BOLD_CODE,
    UNDERLINE_CODE,
    RESET_CODE,
    wrap,
    stripAnsi,
    isInsideAnsiFence,
    applyToSelection,
    insertFence,
    toHtml,
  }
})(window)
