const MATCH_CREATOR_MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const MATCH_CREATOR_ALLOWED_UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif'])
const MATCH_CREATOR_ALLOWED_UPLOAD_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif'])
const MATCH_CREATOR_UPLOAD_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
}
const MATCH_COLOR_MAP = {
  czerwony: '#dc143c',
  biały: '#f5f5f5',
  szary: '#99aab5',
  złoty: '#ffd700',
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

let creatorChannels = []
let creatorRoles = []
let creatorImages = []
let creatorEmojis = []
let creatorMentionChannelResults = []
let creatorMentionRoleResults = []
let creatorMentionUserResults = []
const creatorKnownUsers = new Map()
let creatorSelectedMatchId = ''
let creatorSelectedImageName = null
let creatorSelectedUploadFile = null
let creatorSelectedUploadPreviewUrl = null
let creatorStoredUpload = null
let editingMatchAnnouncementId = null
let creatorCurrentMode = 'embedded'
let creatorSelectedColor = 'czerwony'
let creatorActiveEditorId = 'match-description'

let matchAnnouncements = []
let matchSearchDebounceId = null
let g2FilterDebounceId = null
let creatorMentionChannelSearchDebounceId = null
let creatorMentionRoleSearchDebounceId = null
let creatorMentionUserSearchDebounceId = null
let creatorMentionChannelSearchRequestId = 0
let creatorMentionRoleSearchRequestId = 0
let creatorMentionUserSearchRequestId = 0
let g2LoadRequestId = 0
let announcementsLoadRequestId = 0
let sectionHookBound = false
let creatorBound = false
let g2SectionBound = false
let announcementsBound = false

let previousSectionHook = null

document.addEventListener('DOMContentLoaded', async () => {
  await initializeMatchesDashboardModule()
})

async function initializeMatchesDashboardModule() {
  wireSectionHook()
  bindG2MatchesSection()
  bindCreatorSection()
  bindMatchAnnouncementsSection()

  await Promise.all([
    loadG2Matches({ silent: true }),
    loadCreatorResources(),
    loadMatchAnnouncements({ silent: true }),
  ])

  renderCreatorEmojiList('')
  renderCreatorMentionChannelResults([], '')
  renderCreatorMentionRoleResults([], '')
  renderCreatorMentionUserResults([], '')
  renderCreatorMatchOptions()
  updateCreatorModeUI()
  renderCreatorPreview()
  updateCreatorImagePanels()
  updateMatchSendButton()
}

function wireSectionHook() {
  if (sectionHookBound) {
    return
  }

  sectionHookBound = true
  previousSectionHook = window.onDashboardSectionChanged

  window.onDashboardSectionChanged = (section) => {
    if (typeof previousSectionHook === 'function') {
      previousSectionHook(section)
    }

    if (section === 'g2-matches') {
      void loadG2Matches({ silent: true })
    }

    if (section === 'match-announcement-creator') {
      void loadG2Matches({ silent: true })
      void loadCreatorResources()
      updateCreatorModeUI()
      updateCreatorImagePanels()
      renderCreatorPreview()
    }

    if (section === 'match-announcements') {
      void loadMatchAnnouncements({ silent: true })
    }
  }
}

function bindG2MatchesSection() {
  if (g2SectionBound) {
    return
  }

  g2SectionBound = true

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

function bindCreatorSection() {
  if (creatorBound) {
    return
  }

  creatorBound = true

  const modeTabs = document.getElementById('match-mode-tabs')
  const toolbar = document.getElementById('match-format-toolbar')
  const emojiToggle = document.getElementById('match-emoji-popover-toggle')
  const mentionToggle = document.getElementById('match-mention-popover-toggle')
  const emojiPopover = document.getElementById('match-emoji-popover')
  const mentionPopover = document.getElementById('match-mention-popover')
  const emojiSearchInput = document.getElementById('match-emoji-search-input')
  const mentionQuickList = document.getElementById('match-mention-quick-list')
  const mentionChannelResults = document.getElementById('match-mention-channel-results')
  const mentionRoleResults = document.getElementById('match-mention-role-results')
  const mentionUserResults = document.getElementById('match-mention-user-results')
  const mentionChannelSearch = document.getElementById('match-mention-channel-search')
  const mentionRoleSearch = document.getElementById('match-mention-role-search')
  const mentionUserSearch = document.getElementById('match-mention-user-search')

  const matchSearchInput = document.getElementById('match-search-input')
  const matchSelect = document.getElementById('match-select')
  const titleInput = document.getElementById('match-title')
  const descriptionInput = document.getElementById('match-description')
  const channelSelect = document.getElementById('match-channel-select')
  const scheduleInput = document.getElementById('match-schedule-at')
  const pingToggle = document.getElementById('match-ping-enabled')
  const pingSelect = document.getElementById('match-ping-select')
  const imageModeSelect = document.getElementById('match-image-mode')
  const imageUploadInput = document.getElementById('match-image-upload-input')
  const sendButton = document.getElementById('match-send-btn')

  modeTabs?.addEventListener('click', (event) => {
    const button = event.target.closest('.match-mode-tab')
    if (!button) {
      return
    }

    const nextMode = button.dataset.mode
    if (!nextMode || nextMode === creatorCurrentMode) {
      return
    }

    creatorCurrentMode = nextMode
    updateCreatorModeUI()

    const selectedMatch = getSelectedCreatorMatch()
    if (selectedMatch && descriptionInput && !descriptionInput.value.trim()) {
      descriptionInput.value = buildDefaultMatchContent(selectedMatch)
    }

    renderCreatorPreview()
    updateMatchSendButton()
  })

  toolbar?.addEventListener('click', (event) => {
    const button = event.target.closest('.toolbar-btn')
    if (!button) {
      return
    }

    if (button.id === 'match-emoji-popover-toggle') {
      event.stopPropagation()
      toggleCreatorPopover('match-emoji-popover')
      return
    }

    if (button.id === 'match-mention-popover-toggle') {
      event.stopPropagation()
      toggleCreatorPopover('match-mention-popover')
      return
    }

    const wrap = button.dataset.wrap
    const prefix = button.dataset.prefix

    if (wrap) {
      wrapCreatorSelection(wrap)
      return
    }

    if (prefix) {
      prefixCreatorSelectionLines(prefix)
    }
  })

  emojiPopover?.addEventListener('click', (event) => {
    event.stopPropagation()
    const button = event.target.closest('[data-token]')
    const token = button?.dataset.token
    if (!token) {
      return
    }

    insertCreatorToken(token)
    closeCreatorPopovers()
  })

  mentionPopover?.addEventListener('click', (event) => {
    event.stopPropagation()
    const button = event.target.closest('[data-token]')
    const token = button?.dataset.token
    if (!token) {
      return
    }

    insertCreatorToken(token)
    closeCreatorPopovers()
  })

  emojiToggle?.addEventListener('click', (event) => {
    event.stopPropagation()
    toggleCreatorPopover('match-emoji-popover')
  })

  mentionToggle?.addEventListener('click', (event) => {
    event.stopPropagation()
    toggleCreatorPopover('match-mention-popover')
  })

  emojiSearchInput?.addEventListener('input', () => {
    renderCreatorEmojiList(emojiSearchInput.value)
  })

  mentionQuickList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-token]')
    const token = button?.dataset.token
    if (!token) {
      return
    }

    insertCreatorToken(token)
    closeCreatorPopovers()
  })

  mentionChannelResults?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-token]')
    const token = button?.dataset.token
    if (!token) {
      return
    }

    insertCreatorToken(token)
    closeCreatorPopovers()
  })

  mentionRoleResults?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-token]')
    const token = button?.dataset.token
    if (!token) {
      return
    }

    insertCreatorToken(token)
    closeCreatorPopovers()
  })

  mentionUserResults?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-token]')
    const token = button?.dataset.token
    if (!token) {
      return
    }

    insertCreatorToken(token)
    closeCreatorPopovers()
  })

  mentionChannelSearch?.addEventListener('input', () => {
    const mentionPopoverElement = document.getElementById('match-mention-popover')
    if (mentionPopoverElement?.hidden) {
      mentionPopoverElement.hidden = false
    }

    if (creatorMentionChannelSearchDebounceId) {
      clearTimeout(creatorMentionChannelSearchDebounceId)
    }

    creatorMentionChannelSearchDebounceId = setTimeout(async () => {
      await searchCreatorMentionChannels(mentionChannelSearch.value)
    }, 220)
  })

  mentionRoleSearch?.addEventListener('input', () => {
    const mentionPopoverElement = document.getElementById('match-mention-popover')
    if (mentionPopoverElement?.hidden) {
      mentionPopoverElement.hidden = false
    }

    if (creatorMentionRoleSearchDebounceId) {
      clearTimeout(creatorMentionRoleSearchDebounceId)
    }

    creatorMentionRoleSearchDebounceId = setTimeout(async () => {
      await searchCreatorMentionRoles(mentionRoleSearch.value)
    }, 220)
  })

  mentionUserSearch?.addEventListener('input', () => {
    const mentionPopoverElement = document.getElementById('match-mention-popover')
    if (mentionPopoverElement?.hidden) {
      mentionPopoverElement.hidden = false
    }

    if (creatorMentionUserSearchDebounceId) {
      clearTimeout(creatorMentionUserSearchDebounceId)
    }

    creatorMentionUserSearchDebounceId = setTimeout(async () => {
      await searchCreatorMentionUsers(mentionUserSearch.value)
    }, 220)
  })

  document.addEventListener('click', () => {
    closeCreatorPopovers()
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeCreatorPopovers()
    }
  })

  matchSearchInput?.addEventListener('input', () => {
    if (matchSearchDebounceId) {
      clearTimeout(matchSearchDebounceId)
    }

    matchSearchDebounceId = setTimeout(() => {
      renderCreatorMatchOptions()
    }, 160)
  })

  matchSelect?.addEventListener('change', () => {
    creatorSelectedMatchId = matchSelect.value
    const selectedMatch = getSelectedCreatorMatch()

    if (selectedMatch) {
      if (titleInput) {
        titleInput.value = buildDefaultMatchTitle(selectedMatch)
      }

      if (descriptionInput) {
        descriptionInput.value = buildDefaultMatchContent(selectedMatch)
      }
    }

    renderCreatorPreview()
    updateMatchSendButton()
  })

  titleInput?.addEventListener('input', () => {
    creatorActiveEditorId = 'match-title'
    renderCreatorPreview()
    updateMatchSendButton()
  })

  titleInput?.addEventListener('focus', () => {
    creatorActiveEditorId = 'match-title'
  })

  descriptionInput?.addEventListener('input', () => {
    creatorActiveEditorId = 'match-description'
    renderCreatorPreview()
    updateMatchSendButton()
  })

  descriptionInput?.addEventListener('focus', () => {
    creatorActiveEditorId = 'match-description'
  })

  channelSelect?.addEventListener('change', updateMatchSendButton)
  scheduleInput?.addEventListener('change', updateMatchSendButton)

  pingToggle?.addEventListener('change', () => {
    pingSelect.disabled = !pingToggle.checked
    updateMatchSendButton()
  })

  pingSelect?.addEventListener('change', updateMatchSendButton)

  document.querySelectorAll('#match-color-swatches .color-swatch').forEach((swatch) => {
    swatch.addEventListener('click', () => {
      const nextColor = swatch.dataset.color
      if (!nextColor) {
        return
      }

      creatorSelectedColor = nextColor
      document.querySelectorAll('#match-color-swatches .color-swatch').forEach((element) => {
        element.classList.remove('active')
      })
      swatch.classList.add('active')
      renderCreatorPreview()
      updateMatchSendButton()
    })
  })

  imageModeSelect?.addEventListener('change', () => {
    updateCreatorImagePanels()
    renderCreatorPreview()
    updateMatchSendButton()
  })

  imageUploadInput?.addEventListener('change', () => {
    const files = imageUploadInput.files
    creatorSelectedUploadFile = files && files[0] ? files[0] : null
    creatorStoredUpload = null

    if (creatorSelectedUploadFile && !isAllowedCreatorUploadFile(creatorSelectedUploadFile)) {
      showToast('Dozwolone formaty pliku: JPEG, PNG, GIF.', 'error')
      imageUploadInput.value = ''
      creatorSelectedUploadFile = null
      clearCreatorUploadPreviewUrl()
    }

    if (creatorSelectedUploadFile && creatorSelectedUploadFile.size > MATCH_CREATOR_MAX_UPLOAD_BYTES) {
      showToast('Plik jest za duzy. Maksymalny rozmiar to 8 MB.', 'error')
      imageUploadInput.value = ''
      creatorSelectedUploadFile = null
      clearCreatorUploadPreviewUrl()
    }

    if (creatorSelectedUploadFile) {
      clearCreatorUploadPreviewUrl()
      creatorSelectedUploadPreviewUrl = URL.createObjectURL(creatorSelectedUploadFile)
    } else {
      clearCreatorUploadPreviewUrl()
    }

    const fileName = document.getElementById('match-upload-file-name')
    if (fileName) {
      fileName.textContent = creatorSelectedUploadFile
        ? `Wybrano: ${creatorSelectedUploadFile.name}`
        : 'Nie wybrano pliku.'
    }

    renderCreatorPreview()
    updateMatchSendButton()
  })

  sendButton?.addEventListener('click', async () => {
    await publishMatchAnnouncementFromCreator()
  })

  window.addEventListener('beforeunload', () => {
    clearCreatorUploadPreviewUrl()
  })
}

