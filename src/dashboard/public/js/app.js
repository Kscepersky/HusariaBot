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
let currentSection = 'embed-creator'
let scheduledPosts = []
let editingScheduledPostId = null

document.addEventListener('DOMContentLoaded', async () => {
  loadUserInfo()
  initSidebarNav()
  await initEmbedSection()
  await initScheduledSection()
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
        <a href="/auth/logout" class="btn-logout">Wyloguj</a>
      </div>`
  } catch {
    window.location.href = '/auth/discord'
  }
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

function applyScheduledPostToCreator(post) {
  editingScheduledPostId = post.id
  currentMode = post.payload.mode === 'message' ? 'message' : 'embedded'
  selectedColor = post.payload.colorName || 'czerwony'

  const titleInput = document.getElementById('title')
  const contentTextarea = document.getElementById('content-textarea')
  const channelSelect = document.getElementById('channel-select')
  const pingToggle = document.getElementById('ping-role-enabled')
  const pingSelect = document.getElementById('ping-role-select')
  const imageModeSelect = document.getElementById('image-mode-select')
  const scheduleInput = document.getElementById('schedule-at')

  if (titleInput) {
    titleInput.value = post.payload.title ?? ''
  }

  if (contentTextarea) {
    contentTextarea.value = post.payload.content ?? ''
  }

  if (channelSelect) {
    channelSelect.value = post.payload.channelId ?? ''
  }

  if (pingToggle) {
    pingToggle.checked = post.payload.mentionRoleEnabled === true
  }

  renderPingRoleSelector()
  if (pingSelect) {
    pingSelect.value = post.payload.mentionRoleId ?? ''
    pingSelect.disabled = !(pingToggle?.checked ?? false)
  }

  if (imageModeSelect) {
    imageModeSelect.value = post.payload.imageMode ?? 'none'
  }

  selectedImageName = post.payload.imageMode === 'library'
    ? (post.payload.imageFilename ?? null)
    : null
  selectedUploadFile = null
  scheduledStoredUpload = null
  clearUploadPreviewUrl()

  if (post.payload.imageMode === 'upload' && post.payload.uploadBase64) {
    scheduledStoredUpload = {
      uploadFileName: post.payload.uploadFileName ?? '',
      uploadMimeType: post.payload.uploadMimeType ?? '',
      uploadBase64: post.payload.uploadBase64,
    }

    const fileNameElement = document.getElementById('upload-file-name')
    if (fileNameElement) {
      fileNameElement.textContent = post.payload.uploadFileName
        ? `Zachowano: ${post.payload.uploadFileName}`
        : 'Zachowano zapisany upload.'
    }
  }

  if (scheduleInput) {
    scheduleInput.value = formatTimestampForDateTimeInput(post.scheduledFor)
  }

  updateModeUI()
  updateImagePanels()
  renderImageLibrary(images)

  document.querySelectorAll('.color-swatch').forEach((swatch) => {
    swatch.classList.toggle('active', swatch.dataset.color === selectedColor)
  })

  updatePreview()
  updateSendButton()
}

async function deleteScheduledPost(postId) {
  const shouldDelete = window.confirm('Czy na pewno chcesz usunąć zaplanowany post?')
  if (!shouldDelete) {
    return
  }

  try {
    const response = await fetch(`/api/scheduled/${encodeURIComponent(postId)}`, {
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
  return html
}

function collectFormDataSync() {
  const pingEnabled = document.getElementById('ping-role-enabled')?.checked ?? false
  const pingRoleId = document.getElementById('ping-role-select')?.value ?? ''
  const imageMode = document.getElementById('image-mode-select')?.value ?? 'none'
  const scheduleAtLocal = document.getElementById('schedule-at')?.value ?? ''

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

  button.disabled = !(hasChannel && hasContent && pingReady && imageReady)

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

    if (editingScheduledPostId && !hasScheduleDate) {
      throw new Error('Edytowany post zaplanowany musi mieć ustawioną datę publikacji.')
    }

    const requestUrl = hasScheduleDate
      ? (editingScheduledPostId ? `/api/scheduled/${encodeURIComponent(editingScheduledPostId)}` : '/api/scheduled')
      : '/api/embed'
    const requestMethod = hasScheduleDate && editingScheduledPostId ? 'PATCH' : 'POST'

    const resp = await fetch(requestUrl, {
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

  html = html.replace(/\n/g, '<br>')
  html = html.replace(/@@CODEBLOCK_(\d+)@@/g, (_match, index) => codeBlocks[Number(index)] ?? '')

  return html
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
