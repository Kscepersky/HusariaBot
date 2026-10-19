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
const DASHBOARD_LOGS_PAGE_SIZE = 40
const DASHBOARD_LOGS_AUTO_REFRESH_MS = 10_000
const LOG_CATEGORY_ICONS = { security: '🛡️', auth: '🔑', posts: '📝', economy: '💰', shop: '🛒', events: '🎉', bot: '🤖', system: '⚙️' }
const LOG_CATEGORY_ORDER = ['security', 'auth', 'posts', 'economy', 'shop', 'events', 'bot', 'system']
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
let emojiTab = 'server'
let unicodeEmojiGroupKey = null
let unicodeEmojiIndex = null
let recentUnicodeEmojis = []
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
let dashboardLogsScope = 'all'
let dashboardLogsCategory = 'all'
let dashboardLogsRange = '24h'
let dashboardLogsSummary = null
let dashboardLogsAutoRefreshId = null
let dashboardLogsHideNoise = true
let dashboardLogsHiddenNoiseCount = 0
let dashboardLogsScopes = []
let dashboardLogsLoadRequestId = 0
let dashboardLogsSearchDebounceId = null
let dashboardLogsAbortController = null
let sessionActivitySectionBound = false
let sessionActivityPage = 1
let sessionActivityTotalPages = 1
let sessionActivityTotalEvents = 0
let sessionOnlineUsers = []
let sessionRecentEvents = []
let sessionActivityLoadRequestId = 0
let economyLevelRoleMappings = []
let economyLevelRoleMappingsLoaded = false
let currentDashboardRole = null
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

let shopSectionBound = false
let shopActiveTab = 'items'
let shopItems = []
let shopItemsPage = 1
let shopItemsTotalPages = 1
let shopItemsTotalItems = 0
let shopItemsIncludeInactive = false
let shopItemsLoadRequestId = 0
let shopEditingItemId = null
let shopOrders = []
let shopOrdersPage = 1
let shopOrdersTotalPages = 1
let shopOrdersTotalItems = 0
let shopOrdersStatusFilter = 'all'
let shopOrdersUserFilter = ''
let shopOrdersUserFilterDebounceId = null
let shopOrdersLoadRequestId = 0
let shopExpandedOrderId = null
/** @type {Map<string, {displayName: string, avatarUrl: string|null}>} */
let shopMemberProfiles = new Map()
let g2RefreshInProgress = false
let g2RefreshCooldownMs = 30000
let g2FilterDebounceId = null
let g2LoadRequestId = 0
let csrfTokenPromise = null

let selectedMatchInfo = null

const statsTabDates = {
  users:    { startDate: '', endDate: '' },
  messages: { startDate: '', endDate: '' },
  voice:    { startDate: '', endDate: '' },
}
let statsActiveTab = 'users'
let statsSectionBound = false
let statsExcludedChannelIds = []
let statsAllChannels = []
let usersChartInstance = null
let messagesChartInstance = null
let messagesDonutInstance = null
let voiceChartInstance = null
let voiceDonutInstance = null
let messagesTopUsersOffset = 0
let voiceTopUsersOffset = 0

document.addEventListener('DOMContentLoaded', async () => {
  await loadUserInfo()
  await ensureCsrfToken().catch(() => undefined)
  initSidebarNav()
  initHamburger()
  initLanguageSwitcher()
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
  await initSessionActivitySection()
  bindImagePreviewModalListeners()
  await loadG2Matches({ silent: true })
  switchSection(resolveFirstAllowedSection() ?? 'embed-creator')
})

// ─── Dostep do sekcji i jezyk dashboardu ──────────────────────────────────────

let allowedSections = null

/**
 * Pobiera role, allowliste sekcji i jezyk z serwera. Ukrywanie zakladek jest
 * tylko kosmetyka - realna autoryzacja siedzi w requireSectionAccess po stronie API.
 */
async function loadDashboardAccess() {
  try {
    const response = await fetch('/api/me/access')
    if (!response.ok) {
      if (response.status === 403) window.location.href = '/auth/login'
      return
    }

    const access = await response.json()
    allowedSections = Array.isArray(access.allowedSections) ? access.allowedSections : null
    currentDashboardRole = access.role ?? currentDashboardRole

    applyAllowedSectionsToNav()
    showOwnerOnlyNavItems()

    // Recznie zapisany wybor uzytkownika ma pierwszenstwo nad domyslnym dla roli.
    const stored = window.I18n.readStoredLanguage()
    window.I18n.setLanguage(stored ?? access.language, { persist: false })
    syncLanguageSwitcher()
  } catch (error) {
    console.error('Nie udalo sie pobrac uprawnien dashboardu:', error)
  }
}

/** Zakladki startujace jako ukryte, ktore serwer jawnie przyznal (np. panel uprawnien). */
function showOwnerOnlyNavItems() {
  if (!Array.isArray(allowedSections) || !allowedSections.includes('permissions')) return

  const item = document.getElementById('permissions-nav-item')
  if (item instanceof HTMLElement) item.style.display = ''
}

function isSectionAllowed(section) {
  return allowedSections === null || allowedSections.includes(section)
}

/** Pierwsza zakladka widoczna dla roli - punkt startowy i fallback. */
function resolveFirstAllowedSection() {
  const items = document.querySelectorAll('.sidebar-item[data-section]')
  for (const item of items) {
    if (isSectionAllowed(item.dataset.section)) return item.dataset.section
  }
  return null
}

function applyAllowedSectionsToNav() {
  if (allowedSections === null) return

  document.querySelectorAll('.sidebar-item[data-section]').forEach((item) => {
    if (!isSectionAllowed(item.dataset.section)) {
      item.style.display = 'none'
      item.dataset.sectionDenied = 'true'
    }
  })
}

function initLanguageSwitcher() {
  const switcher = document.getElementById('language-switcher')
  if (!switcher) return

  switcher.addEventListener('click', (event) => {
    const button = event.target.closest('.language-option')
    if (!button) return

    const language = button.dataset.language
    if (!window.I18n.isSupported(language) || language === window.I18n.getLanguage()) return

    window.I18n.setLanguage(language)
    syncLanguageSwitcher()
    void persistLanguagePreference(language)
  })

  // Kazda zmiana jezyka musi przerysowac aktywna sekcje - listy sa budowane w JS.
  window.I18n.onLanguageChange(() => {
    syncLanguageSwitcher()
    refreshActiveSectionAfterLanguageChange()
  })

  syncLanguageSwitcher()
}

function syncLanguageSwitcher() {
  const current = window.I18n.getLanguage()
  document.querySelectorAll('#language-switcher .language-option').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.language === current))
  })
}

async function persistLanguagePreference(language) {
  try {
    await fetchWithCsrf('/api/me/language', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language }),
    })
  } catch (error) {
    // Zmiana w UI juz nastapila - brak zapisu oznacza tylko brak trwalosci miedzy sesjami.
    console.warn('Nie udalo sie zapisac preferencji jezyka:', error)
  }
}

function refreshActiveSectionAfterLanguageChange() {
  if (currentSection) {
    switchSection(currentSection)
  }
}

async function loadUserInfo() {
  try {
    const resp = await fetch('/api/me')
    if (!resp.ok) {
      window.location.href = '/auth/login'
      return
    }

    const { user } = await resp.json()
    currentDashboardRole = user.dashboardRole ?? null

    await loadDashboardAccess()

    const settingsTabBtn = document.getElementById('stats-settings-tab-btn')
    if (settingsTabBtn && currentDashboardRole !== 'owner') {
      settingsTabBtn.style.display = 'none'
    }

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
        <button type="button" class="btn-logout" id="logout-btn">${escapeHtml(t('common.logout'))}</button>
      </div>`

    const logoutButton = document.getElementById('logout-btn')
    logoutButton?.addEventListener('click', async () => {
      await logoutDashboard()
    })
  } catch {
    window.location.href = '/auth/login'
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
      throw new Error(payload.error ?? t('app.nie_udao_sie_wylogowac'))
    }

    window.location.href = '/auth/login'
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nieznany_bad')
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
        window.location.href = '/auth/login'
        throw new Error(t('app.sesja_wygasa_zaloguj_sie_ponownie'))
      }

      const payload = await parseApiResponse(response)
      if (!response.ok || typeof payload.csrfToken !== 'string' || payload.csrfToken.length === 0) {
        throw new Error(payload.error ?? t('app.nie_udao_sie_pobrac_tokenu_bezpieczenstwa'))
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
    window.location.href = '/auth/login'
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

function closeMobileSidebar() {
  const sidebar = document.querySelector('.sidebar')
  const overlay = document.getElementById('sidebar-overlay')
  const hamburger = document.getElementById('hamburger-btn')
  sidebar?.classList.remove('open')
  overlay?.classList.remove('visible')
  hamburger?.classList.remove('open')
  hamburger?.setAttribute('aria-expanded', 'false')
}

function initHamburger() {
  const hamburger = document.getElementById('hamburger-btn')
  const sidebar = document.querySelector('.sidebar')
  const overlay = document.getElementById('sidebar-overlay')
  if (!hamburger || !sidebar || !overlay) return

  hamburger.addEventListener('click', () => {
    const isOpen = sidebar.classList.toggle('open')
    overlay.classList.toggle('visible', isOpen)
    hamburger.classList.toggle('open', isOpen)
    hamburger.setAttribute('aria-expanded', String(isOpen))
  })

  overlay.addEventListener('click', closeMobileSidebar)
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
      if (window.innerWidth <= 768) closeMobileSidebar()
    })
  })
}

function switchSection(section) {
  if (!isSectionAllowed(section)) {
    showToast(t('toast.section_denied'), 'error')
    const fallback = resolveFirstAllowedSection()
    if (!fallback || fallback === section) return
    section = fallback
  }

  if (section === 'economy-settings' && economyHasDevAccess !== true) {
    if (economyHasDevAccess === false) {
      showToast(t('app.i_ustawienia_ekonomii_sa_dostepne_tylko'), 'info')
    } else {
      showToast(t('app.i_trwa_weryfikacja_uprawnien_do_ustawien'), 'info')
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

  if (section === 'session-activity') {
    void loadSessionActivity({ silent: false })
  }

  if (section === 'permissions' && typeof window.loadPermissionsSection === 'function') {
    void window.loadPermissionsSection()
  }

  if (section === 'server-stats') {
    initStatsSectionIfNeeded()
    void loadActiveStatsTab()
  }

  if (section === 'shop') {
    void initShopSection()
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

  recentUnicodeEmojis = window.HusariaEmojiSearch?.loadRecent(window.localStorage) ?? []

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

  bindAnsiControls()
  bindPopoverCollapse()

  emojiPopover?.addEventListener('click', (event) => {
    event.stopPropagation()

    const tabButton = event.target.closest('[data-emoji-tab]')
    if (tabButton) {
      emojiTab = tabButton.dataset.emojiTab === 'unicode' ? 'unicode' : 'server'
      if (emojiSearchInput) emojiSearchInput.value = ''
      renderEmojiList('')
      return
    }

    const groupButton = event.target.closest('[data-emoji-group]')
    if (groupButton) {
      unicodeEmojiGroupKey = groupButton.dataset.emojiGroup ?? null
      renderEmojiList(emojiSearchInput?.value ?? '')
      return
    }

    const button = event.target.closest('[data-token]')
    const token = button?.dataset.token
    if (!token) return

    // Emotki unicode wstawiamy bez spacji i zostawiamy popover otwarty (często wstawia się kilka).
    if (button.dataset.raw === '1') {
      insertToken(token, { padded: false })
      rememberUnicodeEmoji(token)
      return
    }

    insertToken(token)
  })

  mentionPopover?.addEventListener('click', (event) => {
    event.stopPropagation()
    const button = event.target.closest('[data-token]')
    const token = button?.dataset.token
    if (!token) return

    insertToken(token)
  })

  emojiSearchInput?.addEventListener('input', () => {
    renderEmojiList(emojiSearchInput.value)
  })

  mentionChannelSearch?.addEventListener('input', () => {
    if (mentionChannelSearchDebounceId) {
      clearTimeout(mentionChannelSearchDebounceId)
    }

    mentionChannelSearchDebounceId = setTimeout(async () => {
      await searchMentionChannels(mentionChannelSearch.value)
    }, 220)
  })

  mentionRoleSearch?.addEventListener('input', () => {
    if (mentionRoleSearchDebounceId) {
      clearTimeout(mentionRoleSearchDebounceId)
    }

    mentionRoleSearchDebounceId = setTimeout(async () => {
      await searchMentionRoles(mentionRoleSearch.value)
    }, 220)
  })

  mentionUserSearch?.addEventListener('input', () => {
    if (mentionUserSearchDebounceId) {
      clearTimeout(mentionUserSearchDebounceId)
    }

    mentionUserSearchDebounceId = setTimeout(async () => {
      await searchMentionUsers(mentionUserSearch.value)
    }, 220)
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
      showToast(t('app.plik_jest_za_duzy_maksymalny_rozmiar'), 'error')
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
      : t('app.nie_wybrano_pliku')

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

  ;[
    eventTitleInput,
    eventDescriptionInput,
    eventLocationInput,
    eventStartAtInput,
    eventEndAtInput,
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
      showToast(t('app.ustaw_poprawna_date_timestampu'), 'error')
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
    const previewDiv = event.target.closest('.image-library-card-preview')
    if (previewDiv) {
      const img = previewDiv.querySelector('img')
      const nameEl = previewDiv.closest('.image-library-card')?.querySelector('.image-library-card-name')
      if (img) {
        openImagePreviewModal(img.src, nameEl ? nameEl.textContent : '')
      }
      return
    }

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

function openImagePreviewModal(src, name) {
  const modal = document.getElementById('image-preview-modal')
  const img = document.getElementById('image-preview-modal-img')
  const nameEl = document.getElementById('image-preview-modal-name')
  if (!modal || !img) {
    return
  }

  img.src = src
  img.alt = name || ''
  if (nameEl) {
    nameEl.textContent = name || ''
  }

  modal.classList.add('visible')
  document.body.style.overflow = 'hidden'
}

function closeImagePreviewModal() {
  const modal = document.getElementById('image-preview-modal')
  if (!modal) {
    return
  }

  modal.classList.remove('visible')
  document.body.style.overflow = ''

  const img = document.getElementById('image-preview-modal-img')
  if (img) {
    img.src = ''
  }
}

function bindImagePreviewModalListeners() {
  const modal = document.getElementById('image-preview-modal')
  const closeBtn = document.getElementById('image-preview-modal-close')
  const inner = document.getElementById('image-preview-modal-inner')

  closeBtn?.addEventListener('click', closeImagePreviewModal)

  modal?.addEventListener('click', (event) => {
    if (!inner?.contains(event.target) || event.target === modal) {
      closeImagePreviewModal()
    }
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeImagePreviewModal()
    }
  })
}

function bindTicketHistorySectionListeners() {
  const searchInput = document.getElementById('ticket-history-search')
  const refreshButton = document.getElementById('ticket-history-refresh-btn')
  const prevButton = document.getElementById('ticket-history-prev-btn')
  const nextButton = document.getElementById('ticket-history-next-btn')
  const clearButton = document.getElementById('ticket-history-clear-btn')
  const devToolbar = document.getElementById('ticket-history-dev-toolbar')

  if (devToolbar) {
    devToolbar.style.display = economyHasDevAccess === true ? '' : 'none'
  }

  clearButton?.addEventListener('click', async () => {
    if (!confirm(t('app.czy_na_pewno_chcesz_wyczyscic_cala'))) {
      return
    }

    try {
      const response = await fetchWithCsrf('/api/tickets/history', { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        showToast(data.error ?? t('app.nie_udalo_sie_wyczyscic_historii_ticketow'), 'error')
        return
      }

      showToast(t('app.historia_ticketow_zostala_wyczyszczona'), 'success')
      void loadTicketHistory({ page: 1, silent: true })
    } catch {
      showToast(t('app.blad_sieci_podczas_czyszczenia_historii_ticketow'), 'error')
    }
  })

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

  document.getElementById('system-logs-ranges')?.addEventListener('click', (event) => {
    const pill = event.target.closest?.('[data-range]')
    if (!pill) return
    dashboardLogsRange = pill.dataset.range
    dashboardLogsPage = 1
    document.querySelectorAll('#system-logs-ranges .log-pill').forEach((node) => {
      node.classList.toggle('active', node === pill)
    })
    void loadDashboardLogs({ page: 1, silent: true })
  })

  const filterClickTargets = ['system-logs-stats', 'system-logs-categories']
  filterClickTargets.forEach((id) => {
    document.getElementById(id)?.addEventListener('click', (event) => {
      const target = event.target.closest?.('[data-log-level],[data-log-category]')
      if (!target) return
      if (target.dataset.logLevel !== undefined) {
        dashboardLogsLevel = normalizeDashboardLogLevel(target.dataset.logLevel, true)
        const levelSelect = document.getElementById('system-logs-level')
        if (levelSelect) levelSelect.value = dashboardLogsLevel
      }
      if (target.dataset.logCategory !== undefined) {
        dashboardLogsCategory = target.dataset.logCategory
      }
      dashboardLogsPage = 1
      void loadDashboardLogs({ page: 1, silent: true })
    })
  })

  document.getElementById('system-logs-list')?.addEventListener('click', (event) => {
    const copyButton = event.target.closest?.('[data-log-copy]')
    if (!copyButton) return
    const pre = copyButton.closest('details')?.querySelector('pre')
    if (pre && navigator.clipboard) {
      navigator.clipboard.writeText(pre.textContent ?? '').then(
        () => showToast(t('systemLogs.skopiowano'), 'success'),
        () => showToast(t('systemLogs.kopiowanie_nieudane'), 'error'),
      )
    }
  })

  document.getElementById('system-logs-auto-refresh')?.addEventListener('change', (event) => {
    if (dashboardLogsAutoRefreshId) {
      clearInterval(dashboardLogsAutoRefreshId)
      dashboardLogsAutoRefreshId = null
    }
    if (event.target.checked) {
      dashboardLogsAutoRefreshId = setInterval(() => {
        if (currentSection === 'system-logs' && !document.hidden) {
          void loadDashboardLogs({ silent: true })
        }
      }, DASHBOARD_LOGS_AUTO_REFRESH_MS)
    }
  })

  document.getElementById('system-logs-scope')?.addEventListener('change', (event) => {
    clearDashboardLogsSearchDebounce()
    dashboardLogsScope = String(event.target.value ?? 'all')
    dashboardLogsPage = 1
    void loadDashboardLogs({ page: 1, silent: true })
  })

  document.getElementById('system-logs-hide-noise')?.addEventListener('change', (event) => {
    clearDashboardLogsSearchDebounce()
    dashboardLogsHideNoise = event.target.checked === true
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
    scope: dashboardLogsScope,
    hideNoise: dashboardLogsHideNoise ? '1' : '0',
    category: dashboardLogsCategory,
    range: dashboardLogsRange,
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
      throw new Error(payload.error ?? t('app.nie_udalo_sie_pobrac_logow_systemowych'))
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
    dashboardLogsHiddenNoiseCount = Number.isFinite(Number(payload.hiddenNoiseCount)) ? Number(payload.hiddenNoiseCount) : 0
    dashboardLogsScopes = Array.isArray(payload.scopes) ? payload.scopes.map(String) : []
    dashboardLogsSummary = payload.summary ?? null

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
      const message = error instanceof Error ? error.message : t('app.nie_udalo_sie_pobrac_logow_systemowych_2')
      showToast(`❌ ${message}`, 'error')
    }
  } finally {
    if (requestId === dashboardLogsLoadRequestId && dashboardLogsAbortController === abortController) {
      dashboardLogsAbortController = null
    }
  }
}

async function initSessionActivitySection() {
  renderSessionActivity()

  if (!sessionActivitySectionBound) {
    sessionActivitySectionBound = true
    bindSessionActivitySectionListeners()
  }
}

function bindSessionActivitySectionListeners() {
  const refreshButton = document.getElementById('session-activity-refresh-btn')
  const prevButton = document.getElementById('session-activity-prev-btn')
  const nextButton = document.getElementById('session-activity-next-btn')
  const killswitchButton = document.getElementById('session-killswitch-btn')

  refreshButton?.addEventListener('click', () => {
    void loadSessionActivity({ page: 1, silent: true })
  })

  prevButton?.addEventListener('click', () => {
    if (sessionActivityPage <= 1) return
    void loadSessionActivity({ page: sessionActivityPage - 1, silent: true })
  })

  nextButton?.addEventListener('click', () => {
    if (sessionActivityPage >= sessionActivityTotalPages) return
    void loadSessionActivity({ page: sessionActivityPage + 1, silent: true })
  })

  killswitchButton?.addEventListener('click', () => {
    if (!confirm(t('app.na_pewno_chcesz_wylogowac_wszystkich_uzytkownikow'))) return
    void triggerSessionKillswitch()
  })
}

async function triggerSessionKillswitch() {
  const killswitchButton = document.getElementById('session-killswitch-btn')
  if (killswitchButton) {
    killswitchButton.disabled = true
    killswitchButton.textContent = 'Wylogowywanie...'
  }

  try {
    const csrfToken = await ensureCsrfToken()
    const response = await fetch('/auth/killswitch', {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      alert(t('app.ui_blad_prefix') + ': ' + (payload.error ?? t('app.nie_udao_sie_wykonac_killswitch')))
      if (killswitchButton) {
        killswitchButton.disabled = false
        killswitchButton.textContent = t('app.killswitch_wyloguj_wszystkich')
      }
      return
    }

    window.location.href = '/auth/login'
  } catch {
    alert(t('app.bad_poaczenia_sprobuj_ponownie'))
    if (killswitchButton) {
      killswitchButton.disabled = false
      killswitchButton.textContent = t('app.killswitch_wyloguj_wszystkich_2')
    }
  }
}

async function loadSessionActivity(options = {}) {
  const requestId = ++sessionActivityLoadRequestId
  const nextPage = Number.isFinite(Number(options.page))
    ? Math.max(1, Number(options.page))
    : sessionActivityPage
  const silent = options.silent === true

  const params = new URLSearchParams({
    page: String(nextPage),
    pageSize: '50',
  })

  try {
    const response = await fetch(`/api/sessions/activity?${params.toString()}`)
    const payload = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(payload.error ?? t('app.nie_udalo_sie_pobrac_aktywnosci_sesji'))
    }

    if (requestId !== sessionActivityLoadRequestId) {
      return
    }

    sessionOnlineUsers = Array.isArray(payload.onlineUsers) ? payload.onlineUsers : []
    sessionRecentEvents = Array.isArray(payload.recentEvents) ? payload.recentEvents : []
    sessionActivityPage = Number.isFinite(Number(payload.page)) ? Math.max(1, Number(payload.page)) : 1
    sessionActivityTotalPages = Number.isFinite(Number(payload.totalPages)) ? Math.max(1, Number(payload.totalPages)) : 1
    sessionActivityTotalEvents = Number.isFinite(Number(payload.totalEvents)) ? Math.max(0, Number(payload.totalEvents)) : 0

    renderSessionActivity()
  } catch (error) {
    if (requestId !== sessionActivityLoadRequestId) return

    sessionOnlineUsers = []
    sessionRecentEvents = []
    sessionActivityPage = 1
    sessionActivityTotalPages = 1
    sessionActivityTotalEvents = 0
    renderSessionActivity()

    if (!silent) {
      const message = error instanceof Error ? error.message : t('app.nie_udalo_sie_pobrac_aktywnosci_sesji_2')
      showToast(`❌ ${message}`, 'error')
    }
  }
}

function renderSessionActivity() {
  const onlineList = document.getElementById('session-online-list')
  const eventsList = document.getElementById('session-events-list')
  const onlineCount = document.getElementById('session-activity-online-count')
  const countLabel = document.getElementById('session-activity-count-label')
  const pageLabel = document.getElementById('session-activity-page-label')
  const pagination = document.getElementById('session-activity-pagination')
  const prevButton = document.getElementById('session-activity-prev-btn')
  const nextButton = document.getElementById('session-activity-next-btn')

  if (!onlineList || !eventsList) return

  if (onlineCount) {
    onlineCount.textContent = `Zalogowani: ${sessionOnlineUsers.length}`
  }

  if (countLabel) {
    countLabel.textContent = `Zdarzenia: ${sessionActivityTotalEvents}`
  }

  if (pageLabel) {
    pageLabel.textContent = t('app.strona_p1_p2', { p1: sessionActivityPage, p2: sessionActivityTotalPages })
  }

  if (pagination) {
    pagination.hidden = sessionActivityTotalPages <= 1
  }

  if (prevButton instanceof HTMLButtonElement) {
    prevButton.disabled = sessionActivityPage <= 1
  }

  if (nextButton instanceof HTMLButtonElement) {
    nextButton.disabled = sessionActivityPage >= sessionActivityTotalPages
  }

  if (sessionOnlineUsers.length === 0) {
    onlineList.innerHTML = '<div class="scheduled-empty">Brak aktualnie zalogowanych uzytkownikow.</div>'
  } else {
    onlineList.innerHTML = sessionOnlineUsers.map((user) => buildSessionUserCardHtml(user, true)).join('')
  }

  if (sessionRecentEvents.length === 0) {
    eventsList.innerHTML = '<div class="scheduled-empty">Brak zdarzen sesji w ciagu ostatnich 30 dni.</div>'
  } else {
    eventsList.innerHTML = sessionRecentEvents.map((event) => buildSessionEventCardHtml(event)).join('')
  }
}

function buildDashboardRoleChipHtml(role) {
  if (!role) return ''
  const map = {
    owner:             { label: 'Owner',              color: '#5865f2' },
    staff:             { label: 'Staff',              color: '#f0a500' },
    dev:               { label: 'Dev',               color: '#5865f2' },
    admin:             { label: 'Admin',              color: '#dc143c' },
    moderator:         { label: 'Moderator',          color: '#f0a500' },
    community_manager: { label: 'Community Manager',  color: '#9b59b6' },
    g2staff:           { label: 'G2 Staff',            color: '#1abc9c' },
  }
  const entry = map[role]
  if (!entry) return ''
  return `<span class="scheduled-chip" style="font-size:11px;background:${entry.color}20;color:${entry.color};border:1px solid ${entry.color}40;">${entry.label}</span>`
}

function buildSessionUserCardHtml(user, isOnline) {
  const avatarUrl = user.avatarHash
    ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.userId)}/${encodeURIComponent(user.avatarHash)}.png?size=32`
    : `https://cdn.discordapp.com/embed/avatars/0.png`
  const displayName = escapeHtml(user.globalName || user.username || user.userId)
  const loginTime = formatTimestampInWarsaw(Number(user.createdAt ?? Date.now()))
  const statusDot = isOnline
    ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#57f287;margin-right:6px;vertical-align:middle;"></span>'
    : ''
  const roleChip = buildDashboardRoleChipHtml(user.dashboardRole)

  return `
    <article class="scheduled-card" style="padding:10px 14px;">
      <div class="scheduled-card-header" style="gap:10px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <img src="${avatarUrl}" alt="" width="28" height="28" style="border-radius:50%;">
          <span>${statusDot}<strong>${displayName}</strong></span>
          <span class="scheduled-chip" style="font-size:11px;">${escapeHtml(user.userId)}</span>
          ${roleChip}
        </div>
        <span class="preview-note" style="font-size:11px;">Zalogowano: ${loginTime}</span>
      </div>
      <div class="scheduled-card-meta" style="font-size:11px;margin-top:4px;">
        <span class="scheduled-chip">IP: ${escapeHtml(user.ip)}</span>
        <span class="scheduled-chip" title="${escapeHtml(user.userAgent)}" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(truncate(user.userAgent, 60))}</span>
      </div>
    </article>`
}

function buildSessionEventCardHtml(event) {
  const isLogin = event.eventType === 'login'
  const avatarUrl = event.avatarHash
    ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(event.userId)}/${encodeURIComponent(event.avatarHash)}.png?size=32`
    : `https://cdn.discordapp.com/embed/avatars/0.png`
  const displayName = escapeHtml(event.globalName || event.username || event.userId)
  const timestamp = formatTimestampInWarsaw(Number(event.createdAt ?? Date.now()))
  const typeLabel = isLogin ? 'Logowanie' : 'Wylogowanie'
  const typeStyle = isLogin
    ? 'background:rgba(87,242,135,.18);color:#57f287;border-color:rgba(87,242,135,.35);'
    : 'background:rgba(114,118,125,.18);color:#99aab5;border-color:rgba(114,118,125,.3);'
  const roleChip = buildDashboardRoleChipHtml(event.dashboardRole)

  return `
    <article class="scheduled-card log-card" style="padding:10px 14px;">
      <div class="scheduled-card-header" style="gap:10px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <img src="${avatarUrl}" alt="" width="24" height="24" style="border-radius:50%;">
          <strong>${displayName}</strong>
          <span class="scheduled-chip" style="font-size:11px;">${escapeHtml(event.userId)}</span>
          ${roleChip}
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="scheduled-chip" style="${typeStyle}">${typeLabel}</span>
          <span class="preview-note" style="font-size:11px;">${timestamp}</span>
        </div>
      </div>
      <div class="scheduled-card-meta" style="font-size:11px;margin-top:4px;">
        <span class="scheduled-chip">IP: ${escapeHtml(event.ip)}</span>
        <span class="scheduled-chip" title="${escapeHtml(event.userAgent)}" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(truncate(event.userAgent, 60))}</span>
      </div>
    </article>`
}

