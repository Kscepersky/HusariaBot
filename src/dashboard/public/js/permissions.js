/**
 * Panel uprawnien (tylko owner). Ladowany po app.js - korzysta z jego globalnych
 * helperow (fetchWithCsrf, showToast, formatTimestampInWarsaw) oraz z t() z runtime i18n.
 *
 * To wylacznie interfejs: kazda trasa /api/permissions/* jest chroniona po
 * stronie serwera (requireOwner), wiec ukrycie zakladki nie jest zabezpieczeniem.
 * Wszystkie dane od uzytkownikow (nicki) trafiaja do DOM przez textContent.
 */
(function initPermissionsSection(global) {
  'use strict'

  var SEARCH_DEBOUNCE_MS = 300
  var SEARCH_MIN_LENGTH = 2
  var AUDIT_PAGE_SIZE = 15

  /** Kolejnosc i podzial zakladek w edytorze. Nieznane sekcje trafiaja do pierwszej grupy. */
  var SECTION_GROUPS = [
    { titleKey: 'permissions.grupa_tresci', sections: ['embed-creator', 'scheduled-posts', 'sent-posts', 'events', 'g2-matches', 'image-library'] },
    { titleKey: 'permissions.grupa_ekonomia', sections: ['economy-leaderboard', 'shop'] },
    { titleKey: 'permissions.grupa_moderacja', sections: ['timeouts-system', 'ticket-history'] },
    { titleKey: 'permissions.grupa_statystyki', sections: ['server-stats'] },
  ]

  var AUDIT_ICONS = { grant: '➕', update: '✏️', revoke: '⛔', setting: '⚙️' }

  var assignableSections = []
  var entries = []
  var pendingUsers = []
  var lastRoleNames = {}
  var auditPage = 1
  var auditTotalPages = 1
  var searchTimerId = null
  var searchRequestId = 0

  function byId(id) {
    return document.getElementById(id)
  }

  function el(tag, options, children) {
    var node = document.createElement(tag)
    var opts = options || {}
    if (opts.className) node.className = opts.className
    if (opts.text !== undefined) node.textContent = opts.text
    if (opts.type) node.type = opts.type
    if (opts.title) node.title = opts.title
    if (opts.onClick) node.addEventListener('click', opts.onClick)
    ;(children || []).forEach(function (child) {
      if (child) node.appendChild(child)
    })
    return node
  }

  function displayName(user, fallbackId) {
    if (!user) return fallbackId
    return user.globalName || user.username || fallbackId
  }

  function avatarUrl(userId, avatarHash) {
    if (userId && avatarHash) {
      return 'https://cdn.discordapp.com/avatars/' + encodeURIComponent(userId) + '/' + encodeURIComponent(avatarHash) + '.png?size=96'
    }

    // Domyslny awatar Discorda zalezy od ID (nowy system nazw: (id >> 22) % 6).
    var index = 0
    try {
      index = Number((BigInt(userId) >> 22n) % 6n)
    } catch (error) {
      index = 0
    }
    return 'https://cdn.discordapp.com/embed/avatars/' + index + '.png'
  }

  function buildAvatar(userId, user, sizeClass) {
    var image = document.createElement('img')
    image.className = 'permissions-avatar' + (sizeClass ? ' ' + sizeClass : '')
    image.src = avatarUrl(userId, user && user.avatar)
    image.alt = ''
    image.loading = 'lazy'
    image.width = 40
    image.height = 40
    return image
  }

  function buildIdentity(userId, user, metaParts, sizeClass) {
    var meta = metaParts.filter(Boolean).join(' · ')
    return el('div', { className: 'permissions-identity' }, [
      buildAvatar(userId, user, sizeClass),
      el('div', { className: 'permissions-names' }, [
        el('span', { className: 'permissions-name', text: displayName(user, userId) }),
        el('span', { className: 'permissions-meta', text: meta, title: meta }),
      ]),
    ])
  }

  /** Etykiety i ikony zakladek biora sie z paska bocznego - jedno zrodlo tlumaczen. */
  function sectionLabel(section) {
    var label = document.querySelector('.sidebar-item[data-section="' + section + '"] [data-i18n]')
    return label ? label.textContent.trim() : section
  }

  function sectionIcon(section) {
    var icon = document.querySelector('.sidebar-item[data-section="' + section + '"] .sidebar-icon')
    return icon ? icon.textContent.trim() : ''
  }

  function sectionsSummary(sections) {
    if (!sections || sections.length === 0) return t('permissions.brak')
    return sections.map(sectionLabel).join(', ')
  }

  async function requestJson(url, options) {
    var response = await fetchWithCsrf(url, options)
    var body = await response.json().catch(function () { return {} })
    if (!response.ok) {
      throw new Error(body.error || t('permissions.blad_zapisu'))
    }
    return body
  }

  function buildEmptyState(icon, text, hint) {
    return el('div', { className: 'permissions-empty' }, [
      el('span', { className: 'permissions-empty-icon', text: icon }),
      el('strong', { text: text }),
      hint ? el('span', { text: hint }) : null,
    ])
  }

  // ─── Edytor sekcji uzytkownika ──────────────────────────────────────────────

  function groupedSections() {
    var placed = {}
    var groups = SECTION_GROUPS.map(function (group) {
      var sections = group.sections.filter(function (section) { return assignableSections.indexOf(section) !== -1 })
      sections.forEach(function (section) { placed[section] = true })
      return { titleKey: group.titleKey, sections: sections }
    })

    var leftovers = assignableSections.filter(function (section) { return !placed[section] })
    if (leftovers.length > 0 && groups.length > 0) {
      groups[0].sections = groups[0].sections.concat(leftovers)
    }

    return groups.filter(function (group) { return group.sections.length > 0 })
  }

  function buildPill(section, checked, onChange) {
    var input = document.createElement('input')
    input.type = 'checkbox'
    input.value = section
    input.checked = checked

    var pill = el('label', { className: 'permissions-pill' + (checked ? ' is-on' : '') }, [
      input,
      el('span', { text: sectionIcon(section) }),
      el('span', { text: sectionLabel(section) }),
    ])

    input.addEventListener('change', function () {
      pill.classList.toggle('is-on', input.checked)
      onChange()
    })

    return pill
  }

  function sameSelection(left, right) {
    if (left.length !== right.length) return false
    var sorted = right.slice().sort()
    return left.slice().sort().every(function (value, index) { return value === sorted[index] })
  }

  function buildUserCard(config) {
    var initial = config.sections.slice()
    var card = el('article', { className: 'permissions-card' + (config.isPending ? ' is-new' : '') })
    var badge = el('span', { className: 'permissions-badge' })
    var dirtyNote = el('span', { className: 'permissions-dirty-note', text: t('permissions.niezapisane_zmiany') })
    var saveButton = el('button', { className: 'btn-primary', type: 'button', text: t('permissions.zapisz') })
    var pills = []

    function selected() {
      return pills.filter(function (pill) { return pill.input.checked }).map(function (pill) { return pill.input.value })
    }

    function sync() {
      var current = selected()
      var dirty = !sameSelection(current, initial)
      badge.textContent = t('permissions.wybrano', { count: current.length, total: assignableSections.length })
      dirtyNote.hidden = !dirty
      card.classList.toggle('is-dirty', dirty && !config.isPending)
      saveButton.disabled = !dirty || current.length === 0
    }

    function setAll(value) {
      pills.forEach(function (pill) {
        pill.input.checked = value
        pill.node.classList.toggle('is-on', value)
      })
      sync()
    }

    var groupNodes = groupedSections().map(function (group) {
      var pillNodes = group.sections.map(function (section) {
        var node = buildPill(section, initial.indexOf(section) !== -1, sync)
        pills.push({ node: node, input: node.querySelector('input') })
        return node
      })

      return el('div', { className: 'permissions-group' }, [
        el('span', { className: 'permissions-group-title', text: t(group.titleKey) }),
        el('div', { className: 'permissions-pills' }, pillNodes),
      ])
    })

    var metaParts = [
      config.user && config.user.username ? '@' + config.user.username : null,
      config.userId,
      config.isPending ? null : t('permissions.nadal', { name: displayName(config.grantedByUser, config.grantedBy) }),
    ]

    var footerButtons = [
      el('button', { className: 'btn-secondary', type: 'button', text: t('permissions.zaznacz_wszystko'), onClick: function () { setAll(true) } }),
      el('button', { className: 'btn-secondary', type: 'button', text: t('permissions.wyczysc'), onClick: function () { setAll(false) } }),
      el('span', { className: 'permissions-foot-spacer' }),
      dirtyNote,
    ]

    if (config.isPending) {
      footerButtons.push(el('button', {
        className: 'btn-secondary',
        type: 'button',
        text: t('permissions.anuluj'),
        onClick: function () {
          pendingUsers = pendingUsers.filter(function (user) { return user.id !== config.userId })
          renderList()
        },
      }))
    } else {
      footerButtons.push(el('button', {
        className: 'btn-danger',
        type: 'button',
        text: t('permissions.odbierz_dostep'),
        onClick: async function () {
          if (!global.confirm(t('permissions.potwierdz_odebranie'))) return
          try {
            await requestJson('/api/permissions/users/' + encodeURIComponent(config.userId), { method: 'DELETE' })
            showToast(t('permissions.odebrano'), 'success')
            await refreshAll()
          } catch (error) {
            showToast(error.message, 'error')
          }
        },
      }))
    }
    footerButtons.push(saveButton)

    saveButton.addEventListener('click', async function () {
      var sections = selected()
      if (sections.length === 0) {
        showToast(t('permissions.wybierz_sekcje'), 'error')
        return
      }

      saveButton.disabled = true
      try {
        await requestJson('/api/permissions/users/' + encodeURIComponent(config.userId), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sections: sections }),
        })
        showToast(t('permissions.zapisano'), 'success')
        pendingUsers = pendingUsers.filter(function (user) { return user.id !== config.userId })
        await refreshAll()
      } catch (error) {
        showToast(error.message, 'error')
        sync()
      }
    })

    card.appendChild(el('div', { className: 'permissions-card-head' }, [
      buildIdentity(config.userId, config.user, metaParts, 'permissions-avatar-lg'),
      badge,
    ]))
    groupNodes.forEach(function (node) { card.appendChild(node) })
    card.appendChild(el('div', { className: 'permissions-card-foot' }, footerButtons))

    sync()
    return card
  }

  function renderList() {
    var list = byId('permissions-list')
    if (!list) return
    list.replaceChildren()

    pendingUsers.forEach(function (user) {
      list.appendChild(buildUserCard({ userId: user.id, user: user, sections: [], isPending: true }))
    })

    entries.forEach(function (entry) {
      list.appendChild(buildUserCard({
        userId: entry.userId,
        user: entry.user,
        sections: entry.sections,
        grantedBy: entry.grantedBy,
        grantedByUser: entry.grantedByUser,
        isPending: false,
      }))
    })

    if (pendingUsers.length === 0 && entries.length === 0) {
      list.appendChild(buildEmptyState('👥', t('permissions.brak_uzytkownikow'), t('permissions.pusta_lista_opis')))
    }

    var count = byId('permissions-count')
    if (count) count.textContent = String(entries.length)
  }

  // ─── Wyszukiwarka ───────────────────────────────────────────────────────────

  function buildSearchAction(member, user) {
    if (member.isOwner) {
      return el('span', { className: 'permissions-badge permissions-badge-owner', text: '👑 ' + t('permissions.owner') })
    }

    var alreadyPending = pendingUsers.some(function (pending) { return pending.id === member.id })
    if (member.hasAccess || alreadyPending) {
      return el('span', { className: 'permissions-badge permissions-badge-ok', text: '✓ ' + t('permissions.ma_dostep') })
    }

    return el('button', {
      className: 'btn-primary',
      type: 'button',
      text: t('permissions.dodaj'),
      onClick: function () {
        pendingUsers = [user].concat(pendingUsers)
        byId('permissions-search').value = ''
        byId('permissions-search-results').replaceChildren()
        renderList()
        var first = byId('permissions-list').firstElementChild
        if (first && first.scrollIntoView) first.scrollIntoView({ behavior: 'smooth', block: 'center' })
      },
    })
  }

  function renderSearchResults(members) {
    var container = byId('permissions-search-results')
    if (!container) return
    container.replaceChildren()

    if (members.length === 0) {
      container.appendChild(buildEmptyState('🔍', t('permissions.brak_wynikow')))
      return
    }

    members.forEach(function (member) {
      var user = { id: member.id, username: member.username, globalName: member.globalName, avatar: member.avatar || null }
      var meta = ['@' + member.username, member.nick && member.nick !== displayName(user, member.id) ? member.nick : null, member.id]

      container.appendChild(el('article', { className: 'permissions-row' }, [
        buildIdentity(member.id, user, meta),
        buildSearchAction(member, user),
      ]))
    })
  }

  async function runSearch(query) {
    var requestId = ++searchRequestId
    var container = byId('permissions-search-results')
    container.replaceChildren(el('p', { className: 'permissions-hint', text: t('permissions.szukam') }))

    try {
      var body = await requestJson('/api/permissions/members?q=' + encodeURIComponent(query))
      // Odpowiedz starszego zapytania nie moze nadpisac nowszej.
      if (requestId === searchRequestId) renderSearchResults(body.members || [])
    } catch (error) {
      if (requestId === searchRequestId) {
        container.replaceChildren()
        showToast(error.message, 'error')
      }
    }
  }

  function bindSearch() {
    var input = byId('permissions-search')
    if (!input) return

    input.addEventListener('input', function () {
      global.clearTimeout(searchTimerId)
      var query = input.value.trim()
      if (query.length < SEARCH_MIN_LENGTH) {
        searchRequestId++
        var container = byId('permissions-search-results')
        container.replaceChildren()
        if (query.length > 0) {
          container.appendChild(el('p', { className: 'permissions-hint', text: t('permissions.wpisz_nick') }))
        }
        return
      }
      searchTimerId = global.setTimeout(function () { runSearch(query) }, SEARCH_DEBOUNCE_MS)
    })
  }

  // ─── Rola supportu ──────────────────────────────────────────────────────────

  function renderSupportRole(settings) {
    var select = byId('permissions-support-role')
    if (!select) return
    select.replaceChildren()

    var none = document.createElement('option')
    none.value = ''
    none.textContent = t('permissions.brak_roli')
    select.appendChild(none)

    settings.roles.forEach(function (role) {
      var option = document.createElement('option')
      option.value = role.id
      option.textContent = role.name
      select.appendChild(option)
    })

    select.value = settings.supportRoleId || ''
  }

  function bindSupportRole() {
    var button = byId('permissions-support-role-save')
    if (!button) return

    button.addEventListener('click', async function () {
      button.disabled = true
      try {
        var value = byId('permissions-support-role').value
        await requestJson('/api/permissions/settings/support-role', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roleId: value === '' ? null : value }),
        })
        showToast(t('permissions.zapisano_role'), 'success')
        await loadAudit()
      } catch (error) {
        showToast(error.message, 'error')
      } finally {
        button.disabled = false
      }
    })
  }

  // ─── Log audytowy ───────────────────────────────────────────────────────────

  function auditMessage(entry, users) {
    function who(id) {
      return displayName(users[id], id)
    }

    if (entry.action === 'setting') {
      var show = function (values) { return values.length ? (lastRoleNames[values[0]] || values[0]) : t('permissions.brak') }
      return t('permissions.audyt_setting', { actor: who(entry.actorId), before: show(entry.before), after: show(entry.after) })
    }

    return t('permissions.audyt_' + entry.action, {
      actor: who(entry.actorId),
      target: who(entry.targetId),
      before: sectionsSummary(entry.before),
      after: sectionsSummary(entry.after),
    })
  }

  function renderAudit(result) {
    var list = byId('permissions-audit-list')
    if (!list) return
    list.replaceChildren()

    if (result.entries.length === 0) {
      list.appendChild(buildEmptyState('📜', t('permissions.brak_wpisow_audytu')))
    }

    var users = result.users || {}
    result.entries.forEach(function (entry) {
      var action = AUDIT_ICONS[entry.action] ? entry.action : 'update'
      var timestamp = formatTimestampInWarsaw(entry.createdAt)

      list.appendChild(el('article', { className: 'permissions-audit-row is-' + action }, [
        buildAvatar(entry.actorId, users[entry.actorId], 'permissions-avatar-sm'),
        el('span', { text: AUDIT_ICONS[action] }),
        el('span', { className: 'permissions-audit-text', text: auditMessage(entry, users) }),
        el('span', { className: 'permissions-audit-time', text: timestamp, title: timestamp }),
      ]))
    })

    auditPage = result.page
    auditTotalPages = result.totalPages
    byId('permissions-audit-pagination').hidden = result.totalPages <= 1
    byId('permissions-audit-page-label').textContent = t('permissions.strona', { page: result.page, total: result.totalPages })
    byId('permissions-audit-prev-btn').disabled = result.page <= 1
    byId('permissions-audit-next-btn').disabled = result.page >= result.totalPages
  }

  async function loadAudit() {
    try {
      var result = await requestJson('/api/permissions/audit?page=' + auditPage + '&pageSize=' + AUDIT_PAGE_SIZE)
      renderAudit(result)
    } catch (error) {
      showToast(error.message || t('permissions.blad_ladowania'), 'error')
    }
  }

  function bindAuditPagination() {
    byId('permissions-audit-prev-btn')?.addEventListener('click', function () {
      if (auditPage > 1) { auditPage--; void loadAudit() }
    })
    byId('permissions-audit-next-btn')?.addEventListener('click', function () {
      if (auditPage < auditTotalPages) { auditPage++; void loadAudit() }
    })
  }

  // ─── Ladowanie ──────────────────────────────────────────────────────────────

  async function refreshAll() {
    try {
      var results = await Promise.all([
        requestJson('/api/permissions'),
        requestJson('/api/permissions/settings'),
      ])
      assignableSections = results[0].assignableSections || []
      entries = results[0].entries || []
      lastRoleNames = {}
      results[1].roles.forEach(function (role) { lastRoleNames[role.id] = role.name })

      renderList()
      renderSupportRole(results[1])
      await loadAudit()
    } catch (error) {
      showToast(error.message || t('permissions.blad_ladowania'), 'error')
    }
  }

  var bound = false

  global.loadPermissionsSection = async function loadPermissionsSection() {
    if (!bound) {
      bound = true
      bindSearch()
      bindSupportRole()
      bindAuditPagination()
      byId('permissions-refresh-btn')?.addEventListener('click', function () { void refreshAll() })
      // Zmiana jezyka przerysowuje etykiety zbudowane w JS.
      global.I18n.onLanguageChange(function () {
        if (byId('section-permissions')?.classList.contains('active')) renderList()
      })
    }
    auditPage = 1
    await refreshAll()
  }
})(window)
