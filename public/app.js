// =============================================================================
// SYNCNOTE (notes.oussamma.tn) — Frontend Controller
// Inspiré des maquettes SyncNote :
// - Multi-onglets dynamiques : Notes, Éditeur, Espaces, Activité
// - Zéro fausse donnée de test en dur : uniquement les notes, espaces et activités réels
// - Icônes SVG haute fidélité et palettes de couleurs exactes
// - Co-édition en temps réel (SSE + Traefik no-buffering + curseur préservé)
// =============================================================================

const state = {
  user: null,
  theme: localStorage.getItem('syncnote_theme') || 'light',
  currentTab: 'notes', // 'notes' | 'editor' | 'spaces' | 'activity'
  notes: [],
  folders: [],
  activities: [],
  filterType: 'all', // 'all' | 'pinned' | 'shared' | 'archived'
  searchQuery: '',
  editingNoteId: null,
  activeCollabToken: null,
  saveTimeout: null,
  sseConnection: null,
  userSseConnection: null,
  isRemoteUpdating: false
};

// =============================================================================
// GESTION DU THÈME
// =============================================================================
function applyTheme(themeName) {
  state.theme = themeName === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', state.theme);
  if (state.theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  localStorage.setItem('syncnote_theme', state.theme);

  const iconEl = document.getElementById('theme-icon-svg');
  if (iconEl) {
    if (state.theme === 'dark') {
      // Icône soleil
      iconEl.innerHTML = `
        <circle cx="12" cy="12" r="5"></circle>
        <line x1="12" y1="1" x2="12" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="23"></line>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
        <line x1="1" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="12" x2="23" y2="12"></line>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
      `;
    } else {
      // Icône lune
      iconEl.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
    }
  }
}

// =============================================================================
// UTILITAIRES
// =============================================================================
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Récemment';
  const diffSec = Math.floor((new Date() - new Date(dateStr)) / 1000);
  if (diffSec < 60) return "À l'instant";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Il y a ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `Il y a ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  return `Il y a ${diffDays} j`;
}

// =============================================================================
// INITIALISATION
// =============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(state.theme);

  const params = new URLSearchParams(window.location.search);
  const collabToken = params.get('collab');
  const authError = params.get('auth_error');

  if (authError) {
    const errBox = document.getElementById('auth-error-box');
    if (errBox) {
      errBox.textContent = `Erreur SSO : ${authError}`;
      errBox.classList.remove('hidden');
    }
  }

  try {
    const res = await fetch('/api/auth/me');
    const authData = await res.json();

    if (!authData.authenticated) {
      document.getElementById('auth-wall').classList.remove('hidden');
      return;
    }

    state.user = authData.user;
    const initial = (state.user.name || state.user.email || 'O')[0].toUpperCase();
    document.getElementById('user-avatar').textContent = initial;

    document.getElementById('auth-wall').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');

    await loadInitialData();
    bindEvents();
    connectUserLiveSSE();

    // Si on arrive avec un lien direct de partage : ?collab=TOKEN
    if (collabToken) {
      await handleOpenCollabLink(collabToken);
    }
  } catch (err) {
    console.error('Erreur initialisation SyncNote:', err);
    document.getElementById('auth-wall').classList.remove('hidden');
  }
});

// =============================================================================
// CHARGEMENT DES DONNÉES RÉELLES (Notes, Espaces, Activité)
// =============================================================================
async function loadInitialData() {
  await Promise.all([
    loadNotes(),
    loadFolders(),
    loadActivities()
  ]);
}

async function loadNotes() {
  try {
    const res = await fetch('/api/notes?archived=all');
    if (res.ok) {
      state.notes = await res.json();
      renderNotesView();
    }
  } catch (err) {
    console.error('Erreur chargement notes:', err);
  }
}

async function loadFolders() {
  try {
    const res = await fetch('/api/folders');
    if (res.ok) {
      state.folders = await res.json();
      renderSpacesView();
    }
  } catch (err) {
    console.error('Erreur chargement espaces:', err);
  }
}

async function loadActivities() {
  try {
    const res = await fetch('/api/activities');
    if (res.ok) {
      state.activities = await res.json();
      renderActivityView();
    }
  } catch (err) {
    console.error('Erreur chargement activités:', err);
  }
}

// =============================================================================
// GESTION DES ONGLETS (Bottom Navigation)
// =============================================================================
function switchTab(tabName) {
  state.currentTab = tabName;

  document.querySelectorAll('.bottom-nav .nav-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  const activePanel = document.getElementById(`view-${tabName}`);
  if (activePanel) activePanel.classList.add('active');

  const subtitle = document.getElementById('topbar-subtitle');
  if (subtitle) {
    const labels = { notes: 'Notes', editor: 'Éditeur', spaces: 'Espaces', activity: 'Activité' };
    subtitle.textContent = labels[tabName] || 'Notes';
  }

  const searchBar = document.getElementById('search-container');
  const pillsBar = document.getElementById('notes-pills-bar');

  if (tabName === 'editor') {
    searchBar?.classList.add('hidden');
    pillsBar?.classList.add('hidden');
  } else if (tabName === 'notes') {
    searchBar?.classList.remove('hidden');
    pillsBar?.classList.remove('hidden');
    renderNotesView();
  } else {
    searchBar?.classList.add('hidden');
    pillsBar?.classList.add('hidden');
    if (tabName === 'spaces') renderSpacesView();
    if (tabName === 'activity') renderActivityView();
  }
}

// =============================================================================
// RENDU DE LA VUE PRINCIPALE "NOTES"
// =============================================================================
function getFilteredNotes() {
  return state.notes.filter(note => {
    if (state.filterType === 'archived') {
      if (!note.archived) return false;
    } else if (state.filterType === 'pinned') {
      if (note.archived || !note.pinned) return false;
    } else if (state.filterType === 'shared') {
      if (note.archived || !note.isSharedWithMe) return false;
    } else {
      if (note.archived) return false;
    }

    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const inTitle = (note.title || '').toLowerCase().includes(q);
      const inContent = (note.content || '').toLowerCase().includes(q);
      const inTags = (note.tags || []).some(t => t.toLowerCase().includes(q));
      const inChk = (note.checklist || []).some(c => (c.text || '').toLowerCase().includes(q));
      if (!inTitle && !inContent && !inTags && !inChk) return false;
    }
    return true;
  });
}

function renderNotesView() {
  const activeNotes = state.notes.filter(n => !n.archived);
  const pinnedNotes = activeNotes.filter(n => n.pinned);
  const sharedNotes = state.notes.filter(n => !n.archived && n.isSharedWithMe);
  const archivedNotes = state.notes.filter(n => n.archived);

  document.getElementById('pill-count-all').textContent = activeNotes.length;
  document.getElementById('pill-count-pinned').textContent = pinnedNotes.length;
  document.getElementById('pill-count-shared').textContent = sharedNotes.length;
  document.getElementById('pill-count-archived').textContent = archivedNotes.length;
  document.getElementById('count-pinned-label').textContent = `${pinnedNotes.length} notes`;

  const filtered = getFilteredNotes();
  const pinnedWrap = document.getElementById('section-pinned-wrap');
  const pinnedList = document.getElementById('pinned-notes-list');
  const recentList = document.getElementById('recent-notes-list');

  if (state.filterType === 'all' && !state.searchQuery) {
    pinnedWrap.classList.toggle('hidden', pinnedNotes.length === 0);
    pinnedList.innerHTML = pinnedNotes.map(renderCardHtml).join('');

    const recent = filtered.filter(n => !n.pinned);
    if (recent.length === 0 && pinnedNotes.length === 0) {
      recentList.innerHTML = `
        <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted)">
          <div style="width: 48px; height: 48px; margin: 0 auto 12px auto; color: var(--sync-purple)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="12" y1="18" x2="12" y2="12"></line>
              <line x1="9" y1="15" x2="15" y2="15"></line>
            </svg>
          </div>
          <h3 style="font-size: 1.1rem; font-weight: 800; color: var(--text-main); margin-bottom: 4px">Aucune note pour l'instant</h3>
          <p style="font-size: 0.85rem">Cliquez sur "+ Nouvelle" ci-dessous pour rédiger une note ou partager avec un collaborateur.</p>
        </div>
      `;
    } else {
      recentList.innerHTML = recent.map(renderCardHtml).join('');
    }
  } else {
    pinnedWrap.classList.add('hidden');
    if (filtered.length === 0) {
      recentList.innerHTML = `
        <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted)">
          <p style="font-size: 0.9rem">Aucune note trouvée dans cette sélection.</p>
        </div>
      `;
    } else {
      recentList.innerHTML = filtered.map(renderCardHtml).join('');
    }
  }
}

// Rendu unitaire d'une carte SyncNote
function renderCardHtml(note) {
  const isCollab = Boolean(note.collabToken || note.isSharedWithMe);
  const cleanBody = (note.content || '').replace(/^- \[[ x]\]\s*.+$/gm, '').trim();

  // Tags badge
  const tags = Array.isArray(note.tags) && note.tags.length > 0 ? note.tags : ['#Projet'];
  const tagsHtml = tags.map(tag => {
    let cls = 'tag-strategy';
    if (tag.toLowerCase().includes('urgent')) cls = 'tag-urgent';
    else if (tag.toLowerCase().includes('ux') || tag.toLowerCase().includes('ui')) cls = 'tag-uiux';
    else if (tag.toLowerCase().includes('market')) cls = 'tag-marketing';
    return `<span class="tag-badge ${cls}">${escapeHtml(tag)}</span>`;
  }).join('');

  // Checklist items
  const chk = (note.checklist || []).slice(0, 3).map((item, idx) => `
    <label class="card-chk-row ${item.done ? 'done' : ''}">
      <input type="checkbox" data-chk-note="${note.id}" data-chk-idx="${idx}" ${item.done ? 'checked' : ''} />
      <span>${escapeHtml(item.text)}</span>
    </label>
  `).join('');

  const collabs = note.collaborators || [];
  const collabsHtml = collabs.slice(0, 3).map(c => `
    <div class="mini-avatar" title="${escapeHtml(c.name || c.email)}">
      ${(c.name || c.email || 'U')[0].toUpperCase()}
    </div>
  `).join('');

  return `
    <div class="sync-card" data-open-note-id="${note.id}">
      <div class="card-top-row">
        <div class="card-tags-list">
          ${tagsHtml}
        </div>
        <button class="icon-btn-ghost" data-card-options="${note.id}" title="Options" style="width: 28px; height: 28px">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="1"></circle>
            <circle cx="12" cy="5" r="1"></circle>
            <circle cx="12" cy="19" r="1"></circle>
          </svg>
        </button>
      </div>

      <div class="card-title">${escapeHtml(note.title || 'Sans titre')}</div>
      ${cleanBody ? `<div class="card-excerpt">${escapeHtml(cleanBody)}</div>` : ''}

      ${chk ? `<div class="card-checklist-box">${chk}</div>` : ''}

      <div class="card-bottom-row">
        <div style="display: flex; align-items: center; gap: 8px">
          ${isCollab && collabs.length > 0 ? `
            <div class="avatar-stack-mini">
              ${collabsHtml}
              ${collabs.length > 3 ? `<div class="mini-avatar badge-more">+${collabs.length - 3}</div>` : ''}
            </div>
            <span class="live-badge-inline"><span class="dot"></span> En direct</span>
          ` : `
            <span style="font-size: 0.74rem; color: var(--text-muted); font-weight: 600">
              ${note.isSharedWithMe ? '👥 Partagée' : '👤 Privé'}
            </span>
          `}
        </div>

        <div class="card-time-info">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span>${timeAgo(note.updatedAt || note.createdAt)}</span>
        </div>
      </div>
    </div>
  `;
}

// =============================================================================
// RENDU DE LA VUE ESPACES (Dossiers réels de l'utilisateur)
// =============================================================================
function renderSpacesView() {
  const container = document.getElementById('spaces-cards-list');
  const countEl = document.getElementById('spaces-count');
  if (!container) return;

  const folders = state.folders || [];
  if (countEl) countEl.textContent = folders.length;

  if (folders.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted)">
        <p style="font-size: 0.9rem">Aucun espace pour le moment. Cliquez sur "+ Créer" ci-dessus.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = folders.map((folder, idx) => {
    // Calculer les notes réelles associées à ce dossier
    const folderNotes = state.notes.filter(n => n.folderId === folder.id);
    const borderCls = idx % 3 === 0 ? '' : (idx % 3 === 1 ? 'accent-red' : 'accent-green');

    return `
      <div class="space-card ${borderCls}">
        <div class="space-card-header">
          <div class="space-icon-title">
            <div class="space-icon-box">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path>
              </svg>
            </div>
            <div>
              <div class="space-name">${escapeHtml(folder.name)}</div>
              <div class="space-desc">Espace de travail collaboratif</div>
            </div>
          </div>
          <button class="icon-btn-ghost" data-delete-folder="${folder.id}" title="Supprimer cet espace">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="space-badges-row">
          <span>📄 <strong>${folderNotes.length}</strong> note(s)</span>
          <span>•</span>
          <span>👥 <strong>1</strong> membre actif</span>
        </div>

        <div class="space-action-bar">
          <div class="avatar-stack-mini">
            <div class="mini-avatar">${(state.user?.name || 'U')[0].toUpperCase()}</div>
          </div>
          <button class="pill-item" style="padding: 4px 12px; font-size: 0.75rem" onclick="openCollabForCurrentNote()">
            + Partager
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// =============================================================================
// RENDU DE LA VUE ACTIVITÉ (Activités réelles générées par l'utilisateur)
// =============================================================================
function renderActivityView() {
  const container = document.getElementById('activity-feed-list');
  const countEl = document.getElementById('activity-count');
  if (!container) return;

  const acts = state.activities || [];
  if (countEl) countEl.textContent = acts.length;

  if (acts.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted)">
        <p style="font-size: 0.9rem">Aucune activité enregistrée pour le moment. Vos modifications apparaîtront ici.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = acts.map(act => `
    <div class="activity-card">
      <div class="activity-header">
        <div class="activity-user-row">
          <div class="activity-avatar">${(act.userName || 'U')[0].toUpperCase()}</div>
          <div>
            <div class="activity-title">${escapeHtml(act.title)}</div>
            <div class="activity-subtitle">📄 ${escapeHtml(act.noteTitle)}</div>
          </div>
        </div>
        <span class="activity-time">${timeAgo(act.timestamp)}</span>
      </div>
      ${act.diff ? `
        <div class="activity-diff-box">
          <span style="color: var(--sync-purple); font-weight: 700">Dernière modif :</span> ${escapeHtml(act.diff)}
        </div>
      ` : ''}
    </div>
  `).join('');
}

