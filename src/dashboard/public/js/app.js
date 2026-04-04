const COLOR_MAP = {
  czerwony: '#dc143c',
  biały: '#f5f5f5',
  szary: '#99aab5',
  złoty: '#ffd700',
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const ALLOWED_UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif'])
const ALLOWED_UPLOAD_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif'])
const UPLOAD_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
}

let currentMode = 'embedded'
let selectedColor = 'czerwony'
let activeEditorId = 'content-textarea'

let channels = []
let roles = []
let images = []
let emojis = []
let mentionChannelResults = []
let mentionRoleResults = []
let mentionUserResults = []
const knownUsers = new Map()

let selectedImageName = null
let selectedUploadFile = null
let selectedUploadPreviewUrl = null
let scheduledStoredUpload = null
let mentionChannelSearchDebounceId = null
let mentionRoleSearchDebounceId = null
let mentionUserSearchDebounceId = null
let mentionChannelSearchRequestId = 0
let mentionRoleSearchRequestId = 0
let mentionUserSearchRequestId = 0
let embedSectionBound = false
let scheduledSectionBound = false
let sentSectionBound = false
let eventsSectionBound = false
let g2SectionBound = false
let economySectionBound = false
let economyLeaderboardSectionBound = false
let currentSection = 'embed-creator'
let scheduledPosts = []
let sentPosts = []
let dashboardEvents = []
let editingScheduledPostId = null
let editingSentPostId = null
let editingEventId = null
let economySettingsLastLoadedAt = null
let economySettingsLoadSuccessful = false
let economySettingsLoadRequestId = 0
let economyLeaderboardSortBy = 'xp'
let economyLeaderboardPage = 1
let economyLeaderboardTotalPages = 1
let economyLeaderboardTotalRows = 0
let economyLeaderboardEntries = []
let economyLeaderboardLoadError = null
let economyLeaderboardLoadRequestId = 0

let g2Matches = []
let g2FilterOptions = {
  games: [],
  g2Teams: [],
  tournaments: [],
  statuses: [],
}
let g2SyncMeta = null
let g2RefreshInProgress = false
let g2RefreshCooldownMs = 30000
let g2FilterDebounceId = null
let g2LoadRequestId = 0
let csrfTokenPromise = null

let selectedMatchInfo = null

document.addEventListener('DOMContentLoaded', async () => {
  await loadUserInfo()
  await ensureCsrfToken().catch(() => undefined)
  initSidebarNav()
  await initEmbedSection()
  await initScheduledSection()
  await initSentSection()
  await initEventsSection()
  await initG2Section()
  await initEconomySection()
  await initEconomyLeaderboardSection()
  await loadG2Matches({ silent: true })
  switchSection('embed-creator')
})

async function loadUserInfo() {
  try {
    const resp = await fetch('/api/me')
    if (!resp.ok) {
      window.location.href = '/auth/discord'
      return
    }

    const { user } = await resp.json()
    const container = document.getElementById('navbar-user')
    const avatarUrl = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
      : null

    container.innerHTML = `
      <div class="user-info">
        ${avatarUrl
          ? `<img class="user-avatar" src="${avatarUrl}" alt="avatar">`
          : `<div class="user-avatar-placeholder">👤</div>`}
        <span class="user-name">${escapeHtml(user.globalName || user.username)}</span>
        <button type="button" class="btn-logout" id="logout-btn">Wyloguj</button>
      </div>`

    const logoutButton = document.getElementById('logout-btn')
    logoutButton?.addEventListener('click', async () => {
      await logoutDashboard()
    })
  } catch {
    window.location.href = '/auth/discord'
  }
}

async function logoutDashboard() {
  try {
    const response = await fetchWithCsrf('/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })

    if (!response.ok) {
      const payload = await parseApiResponse(response)
      throw new Error(payload.error ?? 'Nie udało się wylogować.')
    }

    window.location.href = '/auth/login'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd'
    showToast(`❌ ${message}`, 'error')
  }
}

async function ensureCsrfToken(forceRefresh = false) {
  if (forceRefresh) {
    csrfTokenPromise = null
  }

  if (!csrfTokenPromise) {
    csrfTokenPromise = (async () => {
      const response = await fetch('/api/csrf-token')
      if (response.status === 401) {
        window.location.href = '/auth/discord'
        throw new Error('Sesja wygasła. Zaloguj się ponownie.')
      }

      const payload = await parseApiResponse(response)
      if (!response.ok || typeof payload.csrfToken !== 'string' || payload.csrfToken.length === 0) {
        throw new Error(payload.error ?? 'Nie udało się pobrać tokenu bezpieczeństwa.')
      }

      return payload.csrfToken
    })().catch((error) => {
      csrfTokenPromise = null
      throw error
    })
  }

  return csrfTokenPromise
}

async function fetchWithCsrf(url, options = {}) {
  const method = String(options.method ?? 'GET').toUpperCase()
  const isMutatingRequest = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)

  if (!isMutatingRequest) {
    return fetch(url, options)
  }

  const headers = new Headers(options.headers ?? {})
  headers.set('x-csrf-token', await ensureCsrfToken())

  const firstResponse = await fetch(url, {
    ...options,
    method,
    headers,
  })

  if (firstResponse.status === 401) {
    window.location.href = '/auth/discord'
    return firstResponse
  }

  if (firstResponse.status !== 403) {
    return firstResponse
  }

  headers.set('x-csrf-token', await ensureCsrfToken(true))
  return fetch(url, {
    ...options,
    method,
    headers,
  })
}

function initSidebarNav() {
  document.querySelectorAll('.sidebar-item[data-section]').forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault()
      const section = item.dataset.section
      if (!section) {
        return
      }

      switchSection(section)
    })
  })
}

function switchSection(section) {
  currentSection = section

  document.querySelectorAll('.sidebar-item[data-section]').forEach((item) => {
    item.classList.toggle('active', item.dataset.section === section)
  })

  document.querySelectorAll('.section-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `section-${section}`)
  })

  if (section === 'scheduled-posts') {
    void loadScheduledPosts()
  }

  if (section === 'sent-posts') {
    void loadSentPosts()
  }

  if (section === 'events') {
    void loadDashboardEvents()
  }

  if (section === 'g2-matches') {
    void loadG2Matches({ silent: true })
  }

  if (section === 'economy-settings') {
    void loadEconomySettings({ silent: true })
  }

  if (section === 'economy-leaderboard') {
    void loadEconomyLeaderboard({ silent: false })
  }

  if (typeof window.onDashboardSectionChanged === 'function') {
    window.onDashboardSectionChanged(section)
  }
}

async function initEmbedSection() {
  await Promise.all([
    loadChannels(),
    loadRoles(),
    loadImages(),
    loadEmojis(),
  ])

  renderChannelSelector()
  renderPingRoleSelector()
  renderImageLibrary(images)
  renderEmojiList('')
  renderMentionChannelResults([])
  renderMentionRoleResults([])
  renderMentionUserResults([])
  renderMatchHelperOptions()
  renderMatchHelperChips(null)
  initializeTimestampInput()

  updateModeUI()
  updateImagePanels()
  updatePreview()
  updateSendButton()

  if (!embedSectionBound) {
    embedSectionBound = true
    bindEmbedSectionListeners()
  }
}

async function initScheduledSection() {
  await loadScheduledPosts()

  if (!scheduledSectionBound) {
    scheduledSectionBound = true
    bindScheduledSectionListeners()
  }
}

async function initSentSection() {
  await loadSentPosts()

  if (!sentSectionBound) {
    sentSectionBound = true
    bindSentSectionListeners()
  }
}

async function initEventsSection() {
  await loadDashboardEvents()

  if (!eventsSectionBound) {
    eventsSectionBound = true
    bindEventsSectionListeners()
  }
}

async function initG2Section() {
  if (!g2SectionBound) {
    g2SectionBound = true
    bindG2SectionListeners()
  }
}

async function initEconomySection() {
  await loadEconomySettings({ silent: true })

  if (!economySectionBound) {
    economySectionBound = true
    bindEconomySectionListeners()
  }
}

async function initEconomyLeaderboardSection() {
  renderEconomyLeaderboard()

  if (!economyLeaderboardSectionBound) {
    economyLeaderboardSectionBound = true
    bindEconomyLeaderboardSectionListeners()
  }
}

function bindEmbedSectionListeners() {
  const modeTabs = document.getElementById('mode-tabs')
  modeTabs?.addEventListener('click', (event) => {
    const button = event.target.closest('.mode-tab')
    if (!button) return

    const nextMode = button.dataset.mode
    if (!nextMode || nextMode === currentMode) return

    currentMode = nextMode
    updateModeUI()
    updatePreview()
    updateSendButton()
  })

  const toolbar = document.getElementById('format-toolbar')
  toolbar?.addEventListener('click', (event) => {
    const button = event.target.closest('.toolbar-btn')
    if (!button) return

    const wrap = button.dataset.wrap
    const prefix = button.dataset.prefix

    if (wrap) {
      wrapSelection(wrap)
      return
    }

    if (prefix) {
      prefixSelectionLines(prefix)
    }
  })

  const emojiToggle = document.getElementById('emoji-popover-toggle')
  const mentionToggle = document.getElementById('mention-popover-toggle')
  const emojiPopover = document.getElementById('emoji-popover')
  const mentionPopover = document.getElementById('mention-popover')
  const emojiSearchInput = document.getElementById('emoji-search-input')

  const mentionQuickList = document.getElementById('mention-quick-list')
  const mentionChannelResults = document.getElementById('mention-channel-results')
  const mentionRoleResults = document.getElementById('mention-role-results')
  const mentionChannelSearch = document.getElementById('mention-channel-search')
  const mentionRoleSearch = document.getElementById('mention-role-search')
  const mentionUserSearch = document.getElementById('mention-user-search')
  const mentionUserResultsContainer = document.getElementById('mention-user-results')

  emojiToggle?.addEventListener('click', (event) => {
    event.stopPropagation()
    togglePopover('emoji-popover')
  })

  mentionToggle?.addEventListener('click', (event) => {
    event.stopPropagation()
    togglePopover('mention-popover')
  })

  emojiPopover?.addEventListener('click', (event) => {
    event.stopPropagation()
    const button = event.target.closest('[data-token]')
    const token = button?.dataset.token
    if (!token) return

    insertToken(token)
    closeAllPopovers()
  })

  mentionPopover?.addEventListener('click', (event) => {
    event.stopPropagation()
    const button = event.target.closest('[data-token]')
    const token = button?.dataset.token
    if (!token) return

    insertToken(token)
    closeAllPopovers()
  })

  emojiSearchInput?.addEventListener('input', () => {
    renderEmojiList(emojiSearchInput.value)
  })

  mentionChannelSearch?.addEventListener('input', () => {
    const mentionPopoverElement = document.getElementById('mention-popover')
    if (mentionPopoverElement?.hidden) {
      mentionPopoverElement.hidden = false
    }

    if (mentionChannelSearchDebounceId) {
      clearTimeout(mentionChannelSearchDebounceId)
    }

    mentionChannelSearchDebounceId = setTimeout(async () => {
      await searchMentionChannels(mentionChannelSearch.value)
    }, 220)
  })

  mentionRoleSearch?.addEventListener('input', () => {
    const mentionPopoverElement = document.getElementById('mention-popover')
    if (mentionPopoverElement?.hidden) {
      mentionPopoverElement.hidden = false
    }

    if (mentionRoleSearchDebounceId) {
      clearTimeout(mentionRoleSearchDebounceId)
    }

    mentionRoleSearchDebounceId = setTimeout(async () => {
      await searchMentionRoles(mentionRoleSearch.value)
    }, 220)
  })

  mentionUserSearch?.addEventListener('input', () => {
    const mentionPopoverElement = document.getElementById('mention-popover')
    if (mentionPopoverElement?.hidden) {
      mentionPopoverElement.hidden = false
    }

    if (mentionUserSearchDebounceId) {
      clearTimeout(mentionUserSearchDebounceId)
    }

    mentionUserSearchDebounceId = setTimeout(async () => {
      await searchMentionUsers(mentionUserSearch.value)
    }, 220)
  })

  document.addEventListener('click', () => {
    closeAllPopovers()
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAllPopovers()
    }
  })

  const pingToggle = document.getElementById('ping-role-enabled')
  const pingSelect = document.getElementById('ping-role-select')
  pingToggle?.addEventListener('change', () => {
    pingSelect.disabled = !pingToggle.checked
    updateSendButton()
  })
  pingSelect?.addEventListener('change', updateSendButton)

  const imageModeSelect = document.getElementById('image-mode-select')
  imageModeSelect?.addEventListener('change', () => {
    updateImagePanels()
    updatePreview()
    updateSendButton()
  })

  const uploadInput = document.getElementById('image-upload-input')
  uploadInput?.addEventListener('change', () => {
    const files = uploadInput.files
    selectedUploadFile = files && files[0] ? files[0] : null
    scheduledStoredUpload = null

    if (selectedUploadFile && !isAllowedUploadFile(selectedUploadFile)) {
      showToast('Dozwolone formaty pliku: JPEG, PNG, GIF.', 'error')
      uploadInput.value = ''
      selectedUploadFile = null
      clearUploadPreviewUrl()
    }

    if (selectedUploadFile && selectedUploadFile.size > MAX_UPLOAD_BYTES) {
      showToast('Plik jest za duży. Maksymalny rozmiar to 8 MB.', 'error')
      uploadInput.value = ''
      selectedUploadFile = null
      clearUploadPreviewUrl()
    }

    if (selectedUploadFile) {
      clearUploadPreviewUrl()
      selectedUploadPreviewUrl = URL.createObjectURL(selectedUploadFile)
    } else {
      clearUploadPreviewUrl()
    }

    const fileNameElement = document.getElementById('upload-file-name')
    fileNameElement.textContent = selectedUploadFile
      ? `Wybrano: ${selectedUploadFile.name}`
      : 'Nie wybrano pliku.'

    updatePreview()
    updateSendButton()
  })

  const titleInput = document.getElementById('title')
  const contentTextarea = document.getElementById('content-textarea')
  const channelSelect = document.getElementById('channel-select')
  const scheduleAtInput = document.getElementById('schedule-at')
  const matchHelperEnabledInput = document.getElementById('match-helper-enabled')
  const matchHelperSearchInput = document.getElementById('match-helper-search')
  const matchHelperSelectInput = document.getElementById('match-helper-select')
  const matchHelperChips = document.getElementById('match-helper-chips')
  const eventEnabledInput = document.getElementById('event-enabled')
  const eventFields = document.getElementById('event-fields')
  const eventTitleInput = document.getElementById('event-title')
  const eventDescriptionInput = document.getElementById('event-description')
  const eventLocationInput = document.getElementById('event-location')
  const eventStartAtInput = document.getElementById('event-start-at')
  const eventEndAtInput = document.getElementById('event-end-at')
  const watchpartyEnabledInput = document.getElementById('watchparty-enabled')
  const watchpartyFields = document.getElementById('watchparty-fields')
  const watchpartyChannelNameInput = document.getElementById('watchparty-channel-name')
  const watchpartyStartAtInput = document.getElementById('watchparty-start-at')
  const watchpartyEndAtInput = document.getElementById('watchparty-end-at')
  const timestampDateTimeInput = document.getElementById('timestamp-datetime')
  const timestampFormatList = document.getElementById('timestamp-format-list')

  const updateHandler = () => {
    updatePreview()
    updateSendButton()
  }

  titleInput?.addEventListener('input', updateHandler)
  titleInput?.addEventListener('focus', () => {
    activeEditorId = 'title'
  })

  contentTextarea?.addEventListener('input', updateHandler)
  contentTextarea?.addEventListener('focus', () => {
    activeEditorId = 'content-textarea'
  })

  channelSelect?.addEventListener('change', updateSendButton)
  scheduleAtInput?.addEventListener('change', updateSendButton)

  matchHelperEnabledInput?.addEventListener('change', () => {
    const enabled = Boolean(matchHelperEnabledInput.checked)
    if (matchHelperSearchInput) {
      matchHelperSearchInput.disabled = !enabled
      if (!enabled) {
        matchHelperSearchInput.value = ''
      }
    }

    if (matchHelperSelectInput) {
      matchHelperSelectInput.disabled = !enabled
      if (!enabled) {
        matchHelperSelectInput.value = ''
      }
    }

    if (!enabled) {
      selectedMatchInfo = null
      renderMatchHelperChips(null)
    }

    renderMatchHelperOptions()
    updateEventDefaultsFromMatch()
    updateWatchpartyDefaultsFromMatch()
    updatePreview()
    updateSendButton()
  })

  matchHelperSearchInput?.addEventListener('input', () => {
    renderMatchHelperOptions()
  })

  matchHelperSelectInput?.addEventListener('change', () => {
    selectedMatchInfo = findMatchById(matchHelperSelectInput.value)
    renderMatchHelperChips(selectedMatchInfo)
    updateEventDefaultsFromMatch()
    updateWatchpartyDefaultsFromMatch()
    updatePreview()
    updateSendButton()
  })

  matchHelperChips?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-token]')
    const token = chip?.dataset.token
    if (!token) {
      return
    }

    insertToken(token)
  })

  eventEnabledInput?.addEventListener('change', () => {
    if (eventFields) {
      eventFields.hidden = !eventEnabledInput.checked
    }

    updateEventDefaultsFromMatch()
    updatePreview()
    updateSendButton()
  })

  watchpartyEnabledInput?.addEventListener('change', () => {
    if (watchpartyFields) {
      watchpartyFields.hidden = !watchpartyEnabledInput.checked
    }

    updateWatchpartyDefaultsFromMatch()
    updatePreview()
    updateSendButton()
  })

  ;[
    eventTitleInput,
    eventDescriptionInput,
    eventLocationInput,
    eventStartAtInput,
    eventEndAtInput,
    watchpartyChannelNameInput,
    watchpartyStartAtInput,
    watchpartyEndAtInput,
  ].forEach((input) => {
    input?.addEventListener('input', updateHandler)
    input?.addEventListener('change', updateHandler)
  })

  timestampDateTimeInput?.addEventListener('change', updatePreview)

  document.querySelectorAll('.timestamp-preset').forEach((button) => {
    button.addEventListener('click', () => {
      const offsetMinutesRaw = Number.parseInt(button.dataset.offsetMinutes ?? '0', 10)
      if (!Number.isFinite(offsetMinutesRaw) || !timestampDateTimeInput) {
        return
      }

      const targetTimestamp = Date.now() + (offsetMinutesRaw * 60 * 1000)
      timestampDateTimeInput.value = formatTimestampForDateTimeInput(targetTimestamp)
      updatePreview()
    })
  })

  timestampFormatList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-token-format]')
    const tokenFormat = button?.dataset.tokenFormat
    if (!tokenFormat) {
      return
    }

    const unixTimestamp = resolveTimestampInsertUnix()
    if (!unixTimestamp) {
      showToast('Ustaw poprawną datę timestampu.', 'error')
      return
    }

    insertToken(`<t:${unixTimestamp}:${tokenFormat}>`)
  })

  document.querySelectorAll('.color-swatch').forEach((swatch) => {
    swatch.addEventListener('click', () => {
      const nextColor = swatch.dataset.color
      if (!nextColor) return

      selectedColor = nextColor
      document.querySelectorAll('.color-swatch').forEach((element) => {
        element.classList.remove('active')
      })
      swatch.classList.add('active')
      updatePreview()
    })
  })

  const sendButton = document.getElementById('send-btn')
  sendButton?.addEventListener('click', publishMessage)

  window.addEventListener('beforeunload', () => {
    clearUploadPreviewUrl()
  })
}

