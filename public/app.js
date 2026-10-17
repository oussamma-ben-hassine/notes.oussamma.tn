// =============================================================================
// NOTES (notes.oussamma.tn) — Contrôleur Frontend Style Google Keep & Co-édition
// Simple, Rapide, Clair, Multi-personnes en temps réel via lien
// =============================================================================

const state = {
  user: null,
  theme: localStorage.getItem('notevault_theme') || localStorage.getItem('collify_theme') || 'light',
  notes: [],
  filterType: 'all', // 'all' | 'shared' | 'pinned' | 'archived'
  searchQuery: '',
  quickColor: 'default',
  editingNoteId: null,
  activeCollabToken: null,
  saveTimeout: null,
  sseConnection: null,
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
  localStorage.setItem('notevault_theme', state.theme);
  localStorage.setItem('collify_theme', state.theme);
  const icon = document.getElementById('theme-toggle-icon');
  if (icon) {
    icon.textContent = state.theme === 'dark' ? '☀️' : '🌙';
  }
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) {
    btn.title = state.theme === 'dark' ? 'Passer en Mode Clair (Blanc)' : 'Passer en Mode Sombre (Noir)';
  }
}

// =============================================================================
// UTILITAIRES & NOTIFICATIONS
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
  setTimeout(() => el.remove(), 3200);
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
      errBox.textContent = `Erreur d'authentification SSO : ${authError}`;
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
    document.getElementById('user-name').textContent = state.user.name || state.user.email;
    document.getElementById('user-avatar').textContent = (state.user.name || state.user.email || 'U')[0].toUpperCase();

    document.getElementById('auth-wall').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');

    await loadNotes();
    bindEvents();
    connectUserLiveSSE();

    // Si l'utilisateur est arrivé via un lien de collaboration : ?collab=TOKEN
    if (collabToken) {
      await handleOpenCollabLink(collabToken);
    }
  } catch (err) {
    console.error('Erreur initialisation:', err);
    document.getElementById('auth-wall').classList.remove('hidden');
  }
});

// =============================================================================
// CHARGEMENT & FILTRAGE DES NOTES
// =============================================================================
async function loadNotes() {
  try {
    const res = await fetch('/api/notes?archived=all');
    if (res.ok) {
      state.notes = await res.json();
      renderAllNotes();
    }
  } catch (err) {
    console.error('Erreur chargement notes:', err);
  }
}

function getFilteredNotes() {
  return state.notes.filter(note => {
    // Filtres de section
    if (state.filterType === 'archived') {
      if (!note.archived) return false;
    } else if (state.filterType === 'pinned') {
      if (note.archived || !note.pinned) return false;
    } else if (state.filterType === 'shared') {
      if (note.archived || !note.isSharedWithMe) return false;
    } else {
      // 'all'
      if (note.archived) return false;
    }

    // Recherche
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const inTitle = (note.title || '').toLowerCase().includes(q);
      const inContent = (note.content || '').toLowerCase().includes(q);
      const inCheck = (note.checklist || []).some(c => (c.text || '').toLowerCase().includes(q));
      if (!inTitle && !inContent && !inCheck) return false;
    }

    return true;
  });
}