// =============================================================================
// ÉDITEUR MODERNE ENRICHI (Vue 'editor')
// =============================================================================
function openNoteInEditor(noteId) {
  const note = state.notes.find(n => n.id === noteId);
  if (!note) return;

  state.editingNoteId = note.id;
  state.activeCollabToken = note.collabToken || null;

  document.getElementById('editor-doc-title').value = note.title || '';
  document.getElementById('editor-doc-content').value = note.content || '';
  document.getElementById('editor-save-status').textContent = '⏱️ Synchronisé';
  document.getElementById('btn-editor-pin').classList.toggle('active', Boolean(note.pinned));

  renderEditorChecklist(note);
  updateEditorAvatars(note.collaborators || []);

  if (note.collabToken) {
    document.getElementById('editor-live-badge').classList.remove('hidden');
    connectLiveCollabSSE(note.collabToken);
  } else {
    document.getElementById('editor-live-badge').classList.add('hidden');
    disconnectLiveCollabSSE();
  }

  switchTab('editor');
}

function renderEditorChecklist(note) {
  const container = document.getElementById('editor-checklist-container');
  if (!container) return;
  const list = note.checklist || [];

  if (list.length === 0) {
    container.innerHTML = `
      <div style="font-size: 0.8rem; color: var(--text-muted); padding: 4px">
        Aucun objectif pour l'instant. Cliquez sur "+" ci-dessus pour en ajouter.
      </div>
    `;
    return;
  }

  container.innerHTML = list.map((item, idx) => `
    <div class="card-chk-row ${item.done ? 'done' : ''}">
      <input type="checkbox" data-editor-chk-idx="${idx}" ${item.done ? 'checked' : ''} />
      <span style="flex: 1">${escapeHtml(item.text)}</span>
      <button class="icon-btn-ghost" data-editor-del-chk="${idx}" style="width: 22px; height: 22px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  `).join('');
}