function bindScheduledSectionListeners() {
  const refreshButton = document.getElementById('scheduled-refresh-btn')
  refreshButton?.addEventListener('click', () => {
    void loadScheduledPosts()
  })

  const list = document.getElementById('scheduled-list')
  list?.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('button[data-action]')
    const action = actionButton?.dataset.action
    const postId = actionButton?.dataset.postId

    if (!action || !postId) {
      return
    }

    if (action === 'edit') {
      await openScheduledPostForEdit(postId)
      return
    }

    if (action === 'delete') {
      await deleteScheduledPost(postId)
    }
  })
}

function bindSentSectionListeners() {
  const refreshButton = document.getElementById('sent-refresh-btn')
  refreshButton?.addEventListener('click', () => {
    void loadSentPosts()
  })

  const list = document.getElementById('sent-list')
  list?.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('button[data-action]')
    const action = actionButton?.dataset.action
    const postId = actionButton?.dataset.postId

    if (!action || !postId) {
      return
    }

    if (action === 'edit') {
      await openSentPostForEdit(postId)
      return
    }

    if (action === 'retry-event') {
      await retrySentPostEvent(postId)
      return
    }

    if (action === 'delete') {
      await deleteSentPost(postId)
    }
  })
}

function bindEventsSectionListeners() {
  const refreshButton = document.getElementById('events-refresh-btn')
  const saveButton = document.getElementById('events-save-btn')
  const cancelButton = document.getElementById('events-cancel-btn')
  const list = document.getElementById('events-list')

  refreshButton?.addEventListener('click', () => {
    void loadDashboardEvents()
  })

  saveButton?.addEventListener('click', async () => {
    await saveDashboardEvent()
  })

  cancelButton?.addEventListener('click', () => {
    resetDashboardEventForm()
  })

  list?.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('button[data-action]')
    const action = actionButton?.dataset.action
    const eventId = actionButton?.dataset.eventId

    if (!action || !eventId) {
      return
    }

    if (action === 'edit') {
      openDashboardEventForEdit(eventId)
      return
    }

    if (action === 'delete') {
      await deleteDashboardEvent(eventId)
    }
  })
}

async function loadScheduledPosts() {
  try {
    const response = await fetch('/api/scheduled')
    const json = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(json.error ?? 'Nie udało się pobrać listy zaplanowanych postów.')
    }

    scheduledPosts = Array.isArray(json.posts) ? json.posts : []
    renderScheduledPosts()
  } catch (error) {
    scheduledPosts = []
    renderScheduledPosts()
    const message = error instanceof Error ? error.message : 'Nieznany błąd'
    showToast(`❌ ${message}`, 'error')
  }
}

async function loadSentPosts() {
  try {
    const response = await fetch('/api/scheduled/sent')
    const json = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(json.error ?? 'Nie udało się pobrać listy wysłanych postów.')
    }

    sentPosts = Array.isArray(json.posts) ? json.posts : []
    renderSentPosts()
  } catch (error) {
    sentPosts = []
    renderSentPosts()
    const message = error instanceof Error ? error.message : 'Nieznany błąd'
    showToast(`❌ ${message}`, 'error')
  }
}

async function loadDashboardEvents() {
  try {
    const response = await fetch('/api/events')
    const json = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(json.error ?? 'Nie udało się pobrać listy wydarzeń Discord.')
    }

    dashboardEvents = Array.isArray(json.events) ? json.events : []
    renderDashboardEvents()
  } catch (error) {
    dashboardEvents = []
    renderDashboardEvents()
    const message = error instanceof Error ? error.message : 'Nieznany błąd'
    showToast(`❌ ${message}`, 'error')
  }
}

function renderScheduledPosts() {
  const list = document.getElementById('scheduled-list')
  const counter = document.getElementById('scheduled-count-label')
  if (!list || !counter) {
    return
  }

  counter.textContent = `Oczekujące: ${scheduledPosts.length}`

  if (scheduledPosts.length === 0) {
    list.innerHTML = '<div class="scheduled-empty">Brak zaplanowanych postów oczekujących na publikację.</div>'
    return
  }

  list.innerHTML = scheduledPosts.map((post) => {
    const modeLabel = post?.payload?.mode === 'message' ? 'Wiadomość' : 'Embedded'
    const channelName = channels.find((channel) => channel.id === post?.payload?.channelId)?.name ?? 'nieznany-kanał'
    const pingLabel = post?.payload?.mentionRoleEnabled
      ? resolvePingTargetLabel(post?.payload?.mentionRoleId)
      : 'brak pingu'
    const previewHtml = post?.payload?.mode === 'embedded'
      ? renderPreviewEmbedText(post?.payload?.title ?? '', post?.payload?.content ?? '')
      : (renderMarkdown(post?.payload?.content ?? '') || '<span style="opacity:.45">Brak treści.</span>')

    return `
      <article class="scheduled-card">
        <div class="scheduled-card-header">
          <span class="scheduled-card-title">Publikacja ${escapeHtml(post.id.slice(0, 8))}</span>
          <span class="scheduled-chip">${escapeHtml(modeLabel)}</span>
        </div>
        <div class="scheduled-card-meta">
          <span class="scheduled-chip">Kanał: #${escapeHtml(channelName)}</span>
          <span class="scheduled-chip">Ping: ${escapeHtml(pingLabel)}</span>
          <span class="scheduled-chip">Czas: ${escapeHtml(formatTimestampInWarsaw(post.scheduledFor))}</span>
        </div>
        <div class="scheduled-preview">${previewHtml}</div>
        <div class="scheduled-actions">
          <button type="button" class="btn-secondary" data-action="edit" data-post-id="${escapeHtml(post.id)}">Edytuj</button>
          <button type="button" class="btn-secondary" data-action="delete" data-post-id="${escapeHtml(post.id)}">Usuń</button>
        </div>
      </article>`
  }).join('')
}

function renderSentPosts() {
  const list = document.getElementById('sent-list')
  const counter = document.getElementById('sent-count-label')
  if (!list || !counter) {
    return
  }

  counter.textContent = `Wysłane: ${sentPosts.length}`

  if (sentPosts.length === 0) {
    list.innerHTML = '<div class="scheduled-empty">Brak wysłanych postów (historia zaczyna się po wdrożeniu refaktoru).</div>'
    return
  }

  list.innerHTML = sentPosts.map((post) => {
    const modeLabel = post?.payload?.mode === 'message' ? 'Wiadomość' : 'Embedded'
    const channelName = channels.find((channel) => channel.id === post?.payload?.channelId)?.name ?? 'nieznany-kanał'
    const sentAtLabel = post.sentAt ? formatTimestampInWarsaw(post.sentAt) : formatTimestampInWarsaw(post.updatedAt)
    const eventStatus = post.eventStatus ?? 'not_requested'
    const watchpartyStatus = post.watchpartyStatus ?? 'not_requested'
    const eventLabelMap = {
      not_requested: 'Event: brak',
      pending: 'Event: oczekuje',
      created: 'Event: utworzono',
      failed: 'Event: błąd',
    }
    const watchpartyLabelMap = {
      not_requested: 'Watchparty: brak',
      pending: 'Watchparty: oczekuje',
      scheduled: 'Watchparty: zaplanowane',
      open: 'Watchparty: otwarte',
      closed: 'Watchparty: zamknięte',
      deleted: 'Watchparty: usunięte',
      failed: 'Watchparty: błąd',
    }

    const previewHtml = post?.payload?.mode === 'embedded'
      ? renderPreviewEmbedText(post?.payload?.title ?? '', post?.payload?.content ?? '')
      : (renderMarkdown(post?.payload?.content ?? '') || '<span style="opacity:.45">Brak treści.</span>')

    return `
      <article class="scheduled-card">
        <div class="scheduled-card-header">
          <span class="scheduled-card-title">Post ${escapeHtml(post.id.slice(0, 8))}</span>
          <span class="scheduled-chip">${escapeHtml(modeLabel)}</span>
        </div>
        <div class="scheduled-card-meta">
          <span class="scheduled-chip">Kanał: #${escapeHtml(channelName)}</span>
          <span class="scheduled-chip">Wysłano: ${escapeHtml(sentAtLabel)}</span>
          <span class="scheduled-chip">${escapeHtml(eventLabelMap[eventStatus] ?? 'Event: brak')}</span>
          <span class="scheduled-chip">${escapeHtml(watchpartyLabelMap[watchpartyStatus] ?? 'Watchparty: brak')}</span>
        </div>
        <div class="scheduled-preview">${previewHtml}</div>
        <div class="scheduled-actions">
          <button type="button" class="btn-secondary" data-action="edit" data-post-id="${escapeHtml(post.id)}">Edytuj</button>
          ${eventStatus === 'failed'
            ? `<button type="button" class="btn-secondary" data-action="retry-event" data-post-id="${escapeHtml(post.id)}">Ponów event</button>`
            : ''}
          <button type="button" class="btn-secondary" data-action="delete" data-post-id="${escapeHtml(post.id)}">Usuń</button>
        </div>
      </article>`
  }).join('')
}