function bindMatchAnnouncementsSection() {
  if (announcementsBound) {
    return
  }

  announcementsBound = true

  const refreshButton = document.getElementById('match-announcements-refresh-btn')
  refreshButton?.addEventListener('click', async () => {
    await loadMatchAnnouncements({ silent: false })
  })

  const list = document.getElementById('match-announcements-list')
  list?.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('button[data-action]')
    const action = actionButton?.dataset.action
    const announcementId = actionButton?.dataset.announcementId

    if (!action || !announcementId) {
      return
    }

    if (action === 'edit') {
      await openMatchAnnouncementForEdit(announcementId)
      return
    }

    if (action === 'delete') {
      await deleteMatchAnnouncement(announcementId)
      return
    }

    if (action === 'retry-event') {
      await retryMatchAnnouncementEvent(announcementId)
    }
  })
}

async function loadG2Matches({ silent } = { silent: false }) {
  g2LoadRequestId += 1
  const requestId = g2LoadRequestId

  const params = buildG2FilterQueryParams()
  const query = params.toString()
  const requestUrl = query ? `/api/g2-matches?${query}` : '/api/g2-matches'

  try {
    const response = await fetch(requestUrl)
    const payload = await safeParseApiResponse(response)

    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie pobrac bazy meczow G2.')
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
    renderCreatorMatchOptions()
    updateG2Meta()
    updateMatchSendButton()
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
    renderG2MatchesList()
    renderG2Filters()
    renderCreatorMatchOptions()
    updateG2Meta()
    updateMatchSendButton()

    if (!silent) {
      const message = error instanceof Error ? error.message : 'Nieznany blad'
      showToast(`❌ ${message}`, 'error')
    }
  }
}