function updateEditorAvatars(collabs) {
  const stack = document.getElementById('editor-avatars-stack');
  if (!stack) return;
  stack.innerHTML = collabs.map(c => `
    <div class="mini-avatar" title="${escapeHtml(c.name || c.email)}">
      ${(c.name || c.email || 'U')[0].toUpperCase()}
    </div>
  `).join('');
}

function scheduleEditorAutoSave() {
  if (state.isRemoteUpdating) return;
  const statusEl = document.getElementById('editor-save-status');
  if (statusEl) statusEl.textContent = '⏳ Enregistrement...';

  if (state.saveTimeout) clearTimeout(state.saveTimeout);
  state.saveTimeout = setTimeout(saveEditorNoteNow, 200);
}

async function saveEditorNoteNow() {
  const note = state.notes.find(n => n.id === state.editingNoteId);
  if (!note) return;

  const title = document.getElementById('editor-doc-title').value;
  const content = document.getElementById('editor-doc-content').value;

  note.title = title.trim() || 'Document sans titre';
  note.content = content;

  try {
    let res;
    if (note.collabToken) {
      res = await fetch(`/api/collab/${note.collabToken}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: note.title,
          content: note.content,
          checklist: note.checklist
        })
      });
    } else {
      res = await fetch(`/api/notes/${note.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note)
      });
    }

    if (res.ok) {
      const data = await res.json();
      const updated = data.note || data;
      const idx = state.notes.findIndex(n => n.id === updated.id);
      if (idx >= 0) state.notes[idx] = { ...state.notes[idx], ...updated };

      const statusEl = document.getElementById('editor-save-status');
      if (statusEl) statusEl.textContent = '⏱️ Synchronisé';
      renderNotesView();
      loadActivities(); // Rafraîchir l'activité en temps réel
    }
  } catch (err) {
    console.error('Erreur sauvegarde éditeur:', err);
  }
}