function truncate(str, maxLen) {
  if (typeof str !== 'string') return ''
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str
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
      throw new Error(payload.error ?? t('app.nie_udalo_sie_pobrac_historii_ticketow'))
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
      const message = error instanceof Error ? error.message : t('app.nie_udalo_sie_pobrac_historii_ticketow_2')
      showToast(`❌ ${message}`, 'error')
    }
  }
}

async function loadScheduledPosts() {
  try {
    const response = await fetch('/api/scheduled')
    const json = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(json.error ?? t('app.nie_udao_sie_pobrac_listy_zaplanowanych'))
    }

    scheduledPosts = Array.isArray(json.posts) ? json.posts : []
    renderScheduledPosts()
  } catch (error) {
    scheduledPosts = []
    renderScheduledPosts()
    const message = error instanceof Error ? error.message : t('app.nieznany_bad_2')
    showToast(`❌ ${message}`, 'error')
  }
}

async function loadSentPosts() {
  try {
    const response = await fetch('/api/scheduled/sent')
    const json = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(json.error ?? t('app.nie_udao_sie_pobrac_listy_wysanych'))
    }

    sentPosts = Array.isArray(json.posts) ? json.posts : []

    const allMentionIds = sentPosts.flatMap((post) => {
      const text = (post?.payload?.content ?? '') + ' ' + (post?.payload?.title ?? '')
      return extractUserMentionIds(text)
    })
    await prefetchUserMentions(allMentionIds)

    renderSentPosts()
  } catch (error) {
    sentPosts = []
    renderSentPosts()
    const message = error instanceof Error ? error.message : t('app.nieznany_bad_3')
    showToast(`❌ ${message}`, 'error')
  }
}

async function loadDashboardEvents() {
  try {
    const response = await fetch('/api/events')
    const json = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(json.error ?? t('app.nie_udao_sie_pobrac_listy_wydarzen'))
    }

    dashboardEvents = Array.isArray(json.events) ? json.events : []
    renderDashboardEvents()
  } catch (error) {
    dashboardEvents = []
    renderDashboardEvents()
    const message = error instanceof Error ? error.message : t('app.nieznany_bad_4')
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
    pageLabel.textContent = t('app.strona_p1_p2_2', { p1: ticketHistoryPage, p2: ticketHistoryTotalPages })
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
      ? t('app.brak_historii_pasujacej_do_zapytania_p1', { p1: escapeHtml(ticketHistorySearch) })
      : t('app.brak_zamknietych_ticketow_zapisanych_po_wdrozeniu')
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
        <div class="scheduled-preview">${renderMarkdown(String(entry.closeReason ?? t('app.brak_powodu'))) || '<span style="opacity:.45">Brak powodu.</span>'}</div>
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

  renderDashboardLogFilters()

  if (countLabel) {
    countLabel.textContent = `Wpisy: ${dashboardLogsTotalRows}`
  }

  if (pageLabel) {
    pageLabel.textContent = t('app.strona_p1_p2_3', { p1: dashboardLogsPage, p2: dashboardLogsTotalPages })
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
      ? t('app.brak_logow_pasujacych_do_zapytania_p1', { p1: escapeHtml(dashboardLogsSearch) })
      : t('app.brak_logow_systemowych_dla_wybranych_filtrow')
    list.innerHTML = `<div class="scheduled-empty">${emptyMessage}</div>`
    return
  }

  list.innerHTML = buildDashboardLogsHtml(dashboardLogEntries)
}