function renderDashboardEvents() {
  const list = document.getElementById('events-list')
  const counter = document.getElementById('events-count-label')

  if (!list || !counter) {
    return
  }

  counter.textContent = `Wydarzenia: ${dashboardEvents.length}`

  if (dashboardEvents.length === 0) {
    list.innerHTML = '<div class="scheduled-empty">Brak wydarzeń Discord.</div>'
    return
  }

  list.innerHTML = dashboardEvents.map((event) => {
    const eventId = String(event.id ?? '')
    const name = String(event.name ?? 'Bez nazwy')
    const description = String(event.description ?? '')
    const location = String(event.location ?? 'Online')
    const startIso = String(event.scheduledStartTimeIso ?? '')
    const endIso = String(event.scheduledEndTimeIso ?? '')
    const startLabel = Number.isFinite(Date.parse(startIso))
      ? formatTimestampInWarsaw(Date.parse(startIso))
      : 'Nie ustawiono'
    const endLabel = Number.isFinite(Date.parse(endIso))
      ? formatTimestampInWarsaw(Date.parse(endIso))
      : 'Nie ustawiono'

    return `
      <article class="scheduled-card">
        <div class="scheduled-card-header">
          <span class="scheduled-card-title">${escapeHtml(name)}</span>
          <span class="scheduled-chip">ID: ${escapeHtml(eventId.slice(0, 8))}</span>
        </div>
        <div class="scheduled-card-meta">
          <span class="scheduled-chip">Start: ${escapeHtml(startLabel)}</span>
          <span class="scheduled-chip">Koniec: ${escapeHtml(endLabel)}</span>
          <span class="scheduled-chip">Miejsce: ${escapeHtml(location)}</span>
        </div>
        <div class="scheduled-preview">${renderMarkdown(description) || '<span style="opacity:.45">Brak opisu.</span>'}</div>
        <div class="scheduled-actions">
          <button type="button" class="btn-secondary" data-action="edit" data-event-id="${escapeHtml(eventId)}">Edytuj</button>
          <button type="button" class="btn-secondary" data-action="delete" data-event-id="${escapeHtml(eventId)}">Usuń</button>
        </div>
      </article>`
  }).join('')
}

function collectDashboardEventForm() {
  return {
    title: String(document.getElementById('events-title')?.value ?? '').trim(),
    description: String(document.getElementById('events-description')?.value ?? '').trim(),
    location: String(document.getElementById('events-location')?.value ?? '').trim(),
    startAtLocal: String(document.getElementById('events-start-at')?.value ?? '').trim(),
    endAtLocal: String(document.getElementById('events-end-at')?.value ?? '').trim(),
  }
}

function setDashboardEventForm(eventData) {
  const titleInput = document.getElementById('events-title')
  const descriptionInput = document.getElementById('events-description')
  const locationInput = document.getElementById('events-location')
  const startInput = document.getElementById('events-start-at')
  const endInput = document.getElementById('events-end-at')

  if (titleInput) {
    titleInput.value = String(eventData.name ?? '')
  }

  if (descriptionInput) {
    descriptionInput.value = String(eventData.description ?? '')
  }

  if (locationInput) {
    locationInput.value = String(eventData.location ?? 'Online')
  }

  if (startInput) {
    const startIso = String(eventData.scheduledStartTimeIso ?? '')
    startInput.value = Number.isFinite(Date.parse(startIso))
      ? formatTimestampForDateTimeInput(Date.parse(startIso))
      : ''
  }

  if (endInput) {
    const endIso = String(eventData.scheduledEndTimeIso ?? '')
    endInput.value = Number.isFinite(Date.parse(endIso))
      ? formatTimestampForDateTimeInput(Date.parse(endIso))
      : ''
  }
}

function resetDashboardEventForm() {
  editingEventId = null

  const titleInput = document.getElementById('events-title')
  const descriptionInput = document.getElementById('events-description')
  const locationInput = document.getElementById('events-location')
  const startInput = document.getElementById('events-start-at')
  const endInput = document.getElementById('events-end-at')
  const saveButton = document.getElementById('events-save-btn')
  const cancelButton = document.getElementById('events-cancel-btn')

  if (titleInput) titleInput.value = ''
  if (descriptionInput) descriptionInput.value = ''
  if (locationInput) locationInput.value = 'Online'
  if (startInput) startInput.value = ''
  if (endInput) endInput.value = ''
  if (saveButton) saveButton.textContent = 'Utwórz wydarzenie'
  if (cancelButton) cancelButton.style.display = 'none'
}

function openDashboardEventForEdit(eventId) {
  const selectedEvent = dashboardEvents.find((event) => String(event.id) === String(eventId))
  if (!selectedEvent) {
    showToast('❌ Nie znaleziono wydarzenia do edycji.', 'error')
    return
  }

  editingEventId = String(selectedEvent.id)
  setDashboardEventForm(selectedEvent)

  const saveButton = document.getElementById('events-save-btn')
  const cancelButton = document.getElementById('events-cancel-btn')
  if (saveButton) saveButton.textContent = 'Zapisz zmiany wydarzenia'
  if (cancelButton) cancelButton.style.display = ''
}

async function saveDashboardEvent() {
  try {
    const isEditing = Boolean(editingEventId)
    const payload = collectDashboardEventForm()

    const requestUrl = isEditing
      ? `/api/events/${encodeURIComponent(editingEventId)}`
      : '/api/events'
    const requestMethod = isEditing ? 'PATCH' : 'POST'

    const response = await fetchWithCsrf(requestUrl, {
      method: requestMethod,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const json = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(json.error ?? 'Nie udało się zapisać wydarzenia Discord.')
    }

    await loadDashboardEvents()
    resetDashboardEventForm()
    showToast(isEditing
      ? '✅ Wydarzenie Discord zostało zaktualizowane.'
      : '✅ Wydarzenie Discord zostało utworzone.', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd'
    showToast(`❌ ${message}`, 'error')
  }
}

async function deleteDashboardEvent(eventId) {
  const shouldDelete = window.confirm('Czy na pewno chcesz usunąć to wydarzenie Discord?')
  if (!shouldDelete) {
    return
  }

  try {
    const response = await fetchWithCsrf(`/api/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
    })
    const json = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(json.error ?? 'Nie udało się usunąć wydarzenia Discord.')
    }

    if (editingEventId === eventId) {
      resetDashboardEventForm()
    }

    await loadDashboardEvents()
    showToast('🗑️ Wydarzenie Discord zostało usunięte.', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd'
    showToast(`❌ ${message}`, 'error')
  }
}

async function openScheduledPostForEdit(postId) {
  try {
    const response = await fetch(`/api/scheduled/${encodeURIComponent(postId)}`)
    const json = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(json.error ?? 'Nie udało się pobrać zaplanowanego posta.')
    }

    const post = json.post
    if (!post || !post.payload) {
      throw new Error('Nieprawidłowe dane zaplanowanego posta.')
    }

    applyScheduledPostToCreator(post)
    switchSection('embed-creator')
    showToast('✏️ Załadowano post do edycji w kreatorze.', 'info')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd'
    showToast(`❌ ${message}`, 'error')
  }
}

async function openSentPostForEdit(postId) {
  try {
    const response = await fetch(`/api/scheduled/sent/${encodeURIComponent(postId)}`)
    const json = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(json.error ?? 'Nie udało się pobrać wysłanego posta.')
    }

    const post = json.post
    if (!post || !post.payload) {
      throw new Error('Nieprawidłowe dane wysłanego posta.')
    }

    applySentPostToCreator(post)
    switchSection('embed-creator')
    showToast('✏️ Załadowano wysłany post do edycji.', 'info')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd'
    showToast(`❌ ${message}`, 'error')
  }
}

function applyScheduledPostToCreator(post) {
  editingScheduledPostId = post.id
  editingSentPostId = null
  applyPostPayloadToCreator(post.payload)

  const scheduleInput = document.getElementById('schedule-at')
  if (scheduleInput) {
    scheduleInput.value = formatTimestampForDateTimeInput(post.scheduledFor)
  }

  updatePreview()
  updateSendButton()
}

function applySentPostToCreator(post) {
  editingSentPostId = post.id
  editingScheduledPostId = null
  applyPostPayloadToCreator(post.payload)

  const scheduleInput = document.getElementById('schedule-at')
  if (scheduleInput) {
    scheduleInput.value = ''
  }

  updatePreview()
  updateSendButton()
}

function applyPostPayloadToCreator(payload) {
  currentMode = payload.mode === 'message' ? 'message' : 'embedded'
  selectedColor = payload.colorName || 'czerwony'

  const titleInput = document.getElementById('title')
  const contentTextarea = document.getElementById('content-textarea')
  const channelSelect = document.getElementById('channel-select')
  const pingToggle = document.getElementById('ping-role-enabled')
  const pingSelect = document.getElementById('ping-role-select')
  const imageModeSelect = document.getElementById('image-mode-select')
  const matchHelperEnabledInput = document.getElementById('match-helper-enabled')
  const eventEnabledInput = document.getElementById('event-enabled')
  const eventFields = document.getElementById('event-fields')
  const eventTitleInput = document.getElementById('event-title')
  const eventDescriptionInput = document.getElementById('event-description')
  const eventLocationInput = document.getElementById('event-location')
  const eventStartAtInput = document.getElementById('event-start-at')
  const eventEndAtInput = document.getElementById('event-end-at')
  const watchpartyEnabledInput = document.getElementById('watchparty-enabled')
  const watchpartyFields = document.getElementById('watchparty-fields')
  const watchpartyChannelNameInput = document.getElementById('watchparty-channel-name')
  const watchpartyStartAtInput = document.getElementById('watchparty-start-at')
  const watchpartyEndAtInput = document.getElementById('watchparty-end-at')

  if (titleInput) {
    titleInput.value = payload.title ?? ''
  }

  if (contentTextarea) {
    contentTextarea.value = payload.content ?? ''
  }

  if (channelSelect) {
    channelSelect.value = payload.channelId ?? ''
  }

  if (pingToggle) {
    pingToggle.checked = payload.mentionRoleEnabled === true
  }

  renderPingRoleSelector()
  if (pingSelect) {
    pingSelect.value = payload.mentionRoleId ?? ''
    pingSelect.disabled = !(pingToggle?.checked ?? false)
  }

  if (imageModeSelect) {
    imageModeSelect.value = payload.imageMode ?? 'none'
  }

  selectedImageName = payload.imageMode === 'library'
    ? (payload.imageFilename ?? null)
    : null
  selectedUploadFile = null
  scheduledStoredUpload = null
  clearUploadPreviewUrl()

  if (payload.imageMode === 'upload' && payload.uploadBase64) {
    scheduledStoredUpload = {
      uploadFileName: payload.uploadFileName ?? '',
      uploadMimeType: payload.uploadMimeType ?? '',
      uploadBase64: payload.uploadBase64,
    }

    const fileNameElement = document.getElementById('upload-file-name')
    if (fileNameElement) {
      fileNameElement.textContent = payload.uploadFileName
        ? `Zachowano: ${payload.uploadFileName}`
        : 'Zachowano zapisany upload.'
    }
  } else {
    const fileNameElement = document.getElementById('upload-file-name')
    if (fileNameElement) {
      fileNameElement.textContent = 'Nie wybrano pliku.'
    }
  }

  if (matchHelperEnabledInput) {
    const hasMatch = Boolean(payload.matchInfo?.matchId)
    matchHelperEnabledInput.checked = hasMatch
    selectedMatchInfo = hasMatch
      ? {
        ...payload.matchInfo,
        beginAtTimestamp: payload.matchInfo?.beginAtUtc ? Date.parse(payload.matchInfo.beginAtUtc) : null,
      }
      : null
  }

  const matchHelperSearchInput = document.getElementById('match-helper-search')
  const matchHelperSelectInput = document.getElementById('match-helper-select')
  if (matchHelperSearchInput) {
    matchHelperSearchInput.disabled = !(matchHelperEnabledInput?.checked ?? false)
  }

  if (matchHelperSelectInput) {
    matchHelperSelectInput.disabled = !(matchHelperEnabledInput?.checked ?? false)
  }

  renderMatchHelperOptions()
  renderMatchHelperChips(selectedMatchInfo)

  const eventEnabled = Boolean(payload.eventDraft?.enabled)
  if (eventEnabledInput) {
    eventEnabledInput.checked = eventEnabled
  }

  if (eventFields) {
    eventFields.hidden = !eventEnabled
  }

  if (eventTitleInput) {
    eventTitleInput.value = payload.eventDraft?.title ?? ''
  }

  if (eventDescriptionInput) {
    eventDescriptionInput.value = payload.eventDraft?.description ?? ''
  }

  if (eventLocationInput) {
    eventLocationInput.value = payload.eventDraft?.location ?? ''
  }

  if (eventStartAtInput) {
    eventStartAtInput.value = payload.eventDraft?.startAtLocal ?? ''
  }

  if (eventEndAtInput) {
    eventEndAtInput.value = payload.eventDraft?.endAtLocal ?? ''
  }

  const watchpartyEnabled = Boolean(payload.watchpartyDraft?.enabled)
  if (watchpartyEnabledInput) {
    watchpartyEnabledInput.checked = watchpartyEnabled
  }

  if (watchpartyFields) {
    watchpartyFields.hidden = !watchpartyEnabled
  }

  if (watchpartyChannelNameInput) {
    watchpartyChannelNameInput.value = payload.watchpartyDraft?.channelName ?? ''
  }

  if (watchpartyStartAtInput) {
    watchpartyStartAtInput.value = payload.watchpartyDraft?.startAtLocal ?? ''
  }

  if (watchpartyEndAtInput) {
    watchpartyEndAtInput.value = payload.watchpartyDraft?.endAtLocal ?? ''
  }

  updateModeUI()
  updateImagePanels()
  renderImageLibrary(images)

  document.querySelectorAll('.color-swatch').forEach((swatch) => {
    swatch.classList.toggle('active', swatch.dataset.color === selectedColor)
  })

}

async function deleteScheduledPost(postId) {
  const shouldDelete = window.confirm('Czy na pewno chcesz usunąć zaplanowany post?')
  if (!shouldDelete) {
    return
  }

  try {
    const response = await fetchWithCsrf(`/api/scheduled/${encodeURIComponent(postId)}`, {
      method: 'DELETE',
    })
    const json = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(json.error ?? 'Nie udało się usunąć zaplanowanego posta.')
    }

    if (editingScheduledPostId === postId) {
      editingScheduledPostId = null
    }

    await loadScheduledPosts()
    showToast('🗑️ Zaplanowany post został usunięty.', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd'
    showToast(`❌ ${message}`, 'error')
  }
}

async function retrySentPostEvent(postId) {
  try {
    const response = await fetchWithCsrf(`/api/scheduled/sent/${encodeURIComponent(postId)}/retry-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const json = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(json.error ?? 'Nie udało się ponowić tworzenia wydarzenia Discord.')
    }

    await loadSentPosts()
    showToast('✅ Wydarzenie Discord zostało utworzone.', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd'
    showToast(`❌ ${message}`, 'error')
  }
}

async function deleteSentPost(postId) {
  const shouldDelete = window.confirm('Czy na pewno chcesz usunąć wysłany post z historii?')
  if (!shouldDelete) {
    return
  }

  try {
    const response = await fetchWithCsrf(`/api/scheduled/sent/${encodeURIComponent(postId)}`, {
      method: 'DELETE',
    })

    const json = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(json.error ?? 'Nie udało się usunąć wysłanego posta.')
    }

    if (editingSentPostId === postId) {
      editingSentPostId = null
    }

    await loadSentPosts()
    showToast('🗑️ Wysłany post został usunięty z historii.', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd'
    showToast(`❌ ${message}`, 'error')
  }
}

function formatTimestampInWarsaw(timestamp) {
  return new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}

function formatTimestampForDateTimeInput(timestamp) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))

  return parts.replace(' ', 'T')
}