// Création d'une nouvelle note via le FAB "+ Nouvelle"
async function handleCreateNewNote() {
  try {
    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Nouvelle note',
        content: '',
        tags: ['#Projet'],
        checklist: []
      })
    });

    if (res.ok) {
      const created = await res.json();
      state.notes.unshift(created);
      renderNotesView();
      openNoteInEditor(created.id);
      showToast('✨ Nouvelle note créée');
    }
  } catch (err) {
    console.error('Erreur création note:', err);
  }
}

// =============================================================================
// SYNCHRONISATION TEMPS RÉEL (SSE)
// =============================================================================
function connectLiveCollabSSE(collabToken) {
  disconnectLiveCollabSSE();

  const es = new EventSource(`/api/collab/${collabToken}/live`);
  state.sseConnection = es;

  es.addEventListener('note_updated', e => {
    try {
      const data = JSON.parse(e.data);
      const updatedNote = data.note;

      const idx = state.notes.findIndex(n => n.id === updatedNote.id);
      if (idx >= 0) state.notes[idx] = { ...state.notes[idx], ...updatedNote };
      else state.notes.unshift(updatedNote);

      if (state.editingNoteId === updatedNote.id && state.currentTab === 'editor') {
        state.isRemoteUpdating = true;
        const titleInput = document.getElementById('editor-doc-title');
        const contentInput = document.getElementById('editor-doc-content');

        if (titleInput && titleInput.value !== updatedNote.title) {
          const isFocused = document.activeElement === titleInput;
          const s = titleInput.selectionStart;
          const end = titleInput.selectionEnd;
          titleInput.value = updatedNote.title || '';
          if (isFocused) titleInput.setSelectionRange(s, end);
        }

        if (contentInput && contentInput.value !== updatedNote.content) {
          const isFocused = document.activeElement === contentInput;
          const s = contentInput.selectionStart;
          const end = contentInput.selectionEnd;
          contentInput.value = updatedNote.content || '';
          if (isFocused) contentInput.setSelectionRange(s, end);
        }

        renderEditorChecklist(updatedNote);
        updateEditorAvatars(updatedNote.collaborators || []);

        const pill = document.getElementById('editor-typing-pill');
        const nameEl = document.getElementById('editor-typing-name');
        if (pill && nameEl && data.updatedBy) {
          nameEl.textContent = `${data.updatedBy} écrit...`;
          pill.style.display = 'inline-flex';
          setTimeout(() => { pill.style.display = 'none'; }, 2000);
        }

        setTimeout(() => { state.isRemoteUpdating = false; }, 150);
      }

      renderNotesView();
    } catch (err) {
      console.error('Erreur live SSE:', err);
    }
  });

  es.addEventListener('participant_joined', e => {
    try {
      const data = JSON.parse(e.data);
      showToast(`👋 ${data.user.name} a rejoint cette note !`);
      updateEditorAvatars(data.collaborators || []);
    } catch (err) {}
  });
}

