/* ─── Embed type definitions ─────────────────────────────────────────── */
const EMBED_TYPES = {
  announcement: {
    label: '📢 Ogłoszenie',
    color: '#dc143c',
    buildFields: () => [
      { id: 'title',       label: 'Tytuł',   type: 'text',     required: true,  placeholder: 'np. Ważna informacja' },
      { id: 'description', label: 'Treść',   type: 'textarea', required: true,  placeholder: '**Pogrubiony** tekst\n*Kursywa*\n`kod`' },
      { id: 'colorName',   label: 'Kolor',   type: 'color-swatches' },
    ],
  },
  welcome: {
    label: '👋 Powitanie',
    color: '#dc143c',
    buildFields: () => [
      { id: 'message',  label: 'Wiadomość powitalna', type: 'textarea', required: true, placeholder: 'Witamy Cię w szeregach Husarii!' },
      { id: 'imageUrl', label: 'URL bannera',         type: 'text',     required: false, placeholder: 'https://...' },
    ],
  },
  rulebook: {
    label: '📋 Regulamin',
    color: '#dc143c',
    buildFields: () => [
      { id: 'rulesText', label: 'Treść regulaminu', type: 'textarea', required: true, rows: 8, placeholder: '1. Szanuj innych...' },
    ],
  },
  zgloszenia: {
    label: '📬 Zgłoszenia',
    color: '#dc143c',
    buildFields: () => [
      { id: 'infoText', label: 'Tekst informacyjny', type: 'textarea', required: true, placeholder: 'Opis systemu zgłoszeń...' },
    ],
  },
};

const COLOR_MAP = { czerwony: '#dc143c', biały: '#f5f5f5', szary: '#99aab5', złoty: '#ffd700' };

/* ─── State ──────────────────────────────────────────────────────────── */
let currentType     = 'announcement';
let selectedColor   = 'czerwony';
let currentSection  = 'embed-creator';
let selectedImage   = null;

/* ─── Init ───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initSidebarNav();
  switchSection(currentSection);
  loadUserInfo();
});

/* ─── Sidebar navigation ─────────────────────────────────────────────── */
function initSidebarNav() {
  document.querySelectorAll('.sidebar-item[data-section]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const section = item.dataset.section;
      switchSection(section);
    });
  });
}

/* ─── User info ──────────────────────────────────────────────────────── */
async function loadUserInfo() {
  try {
    const resp = await fetch('/api/me');
    if (!resp.ok) { window.location.href = '/auth/discord'; return; }
    const { user } = await resp.json();
    const container = document.getElementById('navbar-user');
    const avatarUrl = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
      : null;

    container.innerHTML = `
      <div class="user-info">
        ${avatarUrl
          ? `<img class="user-avatar" src="${avatarUrl}" alt="avatar">`
          : `<div class="user-avatar-placeholder">👤</div>`}
        <span class="user-name">${escapeHtml(user.globalName || user.username)}</span>
        <a href="/auth/logout" class="btn-logout">Wyloguj</a>
      </div>`;
  } catch {
    window.location.href = '/auth/discord';
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   EMBED CREATOR
   ═══════════════════════════════════════════════════════════════════════ */
function initEmbedSection() {
  loadChannels('channel-select');
  renderTypeTabs();
  renderFields(currentType);
  initTypeTabListeners();
  initSendButton();
}

/* ─── Channels ───────────────────────────────────────────────────────── */
async function loadChannels(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  try {
    const resp = await fetch('/api/channels');
    if (!resp.ok) throw new Error('fetch failed');
    const { channels } = await resp.json();

    select.innerHTML = `<option value="">— wybierz kanał —</option>` +
      channels.map(c => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');

    select.disabled = false;
    if (selectId === 'channel-select') {
      updateSendButton();
      select.addEventListener('change', updateSendButton);
    }
    if (selectId === 'img-channel-select') {
      updateImageSendButton();
      select.addEventListener('change', updateImageSendButton);
    }
  } catch {
    select.innerHTML = `<option value="">Błąd pobierania kanałów</option>`;
    showToast('Nie udało się pobrać kanałów.', 'error');
  }
}

/* ─── Type tabs ──────────────────────────────────────────────────────── */
function renderTypeTabs() {
  const tabs = document.getElementById('type-tabs');
  if (!tabs) return;
  tabs.innerHTML = Object.entries(EMBED_TYPES).map(([key, def]) =>
    `<button class="type-tab${key === currentType ? ' active' : ''}" data-type="${key}">${def.label}</button>`
  ).join('');
}

function initTypeTabListeners() {
  const tabs = document.getElementById('type-tabs');
  if (!tabs) return;
  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.type-tab');
    if (!btn) return;
    const type = btn.dataset.type;
    if (type === currentType) return;

    currentType  = type;
    selectedColor = 'czerwony';

    document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');

    renderFields(type);
    updatePreview();
  });
}

/* ─── Dynamic fields ─────────────────────────────────────────────────── */
function renderFields(type) {
  const container = document.getElementById('dynamic-fields');
  if (!container) return;
  const defs = EMBED_TYPES[type]?.buildFields() ?? [];

  container.innerHTML = defs.map(field => buildFieldHtml(field)).join('');

  container.querySelectorAll('input, textarea, select').forEach(el => {
    el.addEventListener('input', updatePreview);
    el.addEventListener('change', updatePreview);
  });

  container.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      selectedColor = sw.dataset.color;
      container.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      updatePreview();
    });
    if (sw.dataset.color === selectedColor) sw.classList.add('active');
  });

  updatePreview();
}

