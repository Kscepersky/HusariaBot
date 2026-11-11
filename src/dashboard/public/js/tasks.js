/**
 * Zakladka "Taski". Ladowana po app.js - korzysta z jego globalnych helperow
 * (fetchWithCsrf, showToast, formatTimestampInWarsaw, switchSection) oraz z t() z runtime i18n.
 *
 * To wylacznie interfejs: kazda trasa /api/tasks/* sprawdza uprawnienia po stronie
 * serwera (sekcja + reguly per task). Wszystkie dane od uzytkownikow (tytuly, opisy,
 * nicki) trafiaja do DOM przez textContent - nigdy przez innerHTML.
 */
(function initTasksSection(global) {
  'use strict'

  var PENDING_LINK_KEY = 'husaria.pendingTaskLink'
  var DEEP_LINK_PATTERN = /^#tasks?(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?$/
  var ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
  var MAX_FILE_BYTES = 8 * 1024 * 1024
  var HISTORY_PAGE_SIZE = 15
  var SEARCH_DEBOUNCE_MS = 300
  var LOCAL_FILTER_DEBOUNCE_MS = 120
  var SKELETON_COUNT = 3
  var DAY_MS = 24 * 60 * 60 * 1000
  var PRIORITY_ICONS = { high: '🔴', normal: '🟡', low: '🟢' }
  var EXCERPT_LENGTH = 200

  var meta = null
  var scope = 'mine'
  var tasks = []
  var users = {}
  var filters = { search: '', priority: 'all', assignee: '', overdueOnly: false }
  var history = { page: 1, totalPages: 1, status: 'done' }
  var pendingTaskId = null
  var editingTask = null
  var completingTask = null
  var detailTaskId = null
  var searchTimerId = null
  var listRequestId = 0
  var detailRequestId = 0
  var hasLoadedOnce = false
  var formPicker = null
  var completePicker = null

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
    if (opts.label) node.setAttribute('aria-label', opts.label)
    if (opts.onClick) node.addEventListener('click', opts.onClick)
    ;(children || []).forEach(function (child) {
      if (child) node.appendChild(child)
    })
    return node
  }

  async function requestJson(url, options) {
    var response = await fetchWithCsrf(url, options)
    if (response.status === 401) {
      global.location.href = '/auth/login'
      throw new Error(t('tasks.blad_ladowania'))
    }
    var body = await response.json().catch(function () { return {} })
    if (!response.ok) {
      throw new Error(body.error || t('tasks.blad_zapisu'))
    }
    return body
  }

  function sendJson(url, method, payload) {
    return requestJson(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  // ─── Uzytkownicy ────────────────────────────────────────────────────────────

  function userById(id) {
    if (!id) return null
    if (users[id]) return users[id]
    var fromMeta = meta && meta.assignees.find(function (user) { return user.id === id })
    return fromMeta || null
  }

  function displayName(id) {
    var user = userById(id)
    return (user && (user.globalName || user.username)) || id || '?'
  }

  function avatarUrl(userId) {
    var user = userById(userId)
    if (userId && user && user.avatar) {
      return 'https://cdn.discordapp.com/avatars/' + encodeURIComponent(userId) + '/' + encodeURIComponent(user.avatar) + '.png?size=64'
    }
    var index = 0
    try {
      index = Number((BigInt(userId) >> 22n) % 6n)
    } catch (error) {
      index = 0
    }
    return 'https://cdn.discordapp.com/embed/avatars/' + index + '.png'
  }

  function buildAvatar(userId, size) {
    if (!userId) {
      return el('span', { className: 'tasks-avatar tasks-avatar-all is-' + size, text: '👥' })
    }
    var image = document.createElement('img')
    image.className = 'tasks-avatar is-' + size
    image.src = avatarUrl(userId)
    image.alt = ''
    image.loading = 'lazy'
    return image
  }

  function buildPerson(userId, prefix) {
    return el('span', { className: 'tasks-person' }, [
      buildAvatar(userId, 'sm'),
      el('span', { text: (prefix ? prefix + ' ' : '') + (userId ? displayName(userId) : t('tasks.wszyscy')) }),
    ])
  }

  // ─── Formatowanie ───────────────────────────────────────────────────────────

  function priorityLabel(priority) {
    return (PRIORITY_ICONS[priority] || '') + ' ' + t('tasks.priorytet_' + priority)
  }

  function isOverdue(task) {
    return task.status === 'open' && task.dueAt !== null && task.dueAt < Date.now()
  }

  function shortDate(epochMs) {
    var language = global.I18n && global.I18n.getLanguage ? global.I18n.getLanguage() : 'pl'
    return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'pl-PL', {
      timeZone: 'Europe/Warsaw',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(epochMs)
  }

  /** Termin jako krotki, wzgledny opis ("Jutro, 13.11 10:00", "3 d po terminie"). */
  function describeDue(task) {
    var diff = task.dueAt - Date.now()
    if (task.status === 'open' && diff < 0) {
      var overdueDays = Math.floor(-diff / DAY_MS)
      return overdueDays >= 1 ? t('tasks.termin_po_dni', { days: overdueDays }) : t('tasks.po_terminie')
    }
    var date = shortDate(task.dueAt)
    if (task.status !== 'open') return date
    var days = Math.floor(diff / DAY_MS)
    if (days === 0) return t('tasks.termin_dzis', { date: date })
    if (days === 1) return t('tasks.termin_jutro', { date: date })
    return t('tasks.termin_za_dni', { days: days, date: date })
  }

  function buildChip(className, text, title) {
    return el('span', { className: 'tasks-chip ' + className, text: text, title: title })
  }

  function buildDueChip(task) {
    if (task.dueAt === null) return null
    var overdue = isOverdue(task)
    var soon = !overdue && task.status === 'open' && task.dueAt - Date.now() < DAY_MS
    return buildChip('is-due' + (overdue ? ' is-overdue' : soon ? ' is-soon' : ''), (overdue ? '⚠️ ' : '⏰ ') + describeDue(task), formatTimestampInWarsaw(task.dueAt))
  }

  function toLocalInputValue(epochMs) {
    if (epochMs === null || epochMs === undefined) return ''
    var date = new Date(epochMs)
    var pad = function (value) { return String(value).padStart(2, '0') }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes())
  }

  function fromLocalInputValue(value) {
    if (!value) return null
    var timestamp = new Date(value).getTime()
    return Number.isFinite(timestamp) ? timestamp : null
  }

  function excerpt(text) {
    var flat = String(text || '').replace(/\s+/g, ' ').trim()
    return flat.length > EXCERPT_LENGTH ? flat.slice(0, EXCERPT_LENGTH).trimEnd() + '…' : flat
  }

  // ─── Wybor zalacznikow (plik, drag & drop, Ctrl+V) ─────────────────────────

  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader()
      reader.onload = function () { resolve(String(reader.result)) }
      reader.onerror = function () { reject(reader.error) }
      reader.readAsDataURL(file)
    })
  }

  function createPicker(prefix) {
    var dropzone = byId(prefix + '-dropzone')
    var input = byId(prefix + '-files')
    var thumbs = byId(prefix + '-thumbs')
    var files = []

    function maxFiles() {
      return (meta && meta.limits && meta.limits.maxAttachments) || 5
    }

    function render() {
      files.forEach(function (item) { if (item.url) URL.revokeObjectURL(item.url) })
      thumbs.replaceChildren()
      files.forEach(function (item, index) {
        item.url = URL.createObjectURL(item.file)
        var image = document.createElement('img')
        image.src = item.url
        image.alt = item.file.name || ''
        thumbs.appendChild(el('div', { className: 'tasks-thumb' }, [
          image,
          el('button', {
            className: 'tasks-thumb-remove',
            type: 'button',
            text: '×',
            title: t('tasks.usun_zdjecie'),
            label: t('tasks.usun_zdjecie'),
            onClick: function () {
              files = files.filter(function (_, position) { return position !== index })
              render()
            },
          }),
        ]))
      })
      dropzone.classList.toggle('has-files', files.length > 0)
    }

    function add(fileList) {
      Array.prototype.forEach.call(fileList || [], function (file) {
        if (ALLOWED_TYPES.indexOf(file.type) === -1) {
          showToast(t('tasks.zly_typ_pliku'), 'error')
          return
        }
        if (file.size > MAX_FILE_BYTES) {
          showToast(t('tasks.plik_za_duzy'), 'error')
          return
        }
        if (files.length >= maxFiles()) {
          showToast(t('tasks.za_duzo_zdjec', { max: maxFiles() }), 'error')
          return
        }
        files.push({ file: file, url: null })
      })
      render()
    }

    dropzone.addEventListener('click', function () { input.click() })
    dropzone.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        input.click()
      }
    })
    input.addEventListener('change', function () {
      add(input.files)
      input.value = ''
    })
    dropzone.addEventListener('dragover', function (event) {
      event.preventDefault()
      dropzone.classList.add('is-dragover')
    })
    dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('is-dragover') })
    dropzone.addEventListener('drop', function (event) {
      event.preventDefault()
      dropzone.classList.remove('is-dragover')
      add(event.dataTransfer && event.dataTransfer.files)
    })

    return {
      add: add,
      reset: function () {
        files = []
        render()
      },
      toUploads: function () {
        return Promise.all(files.map(async function (item) {
          return { mimeType: item.file.type, dataBase64: await readAsDataUrl(item.file) }
        }))
      },
    }
  }

  function bindPaste(dialog, getPicker) {
    dialog.addEventListener('paste', function (event) {
      var picker = getPicker()
      var pasted = event.clipboardData && event.clipboardData.files
      if (!picker || !pasted || pasted.length === 0) return
      event.preventDefault()
      picker.add(pasted)
    })
  }

  function bindCounter(inputId, counterId) {
    var input = byId(inputId)
    var counter = byId(counterId)
    var max = input.maxLength
    function update() { counter.textContent = input.value.length + '/' + max }
    input.addEventListener('input', update)
    return update
  }

  // ─── Lista ──────────────────────────────────────────────────────────────────

  function statusBadge(task) {
    if (task.status === 'done') return buildChip('is-done', '✅ ' + t('tasks.status_done'))
    if (task.status === 'deleted') return buildChip('is-deleted', '🗑️ ' + t('tasks.status_deleted'))
    return null
  }

  function iconButton(icon, label, className, onClick) {
    return el('button', {
      className: 'tasks-icon-btn ' + className,
      type: 'button',
      text: icon,
      title: label,
      label: label,
      onClick: function (event) {
        event.stopPropagation()
        onClick()
      },
    })
  }

  function buildCardActions(task) {
    var actions = []
    if (task.permissions.canComplete) {
      actions.push(el('button', {
        className: 'btn-primary tasks-complete-btn',
        type: 'button',
        text: '✅ ' + t('tasks.ukonczono'),
        onClick: function (event) {
          event.stopPropagation()
          openComplete(task)
        },
      }))
    }
    if (task.permissions.canEdit) {
      actions.push(iconButton('✏️', t('tasks.edytuj'), '', function () { openForm(task) }))
      actions.push(iconButton('🗑️', t('tasks.usun'), 'is-danger', function () { void removeTask(task) }))
    }
    return actions.length > 0 ? el('div', { className: 'tasks-card-actions' }, actions) : null
  }

  function buildCardFooter(task) {
    var showAssignee = scope === 'history'
    var parts = []

    if (showAssignee || task.assigneeId === null) parts.push(buildPerson(task.assigneeId, '→'))

    if (task.status === 'done') {
      parts.push(el('span', { className: 'tasks-meta', text: t('tasks.ukonczyl', { name: displayName(task.completedBy), date: formatTimestampInWarsaw(task.completedAt) }) }))
    } else if (task.status === 'deleted') {
      parts.push(el('span', { className: 'tasks-meta', text: t('tasks.usunal', { name: displayName(task.deletedBy), date: formatTimestampInWarsaw(task.deletedAt) }) }))
    } else {
      parts.push(el('span', { className: 'tasks-meta', text: t('tasks.dodal', { name: displayName(task.creatorId), date: shortDate(task.createdAt) }) }))
    }

    return el('div', { className: 'tasks-card-foot' }, parts)
  }

  function buildCard(task) {
    var chips = [
      buildChip('is-priority is-' + task.priority, priorityLabel(task.priority)),
      buildDueChip(task),
      task.attachments.length > 0 ? buildChip('is-attachments', '📎 ' + task.attachments.length) : null,
      statusBadge(task),
    ]

    var card = el('article', { className: 'tasks-card is-' + task.priority + (isOverdue(task) ? ' is-overdue' : '') + (task.status !== 'open' ? ' is-closed' : '') }, [
      el('div', { className: 'tasks-card-main' }, [
        el('div', { className: 'tasks-chips-row' }, chips),
        el('h3', { className: 'tasks-title', text: task.title }),
        task.description ? el('p', { className: 'tasks-excerpt', text: excerpt(task.description) }) : null,
        task.status === 'done' && task.completionNote
          ? el('p', { className: 'tasks-note', text: task.completionNote })
          : null,
        buildCardFooter(task),
      ]),
      buildCardActions(task),
    ])

    card.tabIndex = 0
    card.setAttribute('role', 'button')
    card.setAttribute('aria-label', task.title)
    card.addEventListener('click', function (event) {
      if (event.target.closest('button')) return
      void openDetail(task.id)
    })
    card.addEventListener('keydown', function (event) {
      if (event.target !== card) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        void openDetail(task.id)
      }
    })
    return card
  }

  function buildSkeletons() {
    var nodes = []
    for (var index = 0; index < SKELETON_COUNT; index += 1) {
      nodes.push(el('div', { className: 'tasks-card tasks-skeleton' }, [
        el('span', { className: 'tasks-skeleton-line is-short' }),
        el('span', { className: 'tasks-skeleton-line is-title' }),
        el('span', { className: 'tasks-skeleton-line' }),
      ]))
    }
    return nodes
  }

  function visibleTasks() {
    if (scope === 'history') return tasks

    var query = filters.search.toLowerCase()
    return tasks.filter(function (task) {
      if (filters.priority !== 'all' && task.priority !== filters.priority) return false
      if (filters.overdueOnly && !isOverdue(task)) return false
      if (scope === 'open' && filters.assignee) {
        if (filters.assignee === 'all' ? task.assigneeId !== null : task.assigneeId !== filters.assignee) return false
      }
      if (query && (task.title + ' ' + task.description).toLowerCase().indexOf(query) === -1) return false
      return true
    })
  }

  function hasActiveFilters() {
    return Boolean(filters.search || filters.assignee || filters.overdueOnly || (scope !== 'history' && filters.priority !== 'all'))
  }

  function buildEmptyState() {
    var filtered = hasActiveFilters()
    var icon = filtered ? '🔍' : scope === 'history' ? '📜' : '🎉'
    var key = filtered ? 'tasks.brak_wynikow' : scope === 'history' ? 'tasks.pusta_historia' : scope === 'open' ? 'tasks.brak_otwartych' : 'tasks.brak_moich'
    var children = [
      el('span', { className: 'tasks-empty-icon', text: icon }),
      el('strong', { text: t(key) }),
    ]
    if (filtered) {
      children.push(el('button', { className: 'btn-secondary', type: 'button', text: t('tasks.wyczysc_filtry'), onClick: clearFilters }))
    } else if (scope !== 'history') {
      children.push(el('button', { className: 'btn-primary', type: 'button', text: t('tasks.dodaj_pierwszy'), onClick: function () { openForm(null) } }))
    }
    return el('div', { className: 'tasks-empty' }, children)
  }

  function buildGroupHeader(assigneeId, count) {
    return el('div', { className: 'tasks-group-head' }, [
      buildAvatar(assigneeId, 'md'),
      el('strong', { text: assigneeId ? displayName(assigneeId) : t('tasks.wszyscy') }),
      el('span', { className: 'tasks-group-count', text: String(count) }),
    ])
  }

  function renderGrouped(list, visible) {
    var order = []
    var groups = {}
    visible.forEach(function (task) {
      var key = task.assigneeId || 'all'
      if (!groups[key]) {
        groups[key] = []
        order.push(key)
      }
      groups[key].push(task)
    })
    // "Wszyscy" zawsze na gorze, reszta w kolejnosci pierwszego (najwazniejszego) taska.
    order.sort(function (left, right) { return Number(left !== 'all') - Number(right !== 'all') })

    order.forEach(function (key) {
      list.appendChild(el('section', { className: 'tasks-group' }, [
        buildGroupHeader(key === 'all' ? null : key, groups[key].length),
        el('div', { className: 'tasks-group-list' }, groups[key].map(buildCard)),
      ]))
    })
  }

  function renderList() {
    var list = byId('tasks-list')
    if (!list) return
    list.replaceChildren()
    list.removeAttribute('aria-busy')

    var visible = visibleTasks()
    if (visible.length === 0) {
      list.appendChild(buildEmptyState())
    } else if (scope === 'open') {
      renderGrouped(list, visible)
    } else {
      visible.forEach(function (task) { list.appendChild(buildCard(task)) })
    }

    var pagination = byId('tasks-pagination')
    pagination.hidden = scope !== 'history' || history.totalPages <= 1
    byId('tasks-page-label').textContent = t('tasks.strona', { page: history.page, total: history.totalPages })
    byId('tasks-prev-btn').disabled = history.page <= 1
    byId('tasks-next-btn').disabled = history.page >= history.totalPages
  }

  function renderLoading() {
    var list = byId('tasks-list')
    list.setAttribute('aria-busy', 'true')
    list.replaceChildren.apply(list, buildSkeletons())
  }

  function renderCounts(counts) {
    if (!counts) return
    byId('tasks-count-mine').textContent = String(counts.mine)
    byId('tasks-count-open').textContent = String(counts.open)
    byId('tasks-count-overdue').textContent = String(counts.overdue || 0)
    byId('tasks-stat-overdue').classList.toggle('has-overdue', (counts.overdue || 0) > 0)
  }

  function buildListUrl() {
    if (scope !== 'history') return '/api/tasks?scope=' + scope
    var params = new URLSearchParams({
      scope: 'history',
      page: String(history.page),
      pageSize: String(HISTORY_PAGE_SIZE),
      status: history.status,
    })
    if (filters.search) params.set('search', filters.search)
    if (filters.assignee) params.set('assignee', filters.assignee)
    return '/api/tasks?' + params.toString()
  }

  async function loadList(options) {
    var requestId = ++listRequestId
    // Przy odswiezeniu w tle zostawiamy stara liste zamiast migajacych szkieletow.
    if (!hasLoadedOnce || (options && options.showSkeleton)) renderLoading()
    try {
      var body = await requestJson(buildListUrl())
      if (requestId !== listRequestId) return
      tasks = body.tasks || []
      users = Object.assign({}, users, body.users || {})
      if (body.pagination) {
        history.page = body.pagination.page
        history.totalPages = body.pagination.totalPages
      }
      hasLoadedOnce = true
      renderCounts(body.counts)
      renderList()
    } catch (error) {
      if (requestId === listRequestId) {
        renderList()
        showToast(error.message || t('tasks.blad_ladowania'), 'error')
      }
    }
  }

  // ─── Zakladki i filtry ──────────────────────────────────────────────────────

  function syncFilterControls() {
    var isHistory = scope === 'history'
    byId('tasks-filter-assignee').hidden = scope === 'mine'
    byId('tasks-filter-status').hidden = !isHistory
    byId('tasks-priority-chips').hidden = isHistory

    document.querySelectorAll('[data-tasks-scope]').forEach(function (control) {
      var active = control.dataset.tasksScope === scope && !(control.classList.contains('tasks-stat') && filters.overdueOnly)
      control.classList.toggle('is-active', active)
      if (control.getAttribute('role') === 'tab') control.setAttribute('aria-selected', String(active))
    })
    byId('tasks-stat-overdue').classList.toggle('is-active', filters.overdueOnly && scope === 'open')

    document.querySelectorAll('[data-tasks-priority]').forEach(function (chip) {
      chip.classList.toggle('is-active', chip.dataset.tasksPriority === filters.priority)
    })
    byId('tasks-filter-assignee').value = filters.assignee
    byId('tasks-filter-status').value = history.status
  }

  function clearFilters() {
    filters = { search: '', priority: 'all', assignee: '', overdueOnly: false }
    byId('tasks-search').value = ''
    syncFilterControls()
    if (scope === 'history') {
      history.page = 1
      void loadList({ showSkeleton: true })
    } else {
      renderList()
    }
  }

  function setScope(nextScope, options) {
    var previous = scope
    scope = nextScope
    filters.overdueOnly = Boolean(options && options.overdueOnly)
    // Filtr osoby ma inne znaczenie w historii (serwer) niz na liscie otwartych (klient).
    if (previous !== scope && (previous === 'history' || scope === 'history')) filters.assignee = ''
    if (scope === 'history') history.page = 1
    syncFilterControls()
    tasks = []
    void loadList({ showSkeleton: true })
  }

  // ─── Formularz (nowy / edycja) ──────────────────────────────────────────────

  function fillAssigneeSelect(select, includeAnyOption) {
    select.replaceChildren()
    if (includeAnyOption) {
      var any = document.createElement('option')
      any.value = ''
      any.textContent = t('tasks.kazda_osoba')
      select.appendChild(any)
    }
    var all = document.createElement('option')
    all.value = includeAnyOption ? 'all' : ''
    all.textContent = '👥 ' + t('tasks.wszyscy')
    select.appendChild(all)

    ;(meta ? meta.assignees : []).forEach(function (user) {
      var option = document.createElement('option')
      option.value = user.id
      option.textContent = (user.globalName || user.username || user.id) + (meta.me.id === user.id ? ' (' + t('tasks.ty') + ')' : '')
      select.appendChild(option)
    })
  }

  function selectedPriority() {
    var checked = document.querySelector('input[name="task-priority"]:checked')
    return checked ? checked.value : 'normal'
  }

  function setPriority(priority) {
    var radio = document.querySelector('input[name="task-priority"][value="' + priority + '"]')
    if (radio) radio.checked = true
  }

  var updateTitleCounter = function () {}
  var updateDescriptionCounter = function () {}
  var updateNoteCounter = function () {}

  function openForm(task) {
    editingTask = task || null
    var dialog = byId('task-form-dialog')
    fillAssigneeSelect(byId('task-form-assignee'), false)

    byId('task-form-heading').textContent = task ? t('tasks.edycja_taska') : t('tasks.nowy_task')
    byId('task-form-title').value = task ? task.title : ''
    byId('task-form-description').value = task ? task.description : ''

    // Osoba, ktora stracila dostep, nie ma jej na liscie - bez tej opcji select spadlby
    // na "Wszyscy" i zapis po cichu przepialby task na cala administracje.
    var assigneeSelect = byId('task-form-assignee')
    if (task && task.assigneeId && !Array.prototype.some.call(assigneeSelect.options, function (option) { return option.value === task.assigneeId })) {
      var current = document.createElement('option')
      current.value = task.assigneeId
      current.textContent = displayName(task.assigneeId)
      assigneeSelect.appendChild(current)
    }
    assigneeSelect.value = task ? (task.assigneeId || '') : (meta ? meta.me.id : '')
    setPriority(task ? task.priority : 'normal')
    byId('task-form-due').value = task ? toLocalInputValue(task.dueAt) : ''
    // Zalaczniki dodaje sie przy tworzeniu; przy edycji zostaja te, ktore sa.
    byId('task-form-attachments').hidden = Boolean(task)
    formPicker.reset()
    updateTitleCounter()
    updateDescriptionCounter()
    dialog.showModal()
    byId('task-form-title').focus()
  }

  async function submitForm(event) {
    event.preventDefault()
    var button = byId('task-form-submit')
    var assignee = byId('task-form-assignee').value
    var dueValue = byId('task-form-due').value
    var payload = {
      title: byId('task-form-title').value.trim(),
      description: byId('task-form-description').value.trim(),
      assigneeId: assignee === '' ? null : assignee,
      priority: selectedPriority(),
      // Nieruszony termin wysylamy dokladnie taki, jaki byl (pole gubi sekundy).
      dueAt: editingTask && dueValue === toLocalInputValue(editingTask.dueAt) ? editingTask.dueAt : fromLocalInputValue(dueValue),
    }

    if (!payload.title) {
      showToast(t('tasks.tytul_wymagany'), 'error')
      byId('task-form-title').focus()
      return
    }

    button.disabled = true
    try {
      if (editingTask) {
        await sendJson('/api/tasks/' + encodeURIComponent(editingTask.id), 'PATCH', payload)
        showToast(t('tasks.zapisano'), 'success')
      } else {
        payload.attachments = await formPicker.toUploads()
        await sendJson('/api/tasks', 'POST', payload)
        showToast(t('tasks.dodano'), 'success')
      }
      formPicker.reset()
      byId('task-form-dialog').close()
      if (detailTaskId && byId('task-detail-dialog').open) void openDetail(detailTaskId)
      await loadList()
    } catch (error) {
      showToast(error.message, 'error')
    } finally {
      button.disabled = false
    }
  }

  // ─── Ukonczenie ─────────────────────────────────────────────────────────────

  function openComplete(task) {
    completingTask = task
    byId('task-complete-subject').textContent = task.title
    byId('task-complete-note').value = ''
    updateNoteCounter()
    completePicker.reset()
    byId('task-complete-dialog').showModal()
    byId('task-complete-note').focus()
  }

  async function submitComplete(event) {
    event.preventDefault()
    if (!completingTask) return

    var note = byId('task-complete-note').value.trim()
    var minLength = (meta && meta.limits.noteMinLength) || 3
    if (note.length < minLength) {
      showToast(t('tasks.notatka_wymagana', { min: minLength }), 'error')
      byId('task-complete-note').focus()
      return
    }

    var button = byId('task-complete-submit')
    button.disabled = true
    try {
      await sendJson('/api/tasks/' + encodeURIComponent(completingTask.id) + '/complete', 'POST', {
        note: note,
        attachments: await completePicker.toUploads(),
      })
      showToast(t('tasks.ukonczono_toast'), 'success')
      completePicker.reset()
      byId('task-complete-dialog').close()
      if (byId('task-detail-dialog').open) byId('task-detail-dialog').close()
      await loadList()
    } catch (error) {
      showToast(error.message, 'error')
    } finally {
      button.disabled = false
    }
  }

  async function removeTask(task) {
    if (!global.confirm(t('tasks.potwierdz_usuniecie', { title: task.title }))) return
    try {
      await requestJson('/api/tasks/' + encodeURIComponent(task.id), { method: 'DELETE' })
      showToast(t('tasks.usunieto'), 'success')
      if (byId('task-detail-dialog').open) byId('task-detail-dialog').close()
      await loadList()
    } catch (error) {
      showToast(error.message, 'error')
    }
  }

  // ─── Szczegoly ──────────────────────────────────────────────────────────────

  function openImage(attachment) {
    var dialog = byId('task-image-dialog')
    byId('task-image-dialog-img').src = attachment.url
    dialog.showModal()
  }

  function buildGallery(attachments) {
    if (attachments.length === 0) return null
    return el('div', { className: 'tasks-gallery' }, attachments.map(function (attachment) {
      var image = document.createElement('img')
      image.src = attachment.url
      image.alt = ''
      image.loading = 'lazy'
      return el('button', { className: 'tasks-gallery-item', type: 'button', title: t('tasks.powieksz'), label: t('tasks.powieksz'), onClick: function () { openImage(attachment) } }, [image])
    }))
  }

  var FIELD_LABEL_KEYS = {
    title: 'tasks.pole_tytul',
    description: 'tasks.pole_opis',
    priority: 'tasks.pole_priorytet',
    assigneeId: 'tasks.pole_osoba',
    dueAt: 'tasks.pole_termin',
  }

  function describeEvent(event) {
    var actor = displayName(event.actorId)
    if (event.type === 'edited') {
      var fields = Object.keys(event.changes || {}).map(function (field) {
        if (field === 'assigneeId') {
          var after = event.changes[field].after
          return t(FIELD_LABEL_KEYS[field]) + ' → ' + (after ? displayName(after) : t('tasks.wszyscy'))
        }
        return FIELD_LABEL_KEYS[field] ? t(FIELD_LABEL_KEYS[field]) : field
      })
      return t('tasks.zdarzenie_edited', { actor: actor, fields: fields.join(', ') })
    }
    return t('tasks.zdarzenie_' + event.type, { actor: actor })
  }

  function buildSideRow(label, valueNode) {
    return el('div', { className: 'tasks-side-row' }, [
      el('span', { className: 'tasks-side-label', text: label }),
      valueNode,
    ])
  }

  function renderDetail(body) {
    var task = body.task
    users = Object.assign({}, users, body.users || {})
    var container = byId('task-detail-content')
    container.replaceChildren()

    var descriptionAttachments = task.attachments.filter(function (item) { return item.kind === 'description' })
    var completionAttachments = task.attachments.filter(function (item) { return item.kind === 'completion' })

    var main = el('div', { className: 'tasks-detail-main' }, [
      el('h3', { className: 'tasks-detail-title', text: task.title }),
      el('div', { className: 'tasks-chips-row' }, [statusBadge(task), buildChip('is-priority is-' + task.priority, priorityLabel(task.priority)), buildDueChip(task)]),
      el('p', {
        className: 'tasks-description' + (task.description ? '' : ' is-empty'),
        text: task.description || t('tasks.brak_opisu'),
      }),
      buildGallery(descriptionAttachments),
    ])

    if (task.status === 'done') {
      main.appendChild(el('div', { className: 'tasks-completion' }, [
        el('strong', { text: '✅ ' + t('tasks.ukonczyl', { name: displayName(task.completedBy), date: formatTimestampInWarsaw(task.completedAt) }) }),
        el('p', { className: 'tasks-description', text: task.completionNote || '' }),
        buildGallery(completionAttachments),
      ]))
    }

    main.appendChild(el('h4', { className: 'tasks-subheading', text: t('tasks.historia_zmian') }))
    main.appendChild(el('ol', { className: 'tasks-timeline' }, (body.events || []).map(function (event) {
      return el('li', {}, [
        el('span', { className: 'tasks-timeline-text', text: describeEvent(event) }),
        el('span', { className: 'tasks-meta', text: formatTimestampInWarsaw(event.createdAt) }),
      ])
    })))

    var side = el('aside', { className: 'tasks-detail-side' }, [
      buildSideRow(t('tasks.pole_osoba'), buildPerson(task.assigneeId)),
      buildSideRow(t('tasks.pole_autor'), buildPerson(task.creatorId)),
      buildSideRow(t('tasks.pole_termin'), el('span', { text: task.dueAt === null ? t('tasks.brak_terminu') : formatTimestampInWarsaw(task.dueAt) })),
      buildSideRow(t('tasks.pole_utworzono'), el('span', { text: formatTimestampInWarsaw(task.createdAt) })),
    ])

    container.appendChild(el('div', { className: 'tasks-detail-layout' }, [main, side]))

    var actions = byId('task-detail-actions')
    actions.replaceChildren()
    if (task.permissions.canEdit) {
      actions.appendChild(el('button', { className: 'btn-secondary', type: 'button', text: '✏️ ' + t('tasks.edytuj'), onClick: function () { openForm(task) } }))
      actions.appendChild(el('button', { className: 'btn-danger', type: 'button', text: '🗑️ ' + t('tasks.usun'), onClick: function () { void removeTask(task) } }))
    }
    if (task.permissions.canComplete) {
      actions.appendChild(el('button', { className: 'btn-primary', type: 'button', text: '✅ ' + t('tasks.ukonczono'), onClick: function () { openComplete(task) } }))
    }
  }

  async function openDetail(taskId) {
    var requestId = ++detailRequestId
    try {
      var body = await requestJson('/api/tasks/' + encodeURIComponent(taskId))
      // Odpowiedz starszego klikniecia nie moze nadpisac nowszego.
      if (requestId !== detailRequestId) return
      detailTaskId = taskId
      renderDetail(body)
      var dialog = byId('task-detail-dialog')
      if (!dialog.open) dialog.showModal()
    } catch (error) {
      if (requestId === detailRequestId) showToast(error.message || t('tasks.nie_znaleziono'), 'error')
    }
  }

  // ─── Deep link (#tasks/<id>) ────────────────────────────────────────────────

  /**
   * Zwraca 'tasks', gdy strona zostala otwarta z linku do taska (np. z DM-a).
   * Link mogl przyjsc w hashu albo zostac zapamietany przez strone logowania.
   * Akceptujemy wylacznie format #tasks lub #tasks/<uuid>.
   */
  global.consumeTaskDeepLink = function consumeTaskDeepLink() {
    var candidate = global.location.hash
    try {
      var stored = global.sessionStorage.getItem(PENDING_LINK_KEY)
      global.sessionStorage.removeItem(PENDING_LINK_KEY)
      if (!DEEP_LINK_PATTERN.test(candidate) && stored) candidate = stored
    } catch (error) {
      // sessionStorage bywa niedostepny (tryb prywatny) - wtedy liczy sie sam hash.
    }

    var match = DEEP_LINK_PATTERN.exec(candidate || '')
    if (!match) return null

    pendingTaskId = match[1] || null
    if (global.history && global.history.replaceState) {
      global.history.replaceState(null, '', global.location.pathname + global.location.search)
    }
    return 'tasks'
  }

  global.addEventListener('hashchange', function () {
    if (global.consumeTaskDeepLink() && typeof switchSection === 'function') switchSection('tasks')
  })

  // ─── Inicjalizacja ──────────────────────────────────────────────────────────

  function bindDialogs() {
    document.querySelectorAll('[data-close-dialog]').forEach(function (button) {
      button.addEventListener('click', function () {
        var dialog = byId(button.dataset.closeDialog)
        if (dialog) dialog.close()
      })
    })

    byId('task-form').addEventListener('submit', submitForm)
    byId('task-complete-form').addEventListener('submit', submitComplete)
    byId('task-image-dialog').addEventListener('click', function () { byId('task-image-dialog').close() })
    byId('task-detail-dialog').addEventListener('close', function () { detailTaskId = null })

    updateTitleCounter = bindCounter('task-form-title', 'task-form-title-counter')
    updateDescriptionCounter = bindCounter('task-form-description', 'task-form-description-counter')
    updateNoteCounter = bindCounter('task-complete-note', 'task-complete-note-counter')

    formPicker = createPicker('task-form')
    completePicker = createPicker('task-complete')
    bindPaste(byId('task-form-dialog'), function () { return editingTask ? null : formPicker })
    bindPaste(byId('task-complete-dialog'), function () { return completePicker })
  }

  function bindToolbar() {
    document.querySelectorAll('[data-tasks-scope]').forEach(function (control) {
      control.addEventListener('click', function () {
        if (control.dataset.tasksScope === scope && !filters.overdueOnly) return
        setScope(control.dataset.tasksScope)
      })
    })
    byId('tasks-stat-overdue').addEventListener('click', function () {
      if (scope === 'open' && filters.overdueOnly) {
        filters.overdueOnly = false
        syncFilterControls()
        renderList()
        return
      }
      setScope('open', { overdueOnly: true })
    })

    byId('tasks-new-btn').addEventListener('click', function () { openForm(null) })
    byId('tasks-refresh-btn').addEventListener('click', function () { void loadList({ showSkeleton: true }) })
    byId('tasks-prev-btn').addEventListener('click', function () {
      if (history.page > 1) { history.page--; void loadList({ showSkeleton: true }) }
    })
    byId('tasks-next-btn').addEventListener('click', function () {
      if (history.page < history.totalPages) { history.page++; void loadList({ showSkeleton: true }) }
    })

    byId('tasks-search').addEventListener('input', function (event) {
      global.clearTimeout(searchTimerId)
      var value = event.target.value.trim()
      // Historia filtruje na serwerze (stronicowanie), pozostale listy od razu w przegladarce.
      searchTimerId = global.setTimeout(function () {
        filters.search = value
        if (scope === 'history') {
          history.page = 1
          void loadList()
        } else {
          renderList()
        }
      }, scope === 'history' ? SEARCH_DEBOUNCE_MS : LOCAL_FILTER_DEBOUNCE_MS)
    })

    byId('tasks-filter-assignee').addEventListener('change', function (event) {
      filters.assignee = event.target.value
      if (scope === 'history') {
        history.page = 1
        void loadList()
      } else {
        renderList()
      }
    })
    byId('tasks-filter-status').addEventListener('change', function (event) {
      history.status = event.target.value
      history.page = 1
      void loadList()
    })
    document.querySelectorAll('[data-tasks-priority]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        filters.priority = chip.dataset.tasksPriority
        syncFilterControls()
        renderList()
      })
    })
  }

  function applyMeta() {
    fillAssigneeSelect(byId('tasks-filter-assignee'), true)
    // Usuniete taski widzi tylko owner - serwer i tak je odfiltruje.
    document.querySelectorAll('#tasks-filter-status [data-owner-only]').forEach(function (option) {
      option.hidden = !meta.me.isOwner
      option.disabled = !meta.me.isOwner
    })
    syncFilterControls()
  }

  var bound = false

  global.loadTasksSection = async function loadTasksSection() {
    if (!bound) {
      bound = true
      bindToolbar()
      bindDialogs()
      global.I18n.onLanguageChange(function () {
        if (byId('section-tasks') && byId('section-tasks').classList.contains('active')) {
          if (meta) applyMeta()
          renderList()
        }
      })
    }

    if (!hasLoadedOnce) renderLoading()
    try {
      meta = await requestJson('/api/tasks/meta')
      applyMeta()
    } catch (error) {
      showToast(error.message || t('tasks.blad_ladowania'), 'error')
      return
    }

    await loadList()

    if (pendingTaskId) {
      var taskId = pendingTaskId
      pendingTaskId = null
      await openDetail(taskId)
    }
  }
})(window)