function disconnectLiveCollabSSE() {
  if (state.sseConnection) {
    state.sseConnection.close();
    state.sseConnection = null;
  }
}

function connectUserLiveSSE() {
  if (state.userSseConnection) {
    state.userSseConnection.close();
  }
  const es = new EventSource('/api/user/live');
  state.userSseConnection = es;

  es.addEventListener('note_updated', e => {
    try {
      const data = JSON.parse(e.data);
      const updatedNote = data.note;
      if (!updatedNote?.id) return;

      const idx = state.notes.findIndex(n => n.id === updatedNote.id);
      if (idx >= 0) state.notes[idx] = { ...state.notes[idx], ...updatedNote };
      else state.notes.unshift({ ...updatedNote, isSharedWithMe: true });

      renderNotesView();
      loadActivities();
    } catch (err) {}
  });
}

// =============================================================================
// MODAL COLLABORATION
// =============================================================================
async function openCollabForCurrentNote() {
  let note = state.notes.find(n => n.id === state.editingNoteId);
  if (!note && state.notes.length > 0) note = state.notes[0];
  if (!note) return;

  try {
    const res = await fetch(`/api/notes/${note.id}/collaborate`, { method: 'POST' });
    if (!res.ok) return;

    const data = await res.json();
    note.collabToken = data.collabToken;

    const urlInput = document.getElementById('collab-share-url-input');
    urlInput.value = data.collabUrl;

    const countEl = document.getElementById('collab-participants-count');
    const listEl = document.getElementById('collab-participants-list');
    const collabs = data.note.collaborators || [];
    countEl.textContent = collabs.length;

    listEl.innerHTML = collabs.length === 0
      ? `<div style="font-size:0.8rem;color:var(--text-muted)">Aucun collaborateur pour l'instant. Envoyez-leur ce lien !</div>`
      : collabs.map(c => `
        <div style="display:flex;align-items:center;gap:8px;font-size:0.82rem">
          <div class="mini-avatar">${(c.name || c.email || 'U')[0].toUpperCase()}</div>
          <strong>${escapeHtml(c.name || c.email)}</strong>
        </div>
      `).join('');

    document.getElementById('modal-collab').classList.remove('hidden');
  } catch (err) {
    console.error('Erreur collaboration:', err);
  }
}