function humanizeLogAction(action) {
  const words = String(action ?? 'UNKNOWN').toLowerCase().replace(/[._]/g, ' ').split(' ').filter(Boolean)
  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function formatRelativeLogTime(timestampMs) {
  const diffSeconds = Math.max(0, Math.round((Date.now() - timestampMs) / 1000))
  if (diffSeconds < 60) return t('systemLogs.czas_przed_chwila')
  if (diffSeconds < 3600) return t('systemLogs.czas_min', { p1: Math.floor(diffSeconds / 60) })
  if (diffSeconds < 86400) return t('systemLogs.czas_godz', { p1: Math.floor(diffSeconds / 3600) })
  return t('systemLogs.czas_dni', { p1: Math.floor(diffSeconds / 86400) })
}

/** Zdanie opisujace zdarzenie; gdy brak szablonu dla akcji - zwykla tresc wpisu. */
function buildLogSummaryText(entry) {
  const key = `logs.sum.${entry.action}`
  const catalog = window.DASHBOARD_I18N?.pl ?? {}
  if (!(key in catalog)) {
    return String(entry.message ?? t('app.brak_tresci'))
  }

  const context = entry.context ?? {}
  const shortId = (value) => (value ? String(value) : '?')
  return t(key, {
    actor: entry.actorUser?.displayName ?? context.actorUserName ?? context.username ?? shortId(context.actorUserId),
    target: entry.targetUser?.displayName ?? shortId(context.targetUserId ?? context.userId),
    level: context.level ?? '?',
    ip: context.ip ?? '?',
    method: context.method ?? '',
    path: context.path ?? '',
    role: context.actorUserRole ?? '?',
    section: context.section ?? '?',
    itemName: context.itemName ?? context.itemId ?? '?',
    botTag: context.botTag ?? '?',
    port: context.port ?? '?',
    count: context.count ?? context.deletedCount ?? '?',
    removed: Array.isArray(context.removedRoleIds) ? context.removedRoleIds.length : 0,
  })
}

function renderDashboardLogFilters() {
  const scopeSelect = document.getElementById('system-logs-scope')
  const noiseNote = document.getElementById('system-logs-noise-note')
  const statsBox = document.getElementById('system-logs-stats')
  const categoriesBox = document.getElementById('system-logs-categories')
  const summary = dashboardLogsSummary

  if (scopeSelect instanceof HTMLSelectElement) {
    const scopes = [...new Set([...dashboardLogsScopes, dashboardLogsScope].filter((scope) => scope && scope !== 'all'))]
    scopeSelect.innerHTML = [`<option value="all">${escapeHtml(t('systemLogs.zakres_wszystkie'))}</option>`]
      .concat(scopes.map((scope) => `<option value="${escapeHtml(scope)}">${escapeHtml(scope)}</option>`))
      .join('')
    scopeSelect.value = dashboardLogsScope
  }

  if (noiseNote instanceof HTMLElement) {
    noiseNote.hidden = !(dashboardLogsHideNoise && dashboardLogsHiddenNoiseCount > 0)
    noiseNote.textContent = t('systemLogs.ukryto_szum', { p1: dashboardLogsHiddenNoiseCount })
  }

  if (statsBox && summary) {
    const cards = [
      { level: 'error', label: t('systemLogs.stat_bledy'), count: summary.levelCounts.error, tone: 'error' },
      { level: 'warn', label: t('systemLogs.stat_ostrzezenia'), count: summary.levelCounts.warn, tone: 'warn' },
      { level: 'info', label: t('systemLogs.stat_info'), count: summary.levelCounts.info, tone: 'info' },
      { level: 'all', label: t('systemLogs.stat_wszystkie'), count: summary.total, tone: 'all' },
    ]
    statsBox.innerHTML = cards.map((card) => `
      <button type="button" class="log-stat log-stat-${card.tone}${dashboardLogsLevel === card.level ? ' active' : ''}" data-log-level="${card.level}">
        <span class="log-stat-count">${Number(card.count)}</span>
        <span class="log-stat-label">${escapeHtml(card.label)}</span>
      </button>`).join('')
  }

  if (categoriesBox && summary) {
    const total = LOG_CATEGORY_ORDER.reduce((sum, category) => sum + Number(summary.categoryCounts[category] ?? 0), 0)
    const pills = [`<button type="button" class="log-pill${dashboardLogsCategory === 'all' ? ' active' : ''}" data-log-category="all">${escapeHtml(t('systemLogs.kat_wszystkie'))} <b>${total}</b></button>`]
    LOG_CATEGORY_ORDER.forEach((category) => {
      const count = Number(summary.categoryCounts[category] ?? 0)
      if (count === 0 && dashboardLogsCategory !== category) return
      pills.push(`<button type="button" class="log-pill${dashboardLogsCategory === category ? ' active' : ''}" data-log-category="${category}">${LOG_CATEGORY_ICONS[category]} ${escapeHtml(t(`systemLogs.kat_${category}`))} <b>${count}</b></button>`)
    })
    categoriesBox.innerHTML = pills.join('')
  }
}

function buildLogContextChipsHtml(entry) {
  const context = entry.context ?? {}
  const chips = []
  const addChip = (label, value) => {
    if (value === undefined || value === null || value === '') return
    chips.push(`<span class="log-chip">${label ? `<b>${escapeHtml(label)}</b> ` : ''}${escapeHtml(String(value))}</span>`)
  }

  addChip('', context.method && context.path ? `${context.method} ${context.path}` : context.path)
  addChip('IP', context.ip)
  addChip('user', context.targetUserId ?? context.userId)
  addChip('channel', context.channelId)
  addChip('post', context.postId ? String(context.postId).slice(0, 8) : '')

  const people = [
    entry.actorUser?.displayName ? buildAuthorHtml(entry.actorUser.displayName, null, null, t('app.log_aktor'), entry.actorUser.avatarUrl, entry.actorUser.role ?? null) : '',
    entry.targetUser?.displayName ? buildAuthorHtml(entry.targetUser.displayName, null, null, t('app.log_cel'), entry.targetUser.avatarUrl, entry.targetUser.role ?? null) : '',
  ].join('')

  return chips.length > 0 || people ? `<div class="log-chips">${people}${chips.join('')}</div>` : ''
}

function buildDashboardLogRowHtml(entry, repeatCount) {
  const level = normalizeDashboardLogLevel(entry.level)
  const category = LOG_CATEGORY_ICONS[entry.category] ? entry.category : 'system'
  const timestampMs = Number(entry.timestampMs ?? Date.now())
  const absoluteTime = formatTimestampInWarsaw(timestampMs)
  const hasContext = entry.context && Object.keys(entry.context).length > 0
  const summaryText = buildLogSummaryText(entry)
  const errorHtml = entry.error?.message
    ? `<div class="log-error">${escapeHtml(String(entry.error.message))}</div>`
    : ''
  const detailsHtml = hasContext || entry.error
    ? `<details class="log-context-details"><summary>${escapeHtml(t('systemLogs.szczegoly'))} <button type="button" class="log-copy-btn" data-log-copy>${escapeHtml(t('systemLogs.kopiuj'))}</button></summary><pre class="log-context-pre">${escapeHtml(JSON.stringify({ action: entry.action, scope: entry.scope, message: entry.message, context: entry.context ?? {}, error: entry.error ?? null }, null, 2))}</pre></details>`
    : ''
  const repeatBadge = repeatCount > 1 ? `<span class="log-repeat">×${repeatCount}</span>` : ''

  return `
    <article class="log-row log-row-${level}">
      <div class="log-icon log-icon-${category}" title="${escapeHtml(t(`systemLogs.kat_${category}`))}">${LOG_CATEGORY_ICONS[category]}</div>
      <div class="log-body">
        <div class="log-row-top">
          <span class="log-title">${escapeHtml(summaryText)}</span>
          ${repeatBadge}
          <span class="scheduled-chip log-level-${level}">${escapeHtml(level.toUpperCase())}</span>
        </div>
        <div class="log-meta">
          <span title="${escapeHtml(absoluteTime)}">${escapeHtml(formatRelativeLogTime(timestampMs))} · ${escapeHtml(absoluteTime)}</span>
          <span class="log-scope">${escapeHtml(humanizeLogAction(entry.action))} · ${escapeHtml(String(entry.scope ?? 'system'))}</span>
        </div>
        ${errorHtml}
        ${buildLogContextChipsHtml(entry)}
        ${detailsHtml}
      </div>
    </article>`
}

/** Zwija sasiadujace identyczne wpisy (ta sama akcja, tresc i poziom) w jeden z licznikiem. */
function groupRepeatedLogEntries(entries) {
  const grouped = []
  entries.forEach((entry) => {
    const previous = grouped[grouped.length - 1]
    const sameAsPrevious = previous
      && previous.entry.action === entry.action
      && previous.entry.level === entry.level
      && previous.entry.message === entry.message
      && JSON.stringify(previous.entry.context?.targetUserId ?? previous.entry.context?.userId) === JSON.stringify(entry.context?.targetUserId ?? entry.context?.userId)
    if (sameAsPrevious) {
      previous.count += 1
      return
    }
    grouped.push({ entry, count: 1 })
  })
  return grouped
}

function buildDashboardLogsHtml(entries) {
  let currentDay = ''
  return groupRepeatedLogEntries(entries).map(({ entry, count }) => {
    const day = new Intl.DateTimeFormat('pl-PL', {
      timeZone: 'Europe/Warsaw',
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(Number(entry.timestampMs ?? Date.now())))
    const header = day !== currentDay ? `<div class="log-day-header">${escapeHtml(day)}</div>` : ''
    currentDay = day
    return header + buildDashboardLogRowHtml(entry, count)
  }).join('')
}

function renderScheduledPosts() {
  const list = document.getElementById('scheduled-list')
  const counter = document.getElementById('scheduled-count-label')
  if (!list || !counter) {
    return
  }

  counter.textContent = t('app.ui_oczekujace', { p1: scheduledPosts.length })

  if (scheduledPosts.length === 0) {
    list.innerHTML = `<div class="scheduled-empty">${t('app.ui_brak_zaplanowanych')}</div>`
    return
  }

  list.innerHTML = scheduledPosts.map((post) => {
    const modeLabel = post?.payload?.mode === 'message' ? t('app.ui_tryb_wiadomosc') : 'Embedded'
    const channelName = channels.find((channel) => channel.id === post?.payload?.channelId)?.name ?? t('app.ui_nieznany_kanal')
    const pingLabel = post?.payload?.mentionRoleEnabled
      ? resolvePingTargetLabel(post?.payload?.mentionRoleId)
      : t('app.brak_pingu')
    const previewHtml = buildDiscordMockupHtml(post)
    const authorHtml = buildAuthorHtml(post.publisherName, post.publisherUserId, post.publisherAvatar)

    return `
      <article class="scheduled-card">
        <div class="scheduled-card-header">
          <span class="scheduled-card-title">Publikacja ${escapeHtml(post.id.slice(0, 8))}</span>
          <span class="scheduled-chip">${escapeHtml(modeLabel)}</span>
        </div>
        <div class="scheduled-card-meta">
          <span class="scheduled-chip">${t('app.ui_kanal_prefix')}: #${escapeHtml(channelName)}</span>
          <span class="scheduled-chip">Ping: ${escapeHtml(pingLabel)}</span>
          <span class="scheduled-chip">Czas: ${escapeHtml(formatTimestampInWarsaw(post.scheduledFor))}</span>
          ${authorHtml}
        </div>
        <div class="scheduled-preview">${previewHtml}</div>
        <div class="scheduled-actions">
          <button type="button" class="btn-secondary" data-action="edit" data-post-id="${escapeHtml(post.id)}">${t('app.ui_edytuj')}</button>
          <button type="button" class="btn-secondary" data-action="delete" data-post-id="${escapeHtml(post.id)}">${t('app.ui_usun')}</button>
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

  counter.textContent = t('app.ui_wyslane_licznik', { p1: sentPosts.length })

  if (sentPosts.length === 0) {
    list.innerHTML = `<div class="scheduled-empty">${t('app.ui_brak_wyslanych')}</div>`
    return
  }

  list.innerHTML = sentPosts.map((post) => {
    const modeLabel = post?.payload?.mode === 'message' ? t('app.ui_tryb_wiadomosc') : 'Embedded'
    const channelName = channels.find((channel) => channel.id === post?.payload?.channelId)?.name ?? t('app.ui_nieznany_kanal')
    const sentAtLabel = post.sentAt ? formatTimestampInWarsaw(post.sentAt) : formatTimestampInWarsaw(post.updatedAt)
    const eventStatus = post.eventStatus ?? 'not_requested'
    const eventLabelMap = {
      not_requested: t('app.event_brak'),
      pending: 'Event: oczekuje',
      created: 'Event: utworzono',
      failed: t('app.event_bad'),
    }

    const previewHtml = buildDiscordMockupHtml(post)
    const authorHtml = buildAuthorHtml(post.publisherName, post.publisherUserId, post.publisherAvatar)
    const editorHtml = post.editedBy
      ? buildAuthorHtml(post.editedBy, post.editedByUserId, null, t('app.ui_edytowal'))
      : ''

    return `
      <article class="scheduled-card">
        <div class="scheduled-card-header">
          <span class="scheduled-card-title">Post ${escapeHtml(post.id.slice(0, 8))}</span>
          <span class="scheduled-chip">${escapeHtml(modeLabel)}</span>
        </div>
        <div class="scheduled-card-meta">
          <span class="scheduled-chip">${t('app.ui_kanal_prefix')}: #${escapeHtml(channelName)}</span>
          <span class="scheduled-chip">${t('app.ui_wyslano')}: ${escapeHtml(sentAtLabel)}</span>
          <span class="scheduled-chip">${escapeHtml(eventLabelMap[eventStatus] ?? t('app.event_brak_2'))}</span>
          ${authorHtml}
          ${editorHtml}
        </div>
        <div class="scheduled-preview">${previewHtml}</div>
        <div class="scheduled-actions">
          <button type="button" class="btn-secondary" data-action="edit" data-post-id="${escapeHtml(post.id)}">${t('app.ui_edytuj')}</button>
          ${eventStatus === 'failed'
            ? `<button type="button" class="btn-secondary" data-action="retry-event" data-post-id="${escapeHtml(post.id)}">${t('app.ui_ponow_event')}</button>`
            : ''}
          <button type="button" class="btn-secondary" data-action="delete" data-post-id="${escapeHtml(post.id)}">${t('app.ui_usun')}</button>
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
    list.innerHTML = `<div class="scheduled-empty">${t('app.ui_brak_wydarzen')}</div>`
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
      : t('app.nie_ustawiono')
    const endLabel = Number.isFinite(Date.parse(endIso))
      ? formatTimestampInWarsaw(Date.parse(endIso))
      : t('app.nie_ustawiono_2')

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
          <button type="button" class="btn-secondary" data-action="edit" data-event-id="${escapeHtml(eventId)}">${t('app.ui_edytuj')}</button>
          <button type="button" class="btn-secondary" data-action="delete" data-event-id="${escapeHtml(eventId)}">${t('app.ui_usun')}</button>
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
  if (saveButton) saveButton.textContent = t('app.utworz_wydarzenie')
  if (cancelButton) cancelButton.style.display = 'none'
}

function openDashboardEventForEdit(eventId) {
  const selectedEvent = dashboardEvents.find((event) => String(event.id) === String(eventId))
  if (!selectedEvent) {
    showToast(t('app.nie_znaleziono_wydarzenia_do_edycji'), 'error')
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
      throw new Error(json.error ?? t('app.nie_udao_sie_zapisac_wydarzenia_discord'))
    }

    await loadDashboardEvents()
    resetDashboardEventForm()
    showToast(isEditing
      ? t('app.wydarzenie_discord_zostao_zaktualizowane')
      : t('app.wydarzenie_discord_zostao_utworzone'), 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nieznany_bad_5')
    showToast(`❌ ${message}`, 'error')
  }
}

async function deleteDashboardEvent(eventId) {
  const shouldDelete = window.confirm(t('app.czy_na_pewno_chcesz_usunac_to'))
  if (!shouldDelete) {
    return
  }

  try {
    const response = await fetchWithCsrf(`/api/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
    })
    const json = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(json.error ?? t('app.nie_udao_sie_usunac_wydarzenia_discord'))
    }

    if (editingEventId === eventId) {
      resetDashboardEventForm()
    }

    await loadDashboardEvents()
    showToast(t('app.wydarzenie_discord_zostao_usuniete'), 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nieznany_bad_6')
    showToast(`❌ ${message}`, 'error')
  }
}

async function openScheduledPostForEdit(postId) {
  try {
    const response = await fetch(`/api/scheduled/${encodeURIComponent(postId)}`)
    const json = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(json.error ?? t('app.nie_udao_sie_pobrac_zaplanowanego_posta'))
    }

    const post = json.post
    if (!post || !post.payload) {
      throw new Error(t('app.nieprawidowe_dane_zaplanowanego_posta'))
    }

    const mentionText = (post.payload.content ?? '') + ' ' + (post.payload.title ?? '')
    await prefetchUserMentions(extractUserMentionIds(mentionText))

    applyScheduledPostToCreator(post)
    switchSection('embed-creator')
    showToast(t('app.zaadowano_post_do_edycji_w_kreatorze'), 'info')
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nieznany_bad_7')
    showToast(`❌ ${message}`, 'error')
  }
}

async function openSentPostForEdit(postId) {
  try {
    const response = await fetch(`/api/scheduled/sent/${encodeURIComponent(postId)}`)
    const json = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(json.error ?? t('app.nie_udao_sie_pobrac_wysanego_posta'))
    }

    const post = json.post
    if (!post || !post.payload) {
      throw new Error(t('app.nieprawidowe_dane_wysanego_posta'))
    }

    const mentionText = (post.payload.content ?? '') + ' ' + (post.payload.title ?? '')
    await prefetchUserMentions(extractUserMentionIds(mentionText))

    applySentPostToCreator(post)
    switchSection('embed-creator')
    showToast(t('app.zaadowano_wysany_post_do_edycji'), 'info')
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nieznany_bad_8')
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
      fileNameElement.textContent = t('app.nie_wybrano_pliku_2')
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

  updateModeUI()
  updateImagePanels()
  renderImageLibrary()

  document.querySelectorAll('.color-swatch').forEach((swatch) => {
    swatch.classList.toggle('active', swatch.dataset.color === selectedColor)
  })

}

async function deleteScheduledPost(postId) {
  const shouldDelete = window.confirm(t('app.czy_na_pewno_chcesz_usunac_zaplanowany'))
  if (!shouldDelete) {
    return
  }

  try {
    const response = await fetchWithCsrf(`/api/scheduled/${encodeURIComponent(postId)}`, {
      method: 'DELETE',
    })
    const json = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(json.error ?? t('app.nie_udao_sie_usunac_zaplanowanego_posta'))
    }

    if (editingScheduledPostId === postId) {
      editingScheduledPostId = null
    }

    await loadScheduledPosts()
    showToast(t('app.zaplanowany_post_zosta_usuniety'), 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nieznany_bad_9')
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
      throw new Error(json.error ?? t('app.nie_udao_sie_ponowic_tworzenia_wydarzenia'))
    }

    await loadSentPosts()
    showToast(t('app.wydarzenie_discord_zostao_utworzone_2'), 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nieznany_bad_10')
    showToast(`❌ ${message}`, 'error')
  }
}

async function deleteSentPost(postId) {
  const shouldDelete = window.confirm(t('app.czy_na_pewno_chcesz_usunac_wysany'))
  if (!shouldDelete) {
    return
  }

  try {
    const response = await fetchWithCsrf(`/api/scheduled/sent/${encodeURIComponent(postId)}`, {
      method: 'DELETE',
    })

    const json = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(json.error ?? t('app.nie_udao_sie_usunac_wysanego_posta'))
    }

    if (editingSentPostId === postId) {
      editingSentPostId = null
    }

    await loadSentPosts()

    if (Array.isArray(json.warnings) && json.warnings.length > 0) {
      showToast(t('app.post_usuniety_z_historii_ale_nie'), 'warn')
    } else {
      showToast(t('app.post_i_powiazane_wiadomosci_discord_zostay'), 'success')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nieznany_bad_11')
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
  const denominateButton = document.getElementById('economy-settings-denominate-btn')
  const addCoinsButton = document.getElementById('economy-mutation-add-coins-btn')
  const addXpButton = document.getElementById('economy-mutation-add-xp-btn')
  const addLevelsButton = document.getElementById('economy-mutation-add-levels-btn')
  const importCsvButton = document.getElementById('economy-csv-import-btn')
  const exportCsvButton = document.getElementById('economy-csv-export-btn')
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

  denominateButton?.addEventListener('click', async () => {
    await denominateAllEconomyCoins()
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

  exportCsvButton?.addEventListener('click', async () => {
    await exportEconomyCsvSnapshot()
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

  const auditToolbar = document.getElementById('economy-role-audit-toolbar')
  if (auditToolbar) {
    auditToolbar.hidden = currentDashboardRole !== 'owner'
  }
  document.getElementById('economy-role-audit-btn')?.addEventListener('click', runEconomyRoleAudit)

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

const ECONOMY_ROLE_AUDIT_STATUS_KEYS = {
  missing: 'economyLeaderboard.audyt_brak_rangi',
  wrong: 'economyLeaderboard.audyt_zla_ranga',
  unexpected: 'economyLeaderboard.audyt_ranga_za_wysoka',
}

let economyRoleAuditRoles = {}

function buildEconomyRoleChipHtml(roleId, extraClass = '') {
  const role = economyRoleAuditRoles[roleId]
  const color = role?.color ? `#${Number(role.color).toString(16).padStart(6, '0')}` : 'var(--text-secondary)'
  const name = role?.name ?? roleId
  return `<span class="role-audit-chip ${extraClass}" style="--role-color:${escapeHtml(color)}">${escapeHtml(name)}</span>`
}

function buildEconomyRoleChipsHtml(roleIds, extraClass = '') {
  return roleIds.length > 0
    ? roleIds.map((roleId) => buildEconomyRoleChipHtml(roleId, extraClass)).join('')
    : '<span class="role-audit-none">—</span>'
}

function buildEconomyRoleAuditCardHtml(issue) {
  const toRemove = issue.currentMappedRoleIds.filter((roleId) => roleId !== issue.expectedRoleId)
  const toAdd = issue.expectedRoleId && !issue.currentMappedRoleIds.includes(issue.expectedRoleId)
    ? [issue.expectedRoleId]
    : []
  const statusKey = ECONOMY_ROLE_AUDIT_STATUS_KEYS[issue.status] ?? 'economyLeaderboard.audyt_zla_ranga'

  return `
    <div class="role-audit-card" data-user-id="${escapeHtml(issue.userId)}">
      <div class="role-audit-head">
        <div>
          <div class="role-audit-name">${escapeHtml(issue.username || issue.userId)}</div>
          <div class="role-audit-sub">${escapeHtml(issue.userId)} • ${escapeHtml(t('economyLeaderboard.audyt_level'))} ${Number(issue.level)}</div>
        </div>
        <span class="role-audit-status role-audit-status-${escapeHtml(issue.status)}">${escapeHtml(t(statusKey))}</span>
      </div>
      <div class="role-audit-rows">
        <div><span class="role-audit-label">${escapeHtml(t('economyLeaderboard.audyt_powinna'))}</span>${buildEconomyRoleChipsHtml(issue.expectedRoleId ? [issue.expectedRoleId] : [])}</div>
        <div><span class="role-audit-label">${escapeHtml(t('economyLeaderboard.audyt_ma'))}</span>${buildEconomyRoleChipsHtml(issue.currentMappedRoleIds)}</div>
        <div><span class="role-audit-label">${escapeHtml(t('economyLeaderboard.audyt_nadaj'))}</span>${buildEconomyRoleChipsHtml(toAdd, 'role-audit-chip-add')}</div>
        <div><span class="role-audit-label">${escapeHtml(t('economyLeaderboard.audyt_zdejmij'))}</span>${buildEconomyRoleChipsHtml(toRemove, 'role-audit-chip-remove')}</div>
      </div>
      <button type="button" class="btn-secondary role-audit-fix-btn" data-user-id="${escapeHtml(issue.userId)}">${escapeHtml(t('economyLeaderboard.napraw'))}</button>
    </div>`
}

function bindEconomyRoleAuditFixButtons(container) {
  container.querySelectorAll('.role-audit-fix-btn').forEach((button) => {
    button.addEventListener('click', () => void runEconomyRoleFixUser(button))
  })
}

async function runEconomyRoleFixUser(button) {
  const userId = button.dataset.userId
  const card = button.closest('.role-audit-card')
  button.disabled = true
  button.textContent = t('economyLeaderboard.naprawianie')

  try {
    const response = await fetchWithCsrf('/api/economy/level-roles/fix-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId: userId }),
    })
    const payload = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(payload.error ?? t('economyLeaderboard.naprawianie_nieudane'))
    }

    showToast(`✅ ${t('economyLeaderboard.naprawiono')}`, 'success')
    card?.remove()
  } catch (error) {
    button.disabled = false
    button.textContent = t('economyLeaderboard.napraw')
    showToast(`❌ ${error instanceof Error ? error.message : t('economyLeaderboard.naprawianie_nieudane')}`, 'error')
  }
}

async function runEconomyRoleAudit() {
  const button = document.getElementById('economy-role-audit-btn')
  const status = document.getElementById('economy-role-audit-status')
  const result = document.getElementById('economy-role-audit-result')
  if (!button || !status || !result) return

  button.disabled = true
  status.textContent = t('economyLeaderboard.sprawdzanie')
  result.innerHTML = ''

  try {
    const response = await fetchWithCsrf('/api/economy/level-roles/audit', { method: 'POST' })
    const payload = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(payload.error ?? t('economyLeaderboard.sprawdzanie_nieudane'))
    }

    const { report, mappingCount } = payload
    status.textContent = `${t('economyLeaderboard.audyt_sprawdzono')} ${report.checkedUsers}/${report.totalUsers} • OK: ${report.okUsers} • ${t('economyLeaderboard.audyt_do_poprawy')}: ${report.issues.length} • ${t('economyLeaderboard.audyt_poza_serwerem')}: ${report.notOnServerUsers}`

    if (mappingCount === 0) {
      result.innerHTML = `<p class="preview-note">${escapeHtml(t('economyLeaderboard.brak_mapowan'))}</p>`
      return
    }

    economyRoleAuditRoles = payload.roles ?? {}
    result.innerHTML = report.issues.map(buildEconomyRoleAuditCardHtml).join('')
    bindEconomyRoleAuditFixButtons(result)
  } catch (error) {
    status.textContent = ''
    showToast(`❌ ${error instanceof Error ? error.message : t('economyLeaderboard.sprawdzanie_nieudane')}`, 'error')
  } finally {
    button.disabled = false
  }
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

    showToast(t('app.nie_udalo_sie_wyszukac_uzytkownikow'), 'error')
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
    const reason = String(timeoutEntry.reason ?? t('app.brak_powodu_2'))
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
      throw new Error(payload.error ?? t('app.nie_udalo_sie_pobrac_timeoutow'))
    }

    timeoutEntries = Array.isArray(payload.timeouts) ? payload.timeouts : []
    timeoutLoadError = null
    renderTimeoutList()
  } catch (error) {
    timeoutEntries = []
    timeoutLoadError = error instanceof Error ? error.message : t('app.nieznany_blad')
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
    showToast(t('app.wybierz_poprawnego_uzytkownika_z_listy_wyszukiwania'), 'error')
    return
  }

  const durationAmount = Number.parseInt(durationAmountInput.value.trim(), 10)
  if (!Number.isInteger(durationAmount) || durationAmount <= 0) {
    showToast(t('app.podaj_dodatnia_liczbe_calkowita_czasu_timeoutu'), 'error')
    return
  }

  const durationUnit = durationUnitSelect.value.trim()
  if (!TIMEOUT_DURATION_UNITS.has(durationUnit)) {
    showToast(t('app.wybierz_poprawna_jednostke_czasu_timeoutu'), 'error')
    return
  }

  const reason = reasonInput.value.trim()
  if (reason.length === 0) {
    showToast(t('app.powod_timeoutu_nie_moze_byc_pusty'), 'error')
    return
  }

  if (reason.length > 500) {
    showToast(t('app.powod_timeoutu_nie_moze_byc_dluzszy'), 'error')
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
      throw new Error(payload.error ?? t('app.nie_udalo_sie_nalozyc_timeoutu'))
    }

    timeoutSelectedUserId = targetUserId
    selectedUserInput.value = targetUserId
    showToast(`✅ Nalozono timeout na ${resolveTimeoutDisplayName(targetUserId)}.`, 'success')
    await loadTimeoutList({ silent: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nieznany_blad_2')
    showToast(`❌ ${message}`, 'error')
  } finally {
    if (createButton instanceof HTMLButtonElement) {
      createButton.disabled = false
    }
  }
}

async function removeTimeoutFromDashboard(timeoutId) {
  const confirmed = window.confirm(t('app.czy_na_pewno_chcesz_usunac_ten'))
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
      throw new Error(payload.error ?? t('app.nie_udalo_sie_usunac_timeoutu'))
    }

    showToast(t('app.timeout_zostal_usuniety'), 'success')
    await loadTimeoutList({ silent: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nieznany_blad_3')
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
  pageLabel.textContent = t('app.strona_p1_p2_4', { p1: economyLeaderboardPage, p2: economyLeaderboardTotalPages })

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
      throw new Error(payload.error ?? t('app.nie_udalo_sie_pobrac_leaderboardu_ekonomii'))
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
    economyLeaderboardLoadError = error instanceof Error ? error.message : t('app.nieznany_blad_4')
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
    label.textContent = t('app.brak_danych')
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
  const sessionActivityNavItem = document.getElementById('session-activity-nav-item')
    ?? document.querySelector('.sidebar-item[data-section="session-activity"]')
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

  if (sessionActivityNavItem instanceof HTMLElement) {
    sessionActivityNavItem.style.display = isAccessDenied ? 'none' : ''
  }

  if (isAccessDenied && currentSection === 'economy-settings') {
    switchSection('economy-leaderboard')
  }

  if (isAccessDenied && currentSection === 'system-logs') {
    switchSection('economy-leaderboard')
  }

  if (isAccessDenied && currentSection === 'session-activity') {
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
    throw new Error(t('app.pole_p1_musi_byc_poprawna_liczba', { p1: fieldName }))
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
  const startingCoins = Math.floor(toFiniteNumber(readEconomyInputValue('economy-starting-coins'), t('app.startowa_ilosc_cebulionow')))
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

  if (dailyMaxCoins < dailyMinCoins) {
    throw new Error(t('app.daily_max_coins_nie_moze_byc'))
  }

  if (dailyMessages.length === 0) {
    throw new Error(t('app.podaj_co_najmniej_jedna_wiadomosc_daily'))
  }

  return {
    startingCoins,
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

  setValue('economy-starting-coins', config.startingCoins)
  setValue('economy-daily-min', config.dailyMinCoins)
  setValue('economy-daily-max', config.dailyMaxCoins)
  setValue('economy-daily-streak-increment', config.dailyStreakIncrement)
  setValue('economy-daily-streak-max-days', config.dailyStreakMaxDays)
  setValue('economy-daily-streak-grace-hours', config.dailyStreakGraceHours)
  setValue('economy-daily-messages', Array.isArray(config.dailyMessages) ? config.dailyMessages.join('\n') : '')
  setValue('economy-xp-text-per-message', config.xpTextPerMessage)
  setValue('economy-xp-text-cooldown-seconds', config.xpTextCooldownSeconds)
  setValue('economy-xp-voice-per-minute', config.xpVoicePerMinute)
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
    throw new Error(t('app.podaj_poprawne_id_uzytkownika_discord_17'))
  }

  const amount = resolveEconomyMutationAmount(operation)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(t('app.kwota_mutacji_musi_byc_wieksza_od'))
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
      throw new Error(payload.error ?? t('app.nie_udao_sie_wykonac_recznej_mutacji'))
    }

    const mutation = payload.mutation
    if (!mutation || typeof mutation !== 'object') {
      throw new Error(t('app.brak_danych_mutacji_ekonomii_w_odpowiedzi'))
    }

    const appliedAmount = Number.isFinite(Number(mutation.amount))
      ? Math.max(1, Math.floor(Number(mutation.amount)))
      : requestBody.amount

    showToast(
      t('app.dodano_p1_p2_uzytkownikowi_p3_aktualnie', { p1: appliedAmount, p2: actionLabel, p3: requestBody.targetUserId, p4: mutation.currentCoins, p5: mutation.currentXp, p6: mutation.currentLevel }),
      'success',
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nieznany_bad_12')
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
    `<option value="">${t('app.ui_wybierz_role')}</option>`,
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
      throw new Error(payload.error ?? t('app.nie_udalo_sie_pobrac_mapowan_rol'))
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
      const message = error instanceof Error ? error.message : t('app.nieznany_blad_5')
      showToast(`❌ ${message}`, 'error')
    }

    renderEconomyLevelRoleOptions()
    renderEconomyLevelRoleMappings()
  }
}

async function saveEconomyLevelRoleMappings(nextMappings) {
  if (!economyLevelRoleMappingsLoaded) {
    throw new Error(t('app.najpierw_odswiez_mapowania_rol_levelowych_i'))
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
    throw new Error(payload.error ?? t('app.nie_udalo_sie_zapisac_mapowan_rol'))
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
    showToast(t('app.najpierw_odswiez_mapowania_rol_levelowych'), 'error')
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
    showToast(t('app.wybierz_poprawna_role'), 'error')
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
    const message = error instanceof Error ? error.message : t('app.nieznany_blad_6')
    showToast(`❌ ${message}`, 'error')
  } finally {
    if (addButton instanceof HTMLButtonElement) {
      addButton.disabled = false
    }
  }
}

async function removeEconomyLevelRoleMapping(roleId) {
  if (!economyLevelRoleMappingsLoaded) {
    showToast(t('app.najpierw_odswiez_mapowania_rol_levelowych_2'), 'error')
    return
  }

  const nextMappings = economyLevelRoleMappings.filter((mapping) => String(mapping.roleId) !== roleId)

  try {
    await saveEconomyLevelRoleMappings(nextMappings)
    showToast('✅ Usunieto mapowanie roli levelowej.', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nieznany_blad_7')
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
    showToast(t('app.wybierz_plik_csv_do_importu'), 'error')
    return
  }

  if (importButton instanceof HTMLButtonElement) {
    importButton.disabled = true
  }

  try {
    if (selectedFile.size > MAX_ECONOMY_CSV_IMPORT_BYTES) {
      throw new Error(t('app.plik_csv_jest_za_duzy_maksymalny'))
    }

    const csvContent = await selectedFile.text()
    if (csvContent.trim().length === 0) {
      throw new Error(t('app.wybrany_plik_csv_jest_pusty'))
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
      throw new Error(payload.error ?? t('app.nie_udalo_sie_zaimportowac_csv_ekonomii'))
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
    const message = error instanceof Error ? error.message : t('app.nieznany_blad_8')
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

      throw new Error(payload.error ?? t('app.nie_udalo_sie_pobrac_ustawien_ekonomii'))
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
      const message = error instanceof Error ? error.message : t('app.nieznany_blad_9')
      showToast(`❌ ${message}`, 'error')
    }

    scheduleEconomyAccessRetry()
    applyEconomySettingsAccessState()
    return false
  }
}

async function saveEconomySettings() {
  if (!economySettingsLoadSuccessful) {
    showToast(t('app.najpierw_odswiez_ustawienia_ekonomii_i_upewnij'), 'error')
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
      throw new Error(payload.error ?? t('app.nie_udalo_sie_zapisac_ustawien_ekonomii'))
    }

    if (!payload.config || typeof payload.config !== 'object') {
      throw new Error(t('app.brak_konfiguracji_ekonomii_w_odpowiedzi_serwera'))
    }

    setEconomySettingsForm(payload.config)
    economySettingsLastLoadedAt = Date.now()
    setEconomySettingsLastLoadedLabel()
    showToast('✅ Ustawienia ekonomii zostaly zapisane.', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nieznany_blad_10')
    showToast(`❌ ${message}`, 'error')
  } finally {
    if (saveButton instanceof HTMLButtonElement) {
      saveButton.disabled = false
    }
  }
}

async function resetAllEconomyUsers() {
  if (!economySettingsLoadSuccessful) {
    showToast(t('app.najpierw_odswiez_ustawienia_ekonomii_i_upewnij_2'), 'error')
    return
  }

  const confirmed = window.confirm(t('app.czy_na_pewno_zresetowac_dane_ekonomii'))
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
      throw new Error(payload.error ?? t('app.nie_udalo_sie_zresetowac_danych_ekonomii'))
    }

    const resetCount = Number(payload.resetCount ?? 0)
    showToast(t('app.zresetowano_dane_ekonomii_dla_p1_uzytkownikow', { p1: resetCount }), 'success')
    await loadEconomySettings({ silent: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nieznany_blad_11')
    showToast(`❌ ${message}`, 'error')
  } finally {
    if (resetButton instanceof HTMLButtonElement) {
      resetButton.disabled = false
    }
  }
}

async function denominateAllEconomyCoins() {
  if (!economySettingsLoadSuccessful) {
    showToast(t('app.najpierw_odswiez_ustawienia_ekonomii_i_upewnij_3'), 'error')
    return
  }

  const confirmed = window.confirm(t('app.czy_na_pewno_wykonac_denominacje_100'))
  if (!confirmed) {
    return
  }

  const denominateButton = document.getElementById('economy-settings-denominate-btn')
  if (denominateButton instanceof HTMLButtonElement) {
    denominateButton.disabled = true
  }

  try {
    const response = await fetchWithCsrf('/api/economy/denominate-coins', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ divisor: 100 }),
    })

    const payload = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(payload.error ?? t('app.nie_udalo_sie_wykonac_denominacji_coinsow'))
    }

    const affectedCount = Number(payload.affectedCount ?? 0)
    showToast(t('app.denominacja_100_1_zakonczona_dla_p1', { p1: affectedCount }), 'success')
    await loadEconomyLeaderboard({ silent: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nieznany_blad_12')
    showToast(`❌ ${message}`, 'error')
  } finally {
    if (denominateButton instanceof HTMLButtonElement) {
      denominateButton.disabled = false
    }
  }
}

async function exportEconomyCsvSnapshot() {
  const exportButton = document.getElementById('economy-csv-export-btn')
  if (exportButton instanceof HTMLButtonElement) {
    exportButton.disabled = true
  }

  try {
    const response = await fetchWithCsrf('/api/economy/export-csv', { method: 'GET' })
    if (!response.ok) {
      const payload = await parseApiResponse(response)
      throw new Error(payload.error ?? t('app.nie_udalo_sie_wyeksportowac_snapshotu_csv'))
    }

    const csvContent = await response.text()
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' })
    const downloadUrl = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = `economy-snapshot-${Date.now()}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(downloadUrl)

    showToast(t('app.snapshot_csv_ekonomii_zostal_wyeksportowany'), 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nieznany_blad_13')
    showToast(`❌ ${message}`, 'error')
  } finally {
    if (exportButton instanceof HTMLButtonElement) {
      exportButton.disabled = false
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
      throw new Error(payload.error ?? t('app.nie_udao_sie_pobrac_bazy_meczow'))
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
      const message = error instanceof Error ? error.message : t('app.nieznany_bad_13')
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
    showToast(t('app.trwa_odswiezanie_meczow_poczekaj_chwile'), 'info')
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
      throw new Error(payload.error ?? t('app.nie_udao_sie_odswiezyc_meczow_z'))
    }

    showToast(t('app.odswiezono_baze_meczow_p1', { p1: payload.count ?? 0 }), 'success')
    await loadG2Matches({ silent: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nieznany_bad_14')
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
    `<option value="">${t('app.ui_wszystkie_druzyny')}</option>`,
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
    list.innerHTML = `<div class="scheduled-empty">${t('app.ui_brak_meczow')}</div>`
    return
  }

  list.innerHTML = g2Matches.map((match) => {
    const logoHtml = match.gameImageUrl
      ? `<img src="${escapeHtml(match.gameImageUrl)}" alt="${escapeHtml(match.game)}" width="18" height="18" style="object-fit:contain;border-radius:3px;vertical-align:middle;margin-right:4px;">`
      : ''
    const tournamentHtml = match.tournamentUrl
      ? `<a href="${escapeHtml(match.tournamentUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none;">${escapeHtml(match.tournament)}</a>`
      : escapeHtml(match.tournament)
    return `
      <article class="scheduled-card">
        <div class="scheduled-card-header">
          <span class="scheduled-card-title">${logoHtml}${escapeHtml(match.game)} | ${escapeHtml(match.g2TeamName ?? 'G2 Esports')} vs ${escapeHtml(match.opponent)}</span>
          <span class="scheduled-chip">${escapeHtml(match.matchType)}</span>
        </div>
        <div class="scheduled-card-meta">
          <span class="scheduled-chip">Turniej: ${tournamentHtml}</span>
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
    metaLabel.textContent = t('app.brak_synchronizacji')
    return
  }

  const syncTimestamp = Number(g2SyncMeta.lastSyncAt)
  const formatted = formatTimestampInWarsaw(syncTimestamp)

  let metaText = `Ostatnia synchronizacja: ${formatted} | Rekordy: ${g2SyncMeta.lastSyncCount ?? 0}`
  if (g2SyncMeta.lastError) {
    metaText += t('app.ui_ostatni_blad', { p1: g2SyncMeta.lastError })
  }

  if (g2RefreshInProgress) {
    metaText += t('app.trwa_odswiezanie')
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
    chipsContainer.innerHTML = `<p class="popover-empty">${t('app.ui_wlacz_dodaj_mecz')}</p>`
    return
  }

  const tokens = buildMatchHelperTokens(match)
  if (!tokens.length) {
    chipsContainer.innerHTML = `<p class="popover-empty">${t('app.ui_wybierz_mecz_podpowiedzi')}</p>`
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

async function loadChannels() {
  try {
    const resp = await fetch('/api/channels')
    if (!resp.ok) throw new Error('fetch failed')

    const json = await resp.json()
    channels = Array.isArray(json.channels) ? json.channels : []
  } catch {
    channels = []
    showToast(t('app.nie_udao_sie_pobrac_kanaow'), 'error')
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
    showToast(t('app.nie_udao_sie_pobrac_rol'), 'error')
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
    throw new Error(payload.error ?? t('app.nie_udao_sie_pobrac_obrazow_z'))
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
      const message = error instanceof Error ? error.message : t('app.nie_udao_sie_pobrac_obrazow_z_2')
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
      const message = error instanceof Error ? error.message : t('app.nie_udao_sie_pobrac_biblioteki_grafik')
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
    showToast(t('app.nie_udao_sie_pobrac_emotek'), 'error')
  }
}

function renderServerEmojiList(filterText) {
  const list = document.getElementById('emoji-list')
  if (!list) return

  const normalizedFilter = String(filterText ?? '').trim().toLowerCase()
  const filteredEmojis = normalizedFilter
    ? emojis.filter((emoji) => String(emoji.name ?? '').toLowerCase().includes(normalizedFilter))
    : emojis

  if (!filteredEmojis.length) {
    list.innerHTML = `<p class="popover-empty">${t('app.ui_brak_emotek')}</p>`
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

function renderEmojiList(filterText) {
  const tabs = document.getElementById('emoji-tabs')
  tabs?.querySelectorAll('[data-emoji-tab]').forEach((tabButton) => {
    tabButton.classList.toggle('active', tabButton.dataset.emojiTab === emojiTab)
  })

  if (emojiTab === 'unicode') {
    renderUnicodeEmojiList(filterText)
    return
  }

  const categories = document.getElementById('emoji-categories')
  if (categories) categories.hidden = true
  renderServerEmojiList(filterText)
}

function getUnicodeEmojiLanguage() {
  return window.I18n?.getLanguage?.() === 'en' ? 'en' : 'pl'
}

function buildUnicodeEmojiButton(item) {
  const emoji = item[window.HusariaEmojiSearch.EMOJI_INDEX]
  const name = window.HusariaEmojiSearch.displayName(item, getUnicodeEmojiLanguage())

  return `<button type="button" class="emoji-chip emoji-chip-unicode" data-token="${escapeHtml(emoji)}" data-raw="1" title="${escapeHtml(name)}">${escapeHtml(emoji)}</button>`
}

function renderUnicodeEmojiCategories(groups) {
  const categories = document.getElementById('emoji-categories')
  if (!categories) return

  const language = getUnicodeEmojiLanguage()
  const tabs = groups.map((group) => {
    const icon = group.items[0]?.[window.HusariaEmojiSearch.EMOJI_INDEX] ?? '•'
    const activeClass = group.key === unicodeEmojiGroupKey ? ' active' : ''
    const label = window.HusariaEmojiSearch.groupLabel(group, language)

    return `<button type="button" class="emoji-category-btn${activeClass}" data-emoji-group="${escapeHtml(group.key)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${escapeHtml(icon)}</button>`
  })

  categories.innerHTML = tabs.join('')
  categories.hidden = false
}

function renderUnicodeEmojiList(filterText) {
  const list = document.getElementById('emoji-list')
  if (!list) return

  const groups = Array.isArray(window.HusariaUnicodeEmojis) ? window.HusariaUnicodeEmojis : []
  if (groups.length === 0) {
    list.innerHTML = `<p class="popover-empty">${t('app.ui_brak_emotek')}</p>`
    return
  }

  if (!unicodeEmojiIndex) {
    unicodeEmojiIndex = window.HusariaEmojiSearch.buildIndex(groups)
  }

  const query = String(filterText ?? '').trim()
  if (query) {
    const categories = document.getElementById('emoji-categories')
    if (categories) categories.hidden = true

    const matches = window.HusariaEmojiSearch.search(unicodeEmojiIndex, query)
    list.innerHTML = matches.length > 0
      ? matches.map(buildUnicodeEmojiButton).join('')
      : `<p class="popover-empty">${t('app.ui_brak_emotek')}</p>`
    return
  }

  if (!unicodeEmojiGroupKey) {
    unicodeEmojiGroupKey = groups[0].key
  }

  renderUnicodeEmojiCategories(groups)

  const activeGroup = groups.find((group) => group.key === unicodeEmojiGroupKey) ?? groups[0]
  const recentMarkup = recentUnicodeEmojis.length > 0
    ? `<div class="emoji-recent"><span class="mention-label">${t('embedCreator.ostatnio_uzywane')}</span><div class="emoji-recent-list">${recentUnicodeEmojis
      .map((emoji) => `<button type="button" class="emoji-chip emoji-chip-unicode" data-token="${escapeHtml(emoji)}" data-raw="1">${escapeHtml(emoji)}</button>`)
      .join('')}</div></div>`
    : ''

  list.innerHTML = `${recentMarkup}${activeGroup.items.map(buildUnicodeEmojiButton).join('')}`
}

function rememberUnicodeEmoji(emoji) {
  recentUnicodeEmojis = window.HusariaEmojiSearch.pushRecent(recentUnicodeEmojis, emoji)
  window.HusariaEmojiSearch.saveRecent(window.localStorage, recentUnicodeEmojis)
  renderEmojiList(document.getElementById('emoji-search-input')?.value ?? '')
}

function renderMentionChannelResults(results, queryText = '') {
  const container = document.getElementById('mention-channel-results')
  if (!container) return

  const normalizedQuery = String(queryText ?? '').trim()
  if (!results.length) {
    container.innerHTML = normalizedQuery.length < 2
      ? `<p class="popover-empty">${t('app.ui_min2_kanal')}</p>`
      : `<p class="popover-empty">${t('app.ui_brak_kanalow_zapytanie')}</p>`
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
      ? `<p class="popover-empty">${t('app.ui_min2_rola')}</p>`
      : `<p class="popover-empty">${t('app.ui_brak_rol_zapytanie')}</p>`
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
    showToast(t('app.nie_udao_sie_wyszukac_kanaow'), 'error')
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
    showToast(t('app.nie_udao_sie_wyszukac_rol'), 'error')
  }
}

function renderMentionUserResults(results, queryText = '') {
  const container = document.getElementById('mention-user-results')
  if (!container) return

  const normalizedQuery = String(queryText ?? '').trim()
  if (!results.length) {
    container.innerHTML = normalizedQuery.length < 2
      ? `<p class="popover-empty">${t('app.ui_min2_user')}</p>`
      : `<p class="popover-empty">${t('app.ui_brak_userow_zapytanie')}</p>`
    return
  }

  container.innerHTML = results.map((member) => {
    const displayName = member.nick || member.globalName || member.username || t('app.ui_uzytkownik')
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
      const displayName = member.nick || member.globalName || member.username || t('app.ui_uzytkownik')
      knownUsers.set(member.id, displayName)
    })

    renderMentionUserResults(mentionUserResults, query)
  } catch {
    if (requestId !== mentionUserSearchRequestId) {
      return
    }

    mentionUserResults = []
    renderMentionUserResults([], query)
    showToast(t('app.nie_udao_sie_wyszukac_uzytkownikow'), 'error')
  }
}

function renderChannelSelector() {
  const select = document.getElementById('channel-select')
  if (!select) return

  const previous = select.value
  select.innerHTML = [
    `<option value="">${t('app.ui_wybierz_kanal')}</option>`,
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
    `<option value="">${t('app.ui_wybierz_ping')}</option>`,
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
    pageLabel.textContent = t('app.strona_p1_p2_5', { p1: creatorImagePage, p2: creatorImageTotalPages })
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
      ? t('app.brak_grafik_pasujacych_do_wyszukiwania_p1', { p1: escapeHtml(creatorImageSearch) })
      : t('app.brak_obrazow_w_folderze_img')
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
        fileNameElement.textContent = t('app.nie_wybrano_pliku_3')
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
    pageLabel.textContent = t('app.strona_p1_p2_6', { p1: libraryImagePage, p2: libraryImageTotalPages })
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
      ? t('app.brak_grafik_pasujacych_do_wyszukiwania_p1_2', { p1: escapeHtml(libraryImageSearch) })
      : t('app.biblioteka_grafik_jest_pusta')
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
    showToast(t('app.wybierz_plik_ktory_chcesz_dodac_do'), 'error')
    return
  }

  if (!isAllowedUploadFile(selectedFile)) {
    showToast('Dozwolone sa tylko pliki PNG, JPG, GIF, WebP i SVG.', 'error')
    return
  }

  if (selectedFile.size > MAX_UPLOAD_BYTES) {
    showToast(t('app.plik_jest_za_duzy_maksymalny_rozmiar_2'), 'error')
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
      throw new Error(payload.error ?? t('app.nie_udalo_sie_dodac_obrazu_do'))
    }

    if (uploadFileInput instanceof HTMLInputElement) {
      uploadFileInput.value = ''
    }

    if (uploadNameInput instanceof HTMLInputElement) {
      uploadNameInput.value = ''
    }

    await syncImageLibraryWithCreator({ silent: true })
    showToast(t('app.grafika_zostala_dodana_do_biblioteki'), 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nie_udalo_sie_dodac_obrazu_do_2')
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
    showToast(t('app.nowa_nazwa_pliku_nie_moze_byc'), 'error')
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
      throw new Error(payload.error ?? t('app.nie_udalo_sie_zmienic_nazwy_obrazu'))
    }

    const renamedTo = String(payload.entry?.name ?? '').trim()
    if (selectedImageName === trimmedFilename && renamedTo) {
      selectedImageName = renamedTo
    }

    await syncImageLibraryWithCreator({ silent: true })
    showToast(t('app.nazwa_grafiki_zostala_zaktualizowana'), 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nie_udalo_sie_zmienic_nazwy_obrazu_2')
    showToast(`❌ ${message}`, 'error')
  }
}

async function deleteImageFromLibrary(filename) {
  const trimmedFilename = String(filename ?? '').trim()
  if (!trimmedFilename) {
    return
  }

  const shouldDelete = window.confirm(t('app.czy_na_pewno_usunac_obraz_p1', { p1: trimmedFilename }))
  if (!shouldDelete) {
    return
  }

  try {
    const response = await fetchWithCsrf(`/api/images/${encodeURIComponent(trimmedFilename)}`, {
      method: 'DELETE',
    })

    const payload = await parseApiResponse(response)
    if (!response.ok) {
      throw new Error(payload.error ?? t('app.nie_udalo_sie_usunac_obrazu'))
    }

    if (selectedImageName === trimmedFilename) {
      selectedImageName = null
    }

    await syncImageLibraryWithCreator({ silent: true })
    showToast(t('app.grafika_zostala_usunieta_z_biblioteki'), 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nie_udalo_sie_usunac_obrazu_2')
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
      fileNameElement.textContent = t('app.nie_wybrano_pliku_4')
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
    messageContainer.innerHTML = renderMarkdown(data.content) || `<span style="opacity:.45">${t('app.ui_wpisz_tresc')}</span>`
  }

  if (data.mentionRoleEnabled && data.mentionRoleId) {
    pingPreviewLine.textContent = t('app.ui_ping_przed_label', { p1: resolvePingTargetLabel(data.mentionRoleId) })
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
      imagePlaceholder.textContent = t('app.wybierz_grafike_z_biblioteki_aby_zobaczyc')
      imagePlaceholder.style.display = ''
    } else {
      imagePlaceholder.textContent = t('app.wgraj_plik_aby_zobaczyc_podglad')
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
    : `<span style="opacity:.45">${t('app.ui_wpisz_tresc')}</span>`

  return `${titleHtml}${bodyHtml}`
}

function renderInlineText(value) {
  let html = escapeHtml(value)
  html = renderDiscordCustomEmojis(html)
  html = renderDiscordMentions(html)
  html = renderDiscordTimestamps(html)
  return html
}

function buildDiscordMockupHtml(post) {
  const payload = post?.payload ?? {}
  const mode = payload.mode ?? 'embedded'
  const color = COLOR_MAP[payload.colorName ?? 'czerwony'] ?? COLOR_MAP.czerwony

  const pingEnabled = Boolean(payload.mentionRoleEnabled)
  const pingLabel = pingEnabled ? resolvePingTargetLabel(payload.mentionRoleId ?? '') : ''
  const pingHtml = pingEnabled && pingLabel
    ? `<div class="preview-ping-line" style="display:inline-flex">${t('app.ui_ping_przed')}: ${escapeHtml(pingLabel)}</div>`
    : ''

  let contentHtml = ''
  if (mode === 'embedded') {
    contentHtml = `<div class="discord-embed">
        <div class="embed-color-bar" style="background:${color}"></div>
        <div class="embed-body">
          <div class="embed-description">${renderPreviewEmbedText(payload.title ?? '', payload.content ?? '')}</div>
        </div>
      </div>`
  } else {
    const rendered = renderMarkdown(payload.content ?? '')
    contentHtml = `<div class="discord-plain-message">${rendered || `<span style="opacity:.45">${t('app.ui_brak_tresci')}</span>`}</div>`
  }

  let imageHtml = ''
  if (payload.imageMode === 'library' && payload.imageFilename) {
    const src = `/img/${encodeURIComponent(String(payload.imageFilename))}`
    imageHtml = `<div class="preview-image-block"><img class="preview-image" src="${src}" alt="Grafika"></div>`
  } else if (payload.imageMode === 'upload') {
    imageHtml = '<div class="preview-image-placeholder">🖼️ Wgrana grafika</div>'
  }

  return `<div class="discord-mockup">
    <div class="discord-message">
      <div class="discord-avatar"><img src="/img/DNA.png" alt="HusariaBot"></div>
      <div class="discord-msg-content">
        <span class="discord-bot-name">G2 Hussars <span class="bot-badge">BOT</span></span>
        ${pingHtml}
        ${contentHtml}
        ${imageHtml}
      </div>
    </div>
  </div>`
}

function collectFormDataSync() {
  const pingEnabled = document.getElementById('ping-role-enabled')?.checked ?? false
  const pingRoleId = document.getElementById('ping-role-select')?.value ?? ''
  const imageMode = document.getElementById('image-mode-select')?.value ?? 'none'
  const scheduleAtLocal = document.getElementById('schedule-at')?.value ?? ''
  const matchHelperEnabled = document.getElementById('match-helper-enabled')?.checked ?? false
  const eventEnabled = document.getElementById('event-enabled')?.checked ?? false

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

  button.disabled = !(hasChannel && hasContent && pingReady && imageReady && matchReady && eventReady)

  if (editingSentPostId) {
    buttonText.textContent = t('app.zapisz_zmiany_wysanego_posta')
    return
  }

  if (data.scheduleAtLocal) {
    buttonText.textContent = editingScheduledPostId ? 'Zapisz zaplanowany post' : t('app.zaplanuj_publikacje')
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
      throw new Error(t('app.wysany_post_nie_moze_zostac_ponownie'))
    }

    if (editingScheduledPostId && !hasScheduleDate) {
      throw new Error(t('app.edytowany_post_zaplanowany_musi_miec_ustawiona'))
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
      throw new Error(json.error ?? t('app.nieznany_bad_15'))
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
      showToast(t('app.wysany_post_zosta_zaktualizowany'), 'success')
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
          ? t('app.zaplanowany_post_zosta_zaktualizowany')
          : t('app.post_zosta_dodany_do_schedulera'),
        'success',
      )

      return
    }

    if (payload.imageMode === 'upload') {
      await loadImages()
      renderImageLibrary()
    }

    await loadSentPosts()
    showToast(t('app.publikacja_wysana_pomyslnie'), 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : t('app.nieznany_bad_16')
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
    reader.onerror = () => reject(new Error(t('app.nie_udao_sie_odczytac_pliku')))
    reader.readAsDataURL(file)
  })
}

function bindPopoverCollapse() {
  document.querySelectorAll('.editor-popover > .popover-header, .timestamp-tools > .timestamp-tools-header').forEach((header) => {
    header.setAttribute('role', 'button')
    header.setAttribute('tabindex', '0')
    header.setAttribute('aria-expanded', 'true')

    const toggle = () => {
      const collapsed = header.parentElement.classList.toggle('is-collapsed')
      header.setAttribute('aria-expanded', String(!collapsed))
    }

    header.addEventListener('click', (event) => {
      if (event.target.closest('input')) return
      toggle()
    })
    header.addEventListener('keydown', (event) => {
      if (event.target !== header) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        toggle()
      }
    })
  })
}

function insertToken(token, { padded = true } = {}) {
  const target = getActiveEditor()
  if (!target) {
    showToast('Najpierw kliknij pole tekstowe edytora.', 'info')
    return
  }

  const value = target.value ?? ''
  const start = target.selectionStart ?? value.length
  const end = target.selectionEnd ?? value.length

  const rightPart = value.slice(end)
  const needsTrailingSpace = padded && (rightPart.length === 0 || !/^\s/.test(rightPart))
  const insertion = `${token}${needsTrailingSpace ? ' ' : ''}`

  target.value = `${value.slice(0, start)}${insertion}${value.slice(end)}`

  const caretPos = start + insertion.length
  target.setSelectionRange(caretPos, caretPos)
  target.dispatchEvent(new Event('input', { bubbles: true }))
  target.focus({ preventScroll: true })
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

function applyAnsiCodes(codes) {
  const target = getActiveEditor()
  if (!target) {
    showToast('Najpierw kliknij pole tekstowe edytora.', 'info')
    return
  }

  const value = target.value ?? ''
  const start = target.selectionStart ?? value.length
  const end = target.selectionEnd ?? value.length
  const result = window.HusariaAnsi.applyToSelection(value, start, end, codes)

  target.value = result.value
  target.setSelectionRange(result.selectionStart, result.selectionEnd)
  target.dispatchEvent(new Event('input', { bubbles: true }))
  target.focus({ preventScroll: true })
}

function insertAnsiFence() {
  const target = getActiveEditor()
  if (!target) {
    showToast('Najpierw kliknij pole tekstowe edytora.', 'info')
    return
  }

  const value = target.value ?? ''
  const start = target.selectionStart ?? value.length
  const end = target.selectionEnd ?? value.length
  const result = window.HusariaAnsi.insertFence(value, start, end)

  target.value = result.value
  target.setSelectionRange(result.selectionStart, result.selectionEnd)
  target.dispatchEvent(new Event('input', { bubbles: true }))
  target.focus({ preventScroll: true })
}

function renderAnsiPalette() {
  const foreground = document.getElementById('ansi-foreground-colors')
  const background = document.getElementById('ansi-background-colors')
  if (!foreground || !background) return

  const buildSwatch = (entry, kind) => `<button type="button" class="ansi-swatch" data-ansi-code="${entry.code}" style="background-color:${entry.css}" title="${escapeHtml(t(`embedCreator.ansi_kolor_${kind}_${entry.key}`))}" aria-label="${escapeHtml(t(`embedCreator.ansi_kolor_${kind}_${entry.key}`))}"></button>`

  foreground.innerHTML = window.HusariaAnsi.FOREGROUND_COLORS.map((entry) => buildSwatch(entry, 'fg')).join('')
  background.innerHTML = window.HusariaAnsi.BACKGROUND_COLORS.map((entry) => buildSwatch(entry, 'bg')).join('')
}

function renderAnsiEffects() {
  const container = document.getElementById('ansi-effects')
  if (!container) return

  const cssFor = (code) => window.HusariaAnsi.FOREGROUND_COLORS.find((entry) => entry.code === code)?.css ?? '#ffffff'

  container.innerHTML = window.HusariaAnsi.EFFECTS.map((effect) => {
    const stops = effect.codes.map(cssFor)
    const gradient = stops.length > 1 ? stops.join(', ') : `${stops[0]}, ${stops[0]}`
    const label = escapeHtml(t(`embedCreator.ansi_efekt_${effect.key}`))

    return `<button type="button" class="ansi-effect-btn" data-ansi-effect="${effect.key}" style="background-image:linear-gradient(90deg, ${gradient})" title="${label}">${label}</button>`
  }).join('')
}

function applyAnsiEffect(effectKey) {
  const target = getActiveEditor()
  if (!target) {
    showToast('Najpierw kliknij pole tekstowe edytora.', 'info')
    return
  }

  const value = target.value ?? ''
  const start = target.selectionStart ?? 0
  const end = target.selectionEnd ?? 0
  const result = window.HusariaAnsi.applyEffect(value, start, end, effectKey)

  if (!result) {
    showToast(t('embedCreator.ansi_efekt_zaznacz'), 'info')
    return
  }

  target.value = result.value
  target.setSelectionRange(result.selectionStart, result.selectionEnd)
  target.dispatchEvent(new Event('input', { bubbles: true }))
  target.focus({ preventScroll: true })
}

function bindAnsiControls() {
  const ansiPopover = document.getElementById('ansi-popover')

  renderAnsiPalette()
  renderAnsiEffects()

  ansiPopover?.addEventListener('click', (event) => {
    event.stopPropagation()

    const swatch = event.target.closest('[data-ansi-code]')
    if (swatch) {
      applyAnsiCodes([Number(swatch.dataset.ansiCode)])
      return
    }

    const effect = event.target.closest('[data-ansi-effect]')
    if (effect) {
      applyAnsiEffect(effect.dataset.ansiEffect)
      return
    }

    const action = event.target.closest('[data-ansi-action]')?.dataset.ansiAction
    if (action === 'bold') applyAnsiCodes([window.HusariaAnsi.BOLD_CODE])
    if (action === 'underline') applyAnsiCodes([window.HusariaAnsi.UNDERLINE_CODE])
    if (action === 'fence') insertAnsiFence()
  })
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
  target.focus({ preventScroll: true })
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
  target.focus({ preventScroll: true })
}

function renderMarkdown(text) {
  if (!text) return ''

  const escaped = escapeHtml(text)
  const codeBlocks = []

  let html = escaped.replace(/```([\s\S]*?)```/g, (_match, code) => {
    const ansiBlock = /^ansi\r?\n([\s\S]*)$/.exec(code)
    const block = ansiBlock
      ? `<pre class="md-codeblock md-codeblock-ansi">${window.HusariaAnsi.toHtml(ansiBlock[1])}</pre>`
      : `<pre class="md-codeblock">${code}</pre>`
    const index = codeBlocks.push(block) - 1
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

  const title = String(draft.title ?? '').trim() || t('app.brak_tytuu_wydarzenia')
  const description = String(draft.description ?? '').trim() || t('app.brak_opisu_wydarzenia')
  const location = String(draft.location ?? '').trim() || 'Online'

  const startUnix = Number.isFinite(Date.parse(String(draft.startAtLocal ?? '')))
    ? Math.floor(Date.parse(String(draft.startAtLocal ?? '')) / 1000)
    : null
  const endUnix = Number.isFinite(Date.parse(String(draft.endAtLocal ?? '')))
    ? Math.floor(Date.parse(String(draft.endAtLocal ?? '')) / 1000)
    : null

  const startLabel = startUnix ? `<t:${startUnix}:F>` : t('app.nie_ustawiono_3')
  const endLabel = endUnix ? `<t:${endUnix}:F>` : t('app.nie_ustawiono_4')

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

function extractUserMentionIds(text) {
  const ids = new Set()
  const regex = /(?:<|&lt;)@!?(\d{17,20})(?:>|&gt;)/g
  let match
  while ((match = regex.exec(text)) !== null) {
    ids.add(match[1])
  }
  return [...ids]
}

async function prefetchUserMentions(ids) {
  const unknownIds = ids.filter((id) => !knownUsers.has(id))
  if (unknownIds.length === 0) return

  try {
    const response = await fetch(`/api/members/by-ids?ids=${encodeURIComponent(unknownIds.join(','))}`)
    const json = await parseApiResponse(response)
    if (response.ok && Array.isArray(json.members)) {
      for (const member of json.members) {
        if (member?.id && member?.displayName) {
          knownUsers.set(String(member.id), String(member.displayName))
        }
      }
    }
  } catch {
    // silent fail — mentions fall back to 'użytkownik'
  }
}

function renderDiscordMentions(text) {
  const channelMap = new Map(channels.map((channel) => [channel.id, channel.name]))
  const roleMap = new Map(roles.map((role) => [role.id, role.name]))

  let html = text.replace(/(?:&lt;|<)#(\d{17,20})(?:&gt;|>)/g, (_match, id) => {
    const name = channelMap.get(id) ?? t('app.ui_kanal')
    return `<span class="md-mention">#${escapeHtml(name)}</span>`
  })

  html = html.replace(/(?:&lt;|<)@&(\d{17,20})(?:&gt;|>)/g, (_match, id) => {
    const name = roleMap.get(id) ?? 'nieznana-rola'
    return `<span class="md-mention">@${escapeHtml(name)}</span>`
  })

  html = html.replace(/(?:&lt;|<)@!?(\d{17,20})(?:&gt;|>)/g, (_match, id) => {
    const name = knownUsers.get(id) ?? t('app.ui_uzytkownik')
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
    return t('app.za_chwile')
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

function buildAuthorHtml(name, userId, avatarHash, prefix = t('app.ui_dodal'), resolvedAvatarUrl = null, role = null) {
  if (!name) return ''
  const avatarUrl = resolvedAvatarUrl
    || (userId && avatarHash
      ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(userId)}/${encodeURIComponent(avatarHash)}.png?size=32`
      : `https://cdn.discordapp.com/embed/avatars/0.png`)
  const imgHtml = `<img src="${avatarUrl}" alt="" class="author-avatar" width="16" height="16" style="border-radius:50%;vertical-align:middle;margin-right:4px;">`
  const roleBadge = role ? ` <span class="role-badge role-badge-${escapeHtml(String(role).toLowerCase())}">${escapeHtml(String(role))}</span>` : ''
  return `<span class="scheduled-chip author-chip">${imgHtml}${escapeHtml(prefix)}: ${escapeHtml(name)}${roleBadge}</span>`
}

// ─── Server Stats ──────────────────────────────────────────────────────────────

function todayDateString() {
  return new Date().toISOString().slice(0, 10)
}

function shiftDate(baseDate, days) {
  const d = new Date(baseDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ─── Stats Section ────────────────────────────────────────────────────────────

const STATS_DOUGHNUT_COLORS = ['#5865f2', '#9b59b6', '#3498db', '#1abc9c', '#e74c3c', '#95a5a6']
const STATS_CHART_OPTIONS_BASE = {
  responsive: true,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { labels: { color: '#e0e0e0' } }, tooltip: { mode: 'index' } },
  scales: {
    x: { ticks: { color: '#aaa', maxTicksLimit: 14 }, grid: { color: 'rgba(255,255,255,0.05)' } },
    y: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true },
  },
}

function getMonthStartDate() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function applyTabPreset(tab, preset) {
  const today = todayDateString()
  let start = today
  if (preset === '7d') start = shiftDate(today, -6)
  else if (preset === 'month') start = getMonthStartDate()
  statsTabDates[tab].startDate = start
  statsTabDates[tab].endDate = today
  const startInput = document.getElementById(`${tab}-start-date`)
  const endInput = document.getElementById(`${tab}-end-date`)
  if (startInput) startInput.value = start
  if (endInput) endInput.value = today
}

function initTabDateControls(tab) {
  applyTabPreset(tab, 'today')

  const panel = document.getElementById(`stats-tab-${tab}`)
  if (!panel) return

  panel.querySelectorAll('.stats-preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset ?? 'today'
      applyTabPreset(tab, preset)
      panel.querySelectorAll('.stats-preset-btn').forEach((b) => b.classList.toggle('active', b === btn))
      void loadTabByName(tab)
    })
  })

  panel.querySelectorAll('.stats-apply-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const startVal = document.getElementById(`${tab}-start-date`)?.value ?? ''
      const endVal = document.getElementById(`${tab}-end-date`)?.value ?? ''
      if (!startVal || !endVal || startVal > endVal) {
        showToast(t('app.nieprawidowy_zakres_dat'), 'error')
        return
      }
      statsTabDates[tab].startDate = startVal
      statsTabDates[tab].endDate = endVal
      panel.querySelectorAll('.stats-preset-btn').forEach((b) => b.classList.remove('active'))
      void loadTabByName(tab)
    })
  })
}

function downloadUrlAs(url, filename) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function initStatsSectionIfNeeded() {
  if (statsSectionBound) return
  statsSectionBound = true

  initTabDateControls('users')
  initTabDateControls('messages')
  initTabDateControls('voice')

  document.querySelectorAll('.stats-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab
      if (!tab) return
      statsActiveTab = tab
      document.querySelectorAll('.stats-tab-btn').forEach((b) => b.classList.toggle('active', b === btn))
      document.querySelectorAll('.stats-tab-panel').forEach((p) => p.classList.toggle('active', p.id === `stats-tab-${tab}`))
      void loadTabByName(tab)
    })
  })

  const csvUsers = document.getElementById('users-csv-btn')
  if (csvUsers) csvUsers.addEventListener('click', () => {
    const { startDate, endDate } = statsTabDates.users
    downloadUrlAs(`/api/stats/export/members?startDate=${startDate}&endDate=${endDate}`, `members_${startDate}_${endDate}.csv`)
  })

  const csvMessages = document.getElementById('messages-csv-btn')
  if (csvMessages) csvMessages.addEventListener('click', () => {
    const { startDate, endDate } = statsTabDates.messages
    downloadUrlAs(`/api/stats/export/messages?startDate=${startDate}&endDate=${endDate}`, `messages_${startDate}_${endDate}.csv`)
  })

  const csvVoice = document.getElementById('voice-csv-btn')
  if (csvVoice) csvVoice.addEventListener('click', () => {
    const { startDate, endDate } = statsTabDates.voice
    downloadUrlAs(`/api/stats/export/voice?startDate=${startDate}&endDate=${endDate}`, `voice_${startDate}_${endDate}.csv`)
  })

  const exportAllBtn2 = document.getElementById('stats-export-all-btn2')
  if (exportAllBtn2) exportAllBtn2.addEventListener('click', () => {
    downloadUrlAs('/api/stats/export/all', 'stats_export_all.zip')
  })

  const resetBtn = document.getElementById('stats-reset-btn')
  if (resetBtn) resetBtn.addEventListener('click', () => { void handleStatsReset() })

  const msgLoadMore = document.getElementById('messages-load-more-btn')
  if (msgLoadMore) msgLoadMore.addEventListener('click', () => { void loadMessagesTopUsers(false) })

  const voiceLoadMore = document.getElementById('voice-load-more-btn')
  if (voiceLoadMore) voiceLoadMore.addEventListener('click', () => { void loadVoiceTopUsers(false) })

  const saveBtn = document.getElementById('stats-save-excluded-btn')
  if (saveBtn) saveBtn.addEventListener('click', () => { void saveStatsExcludedChannels() })
}