async function refreshG2Matches() {
  const button = document.getElementById('g2-refresh-btn')
  if (!button) {
    return
  }

  button.disabled = true

  try {
    const response = await fetch('/api/g2-matches/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const payload = await safeParseApiResponse(response)
    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie odswiezyc meczow z PandaScore.')
    }

    await loadG2Matches({ silent: true })
    showToast(`✅ Odświeżono bazę meczów (${payload.count ?? 0}).`, 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany blad'
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

  if (game) {
    params.set('game', game)
  }

  if (g2Team) {
    params.set('g2Team', g2Team)
  }

  if (tournament) {
    params.set('tournament', tournament)
  }

  if (status) {
    params.set('status', status)
  }

  if (opponent) {
    params.set('opponent', opponent)
  }

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
      </article>
    `
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
  const formatted = typeof formatTimestampInWarsaw === 'function'
    ? formatTimestampInWarsaw(syncTimestamp)
    : new Date(syncTimestamp).toLocaleString('pl-PL')

  let metaText = `Ostatnia synchronizacja: ${formatted} | Rekordy: ${g2SyncMeta.lastSyncCount ?? 0}`

  if (g2SyncMeta.lastError) {
    metaText += ` | Ostatni błąd: ${g2SyncMeta.lastError}`
  }

  metaLabel.textContent = metaText
}

async function loadCreatorResources() {
  try {
    const [channelsResponse, rolesResponse, imagesResponse, emojisResponse] = await Promise.all([
      fetch('/api/channels'),
      fetch('/api/roles'),
      fetch('/api/images'),
      fetch('/api/emojis'),
    ])

    const [channelsPayload, rolesPayload, imagesPayload, emojisPayload] = await Promise.all([
      safeParseApiResponse(channelsResponse),
      safeParseApiResponse(rolesResponse),
      safeParseApiResponse(imagesResponse),
      safeParseApiResponse(emojisResponse),
    ])

    const failedResources = []

    if (!channelsResponse.ok) {
      failedResources.push(channelsPayload.error ?? 'kanały')
    }

    if (!rolesResponse.ok) {
      failedResources.push(rolesPayload.error ?? 'role')
    }

    if (!imagesResponse.ok) {
      failedResources.push(imagesPayload.error ?? 'obrazy')
    }

    if (!emojisResponse.ok) {
      failedResources.push(emojisPayload.error ?? 'emoji')
    }

    if (failedResources.length > 0) {
      throw new Error(`Nie udało się pobrać części zasobów kreatora (${failedResources.join(' | ')}).`)
    }

    creatorChannels = channelsResponse.ok && Array.isArray(channelsPayload.channels) ? channelsPayload.channels : []
    creatorRoles = rolesResponse.ok && Array.isArray(rolesPayload.roles) ? rolesPayload.roles : []
    creatorImages = imagesResponse.ok && Array.isArray(imagesPayload.images) ? imagesPayload.images : []
    creatorEmojis = emojisResponse.ok && Array.isArray(emojisPayload.emojis) ? emojisPayload.emojis : []

    renderCreatorChannelOptions()
    renderCreatorPingOptions()
    renderCreatorImageLibrary()
    renderCreatorEmojiList('')
  } catch (error) {
    console.error('Failed to load creator resources for match announcements:', error)
    creatorChannels = []
    creatorRoles = []
    creatorImages = []
    creatorEmojis = []
    renderCreatorChannelOptions()
    renderCreatorPingOptions()
    renderCreatorImageLibrary()
    renderCreatorEmojiList('')
    showToast('❌ Nie udało się pobrać kanałów, ról lub obrazów dla kreatora meczów.', 'error')
  }
}

function renderCreatorChannelOptions() {
  const channelSelect = document.getElementById('match-channel-select')
  if (!channelSelect) {
    return
  }

  const previousValue = channelSelect.value
  channelSelect.innerHTML = [
    '<option value="">— wybierz kanał —</option>',
    ...creatorChannels.map((channel) => `<option value="${channel.id}">#${escapeHtml(channel.name)}</option>`),
  ].join('')

  channelSelect.value = creatorChannels.some((channel) => channel.id === previousValue) ? previousValue : ''
  channelSelect.disabled = creatorChannels.length === 0
}

function renderCreatorPingOptions() {
  const pingSelect = document.getElementById('match-ping-select')
  if (!pingSelect) {
    return
  }

  const previousValue = pingSelect.value
  const options = [
    '<option value="">Wybierz ping (@everyone, @here lub rolę)</option>',
    '<option value="everyone">@everyone</option>',
    '<option value="here">@here</option>',
    ...creatorRoles.map((role) => `<option value="${role.id}">@${escapeHtml(role.name)}</option>`),
  ]

  if (
    previousValue
    && previousValue !== 'everyone'
    && previousValue !== 'here'
    && !creatorRoles.some((role) => role.id === previousValue)
  ) {
    options.push(`<option value="${escapeHtml(previousValue)}">@nieznana-rola (${escapeHtml(previousValue.slice(0, 6))}...)</option>`)
  }

  pingSelect.innerHTML = options.join('')
  pingSelect.value = previousValue
}

function renderCreatorMatchOptions() {
  const matchSelect = document.getElementById('match-select')
  const searchInput = document.getElementById('match-search-input')

  if (!matchSelect) {
    return
  }

  const search = (searchInput?.value ?? '').trim().toLowerCase()
  const filteredMatches = g2Matches.filter((match) => {
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
      match.status,
    ].join(' ').toLowerCase().includes(search)
  })

  const previousValue = creatorSelectedMatchId || matchSelect.value

  matchSelect.innerHTML = [
    '<option value="">— wybierz mecz —</option>',
    ...filteredMatches.map((match) => {
      const optionLabel = `${match.date} ${match.time} | ${match.game} | ${match.g2TeamName ?? 'G2 Esports'} vs ${match.opponent} | ${match.tournament} | ${match.matchType}`
      return `<option value="${escapeHtml(match.matchId)}">${escapeHtml(optionLabel)}</option>`
    }),
  ].join('')

  const isPreviousValueAvailable = filteredMatches.some((match) => match.matchId === previousValue)
  if (isPreviousValueAvailable) {
    matchSelect.value = previousValue
    creatorSelectedMatchId = previousValue
  } else {
    matchSelect.value = ''
    creatorSelectedMatchId = ''
  }
}

