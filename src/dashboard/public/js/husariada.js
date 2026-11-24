/**
 * Zakladka "Husariada" (quiz w stylu Kahoot). Ladowana po app.js - korzysta z jego
 * globalnych helperow (fetchWithCsrf, showToast, formatTimestampInWarsaw) i t() z i18n.
 *
 * Dashboard nie steruje gra bezposrednio: wysyla polecenia, ktore bot wykonuje
 * w ciagu ~1 s. Stan odswiezamy pollingiem tylko, gdy zakladka jest otwarta.
 * Tresci od uzytkownikow trafiaja do DOM wylacznie przez textContent.
 */
(function initHusariadaSection(global) {
  'use strict'

  var POLL_INTERVAL_MS = 2000
  var ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
  var MAX_FILE_BYTES = 8 * 1024 * 1024
  var ANSWER_TAGS = ['🟥 A', '🟦 B', '🟨 C', '🟩 D']
  var MEDALS = ['🥇', '🥈', '🥉']
  var SETTING_KEYS = ['timeLimitSec', 'maxPoints', 'leaderboardEvery', 'leaderboardSeconds', 'revealSeconds', 'introSeconds']

  var activeTab = 'control'
  var state = null
  var quizzes = []
  var selectedQuizId = null
  var selectedQuiz = null
  var editingQuestion = null
  var pendingImage = undefined
  var pollTimerId = null
  var initialized = false
  var busy = false

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

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild)
  }

  async function requestJson(url, options) {
    var response = await fetchWithCsrf(url, options)
    if (response.status === 401) {
      global.location.href = '/auth/login'
      throw new Error(t('husariada.blad'))
    }
    var body = await response.json().catch(function () { return {} })
    if (!response.ok) throw new Error(body.error || t('husariada.blad'))
    return body
  }

  function sendJson(url, method, payload) {
    return requestJson(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload === undefined ? {} : payload),
    })
  }

  async function withBusy(operation) {
    if (busy) return
    busy = true
    try {
      await operation()
    } catch (error) {
      showToast(error.message || t('husariada.blad'), 'error')
    } finally {
      busy = false
    }
  }

  function isSectionActive() {
    var section = byId('section-husariada')
    return Boolean(section && section.classList.contains('active'))
  }

  // ─── Zakladki ────────────────────────────────────────────────────────────────

  function switchTab(tab) {
    activeTab = tab
    document.querySelectorAll('[data-hus-tab]').forEach(function (button) {
      var isActive = button.dataset.husTab === tab
      button.classList.toggle('is-active', isActive)
      button.setAttribute('aria-selected', String(isActive))
    })
    document.querySelectorAll('[data-hus-panel]').forEach(function (panel) {
      panel.hidden = panel.dataset.husPanel !== tab
    })
    void refreshActiveTab()
  }

  async function refreshActiveTab() {
    try {
      if (activeTab === 'control') {
        await Promise.all([loadState(), loadQuizzes()])
      } else if (activeTab === 'quizzes') {
        await loadQuizzes()
        if (selectedQuizId) await loadQuiz(selectedQuizId)
      } else if (activeTab === 'settings') {
        await loadSettings()
      } else if (activeTab === 'history') {
        await loadHistory()
      }
    } catch (error) {
      showToast(error.message || t('husariada.blad'), 'error')
    }
  }

  // ─── Sterowanie / stan na zywo ───────────────────────────────────────────────

  var PHASE_KEYS = {
    waiting: 'husariada.faza_oczekiwanie',
    intro: 'husariada.faza_intro',
    question: 'husariada.faza_pytanie',
    reveal: 'husariada.faza_odpowiedz',
    leaderboard: 'husariada.faza_ranking',
    paused: 'husariada.faza_pauza',
    finished: 'husariada.faza_koniec',
  }

  async function loadState() {
    state = await requestJson('/api/husariada/state')
    renderState()
  }

  function renderStatusCards() {
    var event = state.event
    byId('hus-bot-status').textContent = state.bot.online ? t('husariada.bot_online') : t('husariada.bot_offline')
    byId('hus-bot-status').className = 'hus-status-value ' + (state.bot.online ? 'is-ok' : 'is-bad')
    byId('hus-event-status').textContent = event ? t('husariada.status_' + event.status) : t('husariada.brak_eventu')
    byId('hus-question-status').textContent = event && event.currentIndex >= 0
      ? (event.currentIndex + 1) + '/' + event.questionCount
      : (event ? '0/' + event.questionCount : '—')
    byId('hus-players-status').textContent = String(state.players || 0)
  }

  function renderWarning() {
    var warning = byId('hus-warning')
    var messages = []
    if (!state.channelConfigured) messages.push(t('husariada.ostrzezenie_kanal'))
    if (!state.bot.online) messages.push(t('husariada.ostrzezenie_bot'))
    warning.hidden = messages.length === 0
    warning.textContent = messages.join(' ')
  }

  function renderStandings(list, standings) {
    clear(list)
    if (standings.length === 0) {
      list.appendChild(el('li', { className: 'hus-empty', text: t('husariada.brak_graczy') }))
      return
    }
    standings.forEach(function (entry) {
      var medal = entry.place <= 3 ? MEDALS[entry.place - 1] : '#' + entry.place
      list.appendChild(el('li', { className: 'hus-standing' }, [
        el('span', { className: 'hus-standing-place', text: medal }),
        el('span', { className: 'hus-standing-name', text: entry.displayName }),
        el('span', { className: 'hus-standing-meta', text: '✅ ' + entry.correctCount }),
        el('strong', { className: 'hus-standing-points', text: entry.points + ' pkt' }),
      ]))
    })
  }

  function renderLive(event) {
    byId('hus-live-title').textContent = event.quizTitle
    var phase = byId('hus-live-phase')
    var phaseText = t(PHASE_KEYS[event.phase] || 'husariada.faza_oczekiwanie')
    if (event.pauseRequested) phaseText += ' · ' + t('husariada.pauza_zaplanowana')
    phase.textContent = phaseText
    phase.className = 'hus-badge is-' + event.status

    var running = event.status === 'running'
    byId('hus-pause-btn').hidden = !running || event.pauseRequested
    byId('hus-resume-btn').hidden = !(event.status === 'paused' || event.pauseRequested)
    byId('hus-skip-btn').hidden = !running || event.phase === 'paused'

    var done = event.currentIndex + 1
    byId('hus-progress-bar').style.width = Math.max(0, Math.min(100, (done / event.questionCount) * 100)) + '%'
    byId('hus-live-answers').textContent = event.phase === 'question'
      ? t('husariada.odpowiedzi_na_pytanie', { count: state.currentAnswers })
      : ''
    renderStandings(byId('hus-live-standings'), state.standings || [])
  }

  function renderCommands() {
    var container = byId('hus-commands')
    clear(container)
    var failed = (state.recentCommands || []).filter(function (command) { return command.error })
    var pending = (state.recentCommands || []).filter(function (command) { return command.processedAt === null })
    if (pending.length > 0) {
      container.appendChild(el('p', { className: 'preview-note', text: t('husariada.polecenia_oczekujace', { count: pending.length }) }))
    }
    failed.slice(0, 2).forEach(function (command) {
      container.appendChild(el('p', { className: 'hus-command-error', text: '⚠️ ' + command.type + ': ' + command.error }))
    })
  }

  function renderState() {
    if (!state) return
    renderStatusCards()
    renderWarning()
    var event = state.event
    byId('hus-start-form').hidden = Boolean(event)
    byId('hus-live').hidden = !event
    if (event) renderLive(event)
    renderCommands()
  }

  function renderStartQuizOptions() {
    var select = byId('hus-start-quiz')
    var previous = select.value
    clear(select)
    var playable = quizzes.filter(function (quiz) { return quiz.questionCount > 0 })
    if (playable.length === 0) {
      select.appendChild(el('option', { text: t('husariada.brak_quizow_z_pytaniami') }))
      select.disabled = true
      byId('hus-start-btn').disabled = true
      return
    }
    select.disabled = false
    byId('hus-start-btn').disabled = false
    playable.forEach(function (quiz) {
      var option = el('option', { text: quiz.title + ' (' + t('husariada.pytan', { count: quiz.questionCount }) + ')' })
      option.value = quiz.id
      select.appendChild(option)
    })
    if (previous && playable.some(function (quiz) { return quiz.id === previous })) select.value = previous
  }

  function startEvent() {
    return withBusy(async function () {
      var rawCount = byId('hus-start-count').value.trim()
      await sendJson('/api/husariada/events', 'POST', {
        quizId: byId('hus-start-quiz').value,
        shuffle: byId('hus-start-shuffle').checked,
        questionCount: rawCount ? Number(rawCount) : null,
      })
      showToast(t('husariada.event_uruchomiony'), 'success')
      await loadState()
    })
  }

  function sendCommand(type) {
    if (!state || !state.event) return
    if (type === 'stop' && !global.confirm(t('husariada.potwierdz_zakonczenie'))) return
    var eventId = state.event.id
    return withBusy(async function () {
      await sendJson('/api/husariada/events/' + eventId + '/commands', 'POST', { type: type })
      showToast(t('husariada.polecenie_wyslane'), 'success')
      await loadState()
    })
  }

  // ─── Quizy ───────────────────────────────────────────────────────────────────

  async function loadQuizzes() {
    var body = await requestJson('/api/husariada/quizzes')
    quizzes = body.quizzes || []
    renderStartQuizOptions()
    renderQuizList()
  }

  function renderQuizList() {
    var list = byId('hus-quiz-list')
    clear(list)
    if (quizzes.length === 0) {
      list.appendChild(el('p', { className: 'hus-empty', text: t('husariada.brak_quizow') }))
      return
    }
    quizzes.forEach(function (quiz) {
      var item = el('button', {
        className: 'hus-quiz-item' + (quiz.id === selectedQuizId ? ' is-active' : ''),
        type: 'button',
        onClick: function () { void selectQuiz(quiz.id) },
      }, [
        el('strong', { text: quiz.title }),
        el('span', { text: t('husariada.pytan', { count: quiz.questionCount }) }),
      ])
      list.appendChild(item)
    })
  }

  async function selectQuiz(quizId) {
    selectedQuizId = quizId
    renderQuizList()
    try {
      await loadQuiz(quizId)
    } catch (error) {
      showToast(error.message, 'error')
    }
  }

  async function loadQuiz(quizId) {
    selectedQuiz = await requestJson('/api/husariada/quizzes/' + quizId)
    renderQuizEditor()
  }

  function createQuiz() {
    var title = global.prompt(t('husariada.podaj_tytul_quizu'))
    if (!title || !title.trim()) return
    return withBusy(async function () {
      var body = await sendJson('/api/husariada/quizzes', 'POST', { title: title.trim() })
      await loadQuizzes()
      await selectQuiz(body.quiz.id)
    })
  }

  function renameQuiz() {
    var quiz = selectedQuiz.quiz
    var title = global.prompt(t('husariada.podaj_tytul_quizu'), quiz.title)
    if (!title || !title.trim() || title.trim() === quiz.title) return
    return withBusy(async function () {
      await sendJson('/api/husariada/quizzes/' + quiz.id, 'PATCH', { title: title.trim() })
      await loadQuizzes()
      await loadQuiz(quiz.id)
    })
  }

  function deleteQuiz() {
    var quiz = selectedQuiz.quiz
    if (!global.confirm(t('husariada.potwierdz_usuniecie_quizu', { title: quiz.title }))) return
    return withBusy(async function () {
      await requestJson('/api/husariada/quizzes/' + quiz.id, { method: 'DELETE' })
      selectedQuizId = null
      selectedQuiz = null
      await loadQuizzes()
      renderQuizEditor()
      showToast(t('husariada.quiz_usuniety'), 'success')
    })
  }

  function moveQuestion(index, delta) {
    var questions = selectedQuiz.questions
    var target = index + delta
    if (target < 0 || target >= questions.length) return
    var ids = questions.map(function (question) { return question.id })
    var moved = ids.splice(index, 1)[0]
    ids.splice(target, 0, moved)
    return withBusy(async function () {
      var body = await sendJson('/api/husariada/quizzes/' + selectedQuiz.quiz.id + '/reorder', 'POST', { questionIds: ids })
      selectedQuiz.questions = body.questions
      renderQuizEditor()
    })
  }

  function deleteQuestion(question) {
    if (!global.confirm(t('husariada.potwierdz_usuniecie_pytania'))) return
    return withBusy(async function () {
      await requestJson('/api/husariada/questions/' + question.id, { method: 'DELETE' })
      await loadQuizzes()
      await loadQuiz(selectedQuiz.quiz.id)
    })
  }

  function buildQuestionCard(question, index, total, locked) {
    var answers = el('ol', { className: 'hus-question-answers' })
    question.answers.forEach(function (answer, answerIndex) {
      answers.appendChild(el('li', {
        className: answerIndex === question.correctIndex ? 'is-correct' : '',
        text: ANSWER_TAGS[answerIndex] + ' ' + answer + (answerIndex === question.correctIndex ? ' ✅' : ''),
      }))
    })

    var image = null
    if (question.imageUrl) {
      image = el('img', { className: 'hus-question-thumb' })
      image.src = question.imageUrl + '?v=' + question.updatedAt
      image.alt = ''
      image.loading = 'lazy'
    }

    var actions = locked ? null : el('div', { className: 'hus-question-actions' }, [
      el('button', { className: 'tasks-icon-btn', type: 'button', text: '↑', title: t('husariada.wyzej'), onClick: function () { void moveQuestion(index, -1) } }),
      el('button', { className: 'tasks-icon-btn', type: 'button', text: '↓', title: t('husariada.nizej'), onClick: function () { void moveQuestion(index, 1) } }),
      el('button', { className: 'btn-secondary', type: 'button', text: t('husariada.edytuj'), onClick: function () { openQuestionDialog(question) } }),
      el('button', { className: 'btn-danger', type: 'button', text: t('husariada.usun'), onClick: function () { void deleteQuestion(question) } }),
    ])
    if (actions) {
      actions.children[0].disabled = index === 0
      actions.children[1].disabled = index === total - 1
    }

    return el('article', { className: 'hus-question-card' }, [
      el('div', { className: 'hus-question-body' }, [
        el('span', { className: 'tasks-dialog-kicker', text: t('husariada.pytanie_nr', { number: index + 1 }) }),
        el('strong', { className: 'hus-question-prompt', text: question.prompt }),
        answers,
      ]),
      image,
      actions,
    ])
  }

  function renderQuizEditor() {
    var editor = byId('hus-quiz-editor')
    clear(editor)
    if (!selectedQuiz) {
      editor.appendChild(el('p', { className: 'hus-empty', text: t('husariada.wybierz_quiz') }))
      return
    }

    var quiz = selectedQuiz.quiz
    var locked = selectedQuiz.locked
    editor.appendChild(el('div', { className: 'hus-quiz-head' }, [
      el('div', {}, [
        el('h3', { className: 'hus-heading', text: quiz.title }),
        el('span', { className: 'preview-note', text: t('husariada.pytan', { count: selectedQuiz.questions.length }) }),
      ]),
      locked ? el('span', { className: 'hus-badge is-running', text: t('husariada.quiz_zablokowany') }) : el('div', { className: 'hus-actions' }, [
        el('button', { className: 'btn-primary', type: 'button', text: t('husariada.dodaj_pytanie'), onClick: function () { openQuestionDialog(null) } }),
        el('button', { className: 'btn-secondary', type: 'button', text: t('husariada.zmien_nazwe'), onClick: function () { void renameQuiz() } }),
        el('button', { className: 'btn-danger', type: 'button', text: t('husariada.usun_quiz'), onClick: function () { void deleteQuiz() } }),
      ]),
    ]))

    if (selectedQuiz.questions.length === 0) {
      editor.appendChild(el('p', { className: 'hus-empty', text: t('husariada.brak_pytan') }))
      return
    }
    var total = selectedQuiz.questions.length
    selectedQuiz.questions.forEach(function (question, index) {
      editor.appendChild(buildQuestionCard(question, index, total, locked))
    })
  }

  // ─── Dialog pytania ──────────────────────────────────────────────────────────

  function answerInputs() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-hus-answer]'))
  }

  function setImagePreview(src) {
    var preview = byId('hus-q-image-preview')
    preview.hidden = !src
    if (src) preview.src = src
    else preview.removeAttribute('src')
    byId('hus-q-image-remove').hidden = !src
  }

  function updatePromptCounter() {
    byId('hus-q-prompt-counter').textContent = byId('hus-q-prompt').value.length + '/300'
  }

  function openQuestionDialog(question) {
    editingQuestion = question
    pendingImage = undefined
    byId('hus-question-heading').textContent = question ? t('husariada.edytuj_pytanie') : t('husariada.nowe_pytanie')
    byId('hus-q-prompt').value = question ? question.prompt : ''
    answerInputs().forEach(function (input, index) {
      input.value = question ? question.answers[index] : ''
    })
    var correct = question ? question.correctIndex : 0
    document.querySelectorAll('input[name="hus-q-correct"]').forEach(function (radio) {
      radio.checked = Number(radio.value) === correct
    })
    byId('hus-q-image').value = ''
    setImagePreview(question && question.imageUrl ? question.imageUrl + '?v=' + question.updatedAt : null)
    updatePromptCounter()
    byId('hus-question-dialog').showModal()
    byId('hus-q-prompt').focus()
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader()
      reader.onload = function () { resolve(String(reader.result)) }
      reader.onerror = function () { reject(new Error(t('husariada.blad_pliku'))) }
      reader.readAsDataURL(file)
    })
  }

  async function onImageSelected(event) {
    var file = event.target.files && event.target.files[0]
    if (!file) return
    if (ALLOWED_TYPES.indexOf(file.type) === -1) {
      showToast(t('husariada.zly_typ_obrazka'), 'error')
      event.target.value = ''
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      showToast(t('husariada.za_duzy_obrazek'), 'error')
      event.target.value = ''
      return
    }
    var dataUrl = await readFileAsDataUrl(file)
    pendingImage = { mimeType: file.type, dataBase64: dataUrl }
    setImagePreview(dataUrl)
  }

  function removeImage() {
    pendingImage = editingQuestion && editingQuestion.imageUrl ? null : undefined
    byId('hus-q-image').value = ''
    setImagePreview(null)
  }

  function collectQuestionPayload() {
    var checked = document.querySelector('input[name="hus-q-correct"]:checked')
    var payload = {
      prompt: byId('hus-q-prompt').value.trim(),
      answers: answerInputs().map(function (input) { return input.value.trim() }),
      correctIndex: checked ? Number(checked.value) : 0,
    }
    if (!payload.prompt) throw new Error(t('husariada.wymagane_pytanie'))
    if (payload.answers.some(function (answer) { return !answer })) throw new Error(t('husariada.wymagane_odpowiedzi'))
    if (pendingImage !== undefined && (pendingImage !== null || editingQuestion)) payload.image = pendingImage
    return payload
  }

  function submitQuestion(event) {
    event.preventDefault()
    return withBusy(async function () {
      var payload = collectQuestionPayload()
      if (editingQuestion) {
        await sendJson('/api/husariada/questions/' + editingQuestion.id, 'PATCH', payload)
      } else {
        await sendJson('/api/husariada/quizzes/' + selectedQuiz.quiz.id + '/questions', 'POST', payload)
      }
      byId('hus-question-dialog').close()
      showToast(t('husariada.pytanie_zapisane'), 'success')
      await loadQuizzes()
      await loadQuiz(selectedQuiz.quiz.id)
    })
  }

  // ─── Ustawienia ──────────────────────────────────────────────────────────────

  async function loadSettings() {
    var body = await requestJson('/api/husariada/settings')
    SETTING_KEYS.forEach(function (key) {
      var input = byId('hus-set-' + key)
      var bounds = body.bounds[key]
      input.value = body.settings[key]
      input.min = bounds.min
      input.max = bounds.max
    })
  }

  function saveSettings(event) {
    event.preventDefault()
    return withBusy(async function () {
      var payload = {}
      SETTING_KEYS.forEach(function (key) { payload[key] = Number(byId('hus-set-' + key).value) })
      await sendJson('/api/husariada/settings', 'PUT', payload)
      showToast(t('husariada.ustawienia_zapisane'), 'success')
    })
  }

  // ─── Historia ────────────────────────────────────────────────────────────────

  async function loadHistory() {
    var body = await requestJson('/api/husariada/events')
    var list = byId('hus-history-list')
    clear(list)
    if (!body.events || body.events.length === 0) {
      list.appendChild(el('p', { className: 'hus-empty', text: t('husariada.brak_historii') }))
      return
    }
    body.events.forEach(function (event) {
      var details = el('ol', { className: 'hus-standings' })
      details.hidden = true
      var header = el('button', {
        className: 'hus-history-item',
        type: 'button',
        onClick: function () { void toggleHistoryDetails(event.id, details) },
      }, [
        el('strong', { text: event.quizTitle }),
        el('span', { className: 'hus-badge is-' + event.status, text: t('husariada.status_' + event.status) }),
        el('span', { className: 'preview-note', text: formatTimestampInWarsaw(event.startedAt || event.createdAt) + ' · ' + t('husariada.pytan', { count: event.questionCount }) }),
      ])
      list.appendChild(el('div', { className: 'hus-history-entry' }, [header, details]))
    })
  }

  async function toggleHistoryDetails(eventId, container) {
    if (!container.hidden) {
      container.hidden = true
      return
    }
    try {
      var body = await requestJson('/api/husariada/events/' + eventId)
      renderStandings(container, body.standings || [])
      container.hidden = false
    } catch (error) {
      showToast(error.message, 'error')
    }
  }

  // ─── Polling i inicjalizacja ─────────────────────────────────────────────────

  function stopPolling() {
    if (pollTimerId !== null) {
      clearInterval(pollTimerId)
      pollTimerId = null
    }
  }

  function startPolling() {
    if (pollTimerId !== null) return
    pollTimerId = setInterval(function () {
      if (!isSectionActive()) {
        stopPolling()
        return
      }
      if (activeTab !== 'control' || document.hidden) return
      loadState().catch(function () { /* kolejna proba za chwile */ })
    }, POLL_INTERVAL_MS)
  }

  function bindEvents() {
    document.querySelectorAll('[data-hus-tab]').forEach(function (button) {
      button.addEventListener('click', function () { switchTab(button.dataset.husTab) })
    })
    document.querySelectorAll('[data-hus-command]').forEach(function (button) {
      button.addEventListener('click', function () { void sendCommand(button.dataset.husCommand) })
    })
    byId('hus-refresh-btn').addEventListener('click', function () { void refreshActiveTab() })
    byId('hus-start-btn').addEventListener('click', function () { void startEvent() })
    byId('hus-new-quiz-btn').addEventListener('click', function () { void createQuiz() })
    byId('hus-question-form').addEventListener('submit', submitQuestion)
    byId('hus-q-prompt').addEventListener('input', updatePromptCounter)
    byId('hus-q-image').addEventListener('change', function (event) {
      onImageSelected(event).catch(function (error) { showToast(error.message, 'error') })
    })
    byId('hus-q-image-remove').addEventListener('click', removeImage)
    byId('hus-settings-form').addEventListener('submit', saveSettings)
  }

  global.loadHusariadaSection = function loadHusariadaSection() {
    if (!byId('section-husariada')) return
    if (!initialized) {
      initialized = true
      bindEvents()
      renderQuizEditor()
    }
    startPolling()
    return refreshActiveTab()
  }
})(window)