function renderAllNotes() {
  renderSidebarCounts();

  const filtered = getFilteredNotes();
  const pinnedSec = document.getElementById('section-pinned');
  const pinnedGrid = document.getElementById('keep-pinned-grid');
  const othersGrid = document.getElementById('keep-cards-grid');
  const othersLabel = document.getElementById('section-others-label');
  const filterHeading = document.getElementById('keep-filter-title');

  // Libellé de vue active
  if (state.filterType === 'shared') {
    filterHeading.textContent = '👥 Notes partagées avec moi';
    filterHeading.classList.remove('hidden');
  } else if (state.filterType === 'archived') {
    filterHeading.textContent = '🗄️ Notes archivées';
    filterHeading.classList.remove('hidden');
  } else if (state.filterType === 'pinned') {
    filterHeading.textContent = '📌 Notes épinglées';
    filterHeading.classList.remove('hidden');
  } else {
    filterHeading.classList.add('hidden');
  }

  // Si on est dans la vue "all", on sépare épinglées et autres
  if (state.filterType === 'all' && !state.searchQuery) {
    const pinned = filtered.filter(n => n.pinned);
    const others = filtered.filter(n => !n.pinned);

    if (pinned.length > 0) {
      pinnedSec.classList.remove('hidden');
      pinnedGrid.innerHTML = pinned.map(renderKeepCardHtml).join('');
      othersLabel.classList.remove('hidden');
    } else {
      pinnedSec.classList.add('hidden');
      othersLabel.classList.add('hidden');
    }

    if (others.length === 0 && pinned.length === 0) {
      othersGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: var(--text-muted)">
          <div style="font-size: 3rem; margin-bottom: 0.8rem">💡</div>
          <h3 style="font-size: 1.15rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.4rem">Les notes que vous ajoutez s'affichent ici</h3>
          <p style="font-size: 0.9rem">Tapez directement dans le champ ci-dessus pour prendre une note rapide ou créer une liste.</p>
        </div>
      `;
    } else {
      othersGrid.innerHTML = others.map(renderKeepCardHtml).join('');
    }
  } else {
    pinnedSec.classList.add('hidden');
    othersLabel.classList.add('hidden');

    if (filtered.length === 0) {
      othersGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: var(--text-muted)">
          <div style="font-size: 2.5rem; margin-bottom: 0.8rem">🔍</div>
          <h3 style="font-size: 1.05rem; font-weight: 600; color: var(--text-primary)">Aucune note dans cette section</h3>
        </div>
      `;
    } else {
      othersGrid.innerHTML = filtered.map(renderKeepCardHtml).join('');
    }
  }
}

function renderSidebarCounts() {
  const activeNotes = state.notes.filter(n => !n.archived);
  const sharedNotes = state.notes.filter(n => !n.archived && n.isSharedWithMe);
  const pinnedNotes = activeNotes.filter(n => n.pinned);
  const archivedNotes = state.notes.filter(n => n.archived);

  document.getElementById('count-all').textContent = activeNotes.length;
  document.getElementById('count-shared').textContent = sharedNotes.length;
  document.getElementById('count-pinned').textContent = pinnedNotes.length;
  document.getElementById('count-archived').textContent = archivedNotes.length;
}