function renderCreatorImageLibrary() {
  const imageGrid = document.getElementById('match-image-grid')
  if (!imageGrid) {
    return
  }

  if (creatorImages.length === 0) {
    imageGrid.innerHTML = '<p class="img-empty">Brak obrazów w folderze /img.</p>'
    return
  }

  imageGrid.innerHTML = creatorImages.map((imageName) => {
    return `
      <div class="img-card${creatorSelectedImageName === imageName ? ' selected' : ''}" data-name="${escapeHtml(imageName)}" title="${escapeHtml(imageName)}">
        <img src="/img/${encodeURIComponent(imageName)}" alt="${escapeHtml(imageName)}" loading="lazy">
        <span class="img-card-name">${escapeHtml(imageName)}</span>
      </div>
    `
  }).join('')

  imageGrid.querySelectorAll('.img-card').forEach((card) => {
    card.addEventListener('click', () => {
      const imageName = card.dataset.name
      if (!imageName) {
        return
      }

      creatorSelectedImageName = imageName
      creatorSelectedUploadFile = null
      creatorStoredUpload = null

      clearCreatorUploadPreviewUrl()

      const uploadInput = document.getElementById('match-image-upload-input')
      if (uploadInput) {
        uploadInput.value = ''
      }

      const uploadFileName = document.getElementById('match-upload-file-name')
      if (uploadFileName) {
        uploadFileName.textContent = 'Nie wybrano pliku.'
      }

      renderCreatorImageLibrary()
      renderCreatorPreview()
      updateMatchSendButton()
    })
  })
}

function updateCreatorModeUI() {
  document.querySelectorAll('#match-mode-tabs .match-mode-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.mode === creatorCurrentMode)
  })

  const titleGroup = document.getElementById('match-title-group')
  const colorGroup = document.getElementById('match-color-group')

  const isEmbedded = creatorCurrentMode === 'embedded'
  if (titleGroup) {
    titleGroup.style.display = isEmbedded ? '' : 'none'
  }

  if (colorGroup) {
    colorGroup.style.display = isEmbedded ? '' : 'none'
  }

  if (!isEmbedded) {
    const titleInput = document.getElementById('match-title')
    if (titleInput) {
      titleInput.value = ''
    }
  }
}

function closeCreatorPopovers() {
  const emojiPopover = document.getElementById('match-emoji-popover')
  const mentionPopover = document.getElementById('match-mention-popover')

  if (emojiPopover) {
    emojiPopover.hidden = true
  }

  if (mentionPopover) {
    mentionPopover.hidden = true
  }
}

function toggleCreatorPopover(popoverId) {
  const popover = document.getElementById(popoverId)
  if (!popover) {
    return
  }

  const shouldOpen = popover.hidden
  closeCreatorPopovers()
  popover.hidden = !shouldOpen
}

function getActiveCreatorEditor() {
  const activeEditor = document.getElementById(creatorActiveEditorId)
  if (activeEditor && (activeEditor.tagName === 'TEXTAREA' || activeEditor.tagName === 'INPUT')) {
    return activeEditor
  }

  const fallbackEditor = document.getElementById('match-description')
  if (fallbackEditor) {
    creatorActiveEditorId = 'match-description'
  }

  return fallbackEditor
}