function initializeTimestampInput() {
  const timestampInput = document.getElementById('timestamp-datetime')
  if (!timestampInput || timestampInput.value) {
    return
  }

  timestampInput.value = formatTimestampForDateTimeInput(Date.now())
}

function resolveTimestampInsertUnix() {
  const timestampInput = document.getElementById('timestamp-datetime')
  const dateTimeValue = timestampInput?.value?.trim() ?? ''

  if (!dateTimeValue) {
    return Math.floor(Date.now() / 1000)
  }

  const timestamp = Date.parse(dateTimeValue)
  if (!Number.isFinite(timestamp)) {
    return null
  }

  return Math.floor(timestamp / 1000)
}

function bindG2SectionListeners() {
  const refreshButton = document.getElementById('g2-refresh-btn')
  const gameFilter = document.getElementById('g2-filter-game')
  const g2TeamFilter = document.getElementById('g2-filter-g2-team')
  const tournamentFilter = document.getElementById('g2-filter-tournament')
  const statusFilter = document.getElementById('g2-filter-status')
  const opponentFilter = document.getElementById('g2-filter-opponent')

  refreshButton?.addEventListener('click', async () => {
    await refreshG2Matches()
  })

  const triggerFilterReload = () => {
    if (g2FilterDebounceId) {
      clearTimeout(g2FilterDebounceId)
    }

    g2FilterDebounceId = setTimeout(async () => {
      await loadG2Matches({ silent: true })
    }, 220)
  }

  gameFilter?.addEventListener('change', triggerFilterReload)
  g2TeamFilter?.addEventListener('change', triggerFilterReload)
  tournamentFilter?.addEventListener('change', triggerFilterReload)
  statusFilter?.addEventListener('change', triggerFilterReload)
  opponentFilter?.addEventListener('input', triggerFilterReload)
}

function bindEconomySectionListeners() {
  const reloadButton = document.getElementById('economy-settings-reload-btn')
  const saveButton = document.getElementById('economy-settings-save-btn')
  const resetUsersButton = document.getElementById('economy-settings-reset-users-btn')

  reloadButton?.addEventListener('click', async () => {
    await loadEconomySettings({ silent: false })
  })

  saveButton?.addEventListener('click', async () => {
    await saveEconomySettings()
  })

  resetUsersButton?.addEventListener('click', async () => {
    await resetAllEconomyUsers()
  })
}

function bindEconomyLeaderboardSectionListeners() {
  const refreshButton = document.getElementById('economy-leaderboard-refresh-btn')
  const sortSelect = document.getElementById('economy-leaderboard-sort')
  const prevButton = document.getElementById('economy-leaderboard-prev-btn')
  const nextButton = document.getElementById('economy-leaderboard-next-btn')

  refreshButton?.addEventListener('click', async () => {
    await loadEconomyLeaderboard({ silent: false })
  })

  sortSelect?.addEventListener('change', async () => {
    const nextSortBy = sortSelect.value === 'coins' ? 'coins' : 'xp'
    await loadEconomyLeaderboard({
      silent: false,
      sortBy: nextSortBy,
      page: 1,
    })
  })

  prevButton?.addEventListener('click', async () => {
    if (economyLeaderboardPage <= 1) {
      return
    }

    await loadEconomyLeaderboard({
      silent: false,
      page: economyLeaderboardPage - 1,
    })
  })

  nextButton?.addEventListener('click', async () => {
    if (economyLeaderboardPage >= economyLeaderboardTotalPages) {
      return
    }

    await loadEconomyLeaderboard({
      silent: false,
      page: economyLeaderboardPage + 1,
    })
  })
}

function renderEconomyLeaderboard() {
  const list = document.getElementById('economy-leaderboard-list')
  const countLabel = document.getElementById('economy-leaderboard-count-label')
  const pageLabel = document.getElementById('economy-leaderboard-page-label')
  const prevButton = document.getElementById('economy-leaderboard-prev-btn')
  const nextButton = document.getElementById('economy-leaderboard-next-btn')
  const sortSelect = document.getElementById('economy-leaderboard-sort')

  if (!list || !countLabel || !pageLabel) {
    return
  }

  if (sortSelect) {
    sortSelect.value = economyLeaderboardSortBy
  }

  countLabel.textContent = `Uzytkownicy: ${economyLeaderboardTotalRows}`
  pageLabel.textContent = `Strona ${economyLeaderboardPage}/${economyLeaderboardTotalPages}`

  if (prevButton instanceof HTMLButtonElement) {
    prevButton.disabled = economyLeaderboardPage <= 1
  }

  if (nextButton instanceof HTMLButtonElement) {
    nextButton.disabled = economyLeaderboardPage >= economyLeaderboardTotalPages
  }

  const errorBlock = economyLeaderboardLoadError
    ? `<div class="scheduled-empty scheduled-error">Nie udalo sie odswiezyc leaderboardu: ${escapeHtml(economyLeaderboardLoadError)}</div>`
    : ''

  if (economyLeaderboardEntries.length === 0) {
    list.innerHTML = economyLeaderboardLoadError
      ? errorBlock
      : '<div class="scheduled-empty">Brak danych w leaderboardzie ekonomii.</div>'
    return
  }

  list.innerHTML = `${errorBlock}${economyLeaderboardEntries.map((entry) => {
    const displayName = typeof entry.displayName === 'string' && entry.displayName.trim().length > 0
      ? entry.displayName.trim()
      : `Uzytkownik ${entry.userId}`
    const avatarUrl = typeof entry.avatarUrl === 'string' && entry.avatarUrl.trim().length > 0
      ? entry.avatarUrl.trim()
      : null
    const avatarFallback = escapeHtml(displayName.slice(0, 1).toUpperCase() || '?')
    const level = Number.isFinite(Number(entry.level)) ? Number(entry.level) : 0
    const xp = Number.isFinite(Number(entry.xp)) ? Number(entry.xp) : 0
    const coins = Number.isFinite(Number(entry.coins)) ? Number(entry.coins) : 0
    const xpIntoLevel = Number.isFinite(Number(entry.xpIntoLevel)) ? Number(entry.xpIntoLevel) : 0
    const xpForNextLevel = Number.isFinite(Number(entry.xpForNextLevel)) ? Math.max(1, Number(entry.xpForNextLevel)) : 1
    const xpToNextLevel = Number.isFinite(Number(entry.xpToNextLevel)) ? Math.max(0, Number(entry.xpToNextLevel)) : 0
    const progressLabel = `${xpIntoLevel}/${xpForNextLevel} XP`
    const primaryLabel = economyLeaderboardSortBy === 'coins'
      ? `Coins: ${coins}`
      : `Level ${level} | ${progressLabel}`

    return `
      <article class="scheduled-card">
        <div class="scheduled-card-header">
          <div class="leaderboard-user-main">
            ${avatarUrl
      ? `<img class="leaderboard-avatar" src="${escapeHtml(avatarUrl)}" alt="Avatar ${escapeHtml(displayName)}" loading="lazy">`
      : `<span class="leaderboard-avatar leaderboard-avatar-placeholder">${avatarFallback}</span>`}
            <span class="scheduled-card-title">#${escapeHtml(String(entry.rank))} | ${escapeHtml(displayName)}</span>
          </div>
          <span class="scheduled-chip leaderboard-chip-primary">${escapeHtml(primaryLabel)}</span>
        </div>
        <div class="scheduled-card-meta">
          <span class="scheduled-chip">ID: ${escapeHtml(String(entry.userId))}</span>
          <span class="scheduled-chip leaderboard-chip-coins">Coins: ${escapeHtml(String(coins))}</span>
          <span class="scheduled-chip">Level: ${escapeHtml(String(level))}</span>
          <span class="scheduled-chip">Calkowity XP: ${escapeHtml(String(xp))}</span>
          <span class="scheduled-chip">Postep: ${escapeHtml(progressLabel)}</span>
          <span class="scheduled-chip">Brakujace XP: ${escapeHtml(String(xpToNextLevel))}</span>
        </div>
      </article>`
  }).join('')}`
}

async function loadEconomyLeaderboard({
  silent = false,
  sortBy,
  page,
} = {}) {
  economyLeaderboardLoadRequestId += 1
  const requestId = economyLeaderboardLoadRequestId

  const requestedSortBy = sortBy === 'coins' ? 'coins' : (sortBy === 'xp' ? 'xp' : economyLeaderboardSortBy)
  const requestedPage = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : economyLeaderboardPage

  const previousState = {
    sortBy: economyLeaderboardSortBy,
    page: economyLeaderboardPage,
    totalPages: economyLeaderboardTotalPages,
    totalRows: economyLeaderboardTotalRows,
    entries: [...economyLeaderboardEntries],
  }

  try {
    const params = new URLSearchParams({
      sortBy: requestedSortBy,
      page: String(requestedPage),
      pageSize: '10',
    })

    const response = await fetch(`/api/economy/leaderboard?${params.toString()}`)
    const payload = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie pobrac leaderboardu ekonomii.')
    }

    if (requestId !== economyLeaderboardLoadRequestId) {
      return
    }

    if (!payload.leaderboard || typeof payload.leaderboard !== 'object') {
      throw new Error('Nieprawidlowy format odpowiedzi leaderboardu ekonomii.')
    }

    const leaderboard = payload.leaderboard
    economyLeaderboardSortBy = leaderboard.sortBy === 'coins' ? 'coins' : 'xp'
    economyLeaderboardPage = Number.isFinite(Number(leaderboard.page)) ? Math.max(1, Number(leaderboard.page)) : 1
    economyLeaderboardTotalPages = Number.isFinite(Number(leaderboard.totalPages))
      ? Math.max(1, Number(leaderboard.totalPages))
      : 1
    economyLeaderboardTotalRows = Number.isFinite(Number(leaderboard.totalRows))
      ? Math.max(0, Number(leaderboard.totalRows))
      : 0
    economyLeaderboardEntries = Array.isArray(leaderboard.entries) ? leaderboard.entries : []
    economyLeaderboardLoadError = null

    renderEconomyLeaderboard()
  } catch (error) {
    if (requestId !== economyLeaderboardLoadRequestId) {
      return
    }

    economyLeaderboardSortBy = previousState.sortBy
    economyLeaderboardPage = previousState.page
    economyLeaderboardTotalPages = previousState.totalPages
    economyLeaderboardTotalRows = previousState.totalRows
    economyLeaderboardEntries = previousState.entries
    economyLeaderboardLoadError = error instanceof Error ? error.message : 'Nieznany blad'
    renderEconomyLeaderboard()

    if (!silent) {
      showToast(`❌ ${economyLeaderboardLoadError}`, 'error')
    }
  }
}

function setEconomySettingsLastLoadedLabel() {
  const label = document.getElementById('economy-settings-last-loaded')
  if (!label) {
    return
  }

  if (!economySettingsLastLoadedAt) {
    label.textContent = 'Brak danych.'
    return
  }

  label.textContent = `Ostatnio odswiezono: ${formatTimestampInWarsaw(economySettingsLastLoadedAt)}`
}

function toFiniteNumber(value, fieldName) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    throw new Error(`Pole "${fieldName}" musi byc poprawna liczba.`)
  }

  return numeric
}

function readEconomyInputValue(inputId) {
  const element = document.getElementById(inputId)
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
    throw new Error('Brakuje jednego z pol formularza ekonomii.')
  }

  return element.value
}

function readEconomyCheckboxValue(inputId) {
  const element = document.getElementById(inputId)
  if (!(element instanceof HTMLInputElement)) {
    throw new Error('Brakuje jednego z pol formularza ekonomii.')
  }

  return element.checked
}

