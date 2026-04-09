const COLOR_MAP = {
  czerwony: '#dc143c',
  biały: '#f5f5f5',
  szary: '#99aab5',
  złoty: '#ffd700',
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const MAX_ECONOMY_CSV_IMPORT_BYTES = 2_000_000
const TIMEOUT_DURATION_UNITS = new Set(['s', 'm', 'h', 'd', 'mo', 'y'])
const ALLOWED_UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'])
const ALLOWED_UPLOAD_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
const CREATOR_IMAGE_PAGE_SIZE = 8
const IMAGE_LIBRARY_PAGE_SIZE = 12
const ECONOMY_LEADERBOARD_AUTO_REFRESH_MS = 60_000
const DASHBOARD_LOGS_PAGE_SIZE = 25
const DASHBOARD_LOGS_SEARCH_DEBOUNCE_MS = 300
const UPLOAD_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

const ECONOMY_RANK_TIERS = [
  { minLevel: 1, maxLevel: 9, levelRewardMultiplier: 3.0, dripRate: 0.08 },
  { minLevel: 10, maxLevel: 19, levelRewardMultiplier: 4.5, dripRate: 0.10 },
  { minLevel: 20, maxLevel: 34, levelRewardMultiplier: 6.0, dripRate: 0.13 },
  { minLevel: 35, maxLevel: 49, levelRewardMultiplier: 8.0, dripRate: 0.17 },
  { minLevel: 50, maxLevel: 74, levelRewardMultiplier: 11.0, dripRate: 0.22 },
  { minLevel: 75, maxLevel: 99, levelRewardMultiplier: 15.0, dripRate: 0.28 },
  { minLevel: 100, maxLevel: 124, levelRewardMultiplier: 20.0, dripRate: 0.35 },
]
const ECONOMY_PREVIEW_MAX_LEVEL = 10_000

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
let creatorImageEntries = []
let creatorImageSearch = ''
let creatorImagePage = 1
let creatorImageTotalPages = 1
let creatorImageTotalItems = 0
let creatorImageLoadRequestId = 0
let libraryImageEntries = []
let libraryImageSearch = ''
let libraryImageSortBy = 'newest'
let libraryImagePage = 1
let libraryImageTotalPages = 1
let libraryImageTotalItems = 0
let libraryImageLoadRequestId = 0
let ticketHistoryEntries = []
let ticketHistorySearch = ''
let ticketHistoryPage = 1
let ticketHistoryTotalPages = 1
let ticketHistoryTotalItems = 0
let ticketHistoryLoadRequestId = 0
let ticketHistorySearchDebounceId = null
let mentionChannelSearchDebounceId = null
let mentionRoleSearchDebounceId = null
let mentionUserSearchDebounceId = null
let mentionChannelSearchRequestId = 0
let mentionRoleSearchRequestId = 0
let mentionUserSearchRequestId = 0
let embedSectionBound = false
let creatorPreviewScrollSyncBound = false
let creatorPreviewScrollSyncRafId = null
let scheduledSectionBound = false
let sentSectionBound = false
let eventsSectionBound = false
let g2SectionBound = false
let economySectionBound = false
let economyLeaderboardSectionBound = false
let timeoutSectionBound = false
let imageLibrarySectionBound = false
let ticketHistorySectionBound = false
let systemLogsSectionBound = false
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
let economyLeaderboardAutoRefreshIntervalId = null
let dashboardLogEntries = []
let dashboardLogsPage = 1
let dashboardLogsTotalPages = 1
let dashboardLogsTotalRows = 0
let dashboardLogsSearch = ''
let dashboardLogsLevel = 'all'
let dashboardLogsLoadRequestId = 0
let dashboardLogsSearchDebounceId = null
let dashboardLogsAbortController = null
let economyLevelRoleMappings = []
let economyLevelRoleMappingsLoaded = false
let economyHasDevAccess = null
let economyAccessRetryTimerId = null
let timeoutCreateSearchDebounceId = null
let timeoutFilterSearchDebounceId = null
let timeoutCreateSearchRequestId = 0
let timeoutFilterSearchRequestId = 0
let timeoutCreateSearchResults = []
let timeoutFilterSearchResults = []
let timeoutSelectedUserId = ''
let timeoutFilterUserId = ''
let timeoutEntries = []
let timeoutLoadError = null
let economyHiddenLevelingConfig = {
  levelingMode: 'progressive',
  levelingCurve: 'formula_v2',
  levelingBaseXp: 100,
  levelingExponent: 1.5,
  levelUpCoinsBase: 25,
  levelUpCoinsPerLevel: 10,
}

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
  applyEconomySettingsAccessState()
  await initEmbedSection()
  await initScheduledSection()
  await initSentSection()
  await initEventsSection()
  await initG2Section()
  await initEconomySection()
  await initEconomyLeaderboardSection()
  await initTimeoutSection()
  await initTicketHistorySection()
  await initImageLibrarySection()
  await initSystemLogsSection()
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
  if (section === 'economy-settings' && economyHasDevAccess !== true) {
    if (economyHasDevAccess === false) {
      showToast('ℹ️ Ustawienia ekonomii są dostępne tylko dla roli Dev.', 'info')
    } else {
      showToast('ℹ️ Trwa weryfikacja uprawnień do ustawień ekonomii. Spróbuj ponownie za chwilę.', 'info')
    }

    section = 'economy-leaderboard'
  }

  currentSection = section

  if (section === 'economy-leaderboard') {
    startEconomyLeaderboardAutoRefresh()
  } else {
    stopEconomyLeaderboardAutoRefresh()
  }

  if (section !== 'system-logs') {
    clearDashboardLogsSearchDebounce()
    cancelDashboardLogsRequest()
  }

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

  if (section === 'timeouts-system') {
    void loadTimeoutList({ silent: false })
  }

  if (section === 'ticket-history') {
    void loadTicketHistory({ silent: false })
  }

  if (section === 'image-library') {
    void loadImageLibraryPage({ silent: false })
  }

  if (section === 'system-logs') {
    void loadDashboardLogs({ silent: false })
  }

  if (typeof window.onDashboardSectionChanged === 'function') {
    window.onDashboardSectionChanged(section)
  }

  scheduleCreatorPreviewScrollSync()
}

function startEconomyLeaderboardAutoRefresh() {
  if (economyLeaderboardAutoRefreshIntervalId !== null) {
    return
  }

  economyLeaderboardAutoRefreshIntervalId = setInterval(() => {
    if (currentSection !== 'economy-leaderboard') {
      return
    }

    void loadEconomyLeaderboard({ silent: true })
  }, ECONOMY_LEADERBOARD_AUTO_REFRESH_MS)
}

function stopEconomyLeaderboardAutoRefresh() {
  if (economyLeaderboardAutoRefreshIntervalId === null) {
    return
  }

  clearInterval(economyLeaderboardAutoRefreshIntervalId)
  economyLeaderboardAutoRefreshIntervalId = null
}

function resetCreatorPreviewScrollTransform() {
  const previewCard = document.getElementById('creator-preview-card')
  if (!(previewCard instanceof HTMLElement)) {
    return
  }

  if (previewCard.style.transform) {
    previewCard.style.transform = ''
  }
}

function scheduleCreatorPreviewScrollSync() {
  const isDesktopViewport = window.matchMedia('(min-width: 1001px)').matches
  const isEmbedCreatorSection = currentSection === 'embed-creator'
  if (!isDesktopViewport || !isEmbedCreatorSection) {
    resetCreatorPreviewScrollTransform()
    return
  }

  if (creatorPreviewScrollSyncRafId !== null) {
    return
  }

  creatorPreviewScrollSyncRafId = window.requestAnimationFrame(() => {
    creatorPreviewScrollSyncRafId = null
    syncCreatorPreviewScrollPosition()
  })
}

function syncCreatorPreviewScrollPosition() {
  const previewCard = document.getElementById('creator-preview-card')
  const formCard = document.getElementById('creator-form-card')

  if (!(previewCard instanceof HTMLElement) || !(formCard instanceof HTMLElement)) {
    return
  }

  const isDesktopViewport = window.matchMedia('(min-width: 1001px)').matches
  if (!isDesktopViewport || currentSection !== 'embed-creator') {
    resetCreatorPreviewScrollTransform()
    return
  }

  const currentScrollTop = getDocumentScrollTop()
  const formRect = formCard.getBoundingClientRect()
  const formTopInDocument = formRect.top + currentScrollTop
  const formBottomInDocument = formTopInDocument + formCard.offsetHeight
  const viewportHeight = Math.max(window.innerHeight || 0, 1)
  const maxOffset = Math.max(0, formCard.scrollHeight - previewCard.offsetHeight)
  if (maxOffset === 0) {
    resetCreatorPreviewScrollTransform()
    return
  }

  const availableScroll = formBottomInDocument - formTopInDocument - viewportHeight
  if (availableScroll <= 0) {
    resetCreatorPreviewScrollTransform()
    return
  }

  const progressRaw = (currentScrollTop - formTopInDocument) / availableScroll
  const progress = Math.min(1, Math.max(0, progressRaw))
  const translateY = Math.round(maxOffset * progress)
  previewCard.style.transform = `translateY(${translateY}px)`
}

function getDocumentScrollTop() {
  if (typeof window.scrollY === 'number') {
    return window.scrollY
  }

  const documentElement = document.documentElement
  if (documentElement && typeof documentElement.scrollTop === 'number') {
    return documentElement.scrollTop
  }

  return document.body?.scrollTop ?? 0
}

async function initEmbedSection() {
  await Promise.all([
    loadChannels(),
    loadRoles(),
    loadImages({ silent: true }),
    loadEmojis(),
  ])

  renderChannelSelector()
  renderPingRoleSelector()
  renderImageLibrary()
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
  const hasEconomyDevAccess = await loadEconomySettings({ silent: true })
  if (hasEconomyDevAccess) {
    await loadEconomyLevelRoleMappings({ silent: true })
  } else {
    economyLevelRoleMappingsLoaded = false
    economyLevelRoleMappings = []
    renderEconomyLevelRoleOptions()
    renderEconomyLevelRoleMappings()
  }

  if (!economySectionBound) {
    economySectionBound = true
    bindEconomySectionListeners()
  }

  applyEconomySettingsAccessState()
}

async function initEconomyLeaderboardSection() {
  renderEconomyLeaderboard()

  if (!economyLeaderboardSectionBound) {
    economyLeaderboardSectionBound = true
    bindEconomyLeaderboardSectionListeners()
  }
}

async function initTimeoutSection() {
  renderTimeoutMemberResults('create', [], '')
  renderTimeoutMemberResults('filter', [], '')

  const filterInput = document.getElementById('timeout-filter-user-id')
  if (filterInput instanceof HTMLInputElement) {
    filterInput.value = timeoutFilterUserId
  }

  renderTimeoutList()

  if (!timeoutSectionBound) {
    timeoutSectionBound = true
    bindTimeoutSectionListeners()
  }

  await loadTimeoutList({ silent: true })
}

