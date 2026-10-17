// Wyszukiwanie standardowych emotek unicode (dane z emoji-data.js).
// Czysta logika bez DOM, żeby dało się ją testować w Node.
(function (global) {
  const DEFAULT_RESULT_LIMIT = 200
  const RECENT_STORAGE_KEY = 'husaria.recentUnicodeEmojis'
  const RECENT_LIMIT = 24

  const EMOJI_INDEX = 0
  const EN_NAME_INDEX = 1
  const PL_NAME_INDEX = 2
  const TAGS_INDEX = 3

  // "ł" nie rozkłada się w NFD, więc mapujemy je ręcznie obok usuwania akcentów.
  function normalizeQuery(value) {
    return String(value ?? '')
      .toLowerCase()
      .replace(/ł/g, 'l')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
  }

  function buildSearchText(item) {
    return normalizeQuery(`${item[EN_NAME_INDEX]} ${item[PL_NAME_INDEX]} ${item[TAGS_INDEX]}`)
  }

  // Buduje płaski indeks raz, żeby filtrowanie przy każdym znaku nie liczyło normalizacji od nowa.
  function buildIndex(groups) {
    return groups.flatMap((group) => group.items.map((item) => ({
      groupKey: group.key,
      item,
      text: buildSearchText(item),
    })))
  }

  function search(index, query, limit = DEFAULT_RESULT_LIMIT) {
    const terms = normalizeQuery(query).split(/\s+/).filter(Boolean)
    if (terms.length === 0) {
      return []
    }

    return index
      .filter((entry) => terms.every((term) => entry.text.includes(term)))
      .slice(0, limit)
      .map((entry) => entry.item)
  }

  function displayName(item, language) {
    const preferred = language === 'en' ? item[EN_NAME_INDEX] : item[PL_NAME_INDEX]
    return preferred || item[EN_NAME_INDEX] || item[PL_NAME_INDEX] || ''
  }

  function groupLabel(group, language) {
    return language === 'en' ? group.en : group.pl
  }

  // Zwraca nową listę "ostatnio użytych" - bez mutowania poprzedniej.
  function pushRecent(recent, emoji) {
    return [emoji, ...recent.filter((entry) => entry !== emoji)].slice(0, RECENT_LIMIT)
  }

  function loadRecent(storage) {
    try {
      const parsed = JSON.parse(storage?.getItem(RECENT_STORAGE_KEY) ?? '[]')
      return Array.isArray(parsed)
        ? parsed.filter((entry) => typeof entry === 'string').slice(0, RECENT_LIMIT)
        : []
    } catch {
      return []
    }
  }

  function saveRecent(storage, recent) {
    try {
      storage?.setItem(RECENT_STORAGE_KEY, JSON.stringify(recent))
    } catch {
      // localStorage może być zablokowany (tryb prywatny) - ostatnie emotki są tylko wygodą.
    }
  }

  global.HusariaEmojiSearch = {
    EMOJI_INDEX,
    normalizeQuery,
    buildIndex,
    search,
    displayName,
    groupLabel,
    pushRecent,
    loadRecent,
    saveRecent,
  }
})(window)