async function loadActiveStatsTab() {
  await loadTabByName(statsActiveTab)
}

async function loadTabByName(tab) {
  if (tab === 'users') await loadUsersTab()
  else if (tab === 'messages') await loadMessagesTab()
  else if (tab === 'voice') await loadVoiceTab()
  else if (tab === 'settings') await loadStatsExcludedChannels()
}

// ── Users tab ────────────────────────────────────────────────────────────────

async function loadUsersTab() {
  await Promise.all([
    loadUsersSummary(),
    loadMembersTimeSeries(),
    loadActiveUsers(),
  ])
}

async function loadUsersSummary() {
  const kpiCount = document.getElementById('users-kpi-count')
  const kpiBalance = document.getElementById('users-kpi-balance')

  try {
    const { startDate, endDate } = statsTabDates.users
    const params = new URLSearchParams({ startDate, endDate })
    const res = await fetch(`/api/stats/members/summary?${params}`)
    const payload = await parseApiResponse(res)
    if (!res.ok) throw new Error(payload.error ?? t('app.ui_blad_kropka'))
    const s = payload.summary ?? {}
    if (kpiCount) kpiCount.textContent = Number.isFinite(Number(s.latestMemberCount)) ? Number(s.latestMemberCount).toLocaleString('pl-PL') : '—'
    if (kpiBalance) {
      const joins = Number(s.totalJoins) || 0
      const leaves = Number(s.totalLeaves) || 0
      const balance = joins - leaves
      kpiBalance.textContent = balance === 0 ? '0' : balance > 0 ? `+${balance.toLocaleString('pl-PL')}` : balance.toLocaleString('pl-PL')
      kpiBalance.style.color = balance > 0 ? '#57f287' : balance < 0 ? '#ed4245' : ''
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : t('app.ui_blad')
    if (kpiCount) kpiCount.textContent = '—'
    if (kpiBalance) { kpiBalance.textContent = '—'; kpiBalance.style.color = '' }
    showToast(`❌ ${msg}`, 'error')
  }
}

async function handleStatsReset() {
  const confirmed = window.confirm(
    t('app.ui_reset_statystyk'),
  )
  if (!confirmed) return

  const btn = document.getElementById('stats-reset-btn')
  const statusEl = document.getElementById('stats-reset-status')
  if (btn) btn.disabled = true
  if (statusEl) statusEl.textContent = 'Resetowanie...'

  try {
    const response = await fetchWithCsrf('/api/stats/reset', { method: 'POST' })
    const payload = await parseApiResponse(response)
    if (!response.ok) throw new Error(payload.error ?? t('app.nie_udao_sie_zresetowac'))
    if (statusEl) statusEl.textContent = t('app.zresetowano_pomyslnie')
    showToast(t('app.statystyki_zostay_zresetowane'), 'success')
    setTimeout(() => { if (statusEl) statusEl.textContent = '' }, 4000)
  } catch (error) {
    const msg = error instanceof Error ? error.message : t('app.nieznany_bad_17')
    if (statusEl) statusEl.textContent = `✗ ${msg}`
    showToast(`❌ ${msg}`, 'error')
    setTimeout(() => { if (statusEl) statusEl.textContent = '' }, 5000)
  } finally {
    if (btn) btn.disabled = false
  }
}

async function loadMembersTimeSeries() {
  try {
    const { startDate, endDate } = statsTabDates.users
    const params = new URLSearchParams({ startDate, endDate })
    const res = await fetch(`/api/stats/members/timeseries?${params}`)
    const payload = await parseApiResponse(res)
    if (!res.ok) throw new Error(payload.error ?? t('app.ui_blad_kropka'))
    renderMembersChart(Array.isArray(payload.timeSeries) ? payload.timeSeries : [])
  } catch (error) {
    showToast(`❌ ${error instanceof Error ? error.message : t('app.bad_wykresu_czonkow')}`, 'error')
  }
}

function renderMembersChart(timeSeries) {
  const canvas = document.getElementById('users-members-chart')
  if (!(canvas instanceof HTMLCanvasElement) || typeof Chart === 'undefined') return
  if (usersChartInstance) { usersChartInstance.destroy(); usersChartInstance = null }

  usersChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels: timeSeries.map((p) => p.date),
      datasets: [
        {
          label: t('app.ui_czlonkowie'),
          data: timeSeries.map((p) => Number(p.memberCount) || 0),
          backgroundColor: 'rgba(88,101,242,0.2)',
          borderColor: '#5865f2',
          borderWidth: 2,
          pointRadius: 3,
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      ...STATS_CHART_OPTIONS_BASE,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        ...(STATS_CHART_OPTIONS_BASE.plugins ?? {}),
        tooltip: {
          callbacks: {
            afterLabel(ctx) {
              const p = timeSeries[ctx.dataIndex]
              if (!p) return ''
              const balance = (Number(p.joins) || 0) - (Number(p.leaves) || 0)
              return balance === 0 ? 'Bilans: 0' : balance > 0 ? `Bilans: +${balance}` : `Bilans: ${balance}`
            },
          },
        },
      },
    },
  })
}