async function initTicketHistorySection() {
  renderTicketHistory()

  if (!ticketHistorySectionBound) {
    ticketHistorySectionBound = true
    bindTicketHistorySectionListeners()
  }

  await loadTicketHistory({ silent: true })
}

async function initImageLibrarySection() {
  renderImageLibraryPage()

  if (!imageLibrarySectionBound) {
    imageLibrarySectionBound = true
    bindImageLibrarySectionListeners()
  }

  await loadImageLibraryPage({ silent: true })
}

async function initSystemLogsSection() {
  renderDashboardLogs()

  if (!systemLogsSectionBound) {
    systemLogsSectionBound = true
    bindSystemLogsSectionListeners()
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
  const imageLibrarySearchInput = document.getElementById('image-library-search')
  const imageLibraryPrevButton = document.getElementById('image-library-prev-btn')
  const imageLibraryNextButton = document.getElementById('image-library-next-btn')
  imageModeSelect?.addEventListener('change', () => {
    updateImagePanels()
    updatePreview()
    updateSendButton()

    if ((imageModeSelect.value ?? 'none') === 'library') {
      void loadImages({ page: 1, silent: true })
    }
  })

  imageLibrarySearchInput?.addEventListener('input', () => {
    creatorImageSearch = String(imageLibrarySearchInput.value ?? '').trim()
    creatorImagePage = 1
    void loadImages({ page: 1, silent: true })
  })

  imageLibraryPrevButton?.addEventListener('click', () => {
    if (creatorImagePage <= 1) {
      return
    }

    void loadImages({ page: creatorImagePage - 1, silent: true })
  })

  imageLibraryNextButton?.addEventListener('click', () => {
    if (creatorImagePage >= creatorImageTotalPages) {
      return
    }

    void loadImages({ page: creatorImagePage + 1, silent: true })
  })

  const uploadInput = document.getElementById('image-upload-input')
  uploadInput?.addEventListener('change', () => {
    const files = uploadInput.files
    selectedUploadFile = files && files[0] ? files[0] : null
    scheduledStoredUpload = null

    if (selectedUploadFile && !isAllowedUploadFile(selectedUploadFile)) {
      showToast('Dozwolone formaty pliku: JPEG, PNG, GIF, WebP, SVG.', 'error')
      uploadInput.value = ''
      selectedUploadFile = null
      clearUploadPreviewUrl()
    }

    if (selectedUploadFile && selectedUploadFile.size > MAX_UPLOAD_BYTES) {
      showToast('Plik jest za duży. Maksymalny rozmiar to 20 MB.', 'error')
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

  if (!creatorPreviewScrollSyncBound) {
    creatorPreviewScrollSyncBound = true
    window.addEventListener('scroll', scheduleCreatorPreviewScrollSync, { passive: true })
    window.addEventListener('resize', scheduleCreatorPreviewScrollSync)
    document.querySelectorAll('#section-embed-creator details').forEach((detailsElement) => {
      detailsElement.addEventListener('toggle', scheduleCreatorPreviewScrollSync)
    })
  }

  scheduleCreatorPreviewScrollSync()

  window.addEventListener('beforeunload', () => {
    stopEconomyLeaderboardAutoRefresh()
    clearDashboardLogsSearchDebounce()
    cancelDashboardLogsRequest()
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

function bindImageLibrarySectionListeners() {
  const searchInput = document.getElementById('image-library-tab-search')
  const sortSelect = document.getElementById('image-library-tab-sort')
  const refreshButton = document.getElementById('image-library-tab-refresh-btn')
  const uploadFileInput = document.getElementById('image-library-upload-file')
  const uploadNameInput = document.getElementById('image-library-upload-name')
  const uploadButton = document.getElementById('image-library-upload-btn')
  const listContainer = document.getElementById('image-library-tab-list')
  const prevButton = document.getElementById('image-library-tab-prev-btn')
  const nextButton = document.getElementById('image-library-tab-next-btn')

  searchInput?.addEventListener('input', () => {
    libraryImageSearch = String(searchInput.value ?? '').trim()
    libraryImagePage = 1
    void loadImageLibraryPage({ page: 1, silent: true })
  })

  sortSelect?.addEventListener('change', () => {
    libraryImageSortBy = String(sortSelect.value ?? 'newest') === 'name_asc' ? 'name_asc' : 'newest'
    libraryImagePage = 1
    void loadImageLibraryPage({ page: 1, silent: true })
  })

  refreshButton?.addEventListener('click', () => {
    void syncImageLibraryWithCreator({ silent: true })
  })

  uploadFileInput?.addEventListener('change', () => {
    if (!(uploadNameInput instanceof HTMLInputElement) || !(uploadFileInput instanceof HTMLInputElement)) {
      return
    }

    const selectedFile = uploadFileInput.files?.[0]
    if (!selectedFile) {
      return
    }

    uploadNameInput.value = selectedFile.name
  })

  uploadButton?.addEventListener('click', async () => {
    await uploadImageToLibrary()
  })

  prevButton?.addEventListener('click', () => {
    if (libraryImagePage <= 1) {
      return
    }

    void loadImageLibraryPage({ page: libraryImagePage - 1, silent: true })
  })

  nextButton?.addEventListener('click', () => {
    if (libraryImagePage >= libraryImageTotalPages) {
      return
    }

    void loadImageLibraryPage({ page: libraryImagePage + 1, silent: true })
  })

  listContainer?.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('[data-image-action]')
    if (!actionButton) {
      return
    }

    const action = String(actionButton.dataset.imageAction ?? '')
    const filename = String(actionButton.dataset.filename ?? '')
    if (!action || !filename) {
      return
    }

    if (action === 'rename') {
      await renameImageInLibrary(filename)
      return
    }

    if (action === 'delete') {
      await deleteImageFromLibrary(filename)
    }
  })
}

function bindTicketHistorySectionListeners() {
  const searchInput = document.getElementById('ticket-history-search')
  const refreshButton = document.getElementById('ticket-history-refresh-btn')
  const prevButton = document.getElementById('ticket-history-prev-btn')
  const nextButton = document.getElementById('ticket-history-next-btn')

  searchInput?.addEventListener('input', () => {
    ticketHistorySearch = String(searchInput.value ?? '').trim()
    ticketHistoryPage = 1
    if (ticketHistorySearchDebounceId) {
      clearTimeout(ticketHistorySearchDebounceId)
    }

    ticketHistorySearchDebounceId = setTimeout(() => {
      void loadTicketHistory({ page: 1, silent: true })
    }, 300)
  })

  refreshButton?.addEventListener('click', () => {
    void loadTicketHistory({ silent: true })
  })

  prevButton?.addEventListener('click', () => {
    if (ticketHistoryPage <= 1) {
      return
    }

    void loadTicketHistory({ page: ticketHistoryPage - 1, silent: true })
  })

  nextButton?.addEventListener('click', () => {
    if (ticketHistoryPage >= ticketHistoryTotalPages) {
      return
    }

    void loadTicketHistory({ page: ticketHistoryPage + 1, silent: true })
  })
}

function bindSystemLogsSectionListeners() {
  const searchInput = document.getElementById('system-logs-search')
  const levelSelect = document.getElementById('system-logs-level')
  const refreshButton = document.getElementById('system-logs-refresh-btn')
  const prevButton = document.getElementById('system-logs-prev-btn')
  const nextButton = document.getElementById('system-logs-next-btn')

  searchInput?.addEventListener('input', () => {
    dashboardLogsSearch = String(searchInput.value ?? '').trim()
    dashboardLogsPage = 1
    clearDashboardLogsSearchDebounce()
    dashboardLogsSearchDebounceId = setTimeout(() => {
      void loadDashboardLogs({ page: 1, silent: true })
    }, DASHBOARD_LOGS_SEARCH_DEBOUNCE_MS)
  })

  levelSelect?.addEventListener('change', () => {
    clearDashboardLogsSearchDebounce()
    dashboardLogsLevel = normalizeDashboardLogLevel(String(levelSelect.value ?? 'all').toLowerCase(), true)
    dashboardLogsPage = 1
    void loadDashboardLogs({ page: 1, silent: true })
  })

  refreshButton?.addEventListener('click', () => {
    clearDashboardLogsSearchDebounce()
    void loadDashboardLogs({ silent: true })
  })

  prevButton?.addEventListener('click', () => {
    if (dashboardLogsPage <= 1) {
      return
    }

    clearDashboardLogsSearchDebounce()
    void loadDashboardLogs({ page: dashboardLogsPage - 1, silent: true })
  })

  nextButton?.addEventListener('click', () => {
    if (dashboardLogsPage >= dashboardLogsTotalPages) {
      return
    }

    clearDashboardLogsSearchDebounce()
    void loadDashboardLogs({ page: dashboardLogsPage + 1, silent: true })
  })
}

function clearDashboardLogsSearchDebounce() {
  if (dashboardLogsSearchDebounceId) {
    clearTimeout(dashboardLogsSearchDebounceId)
    dashboardLogsSearchDebounceId = null
  }
}

function cancelDashboardLogsRequest() {
  if (dashboardLogsAbortController) {
    dashboardLogsAbortController.abort()
    dashboardLogsAbortController = null
  }
}

function normalizeDashboardLogLevel(value, allowAll = false) {
  const normalized = String(value ?? '').toLowerCase()
  const allowed = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
  if (allowed.has(normalized)) {
    return normalized
  }

  return allowAll ? 'all' : 'info'
}

async function loadDashboardLogs(options = {}) {
  const requestId = ++dashboardLogsLoadRequestId
  const nextPage = Number.isFinite(Number(options.page))
    ? Math.max(1, Number(options.page))
    : dashboardLogsPage
  const silent = options.silent === true

  const params = new URLSearchParams({
    page: String(nextPage),
    pageSize: String(DASHBOARD_LOGS_PAGE_SIZE),
    search: dashboardLogsSearch,
    level: dashboardLogsLevel,
  })

  cancelDashboardLogsRequest()
  const abortController = new AbortController()
  dashboardLogsAbortController = abortController

  try {
    const response = await fetch(`/api/logs?${params.toString()}`, {
      signal: abortController.signal,
    })
    const payload = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie pobrac logow systemowych.')
    }

    if (requestId !== dashboardLogsLoadRequestId) {
      return
    }

    dashboardLogEntries = Array.isArray(payload.logs) ? payload.logs : []
    dashboardLogsPage = Number.isFinite(Number(payload.pagination?.page))
      ? Math.max(1, Number(payload.pagination.page))
      : 1
    dashboardLogsTotalPages = Number.isFinite(Number(payload.pagination?.totalPages))
      ? Math.max(1, Number(payload.pagination.totalPages))
      : 1
    dashboardLogsTotalRows = Number.isFinite(Number(payload.pagination?.totalRows))
      ? Math.max(0, Number(payload.pagination.totalRows))
      : dashboardLogEntries.length

    renderDashboardLogs()
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return
    }

    if (requestId !== dashboardLogsLoadRequestId) {
      return
    }

    dashboardLogEntries = []
    dashboardLogsPage = 1
    dashboardLogsTotalPages = 1
    dashboardLogsTotalRows = 0
    renderDashboardLogs()

    if (!silent) {
      const message = error instanceof Error ? error.message : 'Nie udalo sie pobrac logow systemowych.'
      showToast(`❌ ${message}`, 'error')
    }
  } finally {
    if (requestId === dashboardLogsLoadRequestId && dashboardLogsAbortController === abortController) {
      dashboardLogsAbortController = null
    }
  }
}

async function loadTicketHistory(options = {}) {
  const requestId = ++ticketHistoryLoadRequestId
  const nextPage = Number.isFinite(Number(options.page))
    ? Math.max(1, Number(options.page))
    : ticketHistoryPage
  const silent = options.silent === true

  const params = new URLSearchParams({
    page: String(nextPage),
    pageSize: '20',
    search: ticketHistorySearch,
  })

  try {
    const response = await fetch(`/api/tickets/history?${params.toString()}`)
    const payload = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie pobrac historii ticketow.')
    }

    if (requestId !== ticketHistoryLoadRequestId) {
      return
    }

    ticketHistoryEntries = Array.isArray(payload.entries) ? payload.entries : []
    ticketHistoryPage = Number.isFinite(Number(payload.pagination?.page))
      ? Math.max(1, Number(payload.pagination.page))
      : 1
    ticketHistoryTotalPages = Number.isFinite(Number(payload.pagination?.totalPages))
      ? Math.max(1, Number(payload.pagination.totalPages))
      : 1
    ticketHistoryTotalItems = Number.isFinite(Number(payload.pagination?.totalItems))
      ? Math.max(0, Number(payload.pagination.totalItems))
      : ticketHistoryEntries.length

    renderTicketHistory()
  } catch (error) {
    if (requestId !== ticketHistoryLoadRequestId) {
      return
    }

    ticketHistoryEntries = []
    ticketHistoryPage = 1
    ticketHistoryTotalPages = 1
    ticketHistoryTotalItems = 0
    renderTicketHistory()

    if (!silent) {
      const message = error instanceof Error ? error.message : 'Nie udalo sie pobrac historii ticketow.'
      showToast(`❌ ${message}`, 'error')
    }
  }
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

function renderTicketHistory() {
  const list = document.getElementById('ticket-history-list')
  const countLabel = document.getElementById('ticket-history-count-label')
  const pageLabel = document.getElementById('ticket-history-page-label')
  const pagination = document.getElementById('ticket-history-pagination')
  const prevButton = document.getElementById('ticket-history-prev-btn')
  const nextButton = document.getElementById('ticket-history-next-btn')

  if (!list) {
    return
  }

  if (countLabel) {
    countLabel.textContent = `Elementy: ${ticketHistoryTotalItems}`
  }

  if (pageLabel) {
    pageLabel.textContent = `Strona ${ticketHistoryPage}/${ticketHistoryTotalPages}`
  }

  if (pagination) {
    pagination.hidden = ticketHistoryTotalPages <= 1
  }

  if (prevButton instanceof HTMLButtonElement) {
    prevButton.disabled = ticketHistoryPage <= 1
  }

  if (nextButton instanceof HTMLButtonElement) {
    nextButton.disabled = ticketHistoryPage >= ticketHistoryTotalPages
  }

  if (ticketHistoryEntries.length === 0) {
    const emptyMessage = ticketHistorySearch
      ? `Brak historii pasujacej do zapytania: "${escapeHtml(ticketHistorySearch)}".`
      : 'Brak zamknietych ticketow zapisanych po wdrozeniu historii.'
    list.innerHTML = `<div class="scheduled-empty">${emptyMessage}</div>`
    return
  }

  list.innerHTML = ticketHistoryEntries.map((entry) => {
    const closeType = String(entry.closeType ?? '') === 'admin' ? 'Administracja' : 'Autor ticketu'
    const ownerId = entry.ownerId ? `<@${escapeHtml(String(entry.ownerId))}>` : 'nieznany'
    const transcriptLink = `/api/tickets/transcripts/${encodeURIComponent(String(entry.transcriptFileName ?? ''))}`

    return `
      <article class="scheduled-card">
        <div class="scheduled-card-header">
          <span class="scheduled-card-title">${escapeHtml(String(entry.channelName ?? 'ticket'))}</span>
          <span class="scheduled-chip">${escapeHtml(closeType)}</span>
        </div>
        <div class="scheduled-card-meta">
          <span class="scheduled-chip">Ticket channel: ${escapeHtml(String(entry.channelId ?? ''))}</span>
          <span class="scheduled-chip">Owner: ${ownerId}</span>
          <span class="scheduled-chip">Zamknal: ${escapeHtml(String(entry.closedByTag ?? ''))}</span>
          <span class="scheduled-chip">Kiedy: ${escapeHtml(formatTimestampInWarsaw(Number(entry.closedAt ?? 0)))}</span>
        </div>
        <div class="scheduled-preview">${renderMarkdown(String(entry.closeReason ?? 'Brak powodu.')) || '<span style="opacity:.45">Brak powodu.</span>'}</div>
        <div class="scheduled-actions">
          <a class="btn-secondary" href="${transcriptLink}" target="_blank" rel="noopener noreferrer">Otworz transkrypt</a>
        </div>
      </article>`
  }).join('')
}

function renderDashboardLogs() {
  const list = document.getElementById('system-logs-list')
  const countLabel = document.getElementById('system-logs-count-label')
  const pageLabel = document.getElementById('system-logs-page-label')
  const pagination = document.getElementById('system-logs-pagination')
  const prevButton = document.getElementById('system-logs-prev-btn')
  const nextButton = document.getElementById('system-logs-next-btn')

  if (!list) {
    return
  }

  if (countLabel) {
    countLabel.textContent = `Wpisy: ${dashboardLogsTotalRows}`
  }

  if (pageLabel) {
    pageLabel.textContent = `Strona ${dashboardLogsPage}/${dashboardLogsTotalPages}`
  }

  if (pagination) {
    pagination.hidden = dashboardLogsTotalPages <= 1
  }

  if (prevButton instanceof HTMLButtonElement) {
    prevButton.disabled = dashboardLogsPage <= 1
  }

  if (nextButton instanceof HTMLButtonElement) {
    nextButton.disabled = dashboardLogsPage >= dashboardLogsTotalPages
  }

  if (dashboardLogEntries.length === 0) {
    const emptyMessage = dashboardLogsSearch
      ? `Brak logow pasujacych do zapytania: "${escapeHtml(dashboardLogsSearch)}".`
      : 'Brak logow systemowych dla wybranych filtrow.'
    list.innerHTML = `<div class="scheduled-empty">${emptyMessage}</div>`
    return
  }

  list.innerHTML = dashboardLogEntries.map((entry) => {
    const level = normalizeDashboardLogLevel(entry.level)
    const levelLabel = escapeHtml(level.toUpperCase())
    const action = escapeHtml(String(entry.action ?? 'UNKNOWN'))
    const scope = escapeHtml(String(entry.scope ?? 'system'))
    const message = escapeHtml(String(entry.message ?? 'Brak tresci'))
    const timestamp = formatTimestampInWarsaw(Number(entry.timestampMs ?? Date.now()))
    const contextJson = escapeHtml(JSON.stringify(entry.context ?? {}, null, 2))
    const errorLabel = entry.error?.message
      ? `<div class="log-error">Blad: ${escapeHtml(String(entry.error.message))}</div>`
      : ''

    return `
      <article class="scheduled-card log-card">
        <div class="scheduled-card-header">
          <span class="scheduled-card-title">${timestamp}</span>
          <span class="scheduled-chip log-level-${level}">${levelLabel}</span>
        </div>
        <div class="scheduled-card-meta">
          <span class="scheduled-chip">Akcja: ${action}</span>
          <span class="scheduled-chip">Zakres: ${scope}</span>
        </div>
        <div class="scheduled-preview">${message}</div>
        ${errorLabel}
        <details class="log-context-details">
          <summary>Szczegoly kontekstu</summary>
          <pre class="log-context-pre">${contextJson}</pre>
        </details>
      </article>`
  }).join('')
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
  renderImageLibrary()

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
  const addCoinsButton = document.getElementById('economy-mutation-add-coins-btn')
  const addXpButton = document.getElementById('economy-mutation-add-xp-btn')
  const addLevelsButton = document.getElementById('economy-mutation-add-levels-btn')
  const importCsvButton = document.getElementById('economy-csv-import-btn')
  const addLevelRoleButton = document.getElementById('economy-level-role-add-btn')
  const levelRolesList = document.getElementById('economy-level-roles-list')

  reloadButton?.addEventListener('click', async () => {
    await loadEconomySettings({ silent: false })
  })

  saveButton?.addEventListener('click', async () => {
    await saveEconomySettings()
  })

  resetUsersButton?.addEventListener('click', async () => {
    await resetAllEconomyUsers()
  })

  addCoinsButton?.addEventListener('click', async () => {
    await applyEconomyUserMutation('add_coins')
  })

  addXpButton?.addEventListener('click', async () => {
    await applyEconomyUserMutation('add_xp')
  })

  addLevelsButton?.addEventListener('click', async () => {
    await applyEconomyUserMutation('add_levels')
  })

  importCsvButton?.addEventListener('click', async () => {
    await importEconomyCsvSnapshot()
  })

  addLevelRoleButton?.addEventListener('click', async () => {
    await addEconomyLevelRoleMapping()
  })

  levelRolesList?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-role-id]')
    if (!button) {
      return
    }

    const roleId = button.getAttribute('data-role-id')?.trim() ?? ''
    if (!/^\d{17,20}$/.test(roleId)) {
      showToast('❌ Nieprawidlowe roleId w mapowaniu.', 'error')
      return
    }

    await removeEconomyLevelRoleMapping(roleId)
  })

  renderEconomyLevelRoleOptions()
  renderEconomyLevelRoleMappings()
  bindEconomyPreviewListeners()
  renderEconomyRewardPreview()
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

function bindTimeoutSectionListeners() {
  const createButton = document.getElementById('timeout-create-btn')
  const refreshButton = document.getElementById('timeout-list-refresh-btn')
  const clearFilterButton = document.getElementById('timeout-filter-clear-btn')
  const createSearchInput = document.getElementById('timeout-user-search')
  const createSearchResults = document.getElementById('timeout-user-search-results')
  const filterSearchInput = document.getElementById('timeout-filter-user-search')
  const filterSearchResults = document.getElementById('timeout-filter-user-search-results')
  const list = document.getElementById('timeout-list')

  createButton?.addEventListener('click', async () => {
    await createTimeoutFromDashboard()
  })

  refreshButton?.addEventListener('click', async () => {
    await loadTimeoutList({ silent: false })
  })

  clearFilterButton?.addEventListener('click', async () => {
    timeoutFilterUserId = ''
    timeoutFilterSearchResults = []

    const filterInput = document.getElementById('timeout-filter-user-id')
    if (filterInput instanceof HTMLInputElement) {
      filterInput.value = ''
    }

    if (filterSearchInput instanceof HTMLInputElement) {
      filterSearchInput.value = ''
    }

    renderTimeoutMemberResults('filter', [], '')
    await loadTimeoutList({ silent: false })
  })

  createSearchInput?.addEventListener('input', () => {
    if (!(createSearchInput instanceof HTMLInputElement)) {
      return
    }

    if (timeoutCreateSearchDebounceId) {
      clearTimeout(timeoutCreateSearchDebounceId)
    }

    timeoutCreateSearchDebounceId = setTimeout(async () => {
      await searchTimeoutMembers(createSearchInput.value, 'create')
    }, 250)
  })

  filterSearchInput?.addEventListener('input', () => {
    if (!(filterSearchInput instanceof HTMLInputElement)) {
      return
    }

    if (timeoutFilterSearchDebounceId) {
      clearTimeout(timeoutFilterSearchDebounceId)
    }

    timeoutFilterSearchDebounceId = setTimeout(async () => {
      await searchTimeoutMembers(filterSearchInput.value, 'filter')
    }, 250)
  })

  createSearchResults?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-user-id]')
    if (!button) {
      return
    }

    const userId = button.getAttribute('data-user-id')?.trim() ?? ''
    const displayName = button.getAttribute('data-display-name')?.trim() ?? ''
    if (!/^\d{17,20}$/.test(userId)) {
      return
    }

    timeoutSelectedUserId = userId
    if (displayName.length > 0) {
      knownUsers.set(userId, displayName)
    }

    const selectedInput = document.getElementById('timeout-selected-user-id')
    if (selectedInput instanceof HTMLInputElement) {
      selectedInput.value = userId
    }

    if (createSearchInput instanceof HTMLInputElement && displayName.length > 0) {
      createSearchInput.value = displayName
    }

    timeoutCreateSearchResults = []
    renderTimeoutMemberResults('create', [], '')
  })

  filterSearchResults?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-user-id]')
    if (!button) {
      return
    }

    const userId = button.getAttribute('data-user-id')?.trim() ?? ''
    const displayName = button.getAttribute('data-display-name')?.trim() ?? ''
    if (!/^\d{17,20}$/.test(userId)) {
      return
    }

    timeoutFilterUserId = userId
    if (displayName.length > 0) {
      knownUsers.set(userId, displayName)
    }

    const filterInput = document.getElementById('timeout-filter-user-id')
    if (filterInput instanceof HTMLInputElement) {
      filterInput.value = userId
    }

    if (filterSearchInput instanceof HTMLInputElement && displayName.length > 0) {
      filterSearchInput.value = displayName
    }

    timeoutFilterSearchResults = []
    renderTimeoutMemberResults('filter', [], '')
    await loadTimeoutList({ silent: false })
  })

  list?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-timeout-remove-id]')
    if (!button) {
      return
    }

    const timeoutId = Number(button.getAttribute('data-timeout-remove-id') ?? '0')
    if (!Number.isFinite(timeoutId) || timeoutId <= 0) {
      showToast('❌ Nieprawidlowe timeoutId.', 'error')
      return
    }

    await removeTimeoutFromDashboard(timeoutId)
  })
}