function collectEconomySettingsForm() {
  const dailyMinCoins = Math.floor(toFiniteNumber(readEconomyInputValue('economy-daily-min'), 'Daily: min coins'))
  const dailyMaxCoins = Math.floor(toFiniteNumber(readEconomyInputValue('economy-daily-max'), 'Daily: max coins'))
  const dailyStreakIncrement = toFiniteNumber(readEconomyInputValue('economy-daily-streak-increment'), 'Daily: przyrost streak')
  const dailyStreakMaxDays = Math.floor(toFiniteNumber(readEconomyInputValue('economy-daily-streak-max-days'), 'Daily: max dni streak'))
  const dailyStreakGraceHours = Math.floor(toFiniteNumber(readEconomyInputValue('economy-daily-streak-grace-hours'), 'Daily: grace (godziny)'))
  const dailyMessages = readEconomyInputValue('economy-daily-messages')
    .split(/\r?\n/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  const levelingMode = readEconomyInputValue('economy-leveling-mode')
  const levelingBaseXp = Math.floor(toFiniteNumber(readEconomyInputValue('economy-leveling-base-xp'), 'Leveling: base XP'))
  const levelingExponent = toFiniteNumber(readEconomyInputValue('economy-leveling-exponent'), 'Leveling: exponent')
  const xpTextPerMessage = Math.floor(toFiniteNumber(readEconomyInputValue('economy-xp-text-per-message'), 'XP text: za wiadomosc'))
  const xpTextCooldownSeconds = Math.floor(toFiniteNumber(readEconomyInputValue('economy-xp-text-cooldown-seconds'), 'XP text: cooldown'))
  const xpVoicePerMinute = Math.floor(toFiniteNumber(readEconomyInputValue('economy-xp-voice-per-minute'), 'XP voice: za minute'))
  const watchpartyXpMultiplier = toFiniteNumber(readEconomyInputValue('economy-watchparty-xp-multiplier'), 'Watchparty: mnoznik XP')
  const watchpartyCoinBonusPerMinute = Math.floor(toFiniteNumber(readEconomyInputValue('economy-watchparty-coin-bonus-per-minute'), 'Watchparty: bonus coin/min'))
  const levelUpCoinsBase = Math.floor(toFiniteNumber(readEconomyInputValue('economy-level-up-coins-base'), 'Level-up: base coins'))
  const levelUpCoinsPerLevel = Math.floor(toFiniteNumber(readEconomyInputValue('economy-level-up-coins-per-level'), 'Level-up: bonus per level'))

  if (dailyMaxCoins < dailyMinCoins) {
    throw new Error('Daily: max coins nie moze byc mniejsze niz min coins.')
  }

  if (dailyMessages.length === 0) {
    throw new Error('Podaj co najmniej jedna wiadomosc daily.')
  }

  if (levelingMode !== 'progressive' && levelingMode !== 'linear') {
    throw new Error('Nieprawidlowy tryb levelowania.')
  }

  return {
    dailyMinCoins,
    dailyMaxCoins,
    dailyStreakIncrement,
    dailyStreakMaxDays,
    dailyStreakGraceHours,
    dailyMessages,
    levelingMode,
    levelingBaseXp,
    levelingExponent,
    xpTextPerMessage,
    xpTextCooldownSeconds,
    xpVoicePerMinute,
    xpVoiceRequireTwoUsers: readEconomyCheckboxValue('economy-xp-voice-require-two-users'),
    xpVoiceAllowSelfMute: readEconomyCheckboxValue('economy-xp-voice-allow-self-mute'),
    xpVoiceAllowSelfDeaf: readEconomyCheckboxValue('economy-xp-voice-allow-self-deaf'),
    xpVoiceAllowAfk: readEconomyCheckboxValue('economy-xp-voice-allow-afk'),
    watchpartyXpMultiplier,
    watchpartyCoinBonusPerMinute,
    levelUpCoinsBase,
    levelUpCoinsPerLevel,
  }
}

function setEconomySettingsForm(config) {
  const setValue = (inputId, value) => {
    const element = document.getElementById(inputId)
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      element.value = String(value)
    }
  }

  const setChecked = (inputId, value) => {
    const element = document.getElementById(inputId)
    if (element instanceof HTMLInputElement) {
      element.checked = value === true
    }
  }

  setValue('economy-daily-min', config.dailyMinCoins)
  setValue('economy-daily-max', config.dailyMaxCoins)
  setValue('economy-daily-streak-increment', config.dailyStreakIncrement)
  setValue('economy-daily-streak-max-days', config.dailyStreakMaxDays)
  setValue('economy-daily-streak-grace-hours', config.dailyStreakGraceHours)
  setValue('economy-daily-messages', Array.isArray(config.dailyMessages) ? config.dailyMessages.join('\n') : '')
  setValue('economy-leveling-mode', config.levelingMode)
  setValue('economy-leveling-base-xp', config.levelingBaseXp)
  setValue('economy-leveling-exponent', config.levelingExponent)
  setValue('economy-xp-text-per-message', config.xpTextPerMessage)
  setValue('economy-xp-text-cooldown-seconds', config.xpTextCooldownSeconds)
  setValue('economy-xp-voice-per-minute', config.xpVoicePerMinute)
  setValue('economy-watchparty-xp-multiplier', config.watchpartyXpMultiplier)
  setValue('economy-watchparty-coin-bonus-per-minute', config.watchpartyCoinBonusPerMinute)
  setChecked('economy-xp-voice-require-two-users', config.xpVoiceRequireTwoUsers)
  setChecked('economy-xp-voice-allow-self-mute', config.xpVoiceAllowSelfMute)
  setChecked('economy-xp-voice-allow-self-deaf', config.xpVoiceAllowSelfDeaf)
  setChecked('economy-xp-voice-allow-afk', config.xpVoiceAllowAfk)
  setValue('economy-level-up-coins-base', config.levelUpCoinsBase)
  setValue('economy-level-up-coins-per-level', config.levelUpCoinsPerLevel)
}

async function loadEconomySettings({ silent } = { silent: false }) {
  economySettingsLoadRequestId += 1
  const requestId = economySettingsLoadRequestId

  try {
    const response = await fetch('/api/economy/settings')
    const payload = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie pobrac ustawien ekonomii.')
    }

    if (requestId !== economySettingsLoadRequestId) {
      return
    }

    if (!payload.config || typeof payload.config !== 'object') {
      throw new Error('Nieprawidlowy format odpowiedzi ustawien ekonomii.')
    }

    setEconomySettingsForm(payload.config)
    economySettingsLastLoadedAt = Date.now()
    economySettingsLoadSuccessful = true
    setEconomySettingsLastLoadedLabel()
  } catch (error) {
    if (requestId !== economySettingsLoadRequestId) {
      return
    }

    economySettingsLoadSuccessful = false

    if (!silent) {
      const message = error instanceof Error ? error.message : 'Nieznany blad'
      showToast(`❌ ${message}`, 'error')
    }
  }
}

async function saveEconomySettings() {
  if (!economySettingsLoadSuccessful) {
    showToast('❌ Najpierw odswiez ustawienia ekonomii i upewnij sie, ze ladowanie zakonczylo sie sukcesem.', 'error')
    return
  }

  const saveButton = document.getElementById('economy-settings-save-btn')
  if (saveButton instanceof HTMLButtonElement) {
    saveButton.disabled = true
  }

  try {
    const requestBody = collectEconomySettingsForm()
    const response = await fetchWithCsrf('/api/economy/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    const payload = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie zapisac ustawien ekonomii.')
    }

    if (!payload.config || typeof payload.config !== 'object') {
      throw new Error('Brak konfiguracji ekonomii w odpowiedzi serwera.')
    }

    setEconomySettingsForm(payload.config)
    economySettingsLastLoadedAt = Date.now()
    setEconomySettingsLastLoadedLabel()
    showToast('✅ Ustawienia ekonomii zostaly zapisane.', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany blad'
    showToast(`❌ ${message}`, 'error')
  } finally {
    if (saveButton instanceof HTMLButtonElement) {
      saveButton.disabled = false
    }
  }
}

async function resetAllEconomyUsers() {
  if (!economySettingsLoadSuccessful) {
    showToast('❌ Najpierw odswiez ustawienia ekonomii i upewnij sie, ze ladowanie zakonczylo sie sukcesem.', 'error')
    return
  }

  const confirmed = window.confirm('Czy na pewno zresetowac dane ekonomii wszystkich uzytkownikow na tym serwerze? Tej operacji nie da sie cofnac.')
  if (!confirmed) {
    return
  }

  const resetButton = document.getElementById('economy-settings-reset-users-btn')
  if (resetButton instanceof HTMLButtonElement) {
    resetButton.disabled = true
  }

  try {
    const response = await fetchWithCsrf('/api/economy/reset-users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })

    const payload = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie zresetowac danych ekonomii.')
    }

    const resetCount = Number(payload.resetCount ?? 0)
    showToast(`✅ Zresetowano dane ekonomii dla ${resetCount} uzytkownikow.`, 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany blad'
    showToast(`❌ ${message}`, 'error')
  } finally {
    if (resetButton instanceof HTMLButtonElement) {
      resetButton.disabled = false
    }
  }
}

async function loadG2Matches({ silent } = { silent: false }) {
  g2LoadRequestId += 1
  const requestId = g2LoadRequestId

  const params = buildG2FilterQueryParams()
  const query = params.toString()
  const requestUrl = query ? `/api/g2-matches?${query}` : '/api/g2-matches'

  try {
    const response = await fetch(requestUrl)
    const payload = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udało się pobrać bazy meczów G2.')
    }

    if (requestId !== g2LoadRequestId) {
      return
    }

    g2Matches = Array.isArray(payload.matches) ? payload.matches : []
    g2FilterOptions = payload.filters ?? { games: [], g2Teams: [], tournaments: [], statuses: [] }
    g2SyncMeta = payload.meta ?? null
    g2RefreshInProgress = Boolean(payload.refreshInProgress)
    g2RefreshCooldownMs = Number.isFinite(payload.refreshCooldownMs) ? payload.refreshCooldownMs : 30000

    renderG2Filters()
    renderG2MatchesList()
    updateG2Meta()
    renderMatchHelperOptions()
  } catch (error) {
    if (requestId !== g2LoadRequestId) {
      return
    }

    g2Matches = []
    g2FilterOptions = {
      games: [],
      g2Teams: [],
      tournaments: [],
      statuses: [],
    }
    g2SyncMeta = null
    g2RefreshInProgress = false
    renderG2Filters()
    renderG2MatchesList()
    updateG2Meta()
    renderMatchHelperOptions()

    if (!silent) {
      const message = error instanceof Error ? error.message : 'Nieznany błąd'
      showToast(`❌ ${message}`, 'error')
    }
  }
}

async function refreshG2Matches() {
  const button = document.getElementById('g2-refresh-btn')
  if (!button) {
    return
  }

  if (g2RefreshInProgress) {
    showToast('Trwa odświeżanie meczów. Poczekaj chwilę.', 'info')
    return
  }

  button.disabled = true

  try {
    const response = await fetchWithCsrf('/api/g2-matches/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const payload = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udało się odświeżyć meczów z PandaScore.')
    }

    showToast(`✅ Odświeżono bazę meczów (${payload.count ?? 0}).`, 'success')
    window.setTimeout(() => {
      window.location.reload()
    }, 250)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd'
    showToast(`❌ ${message}`, 'error')
  } finally {
    button.disabled = false
  }
}

function buildG2FilterQueryParams() {
  const gameFilter = document.getElementById('g2-filter-game')
  const g2TeamFilter = document.getElementById('g2-filter-g2-team')
  const tournamentFilter = document.getElementById('g2-filter-tournament')
  const statusFilter = document.getElementById('g2-filter-status')
  const opponentFilter = document.getElementById('g2-filter-opponent')

  const params = new URLSearchParams()

  const game = gameFilter?.value?.trim() ?? ''
  const g2Team = g2TeamFilter?.value?.trim() ?? ''
  const tournament = tournamentFilter?.value?.trim() ?? ''
  const status = statusFilter?.value?.trim() ?? ''
  const opponent = opponentFilter?.value?.trim() ?? ''

  if (game) params.set('game', game)
  if (g2Team) params.set('g2Team', g2Team)
  if (tournament) params.set('tournament', tournament)
  if (status) params.set('status', status)
  if (opponent) params.set('opponent', opponent)

  params.set('limit', '400')
  params.set('offset', '0')

  return params
}