function buildFieldHtml(field) {
  const optional = !field.required ? `<span class="optional">(opcjonalnie)</span>` : '';

  if (field.type === 'color-swatches') {
    return `<div class="form-group">
      <label class="form-label">Kolor embeda</label>
      <div class="color-swatches">
        <div class="color-swatch" data-color="czerwony" title="Czerwony"></div>
        <div class="color-swatch" data-color="biały"    title="Biały"></div>
        <div class="color-swatch" data-color="szary"    title="Szary"></div>
        <div class="color-swatch" data-color="złoty"    title="Złoty"></div>
      </div>
    </div>`;
  }

  const rows        = field.rows      ? ` rows="${field.rows}"` : ' rows="4"';
  const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : '';

  if (field.type === 'textarea') {
    return `<div class="form-group">
      <label class="form-label" for="${field.id}">${field.label} ${optional}</label>
      <textarea id="${field.id}" name="${field.id}" class="form-textarea"${rows}${placeholder}></textarea>
    </div>`;
  }

  return `<div class="form-group">
    <label class="form-label" for="${field.id}">${field.label} ${optional}</label>
    <input type="${field.type}" id="${field.id}" name="${field.id}" class="form-input"${placeholder}>
  </div>`;
}

/* ─── Preview ────────────────────────────────────────────────────────── */
function updatePreview() {
  const data = collectFormData();
  const def  = EMBED_TYPES[currentType];

  let barColor = def.color;
  if (currentType === 'announcement') barColor = COLOR_MAP[selectedColor] ?? def.color;
  document.getElementById('embed-color-bar').style.background = barColor;

  const desc   = document.getElementById('preview-description');
  const fields = document.getElementById('preview-fields');

  switch (currentType) {
    case 'announcement':
      desc.innerHTML   = renderPreviewText(data.title, data.description);
      fields.innerHTML = '';
      break;
    case 'welcome':
      desc.innerHTML   = renderPreviewText('Witaj na Husarii!', data.message);
      fields.innerHTML = '';
      break;
    case 'rulebook':
      desc.innerHTML   = renderPreviewText('Regulamin serwera G2 Hussars', data.rulesText);
      fields.innerHTML = '';
      break;
    case 'zgloszenia':
      desc.innerHTML   = renderPreviewText('Zgłoszenia', data.infoText);
      fields.innerHTML = '';
      break;
  }

  updateSendButton();
}

function renderPreviewText(title, body) {
  const titleHtml = title
    ? `<span class="embed-h1">${escapeHtml(title)}</span>`
    : '';
  const bodyHtml = body
    ? renderMarkdown(body)
    : '<span style="opacity:.45">Wypełnij formularz…</span>';
  return titleHtml + bodyHtml;
}

function previewFields(defs) {
  return defs.map(f => `
    <div class="embed-field${f.inline ? '' : ' full'}">
      <div class="embed-field-name">${escapeHtml(f.name)}</div>
      <div class="embed-field-value">${escapeHtml(String(f.value))}</div>
    </div>`).join('');
}

/* ─── Markdown renderer (Discord subset) ─────────────────────────────── */
function renderMarkdown(text) {
  if (!text) return '';

  // Escape HTML first, then apply markdown on top
  let html = escapeHtml(text);

  // Code blocks (```…```)
  html = html.replace(/```([\s\S]*?)```/g, '<pre class="md-codeblock">$1</pre>');
  // Inline code (`…`)
  html = html.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>');
  // Bold+italic (***…***)
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold (**…**)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic (*…* or _…_)
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  // Underline (__…__)
  html = html.replace(/__(.+?)__/g, '<u>$1</u>');
  // Strikethrough (~~…~~)
  html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');
  // Block quote (> …)
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote class="md-quote">$1</blockquote>');
  // Newlines → <br>
  html = html.replace(/\n/g, '<br>');

  return html;
}