function formatTimeoutRemainingLabel(expiresAt) {
  const msLeft = Math.max(0, Number(expiresAt) - Date.now())
  if (!Number.isFinite(msLeft) || msLeft <= 0) {
    return 'wygasa teraz'
  }

  const totalMinutes = Math.ceil(msLeft / 60000)
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }

  return `${Math.max(1, minutes)}m`
}

function resolveTimeoutDisplayName(userId) {
  const knownName = knownUsers.get(userId)
  if (typeof knownName === 'string' && knownName.trim().length > 0) {
    return knownName.trim()
  }

  return `Uzytkownik ${userId}`
}

function renderTimeoutMemberResults(mode, results, queryText = '') {
  const containerId = mode === 'create'
    ? 'timeout-user-search-results'
    : 'timeout-filter-user-search-results'
  const container = document.getElementById(containerId)
  if (!container) {
    return
  }

  const normalizedQuery = String(queryText ?? '').trim()
  if (!Array.isArray(results) || results.length === 0) {
    const emptyLabel = normalizedQuery.length < 2
      ? '<p class="popover-empty">Wpisz min. 2 znaki, aby wyszukac uzytkownika.</p>'
      : '<p class="popover-empty">Brak pasujacych uzytkownikow.</p>'
    container.innerHTML = emptyLabel
    return
  }

  container.innerHTML = results.map((member) => {
    const displayName = member.nick || member.globalName || member.username || 'uzytkownik'
    const username = member.username || 'unknown'

    return `
      <button type="button" class="mention-user-item" data-user-id="${escapeHtml(String(member.id ?? ''))}" data-display-name="${escapeHtml(displayName)}" title="@${escapeHtml(displayName)}">
        <span class="mention-user-name">${escapeHtml(displayName)}</span>
        <span class="mention-user-meta">@${escapeHtml(username)}</span>
      </button>`
  }).join('')
}