function renderG2Filters() {
  const gameFilter = document.getElementById('g2-filter-game')
  const g2TeamFilter = document.getElementById('g2-filter-g2-team')
  const tournamentFilter = document.getElementById('g2-filter-tournament')
  const statusFilter = document.getElementById('g2-filter-status')

  if (!gameFilter || !g2TeamFilter || !tournamentFilter || !statusFilter) {
    return
  }

  const selectedGame = gameFilter.value
  const selectedG2Team = g2TeamFilter.value
  const selectedTournament = tournamentFilter.value
  const selectedStatus = statusFilter.value

  gameFilter.innerHTML = [
    '<option value="">Wszystkie gry</option>',
    ...g2FilterOptions.games.map((game) => `<option value="${escapeHtml(game)}">${escapeHtml(game)}</option>`),
  ].join('')

  g2TeamFilter.innerHTML = [
    '<option value="">Wszystkie drużyny G2</option>',
    ...g2FilterOptions.g2Teams.map((teamName) => `<option value="${escapeHtml(teamName)}">${escapeHtml(teamName)}</option>`),
  ].join('')

  tournamentFilter.innerHTML = [
    '<option value="">Wszystkie turnieje</option>',
    ...g2FilterOptions.tournaments.map((tournament) => `<option value="${escapeHtml(tournament)}">${escapeHtml(tournament)}</option>`),
  ].join('')

  statusFilter.innerHTML = [
    '<option value="">Wszystkie statusy</option>',
    ...g2FilterOptions.statuses.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`),
  ].join('')

  gameFilter.value = g2FilterOptions.games.includes(selectedGame) ? selectedGame : ''
  g2TeamFilter.value = g2FilterOptions.g2Teams.includes(selectedG2Team) ? selectedG2Team : ''
  tournamentFilter.value = g2FilterOptions.tournaments.includes(selectedTournament) ? selectedTournament : ''
  statusFilter.value = g2FilterOptions.statuses.includes(selectedStatus) ? selectedStatus : ''
}

function renderG2MatchesList() {
  const list = document.getElementById('g2-matches-list')
  const countLabel = document.getElementById('g2-count-label')

  if (!list || !countLabel) {
    return
  }

  countLabel.textContent = `Mecze: ${g2Matches.length}`

  if (g2Matches.length === 0) {
    list.innerHTML = '<div class="scheduled-empty">Brak meczów spełniających aktualne filtry. Odśwież bazę lub zmień filtry.</div>'
    return
  }

  list.innerHTML = g2Matches.map((match) => {
    return `
      <article class="scheduled-card">
        <div class="scheduled-card-header">
          <span class="scheduled-card-title">${escapeHtml(match.game)} | ${escapeHtml(match.g2TeamName ?? 'G2 Esports')} vs ${escapeHtml(match.opponent)}</span>
          <span class="scheduled-chip">${escapeHtml(match.matchType)}</span>
        </div>
        <div class="scheduled-card-meta">
          <span class="scheduled-chip">Turniej: ${escapeHtml(match.tournament)}</span>
          <span class="scheduled-chip">Data: ${escapeHtml(match.date)} ${escapeHtml(match.time)}</span>
          <span class="scheduled-chip">Status: ${escapeHtml(match.status)}</span>
        </div>
      </article>`
  }).join('')
}

function updateG2Meta() {
  const metaLabel = document.getElementById('g2-sync-meta')
  if (!metaLabel) {
    return
  }

  if (!g2SyncMeta || !g2SyncMeta.lastSyncAt) {
    metaLabel.textContent = 'Brak synchronizacji.'
    return
  }

  const syncTimestamp = Number(g2SyncMeta.lastSyncAt)
  const formatted = formatTimestampInWarsaw(syncTimestamp)

  let metaText = `Ostatnia synchronizacja: ${formatted} | Rekordy: ${g2SyncMeta.lastSyncCount ?? 0}`
  if (g2SyncMeta.lastError) {
    metaText += ` | Ostatni błąd: ${g2SyncMeta.lastError}`
  }

  if (g2RefreshInProgress) {
    metaText += ' | Trwa odświeżanie...'
  }

  if (g2RefreshCooldownMs > 0) {
    metaText += ` | Cooldown: ${Math.ceil(g2RefreshCooldownMs / 1000)} s`
  }

  metaLabel.textContent = metaText
}

function getFutureG2Matches() {
  const now = Date.now()
  return g2Matches.filter((match) => {
    const beginAtTimestamp = Number(match.beginAtTimestamp)
    return Number.isFinite(beginAtTimestamp) && beginAtTimestamp > now
  })
}

function findMatchById(matchId) {
  if (!matchId) {
    return null
  }

  return g2Matches.find((match) => match.matchId === matchId)
    ?? (selectedMatchInfo?.matchId === matchId ? selectedMatchInfo : null)
}

function renderMatchHelperOptions() {
  const enabled = document.getElementById('match-helper-enabled')?.checked ?? false
  const searchInput = document.getElementById('match-helper-search')
  const matchSelect = document.getElementById('match-helper-select')

  if (!searchInput || !matchSelect) {
    return
  }

  const search = String(searchInput.value ?? '').trim().toLowerCase()
  const availableMatches = getFutureG2Matches().filter((match) => {
    if (!search) {
      return true
    }

    return [
      match.g2TeamName,
      match.game,
      match.opponent,
      match.tournament,
      match.matchType,
      match.date,
      match.time,
    ].join(' ').toLowerCase().includes(search)
  })

  const previousValue = selectedMatchInfo?.matchId ?? matchSelect.value

  matchSelect.innerHTML = [
    '<option value="">Wybierz mecz...</option>',
    ...availableMatches.map((match) => {
      const optionLabel = `${match.date} ${match.time} | ${match.game} | ${match.g2TeamName ?? 'G2 Esports'} vs ${match.opponent} | ${match.tournament} | ${match.matchType}`
      return `<option value="${escapeHtml(match.matchId)}">${escapeHtml(optionLabel)}</option>`
    }),
  ].join('')

  if (selectedMatchInfo && !availableMatches.some((match) => match.matchId === selectedMatchInfo.matchId)) {
    const selectedLabel = `${selectedMatchInfo.date ?? ''} ${selectedMatchInfo.time ?? ''} | ${selectedMatchInfo.game ?? ''} | ${(selectedMatchInfo.g2TeamName ?? 'G2 Esports')} vs ${selectedMatchInfo.opponent ?? ''}`
    matchSelect.innerHTML += `<option value="${escapeHtml(selectedMatchInfo.matchId)}">${escapeHtml(selectedLabel)}</option>`
  }

  matchSelect.value = previousValue || ''
  matchSelect.disabled = !enabled
  searchInput.disabled = !enabled
}

function buildMatchHelperTokens(match) {
  if (!match) {
    return []
  }

  const timestamp = Number.isFinite(Number(match.beginAtTimestamp))
    ? Math.floor(Number(match.beginAtTimestamp) / 1000)
    : (match.beginAtUtc ? Math.floor(Date.parse(match.beginAtUtc) / 1000) : null)

  const teamsLabel = `${match.g2TeamName ?? 'G2 Esports'} vs ${match.opponent ?? 'TBD'}`
  const tokens = [
    { label: teamsLabel, token: teamsLabel },
    { label: match.game ?? '-', token: match.game ?? '-' },
    { label: match.matchType ?? '-', token: match.matchType ?? '-' },
    { label: match.tournament ?? '-', token: match.tournament ?? '-' },
  ]

  if (timestamp) {
    tokens.push(
      { label: 'Data', token: `<t:${timestamp}:d>` },
      { label: 'Godzina', token: `<t:${timestamp}:t>` },
      { label: 'Odliczanie', token: `<t:${timestamp}:R>` },
    )
  }

  return tokens
}

function renderMatchHelperChips(match) {
  const chipsContainer = document.getElementById('match-helper-chips')
  if (!chipsContainer) {
    return
  }

  const enabled = document.getElementById('match-helper-enabled')?.checked ?? false
  if (!enabled) {
    chipsContainer.innerHTML = '<p class="popover-empty">Włącz opcję „Dodaj mecz”, aby zobaczyć podpowiedzi.</p>'
    return
  }

  const tokens = buildMatchHelperTokens(match)
  if (!tokens.length) {
    chipsContainer.innerHTML = '<p class="popover-empty">Wybierz mecz, aby zobaczyć klikalne podpowiedzi.</p>'
    return
  }

  chipsContainer.innerHTML = tokens.map((entry) => (
    `<button type="button" class="mention-chip" data-token="${escapeHtml(entry.token)}">${escapeHtml(entry.label)}</button>`
  )).join('')
}

function updateEventDefaultsFromMatch() {
  const eventEnabled = document.getElementById('event-enabled')?.checked ?? false
  if (!eventEnabled || !selectedMatchInfo) {
    return
  }

  const eventTitleInput = document.getElementById('event-title')
  const eventDescriptionInput = document.getElementById('event-description')
  const eventLocationInput = document.getElementById('event-location')
  const eventStartAtInput = document.getElementById('event-start-at')
  const eventEndAtInput = document.getElementById('event-end-at')

  const beginAtTimestamp = Number(selectedMatchInfo.beginAtTimestamp)
  const hasMatchTime = Number.isFinite(beginAtTimestamp)

  if (eventTitleInput && !eventTitleInput.value.trim()) {
    eventTitleInput.value = `${selectedMatchInfo.g2TeamName ?? 'G2 Esports'} vs ${selectedMatchInfo.opponent ?? 'TBD'} | ${selectedMatchInfo.tournament ?? 'Mecz'}`
  }

  if (eventDescriptionInput && !eventDescriptionInput.value.trim()) {
    const game = selectedMatchInfo.game ?? 'Nieznana gra'
    const format = selectedMatchInfo.matchType ?? 'BO?'
    eventDescriptionInput.value = `Spotkanie: ${(selectedMatchInfo.g2TeamName ?? 'G2 Esports')} vs ${(selectedMatchInfo.opponent ?? 'TBD')}\nGra: ${game}\nFormat: ${format}\nTurniej: ${selectedMatchInfo.tournament ?? '-'}`
  }

  if (eventLocationInput && !eventLocationInput.value.trim()) {
    eventLocationInput.value = 'Online'
  }

  if (hasMatchTime) {
    if (eventStartAtInput && !eventStartAtInput.value.trim()) {
      eventStartAtInput.value = formatTimestampForDateTimeInput(beginAtTimestamp)
    }

    if (eventEndAtInput && !eventEndAtInput.value.trim()) {
      eventEndAtInput.value = formatTimestampForDateTimeInput(beginAtTimestamp + (2 * 60 * 60 * 1000))
    }
  }
}

function updateWatchpartyDefaultsFromMatch() {
  const watchpartyEnabled = document.getElementById('watchparty-enabled')?.checked ?? false
  if (!watchpartyEnabled || !selectedMatchInfo) {
    return
  }

  const watchpartyChannelNameInput = document.getElementById('watchparty-channel-name')
  const watchpartyStartAtInput = document.getElementById('watchparty-start-at')
  const watchpartyEndAtInput = document.getElementById('watchparty-end-at')

  const beginAtTimestamp = Number(selectedMatchInfo.beginAtTimestamp)
  const hasMatchTime = Number.isFinite(beginAtTimestamp)

  if (watchpartyChannelNameInput && !watchpartyChannelNameInput.value.trim()) {
    const teamName = selectedMatchInfo.g2TeamName ?? 'G2 Esports'
    const opponent = selectedMatchInfo.opponent ?? 'TBD'
    watchpartyChannelNameInput.value = `${teamName} vs ${opponent} | watchparty`
  }

  if (hasMatchTime) {
    if (watchpartyStartAtInput && !watchpartyStartAtInput.value.trim()) {
      watchpartyStartAtInput.value = formatTimestampForDateTimeInput(beginAtTimestamp - (10 * 60 * 1000))
    }

    if (watchpartyEndAtInput && !watchpartyEndAtInput.value.trim()) {
      watchpartyEndAtInput.value = formatTimestampForDateTimeInput(beginAtTimestamp + (130 * 60 * 1000))
    }
  }
}

async function loadChannels() {
  try {
    const resp = await fetch('/api/channels')
    if (!resp.ok) throw new Error('fetch failed')

    const json = await resp.json()
    channels = Array.isArray(json.channels) ? json.channels : []
  } catch {
    channels = []
    showToast('Nie udało się pobrać kanałów.', 'error')
  }
}

async function loadRoles() {
  try {
    const resp = await fetch('/api/roles')
    if (!resp.ok) throw new Error('fetch failed')

    const json = await resp.json()
    roles = Array.isArray(json.roles) ? json.roles : []
  } catch {
    roles = []
    showToast('Nie udało się pobrać ról.', 'error')
  }
}

async function loadImages() {
  try {
    const resp = await fetch('/api/images')
    if (!resp.ok) throw new Error('fetch failed')

    const json = await resp.json()
    images = Array.isArray(json.images) ? json.images : []
  } catch {
    images = []
    showToast('Nie udało się pobrać obrazów z /img.', 'error')
  }
}

async function loadEmojis() {
  try {
    const resp = await fetch('/api/emojis')
    if (!resp.ok) throw new Error('fetch failed')

    const json = await resp.json()
    emojis = Array.isArray(json.emojis) ? json.emojis : []
  } catch {
    emojis = []
    showToast('Nie udało się pobrać emotek.', 'error')
  }
}

function renderEmojiList(filterText) {
  const list = document.getElementById('emoji-list')
  if (!list) return

  const normalizedFilter = String(filterText ?? '').trim().toLowerCase()
  const filteredEmojis = normalizedFilter
    ? emojis.filter((emoji) => String(emoji.name ?? '').toLowerCase().includes(normalizedFilter))
    : emojis

  if (!filteredEmojis.length) {
    list.innerHTML = '<p class="popover-empty">Brak pasujących emotek.</p>'
    return
  }

  list.innerHTML = filteredEmojis.slice(0, 150).map((emoji) => {
    const emojiName = String(emoji.name ?? '').trim()
    if (!emojiName || !emoji.id) {
      return ''
    }

    const animatedPrefix = emoji.animated ? 'a' : ''
    const token = `<${animatedPrefix}:${emojiName}:${emoji.id}>`
    const ext = emoji.animated ? 'gif' : 'png'
    const src = `https://cdn.discordapp.com/emojis/${emoji.id}.${ext}?size=32&quality=lossless`

    return `
      <button type="button" class="emoji-chip" data-token="${escapeHtml(token)}" title=":${escapeHtml(emojiName)}:">
        <img src="${src}" alt=":${escapeHtml(emojiName)}:">
        <span>${escapeHtml(emojiName)}</span>
      </button>`
  }).join('')
}

function renderMentionChannelResults(results, queryText = '') {
  const container = document.getElementById('mention-channel-results')
  if (!container) return

  const normalizedQuery = String(queryText ?? '').trim()
  if (!results.length) {
    container.innerHTML = normalizedQuery.length < 2
      ? '<p class="popover-empty">Wpisz min. 2 znaki, aby wyszukać kanał.</p>'
      : '<p class="popover-empty">Brak kanałów pasujących do zapytania.</p>'
    return
  }

  container.innerHTML = results.map((channel) => (
    `<button type="button" class="mention-chip" data-token="&lt;#${channel.id}&gt;">#${escapeHtml(channel.name)}</button>`
  )).join('')
}

function renderMentionRoleResults(results, queryText = '') {
  const container = document.getElementById('mention-role-results')
  if (!container) return

  const normalizedQuery = String(queryText ?? '').trim()
  if (!results.length) {
    container.innerHTML = normalizedQuery.length < 2
      ? '<p class="popover-empty">Wpisz min. 2 znaki, aby wyszukać rolę.</p>'
      : '<p class="popover-empty">Brak ról pasujących do zapytania.</p>'
    return
  }

  container.innerHTML = results.map((role) => (
    `<button type="button" class="mention-chip" data-token="&lt;@&${role.id}&gt;">@${escapeHtml(role.name)}</button>`
  )).join('')
}

async function searchMentionChannels(rawQuery) {
  const query = String(rawQuery ?? '').trim()
  mentionChannelSearchRequestId += 1
  const requestId = mentionChannelSearchRequestId

  if (query.length < 2) {
    mentionChannelResults = []
    renderMentionChannelResults([], query)
    return
  }

  try {
    const resp = await fetch(`/api/channels/search?query=${encodeURIComponent(query)}`)
    if (!resp.ok) throw new Error('fetch failed')

    const json = await resp.json()
    if (requestId !== mentionChannelSearchRequestId) {
      return
    }

    mentionChannelResults = Array.isArray(json.channels) ? json.channels : []
    renderMentionChannelResults(mentionChannelResults, query)
  } catch {
    if (requestId !== mentionChannelSearchRequestId) {
      return
    }

    mentionChannelResults = []
    renderMentionChannelResults([], query)
    showToast('Nie udało się wyszukać kanałów.', 'error')
  }
}

async function searchMentionRoles(rawQuery) {
  const query = String(rawQuery ?? '').trim()
  mentionRoleSearchRequestId += 1
  const requestId = mentionRoleSearchRequestId

  if (query.length < 2) {
    mentionRoleResults = []
    renderMentionRoleResults([], query)
    return
  }

  try {
    const resp = await fetch(`/api/roles/search?query=${encodeURIComponent(query)}`)
    if (!resp.ok) throw new Error('fetch failed')

    const json = await resp.json()
    if (requestId !== mentionRoleSearchRequestId) {
      return
    }

    mentionRoleResults = Array.isArray(json.roles) ? json.roles : []
    renderMentionRoleResults(mentionRoleResults, query)
  } catch {
    if (requestId !== mentionRoleSearchRequestId) {
      return
    }

    mentionRoleResults = []
    renderMentionRoleResults([], query)
    showToast('Nie udało się wyszukać ról.', 'error')
  }
}

function renderMentionUserResults(results, queryText = '') {
  const container = document.getElementById('mention-user-results')
  if (!container) return

  const normalizedQuery = String(queryText ?? '').trim()
  if (!results.length) {
    container.innerHTML = normalizedQuery.length < 2
      ? '<p class="popover-empty">Wpisz min. 2 znaki, aby wyszukać użytkownika.</p>'
      : '<p class="popover-empty">Brak użytkowników pasujących do zapytania.</p>'
    return
  }

  container.innerHTML = results.map((member) => {
    const displayName = member.nick || member.globalName || member.username || 'użytkownik'
    return `
      <button type="button" class="mention-user-item" data-token="&lt;@${member.id}&gt;" title="@${escapeHtml(displayName)}">
        <span class="mention-user-name">${escapeHtml(displayName)}</span>
        <span class="mention-user-meta">@${escapeHtml(member.username || 'unknown')}</span>
      </button>`
  }).join('')
}