async function loadActiveUsers() {
  const list = document.getElementById('users-active-list')
  if (!list) return
  list.innerHTML = `<div class="scheduled-empty">${t('app.ui_ladowanie')}</div>`

  try {
    const { startDate, endDate } = statsTabDates.users
    const params = new URLSearchParams({ startDate, endDate })
    const res = await fetch(`/api/stats/members/active-users?${params}`)
    const payload = await parseApiResponse(res)
    if (!res.ok) throw new Error(payload.error ?? t('app.ui_blad_kropka'))
    const users = Array.isArray(payload.activeUsers) ? payload.activeUsers : []
    renderTopUsersList(list, users.slice(0, 5), 'messages', 'voiceMinutes')
  } catch (error) {
    const msg = error instanceof Error ? error.message : t('app.ui_blad')
    list.innerHTML = `<div class="scheduled-empty scheduled-error">${t('app.ui_blad_prefix')}: ${escapeHtml(msg)}</div>`
  }
}

// ── Messages tab ─────────────────────────────────────────────────────────────

async function loadMessagesTab() {
  messagesTopUsersOffset = 0
  await Promise.all([
    loadMessagesSummary(),
    loadMessagesTimeSeries(),
    loadMessagesTopUsers(true),
    loadMessagesTopChannels(),
  ])
}