// =============================================================================
// RENDU D'UNE CARTE STYLE KEEP
// =============================================================================
function renderKeepCardHtml(note) {
  const cleanBody = (note.content || '').replace(/^- \[[ x]\]\s*.+$/gm, '').trim();
  const previewLines = cleanBody ? cleanBody.split('\n').slice(0, 5).join('\n') : '';

  const checklist = (note.checklist || []).slice(0, 5).map((c, idx) => `
    <label class="keep-chk-item ${c.done ? 'done' : ''}">
      <input type="checkbox" data-card-chk-note="${note.id}" data-card-chk-idx="${idx}" ${c.done ? 'checked' : ''} />
      <span>${escapeHtml(c.text)}</span>
    </label>
  `).join('');

  const moreChkCount = (note.checklist || []).length > 5 ? (note.checklist.length - 5) : 0;
  const isCollab = Boolean(note.collabToken || note.isSharedWithMe);

  return `
    <div class="keep-card color-${note.color || 'default'}" data-note-card-id="${note.id}">
      <div>
        <div class="keep-card-header">
          <div class="keep-card-title" data-open-note="${note.id}">
            ${escapeHtml(note.title || 'Sans titre')}
          </div>
          <button class="icon-btn-sm ${note.pinned ? 'active' : ''}" data-pin-note="${note.id}" title="${note.pinned ? 'Désépingler' : 'Épingler'}">📌</button>
        </div>

        ${previewLines ? `<div class="keep-card-body" data-open-note="${note.id}">${escapeHtml(previewLines)}</div>` : ''}
        ${checklist ? `<div class="keep-card-checklist">${checklist}${moreChkCount > 0 ? `<span style="font-size:0.75rem;color:var(--text-muted);padding-left:1.5rem">+ ${moreChkCount} autre(s) tâche(s)...</span>` : ''}</div>` : ''}
      </div>

      <div class="keep-card-footer">
        <div style="display:flex;align-items:center;gap:0.4rem">
          ${isCollab ? `<span class="shared-badge" title="Note collaborative multi-personnes">👥 Partagée</span>` : ''}
          ${note.lastEditedBy ? `<span style="font-size:0.68rem;color:var(--text-muted)">Par ${escapeHtml(note.lastEditedBy)}</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:0.25rem">
          <button class="icon-btn-sm" data-collab-btn="${note.id}" title="Lien de collaboration en direct">👥</button>
          <button class="icon-btn-sm" data-archive-note="${note.id}" title="${note.archived ? 'Désarchiver' : 'Archiver'}">🗄️</button>
          <button class="icon-btn-sm danger" data-delete-note="${note.id}" title="Supprimer">🗑️</button>
        </div>
      </div>
    </div>
  `;
}

// =============================================================================
// CRÉATION RAPIDE D'UNE NOTE (BARRE DE SAISIE SUPÉRIEURE)
// =============================================================================
async function handleQuickCreateNote() {
  const titleInput = document.getElementById('keep-quick-title');
  const contentInput = document.getElementById('keep-quick-content');
  const title = titleInput.value.trim();
  const rawContent = contentInput.value.trim();

  if (!title && !rawContent) return;

  const checklist = [];
  const contentLines = [];

  rawContent.split('\n').forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('- [ ] ')) {
      checklist.push({ id: `chk_${Date.now()}_${idx}`, text: trimmed.substring(6), done: false });
    } else if (trimmed.startsWith('- [x] ')) {
      checklist.push({ id: `chk_${Date.now()}_${idx}`, text: trimmed.substring(6), done: true });
    } else if (trimmed.startsWith('- ')) {
      checklist.push({ id: `chk_${Date.now()}_${idx}`, text: trimmed.substring(2), done: false });
    } else {
      contentLines.push(line);
    }
  });

  const payload = {
    title: title || (checklist.length > 0 ? 'Liste de tâches' : 'Note'),
    content: contentLines.join('\n'),
    checklist,
    color: state.quickColor || 'default',
    pinned: false
  };

  try {
    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const created = await res.json();
      state.notes.unshift(created);
      titleInput.value = '';
      contentInput.value = '';
      state.quickColor = 'default';
      updateColorDots('keep-quick-box', 'default');
      renderAllNotes();
      showToast('✓ Note ajoutée');
    }
  } catch (err) {
    console.error('Erreur création note:', err);
  }
}

// =============================================================================
// MODAL D'ÉDITION D'UNE NOTE & SYNCHRONISATION EN DIRECT
// =============================================================================
function openEditModal(noteId) {
  const note = state.notes.find(n => n.id === noteId);
  if (!note) return;

  state.editingNoteId = note.id;
  state.activeCollabToken = note.collabToken || null;

  const modal = document.getElementById('modal-edit-note');
  const card = document.getElementById('modal-keep-card');
  const titleInput = document.getElementById('edit-note-title');
  const contentInput = document.getElementById('edit-note-content');
  const pinBtn = document.getElementById('btn-edit-pin');
  const liveBadge = document.getElementById('collab-live-badge');

  titleInput.value = note.title || '';
  contentInput.value = note.content || '';

  // Appliquer la couleur
  applyModalCardColor(note.color || 'default');
  updateColorDots('modal-keep-card', note.color || 'default');

  pinBtn.classList.toggle('active', Boolean(note.pinned));

  // Rendu de la checklist
  renderEditModalChecklist(note);

  // Si c'est une note collaborative, activer le SSE en direct
  if (note.collabToken) {
    liveBadge.classList.remove('hidden');
    connectLiveCollabSSE(note.collabToken);
  } else {
    liveBadge.classList.add('hidden');
    disconnectLiveCollabSSE();
  }

  modal.classList.remove('hidden');
}

function applyModalCardColor(color) {
  const card = document.getElementById('modal-keep-card');
  if (!card) return;
  card.className = card.className.replace(/color-\w+/g, '');
  card.classList.add(`color-${color || 'default'}`);
}

function renderEditModalChecklist(note) {
  const itemsContainer = document.getElementById('edit-checklist-items');
  const list = note.checklist || [];

  if (list.length === 0) {
    itemsContainer.innerHTML = '';
    return;
  }

  itemsContainer.innerHTML = list.map((item, idx) => `
    <div class="chk-row ${item.done ? 'done' : ''}">
      <label>
        <input type="checkbox" data-edit-chk="${idx}" ${item.done ? 'checked' : ''} />
        <span>${escapeHtml(item.text)}</span>
      </label>
      <button class="icon-btn-sm" data-edit-del-chk="${idx}" title="Supprimer">✕</button>
    </div>
  `).join('');
}

function scheduleModalAutoSave() {
  if (state.isRemoteUpdating) return;
  const indicator = document.getElementById('edit-save-indicator');
  if (indicator) indicator.textContent = '⏳ Enregistrement...';

  if (state.saveTimeout) clearTimeout(state.saveTimeout);
  state.saveTimeout = setTimeout(saveModalNoteNow, 200);
}

async function saveModalNoteNow() {
  const note = state.notes.find(n => n.id === state.editingNoteId);
  if (!note) return;

  const title = document.getElementById('edit-note-title').value;
  const content = document.getElementById('edit-note-content').value;

  note.title = title.trim() || 'Note sans titre';
  note.content = content;

  try {
    let res;
    if (note.collabToken) {
      // Sauvegarde via endpoint de collaboration (diffuse instantanément à tous)
      res = await fetch(`/api/collab/${note.collabToken}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: note.title,
          content: note.content,
          color: note.color,
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

      const indicator = document.getElementById('edit-save-indicator');
      if (indicator) indicator.textContent = '✓ Enregistré';
      renderAllNotes();
    }
  } catch (err) {
    console.error('Erreur sauvegarde note:', err);
  }
}