function insertCreatorToken(token) {
  const target = getActiveCreatorEditor()
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

function wrapCreatorSelection(token) {
  const target = getActiveCreatorEditor()
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

function prefixCreatorSelectionLines(prefix) {
  const target = getActiveCreatorEditor()
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

function renderCreatorEmojiList(filterText) {
  const list = document.getElementById('match-emoji-list')
  if (!list) {
    return
  }

  const normalizedFilter = String(filterText ?? '').trim().toLowerCase()
  const filteredEmojis = normalizedFilter
    ? creatorEmojis.filter((emoji) => String(emoji.name ?? '').toLowerCase().includes(normalizedFilter))
    : creatorEmojis

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

function renderCreatorMentionChannelResults(results, queryText = '') {
  const container = document.getElementById('match-mention-channel-results')
  if (!container) {
    return
  }

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

function renderCreatorMentionRoleResults(results, queryText = '') {
  const container = document.getElementById('match-mention-role-results')
  if (!container) {
    return
  }

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

function renderCreatorMentionUserResults(results, queryText = '') {
  const container = document.getElementById('match-mention-user-results')
  if (!container) {
    return
  }

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

async function searchCreatorMentionChannels(rawQuery) {
  const query = String(rawQuery ?? '').trim()
  creatorMentionChannelSearchRequestId += 1
  const requestId = creatorMentionChannelSearchRequestId

  if (query.length < 2) {
    creatorMentionChannelResults = []
    renderCreatorMentionChannelResults([], query)
    return
  }

  try {
    const response = await fetch(`/api/channels/search?query=${encodeURIComponent(query)}`)
    if (!response.ok) {
      throw new Error('fetch failed')
    }

    const payload = await response.json()
    if (requestId !== creatorMentionChannelSearchRequestId) {
      return
    }

    creatorMentionChannelResults = Array.isArray(payload.channels) ? payload.channels : []
    renderCreatorMentionChannelResults(creatorMentionChannelResults, query)
  } catch {
    if (requestId !== creatorMentionChannelSearchRequestId) {
      return
    }

    creatorMentionChannelResults = []
    renderCreatorMentionChannelResults([], query)
    showToast('Nie udało się wyszukać kanałów.', 'error')
  }
}

async function searchCreatorMentionRoles(rawQuery) {
  const query = String(rawQuery ?? '').trim()
  creatorMentionRoleSearchRequestId += 1
  const requestId = creatorMentionRoleSearchRequestId

  if (query.length < 2) {
    creatorMentionRoleResults = []
    renderCreatorMentionRoleResults([], query)
    return
  }

  try {
    const response = await fetch(`/api/roles/search?query=${encodeURIComponent(query)}`)
    if (!response.ok) {
      throw new Error('fetch failed')
    }

    const payload = await response.json()
    if (requestId !== creatorMentionRoleSearchRequestId) {
      return
    }

    creatorMentionRoleResults = Array.isArray(payload.roles) ? payload.roles : []
    renderCreatorMentionRoleResults(creatorMentionRoleResults, query)
  } catch {
    if (requestId !== creatorMentionRoleSearchRequestId) {
      return
    }

    creatorMentionRoleResults = []
    renderCreatorMentionRoleResults([], query)
    showToast('Nie udało się wyszukać ról.', 'error')
  }
}

async function searchCreatorMentionUsers(rawQuery) {
  const query = String(rawQuery ?? '').trim()
  creatorMentionUserSearchRequestId += 1
  const requestId = creatorMentionUserSearchRequestId

  if (query.length < 2) {
    creatorMentionUserResults = []
    renderCreatorMentionUserResults([], query)
    return
  }

  try {
    const response = await fetch(`/api/members/search?query=${encodeURIComponent(query)}`)
    if (!response.ok) {
      throw new Error('fetch failed')
    }

    const payload = await response.json()
    if (requestId !== creatorMentionUserSearchRequestId) {
      return
    }

    creatorMentionUserResults = Array.isArray(payload.members) ? payload.members : []
    creatorMentionUserResults.forEach((member) => {
      if (!member?.id) {
        return
      }

      const displayName = member.nick || member.globalName || member.username || 'użytkownik'
      creatorKnownUsers.set(member.id, displayName)
    })

    renderCreatorMentionUserResults(creatorMentionUserResults, query)
  } catch {
    if (requestId !== creatorMentionUserSearchRequestId) {
      return
    }

    creatorMentionUserResults = []
    renderCreatorMentionUserResults([], query)
    showToast('Nie udało się wyszukać użytkowników.', 'error')
  }
}

function resolveCreatorPingTargetLabel(pingTargetId) {
  if (pingTargetId === 'everyone') {
    return '@everyone'
  }

  if (pingTargetId === 'here') {
    return '@here'
  }

  const role = creatorRoles.find((entry) => entry.id === pingTargetId)
  return role ? `@${role.name}` : '@nieznana-rola'
}

function updateCreatorImagePanels() {
  const imageModeSelect = document.getElementById('match-image-mode')
  const libraryPanel = document.getElementById('match-image-library-panel')
  const uploadPanel = document.getElementById('match-image-upload-panel')

  const imageMode = imageModeSelect?.value ?? 'none'

  if (libraryPanel) {
    libraryPanel.hidden = imageMode !== 'library'
  }

  if (uploadPanel) {
    uploadPanel.hidden = imageMode !== 'upload'
  }

  if (imageMode !== 'library') {
    creatorSelectedImageName = null
  }

  if (imageMode !== 'upload') {
    creatorSelectedUploadFile = null
    creatorStoredUpload = null
    clearCreatorUploadPreviewUrl()

    const uploadInput = document.getElementById('match-image-upload-input')
    if (uploadInput) {
      uploadInput.value = ''
    }

    const uploadFileName = document.getElementById('match-upload-file-name')
    if (uploadFileName) {
      uploadFileName.textContent = 'Nie wybrano pliku.'
    }
  }

  renderCreatorImageLibrary()
}

function buildDefaultMatchTitle(match) {
  return `${match.g2TeamName ?? 'G2 Esports'} vs ${match.opponent} | ${match.tournament} | ${match.matchType}`
}

function getSelectedCreatorMatch() {
  return g2Matches.find((match) => match.matchId === creatorSelectedMatchId) ?? null
}

function buildDefaultMatchContent(selectedMatch) {
  const game = String(selectedMatch.game ?? '').toLowerCase()
  const gameEmoji = game.includes('valorant')
    ? '🎯'
    : (game.includes('counter') || game.includes('cs')
      ? '🔫'
      : (game.includes('league') || game.includes('lol') ? '🧠' : '🎮'))

  const unixTimestamp = Math.floor(Number(selectedMatch.beginAtTimestamp) / 1000)
  const lines = []

  lines.push(`${gameEmoji} **Nadchodzący mecz**`)
  lines.push('')
  lines.push(`🏰 **Drużyna G2:** ${selectedMatch.g2TeamName ?? 'G2 Esports'}`)
  lines.push(`⚔️ **Rywal:** ${selectedMatch.opponent}`)
  lines.push(`🏆 **Turniej:** ${selectedMatch.tournament}`)
  lines.push(`📋 **Format:** ${selectedMatch.matchType}`)
  lines.push(`⏰ **Start:** <t:${unixTimestamp}:F>`) 
  lines.push(`🕒 **Do meczu:** <t:${unixTimestamp}:R>`)

  return lines.join('\n').trim()
}

function resolveCreatorContent(selectedMatch, fallbackContent) {
  const normalizedContent = (fallbackContent ?? '').trim()
  if (normalizedContent) {
    return normalizedContent
  }

  if (!selectedMatch) {
    return ''
  }

  return buildDefaultMatchContent(selectedMatch)
}

function renderCreatorPreview() {
  const embedContainer = document.getElementById('match-embed-preview-container')
  const messageContainer = document.getElementById('match-message-preview-container')
  const previewDescription = document.getElementById('match-preview-description')
  const colorBar = document.getElementById('match-embed-color-bar')
  const pingPreviewLine = document.getElementById('match-preview-ping-line')
  const imageBlock = document.getElementById('match-preview-image-block')
  const imageElement = document.getElementById('match-preview-image')
  const imageCaption = document.getElementById('match-preview-image-caption')
  const imagePlaceholder = document.getElementById('match-preview-image-placeholder')
  const titleInput = document.getElementById('match-title')
  const descriptionInput = document.getElementById('match-description')
  const pingToggle = document.getElementById('match-ping-enabled')
  const pingSelect = document.getElementById('match-ping-select')
  const imageModeSelect = document.getElementById('match-image-mode')

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
    || !titleInput
    || !descriptionInput
    || !pingToggle
    || !pingSelect
    || !imageModeSelect
  ) {
    return
  }

  const selectedMatch = getSelectedCreatorMatch()
  const fallbackTitle = selectedMatch ? buildDefaultMatchTitle(selectedMatch) : ''
  const title = titleInput.value.trim() || fallbackTitle
  const content = resolveCreatorContent(selectedMatch, descriptionInput.value)
  const imageMode = imageModeSelect.value

  if (creatorCurrentMode === 'embedded') {
    embedContainer.style.display = 'flex'
    messageContainer.style.display = 'none'
    colorBar.style.background = MATCH_COLOR_MAP[creatorSelectedColor] ?? MATCH_COLOR_MAP.czerwony
    previewDescription.innerHTML = typeof renderPreviewEmbedText === 'function'
      ? renderPreviewEmbedText(title, content)
      : `<strong>${escapeHtml(title)}</strong><br>${escapeHtml(content)}`
  } else {
    embedContainer.style.display = 'none'
    messageContainer.style.display = ''
    messageContainer.innerHTML = typeof renderMarkdown === 'function'
      ? (renderMarkdown(content) || '<span style="opacity:.45">Wpisz treść publikacji.</span>')
      : (escapeHtml(content) || '<span style="opacity:.45">Wpisz treść publikacji.</span>')
  }

  if (pingToggle.checked && pingSelect.value) {
    pingPreviewLine.textContent = `Ping przed publikacją: ${resolveCreatorPingTargetLabel(pingSelect.value)}`
    pingPreviewLine.style.display = 'inline-flex'
  } else {
    pingPreviewLine.style.display = 'none'
    pingPreviewLine.textContent = ''
  }

  let previewImageSrc = ''
  let previewImageCaption = ''

  if (imageMode === 'library' && creatorSelectedImageName) {
    previewImageSrc = `/img/${encodeURIComponent(creatorSelectedImageName)}`
    previewImageCaption = `Grafika z biblioteki: ${creatorSelectedImageName}`
  }

  if (imageMode === 'upload' && creatorSelectedUploadPreviewUrl) {
    previewImageSrc = creatorSelectedUploadPreviewUrl
    previewImageCaption = creatorSelectedUploadFile
      ? `Wgrana grafika: ${creatorSelectedUploadFile.name}`
      : 'Wgrana grafika'
  }

  if (previewImageSrc) {
    imageElement.src = previewImageSrc
    imageCaption.textContent = previewImageCaption
    imageBlock.style.display = ''
    imagePlaceholder.style.display = 'none'
    return
  }

  imageBlock.style.display = 'none'
  imageElement.src = ''
  imageCaption.textContent = ''

  if (imageMode === 'none') {
    imagePlaceholder.style.display = 'none'
  } else if (imageMode === 'library') {
    imagePlaceholder.textContent = '🖼️ Wybierz grafikę z biblioteki, aby zobaczyć podgląd.'
    imagePlaceholder.style.display = ''
  } else {
    imagePlaceholder.textContent = '🖼️ Wgraj plik, aby zobaczyć podgląd.'
    imagePlaceholder.style.display = ''
  }
}

function updateMatchSendButton() {
  const sendButton = document.getElementById('match-send-btn')
  const sendButtonText = document.getElementById('match-send-btn-text')
  const channelSelect = document.getElementById('match-channel-select')
  const pingToggle = document.getElementById('match-ping-enabled')
  const pingSelect = document.getElementById('match-ping-select')
  const imageModeSelect = document.getElementById('match-image-mode')
  const scheduleInput = document.getElementById('match-schedule-at')

  if (!sendButton || !sendButtonText || !channelSelect || !pingToggle || !pingSelect || !imageModeSelect || !scheduleInput) {
    return
  }

  const selectedMatch = getSelectedCreatorMatch()
  const hasMatch = Boolean(selectedMatch)
  const hasChannel = Boolean(channelSelect.value)
  const resolvedContent = selectedMatch
    ? resolveCreatorContent(selectedMatch, document.getElementById('match-description')?.value)
    : ''
  const hasContent = Boolean(resolvedContent.trim())
  const pingReady = !pingToggle.checked || Boolean(pingSelect.value)

  const imageMode = imageModeSelect.value
  const imageReady = imageMode === 'none'
    || (imageMode === 'library' && Boolean(creatorSelectedImageName))
    || (imageMode === 'upload' && (Boolean(creatorSelectedUploadFile) || Boolean(creatorStoredUpload)))

  sendButton.disabled = !(hasMatch && hasChannel && hasContent && pingReady && imageReady)

  if (scheduleInput.value.trim()) {
    sendButtonText.textContent = editingMatchAnnouncementId
      ? 'Zapisz zaplanowane ogłoszenie meczu'
      : 'Zaplanuj ogłoszenie meczu'
    return
  }

  sendButtonText.textContent = 'Opublikuj ogłoszenie meczu'
}

async function collectCreatorPayload() {
  const selectedMatch = getSelectedCreatorMatch()
  if (!selectedMatch) {
    throw new Error('Wybierz mecz z bazy danych.')
  }

  const titleInput = document.getElementById('match-title')
  const descriptionInput = document.getElementById('match-description')
  const channelSelect = document.getElementById('match-channel-select')
  const pingToggle = document.getElementById('match-ping-enabled')
  const pingSelect = document.getElementById('match-ping-select')
  const imageModeSelect = document.getElementById('match-image-mode')
  const scheduleInput = document.getElementById('match-schedule-at')

  const imageMode = imageModeSelect?.value ?? 'none'
  const selectedUploadFile = creatorSelectedUploadFile

  let uploadFileName = ''
  let uploadMimeType = ''
  let uploadBase64 = ''

  if (imageMode === 'upload' && selectedUploadFile) {
    const dataUrl = await fileToDataUrl(selectedUploadFile)
    uploadFileName = selectedUploadFile.name
    uploadMimeType = normalizeCreatorUploadMimeType(selectedUploadFile.type, selectedUploadFile.name)
    uploadBase64 = String(dataUrl)
  }

  if (imageMode === 'upload' && !creatorSelectedUploadFile && creatorStoredUpload) {
    uploadFileName = creatorStoredUpload.uploadFileName
    uploadMimeType = creatorStoredUpload.uploadMimeType
    uploadBase64 = creatorStoredUpload.uploadBase64
  }

  const defaultTitle = buildDefaultMatchTitle(selectedMatch)
  const title = titleInput?.value?.trim() || defaultTitle
  const content = resolveCreatorContent(selectedMatch, descriptionInput?.value)
  const scheduleAtLocal = scheduleInput?.value?.trim() ?? ''

  return {
    mode: creatorCurrentMode,
    channelId: channelSelect?.value ?? '',
    title,
    content,
    colorName: creatorSelectedColor,
    mentionRoleEnabled: Boolean(pingToggle?.checked),
    mentionRoleId: pingToggle?.checked ? (pingSelect?.value ?? '') : '',
    imageMode,
    imageFilename: imageMode === 'library' ? (creatorSelectedImageName ?? '') : '',
    uploadFileName,
    uploadMimeType,
    uploadBase64,
    scheduleAtLocal,
    match: {
      matchId: selectedMatch.matchId,
      game: selectedMatch.game,
      g2TeamName: selectedMatch.g2TeamName,
      opponent: selectedMatch.opponent,
      tournament: selectedMatch.tournament,
      matchType: selectedMatch.matchType,
      beginAtUtc: selectedMatch.beginAtUtc,
      date: selectedMatch.date,
      time: selectedMatch.time,
    },
  }
}

async function publishMatchAnnouncementFromCreator() {
  const sendButton = document.getElementById('match-send-btn')
  if (!sendButton) {
    return
  }

  sendButton.disabled = true
  sendButton.classList.add('loading')

  try {
    const payload = await collectCreatorPayload()
    const hasScheduleDate = Boolean(payload.scheduleAtLocal?.trim())

    if (editingMatchAnnouncementId && !hasScheduleDate) {
      throw new Error('Edytowane ogłoszenie zaplanowane musi mieć ustawioną datę publikacji.')
    }

    const requestUrl = hasScheduleDate
      ? (editingMatchAnnouncementId
        ? `/api/match-announcements/${encodeURIComponent(editingMatchAnnouncementId)}`
        : '/api/match-announcements')
      : '/api/match-announcements/publish'

    const requestMethod = hasScheduleDate && editingMatchAnnouncementId ? 'PATCH' : 'POST'

    const response = await fetch(requestUrl, {
      method: requestMethod,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const responsePayload = await safeParseApiResponse(response)
    if (!response.ok) {
      throw new Error(responsePayload.error ?? 'Nieznany błąd publikacji ogłoszenia meczowego.')
    }

    if (Array.isArray(responsePayload.warnings) && responsePayload.warnings.length > 0) {
      responsePayload.warnings.forEach((warning) => {
        showToast(`⚠️ ${warning}`, 'info')
      })
    }

    if (hasScheduleDate) {
      const scheduleInput = document.getElementById('match-schedule-at')
      editingMatchAnnouncementId = null

      if (scheduleInput) {
        scheduleInput.value = ''
      }

      await loadMatchAnnouncements({ silent: true })

      if (typeof switchSection === 'function') {
        switchSection('match-announcements')
      }

      showToast('✅ Zaplanowane ogłoszenie meczu zostało zapisane.', 'success')
      return
    }

    if (payload.imageMode === 'upload') {
      await loadCreatorResources()
      renderCreatorImageLibrary()
    }

    showToast('✅ Ogłoszenie meczu zostało opublikowane.', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd publikacji.'
    showToast(`❌ ${message}`, 'error')
  } finally {
    sendButton.classList.remove('loading')
    updateMatchSendButton()
  }
}

async function loadMatchAnnouncements({ silent } = { silent: false }) {
  announcementsLoadRequestId += 1
  const requestId = announcementsLoadRequestId

  try {
    const response = await fetch('/api/match-announcements')
    const payload = await safeParseApiResponse(response)

    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie pobrac listy ogloszen meczowych.')
    }

    if (requestId !== announcementsLoadRequestId) {
      return
    }

    matchAnnouncements = Array.isArray(payload.announcements) ? payload.announcements : []
    renderMatchAnnouncements()
  } catch (error) {
    if (requestId !== announcementsLoadRequestId) {
      return
    }

    matchAnnouncements = []
    renderMatchAnnouncements()

    if (!silent) {
      const message = error instanceof Error ? error.message : 'Nieznany blad'
      showToast(`❌ ${message}`, 'error')
    }
  }
}

function renderMatchAnnouncements() {
  const list = document.getElementById('match-announcements-list')
  const countLabel = document.getElementById('match-announcements-count-label')

  if (!list || !countLabel) {
    return
  }

  countLabel.textContent = `Pozycje: ${matchAnnouncements.length}`

  if (matchAnnouncements.length === 0) {
    list.innerHTML = '<div class="scheduled-empty">Brak zaplanowanych ogłoszeń meczowych.</div>'
    return
  }

  list.innerHTML = matchAnnouncements.map((announcement) => {
    const eventStatusClass = announcement.eventStatus === 'failed'
      ? 'status-failed'
      : (announcement.eventStatus === 'created' ? 'status-success' : 'status-pending')
    const eventStatusText = announcement.eventStatus === 'failed'
      ? `Event: błąd (${announcement.eventLastError ?? 'nieznany'})`
      : (announcement.eventStatus === 'created' ? 'Event: utworzono' : 'Event: oczekuje')

    const actions = []

    if (announcement.status === 'pending') {
      actions.push(`<button type="button" class="btn-secondary" data-action="edit" data-announcement-id="${escapeHtml(announcement.id)}">Edytuj</button>`)
      actions.push(`<button type="button" class="btn-secondary" data-action="delete" data-announcement-id="${escapeHtml(announcement.id)}">Usuń</button>`)
    }

    if (announcement.status === 'sent' && announcement.eventStatus === 'failed') {
      actions.push(`<button type="button" class="btn-secondary" data-action="retry-event" data-announcement-id="${escapeHtml(announcement.id)}">Utwórz event ponownie</button>`)
      actions.push(`<button type="button" class="btn-secondary" data-action="delete" data-announcement-id="${escapeHtml(announcement.id)}">Usuń z listy</button>`)
    }

    if (announcement.status === 'failed' || announcement.status === 'skipped') {
      actions.push(`<button type="button" class="btn-secondary" data-action="delete" data-announcement-id="${escapeHtml(announcement.id)}">Usuń z listy</button>`)
    }

    const previewContent = announcement?.payload?.content ?? ''
    const previewTitle = announcement?.payload?.title ?? ''
    const previewHtml = announcement?.payload?.mode === 'message'
      ? (typeof renderMarkdown === 'function'
        ? (renderMarkdown(previewContent) || '<span style="opacity:.45">Brak treści.</span>')
        : escapeHtml(previewContent))
      : (typeof renderPreviewEmbedText === 'function'
        ? renderPreviewEmbedText(previewTitle, previewContent)
        : `${escapeHtml(previewTitle)}<br>${escapeHtml(previewContent)}`)

    return `
      <article class="scheduled-card">
        <div class="scheduled-card-header">
          <span class="scheduled-card-title">Mecz: ${escapeHtml(announcement.match.game)} | ${escapeHtml(announcement.match.g2TeamName ?? 'G2 Esports')} vs ${escapeHtml(announcement.match.opponent)}</span>
          <span class="scheduled-chip">${escapeHtml(announcement.match.matchType)}</span>
        </div>
        <div class="scheduled-card-meta">
          <span class="scheduled-chip">Turniej: ${escapeHtml(announcement.match.tournament)}</span>
          <span class="scheduled-chip">Publikacja: ${escapeHtml(formatTimestampForMatchInput(announcement.scheduledFor).replace('T', ' '))}</span>
          <span class="scheduled-chip">Status: ${escapeHtml(announcement.status)}</span>
          <span class="scheduled-chip ${eventStatusClass}">${escapeHtml(eventStatusText)}</span>
        </div>
        <div class="scheduled-preview">${previewHtml}</div>
        <div class="scheduled-actions">${actions.join('')}</div>
      </article>
    `
  }).join('')
}

async function openMatchAnnouncementForEdit(announcementId) {
  try {
    const response = await fetch(`/api/match-announcements/${encodeURIComponent(announcementId)}`)
    const payload = await safeParseApiResponse(response)

    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie pobrac zaplanowanego ogloszenia meczowego.')
    }

    const announcement = payload.announcement
    if (!announcement || !announcement.payload || !announcement.match) {
      throw new Error('Nieprawidłowe dane zaplanowanego ogłoszenia meczowego.')
    }

    applyAnnouncementToCreator(announcement)

    if (typeof switchSection === 'function') {
      switchSection('match-announcement-creator')
    }

    showToast('✏️ Załadowano ogłoszenie meczowe do edycji.', 'info')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd'
    showToast(`❌ ${message}`, 'error')
  }
}

function applyAnnouncementToCreator(announcement) {
  editingMatchAnnouncementId = announcement.id
  creatorCurrentMode = announcement.payload.mode === 'message' ? 'message' : 'embedded'
  creatorSelectedColor = announcement.payload.colorName || 'czerwony'

  ensureMatchVisibleInCreator(announcement.match)
  creatorSelectedMatchId = announcement.match.matchId

  const matchSelect = document.getElementById('match-select')
  const titleInput = document.getElementById('match-title')
  const descriptionInput = document.getElementById('match-description')
  const channelSelect = document.getElementById('match-channel-select')
  const pingToggle = document.getElementById('match-ping-enabled')
  const pingSelect = document.getElementById('match-ping-select')
  const imageModeSelect = document.getElementById('match-image-mode')
  const scheduleInput = document.getElementById('match-schedule-at')

  renderCreatorMatchOptions()

  if (matchSelect) {
    matchSelect.value = creatorSelectedMatchId
  }

  if (titleInput) {
    titleInput.value = announcement.payload.title ?? ''
  }

  if (descriptionInput) {
    descriptionInput.value = announcement.payload.content ?? ''
  }

  if (channelSelect) {
    channelSelect.value = announcement.payload.channelId ?? ''
  }

  if (pingToggle) {
    pingToggle.checked = announcement.payload.mentionRoleEnabled === true
  }

  if (pingSelect) {
    pingSelect.disabled = !(pingToggle?.checked ?? false)
    pingSelect.value = announcement.payload.mentionRoleId ?? ''
  }

  if (imageModeSelect) {
    imageModeSelect.value = announcement.payload.imageMode ?? 'none'
  }

  document.querySelectorAll('#match-color-swatches .color-swatch').forEach((swatch) => {
    swatch.classList.toggle('active', swatch.dataset.color === creatorSelectedColor)
  })

  creatorSelectedImageName = announcement.payload.imageMode === 'library'
    ? (announcement.payload.imageFilename ?? null)
    : null
  creatorSelectedUploadFile = null
  creatorStoredUpload = null
  clearCreatorUploadPreviewUrl()

  if (announcement.payload.imageMode === 'upload' && announcement.payload.uploadBase64) {
    creatorStoredUpload = {
      uploadFileName: announcement.payload.uploadFileName ?? '',
      uploadMimeType: announcement.payload.uploadMimeType ?? '',
      uploadBase64: announcement.payload.uploadBase64,
    }

    const uploadFileName = document.getElementById('match-upload-file-name')
    if (uploadFileName) {
      uploadFileName.textContent = announcement.payload.uploadFileName
        ? `Zachowano: ${announcement.payload.uploadFileName}`
        : 'Zachowano zapisany upload.'
    }
  }

  if (scheduleInput) {
    scheduleInput.value = formatTimestampForMatchInput(announcement.scheduledFor)
  }

  updateCreatorModeUI()
  updateCreatorImagePanels()
  renderCreatorImageLibrary()
  renderCreatorPreview()
  updateMatchSendButton()
}

function ensureMatchVisibleInCreator(matchSnapshot) {
  const alreadyExists = g2Matches.some((match) => match.matchId === matchSnapshot.matchId)
  if (alreadyExists) {
    return
  }

  const beginAtTimestamp = Date.parse(matchSnapshot.beginAtUtc)

  g2Matches = [
    ...g2Matches,
    {
      matchId: matchSnapshot.matchId,
      game: matchSnapshot.game,
      g2TeamName: matchSnapshot.g2TeamName ?? 'G2 Esports',
      opponent: matchSnapshot.opponent,
      tournament: matchSnapshot.tournament,
      matchType: matchSnapshot.matchType,
      beginAtUtc: matchSnapshot.beginAtUtc,
      beginAtTimestamp: Number.isFinite(beginAtTimestamp) ? beginAtTimestamp : Date.now(),
      date: matchSnapshot.date,
      time: matchSnapshot.time,
      status: 'upcoming',
    },
  ].sort((left, right) => Number(left.beginAtTimestamp) - Number(right.beginAtTimestamp))
}

async function deleteMatchAnnouncement(announcementId) {
  const shouldDelete = window.confirm('Czy na pewno chcesz usunąć ogłoszenie meczowe?')
  if (!shouldDelete) {
    return
  }

  try {
    const response = await fetch(`/api/match-announcements/${encodeURIComponent(announcementId)}`, {
      method: 'DELETE',
    })
    const payload = await safeParseApiResponse(response)

    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie usunac ogloszenia meczowego.')
    }

    if (editingMatchAnnouncementId === announcementId) {
      editingMatchAnnouncementId = null
    }

    await loadMatchAnnouncements({ silent: true })
    showToast('🗑️ Ogłoszenie meczowe zostało usunięte.', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd'
    showToast(`❌ ${message}`, 'error')
  }
}

async function retryMatchAnnouncementEvent(announcementId) {
  try {
    const response = await fetch(`/api/match-announcements/${encodeURIComponent(announcementId)}/retry-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const payload = await safeParseApiResponse(response)

    if (!response.ok) {
      throw new Error(payload.error ?? 'Nie udalo sie ponowic tworzenia wydarzenia Discord.')
    }

    await loadMatchAnnouncements({ silent: true })
    showToast('✅ Utworzono wydarzenie Discord po ponowieniu.', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd'
    showToast(`❌ ${message}`, 'error')
  }
}

function formatTimestampForMatchInput(timestamp) {
  if (typeof formatTimestampForDateTimeInput === 'function') {
    return formatTimestampForDateTimeInput(timestamp)
  }

  return new Date(timestamp).toISOString().slice(0, 16)
}

function fileExtension(filename) {
  const lower = (filename ?? '').toLowerCase()
  const dotIndex = lower.lastIndexOf('.')
  return dotIndex === -1 ? '' : lower.slice(dotIndex)
}

function normalizeCreatorUploadMimeType(mimeType, filename) {
  const normalizedMimeType = (mimeType ?? '').trim().toLowerCase()

  if (normalizedMimeType === 'image/jpeg' || normalizedMimeType === 'image/jpg') {
    return 'image/jpeg'
  }

  if (normalizedMimeType === 'image/png' || normalizedMimeType === 'image/gif') {
    return normalizedMimeType
  }

  const ext = fileExtension(filename)
  return MATCH_CREATOR_UPLOAD_MIME_BY_EXT[ext] ?? ''
}

function isAllowedCreatorUploadFile(file) {
  const normalizedMimeType = normalizeCreatorUploadMimeType(file.type, file.name)
  if (MATCH_CREATOR_ALLOWED_UPLOAD_TYPES.has(normalizedMimeType)) {
    return true
  }

  return MATCH_CREATOR_ALLOWED_UPLOAD_EXTS.has(fileExtension(file.name))
}

function clearCreatorUploadPreviewUrl() {
  if (creatorSelectedUploadPreviewUrl) {
    URL.revokeObjectURL(creatorSelectedUploadPreviewUrl)
    creatorSelectedUploadPreviewUrl = null
  }
}

async function safeParseApiResponse(response) {
  if (typeof parseApiResponse === 'function') {
    return parseApiResponse(response)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json().catch(() => ({}))
  }

  const text = await response.text()
  return text ? { error: text } : {}
}