async function loadMessagesSummary() {
  const kpiTotal = document.getElementById('messages-kpi-total')
  const kpiUnique = document.getElementById('messages-kpi-unique')

  try {
    const { startDate, endDate } = statsTabDates.messages
    const params = new URLSearchParams({ startDate, endDate })
    const res = await fetch(`/api/stats/messages/summary?${params}`)
    const payload = await parseApiResponse(res)
    if (!res.ok) throw new Error(payload.error ?? t('app.ui_blad_kropka'))
    const s = payload.summary ?? {}
    if (kpiTotal) kpiTotal.textContent = Number.isFinite(Number(s.messages)) ? Number(s.messages).toLocaleString('pl-PL') : '—'
    if (kpiUnique) kpiUnique.textContent = Number.isFinite(Number(s.uniqueUsers)) ? Number(s.uniqueUsers).toLocaleString('pl-PL') : '—'
  } catch (error) {
    if (kpiTotal) kpiTotal.textContent = '—'
    if (kpiUnique) kpiUnique.textContent = '—'
    showToast(`❌ ${error instanceof Error ? error.message : t('app.bad_podsumowania')}`, 'error')
  }
}

async function loadMessagesTimeSeries() {
  try {
    const { startDate, endDate } = statsTabDates.messages
    const params = new URLSearchParams({ startDate, endDate })
    const res = await fetch(`/api/stats/messages/timeseries?${params}`)
    const payload = await parseApiResponse(res)
    if (!res.ok) throw new Error(payload.error ?? t('app.ui_blad_kropka'))
    renderMessagesChart(Array.isArray(payload.timeSeries) ? payload.timeSeries : [])
  } catch (error) {
    showToast(`❌ ${error instanceof Error ? error.message : t('app.bad_wykresu')}`, 'error')
  }
}

function renderMessagesChart(timeSeries) {
  const canvas = document.getElementById('messages-timeseries-chart')
  if (!(canvas instanceof HTMLCanvasElement) || typeof Chart === 'undefined') return
  if (messagesChartInstance) { messagesChartInstance.destroy(); messagesChartInstance = null }

  messagesChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: timeSeries.map((p) => p.date),
      datasets: [{
        label: t('app.ui_wiadomosci'),
        data: timeSeries.map((p) => Number(p.messages) || 0),
        backgroundColor: 'rgba(88,101,242,0.75)',
        borderColor: '#5865f2',
        borderWidth: 1,
      }],
    },
    options: { ...STATS_CHART_OPTIONS_BASE, responsive: true, maintainAspectRatio: false },
  })
}

async function loadMessagesTopUsers(reset) {
  const list = document.getElementById('messages-top-users-list')
  const loadMoreBtn = document.getElementById('messages-load-more-btn')
  if (!list) return

  if (reset) {
    messagesTopUsersOffset = 0
    list.innerHTML = `<div class="scheduled-empty">${t('app.ui_ladowanie')}</div>`
  }

  const BATCH = 5
  try {
    const { startDate, endDate } = statsTabDates.messages
    const params = new URLSearchParams({ startDate, endDate, limit: String(messagesTopUsersOffset + BATCH) })
    const res = await fetch(`/api/stats/messages/top-users?${params}`)
    const payload = await parseApiResponse(res)
    if (!res.ok) throw new Error(payload.error ?? t('app.ui_blad_kropka'))
    const users = Array.isArray(payload.topUsers) ? payload.topUsers : []

    if (reset) list.innerHTML = ''
    const slice = users.slice(messagesTopUsersOffset)
    renderTopUsersList(list, slice, 'messages', null, messagesTopUsersOffset)
    messagesTopUsersOffset += slice.length

    if (loadMoreBtn) loadMoreBtn.style.display = users.length >= messagesTopUsersOffset + 1 ? '' : 'none'
  } catch (error) {
    const msg = error instanceof Error ? error.message : t('app.ui_blad')
    if (reset) list.innerHTML = `<div class="scheduled-empty scheduled-error">${t('app.ui_blad_prefix')}: ${escapeHtml(msg)}</div>`
    if (loadMoreBtn) loadMoreBtn.style.display = 'none'
  }
}