// =============================================================================
// SYNCHRONISATION MULTI-PERSONNES EN TEMPS RÉEL (SSE)
// =============================================================================
// =============================================================================
// SYNCHRONISATION MULTI-PERSONNES EN TEMPS RÉEL (SSE)
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
      if (idx >= 0) {
        state.notes[idx] = { ...state.notes[idx], ...updatedNote };
      } else {
        state.notes.unshift(updatedNote);
      }

      // Si l'utilisateur a actuellement cette note ouverte dans le modal
      if (state.editingNoteId === updatedNote.id) {
        state.isRemoteUpdating = true;
        const titleInput = document.getElementById('edit-note-title');
        const contentInput = document.getElementById('edit-note-content');

        // Mettre à jour le titre s'il a changé
        if (titleInput && updatedNote.title !== undefined && titleInput.value !== updatedNote.title) {
          const isFocused = (document.activeElement === titleInput);
          const start = titleInput.selectionStart;
          const end = titleInput.selectionEnd;
          titleInput.value = updatedNote.title || '';
          if (isFocused) {
            try { titleInput.setSelectionRange(start, end); } catch (e) {}
          }
        }

        // Mettre à jour le contenu avec préservation précise du curseur
        if (contentInput && updatedNote.content !== undefined && contentInput.value !== updatedNote.content) {
          const isFocused = (document.activeElement === contentInput);
          const start = contentInput.selectionStart;
          const end = contentInput.selectionEnd;
          contentInput.value = updatedNote.content || '';
          if (isFocused) {
            try { contentInput.setSelectionRange(start, end); } catch (e) {}
          }
        }

        applyModalCardColor(updatedNote.color || 'default');
        updateColorDots('modal-keep-card', updatedNote.color || 'default');
        renderEditModalChecklist(updatedNote);

        const statusEl = document.getElementById('collab-status-text');
        if (statusEl && data.updatedBy) {
          statusEl.textContent = `⚡ Modifié en direct par ${data.updatedBy}`;
        }
        setTimeout(() => { state.isRemoteUpdating = false; }, 150);
      }

      renderAllNotes();
    } catch (err) {
      console.error('Erreur traitement mise à jour live:', err);
    }
  });

  es.addEventListener('participant_joined', e => {
    try {
      const data = JSON.parse(e.data);
      showToast(`👋 ${data.user.name} a rejoint cette note en direct !`);
      updateCollaboratorAvatars(data.collaborators || []);
    } catch (err) {}
  });

  es.onerror = () => {
    console.warn('Connexion SSE live suspendue/reconnexion...');
  };
}