async function handleOpenCollabLink(token) {
  try {
    const res = await fetch(`/api/collab/${token}`);
    if (!res.ok) {
      showToast('❌ Lien de collaboration introuvable');
      return;
    }
    const data = await res.json();
    const joined = { ...data.note, ownerId: data.ownerId, isSharedWithMe: true };

    const idx = state.notes.findIndex(n => n.id === joined.id);
    if (idx >= 0) state.notes[idx] = joined;
    else state.notes.unshift(joined);

    renderNotesView();
    openNoteInEditor(joined.id);
    showToast('👥 Vous êtes connecté à cette note en direct !');
    window.history.replaceState({}, document.title, window.location.pathname);
  } catch (err) {
    console.error('Erreur ouverture lien collab:', err);
  }
}

// =============================================================================
// ÉVÉNEMENTS GLOBAUX
// =============================================================================
function bindEvents() {
  // Thème
  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    const next = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    showToast(next === 'dark' ? '🌙 Mode Sombre' : '☀️ Mode Clair');
  });

  // Bottom Navigation Tabs
  document.querySelectorAll('.bottom-nav .nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Filtres en capsules (Pills)
  document.querySelectorAll('#notes-pills-bar .pill-item').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#notes-pills-bar .pill-item').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.filterType = pill.dataset.filter;
      renderNotesView();
    });
  });

  // Recherche
  const searchInput = document.getElementById('global-search-input');
  searchInput?.addEventListener('input', e => {
    state.searchQuery = e.target.value.trim();
    renderNotesView();
  });
  document.getElementById('btn-reset-search')?.addEventListener('click', () => {
    if (searchInput) {
      searchInput.value = '';
      state.searchQuery = '';
      renderNotesView();
    }
  });

  // Clic sur une carte pour ouvrir dans l'éditeur
  document.addEventListener('click', e => {
    const card = e.target.closest('[data-open-note-id]');
    if (card && !e.target.closest('input[type="checkbox"]') && !e.target.closest('[data-card-options]')) {
      openNoteInEditor(card.dataset.openNoteId);
      return;
    }

    // Options de carte (Épingler / Supprimer)
    const optBtn = e.target.closest('[data-card-options]');
    if (optBtn) {
      e.stopPropagation();
      const nId = optBtn.dataset.cardOptions;
      const note = state.notes.find(n => n.id === nId);
      if (note) {
        const choice = confirm(`Note : "${note.title}"\n\nCliquez sur OK pour Épingler/Désépingler, ou Annuler pour fermer.`);
        if (choice) {
          note.pinned = !note.pinned;
          fetch(`/api/notes/${note.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(note)
          }).then(() => renderNotesView());
        }
      }
      return;
    }

    // Supprimer un espace
    const delFolderBtn = e.target.closest('[data-delete-folder]');
    if (delFolderBtn) {
      e.stopPropagation();
      const fId = delFolderBtn.dataset.deleteFolder;
      if (confirm('Supprimer cet espace de travail ?')) {
        fetch(`/api/folders/${fId}`, { method: 'DELETE' })
          .then(res => res.json())
          .then(data => {
            state.folders = data.folders || [];
            renderSpacesView();
            showToast('🗑️ Espace supprimé');
          });
      }
      return;
    }

    // Fermeture de modale
    const closeBtn = e.target.closest('[data-close-modal]');
    if (closeBtn) {
      const modalId = closeBtn.dataset.closeModal;
      document.getElementById(modalId)?.classList.add('hidden');
    }
  });

  // Case à cocher sur la carte
  document.addEventListener('change', async e => {
    if (e.target.matches('input[data-chk-note]')) {
      const nId = e.target.dataset.chkNote;
      const idx = Number(e.target.dataset.chkIdx);
      const note = state.notes.find(n => n.id === nId);
      if (note && note.checklist && note.checklist[idx]) {
        note.checklist[idx].done = e.target.checked;
        await fetch(note.collabToken ? `/api/collab/${note.collabToken}` : `/api/notes/${note.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(note)
        });
        renderNotesView();
      }
    }
  });

  // Création d'espace réel
  document.getElementById('btn-create-space')?.addEventListener('click', async () => {
    const spaceName = prompt("Nom du nouvel espace :");
    if (!spaceName || !spaceName.trim()) return;

    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: spaceName.trim(), icon: '📁', color: '#4f46e5' })
      });
      if (res.ok) {
        const created = await res.json();
        state.folders.push(created);
        renderSpacesView();
        showToast('📁 Espace créé');
      }
    } catch (err) {
      console.error('Erreur création espace:', err);
    }
  });

  // FAB "+ Nouvelle"
  document.getElementById('btn-fab-new-note')?.addEventListener('click', handleCreateNewNote);

  // Saisie dans l'éditeur
  document.getElementById('editor-doc-title')?.addEventListener('input', scheduleEditorAutoSave);
  document.getElementById('editor-doc-content')?.addEventListener('input', scheduleEditorAutoSave);

  // Partager collab depuis l'éditeur
  document.getElementById('btn-editor-collab-share')?.addEventListener('click', openCollabForCurrentNote);
  document.getElementById('btn-toolbar-collab')?.addEventListener('click', openCollabForCurrentNote);

  // Épingler depuis l'éditeur
  document.getElementById('btn-editor-pin')?.addEventListener('click', () => {
    const note = state.notes.find(n => n.id === state.editingNoteId);
    if (!note) return;
    note.pinned = !note.pinned;
    document.getElementById('btn-editor-pin').classList.toggle('active', note.pinned);
    scheduleEditorAutoSave();
    showToast(note.pinned ? '📌 Note épinglée' : 'Note désépinglée');
  });

  // Ajouter une tâche dans l'éditeur
  document.getElementById('btn-add-editor-task')?.addEventListener('click', () => {
    const note = state.notes.find(n => n.id === state.editingNoteId);
    if (!note) return;
    const taskName = prompt('Nom de la nouvelle tâche :');
    if (!taskName || !taskName.trim()) return;
    if (!Array.isArray(note.checklist)) note.checklist = [];
    note.checklist.push({ id: `chk_${Date.now()}`, text: taskName.trim(), done: false });
    renderEditorChecklist(note);
    scheduleEditorAutoSave();
  });

  // Cocher ou supprimer une tâche dans l'éditeur
  document.getElementById('editor-checklist-container')?.addEventListener('change', e => {
    if (e.target.matches('input[data-editor-chk-idx]')) {
      const idx = Number(e.target.dataset.editorChkIdx);
      const note = state.notes.find(n => n.id === state.editingNoteId);
      if (note?.checklist?.[idx]) {
        note.checklist[idx].done = e.target.checked;
        scheduleEditorAutoSave();
      }
    }
  });
  document.getElementById('editor-checklist-container')?.addEventListener('click', e => {
    const delBtn = e.target.closest('[data-editor-del-chk]');
    if (delBtn) {
      const idx = Number(delBtn.dataset.editorDelChk);
      const note = state.notes.find(n => n.id === state.editingNoteId);
      if (note?.checklist) {
        note.checklist.splice(idx, 1);
        renderEditorChecklist(note);
        scheduleEditorAutoSave();
      }
    }
  });

  // Copier le lien de collaboration
  document.getElementById('btn-copy-collab-url')?.addEventListener('click', () => {
    const val = document.getElementById('collab-share-url-input').value;
    navigator.clipboard.writeText(val);
    showToast('📋 Lien de collaboration copié !');
  });
}