async function searchMentionUsers(rawQuery) {
  const query = String(rawQuery ?? '').trim()
  mentionUserSearchRequestId += 1
  const requestId = mentionUserSearchRequestId

  if (query.length < 2) {
    mentionUserResults = []
    renderMentionUserResults([], query)
    return
  }

  try {
    const resp = await fetch(`/api/members/search?query=${encodeURIComponent(query)}`)
    if (!resp.ok) throw new Error('fetch failed')

    const json = await resp.json()
    if (requestId !== mentionUserSearchRequestId) {
      return
    }

    mentionUserResults = Array.isArray(json.members) ? json.members : []

    mentionUserResults.forEach((member) => {
      if (!member?.id) return
      const displayName = member.nick || member.globalName || member.username || 'użytkownik'
      knownUsers.set(member.id, displayName)
    })

    renderMentionUserResults(mentionUserResults, query)
  } catch {
    if (requestId !== mentionUserSearchRequestId) {
      return
    }

    mentionUserResults = []
    renderMentionUserResults([], query)
    showToast('Nie udało się wyszukać użytkowników.', 'error')
  }
}

function renderChannelSelector() {
  const select = document.getElementById('channel-select')
  if (!select) return

  const previous = select.value
  select.innerHTML = [
    '<option value="">— wybierz kanał —</option>',
    ...channels.map((channel) => `<option value="${channel.id}">#${escapeHtml(channel.name)}</option>`),
  ].join('')

  select.value = channels.some((channel) => channel.id === previous) ? previous : ''
  select.disabled = channels.length === 0
}

function renderPingRoleSelector() {
  const select = document.getElementById('ping-role-select')
  if (!select) return

  const previous = select.value
  const options = [
    '<option value="">Wybierz ping (@everyone, @here lub rolę)</option>',
    '<option value="everyone">@everyone</option>',
    '<option value="here">@here</option>',
    ...roles.map((role) => `<option value="${role.id}">@${escapeHtml(role.name)}</option>`),
  ]

  if (
    previous
    && previous !== 'everyone'
    && previous !== 'here'
    && !roles.some((role) => role.id === previous)
  ) {
    options.push(`<option value="${escapeHtml(previous)}">@nieznana-rola (${escapeHtml(previous.slice(0, 6))}...)</option>`)
  }

  select.innerHTML = options.join('')
  select.value = previous
}

function renderImageLibrary(imageList) {
  const grid = document.getElementById('image-grid')
  if (!grid) return

  if (!imageList.length) {
    grid.innerHTML = '<p class="img-empty">Brak obrazów w folderze /img.</p>'
    return
  }

  grid.innerHTML = imageList.map((name) => `
    <div class="img-card${selectedImageName === name ? ' selected' : ''}" data-name="${escapeHtml(name)}" title="${escapeHtml(name)}">
      <img src="/img/${encodeURIComponent(name)}" alt="${escapeHtml(name)}" loading="lazy">
      <span class="img-card-name">${escapeHtml(name)}</span>
    </div>`).join('')

  grid.querySelectorAll('.img-card').forEach((card) => {
    card.addEventListener('click', () => {
      const nextName = card.dataset.name
      if (!nextName) return

      selectedImageName = nextName
      selectedUploadFile = null

      const uploadInput = document.getElementById('image-upload-input')
      if (uploadInput) {
        uploadInput.value = ''
      }

      const fileNameElement = document.getElementById('upload-file-name')
      if (fileNameElement) {
        fileNameElement.textContent = 'Nie wybrano pliku.'
      }

      renderImageLibrary(images)
      updatePreview()
      updateSendButton()
    })
  })
}

function updateModeUI() {
  document.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.mode === currentMode)
  })

  const titleGroup = document.getElementById('title-group')
  const colorGroup = document.getElementById('color-group')

  const isEmbedded = currentMode === 'embedded'
  if (titleGroup) {
    titleGroup.style.display = isEmbedded ? '' : 'none'
  }
  if (colorGroup) {
    colorGroup.style.display = isEmbedded ? '' : 'none'
  }

  const titleInput = document.getElementById('title')
  if (!isEmbedded && titleInput) {
    titleInput.value = ''
  }
}

function updateImagePanels() {
  const mode = document.getElementById('image-mode-select')?.value ?? 'none'
  const libraryPanel = document.getElementById('image-library-panel')
  const uploadPanel = document.getElementById('image-upload-panel')

  if (libraryPanel) {
    libraryPanel.hidden = mode !== 'library'
  }
  if (uploadPanel) {
    uploadPanel.hidden = mode !== 'upload'
  }

  if (mode !== 'library') {
    selectedImageName = null
    renderImageLibrary(images)
  }

  if (mode !== 'upload') {
    selectedUploadFile = null
    scheduledStoredUpload = null
    clearUploadPreviewUrl()
    const uploadInput = document.getElementById('image-upload-input')
    if (uploadInput) {
      uploadInput.value = ''
    }

    const fileNameElement = document.getElementById('upload-file-name')
    if (fileNameElement) {
      fileNameElement.textContent = 'Nie wybrano pliku.'
    }
  }
}

function updatePreview() {
  const data = collectFormDataSync()
  const embedContainer = document.getElementById('embed-preview-container')
  const messageContainer = document.getElementById('message-preview-container')
  const previewDescription = document.getElementById('preview-description')
  const colorBar = document.getElementById('embed-color-bar')
  const pingPreviewLine = document.getElementById('preview-ping-line')
  const imageBlock = document.getElementById('preview-image-block')
  const imageElement = document.getElementById('preview-image')
  const imageCaption = document.getElementById('preview-image-caption')
  const imagePlaceholder = document.getElementById('preview-image-placeholder')

  if (
    !embedContainer
    || !messageContainer
    || !previewDescription
    || !colorBar
    || !pingPreviewLine
    || !imageBlock
    || !imageElement
    || !imageCaption
    || !imagePlaceholder
  ) {
    return
  }

  if (data.mode === 'embedded') {
    embedContainer.style.display = 'flex'
    messageContainer.style.display = 'none'
    colorBar.style.background = COLOR_MAP[selectedColor] ?? COLOR_MAP.czerwony
    previewDescription.innerHTML = renderPreviewEmbedText(data.title, data.content)
  } else {
    embedContainer.style.display = 'none'
    messageContainer.style.display = ''
    messageContainer.innerHTML = renderMarkdown(data.content) || '<span style="opacity:.45">Wpisz treść publikacji.</span>'
  }

  if (data.mentionRoleEnabled && data.mentionRoleId) {
    pingPreviewLine.textContent = `Ping przed publikacją: ${resolvePingTargetLabel(data.mentionRoleId)}`
    pingPreviewLine.style.display = 'inline-flex'
  } else {
    pingPreviewLine.style.display = 'none'
    pingPreviewLine.textContent = ''
  }

  let previewImageSrc = ''
  let previewImageCaption = ''

  if (data.imageMode === 'library' && data.imageFilename) {
    previewImageSrc = `/img/${encodeURIComponent(data.imageFilename)}`
    previewImageCaption = `Grafika z biblioteki: ${data.imageFilename}`
  }

  if (data.imageMode === 'upload' && selectedUploadPreviewUrl) {
    previewImageSrc = selectedUploadPreviewUrl
    previewImageCaption = selectedUploadFile ? `Wgrana grafika: ${selectedUploadFile.name}` : 'Wgrana grafika'
  }

  if (previewImageSrc) {
    imageElement.src = previewImageSrc
    imageCaption.textContent = previewImageCaption
    imageBlock.style.display = ''
    imagePlaceholder.style.display = 'none'
  } else {
    imageBlock.style.display = 'none'
    imageElement.src = ''
    imageCaption.textContent = ''

    if (data.imageMode === 'none') {
      imagePlaceholder.style.display = 'none'
    } else if (data.imageMode === 'library') {
      imagePlaceholder.textContent = '🖼️ Wybierz grafikę z biblioteki, aby zobaczyć podgląd.'
      imagePlaceholder.style.display = ''
    } else {
      imagePlaceholder.textContent = '🖼️ Wgraj plik, aby zobaczyć podgląd.'
      imagePlaceholder.style.display = ''
    }
  }

  updateEventPreview(data)
}

function resolvePingTargetLabel(pingTargetId) {
  if (pingTargetId === 'everyone') {
    return '@everyone'
  }

  if (pingTargetId === 'here') {
    return '@here'
  }

  const role = roles.find((entry) => entry.id === pingTargetId)
  return role ? `@${role.name}` : '@nieznana-rola'
}

function renderPreviewEmbedText(title, content) {
  const titleHtml = title?.trim()
    ? `<span class="embed-h1">${renderInlineText(title.trim())}</span>`
    : ''

  const bodyHtml = content?.trim()
    ? renderMarkdown(content)
    : '<span style="opacity:.45">Wpisz treść publikacji.</span>'

  return `${titleHtml}${bodyHtml}`
}

function renderInlineText(value) {
  let html = escapeHtml(value)
  html = renderDiscordCustomEmojis(html)
  html = renderDiscordMentions(html)
  html = renderDiscordTimestamps(html)
  return html
}

function collectFormDataSync() {
  const pingEnabled = document.getElementById('ping-role-enabled')?.checked ?? false
  const pingRoleId = document.getElementById('ping-role-select')?.value ?? ''
  const imageMode = document.getElementById('image-mode-select')?.value ?? 'none'
  const scheduleAtLocal = document.getElementById('schedule-at')?.value ?? ''
  const matchHelperEnabled = document.getElementById('match-helper-enabled')?.checked ?? false
  const eventEnabled = document.getElementById('event-enabled')?.checked ?? false
  const watchpartyEnabled = document.getElementById('watchparty-enabled')?.checked ?? false

  const matchInfo = matchHelperEnabled && selectedMatchInfo
    ? {
      matchId: selectedMatchInfo.matchId ?? '',
      game: selectedMatchInfo.game ?? '',
      g2TeamName: selectedMatchInfo.g2TeamName ?? '',
      opponent: selectedMatchInfo.opponent ?? '',
      tournament: selectedMatchInfo.tournament ?? '',
      matchType: selectedMatchInfo.matchType ?? '',
      beginAtUtc: selectedMatchInfo.beginAtUtc ?? '',
      date: selectedMatchInfo.date ?? '',
      time: selectedMatchInfo.time ?? '',
    }
    : undefined

  const eventDraft = {
    enabled: eventEnabled,
    title: document.getElementById('event-title')?.value ?? '',
    description: document.getElementById('event-description')?.value ?? '',
    location: document.getElementById('event-location')?.value ?? '',
    startAtLocal: document.getElementById('event-start-at')?.value ?? '',
    endAtLocal: document.getElementById('event-end-at')?.value ?? '',
  }

  const watchpartyDraft = {
    enabled: watchpartyEnabled,
    channelName: document.getElementById('watchparty-channel-name')?.value ?? '',
    startAtLocal: document.getElementById('watchparty-start-at')?.value ?? '',
    endAtLocal: document.getElementById('watchparty-end-at')?.value ?? '',
  }

  return {
    mode: currentMode,
    channelId: document.getElementById('channel-select')?.value ?? '',
    title: document.getElementById('title')?.value ?? '',
    content: document.getElementById('content-textarea')?.value ?? '',
    colorName: selectedColor,
    mentionRoleEnabled: pingEnabled,
    mentionRoleId: pingEnabled ? pingRoleId : '',
    scheduleAtLocal,
    imageMode,
    imageFilename: imageMode === 'library' ? (selectedImageName ?? '') : '',
    matchInfo,
    eventDraft,
    watchpartyDraft,
  }
}

async function collectFormData() {
  const syncData = collectFormDataSync()

  if (syncData.imageMode === 'upload' && !selectedUploadFile && scheduledStoredUpload) {
    return {
      ...syncData,
      uploadFileName: scheduledStoredUpload.uploadFileName,
      uploadMimeType: scheduledStoredUpload.uploadMimeType,
      uploadBase64: scheduledStoredUpload.uploadBase64,
    }
  }

  if (syncData.imageMode !== 'upload' || !selectedUploadFile) {
    return {
      ...syncData,
      uploadFileName: '',
      uploadMimeType: '',
      uploadBase64: '',
    }
  }

  const dataUrl = await fileToDataUrl(selectedUploadFile)

  const uploadMimeType = normalizeUploadMimeType(selectedUploadFile.type, selectedUploadFile.name)

  return {
    ...syncData,
    uploadFileName: selectedUploadFile.name,
    uploadMimeType,
    uploadBase64: dataUrl,
  }
}

function updateSendButton() {
  const button = document.getElementById('send-btn')
  const buttonText = document.getElementById('send-btn-text')
  if (!button || !buttonText) return

  const data = collectFormDataSync()

  const hasChannel = !!data.channelId
  const hasContent = !!data.content.trim()
  const pingReady = !data.mentionRoleEnabled || !!data.mentionRoleId

  const imageReady = data.imageMode === 'none'
    || (data.imageMode === 'library' && !!data.imageFilename)
    || (data.imageMode === 'upload' && (!!selectedUploadFile || !!scheduledStoredUpload))

  const matchReady = !document.getElementById('match-helper-enabled')?.checked || Boolean(data.matchInfo?.matchId)

  const eventDraftEnabled = data.eventDraft?.enabled === true
  const eventStartTimestamp = data.eventDraft?.startAtLocal ? Date.parse(data.eventDraft.startAtLocal) : NaN
  const eventEndTimestamp = data.eventDraft?.endAtLocal ? Date.parse(data.eventDraft.endAtLocal) : NaN
  const eventReady = !eventDraftEnabled || (
    Boolean(data.eventDraft?.title?.trim())
    && Boolean(data.eventDraft?.description?.trim())
    && Boolean(data.eventDraft?.location?.trim())
    && Number.isFinite(eventStartTimestamp)
    && Number.isFinite(eventEndTimestamp)
    && eventEndTimestamp > eventStartTimestamp
  )

  const watchpartyDraftEnabled = data.watchpartyDraft?.enabled === true
  const watchpartyStartTimestamp = data.watchpartyDraft?.startAtLocal ? Date.parse(data.watchpartyDraft.startAtLocal) : NaN
  const watchpartyEndTimestamp = data.watchpartyDraft?.endAtLocal ? Date.parse(data.watchpartyDraft.endAtLocal) : NaN
  const watchpartyReady = !watchpartyDraftEnabled || (
    Boolean(data.watchpartyDraft?.channelName?.trim())
    && Number.isFinite(watchpartyStartTimestamp)
    && Number.isFinite(watchpartyEndTimestamp)
    && watchpartyEndTimestamp > watchpartyStartTimestamp
  )

  button.disabled = !(hasChannel && hasContent && pingReady && imageReady && matchReady && eventReady && watchpartyReady)

  if (editingSentPostId) {
    buttonText.textContent = 'Zapisz zmiany wysłanego posta'
    return
  }

  if (data.scheduleAtLocal) {
    buttonText.textContent = editingScheduledPostId ? 'Zapisz zaplanowany post' : 'Zaplanuj publikację'
    return
  }

  buttonText.textContent = 'Opublikuj'
}