function disconnectLiveCollabSSE() {
  if (state.sseConnection) {
    state.sseConnection.close();
    state.sseConnection = null;
  }
}

// Connexion globale continue pour synchroniser toutes les cartes et notes partagées
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
      if (!updatedNote || !updatedNote.id) return;

      const idx = state.notes.findIndex(n => n.id === updatedNote.id);
      if (idx >= 0) {
        state.notes[idx] = { ...state.notes[idx], ...updatedNote };
      } else {
        state.notes.unshift({ ...updatedNote, isSharedWithMe: true });
      }

      // Si le modal est ouvert sur cette note et qu'aucun flux collab dédié n'est branché
      if (state.editingNoteId === updatedNote.id && !state.sseConnection) {
        state.isRemoteUpdating = true;
        const titleInput = document.getElementById('edit-note-title');
        const contentInput = document.getElementById('edit-note-content');
        if (titleInput && titleInput.value !== updatedNote.title) {
          titleInput.value = updatedNote.title || '';
        }
        if (contentInput && contentInput.value !== updatedNote.content) {
          contentInput.value = updatedNote.content || '';
        }
        applyModalCardColor(updatedNote.color || 'default');
        updateColorDots('modal-keep-card', updatedNote.color || 'default');
        renderEditModalChecklist(updatedNote);
        setTimeout(() => { state.isRemoteUpdating = false; }, 150);
      }

      renderAllNotes();
    } catch (err) {
      console.error('Erreur traitement event user live:', err);
    }
  });

  es.onerror = () => {
    console.warn('Flux SSE utilisateur en reconnexion...');
  };
}

function updateCollaboratorAvatars(collabs) {
  const container = document.getElementById('collab-avatars');
  if (!container) return;
  container.innerHTML = collabs.map(c => `
    <span class="collab-avatar-chip" title="${escapeHtml(c.name || c.email)}">
      ${(c.name || c.email || 'U')[0].toUpperCase()}
    </span>
  `).join('');
}

// =============================================================================
// OUVERTURE D'UN LIEN DE COLLABORATION REÇU (?collab=TOKEN)
// =============================================================================
async function handleOpenCollabLink(token) {
  try {
    const res = await fetch(`/api/collab/${token}`);
    if (!res.ok) {
      showToast('❌ Lien de collaboration introuvable ou révoqué');
      return;
    }
    const data = await res.json();
    const joinedNote = { ...data.note, ownerId: data.ownerId, isSharedWithMe: true };

    const idx = state.notes.findIndex(n => n.id === joinedNote.id);
    if (idx >= 0) {
      state.notes[idx] = joinedNote;
    } else {
      state.notes.unshift(joinedNote);
    }

    renderAllNotes();
    openEditModal(joinedNote.id);
    showToast('👥 Vous êtes connecté à cette note partagée en direct !');

    // Nettoyer l'URL
    window.history.replaceState({}, document.title, window.location.pathname);
  } catch (err) {
    console.error('Erreur ouverture note collab:', err);
  }
}