async function searchTimeoutMembers(rawQuery, mode) {
  const query = String(rawQuery ?? '').trim()
  if (mode !== 'create' && mode !== 'filter') {
    return
  }

  if (mode === 'create') {
    timeoutCreateSearchRequestId += 1
  } else {
    timeoutFilterSearchRequestId += 1
  }

  const requestId = mode === 'create' ? timeoutCreateSearchRequestId : timeoutFilterSearchRequestId

  if (query.length < 2) {
    if (mode === 'create') {
      timeoutCreateSearchResults = []
      renderTimeoutMemberResults('create', [], query)
    } else {
      timeoutFilterSearchResults = []
      renderTimeoutMemberResults('filter', [], query)
    }

    return
  }

  try {
    const response = await fetch(`/api/members/search?query=${encodeURIComponent(query)}&limit=8`)
    if (!response.ok) {
      throw new Error('fetch failed')
    }

    const payload = await response.json()
    const requestStillActive = mode === 'create'
      ? requestId === timeoutCreateSearchRequestId
      : requestId === timeoutFilterSearchRequestId
    if (!requestStillActive) {
      return
    }

    const members = Array.isArray(payload.members) ? payload.members : []
    members.forEach((member) => {
      if (!member?.id) {
        return
      }

      const displayName = member.nick || member.globalName || member.username || `Uzytkownik ${member.id}`
      knownUsers.set(String(member.id), String(displayName))
    })

    if (mode === 'create') {
      timeoutCreateSearchResults = members
      renderTimeoutMemberResults('create', timeoutCreateSearchResults, query)
    } else {
      timeoutFilterSearchResults = members
      renderTimeoutMemberResults('filter', timeoutFilterSearchResults, query)
    }
  } catch {
    const requestStillActive = mode === 'create'
      ? requestId === timeoutCreateSearchRequestId
      : requestId === timeoutFilterSearchRequestId
    if (!requestStillActive) {
      return
    }

    if (mode === 'create') {
      timeoutCreateSearchResults = []
      renderTimeoutMemberResults('create', [], query)
    } else {
      timeoutFilterSearchResults = []
      renderTimeoutMemberResults('filter', [], query)
    }

    showToast('Nie udalo sie wyszukac uzytkownikow.', 'error')
  }
}

function renderTimeoutList() {
  const list = document.getElementById('timeout-list')
  if (!list) {
    return
  }

  const errorBlock = timeoutLoadError
    ? `<div class="scheduled-empty scheduled-error">Nie udalo sie pobrac timeoutow: ${escapeHtml(timeoutLoadError)}</div>`
    : ''

  if (!Array.isArray(timeoutEntries) || timeoutEntries.length === 0) {
    list.innerHTML = timeoutLoadError
      ? errorBlock
      : '<div class="scheduled-empty">Brak aktywnych timeoutow.</div>'
    return
  }

  const nowTimestamp = Date.now()
  list.innerHTML = `${errorBlock}${timeoutEntries.map((timeoutEntry) => {
    const timeoutId = Number(timeoutEntry.id)
    const userId = String(timeoutEntry.userId ?? '')
    const reason = String(timeoutEntry.reason ?? 'Brak powodu')
    const createdAt = Number(timeoutEntry.createdAt)
    const expiresAt = Number(timeoutEntry.expiresAt)
    const createdByUserId = String(timeoutEntry.createdByUserId ?? 'unknown')
    const displayName = resolveTimeoutDisplayName(userId)
    const remainingLabel = formatTimeoutRemainingLabel(expiresAt)
    const isExpiringSoon = Number.isFinite(expiresAt) && (expiresAt - nowTimestamp) <= (60 * 60 * 1000)
    const statusClass = isExpiringSoon ? 'timeout-chip-expiring' : 'timeout-chip-active'
    const statusLabel = isExpiringSoon ? `Koniec za: ${remainingLabel}` : `Aktywny: ${remainingLabel}`

    return `
      <article class="scheduled-card">
        <div class="scheduled-card-header">
          <span class="scheduled-card-title">${escapeHtml(displayName)} (ID: ${escapeHtml(userId)})</span>
          <span class="scheduled-chip ${statusClass}">${escapeHtml(statusLabel)}</span>
        </div>
        <div class="scheduled-card-meta">
          <span class="scheduled-chip">Timeout ID: ${escapeHtml(String(timeoutId))}</span>
          <span class="scheduled-chip">Nadany przez: ${escapeHtml(createdByUserId)}</span>
          <span class="scheduled-chip">Start: ${escapeHtml(Number.isFinite(createdAt) ? formatTimestampInWarsaw(createdAt) : '-')}</span>
          <span class="scheduled-chip">Koniec: ${escapeHtml(Number.isFinite(expiresAt) ? formatTimestampInWarsaw(expiresAt) : '-')}</span>
          <span class="scheduled-chip">Powod: ${escapeHtml(reason)}</span>
        </div>
        <div class="scheduled-actions">
          <button class="btn-secondary" type="button" data-timeout-remove-id="${escapeHtml(String(timeoutId))}">Usun timeout</button>
        </div>
      </article>`
  }).join('')}`
}

async function loadTimeoutList({ silent = false } = {}) {
  try {
    const params = new URLSearchParams({
      limit: '100',
    })

    if (/^\d{17,20}$/.test(timeoutFilterUserId)) {
      params.set('userId', timeoutFilterUserId)
    }

    const response = await fetch(`/api/timeouts?${params.toString()}`)
    const payload = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie pobrac timeoutow.')
    }

    timeoutEntries = Array.isArray(payload.timeouts) ? payload.timeouts : []
    timeoutLoadError = null
    renderTimeoutList()
  } catch (error) {
    timeoutEntries = []
    timeoutLoadError = error instanceof Error ? error.message : 'Nieznany blad'
    renderTimeoutList()

    if (!silent) {
      showToast(`❌ ${timeoutLoadError}`, 'error')
    }
  }
}