async function loadMessagesTopChannels() {
  const list = document.getElementById('messages-top-channels-list')
  if (!list) return
  list.innerHTML = `<div class="scheduled-empty">${t('app.ui_ladowanie')}</div>`

  try {
    const { startDate, endDate } = statsTabDates.messages
    const params = new URLSearchParams({ startDate, endDate, limit: '5' })
    const res = await fetch(`/api/stats/messages/top-channels?${params}`)
    const payload = await parseApiResponse(res)
    if (!res.ok) throw new Error(payload.error ?? t('app.ui_blad_kropka'))
    const channels = Array.isArray(payload.topChannels) ? payload.topChannels : []
    renderTopChannelsList(list, channels, 'messages', 'wiad.')
    renderDoughnutChart('messages-channels-doughnut', 'messages', channels, 'messages')
  } catch (error) {
    const msg = error instanceof Error ? error.message : t('app.ui_blad')
    list.innerHTML = `<div class="scheduled-empty scheduled-error">${t('app.ui_blad_prefix')}: ${escapeHtml(msg)}</div>`
  }
}

// ── Voice tab ────────────────────────────────────────────────────────────────

async function loadVoiceTab() {
  voiceTopUsersOffset = 0
  await Promise.all([
    loadVoiceSummary(),
    loadVoiceTimeSeries(),
    loadVoiceTopUsers(true),
    loadVoiceTopChannels(),
  ])
}

async function loadVoiceSummary() {
  const kpiMinutes = document.getElementById('voice-kpi-minutes')
  const kpiHours = document.getElementById('voice-kpi-hours')
  const kpiUnique = document.getElementById('voice-kpi-unique')

  try {
    const { startDate, endDate } = statsTabDates.voice
    const params = new URLSearchParams({ startDate, endDate })
    const res = await fetch(`/api/stats/voice/summary?${params}`)
    const payload = await parseApiResponse(res)
    if (!res.ok) throw new Error(payload.error ?? t('app.ui_blad_kropka'))
    const s = payload.summary ?? {}
    const minutes = Number.isFinite(Number(s.voiceMinutes)) ? Number(s.voiceMinutes) : 0
    if (kpiMinutes) kpiMinutes.textContent = minutes.toLocaleString('pl-PL')
    if (kpiHours) kpiHours.textContent = Math.floor(minutes / 60).toLocaleString('pl-PL')
    if (kpiUnique) kpiUnique.textContent = Number.isFinite(Number(s.uniqueUsers)) ? Number(s.uniqueUsers).toLocaleString('pl-PL') : '—'
  } catch (error) {
    if (kpiMinutes) kpiMinutes.textContent = '—'
    if (kpiHours) kpiHours.textContent = '—'
    if (kpiUnique) kpiUnique.textContent = '—'
    showToast(`❌ ${error instanceof Error ? error.message : t('app.bad_podsumowania_voice')}`, 'error')
  }
}

async function loadVoiceTimeSeries() {
  try {
    const { startDate, endDate } = statsTabDates.voice
    const params = new URLSearchParams({ startDate, endDate })
    const res = await fetch(`/api/stats/voice/timeseries?${params}`)
    const payload = await parseApiResponse(res)
    if (!res.ok) throw new Error(payload.error ?? t('app.ui_blad_kropka'))
    renderVoiceChart(Array.isArray(payload.timeSeries) ? payload.timeSeries : [])
  } catch (error) {
    showToast(`❌ ${error instanceof Error ? error.message : t('app.bad_wykresu_voice')}`, 'error')
  }
}

function renderVoiceChart(timeSeries) {
  const canvas = document.getElementById('voice-timeseries-chart')
  if (!(canvas instanceof HTMLCanvasElement) || typeof Chart === 'undefined') return
  if (voiceChartInstance) { voiceChartInstance.destroy(); voiceChartInstance = null }

  voiceChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: timeSeries.map((p) => p.date),
      datasets: [{
        label: 'Minuty Voice',
        data: timeSeries.map((p) => Number(p.voiceMinutes) || 0),
        backgroundColor: 'rgba(87,242,135,0.75)',
        borderColor: '#57f287',
        borderWidth: 1,
      }],
    },
    options: { ...STATS_CHART_OPTIONS_BASE, responsive: true, maintainAspectRatio: false },
  })
}

async function loadVoiceTopUsers(reset) {
  const list = document.getElementById('voice-top-users-list')
  const loadMoreBtn = document.getElementById('voice-load-more-btn')
  if (!list) return

  if (reset) {
    voiceTopUsersOffset = 0
    list.innerHTML = `<div class="scheduled-empty">${t('app.ui_ladowanie')}</div>`
  }

  const BATCH = 5
  try {
    const { startDate, endDate } = statsTabDates.voice
    const params = new URLSearchParams({ startDate, endDate, limit: String(voiceTopUsersOffset + BATCH) })
    const res = await fetch(`/api/stats/voice/top-users?${params}`)
    const payload = await parseApiResponse(res)
    if (!res.ok) throw new Error(payload.error ?? t('app.ui_blad_kropka'))
    const users = Array.isArray(payload.topUsers) ? payload.topUsers : []

    if (reset) list.innerHTML = ''
    const slice = users.slice(voiceTopUsersOffset)
    renderTopUsersList(list, slice, 'voiceMinutes', null, voiceTopUsersOffset)
    voiceTopUsersOffset += slice.length

    if (loadMoreBtn) loadMoreBtn.style.display = users.length >= voiceTopUsersOffset + 1 ? '' : 'none'
  } catch (error) {
    const msg = error instanceof Error ? error.message : t('app.ui_blad')
    if (reset) list.innerHTML = `<div class="scheduled-empty scheduled-error">${t('app.ui_blad_prefix')}: ${escapeHtml(msg)}</div>`
    if (loadMoreBtn) loadMoreBtn.style.display = 'none'
  }
}

async function loadVoiceTopChannels() {
  const list = document.getElementById('voice-top-channels-list')
  if (!list) return
  list.innerHTML = `<div class="scheduled-empty">${t('app.ui_ladowanie')}</div>`

  try {
    const { startDate, endDate } = statsTabDates.voice
    const params = new URLSearchParams({ startDate, endDate, limit: '5' })
    const res = await fetch(`/api/stats/voice/top-channels?${params}`)
    const payload = await parseApiResponse(res)
    if (!res.ok) throw new Error(payload.error ?? t('app.ui_blad_kropka'))
    const channels = Array.isArray(payload.topChannels) ? payload.topChannels : []
    renderTopChannelsList(list, channels, 'voiceMinutes', 'min')
    renderDoughnutChart('voice-channels-doughnut', 'voice', channels, 'voiceMinutes')
  } catch (error) {
    const msg = error instanceof Error ? error.message : t('app.ui_blad')
    list.innerHTML = `<div class="scheduled-empty scheduled-error">${t('app.ui_blad_prefix')}: ${escapeHtml(msg)}</div>`
  }
}

// ── Shared rendering helpers ─────────────────────────────────────────────────

function renderTopUsersList(listEl, users, primaryKey, secondaryKey, startIndex) {
  const baseIndex = typeof startIndex === 'number' ? startIndex : 0
  if (users.length === 0 && baseIndex === 0) {
    listEl.innerHTML = '<div class="scheduled-empty">Brak danych dla wybranego okresu.</div>'
    return
  }

  if (baseIndex === 0) listEl.innerHTML = ''

  listEl.insertAdjacentHTML('beforeend', users.map((user, i) => {
    const pos = baseIndex + i + 1
    const displayName = typeof user.displayName === 'string' && user.displayName.trim().length > 0
      ? user.displayName.trim()
      : t('app.ui_uzytkownik_id', { p1: user.userId })
    const avatarUrl = typeof user.avatarUrl === 'string' && user.avatarUrl.trim().length > 0 ? user.avatarUrl.trim() : null
    const fallback = escapeHtml(displayName.slice(0, 1).toUpperCase() || '?')

    const primaryVal = Number.isFinite(Number(user[primaryKey])) ? Number(user[primaryKey]).toLocaleString('pl-PL') : '0'
    const primaryChipClass = primaryKey === 'voiceMinutes' ? 'leaderboard-chip-voice' : 'leaderboard-chip-messages'
    const primaryEmoji = primaryKey === 'voiceMinutes' ? '🎙️' : '💬'
    const primaryUnit = primaryKey === 'voiceMinutes' ? ' min' : ' wiad.'
    const primaryChip = `<span class="scheduled-chip ${primaryChipClass}">${primaryEmoji} ${escapeHtml(primaryVal)}${primaryUnit}</span>`

    let secondaryChip = ''
    if (secondaryKey && user[secondaryKey] !== undefined) {
      const secondaryVal = Number.isFinite(Number(user[secondaryKey])) ? Number(user[secondaryKey]).toLocaleString('pl-PL') : '0'
      const secondaryChipClass = secondaryKey === 'voiceMinutes' ? 'leaderboard-chip-voice' : 'leaderboard-chip-messages'
      const secondaryEmoji = secondaryKey === 'voiceMinutes' ? '🎙️' : '💬'
      const secondaryUnit = secondaryKey === 'voiceMinutes' ? ' min' : ' wiad.'
      secondaryChip = `<span class="scheduled-chip ${secondaryChipClass}">${secondaryEmoji} ${escapeHtml(secondaryVal)}${secondaryUnit}</span>`
    }

    return `
      <article class="scheduled-card">
        <div class="scheduled-card-header">
          <div class="leaderboard-user-main">
            ${avatarUrl
              ? `<img class="leaderboard-avatar" src="${escapeHtml(avatarUrl)}" alt="Avatar" loading="lazy">`
              : `<span class="leaderboard-avatar leaderboard-avatar-placeholder">${fallback}</span>`}
            <span class="scheduled-card-title">#${pos} | ${escapeHtml(displayName)}</span>
          </div>
          ${primaryChip}
        </div>
        ${secondaryChip ? `<div class="scheduled-card-meta">${secondaryChip}</div>` : ''}
      </article>`
  }).join(''))
}

function renderTopChannelsList(listEl, channels, valueKey, unitLabel) {
  if (channels.length === 0) {
    listEl.innerHTML = '<div class="scheduled-empty">Brak danych dla wybranego okresu.</div>'
    return
  }

  const chipClass = valueKey === 'voiceMinutes' ? 'leaderboard-chip-voice' : 'leaderboard-chip-messages'
  const chipEmoji = valueKey === 'voiceMinutes' ? '🎙️' : '💬'

  listEl.innerHTML = channels.map((ch, i) => {
    const name = typeof ch.channelName === 'string' && ch.channelName.trim().length > 0 ? ch.channelName : `#${ch.channelId}`
    const val = Number.isFinite(Number(ch[valueKey])) ? Number(ch[valueKey]).toLocaleString('pl-PL') : '0'
    const unit = unitLabel ?? ''
    return `
      <article class="scheduled-card">
        <div class="scheduled-card-header">
          <span class="scheduled-card-title">#${i + 1} | ${escapeHtml(name)}</span>
          <span class="scheduled-chip ${chipClass}">${chipEmoji} ${escapeHtml(val)} ${escapeHtml(unit)}</span>
        </div>
      </article>`
  }).join('')
}

function renderDoughnutChart(canvasId, chartType, channels, valueKey) {
  const canvas = document.getElementById(canvasId)
  if (!(canvas instanceof HTMLCanvasElement) || typeof Chart === 'undefined') return

  if (chartType === 'messages') {
    if (messagesDonutInstance) { messagesDonutInstance.destroy(); messagesDonutInstance = null }
  } else {
    if (voiceDonutInstance) { voiceDonutInstance.destroy(); voiceDonutInstance = null }
  }

  if (channels.length === 0) return

  const top5 = channels.slice(0, 5)
  const rest = channels.slice(5)
  const labels = top5.map((ch) => {
    const name = typeof ch.channelName === 'string' && ch.channelName.trim().length > 0 ? ch.channelName : `#${ch.channelId}`
    return name.length > 20 ? name.slice(0, 18) + '…' : name
  })
  const values = top5.map((ch) => Number(ch[valueKey]) || 0)

  if (rest.length > 0) {
    labels.push('Inne')
    values.push(rest.reduce((sum, ch) => sum + (Number(ch[valueKey]) || 0), 0))
  }

  const chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: STATS_DOUGHNUT_COLORS.slice(0, labels.length),
        borderColor: 'rgba(0,0,0,0.2)',
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#e0e0e0', boxWidth: 14, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${ctx.parsed.toLocaleString('pl-PL')}`,
          },
        },
      },
    },
  })

  if (chartType === 'messages') messagesDonutInstance = chart
  else voiceDonutInstance = chart
}

// ── Settings tab ─────────────────────────────────────────────────────────────

async function loadStatsExcludedChannels() {
  const container = document.getElementById('stats-excluded-channels-list')
  if (!container) return

  try {
    const [channelsRes, configRes] = await Promise.all([
      fetch('/api/channels'),
      fetch('/api/stats/server/config'),
    ])
    const channelsPayload = await parseApiResponse(channelsRes)
    const configPayload = await parseApiResponse(configRes)

    statsAllChannels = Array.isArray(channelsPayload.channels) ? channelsPayload.channels : []
    statsExcludedChannelIds = Array.isArray(configPayload.excludedChannelIds) ? configPayload.excludedChannelIds : []

    renderStatsChannelChecklist(container)
  } catch (error) {
    const msg = error instanceof Error ? error.message : t('app.nieznany_blad_14')
    container.innerHTML = `<div class="scheduled-empty scheduled-error">${t('app.ui_blad_ladowania_kanalow')}: ${escapeHtml(msg)}</div>`
  }
}

function renderStatsChannelChecklist(container) {
  if (statsAllChannels.length === 0) {
    container.innerHTML = `<div class="scheduled-empty">${t('app.ui_brak_kanalow_tekstowych')}</div>`
    return
  }

  container.innerHTML = statsAllChannels.map((ch) => {
    const id = String(ch.id ?? '')
    const name = String(ch.name ?? id)
    const checked = statsExcludedChannelIds.includes(id) ? 'checked' : ''
    return `
      <label class="stats-channel-item">
        <input type="checkbox" class="stats-channel-checkbox" value="${escapeHtml(id)}" ${checked}>
        <span class="stats-channel-name">#${escapeHtml(name)}</span>
      </label>`
  }).join('')
}

async function saveStatsExcludedChannels() {
  const statusEl = document.getElementById('stats-save-status')
  const checkboxes = document.querySelectorAll('.stats-channel-checkbox:checked')
  const selectedIds = Array.from(checkboxes).map((cb) => cb.value)

  try {
    const response = await fetchWithCsrf('/api/stats/server/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ excludedChannelIds: selectedIds }),
    })
    const payload = await parseApiResponse(response)

    if (!response.ok) {
      throw new Error(payload.error ?? t('app.nie_udalo_sie_zapisac_ustawien'))
    }

    statsExcludedChannelIds = selectedIds
    if (statusEl) {
      statusEl.textContent = '✓ Zapisano'
      statusEl.className = 'stats-save-status stats-save-ok'
      setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'stats-save-status' }, 3000)
    }
    showToast('✅ Ustawienia statystyk zapisane.', 'success')
  } catch (error) {
    const msg = error instanceof Error ? error.message : t('app.nieznany_blad_15')
    if (statusEl) {
      statusEl.textContent = t('app.bad')
      statusEl.className = 'stats-save-status stats-save-error'
      setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'stats-save-status' }, 3000)
    }
    showToast(`❌ ${msg}`, 'error')
  }
}

// ═══════════════════════════════════════════════════════
//  SHOP SECTION
// ═══════════════════════════════════════════════════════

async function initShopSection() {
  if (!shopSectionBound) {
    shopSectionBound = true
    bindShopSectionListeners()
  }

  renderShopItems()
  renderShopOrders()
  await loadShopItems({ silent: true })
}

function bindShopSectionListeners() {
  // Tab switching
  document.querySelectorAll('[data-shop-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.shopTab
      if (!tab || tab === shopActiveTab) return
      shopActiveTab = tab
      document.querySelectorAll('[data-shop-tab]').forEach((b) => b.classList.toggle('active', b.dataset.shopTab === tab))
      document.querySelectorAll('#shop-tab-items, #shop-tab-orders').forEach((p) => {
        p.classList.toggle('active', p.id === `shop-tab-${tab}`)
      })
      if (tab === 'orders') void loadShopOrders({ silent: false })
    })
  })

  // Items tab
  document.getElementById('shop-add-item-btn')?.addEventListener('click', () => openShopItemForm(null))
  document.getElementById('shop-items-refresh-btn')?.addEventListener('click', () => void loadShopItems({ silent: false }))
  document.getElementById('shop-items-include-inactive')?.addEventListener('change', (e) => {
    shopItemsIncludeInactive = e.target.checked
    shopItemsPage = 1
    void loadShopItems({ silent: false })
  })
  document.getElementById('shop-items-prev-btn')?.addEventListener('click', () => {
    if (shopItemsPage <= 1) return
    void loadShopItems({ page: shopItemsPage - 1, silent: true })
  })
  document.getElementById('shop-items-next-btn')?.addEventListener('click', () => {
    if (shopItemsPage >= shopItemsTotalPages) return
    void loadShopItems({ page: shopItemsPage + 1, silent: true })
  })

  // Item form
  document.getElementById('shop-form-cancel-btn')?.addEventListener('click', () => closeShopItemForm())
  document.getElementById('shop-form-submit-btn')?.addEventListener('click', () => void submitShopItemForm())

  // Orders tab
  document.getElementById('shop-orders-refresh-btn')?.addEventListener('click', () => void loadShopOrders({ silent: false }))
  document.getElementById('shop-orders-status-filter')?.addEventListener('change', (e) => {
    shopOrdersStatusFilter = String(e.target.value ?? 'all')
    shopOrdersPage = 1
    void loadShopOrders({ silent: true })
  })
  document.getElementById('shop-orders-user-filter')?.addEventListener('input', (e) => {
    const val = String(e.target.value ?? '').trim()
    shopOrdersUserFilter = /^\d{17,20}$/.test(val) ? val : ''
    shopOrdersPage = 1
    clearTimeout(shopOrdersUserFilterDebounceId)
    shopOrdersUserFilterDebounceId = setTimeout(() => void loadShopOrders({ silent: true }), 400)
  })
  document.getElementById('shop-orders-prev-btn')?.addEventListener('click', () => {
    if (shopOrdersPage <= 1) return
    void loadShopOrders({ page: shopOrdersPage - 1, silent: true })
  })
  document.getElementById('shop-orders-next-btn')?.addEventListener('click', () => {
    if (shopOrdersPage >= shopOrdersTotalPages) return
    void loadShopOrders({ page: shopOrdersPage + 1, silent: true })
  })

  // Dev-only: show clear-history toolbar
  const shopOrdersDevToolbar = document.getElementById('shop-orders-dev-toolbar')
  if (shopOrdersDevToolbar && currentDashboardRole === 'owner') {
    shopOrdersDevToolbar.hidden = false
  }
  document.getElementById('shop-orders-clear-btn')?.addEventListener('click', () => void clearAllShopOrders())

  // Event delegation for dynamically rendered item buttons
  document.getElementById('shop-items-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    const itemId = Number(btn.dataset.itemId)
    if (action === 'edit-item') openShopItemForm(itemId)
    else if (action === 'delete-item') void deleteShopItem(itemId, btn.dataset.itemName ?? '')
  })

  // Event delegation for dynamically rendered order buttons
  document.getElementById('shop-orders-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    if (action === 'copy-userid') {
      void navigator.clipboard?.writeText(btn.dataset.userid ?? '')
      showToast('UserID skopiowany do schowka.', 'success')
      return
    }
    const orderId = Number(btn.dataset.orderId)
    if (action === 'toggle-order') toggleShopOrderExpand(orderId)
    else if (action === 'complete-order') void completeShopOrder(orderId)
    else if (action === 'cancel-order') void confirmCancelOrder(orderId)
  })
}