// =============================================================================
// MODAL GESTION DU LIEN DE COLLABORATION (PARTAGER AVEC D'AUTRES)
// =============================================================================
async function openCollabShareModal(noteId) {
  const note = state.notes.find(n => n.id === noteId);
  if (!note) return;

  try {
    const res = await fetch(`/api/notes/${note.id}/collaborate`, { method: 'POST' });
    if (!res.ok) return;

    const data = await res.json();
    note.collabToken = data.collabToken;
    const idx = state.notes.findIndex(n => n.id === note.id);
    if (idx >= 0) state.notes[idx] = { ...state.notes[idx], ...data.note };

    const urlInput = document.getElementById('collab-share-url-input');
    urlInput.value = data.collabUrl;

    const countEl = document.getElementById('collab-participants-count');
    const listEl = document.getElementById('collab-participants-list');
    const collabs = data.note.collaborators || [];

    countEl.textContent = collabs.length;
    if (collabs.length === 0) {
      listEl.innerHTML = `<span style="font-size:0.8rem;color:var(--text-muted)">Aucun collaborateur pour le moment. Envoyez-leur le lien ci-dessus !</span>`;
    } else {
      listEl.innerHTML = collabs.map(c => `
        <div class="collab-participant-item">
          <span class="user-avatar" style="width:24px;height:24px;font-size:0.75rem">${(c.name || c.email || 'U')[0].toUpperCase()}</span>
          <div>
            <strong>${escapeHtml(c.name || c.email)}</strong>
            <small style="color:var(--text-muted);display:block;font-size:0.7rem">${escapeHtml(c.email)}</small>
          </div>
        </div>
      `).join('');
    }

    document.getElementById('modal-collab').classList.remove('hidden');
    renderAllNotes();
  } catch (err) {
    console.error('Erreur ouverture partage collab:', err);
  }
}

// =============================================================================
// GESTION DES COULEURS
// =============================================================================
function updateColorDots(containerId, activeColor) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.color-dot').forEach(dot => {
    const col = dot.dataset.color || dot.dataset.editColor;
    dot.classList.toggle('active', col === activeColor);
  });
}