async function createTimeoutFromDashboard() {
  const selectedUserInput = document.getElementById('timeout-selected-user-id')
  const durationAmountInput = document.getElementById('timeout-duration-amount')
  const durationUnitSelect = document.getElementById('timeout-duration-unit')
  const reasonInput = document.getElementById('timeout-reason')
  const createButton = document.getElementById('timeout-create-btn')

  if (!(selectedUserInput instanceof HTMLInputElement)
    || !(durationAmountInput instanceof HTMLInputElement)
    || !(durationUnitSelect instanceof HTMLSelectElement)
    || !(reasonInput instanceof HTMLTextAreaElement)) {
    showToast('❌ Brakuje pol formularza timeoutu.', 'error')
    return
  }

  const targetUserId = selectedUserInput.value.trim() || timeoutSelectedUserId
  if (!/^\d{17,20}$/.test(targetUserId)) {
    showToast('❌ Wybierz poprawnego uzytkownika z listy wyszukiwania.', 'error')
    return
  }

  const durationAmount = Number.parseInt(durationAmountInput.value.trim(), 10)
  if (!Number.isInteger(durationAmount) || durationAmount <= 0) {
    showToast('❌ Podaj dodatnia liczbe calkowita czasu timeoutu.', 'error')
    return
  }

  const durationUnit = durationUnitSelect.value.trim()
  if (!TIMEOUT_DURATION_UNITS.has(durationUnit)) {
    showToast('❌ Wybierz poprawna jednostke czasu timeoutu.', 'error')
    return
  }

  const reason = reasonInput.value.trim()
  if (reason.length === 0) {
    showToast('❌ Powod timeoutu nie moze byc pusty.', 'error')
    return
  }

  if (reason.length > 500) {
    showToast('❌ Powod timeoutu nie moze byc dluzszy niz 500 znakow.', 'error')
    return
  }

  if (createButton instanceof HTMLButtonElement) {
    createButton.disabled = true
  }

  try {
    const response = await fetchWithCsrf('/api/timeouts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        targetUserId,
        durationAmount,
        durationUnit,
        reason,
      }),
    })

    const payload = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie nalozyc timeoutu.')
    }

    timeoutSelectedUserId = targetUserId
    selectedUserInput.value = targetUserId
    showToast(`✅ Nalozono timeout na ${resolveTimeoutDisplayName(targetUserId)}.`, 'success')
    await loadTimeoutList({ silent: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany blad'
    showToast(`❌ ${message}`, 'error')
  } finally {
    if (createButton instanceof HTMLButtonElement) {
      createButton.disabled = false
    }
  }
}