async function publishMessage() {
  const button = document.getElementById('send-btn')
  const buttonText = document.getElementById('send-btn-text')
  if (!button || !buttonText) return

  button.disabled = true
  button.classList.add('loading')
  buttonText.textContent = 'Publikowanie...'

  try {
    const payload = await collectFormData()
    const hasScheduleDate = Boolean(payload.scheduleAtLocal?.trim())

    if (editingSentPostId && hasScheduleDate) {
      throw new Error('Wysłany post nie może zostać ponownie zaplanowany. Usuń datę publikacji.')
    }

    if (editingScheduledPostId && !hasScheduleDate) {
      throw new Error('Edytowany post zaplanowany musi mieć ustawioną datę publikacji.')
    }

    const requestUrl = editingSentPostId
      ? `/api/scheduled/sent/${encodeURIComponent(editingSentPostId)}`
      : (hasScheduleDate
        ? (editingScheduledPostId ? `/api/scheduled/${encodeURIComponent(editingScheduledPostId)}` : '/api/scheduled')
        : '/api/embed')
    const requestMethod = editingSentPostId
      ? 'PATCH'
      : (hasScheduleDate && editingScheduledPostId ? 'PATCH' : 'POST')

    const resp = await fetchWithCsrf(requestUrl, {
      method: requestMethod,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const json = await parseApiResponse(resp)
    if (!resp.ok) {
      throw new Error(json.error ?? 'Nieznany błąd')
    }

    if (Array.isArray(json.warnings) && json.warnings.length > 0) {
      json.warnings.forEach((warning) => {
        showToast(`⚠️ ${warning}`, 'info')
      })
    }

    if (editingSentPostId) {
      editingSentPostId = null
      await loadSentPosts()
      switchSection('sent-posts')
      showToast('✅ Wysłany post został zaktualizowany.', 'success')
      return
    }

    if (hasScheduleDate) {
      const scheduleInput = document.getElementById('schedule-at')
      if (scheduleInput) {
        scheduleInput.value = ''
      }

      const wasEditing = Boolean(editingScheduledPostId)
      editingScheduledPostId = null
      await loadScheduledPosts()
      switchSection('scheduled-posts')

      showToast(
        wasEditing
          ? '✅ Zaplanowany post został zaktualizowany.'
          : '✅ Post został dodany do schedulera.',
        'success',
      )

      return
    }

    if (payload.imageMode === 'upload') {
      await loadImages()
      renderImageLibrary(images)
    }

    await loadSentPosts()
    showToast('✅ Publikacja wysłana pomyślnie!', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd'
    showToast(`❌ ${message}`, 'error')
  } finally {
    button.classList.remove('loading')
    updateSendButton()
  }
}

async function parseApiResponse(resp) {
  const contentType = resp.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return resp.json().catch(() => ({}))
  }

  const text = await resp.text()
  if (text) {
    return { error: text }
  }

  return {}
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Nie udało się odczytać pliku.'))
    reader.readAsDataURL(file)
  })
}

function closeAllPopovers() {
  const emojiPopover = document.getElementById('emoji-popover')
  const mentionPopover = document.getElementById('mention-popover')

  if (emojiPopover) {
    emojiPopover.hidden = true
  }

  if (mentionPopover) {
    mentionPopover.hidden = true
  }
}

function togglePopover(popoverId) {
  const popover = document.getElementById(popoverId)
  if (!popover) return

  const shouldOpen = popover.hidden
  closeAllPopovers()
  popover.hidden = !shouldOpen
}

function insertToken(token) {
  const target = getActiveEditor()
  if (!target) {
    showToast('Najpierw kliknij pole tekstowe edytora.', 'info')
    return
  }

  const value = target.value ?? ''
  const start = target.selectionStart ?? value.length
  const end = target.selectionEnd ?? value.length

  const rightPart = value.slice(end)
  const needsTrailingSpace = rightPart.length === 0 || !/^\s/.test(rightPart)
  const insertion = `${token}${needsTrailingSpace ? ' ' : ''}`

  target.value = `${value.slice(0, start)}${insertion}${value.slice(end)}`

  const caretPos = start + insertion.length
  target.setSelectionRange(caretPos, caretPos)
  target.dispatchEvent(new Event('input', { bubbles: true }))
  target.focus()
}

function clearUploadPreviewUrl() {
  if (selectedUploadPreviewUrl) {
    URL.revokeObjectURL(selectedUploadPreviewUrl)
    selectedUploadPreviewUrl = null
  }
}

function getActiveEditor() {
  const active = document.getElementById(activeEditorId)
  if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
    return active
  }

  const fallback = document.getElementById('content-textarea')
  if (fallback) {
    activeEditorId = 'content-textarea'
  }

  return fallback
}

function wrapSelection(token) {
  const target = getActiveEditor()
  if (!target) {
    showToast('Najpierw kliknij pole tekstowe edytora.', 'info')
    return
  }

  const value = target.value ?? ''
  const start = target.selectionStart ?? value.length
  const end = target.selectionEnd ?? value.length
  const selected = value.slice(start, end)

  const wrapped = selected
    ? `${token}${selected}${token}`
    : `${token}${token}`

  target.value = `${value.slice(0, start)}${wrapped}${value.slice(end)}`

  const caretPos = selected ? start + wrapped.length : start + token.length
  target.setSelectionRange(caretPos, caretPos)
  target.dispatchEvent(new Event('input', { bubbles: true }))
  target.focus()
}

function prefixSelectionLines(prefix) {
  const target = getActiveEditor()
  if (!target) {
    showToast('Najpierw kliknij pole tekstowe edytora.', 'info')
    return
  }

  const value = target.value ?? ''
  const selectionStart = target.selectionStart ?? value.length
  const selectionEnd = target.selectionEnd ?? value.length
  const start = value.lastIndexOf('\n', selectionStart - 1) + 1
  const endBreak = value.indexOf('\n', selectionEnd)
  const end = endBreak === -1 ? value.length : endBreak

  const block = value.slice(start, end)
  const prefixed = block
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')

  target.value = `${value.slice(0, start)}${prefixed}${value.slice(end)}`
  target.setSelectionRange(start, start + prefixed.length)
  target.dispatchEvent(new Event('input', { bubbles: true }))
  target.focus()
}

function renderMarkdown(text) {
  if (!text) return ''

  const escaped = escapeHtml(text)
  const codeBlocks = []

  let html = escaped.replace(/```([\s\S]*?)```/g, (_match, code) => {
    const index = codeBlocks.push(`<pre class="md-codeblock">${code}</pre>`) - 1
    return `@@CODEBLOCK_${index}@@`
  })

  html = html.replace(/^###\s+(.+)$/gm, '<span class="md-h3">$1</span>')
  html = html.replace(/^##\s+(.+)$/gm, '<span class="md-h2">$1</span>')
  html = html.replace(/^#\s+(.+)$/gm, '<span class="md-h1-alt">$1</span>')
  html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote class="md-quote">$1</blockquote>')

  html = html.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>')
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__(.+?)__/g, '<u>$1</u>')
  html = html.replace(/~~(.+?)~~/g, '<s>$1</s>')
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
  html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>')

  html = renderDiscordCustomEmojis(html)
  html = renderDiscordMentions(html)
  html = renderDiscordTimestamps(html)

  html = html.replace(/\n/g, '<br>')
  html = html.replace(/@@CODEBLOCK_(\d+)@@/g, (_match, index) => codeBlocks[Number(index)] ?? '')

  return html
}

function updateEventPreview(data) {
  const previewCard = document.getElementById('event-preview-card')
  const previewContent = document.getElementById('event-preview-content')

  if (!previewCard || !previewContent) {
    return
  }

  const draft = data.eventDraft ?? {}
  if (!draft.enabled) {
    previewCard.style.display = 'none'
    previewContent.innerHTML = ''
    return
  }

  previewCard.style.display = ''

  const title = String(draft.title ?? '').trim() || 'Brak tytułu wydarzenia'
  const description = String(draft.description ?? '').trim() || 'Brak opisu wydarzenia.'
  const location = String(draft.location ?? '').trim() || 'Online'

  const startUnix = Number.isFinite(Date.parse(String(draft.startAtLocal ?? '')))
    ? Math.floor(Date.parse(String(draft.startAtLocal ?? '')) / 1000)
    : null
  const endUnix = Number.isFinite(Date.parse(String(draft.endAtLocal ?? '')))
    ? Math.floor(Date.parse(String(draft.endAtLocal ?? '')) / 1000)
    : null

  const startLabel = startUnix ? `<t:${startUnix}:F>` : 'Nie ustawiono'
  const endLabel = endUnix ? `<t:${endUnix}:F>` : 'Nie ustawiono'

  const previewText = [
    `# ${title}`,
    '',
    `Start: ${startLabel}`,
    `Koniec: ${endLabel}`,
    `Miejsce: ${location}`,
    '',
    description,
  ].join('\n')

  previewContent.innerHTML = renderMarkdown(previewText)
}

function renderDiscordCustomEmojis(text) {
  return text.replace(/&lt;(a?):([a-zA-Z0-9_]+):(\d{17,20})&gt;/g, (_match, animatedFlag, name, id) => {
    const ext = animatedFlag === 'a' ? 'gif' : 'png'
    const src = `https://cdn.discordapp.com/emojis/${id}.${ext}?size=32&quality=lossless`
    return `<img class="md-discord-emoji" src="${src}" alt=":${name}:" title=":${name}:">`
  })
}

function renderDiscordMentions(text) {
  const channelMap = new Map(channels.map((channel) => [channel.id, channel.name]))
  const roleMap = new Map(roles.map((role) => [role.id, role.name]))

  let html = text.replace(/(?:&lt;|<)#(\d{17,20})(?:&gt;|>)/g, (_match, id) => {
    const name = channelMap.get(id) ?? 'kanał'
    return `<span class="md-mention">#${escapeHtml(name)}</span>`
  })

  html = html.replace(/(?:&lt;|<)@&(\d{17,20})(?:&gt;|>)/g, (_match, id) => {
    const name = roleMap.get(id) ?? 'nieznana-rola'
    return `<span class="md-mention">@${escapeHtml(name)}</span>`
  })

  html = html.replace(/(?:&lt;|<)@!?(\d{17,20})(?:&gt;|>)/g, (_match, id) => {
    const name = knownUsers.get(id) ?? 'użytkownik'
    return `<span class="md-mention">@${escapeHtml(name)}</span>`
  })

  html = html.replace(/(^|[\s(>])@everyone\b/g, '$1<span class="md-mention">@everyone</span>')
  html = html.replace(/(^|[\s(>])@here\b/g, '$1<span class="md-mention">@here</span>')

  return html
}

function renderDiscordTimestamps(text) {
  return text.replace(/(?:&lt;|<)t:(\d{1,12})(?::([tTdDfFR]))?(?:&gt;|>)/g, (_match, unixSecondsRaw, format = 'f') => {
    const unixSeconds = Number.parseInt(unixSecondsRaw, 10)
    if (!Number.isFinite(unixSeconds)) {
      return _match
    }

    const timestamp = unixSeconds * 1000
    const date = new Date(timestamp)

    const formatMap = {
      t: new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date),
      T: new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date),
      d: new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date),
      D: new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: 'long', year: 'numeric' }).format(date),
      f: new Intl.DateTimeFormat('pl-PL', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(date),
      F: new Intl.DateTimeFormat('pl-PL', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(date),
      R: formatRelativeCountdown(timestamp),
    }

    const label = formatMap[format] ?? formatMap.f
    return `<span class="md-mention" title="<t:${unixSeconds}:${format}>">${escapeHtml(label)}</span>`
  })
}

function formatRelativeCountdown(targetTimestamp) {
  const diffMs = targetTimestamp - Date.now()
  const diffMinutes = Math.round(diffMs / 60000)

  if (Math.abs(diffMinutes) < 1) {
    return 'za chwilę'
  }

  if (diffMinutes > 0) {
    if (diffMinutes < 60) {
      return `za ${diffMinutes} min`
    }

    const hours = Math.round(diffMinutes / 60)
    if (hours < 48) {
      return `za ${hours} h`
    }

    const days = Math.round(hours / 24)
    return `za ${days} dni`
  }

  const pastMinutes = Math.abs(diffMinutes)
  if (pastMinutes < 60) {
    return `${pastMinutes} min temu`
  }

  const hours = Math.round(pastMinutes / 60)
  if (hours < 48) {
    return `${hours} h temu`
  }

  const days = Math.round(hours / 24)
  return `${days} dni temu`
}

function fileExtension(filename) {
  const lower = (filename ?? '').toLowerCase()
  const dotIndex = lower.lastIndexOf('.')
  return dotIndex === -1 ? '' : lower.slice(dotIndex)
}

function normalizeUploadMimeType(mimeType, filename) {
  const normalizedMimeType = (mimeType ?? '').trim().toLowerCase()

  if (normalizedMimeType === 'image/jpeg' || normalizedMimeType === 'image/jpg') {
    return 'image/jpeg'
  }

  if (normalizedMimeType === 'image/png' || normalizedMimeType === 'image/gif') {
    return normalizedMimeType
  }

  const ext = fileExtension(filename)
  return UPLOAD_MIME_BY_EXT[ext] ?? ''
}

function isAllowedUploadFile(file) {
  const normalizedMimeType = normalizeUploadMimeType(file.type, file.name)
  if (ALLOWED_UPLOAD_TYPES.has(normalizedMimeType)) {
    return true
  }

  return ALLOWED_UPLOAD_EXTS.has(fileExtension(file.name))
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container')
  if (!container) return

  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.textContent = message
  container.appendChild(toast)

  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease forwards'
    setTimeout(() => toast.remove(), 300)
  }, 3500)
}

function escapeHtml(value) {
  if (!value) return ''

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