// =============================================================================
// BIND DES ÉVÉNEMENTS GLOBAUX
// =============================================================================
function bindEvents() {
  // Thème clair/sombre
  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    showToast(nextTheme === 'dark' ? '🌙 Mode Sombre activé' : '☀️ Mode Clair activé');
  });

  // Toggle barre latérale
  const sidebar = document.getElementById('left-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => {
    if (window.innerWidth <= 840) {
      sidebar?.classList.toggle('open');
      backdrop?.classList.toggle('active', sidebar?.classList.contains('open'));
    } else {
      sidebar?.classList.toggle('hidden');
    }
  });
  backdrop?.addEventListener('click', () => {
    sidebar?.classList.remove('open');
    backdrop?.classList.remove('active');
  });

  // Filtres de navigation (Notes / Partagées / Épinglées / Archives)
  document.querySelectorAll('#QuickFiltersList .nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('#QuickFiltersList .nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      state.filterType = item.dataset.filter;
      renderAllNotes();
      if (window.innerWidth <= 840) {
        sidebar?.classList.remove('open');
        backdrop?.classList.remove('active');
      }
    });
  });

  // Recherche instantanée
  const searchInput = document.getElementById('global-search-input');
  const clearSearchBtn = document.getElementById('btn-clear-search');
  searchInput?.addEventListener('input', e => {
    state.searchQuery = e.target.value.trim();
    clearSearchBtn?.classList.toggle('hidden', !state.searchQuery);
    renderAllNotes();
  });
  clearSearchBtn?.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    clearSearchBtn.classList.add('hidden');
    renderAllNotes();
  });

  // Choix de couleur dans la barre de saisie rapide
  document.getElementById('keep-quick-box')?.addEventListener('click', e => {
    const dot = e.target.closest('.color-dot');
    if (dot && dot.dataset.color) {
      state.quickColor = dot.dataset.color;
      updateColorDots('keep-quick-box', state.quickColor);
    }
  });

  // Bouton Enregistrer note rapide
  document.getElementById('btn-keep-create')?.addEventListener('click', handleQuickCreateNote);

  // Clics dans les grilles de cartes
  document.addEventListener('click', async e => {
    // 1. Ouvrir la note en modal
    const openTrigger = e.target.closest('[data-open-note]');
    if (openTrigger) {
      openEditModal(openTrigger.dataset.openNote);
      return;
    }

    // 2. Épingler / Désépingler depuis la carte
    const pinBtn = e.target.closest('[data-pin-note]');
    if (pinBtn) {
      e.stopPropagation();
      const note = state.notes.find(n => n.id === pinBtn.dataset.pinNote);
      if (note) {
        note.pinned = !note.pinned;
        await fetch(`/api/notes/${note.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(note)
        });
        renderAllNotes();
        showToast(note.pinned ? '📌 Note épinglée' : 'Note désépinglée');
      }
      return;
    }

    // 3. Ouvrir le modal de collaboration
    const collabBtn = e.target.closest('[data-collab-btn]');
    if (collabBtn) {
      e.stopPropagation();
      openCollabShareModal(collabBtn.dataset.collabBtn);
      return;
    }

    // 4. Archiver depuis la carte
    const archBtn = e.target.closest('[data-archive-note]');
    if (archBtn) {
      e.stopPropagation();
      const note = state.notes.find(n => n.id === archBtn.dataset.archiveNote);
      if (note) {
        note.archived = !note.archived;
        await fetch(`/api/notes/${note.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(note)
        });
        renderAllNotes();
        showToast(note.archived ? '🗄️ Note archivée' : 'Note restaurée');
      }
      return;
    }

    // 5. Supprimer depuis la carte
    const delBtn = e.target.closest('[data-delete-note]');
    if (delBtn) {
      e.stopPropagation();
      const noteId = delBtn.dataset.deleteNote;
      if (confirm('Supprimer cette note ?')) {
        await fetch(`/api/notes/${noteId}`, { method: 'DELETE' });
        state.notes = state.notes.filter(n => n.id !== noteId);
        renderAllNotes();
        showToast('🗑️ Note supprimée');
      }
      return;
    }

    // 6. Fermer modal via bouton [data-close-modal]
    const closeBtn = e.target.closest('[data-close-modal]');
    if (closeBtn) {
      const modalId = closeBtn.dataset.closeModal;
      document.getElementById(modalId)?.classList.add('hidden');
      if (modalId === 'modal-edit-note') {
        disconnectLiveCollabSSE();
        state.editingNoteId = null;
      }
      return;
    }
  });

  // Changement de case à cocher directement sur la carte
  document.addEventListener('change', async e => {
    if (e.target.matches('input[data-card-chk-note]')) {
      const noteId = e.target.dataset.cardChkNote;
      const idx = Number(e.target.dataset.cardChkIdx);
      const note = state.notes.find(n => n.id === noteId);
      if (note && note.checklist && note.checklist[idx]) {
        note.checklist[idx].done = e.target.checked;
        if (note.collabToken) {
          await fetch(`/api/collab/${note.collabToken}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checklist: note.checklist })
          });
        } else {
          await fetch(`/api/notes/${note.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(note)
          });
        }
        renderAllNotes();
      }
    }
  });

  // =========================================================================
  // ÉVÉNEMENTS DU MODAL D'ÉDITION
  // =========================================================================
  document.getElementById('edit-note-title')?.addEventListener('input', scheduleModalAutoSave);
  document.getElementById('edit-note-content')?.addEventListener('input', scheduleModalAutoSave);

  // Changement de couleur dans le modal
  document.getElementById('modal-keep-card')?.addEventListener('click', e => {
    const dot = e.target.closest('.color-dot');
    if (dot && dot.dataset.editColor) {
      const color = dot.dataset.editColor;
      const note = state.notes.find(n => n.id === state.editingNoteId);
      if (note) {
        note.color = color;
        applyModalCardColor(color);
        updateColorDots('modal-keep-card', color);
        scheduleModalAutoSave();
      }
    }
  });

  // Épingler depuis le modal
  document.getElementById('btn-edit-pin')?.addEventListener('click', () => {
    const note = state.notes.find(n => n.id === state.editingNoteId);
    if (!note) return;
    note.pinned = !note.pinned;
    document.getElementById('btn-edit-pin').classList.toggle('active', note.pinned);
    scheduleModalAutoSave();
    showToast(note.pinned ? '📌 Note épinglée' : 'Note désépinglée');
  });

  // Ouvrir collab depuis le modal d'édition
  document.getElementById('btn-edit-collab')?.addEventListener('click', () => {
    if (state.editingNoteId) {
      openCollabShareModal(state.editingNoteId);
    }
  });

  // Archiver depuis le modal
  document.getElementById('btn-edit-archive')?.addEventListener('click', async () => {
    const note = state.notes.find(n => n.id === state.editingNoteId);
    if (!note) return;
    note.archived = !note.archived;
    await fetch(`/api/notes/${note.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note)
    });
    document.getElementById('modal-edit-note').classList.add('hidden');
    disconnectLiveCollabSSE();
    state.editingNoteId = null;
    renderAllNotes();
    showToast(note.archived ? '🗄️ Note archivée' : 'Note restaurée');
  });

  // Supprimer depuis le modal
  document.getElementById('btn-edit-delete')?.addEventListener('click', async () => {
    if (!state.editingNoteId) return;
    if (confirm('Supprimer cette note ?')) {
      await fetch(`/api/notes/${state.editingNoteId}`, { method: 'DELETE' });
      state.notes = state.notes.filter(n => n.id !== state.editingNoteId);
      document.getElementById('modal-edit-note').classList.add('hidden');
      disconnectLiveCollabSSE();
      state.editingNoteId = null;
      renderAllNotes();
      showToast('🗑️ Note supprimée');
    }
  });

  // Gestion des sous-tâches dans le modal
  document.getElementById('edit-checklist-items')?.addEventListener('change', e => {
    if (e.target.matches('input[data-edit-chk]')) {
      const idx = Number(e.target.dataset.editChk);
      const note = state.notes.find(n => n.id === state.editingNoteId);
      if (note && note.checklist && note.checklist[idx]) {
        note.checklist[idx].done = e.target.checked;
        scheduleModalAutoSave();
      }
    }
  });

  document.getElementById('edit-checklist-items')?.addEventListener('click', e => {
    const delBtn = e.target.closest('[data-edit-del-chk]');
    if (delBtn) {
      const idx = Number(delBtn.dataset.editDelChk);
      const note = state.notes.find(n => n.id === state.editingNoteId);
      if (note && note.checklist) {
        note.checklist.splice(idx, 1);
        renderEditModalChecklist(note);
        scheduleModalAutoSave();
      }
    }
  });

  function addModalChecklistItem() {
    const input = document.getElementById('edit-new-chk-input');
    const val = input.value.trim();
    if (!val) return;
    const note = state.notes.find(n => n.id === state.editingNoteId);
    if (!note) return;
    if (!Array.isArray(note.checklist)) note.checklist = [];
    note.checklist.push({ id: `chk_${Date.now()}`, text: val, done: false });
    input.value = '';
    renderEditModalChecklist(note);
    scheduleModalAutoSave();
  }

  document.getElementById('btn-add-chk-item')?.addEventListener('click', addModalChecklistItem);
  document.getElementById('edit-new-chk-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addModalChecklistItem();
    }
  });

  // Copier le lien de collaboration
  document.getElementById('btn-copy-collab-url')?.addEventListener('click', () => {
    const val = document.getElementById('collab-share-url-input').value;
    navigator.clipboard.writeText(val);
    showToast('📋 Lien de collaboration copié ! Partagez-le.');
  });
}