async function loadShopItems({ page = shopItemsPage, silent = false } = {}) {
  const requestId = ++shopItemsLoadRequestId
  if (!silent) {
    const list = document.getElementById('shop-items-list')
    if (list) list.innerHTML = `<div class="scheduled-empty">${t('app.ui_ladowanie')}</div>`
  }

  try {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '20',
      includeInactive: String(shopItemsIncludeInactive),
    })
    const response = await fetch(`/api/shop/items?${params}`)
    if (requestId !== shopItemsLoadRequestId) return

    const payload = await parseApiResponse(response)
    if (!response.ok) {
      showToast(payload.error ?? t('app.nie_udao_sie_pobrac_przedmiotow'), 'error')
      return
    }

    const data = payload.data
    shopItems = data.items ?? []
    shopItemsPage = data.page ?? 1
    shopItemsTotalPages = data.totalPages ?? 1
    shopItemsTotalItems = data.total ?? 0
    renderShopItems()
  } catch {
    if (requestId !== shopItemsLoadRequestId) return
    showToast(t('app.bad_sieci_podczas_pobierania_przedmiotow'), 'error')
  }
}

function renderShopItems() {
  const list = document.getElementById('shop-items-list')
  const countLabel = document.getElementById('shop-items-count-label')
  const pageLabel = document.getElementById('shop-items-page-label')
  const pagination = document.getElementById('shop-items-pagination')
  const prevBtn = document.getElementById('shop-items-prev-btn')
  const nextBtn = document.getElementById('shop-items-next-btn')

  if (!list) return

  if (countLabel) countLabel.textContent = `Przedmioty: ${shopItemsTotalItems}`
  if (pageLabel) pageLabel.textContent = `Strona ${shopItemsPage}/${shopItemsTotalPages}`
  if (pagination) pagination.hidden = shopItemsTotalPages <= 1
  if (prevBtn instanceof HTMLButtonElement) prevBtn.disabled = shopItemsPage <= 1
  if (nextBtn instanceof HTMLButtonElement) nextBtn.disabled = shopItemsPage >= shopItemsTotalPages

  if (shopItems.length === 0) {
    list.innerHTML = `<div class="scheduled-empty">${t('app.ui_brak_przedmiotow')}</div>`
    return
  }

  list.innerHTML = shopItems.map((item) => {
    const statusChip = item.isActive
      ? '<span class="scheduled-chip" style="background:#43b581;color:#fff;">Aktywny</span>'
      : '<span class="scheduled-chip" style="background:#72767d;color:#fff;">Nieaktywny</span>'
    const stockValue = item.stock === 0 ? 'Nieograniczona' : String(item.stock)
    const stockColor = !item.isActive ? '#72767d' : item.stock === 0 ? '#43b581' : item.stock < 5 ? '#faa61a' : '#43b581'
    const stockChip = `<span class="scheduled-chip" style="border-color:${stockColor}40;color:${stockColor};">${t('app.ui_ilosc')}: ${escapeHtml(stockValue)}</span>`
    const maxPerUserText = item.maxPerUser === 0 ? t('app.brak_limitu') : `Max ${item.maxPerUser}/user`
    return `
      <article class="scheduled-card" data-item-id="${item.id}">
        <div class="scheduled-card-header">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;">
            <span class="scheduled-chip" style="font-size:11px;color:var(--text-muted);flex-shrink:0;">#${item.id}</span>
            <span class="scheduled-card-title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.name)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            ${statusChip}
            <button class="btn-secondary" style="padding:2px 10px;font-size:12px;" data-action="edit-item" data-item-id="${item.id}">✏️ Edytuj</button>
            <button class="btn-danger" style="padding:2px 10px;font-size:12px;" data-action="delete-item" data-item-id="${item.id}" data-item-name="${escapeHtml(item.name)}">${t('app.ui_usun_ikona')}</button>
          </div>
        </div>
        <div class="scheduled-card-meta">
          <span class="scheduled-chip leaderboard-chip-coins">💰 ${item.price} 🧅</span>
          ${stockChip}
          <span class="scheduled-chip">${escapeHtml(maxPerUserText)}</span>
        </div>
        ${item.description ? `<div style="font-size:13px;color:var(--text-secondary);line-height:1.4;">${escapeHtml(item.description)}</div>` : ''}
      </article>`
  }).join('')
}

function openShopItemForm(itemId) {
  shopEditingItemId = itemId
  const formCard = document.getElementById('shop-item-form-card')
  const title = document.getElementById('shop-form-title')
  const statusEl = document.getElementById('shop-form-status')

  if (!formCard) return

  if (itemId === null) {
    if (title) title.textContent = '➕ Dodaj przedmiot'
    document.getElementById('shop-form-name').value = ''
    document.getElementById('shop-form-description').value = ''
    document.getElementById('shop-form-price').value = ''
    document.getElementById('shop-form-stock').value = ''
    document.getElementById('shop-form-max-per-user').value = '0'
    document.getElementById('shop-form-is-active').checked = true
  } else {
    const item = shopItems.find((i) => i.id === itemId)
    if (!item) return
    if (title) title.textContent = `✏️ Edytuj przedmiot #${item.id}`
    document.getElementById('shop-form-name').value = item.name
    document.getElementById('shop-form-description').value = item.description
    document.getElementById('shop-form-price').value = String(item.price)
    document.getElementById('shop-form-stock').value = String(item.stock)
    document.getElementById('shop-form-max-per-user').value = String(item.maxPerUser)
    document.getElementById('shop-form-is-active').checked = item.isActive
  }

  if (statusEl) statusEl.textContent = ''
  formCard.style.display = ''
  formCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function closeShopItemForm() {
  shopEditingItemId = null
  const formCard = document.getElementById('shop-item-form-card')
  if (formCard) formCard.style.display = 'none'
}

async function submitShopItemForm() {
  const nameEl = document.getElementById('shop-form-name')
  const descEl = document.getElementById('shop-form-description')
  const priceEl = document.getElementById('shop-form-price')
  const stockEl = document.getElementById('shop-form-stock')
  const maxPerUserEl = document.getElementById('shop-form-max-per-user')
  const isActiveEl = document.getElementById('shop-form-is-active')
  const statusEl = document.getElementById('shop-form-status')
  const submitBtn = document.getElementById('shop-form-submit-btn')

  const name = String(nameEl?.value ?? '').trim()
  const description = String(descEl?.value ?? '').trim()
  const price = Number.parseInt(String(priceEl?.value ?? ''), 10)
  const stock = Number.parseInt(String(stockEl?.value ?? ''), 10)
  const maxPerUser = Number.parseInt(String(maxPerUserEl?.value ?? '0'), 10)
  const isActive = Boolean(isActiveEl?.checked)

  if (!name || name.length < 1) {
    if (statusEl) statusEl.textContent = t('app.podaj_nazwe_przedmiotu')
    return
  }
  if (!Number.isFinite(price) || price < 1) {
    if (statusEl) statusEl.textContent = t('app.podaj_prawidowa_cene_min_1')
    return
  }
  if (!Number.isFinite(stock) || stock < 0) {
    if (statusEl) statusEl.textContent = t('app.podaj_prawidowa_ilosc_min_0')
    return
  }
  if (!Number.isFinite(maxPerUser) || maxPerUser < 0) {
    if (statusEl) statusEl.textContent = t('app.podaj_prawidowy_limit_na_uzytkownika_min')
    return
  }

  if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = true
  if (statusEl) statusEl.textContent = 'Zapisywanie...'

  const body = { name, description, price, stock, maxPerUser, isActive }
  const isEditing = shopEditingItemId !== null

  try {
    const response = await fetchWithCsrf(
      isEditing ? `/api/shop/items/${shopEditingItemId}` : '/api/shop/items',
      { method: isEditing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    )
    const payload = await parseApiResponse(response)

    if (!response.ok) {
      if (statusEl) statusEl.textContent = `⚠ ${payload.error ?? t('app.bad_serwera')}`
      showToast(payload.error ?? t('app.nie_udao_sie_zapisac_przedmiotu'), 'error')
      return
    }

    showToast(isEditing ? '✅ Przedmiot zaktualizowany.' : '✅ Przedmiot dodany.', 'success')
    closeShopItemForm()
    void loadShopItems({ page: isEditing ? shopItemsPage : 1, silent: true })
  } catch {
    if (statusEl) statusEl.textContent = t('app.bad_sieci')
    showToast(t('app.bad_sieci_podczas_zapisywania_przedmiotu'), 'error')
  } finally {
    if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false
  }
}

async function deleteShopItem(itemId, itemName) {
  if (!confirm(t('app.ui_usun_przedmiot', { p1: itemName }))) return

  try {
    const response = await fetchWithCsrf(`/api/shop/items/${itemId}`, { method: 'DELETE' })
    const payload = await parseApiResponse(response)

    if (response.status === 409) {
      showToast(t('app.nie_mozna_usunac_przedmiot_ma_aktywne'), 'error')
      return
    }

    if (!response.ok) {
      showToast(payload.error ?? t('app.nie_udao_sie_usunac_przedmiotu'), 'error')
      return
    }

    showToast(t('app.przedmiot_usuniety'), 'success')
    void loadShopItems({ silent: true })
  } catch {
    showToast(t('app.bad_sieci_podczas_usuwania_przedmiotu'), 'error')
  }
}

async function loadShopOrders({ page = shopOrdersPage, silent = false } = {}) {
  const requestId = ++shopOrdersLoadRequestId
  if (!silent) {
    const list = document.getElementById('shop-orders-list')
    if (list) list.innerHTML = `<div class="scheduled-empty">${t('app.ui_ladowanie')}</div>`
  }

  try {
    const params = new URLSearchParams({ page: String(page), pageSize: '20', status: shopOrdersStatusFilter })
    if (shopOrdersUserFilter) params.set('userId', shopOrdersUserFilter)

    const response = await fetch(`/api/shop/orders?${params}`)
    if (requestId !== shopOrdersLoadRequestId) return

    const payload = await parseApiResponse(response)
    if (!response.ok) {
      showToast(payload.error ?? t('app.nie_udao_sie_pobrac_zamowien'), 'error')
      return
    }

    const data = payload.data
    shopOrders = data.orders ?? []
    shopOrdersPage = data.page ?? 1
    shopOrdersTotalPages = data.totalPages ?? 1
    shopOrdersTotalItems = data.total ?? 0

    const unknownIds = [...new Set(shopOrders.map((o) => o.userId))].filter((id) => !shopMemberProfiles.has(id))
    if (unknownIds.length > 0) {
      try {
        const profRes = await fetch(`/api/members/by-ids?ids=${unknownIds.join(',')}`)
        if (requestId !== shopOrdersLoadRequestId) return
        const profPayload = await profRes.json()
        for (const m of profPayload.members ?? []) {
          shopMemberProfiles.set(m.id, { displayName: m.displayName, avatarUrl: m.avatarUrl ?? null })
        }
      } catch { /* profiles are optional — fall back to ID display */ }
    }

    if (requestId !== shopOrdersLoadRequestId) return
    renderShopOrders()
  } catch {
    if (requestId !== shopOrdersLoadRequestId) return
    showToast(t('app.bad_sieci_podczas_pobierania_zamowien'), 'error')
  }
}

function renderShopOrders() {
  const list = document.getElementById('shop-orders-list')
  const countLabel = document.getElementById('shop-orders-count-label')
  const pageLabel = document.getElementById('shop-orders-page-label')
  const pagination = document.getElementById('shop-orders-pagination')
  const prevBtn = document.getElementById('shop-orders-prev-btn')
  const nextBtn = document.getElementById('shop-orders-next-btn')

  if (!list) return

  if (countLabel) countLabel.textContent = t('app.ui_zamowienia_licznik', { p1: shopOrdersTotalItems })
  if (pageLabel) pageLabel.textContent = `Strona ${shopOrdersPage}/${shopOrdersTotalPages}`
  if (pagination) pagination.hidden = shopOrdersTotalPages <= 1
  if (prevBtn instanceof HTMLButtonElement) prevBtn.disabled = shopOrdersPage <= 1
  if (nextBtn instanceof HTMLButtonElement) nextBtn.disabled = shopOrdersPage >= shopOrdersTotalPages

  if (shopOrders.length === 0) {
    list.innerHTML = `<div class="scheduled-empty">${t('app.ui_brak_zamowien')}</div>`
    return
  }

  list.innerHTML = shopOrders.map((order) => {
    const statusChip = shopOrderStatusChip(order.status)
    const dateStr = formatTimestampInWarsaw(order.createdAt)
    const isExpanded = shopExpandedOrderId === order.id

    const cancelForm = isExpanded && order.status === 'pending'
      ? `<div style="margin-top:10px;">
          <label style="display:block;font-size:12px;color:var(--text-secondary);margin-bottom:4px;">${t('app.ui_powod_anulowania')}</label>
          <div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;">
            <input type="text" class="form-input" id="shop-cancel-reason-${order.id}" maxlength="500" placeholder="${t('app.ui_placeholder_powod')}" style="flex:1;min-width:180px;">
            <button class="btn-danger" data-action="cancel-order" data-order-id="${order.id}">${t('app.ui_anuluj_zamowienie')}</button>
          </div>
         </div>`
      : ''

    const profile = shopMemberProfiles.get(String(order.userId))
    const avatarHtml = profile?.avatarUrl
      ? `<img class="leaderboard-avatar" src="${escapeHtml(profile.avatarUrl)}" alt="" loading="lazy">`
      : `<span class="leaderboard-avatar leaderboard-avatar-placeholder">${escapeHtml(((profile?.displayName ?? String(order.userId))[0] ?? '?').toUpperCase())}</span>`
    const userHtml = `<div class="leaderboard-user-main" style="gap:8px;">
      ${avatarHtml}
      <div>
        <div style="font-weight:600;font-size:13px;color:var(--text-primary);">${escapeHtml(profile?.displayName ?? String(order.userId))}</div>
        <div style="font-size:11px;color:var(--text-muted);cursor:pointer;" title="${t('app.ui_kliknij_kopiuj_userid')}" data-action="copy-userid" data-userid="${escapeHtml(String(order.userId))}">${escapeHtml(String(order.userId))}</div>
      </div>
    </div>`

    return `
      <article class="scheduled-card" id="shop-order-card-${order.id}">
        <div class="scheduled-card-header">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;">
            <span class="scheduled-card-title">${t('app.ui_zamowienie')} #${order.id}</span>
            ${statusChip}
          </div>
          <button class="btn-secondary" style="padding:2px 10px;font-size:12px;flex-shrink:0;" data-action="toggle-order" data-order-id="${order.id}">${isExpanded ? t('app.zwin') : t('app.rozwin')}</button>
        </div>
        <div class="scheduled-card-meta" style="align-items:center;">
          ${userHtml}
          <span class="scheduled-chip leaderboard-chip-coins">🛍 ${escapeHtml(order.itemNameSnapshot)} · ${order.itemPriceSnapshot} 🧅</span>
          <span class="scheduled-chip">📅 ${escapeHtml(dateStr)}</span>
        </div>
        ${isExpanded && order.status === 'pending' ? `<div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-primary" data-action="complete-order" data-order-id="${order.id}">${t('app.ui_zrealizuj_zamowienie')}</button>
        </div>` : ''}
        ${cancelForm}
      </article>`
  }).join('')
}

function shopOrderStatusChip(status) {
  if (status === 'pending') return `<span class="scheduled-chip" style="background:#faa61a;color:#000;">${t('app.ui_zlozone')}</span>`
  if (status === 'completed') return '<span class="scheduled-chip" style="background:#43b581;color:#fff;">Zrealizowane</span>'
  if (status === 'cancelled') return '<span class="scheduled-chip" style="background:#ed4245;color:#fff;">Anulowane</span>'
  return `<span class="scheduled-chip">${escapeHtml(status)}</span>`
}

function toggleShopOrderExpand(orderId) {
  shopExpandedOrderId = shopExpandedOrderId === orderId ? null : orderId
  renderShopOrders()
}

async function completeShopOrder(orderId) {
  if (!confirm(t('app.ui_potwierdz_realizacje', { p1: orderId }))) return

  try {
    const response = await fetchWithCsrf(`/api/shop/orders/${orderId}/complete`, { method: 'POST' })
    const payload = await parseApiResponse(response)

    if (!response.ok) {
      showToast(payload.error ?? t('app.nie_udao_sie_zrealizowac_zamowienia'), 'error')
      return
    }

    showToast(t('app.ui_zamowienie_zrealizowane', { p1: orderId }), 'success')
    shopExpandedOrderId = null
    void loadShopOrders({ silent: true })
  } catch {
    showToast(t('app.bad_sieci_podczas_realizacji_zamowienia'), 'error')
  }
}

async function clearAllShopOrders() {
  if (!confirm(t('app.czy_na_pewno_chcesz_usunac_caa'))) return
  if (!confirm(t('app.ostatnie_ostrzezenie_wszystkie_zamowienia_zostana_trwale'))) return

  try {
    const response = await fetchWithCsrf('/api/shop/orders/all', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE_ALL_ORDERS' }),
    })
    const payload = await parseApiResponse(response)

    if (!response.ok) {
      showToast(payload.error ?? t('app.nie_udao_sie_usunac_historii_zamowien'), 'error')
      return
    }

    showToast(t('app.ui_usunieto_zamowien', { p1: payload.data?.deletedCount ?? 0 }), 'success')
    shopOrdersPage = 1
    void loadShopOrders({ silent: false })
  } catch {
    showToast(t('app.bad_sieci_podczas_usuwania_historii_zamowien'), 'error')
  }
}

async function confirmCancelOrder(orderId) {
  const reasonEl = document.getElementById(`shop-cancel-reason-${orderId}`)
  const reason = String(reasonEl?.value ?? '').trim()
  if (!reason) {
    showToast(t('app.podaj_powod_anulowania'), 'error')
    reasonEl?.focus()
    return
  }

  if (!confirm(t('app.ui_potwierdz_anulowanie', { p1: orderId }))) return

  try {
    const response = await fetchWithCsrf(`/api/shop/orders/${orderId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    const payload = await parseApiResponse(response)

    if (!response.ok) {
      showToast(payload.error ?? t('app.nie_udao_sie_anulowac_zamowienia'), 'error')
      return
    }

    const refunded = payload.data?.refunded ?? false
    showToast(t('app.ui_zamowienie_anulowane', { p1: orderId }) + (refunded ? t('app.coins_zwrocone') : ''), 'success')
    shopExpandedOrderId = null
    void loadShopOrders({ silent: true })
  } catch {
    showToast(t('app.bad_sieci_podczas_anulowania_zamowienia'), 'error')
  }
}