async function removeTimeoutFromDashboard(timeoutId) {
  const confirmed = window.confirm('Czy na pewno chcesz usunac ten timeout?')
  if (!confirmed) {
    return
  }

  try {
    const response = await fetchWithCsrf(`/api/timeouts/${encodeURIComponent(String(timeoutId))}/remove`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })

    const payload = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie usunac timeoutu.')
    }

    showToast('✅ Timeout zostal usuniety.', 'success')
    await loadTimeoutList({ silent: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany blad'
    showToast(`❌ ${message}`, 'error')
  }
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
    const messageCount = Number.isFinite(Number(entry.messageCount)) ? Math.max(0, Number(entry.messageCount)) : 0
    const voiceMinutes = Number.isFinite(Number(entry.voiceMinutes)) ? Math.max(0, Number(entry.voiceMinutes)) : 0
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
          <span class="scheduled-chip">Wiadomosci: ${escapeHtml(String(messageCount))}</span>
          <span class="scheduled-chip">Minuty VC: ${escapeHtml(String(voiceMinutes))}</span>
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

function applyEconomySettingsAccessState() {
  const devControls = document.getElementById('economy-dev-controls')
  const accessNotice = document.getElementById('economy-dev-only-notice')
  const settingsNavItem = document.getElementById('economy-settings-nav-item')
    ?? document.querySelector('.sidebar-item[data-section="economy-settings"]')
  const logsNavItem = document.getElementById('system-logs-nav-item')
    ?? document.querySelector('.sidebar-item[data-section="system-logs"]')
  const hasDevAccess = economyHasDevAccess === true
  const isAccessDenied = economyHasDevAccess !== true
  const shouldShowDeniedNotice = economyHasDevAccess === false

  if (devControls instanceof HTMLElement) {
    devControls.style.display = hasDevAccess ? '' : 'none'
  }

  if (accessNotice instanceof HTMLElement) {
    accessNotice.hidden = !shouldShowDeniedNotice
  }

  if (settingsNavItem instanceof HTMLElement) {
    settingsNavItem.style.display = isAccessDenied ? 'none' : ''
  }

  if (logsNavItem instanceof HTMLElement) {
    logsNavItem.style.display = isAccessDenied ? 'none' : ''
  }

  if (isAccessDenied && currentSection === 'economy-settings') {
    switchSection('economy-leaderboard')
  }

  if (isAccessDenied && currentSection === 'system-logs') {
    switchSection('economy-leaderboard')
  }
}

function clearEconomyAccessRetryTimer() {
  if (economyAccessRetryTimerId) {
    clearTimeout(economyAccessRetryTimerId)
    economyAccessRetryTimerId = null
  }
}

function scheduleEconomyAccessRetry() {
  if (economyHasDevAccess !== null || economyAccessRetryTimerId) {
    return
  }

  economyAccessRetryTimerId = setTimeout(() => {
    economyAccessRetryTimerId = null
    void loadEconomySettings({ silent: true })
  }, 5000)
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

  const xpTextPerMessage = Math.floor(toFiniteNumber(readEconomyInputValue('economy-xp-text-per-message'), 'XP text: za wiadomosc'))
  const xpTextCooldownSeconds = Math.floor(toFiniteNumber(readEconomyInputValue('economy-xp-text-cooldown-seconds'), 'XP text: cooldown'))
  const xpVoicePerMinute = Math.floor(toFiniteNumber(readEconomyInputValue('economy-xp-voice-per-minute'), 'XP voice: za minute'))
  const watchpartyXpMultiplier = toFiniteNumber(readEconomyInputValue('economy-watchparty-xp-multiplier'), 'Watchparty: mnoznik XP')
  const watchpartyCoinBonusPerMinute = Math.floor(toFiniteNumber(readEconomyInputValue('economy-watchparty-coin-bonus-per-minute'), 'Watchparty: bonus coin/min'))

  if (dailyMaxCoins < dailyMinCoins) {
    throw new Error('Daily: max coins nie moze byc mniejsze niz min coins.')
  }

  if (dailyMessages.length === 0) {
    throw new Error('Podaj co najmniej jedna wiadomosc daily.')
  }

  return {
    dailyMinCoins,
    dailyMaxCoins,
    dailyStreakIncrement,
    dailyStreakMaxDays,
    dailyStreakGraceHours,
    dailyMessages,
    levelingMode: economyHiddenLevelingConfig.levelingMode,
    levelingCurve: economyHiddenLevelingConfig.levelingCurve,
    levelingBaseXp: economyHiddenLevelingConfig.levelingBaseXp,
    levelingExponent: economyHiddenLevelingConfig.levelingExponent,
    xpTextPerMessage,
    xpTextCooldownSeconds,
    xpVoicePerMinute,
    xpVoiceRequireTwoUsers: readEconomyCheckboxValue('economy-xp-voice-require-two-users'),
    xpVoiceAllowSelfMute: readEconomyCheckboxValue('economy-xp-voice-allow-self-mute'),
    xpVoiceAllowSelfDeaf: readEconomyCheckboxValue('economy-xp-voice-allow-self-deaf'),
    xpVoiceAllowAfk: readEconomyCheckboxValue('economy-xp-voice-allow-afk'),
    watchpartyXpMultiplier,
    watchpartyCoinBonusPerMinute,
    levelUpCoinsBase: economyHiddenLevelingConfig.levelUpCoinsBase,
    levelUpCoinsPerLevel: economyHiddenLevelingConfig.levelUpCoinsPerLevel,
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
  setValue('economy-xp-text-per-message', config.xpTextPerMessage)
  setValue('economy-xp-text-cooldown-seconds', config.xpTextCooldownSeconds)
  setValue('economy-xp-voice-per-minute', config.xpVoicePerMinute)
  setValue('economy-watchparty-xp-multiplier', config.watchpartyXpMultiplier)
  setValue('economy-watchparty-coin-bonus-per-minute', config.watchpartyCoinBonusPerMinute)
  setChecked('economy-xp-voice-require-two-users', config.xpVoiceRequireTwoUsers)
  setChecked('economy-xp-voice-allow-self-mute', config.xpVoiceAllowSelfMute)
  setChecked('economy-xp-voice-allow-self-deaf', config.xpVoiceAllowSelfDeaf)
  setChecked('economy-xp-voice-allow-afk', config.xpVoiceAllowAfk)
  economyHiddenLevelingConfig = {
    levelingMode: 'progressive',
    levelingCurve: 'formula_v2',
    levelingBaseXp: Number.isFinite(Number(config.levelingBaseXp)) ? Math.max(1, Math.floor(Number(config.levelingBaseXp))) : 100,
    levelingExponent: Number.isFinite(Number(config.levelingExponent)) ? Math.max(1, Number(config.levelingExponent)) : 1.5,
    levelUpCoinsBase: Number.isFinite(Number(config.levelUpCoinsBase)) ? Math.max(0, Math.floor(Number(config.levelUpCoinsBase))) : 25,
    levelUpCoinsPerLevel: Number.isFinite(Number(config.levelUpCoinsPerLevel)) ? Math.max(0, Math.floor(Number(config.levelUpCoinsPerLevel))) : 10,
  }

  renderEconomyRewardPreview()
}

function bindEconomyPreviewListeners() {
  const previewInputIds = [
    'economy-preview-level',
    'economy-preview-drip-level',
    'economy-preview-drip-xp',
    'economy-preview-range-start',
    'economy-preview-range-end',
  ]

  previewInputIds.forEach((inputId) => {
    const input = document.getElementById(inputId)
    if (input instanceof HTMLInputElement) {
      input.addEventListener('input', () => {
        renderEconomyRewardPreview()
      })
    }
  })
}

function toSafePreviewInt(rawValue, fallbackValue, minimumValue, maximumValue) {
  const numericValue = Number(rawValue)
  if (!Number.isFinite(numericValue)) {
    return fallbackValue
  }

  const flooredValue = Math.floor(numericValue)
  return Math.max(minimumValue, Math.min(maximumValue, flooredValue))
}

function resolveFormulaV2XpForNextLevel(level) {
  const safeLevel = toSafePreviewInt(level, 1, 1, ECONOMY_PREVIEW_MAX_LEVEL)
  const previousLevel = Math.max(0, safeLevel - 1)
  const formulaValue = 100
    + (0.04 * (previousLevel ** 3))
    + (0.8 * (previousLevel ** 2))
    + (2 * previousLevel)
    + 0.5

  return Math.max(1, Math.floor(formulaValue))
}

function resolveFormulaV2XpToReachLevel(level) {
  const safeLevel = toSafePreviewInt(level, 1, 1, ECONOMY_PREVIEW_MAX_LEVEL)
  let xpSpent = 0

  for (let currentLevel = 1; currentLevel < safeLevel; currentLevel += 1) {
    xpSpent += resolveFormulaV2XpForNextLevel(currentLevel)
  }

  return xpSpent
}

function resolveRankTierForLevel(level) {
  const safeLevel = toSafePreviewInt(level, 1, 1, ECONOMY_PREVIEW_MAX_LEVEL)
  const tier = ECONOMY_RANK_TIERS.find((candidateTier) => {
    return safeLevel >= candidateTier.minLevel && safeLevel <= candidateTier.maxLevel
  })

  return tier ?? ECONOMY_RANK_TIERS[ECONOMY_RANK_TIERS.length - 1]
}

function resolveLevelUpRewardForLevel(level) {
  const safeLevel = toSafePreviewInt(level, 1, 1, ECONOMY_PREVIEW_MAX_LEVEL)
  const tier = resolveRankTierForLevel(safeLevel)
  const xpRequiredForLevel = resolveFormulaV2XpToReachLevel(safeLevel)

  return {
    reward: Math.max(0, Math.floor(50 + (tier.levelRewardMultiplier * Math.sqrt(xpRequiredForLevel)))),
    xpRequiredForLevel,
    tier,
  }
}

function resolveDripReward(levelBeforeAward, xpGained) {
  const safeXpGained = toSafePreviewInt(xpGained, 0, 0, 1_000_000_000)
  const tier = resolveRankTierForLevel(levelBeforeAward)

  return {
    reward: Math.max(0, Math.floor(safeXpGained * tier.dripRate)),
    tier,
    safeXpGained,
  }
}

function renderEconomyRewardPreview() {
  const levelInput = document.getElementById('economy-preview-level')
  const dripLevelInput = document.getElementById('economy-preview-drip-level')
  const dripXpInput = document.getElementById('economy-preview-drip-xp')
  const rangeStartInput = document.getElementById('economy-preview-range-start')
  const rangeEndInput = document.getElementById('economy-preview-range-end')

  const levelOutput = document.getElementById('economy-preview-level-output')
  const dripOutput = document.getElementById('economy-preview-drip-output')
  const rangeTotalOutput = document.getElementById('economy-preview-range-total')
  const rangeBreakdown = document.getElementById('economy-preview-range-breakdown')

  if (!(levelInput instanceof HTMLInputElement)
    || !(dripLevelInput instanceof HTMLInputElement)
    || !(dripXpInput instanceof HTMLInputElement)
    || !(rangeStartInput instanceof HTMLInputElement)
    || !(rangeEndInput instanceof HTMLInputElement)
    || !(levelOutput instanceof HTMLElement)
    || !(dripOutput instanceof HTMLElement)
    || !(rangeTotalOutput instanceof HTMLElement)
    || !(rangeBreakdown instanceof HTMLElement)) {
    return
  }

  const targetLevel = toSafePreviewInt(levelInput.value, 1, 1, ECONOMY_PREVIEW_MAX_LEVEL)
  levelInput.value = String(targetLevel)
  const levelReward = resolveLevelUpRewardForLevel(targetLevel)
  levelOutput.textContent = `Nagroda: ${levelReward.reward} coin | XP(${targetLevel})=${levelReward.xpRequiredForLevel} | M_r=${levelReward.tier.levelRewardMultiplier.toFixed(2)}`

  const dripLevel = toSafePreviewInt(dripLevelInput.value, 1, 1, ECONOMY_PREVIEW_MAX_LEVEL)
  dripLevelInput.value = String(dripLevel)
  const dripXp = toSafePreviewInt(dripXpInput.value, 0, 0, 1_000_000_000)
  dripXpInput.value = String(dripXp)
  const drip = resolveDripReward(dripLevel, dripXp)
  dripOutput.textContent = `Nagroda drip: ${drip.reward} coin | xpGained=${drip.safeXpGained} | D_r=${drip.tier.dripRate.toFixed(2)}`

  const rangeStart = toSafePreviewInt(rangeStartInput.value, 1, 1, ECONOMY_PREVIEW_MAX_LEVEL)
  rangeStartInput.value = String(rangeStart)
  const rangeEnd = toSafePreviewInt(rangeEndInput.value, rangeStart + 1, 1, ECONOMY_PREVIEW_MAX_LEVEL)
  rangeEndInput.value = String(rangeEnd)

  if (rangeEnd <= rangeStart) {
    rangeTotalOutput.textContent = 'Suma: 0 coin (koniec musi byc wiekszy od startu).'
    rangeBreakdown.innerHTML = ''
    return
  }

  const breakdownRows = []
  let totalReward = 0
  const cappedRangeEnd = Math.min(rangeEnd, rangeStart + 150)

  for (let level = rangeStart + 1; level <= cappedRangeEnd; level += 1) {
    const rewardDetails = resolveLevelUpRewardForLevel(level)
    totalReward += rewardDetails.reward
    breakdownRows.push(`<span class="economy-reward-pill">L${level}: +${rewardDetails.reward}</span>`)
  }

  const wasCapped = cappedRangeEnd !== rangeEnd
  rangeTotalOutput.textContent = wasCapped
    ? `Suma: ${totalReward} coin (pokazano do L${cappedRangeEnd}, limit 150 leveli naraz).`
    : `Suma: ${totalReward} coin.`
  rangeBreakdown.innerHTML = breakdownRows.join('')
}

function resolveEconomyMutationAmount(operation) {
  if (operation === 'add_coins') {
    return Math.floor(toFiniteNumber(readEconomyInputValue('economy-mutation-coins-amount'), 'Coins do dodania'))
  }

  if (operation === 'add_levels') {
    return Math.floor(toFiniteNumber(readEconomyInputValue('economy-mutation-levels-amount'), 'Levele do dodania'))
  }

  return Math.floor(toFiniteNumber(readEconomyInputValue('economy-mutation-xp-amount'), 'XP do dodania'))
}

function resolveEconomyMutationRequestBody(operation) {
  const targetUserId = readEconomyInputValue('economy-mutation-user-id').trim()
  if (!/^\d{17,20}$/.test(targetUserId)) {
    throw new Error('Podaj poprawne ID użytkownika Discord (17-20 cyfr).')
  }

  const amount = resolveEconomyMutationAmount(operation)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Kwota mutacji musi być większa od zera.')
  }

  if (operation === 'add_levels' && amount > 1000) {
    throw new Error('Levele do dodania musza byc z zakresu 1-1000.')
  }

  const requestBody = {
    targetUserId,
    operation,
    amount,
  }

  return requestBody
}

async function applyEconomyUserMutation(operation) {
  const buttonId = operation === 'add_coins'
    ? 'economy-mutation-add-coins-btn'
    : operation === 'add_levels'
      ? 'economy-mutation-add-levels-btn'
      : 'economy-mutation-add-xp-btn'

  const actionLabel = operation === 'add_coins'
    ? 'coins'
    : operation === 'add_levels'
      ? 'leveli'
      : 'XP'
  const button = document.getElementById(buttonId)
  if (button instanceof HTMLButtonElement) {
    button.disabled = true
  }

  try {
    const requestBody = resolveEconomyMutationRequestBody(operation)
    const response = await fetchWithCsrf('/api/economy/user-mutation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    const payload = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udało się wykonać ręcznej mutacji ekonomii.')
    }

    const mutation = payload.mutation
    if (!mutation || typeof mutation !== 'object') {
      throw new Error('Brak danych mutacji ekonomii w odpowiedzi serwera.')
    }

    const appliedAmount = Number.isFinite(Number(mutation.amount))
      ? Math.max(1, Math.floor(Number(mutation.amount)))
      : requestBody.amount

    showToast(
      `✅ Dodano ${appliedAmount} ${actionLabel} użytkownikowi ${requestBody.targetUserId}. Aktualnie: ${mutation.currentCoins} coins, ${mutation.currentXp} XP, level ${mutation.currentLevel}.`,
      'success',
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd'
    showToast(`❌ ${message}`, 'error')
  } finally {
    if (button instanceof HTMLButtonElement) {
      button.disabled = false
    }
  }
}

function resolveRoleNameById(roleId) {
  const role = roles.find((candidate) => String(candidate?.id ?? '') === roleId)
  const roleName = typeof role?.name === 'string' ? role.name.trim() : ''
  return roleName.length > 0 ? roleName : roleId
}

function renderEconomyLevelRoleOptions() {
  const select = document.getElementById('economy-level-role-id')
  if (!(select instanceof HTMLSelectElement)) {
    return
  }

  const roleOptions = roles
    .map((role) => {
      return {
        id: String(role?.id ?? '').trim(),
        name: String(role?.name ?? '').trim(),
      }
    })
    .filter((role) => /^\d{17,20}$/.test(role.id) && role.name.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name, 'pl'))

  const previousValue = select.value
  select.innerHTML = [
    '<option value="">Wybierz rolę</option>',
    ...roleOptions.map((role) => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.name)}</option>`),
  ].join('')

  if (roleOptions.some((role) => role.id === previousValue)) {
    select.value = previousValue
  }
}

function renderEconomyLevelRoleMappings() {
  const list = document.getElementById('economy-level-roles-list')
  if (!list) {
    return
  }

  if (!Array.isArray(economyLevelRoleMappings) || economyLevelRoleMappings.length === 0) {
    list.innerHTML = '<div class="scheduled-empty">Brak mapowan rol levelowych.</div>'
    return
  }

  const sortedMappings = [...economyLevelRoleMappings].sort((left, right) => {
    if (left.minLevel !== right.minLevel) {
      return left.minLevel - right.minLevel
    }

    return String(left.roleId).localeCompare(String(right.roleId), 'pl')
  })

  list.innerHTML = sortedMappings.map((mapping) => {
    return `
      <article class="scheduled-card">
        <div class="scheduled-card-header">
          <span class="scheduled-card-title">${escapeHtml(resolveRoleNameById(String(mapping.roleId)))} (ID: ${escapeHtml(String(mapping.roleId))})</span>
          <span class="scheduled-chip leaderboard-chip-primary">Level >= ${escapeHtml(String(mapping.minLevel))}</span>
        </div>
        <div class="scheduled-actions">
          <button class="btn-secondary" type="button" data-role-id="${escapeHtml(String(mapping.roleId))}">Usun mapowanie</button>
        </div>
      </article>`
  }).join('')
}

async function loadEconomyLevelRoleMappings({ silent } = { silent: false }) {
  try {
    const response = await fetch('/api/economy/level-roles')
    const payload = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie pobrac mapowan rol levelowych.')
    }

    const mappings = Array.isArray(payload.mappings) ? payload.mappings : []
    economyLevelRoleMappings = mappings.map((mapping) => {
      return {
        roleId: String(mapping.roleId ?? '').trim(),
        minLevel: Number.isFinite(Number(mapping.minLevel)) ? Math.max(1, Number(mapping.minLevel)) : 1,
      }
    }).filter((mapping) => /^\d{17,20}$/.test(mapping.roleId))
    economyLevelRoleMappingsLoaded = true

    renderEconomyLevelRoleOptions()
    renderEconomyLevelRoleMappings()
  } catch (error) {
    economyLevelRoleMappingsLoaded = false
    economyLevelRoleMappings = []

    if (!silent) {
      const message = error instanceof Error ? error.message : 'Nieznany blad'
      showToast(`❌ ${message}`, 'error')
    }

    renderEconomyLevelRoleOptions()
    renderEconomyLevelRoleMappings()
  }
}

async function saveEconomyLevelRoleMappings(nextMappings) {
  if (!economyLevelRoleMappingsLoaded) {
    throw new Error('Najpierw odswiez mapowania rol levelowych i upewnij sie, ze zostaly poprawnie zaladowane.')
  }

  const response = await fetchWithCsrf('/api/economy/level-roles', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mappings: nextMappings }),
  })

  const payload = await parseApiResponse(response)
  if (!response.ok) {
    throw new Error(payload.error ?? 'Nie udalo sie zapisac mapowan rol levelowych.')
  }

  const mappings = Array.isArray(payload.mappings) ? payload.mappings : []
  economyLevelRoleMappings = mappings.map((mapping) => {
    return {
      roleId: String(mapping.roleId ?? '').trim(),
      minLevel: Number.isFinite(Number(mapping.minLevel)) ? Math.max(1, Number(mapping.minLevel)) : 1,
    }
  }).filter((mapping) => /^\d{17,20}$/.test(mapping.roleId))
  economyLevelRoleMappingsLoaded = true

  renderEconomyLevelRoleMappings()
}

async function addEconomyLevelRoleMapping() {
  if (!economyLevelRoleMappingsLoaded) {
    showToast('❌ Najpierw odswiez mapowania rol levelowych.', 'error')
    return
  }

  const roleSelect = document.getElementById('economy-level-role-id')
  const minLevelInput = document.getElementById('economy-level-role-min-level')
  const addButton = document.getElementById('economy-level-role-add-btn')

  if (!(roleSelect instanceof HTMLSelectElement) || !(minLevelInput instanceof HTMLInputElement)) {
    showToast('❌ Brakuje pol mapowania roli levelowej.', 'error')
    return
  }

  const roleId = roleSelect.value.trim()
  if (!/^\d{17,20}$/.test(roleId)) {
    showToast('❌ Wybierz poprawna role.', 'error')
    return
  }

  const minLevel = Math.floor(toFiniteNumber(minLevelInput.value, 'Minimalny level mapowania roli'))
  if (minLevel < 1) {
    showToast('❌ Minimalny level mapowania musi byc >= 1.', 'error')
    return
  }

  if (addButton instanceof HTMLButtonElement) {
    addButton.disabled = true
  }

  try {
    const existingWithoutCurrentRole = economyLevelRoleMappings.filter((mapping) => mapping.roleId !== roleId)
    const nextMappings = [
      ...existingWithoutCurrentRole,
      {
        roleId,
        minLevel,
      },
    ]

    await saveEconomyLevelRoleMappings(nextMappings)
    showToast('✅ Zapisano mapowanie roli levelowej.', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany blad'
    showToast(`❌ ${message}`, 'error')
  } finally {
    if (addButton instanceof HTMLButtonElement) {
      addButton.disabled = false
    }
  }
}

async function removeEconomyLevelRoleMapping(roleId) {
  if (!economyLevelRoleMappingsLoaded) {
    showToast('❌ Najpierw odswiez mapowania rol levelowych.', 'error')
    return
  }

  const nextMappings = economyLevelRoleMappings.filter((mapping) => String(mapping.roleId) !== roleId)

  try {
    await saveEconomyLevelRoleMappings(nextMappings)
    showToast('✅ Usunieto mapowanie roli levelowej.', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany blad'
    showToast(`❌ ${message}`, 'error')
  }
}

async function importEconomyCsvSnapshot() {
  const fileInput = document.getElementById('economy-csv-import-file')
  const importButton = document.getElementById('economy-csv-import-btn')

  if (!(fileInput instanceof HTMLInputElement)) {
    showToast('❌ Brakuje pola pliku CSV.', 'error')
    return
  }

  const selectedFile = fileInput.files?.[0]
  if (!selectedFile) {
    showToast('❌ Wybierz plik CSV do importu.', 'error')
    return
  }

  if (importButton instanceof HTMLButtonElement) {
    importButton.disabled = true
  }

  try {
    if (selectedFile.size > MAX_ECONOMY_CSV_IMPORT_BYTES) {
      throw new Error('Plik CSV jest za duzy. Maksymalny rozmiar to 2 MB.')
    }

    const csvContent = await selectedFile.text()
    if (csvContent.trim().length === 0) {
      throw new Error('Wybrany plik CSV jest pusty.')
    }

    const response = await fetchWithCsrf('/api/economy/import-csv', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ csvContent }),
    })

    const payload = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie zaimportowac CSV ekonomii.')
    }

    const result = payload.result ?? {}
    const roleSync = payload.roleSync ?? {}
    const importedRows = Number.isFinite(Number(result.importedRows)) ? Number(result.importedRows) : 0
    const insertedRows = Number.isFinite(Number(result.insertedRows)) ? Number(result.insertedRows) : 0
    const updatedRows = Number.isFinite(Number(result.updatedRows)) ? Number(result.updatedRows) : 0
    const roleUpdatedUsers = Number.isFinite(Number(roleSync.updatedUsers)) ? Number(roleSync.updatedUsers) : 0
    const roleFailedUsers = Number.isFinite(Number(roleSync.failedUsers)) ? Number(roleSync.failedUsers) : 0

    const roleSyncSuffix = roleFailedUsers > 0
      ? ` Synchronizacja rol: zaktualizowano ${roleUpdatedUsers}, bledy ${roleFailedUsers}.`
      : ` Synchronizacja rol: zaktualizowano ${roleUpdatedUsers}.`

    showToast(`✅ Import zakonczony: ${importedRows} wierszy (dodano ${insertedRows}, zaktualizowano ${updatedRows}).${roleSyncSuffix}`, 'success')
    fileInput.value = ''
    await loadEconomyLeaderboard({ silent: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany blad'
    showToast(`❌ ${message}`, 'error')
  } finally {
    if (importButton instanceof HTMLButtonElement) {
      importButton.disabled = false
    }
  }
}

async function loadEconomySettings({ silent } = { silent: false }) {
  economySettingsLoadRequestId += 1
  const requestId = economySettingsLoadRequestId

  try {
    const response = await fetch('/api/economy/settings')
    const payload = await parseApiResponse(response)

    if (!response.ok) {
      if (response.status === 403 && requestId === economySettingsLoadRequestId) {
        clearEconomyAccessRetryTimer()
        economyHasDevAccess = false
        economySettingsLastLoadedAt = null
        setEconomySettingsLastLoadedLabel()
        applyEconomySettingsAccessState()
      }

      throw new Error(payload.error ?? 'Nie udalo sie pobrac ustawien ekonomii.')
    }

    if (requestId !== economySettingsLoadRequestId) {
      return false
    }

    if (!payload.config || typeof payload.config !== 'object') {
      throw new Error('Nieprawidlowy format odpowiedzi ustawien ekonomii.')
    }

    setEconomySettingsForm(payload.config)
    economySettingsLastLoadedAt = Date.now()
    economySettingsLoadSuccessful = true
    clearEconomyAccessRetryTimer()
    economyHasDevAccess = true
    setEconomySettingsLastLoadedLabel()
    applyEconomySettingsAccessState()
    return true
  } catch (error) {
    if (requestId !== economySettingsLoadRequestId) {
      return false
    }

    economySettingsLoadSuccessful = false

    if (!silent) {
      const message = error instanceof Error ? error.message : 'Nieznany blad'
      showToast(`❌ ${message}`, 'error')
    }

    scheduleEconomyAccessRetry()
    applyEconomySettingsAccessState()
    return false
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

function normalizeImageSortBy(sortBy) {
  return String(sortBy ?? '').trim() === 'name_asc' ? 'name_asc' : 'newest'
}

async function fetchImagePageData({ page, pageSize, search, sortBy }) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    search: String(search ?? '').trim(),
    sortBy: normalizeImageSortBy(sortBy),
  })

  const response = await fetch(`/api/images?${params.toString()}`)
  const payload = await parseApiResponse(response)
  if (!response.ok) {
    throw new Error(payload.error ?? 'Nie udało się pobrać obrazów z /img.')
  }

  const entries = Array.isArray(payload.entries) ? payload.entries : []
  const pagination = payload.pagination && typeof payload.pagination === 'object'
    ? payload.pagination
    : {}

  const totalPages = Number.isFinite(Number(pagination.totalPages))
    ? Math.max(1, Number(pagination.totalPages))
    : 1
  const totalItems = Number.isFinite(Number(pagination.totalItems))
    ? Math.max(0, Number(pagination.totalItems))
    : entries.length
  const nextPage = Number.isFinite(Number(pagination.page))
    ? Math.max(1, Math.min(totalPages, Number(pagination.page)))
    : 1

  return {
    entries,
    page: nextPage,
    totalPages,
    totalItems,
  }
}

async function loadImages(options = {}) {
  const requestId = ++creatorImageLoadRequestId
  const nextPage = Number.isFinite(Number(options.page))
    ? Math.max(1, Number(options.page))
    : creatorImagePage
  const silent = options.silent === true

  try {
    const result = await fetchImagePageData({
      page: nextPage,
      pageSize: CREATOR_IMAGE_PAGE_SIZE,
      search: creatorImageSearch,
      sortBy: 'newest',
    })

    if (requestId !== creatorImageLoadRequestId) {
      return
    }

    creatorImageEntries = result.entries
    images = creatorImageEntries.map((entry) => String(entry.name ?? ''))
    creatorImagePage = result.page
    creatorImageTotalPages = result.totalPages
    creatorImageTotalItems = result.totalItems

    if (selectedImageName && !images.includes(selectedImageName)) {
      const selectedExistsInLibrary = creatorImageTotalItems > 0
      if (!selectedExistsInLibrary) {
        selectedImageName = null
      }
    }

    renderImageLibrary()
  } catch (error) {
    if (requestId !== creatorImageLoadRequestId) {
      return
    }

    creatorImageEntries = []
    images = []
    creatorImagePage = 1
    creatorImageTotalPages = 1
    creatorImageTotalItems = 0
    renderImageLibrary()

    if (!silent) {
      const message = error instanceof Error ? error.message : 'Nie udało się pobrać obrazów z /img.'
      showToast(`❌ ${message}`, 'error')
    }
  }
}

async function loadImageLibraryPage(options = {}) {
  const requestId = ++libraryImageLoadRequestId
  const nextPage = Number.isFinite(Number(options.page))
    ? Math.max(1, Number(options.page))
    : libraryImagePage
  const silent = options.silent === true

  try {
    const result = await fetchImagePageData({
      page: nextPage,
      pageSize: IMAGE_LIBRARY_PAGE_SIZE,
      search: libraryImageSearch,
      sortBy: libraryImageSortBy,
    })

    if (requestId !== libraryImageLoadRequestId) {
      return
    }

    libraryImageEntries = result.entries
    libraryImagePage = result.page
    libraryImageTotalPages = result.totalPages
    libraryImageTotalItems = result.totalItems
    renderImageLibraryPage()
  } catch (error) {
    if (requestId !== libraryImageLoadRequestId) {
      return
    }

    libraryImageEntries = []
    libraryImagePage = 1
    libraryImageTotalPages = 1
    libraryImageTotalItems = 0
    renderImageLibraryPage()

    if (!silent) {
      const message = error instanceof Error ? error.message : 'Nie udało się pobrać biblioteki grafik.'
      showToast(`❌ ${message}`, 'error')
    }
  }
}

async function syncImageLibraryWithCreator(options = {}) {
  const silent = options.silent === true
  const creatorPage = options.creatorPage ?? creatorImagePage
  const libraryPage = options.libraryPage ?? libraryImagePage

  await Promise.all([
    loadImages({ page: creatorPage, silent }),
    loadImageLibraryPage({ page: libraryPage, silent }),
  ])

  updatePreview()
  updateSendButton()
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

function formatImageSizeLabel(sizeBytes) {
  const size = Number(sizeBytes)
  if (!Number.isFinite(size) || size <= 0) {
    return '0 B'
  }

  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatImageModifiedAtLabel(modifiedAt) {
  const value = Number(modifiedAt)
  if (!Number.isFinite(value) || value <= 0) {
    return 'nieznana data'
  }

  return formatTimestampInWarsaw(value)
}

function renderImageLibrary() {
  const grid = document.getElementById('image-grid')
  const paginationContainer = document.getElementById('image-library-pagination')
  const pageLabel = document.getElementById('image-library-page-label')
  const prevButton = document.getElementById('image-library-prev-btn')
  const nextButton = document.getElementById('image-library-next-btn')

  if (!grid) {
    return
  }

  if (pageLabel) {
    pageLabel.textContent = `Strona ${creatorImagePage}/${creatorImageTotalPages}`
  }

  if (paginationContainer) {
    paginationContainer.hidden = creatorImageTotalPages <= 1
  }

  if (prevButton instanceof HTMLButtonElement) {
    prevButton.disabled = creatorImagePage <= 1
  }

  if (nextButton instanceof HTMLButtonElement) {
    nextButton.disabled = creatorImagePage >= creatorImageTotalPages
  }

  if (creatorImageEntries.length === 0) {
    const emptyMessage = creatorImageSearch
      ? `Brak grafik pasujacych do wyszukiwania: "${escapeHtml(creatorImageSearch)}".`
      : 'Brak obrazow w folderze /img.'
    grid.innerHTML = `<p class="img-empty">${emptyMessage}</p>`
    return
  }

  grid.innerHTML = creatorImageEntries
    .map((entry) => {
      const name = String(entry?.name ?? '')
      if (!name) {
        return ''
      }

      return `
      <div class="img-card${selectedImageName === name ? ' selected' : ''}" data-name="${escapeHtml(name)}" title="${escapeHtml(name)}">
        <img src="/img/${encodeURIComponent(name)}" alt="${escapeHtml(name)}" loading="lazy">
        <span class="img-card-name">${escapeHtml(name)}</span>
      </div>`
    })
    .join('')

  grid.querySelectorAll('.img-card').forEach((card) => {
    card.addEventListener('click', () => {
      const nextName = card.dataset.name
      if (!nextName) {
        return
      }

      selectedImageName = nextName
      selectedUploadFile = null
      clearUploadPreviewUrl()

      const uploadInput = document.getElementById('image-upload-input')
      if (uploadInput instanceof HTMLInputElement) {
        uploadInput.value = ''
      }

      const fileNameElement = document.getElementById('upload-file-name')
      if (fileNameElement) {
        fileNameElement.textContent = 'Nie wybrano pliku.'
      }

      renderImageLibrary()
      updatePreview()
      updateSendButton()
    })
  })
}

function renderImageLibraryPage() {
  const listContainer = document.getElementById('image-library-tab-list')
  const paginationContainer = document.getElementById('image-library-tab-pagination')
  const pageLabel = document.getElementById('image-library-tab-page-label')
  const countLabel = document.getElementById('image-library-tab-count-label')
  const prevButton = document.getElementById('image-library-tab-prev-btn')
  const nextButton = document.getElementById('image-library-tab-next-btn')

  if (!listContainer) {
    return
  }

  if (pageLabel) {
    pageLabel.textContent = `Strona ${libraryImagePage}/${libraryImageTotalPages}`
  }

  if (countLabel) {
    countLabel.textContent = `Elementy: ${libraryImageTotalItems}`
  }

  if (paginationContainer) {
    paginationContainer.hidden = libraryImageTotalPages <= 1
  }

  if (prevButton instanceof HTMLButtonElement) {
    prevButton.disabled = libraryImagePage <= 1
  }

  if (nextButton instanceof HTMLButtonElement) {
    nextButton.disabled = libraryImagePage >= libraryImageTotalPages
  }

  if (libraryImageEntries.length === 0) {
    const emptyMessage = libraryImageSearch
      ? `Brak grafik pasujacych do wyszukiwania: "${escapeHtml(libraryImageSearch)}".`
      : 'Biblioteka grafik jest pusta.'
    listContainer.innerHTML = `<div class="scheduled-empty">${emptyMessage}</div>`
    return
  }

  listContainer.innerHTML = `
    <div class="image-library-cards">
      ${libraryImageEntries.map((entry) => {
    const name = String(entry?.name ?? '')
    if (!name) {
      return ''
    }

    return `
          <article class="image-library-card">
            <div class="image-library-card-preview">
              <img src="/img/${encodeURIComponent(name)}" alt="${escapeHtml(name)}" loading="lazy">
            </div>
            <div class="image-library-card-meta">
              <strong class="image-library-card-name">${escapeHtml(name)}</strong>
              <span class="image-library-card-details">${formatImageSizeLabel(entry.sizeBytes)} • ${formatImageModifiedAtLabel(entry.modifiedAt)}</span>
            </div>
            <div class="image-library-card-actions">
              <a class="btn-secondary image-library-download-link" href="/img/${encodeURIComponent(name)}" download="${escapeHtml(name)}">Pobierz</a>
              <button type="button" class="btn-secondary" data-image-action="rename" data-filename="${escapeHtml(name)}">Zmien nazwe</button>
              <button type="button" class="btn-danger" data-image-action="delete" data-filename="${escapeHtml(name)}">Usun</button>
            </div>
          </article>`
  }).join('')}
    </div>`
}

async function uploadImageToLibrary() {
  const uploadFileInput = document.getElementById('image-library-upload-file')
  const uploadNameInput = document.getElementById('image-library-upload-name')
  const selectedFile = uploadFileInput instanceof HTMLInputElement
    ? uploadFileInput.files?.[0]
    : null

  if (!selectedFile) {
    showToast('Wybierz plik, ktory chcesz dodac do biblioteki.', 'error')
    return
  }

  if (!isAllowedUploadFile(selectedFile)) {
    showToast('Dozwolone sa tylko pliki PNG, JPG, GIF, WebP i SVG.', 'error')
    return
  }

  if (selectedFile.size > MAX_UPLOAD_BYTES) {
    showToast('Plik jest za duzy. Maksymalny rozmiar to 20 MB.', 'error')
    return
  }

  const customFilename = uploadNameInput instanceof HTMLInputElement
    ? String(uploadNameInput.value ?? '').trim()
    : ''
  const targetFilename = customFilename || selectedFile.name
  const uploadMimeType = normalizeUploadMimeType(selectedFile.type, selectedFile.name)
  const uploadBase64 = await fileToDataUrl(selectedFile)

  try {
    const response = await fetchWithCsrf('/api/images/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: targetFilename,
        uploadBase64,
        uploadMimeType,
      }),
    })

    const payload = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie dodac obrazu do biblioteki.')
    }

    if (uploadFileInput instanceof HTMLInputElement) {
      uploadFileInput.value = ''
    }

    if (uploadNameInput instanceof HTMLInputElement) {
      uploadNameInput.value = ''
    }

    await syncImageLibraryWithCreator({ silent: true })
    showToast('✅ Grafika zostala dodana do biblioteki.', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udalo sie dodac obrazu do biblioteki.'
    showToast(`❌ ${message}`, 'error')
  }
}

async function renameImageInLibrary(filename) {
  const trimmedFilename = String(filename ?? '').trim()
  if (!trimmedFilename) {
    return
  }

  const prompted = window.prompt('Podaj nowa nazwe pliku:', trimmedFilename)
  if (prompted === null) {
    return
  }

  const nextFilename = prompted.trim()
  if (!nextFilename) {
    showToast('Nowa nazwa pliku nie moze byc pusta.', 'error')
    return
  }

  try {
    const response = await fetchWithCsrf('/api/images/rename', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: trimmedFilename,
        newFilename: nextFilename,
      }),
    })

    const payload = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie zmienic nazwy obrazu.')
    }

    const renamedTo = String(payload.entry?.name ?? '').trim()
    if (selectedImageName === trimmedFilename && renamedTo) {
      selectedImageName = renamedTo
    }

    await syncImageLibraryWithCreator({ silent: true })
    showToast('✅ Nazwa grafiki zostala zaktualizowana.', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udalo sie zmienic nazwy obrazu.'
    showToast(`❌ ${message}`, 'error')
  }
}

async function deleteImageFromLibrary(filename) {
  const trimmedFilename = String(filename ?? '').trim()
  if (!trimmedFilename) {
    return
  }

  const shouldDelete = window.confirm(`Czy na pewno usunac obraz "${trimmedFilename}" z biblioteki?`)
  if (!shouldDelete) {
    return
  }

  try {
    const response = await fetchWithCsrf(`/api/images/${encodeURIComponent(trimmedFilename)}`, {
      method: 'DELETE',
    })

    const payload = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie usunac obrazu.')
    }

    if (selectedImageName === trimmedFilename) {
      selectedImageName = null
    }

    await syncImageLibraryWithCreator({ silent: true })
    showToast('🗑️ Grafika zostala usunieta z biblioteki.', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udalo sie usunac obrazu.'
    showToast(`❌ ${message}`, 'error')
  }
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
    renderImageLibrary()
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
  scheduleCreatorPreviewScrollSync()
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
      renderImageLibrary()
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