/* ─── Collect form data ──────────────────────────────────────────────── */
function collectFormData() {
  const data = { type: currentType, colorName: selectedColor };
  document.querySelectorAll('#dynamic-fields input, #dynamic-fields textarea').forEach(el => {
    data[el.id] = el.value;
  });
  data.channelId = document.getElementById('channel-select')?.value ?? '';
  return data;
}

/* ─── Send button ────────────────────────────────────────────────────── */
function updateSendButton() {
  const btn     = document.getElementById('send-btn');
  const channel = document.getElementById('channel-select')?.value;
  if (btn) btn.disabled = !channel;
}

function initSendButton() {
  document.getElementById('send-btn')?.addEventListener('click', sendEmbed);
}

async function sendEmbed() {
  const btn     = document.getElementById('send-btn');
  const btnText = document.getElementById('send-btn-text');
  const data    = collectFormData();

  btn.disabled = true;
  btn.classList.add('loading');
  btnText.textContent = 'Wysyłanie…';

  try {
    const resp = await fetch('/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error ?? 'Nieznany błąd');

    showToast('✅ Embed wysłany pomyślnie!', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    btn.classList.remove('loading');
    btnText.textContent = 'Wyślij embed';
    updateSendButton();
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   IMAGE SENDER
   ═══════════════════════════════════════════════════════════════════════ */
async function initImageSection() {
  const sendButton = document.getElementById('img-send-btn');
  if (sendButton) {
    sendButton.addEventListener('click', sendImage);
  }

  await Promise.all([
    loadChannels('img-channel-select'),
    loadImages(),
  ]);
}

async function loadImages() {
  const grid = document.getElementById('image-grid');
  if (!grid) return;
  grid.innerHTML = '<p class="img-loading">Ładowanie obrazów…</p>';

  try {
    const resp = await fetch('/api/images');
    if (!resp.ok) throw new Error('fetch failed');
    const { images } = await resp.json();

    if (!images.length) {
      grid.innerHTML = '<p class="img-empty">Brak obrazów w folderze /img.</p>';
      return;
    }

    grid.innerHTML = images.map(name => `
      <div class="img-card" data-name="${escapeHtml(name)}" title="${escapeHtml(name)}">
        <img src="/img/${encodeURIComponent(name)}" alt="${escapeHtml(name)}" loading="lazy">
        <span class="img-card-name">${escapeHtml(name)}</span>
      </div>`).join('');

    grid.querySelectorAll('.img-card').forEach(card => {
      card.addEventListener('click', () => {
        grid.querySelectorAll('.img-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedImage = card.dataset.name;
        updateImageSendButton();
      });
    });
  } catch {
    grid.innerHTML = '<p class="img-error">Błąd pobierania obrazów.</p>';
    showToast('Nie udało się pobrać listy obrazów.', 'error');
  }
}

function updateImageSendButton() {
  const btn     = document.getElementById('img-send-btn');
  const channel = document.getElementById('img-channel-select')?.value;
  if (btn) btn.disabled = !(selectedImage && channel);
}

async function sendImage() {
  const btn     = document.getElementById('img-send-btn');
  const btnText = document.getElementById('img-send-btn-text');
  const channel = document.getElementById('img-channel-select')?.value;

  if (!selectedImage || !channel) return;

  btn.disabled = true;
  btn.classList.add('loading');
  btnText.textContent = 'Wysyłanie…';

  try {
    const resp = await fetch('/api/send-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: selectedImage, channelId: channel }),
    });

    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error ?? 'Nieznany błąd');

    showToast('✅ Obraz wysłany pomyślnie!', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    btn.classList.remove('loading');
    btnText.textContent = 'Wyślij obraz';
    updateImageSendButton();
  }
}

/* ─── Section init hook ──────────────────────────────────────────────── */
const SECTION_INIT = {
  'embed-creator': initEmbedSection,
  'image-sender':  initImageSection,
};
const _sectionInitialized = new Set();

function switchSection(section) {
  currentSection = section;
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  const active = document.querySelector(`.sidebar-item[data-section="${section}"]`);
  if (active) active.classList.add('active');

  document.querySelectorAll('.section-panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById(`section-${section}`);
  if (panel) panel.style.display = '';

  if (!_sectionInitialized.has(section) && SECTION_INIT[section]) {
    _sectionInitialized.add(section);
    SECTION_INIT[section]();
  }
}

/* ─── Toast ──────────────────────────────────────────────────────────── */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/* ─── Utils ──────────────────────────────────────────────────────────── */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
