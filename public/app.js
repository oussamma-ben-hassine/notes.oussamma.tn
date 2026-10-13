// =============================================================================
// NOTEVAULT AI (notes.oussamma.tn) — Contrôleur Frontend Hybride & Second Brain
// =============================================================================

const state = {
  user: null,
  theme: localStorage.getItem('notevault_theme') || 'light',
  folders: [],
  notes: [],
  activeNoteId: null,
  activeView: 'editor', // 'editor' | 'cards' | 'kanban'
  filterType: 'all', // 'all' | 'pinned' | 'archived' | 'folder' | 'tag'
  filterValue: null,
  searchQuery: '',
  editorMode: 'split', // 'split' | 'write' | 'preview'
  saveTimeout: null,
  recognition: null,
  isRecording: false,
  chatHistory: []
};

function applyTheme(themeName) {
  state.theme = themeName === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', state.theme);
  localStorage.setItem('notevault_theme', state.theme);
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
// UTILITAIRES & MARKDOWN PARSER AVEC WIKILINKS [[...]]
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
  setTimeout(() => el.remove(), 3400);
}

function renderMarkdown(mdText) {
  if (!mdText) return '<p style="color:var(--text-muted)">Aucun contenu...</p>';

  let html = escapeHtml(mdText);

  // Blocs de code ```lang ... ```
  html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`;
  });

  // Code inline `...`
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // WikiLinks [[Titre de la note]]
  html = html.replace(/\[\[([^\]]+)\]\]/g, (_, linkTitle) => {
    const clean = linkTitle.trim();
    return `<a href="#" class="wikilink-pill" data-wikilink="${escapeHtml(clean)}">🔗 ${escapeHtml(clean)}</a>`;
  });

  // Titres
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Citations
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Checklists Markdown - [x] et - [ ]
  html = html.replace(/^- \[x\] (.+)$/gim, '<div>✅ <span style="text-decoration:line-through;color:var(--text-muted)">$1</span></div>');
  html = html.replace(/^- \[ \] (.+)$/gim, '<div>⬜ <span>$1</span></div>');

  // Gras & Italique
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Listes à puces
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, match => `<ul>${match}</ul>`);

  // Paragraphes
  const lines = html.split('\n\n');
  html = lines.map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    if (/^<(h1|h2|h3|pre|ul|blockquote|div)/.test(trimmed)) return trimmed;
    return `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`;
  }).join('\n');

  return html;
}

// =============================================================================
// INITIALISATION & VÉRIFICATION PARTAGE PUBLIC / SSO
// =============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(state.theme);
  const params = new URLSearchParams(window.location.search);
  const shareToken = params.get('share');
  const authError = params.get('auth_error');

  if (shareToken) {
    await loadPublicSharedNote(shareToken);
    return;
  }

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

    await loadInitialWorkspace();
    bindEvents();
  } catch (err) {
    console.error('Erreur initialisation:', err);
    document.getElementById('auth-wall').classList.remove('hidden');
  }
});

async function loadPublicSharedNote(token) {
  const view = document.getElementById('public-share-view');
  const body = document.getElementById('public-share-body');
  view.classList.remove('hidden');

  try {
    const res = await fetch(`/api/public/notes/${encodeURIComponent(token)}`);
    if (!res.ok) {
      body.innerHTML = `<div class="empty-state"><h3>🔒 Lien introuvable ou expiré</h3><p>Cette note n'est plus partagée publiquement.</p></div>`;
      return;
    }
    const note = await res.json();
    const tagsHtml = (note.tags || []).map(t => `<span class="note-tag-badge">#${escapeHtml(t)}</span>`).join(' ');
    const checklistHtml = (note.checklist || []).length > 0
      ? `<div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border-subtle)">
           <h4>✅ Liste des tâches</h4>
           ${note.checklist.map(c => `<div style="margin-top:0.35rem">${c.done ? '✅' : '⬜'} ${escapeHtml(c.text)}</div>`).join('')}
         </div>`
      : '';

    body.innerHTML = `
      <div style="margin-bottom:1rem">
        <span style="font-size:0.78rem;color:var(--text-secondary)">📁 ${escapeHtml(note.folderName)} · Mis à jour le ${new Date(note.updatedAt).toLocaleDateString('fr-FR')}</span>
        <h1 style="font-size:1.8rem;margin:0.35rem 0">${escapeHtml(note.emoji || '📝')} ${escapeHtml(note.title)}</h1>
        <div style="display:flex;gap:0.4rem;flex-wrap:wrap">${tagsHtml}</div>
      </div>
      <div class="markdown-body" style="padding-top:1rem;border-top:1px solid var(--border-subtle)">
        ${renderMarkdown(note.content)}
      </div>
      ${checklistHtml}
    `;

    document.getElementById('btn-copy-shared')?.addEventListener('click', () => {
      navigator.clipboard.writeText(note.content || '');
      showToast('📋 Contenu Markdown copié !');
    });
  } catch (err) {
    body.innerHTML = `<p>Erreur de chargement de la note partagée.</p>`;
  }
}

async function loadInitialWorkspace() {
  const [foldersRes, notesRes, chatRes] = await Promise.all([
    fetch('/api/folders'),
    fetch('/api/notes?archived=all'),
    fetch('/api/chat')
  ]);

  state.folders = await foldersRes.json();
  state.notes = await notesRes.json();
  state.chatHistory = await chatRes.json();

  const firstActive = state.notes.find(n => !n.archived);
  state.activeNoteId = firstActive ? firstActive.id : null;

  renderAll();
  renderChatMessages();
}

// =============================================================================
// FILTRAGE ET RENDU GLOBAL
// =============================================================================
function getFilteredNotes() {
  return state.notes.filter(note => {
    // Filtre archive
    if (state.filterType === 'archived') {
      if (!note.archived) return false;
    } else {
      if (note.archived) return false;
    }

    if (state.filterType === 'pinned' && !note.pinned) return false;
    if (state.filterType === 'folder' && note.folderId !== state.filterValue) return false;
    if (state.filterType === 'tag' && !(note.tags || []).some(t => t.toLowerCase() === String(state.filterValue).toLowerCase())) return false;

    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const inTitle = (note.title || '').toLowerCase().includes(q);
      const inContent = (note.content || '').toLowerCase().includes(q);
      const inTags = (note.tags || []).some(t => t.toLowerCase().includes(q));
      const inCheck = (note.checklist || []).some(c => c.text.toLowerCase().includes(q));
      if (!inTitle && !inContent && !inTags && !inCheck) return false;
    }

    return true;
  });
}

function renderAll() {
  renderSidebar();
  renderNotesList();
  renderActiveNoteEditor();
  renderKeepCardsView();
  renderKanbanBoard();
}

// =============================================================================
// 1. RENDU SIDEBAR (DOSSIERS, COMPTEURS, TAGS)
// =============================================================================
function renderSidebar() {
  const activeNotes = state.notes.filter(n => !n.archived);
  const pinnedNotes = activeNotes.filter(n => n.pinned);
  const archivedNotes = state.notes.filter(n => n.archived);

  document.getElementById('count-all').textContent = activeNotes.length;
  document.getElementById('count-pinned').textContent = pinnedNotes.length;
  document.getElementById('count-archived').textContent = archivedNotes.length;

  // Dossiers
  const foldersList = document.getElementById('folders-list');
  foldersList.innerHTML = state.folders.map(f => {
    const count = activeNotes.filter(n => n.folderId === f.id).length;
    const isActive = state.filterType === 'folder' && state.filterValue === f.id;
    return `
      <li class="nav-item ${isActive ? 'active' : ''}" data-folder-id="${f.id}">
        <span>${escapeHtml(f.icon || '📁')} ${escapeHtml(f.name)}</span>
        <span class="nav-count">${count}</span>
      </li>
    `;
  }).join('');

  // Select dossier dans l'éditeur
  const folderSelect = document.getElementById('note-folder-select');
  if (folderSelect) {
    folderSelect.innerHTML = state.folders.map(f =>
      `<option value="${f.id}">${escapeHtml(f.icon || '📁')} ${escapeHtml(f.name)}</option>`
    ).join('');
  }

  // Tags populaires
  const tagCounts = {};
  activeNotes.forEach(n => {
    (n.tags || []).forEach(t => {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    });
  });

  const tagsCloud = document.getElementById('sidebar-tags-cloud');
  tagsCloud.innerHTML = Object.keys(tagCounts).map(tag => {
    const isActive = state.filterType === 'tag' && state.filterValue === tag;
    return `<span class="tag-pill ${isActive ? 'active' : ''}" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)} (${tagCounts[tag]})</span>`;
  }).join('');
}

// =============================================================================
// 2. RENDU COLONNE LISTE DES NOTES + ÉDITEUR MARKDOWN
// =============================================================================
function renderNotesList() {
  const filtered = getFilteredNotes();
  document.getElementById('notes-list-counter').textContent = filtered.length;

  const titleEl = document.getElementById('current-list-title');
  if (state.filterType === 'all') titleEl.textContent = 'Toutes les notes';
  else if (state.filterType === 'pinned') titleEl.textContent = '📌 Épinglées';
  else if (state.filterType === 'archived') titleEl.textContent = '🗄️ Archives';
  else if (state.filterType === 'folder') {
    const f = state.folders.find(x => x.id === state.filterValue);
    titleEl.textContent = f ? `${f.icon} ${f.name}` : 'Dossier';
  } else if (state.filterType === 'tag') {
    titleEl.textContent = `#${state.filterValue}`;
  }

  const listEl = document.getElementById('editor-notes-list');
  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><p>Aucune note dans cette vue.</p></div>`;
    return;
  }

  listEl.innerHTML = filtered.map(n => {
    const isActive = n.id === state.activeNoteId;
    const cleanExcerpt = (n.content || '').replace(/[#*`>\-\[\]]/g, '').trim().substring(0, 110);
    const doneCount = (n.checklist || []).filter(c => c.done).length;
    const totalChk = (n.checklist || []).length;

    return `
      <div class="note-list-item ${isActive ? 'active' : ''}" data-note-id="${n.id}">
        <div class="note-item-top">
          <div class="note-item-title">
            <span>${escapeHtml(n.emoji || '📝')}</span>
            <span>${escapeHtml(n.title)}</span>
          </div>
          ${n.pinned ? '<span title="Épinglée">📌</span>' : ''}
        </div>
        <div class="note-item-excerpt">${escapeHtml(cleanExcerpt || 'Note vide...')}</div>
        <div class="note-item-meta">
          <span>${(n.tags || []).slice(0, 2).map(t => `#${escapeHtml(t)}`).join(' ')}</span>
          <span>${totalChk > 0 ? `✅ ${doneCount}/${totalChk}` : new Date(n.updatedAt).toLocaleDateString('fr-FR')}</span>
        </div>
      </div>
    `;
  }).join('');
}

function getActiveNote() {
  return state.notes.find(n => n.id === state.activeNoteId) || null;
}

function renderActiveNoteEditor() {
  const note = getActiveNote();
  const emptyState = document.getElementById('empty-note-state');
  const container = document.getElementById('active-note-container');

  if (!note) {
    emptyState.classList.remove('hidden');
    container.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  container.classList.remove('hidden');

  document.getElementById('note-emoji-input').value = note.emoji || '📝';
  document.getElementById('note-title-input').value = note.title || '';
  document.getElementById('note-folder-select').value = note.folderId || (state.folders[0]?.id || '');
  document.getElementById('note-kanban-select').value = note.kanbanStatus || 'todo';
  document.getElementById('note-priority-select').value = note.priority || 'medium';
  document.getElementById('note-color-select').value = note.color || 'indigo';
  document.getElementById('note-duedate-input').value = note.dueDate || '';

  const pinBtn = document.getElementById('btn-pin-note');
  if (note.pinned) pinBtn.classList.add('active');
  else pinBtn.classList.remove('active');

  // Tags
  const tagsList = document.getElementById('note-tags-list');
  tagsList.innerHTML = (note.tags || []).map((t, idx) => `
    <span class="note-tag-badge">
      #${escapeHtml(t)}
      <button type="button" data-remove-tag="${idx}" title="Retirer">✕</button>
    </span>
  `).join('');

  // Contenu & Aperçu Markdown
  const textarea = document.getElementById('note-content-textarea');
  if (document.activeElement !== textarea) {
    textarea.value = note.content || '';
  }
  updateMarkdownPreviewAndLinks(note);
  renderNoteChecklist(note);
}

function updateMarkdownPreviewAndLinks(note) {
  const preview = document.getElementById('note-markdown-preview');
  const content = note.content || '';
  preview.innerHTML = renderMarkdown(content);

  // Statistiques de mots
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const readMin = Math.max(1, Math.ceil(words / 200));
  document.getElementById('note-stats-info').textContent = `${words} mots · ~${readMin} min de lecture`;

  // Calcul des WikiLinks sortants [[...]] et entrants (Backlinks)
  const outgoingMatches = [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1].trim());
  const uniqueOutgoing = [...new Set(outgoingMatches)];

  const incomingNotes = state.notes.filter(other => {
    if (other.id === note.id) return false;
    return (other.content || '').toLowerCase().includes(`[[${(note.title || '').toLowerCase()}]]`);
  });

  const linksContainer = document.getElementById('note-links-container');
  let html = '';

  if (uniqueOutgoing.length > 0) {
    html += `<div><strong>↗ Liens sortants :</strong> ` +
      uniqueOutgoing.map(t => `<a href="#" class="wikilink-pill" data-wikilink="${escapeHtml(t)}">🔗 ${escapeHtml(t)}</a>`).join(' ') +
      `</div>`;
  }

  if (incomingNotes.length > 0) {
    html += `<div><strong>↙ Citée dans (Backlinks) :</strong> ` +
      incomingNotes.map(inc => `<a href="#" class="wikilink-pill" data-open-id="${inc.id}">${escapeHtml(inc.emoji || '📝')} ${escapeHtml(inc.title)}</a>`).join(' ') +
      `</div>`;
  }

  if (!html) {
    html = `<span style="color:var(--text-muted)">Utilisez <code>[[Titre d'une note]]</code> dans le texte pour créer des liens bidirectionnels entre vos notes.</span>`;
  }
  linksContainer.innerHTML = html;
}

function renderNoteChecklist(note) {
  const list = note.checklist || [];
  const doneCount = list.filter(c => c.done).length;
  document.getElementById('checklist-progress-badge').textContent = `${doneCount}/${list.length}`;

  const container = document.getElementById('note-checklist-items');
  if (list.length === 0) {
    container.innerHTML = `<div style="font-size:0.76rem;color:var(--text-muted)">Aucune sous-tâche. Ajoutez-en une ou cliquez sur "🧠 Auto-Tags & Tâches".</div>`;
    return;
  }

  container.innerHTML = list.map((item, idx) => `
    <div class="chk-row ${item.done ? 'done' : ''}">
      <label>
        <input type="checkbox" data-chk-idx="${idx}" ${item.done ? 'checked' : ''} />
        <span>${escapeHtml(item.text)}</span>
      </label>
      <button class="icon-btn-sm" data-del-chk="${idx}" title="Supprimer">✕</button>
    </div>
  `).join('');
}

// =============================================================================
// 3. RENDU VUE CARTES VISUELLES (GOOGLE KEEP STYLE)
// =============================================================================
function renderKeepCardsView() {
  const grid = document.getElementById('keep-cards-grid');
  if (!grid) return;

  const filtered = getFilteredNotes();
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state"><h3>Aucune carte à afficher</h3></div>`;
    return;
  }

  grid.innerHTML = filtered.map(note => {
    const cleanBody = (note.content || '').replace(/^#+\s+.+$/gm, '').replace(/[#*`>]/g, '').trim().substring(0, 200);
    const checklistHtml = (note.checklist || []).slice(0, 6).map((c, idx) => `
      <label class="keep-chk-item ${c.done ? 'done' : ''}">
        <input type="checkbox" data-keep-note="${note.id}" data-keep-chk="${idx}" ${c.done ? 'checked' : ''} />
        <span>${escapeHtml(c.text)}</span>
      </label>
    `).join('');

    return `
      <div class="keep-card color-${note.color || 'indigo'}">
        <div>
          <div class="keep-card-header">
            <div class="keep-card-title" data-open-editor="${note.id}">
              ${escapeHtml(note.emoji || '📝')} ${escapeHtml(note.title)}
            </div>
            <button class="icon-btn-sm ${note.pinned ? 'active' : ''}" data-keep-pin="${note.id}" title="Épingler">📌</button>
          </div>
          ${cleanBody ? `<div class="keep-card-body" data-open-editor="${note.id}">${escapeHtml(cleanBody)}</div>` : ''}
          ${checklistHtml ? `<div class="keep-card-checklist">${checklistHtml}</div>` : ''}
        </div>
        <div class="keep-card-footer">
          <div style="display:flex;gap:0.3rem;flex-wrap:wrap">
            ${(note.tags || []).slice(0, 3).map(t => `<span class="tag-pill" style="font-size:0.66rem">#${escapeHtml(t)}</span>`).join('')}
          </div>
          <div style="display:flex;gap:0.3rem">
            <button class="icon-btn-sm" data-open-editor="${note.id}" title="Ouvrir dans l'éditeur">✏️</button>
            <button class="icon-btn-sm" data-keep-delete="${note.id}" title="Supprimer">🗑️</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// =============================================================================
// 4. RENDU VUE TABLEAUX KANBAN
// =============================================================================
function renderKanbanBoard() {
  const statuses = ['todo', 'in_progress', 'review', 'done'];
  const filtered = getFilteredNotes();

  statuses.forEach(st => {
    const colNotes = filtered.filter(n => (n.kanbanStatus || 'todo') === st);
    const countEl = document.getElementById(`kb-count-${st}`);
    const listEl = document.getElementById(`kb-list-${st}`);
    if (countEl) countEl.textContent = colNotes.length;
    if (!listEl) return;

    listEl.innerHTML = colNotes.map(n => {
      const doneChk = (n.checklist || []).filter(c => c.done).length;
      const totalChk = (n.checklist || []).length;
      const prioLabels = { urgent: '🔴 Urgente', high: '🟠 Haute', medium: '🔵 Moyenne', low: '🟢 Basse' };

      return `
        <div class="kanban-card" draggable="true" data-kb-id="${n.id}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.45rem">
            <span class="priority-badge priority-${n.priority || 'medium'}">${prioLabels[n.priority] || 'Moyenne'}</span>
            ${n.dueDate ? `<span style="font-size:0.68rem;color:var(--text-secondary)">📅 ${escapeHtml(n.dueDate)}</span>` : ''}
          </div>
          <div style="font-weight:700;font-size:0.88rem;margin-bottom:0.4rem;cursor:pointer" data-open-editor="${n.id}">
            ${escapeHtml(n.emoji || '📝')} ${escapeHtml(n.title)}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.72rem;color:var(--text-secondary);margin-top:0.5rem">
            <span>${totalChk > 0 ? `✅ ${doneChk}/${totalChk} tâches` : (n.tags || []).slice(0, 2).map(t => `#${t}`).join(' ')}</span>
            <select class="kb-move-select" data-kb-move="${n.id}" style="background:var(--bg-surface);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:5px;font-size:0.68rem;padding:0.1rem 0.25rem">
              <option value="todo" ${st === 'todo' ? 'selected' : ''}>💡 À faire</option>
              <option value="in_progress" ${st === 'in_progress' ? 'selected' : ''}>⚡ En cours</option>
              <option value="review" ${st === 'review' ? 'selected' : ''}>🔍 Révision</option>
              <option value="done" ${st === 'done' ? 'selected' : ''}>✅ Terminé</option>
            </select>
          </div>
        </div>
      `;
    }).join('');
  });
}

// =============================================================================
// SAUVEGARDE AUTOMATIQUE & ACTIONS CRUD
// =============================================================================
function scheduleAutoSave() {
  const indicator = document.getElementById('save-status-indicator');
  if (indicator) indicator.textContent = '⏳ Enregistrement...';

  if (state.saveTimeout) clearTimeout(state.saveTimeout);
  state.saveTimeout = setTimeout(() => {
    saveActiveNoteNow();
  }, 550);
}

async function saveActiveNoteNow() {
  const note = getActiveNote();
  if (!note) return;

  try {
    const res = await fetch(`/api/notes/${note.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note)
    });
    if (res.ok) {
      const updated = await res.json();
      const idx = state.notes.findIndex(n => n.id === updated.id);
      if (idx >= 0) state.notes[idx] = updated;
      const indicator = document.getElementById('save-status-indicator');
      if (indicator) indicator.textContent = '✓ Enregistré';
      renderSidebar();
      renderNotesList();
      renderKeepCardsView();
      renderKanbanBoard();
    }
  } catch (err) {
    console.error('Erreur sauvegarde:', err);
  }
}

async function createNewNote(overrides = {}) {
  const defaultFolder = (state.filterType === 'folder' && state.filterValue)
    ? state.filterValue
    : (state.folders[0]?.id || 'folder_personal');

  const payload = {
    title: overrides.title || 'Nouvelle note',
    emoji: overrides.emoji || '📝',
    folderId: overrides.folderId || defaultFolder,
    color: overrides.color || 'indigo',
    kanbanStatus: overrides.kanbanStatus || 'todo',
    priority: overrides.priority || 'medium',
    tags: overrides.tags || [],
    content: overrides.content || `# ${overrides.title || 'Nouvelle note'}\n\nCommencez à écrire ici...`,
    checklist: overrides.checklist || []
  };

  const res = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    const created = await res.json();
    state.notes.unshift(created);
    state.activeNoteId = created.id;
    renderAll();
    showToast('✨ Nouvelle note créée');
    return created;
  }
}

// =============================================================================
// GESTIONNAIRES D'ÉVÉNEMENTS
// =============================================================================
function bindEvents() {
  // Bascule Mode Clair (Blanc) / Sombre (Noir)
  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    showToast(nextTheme === 'dark' ? '🌙 Mode Sombre (Noir) activé' : '☀️ Mode Clair (Blanc) activé');
  });

  // Toggle sidebar (Desktop: hidden / Mobile: drawer coulissant)
  const sidebar = document.getElementById('left-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');

  function closeMobileSidebar() {
    sidebar?.classList.remove('open');
    backdrop?.classList.remove('active');
  }

  function toggleMobileSidebar() {
    if (window.innerWidth <= 920) {
      sidebar?.classList.toggle('open');
      backdrop?.classList.toggle('active', sidebar?.classList.contains('open'));
    } else {
      sidebar?.classList.toggle('hidden');
    }
  }

  document.getElementById('btn-toggle-sidebar')?.addEventListener('click', toggleMobileSidebar);
  backdrop?.addEventListener('click', closeMobileSidebar);

  // Bouton retour mobile dans la note pour revenir à la liste
  document.getElementById('btn-mobile-back')?.addEventListener('click', () => {
    document.getElementById('view-editor')?.classList.remove('mobile-viewing-note');
  });

  // Switcher de vues (Markdown / Keep / Kanban)
  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeView = btn.dataset.view;
      document.querySelectorAll('.stage-view').forEach(v => v.classList.remove('active'));
      document.getElementById(`view-${state.activeView}`)?.classList.add('active');
      if (window.innerWidth <= 920) closeMobileSidebar();
    });
  });

  // Filtres rapides Sidebar
  document.querySelectorAll('#QuickFiltersList .nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.left-sidebar .nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      state.filterType = item.dataset.filter;
      state.filterValue = null;
      renderAll();
      if (window.innerWidth <= 920) closeMobileSidebar();
    });
  });

  // Clic sur un dossier
  document.getElementById('folders-list')?.addEventListener('click', e => {
    const li = e.target.closest('.nav-item');
    if (!li || !li.dataset.folderId) return;
    document.querySelectorAll('.left-sidebar .nav-item').forEach(i => i.classList.remove('active'));
    li.classList.add('active');
    state.filterType = 'folder';
    state.filterValue = li.dataset.folderId;
    renderAll();
    if (window.innerWidth <= 920) closeMobileSidebar();
  });

  // Nouveau dossier
  document.getElementById('btn-add-folder')?.addEventListener('click', async () => {
    const name = prompt('Nom du nouveau dossier :');
    if (!name || !name.trim()) return;
    const icon = prompt('Emoji du dossier (ex: 📁, 🚀, 💡) :', '📁') || '📁';
    const res = await fetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), icon: icon.trim() })
    });
    if (res.ok) {
      const folder = await res.json();
      state.folders.push(folder);
      renderSidebar();
      showToast(`📁 Dossier "${folder.name}" créé`);
    }
  });

  // Clic sur un tag dans le nuage
  document.getElementById('sidebar-tags-cloud')?.addEventListener('click', e => {
    const pill = e.target.closest('.tag-pill');
    if (!pill) return;
    const tag = pill.dataset.tag;
    if (state.filterType === 'tag' && state.filterValue === tag) {
      state.filterType = 'all';
      state.filterValue = null;
    } else {
      state.filterType = 'tag';
      state.filterValue = tag;
    }
    renderAll();
  });

  // Bouton Nouvelle Note
  document.getElementById('btn-new-note')?.addEventListener('click', () => createNewNote());
  document.getElementById('btn-empty-new-note')?.addEventListener('click', () => createNewNote());

  // Recherche instantanée
  const searchInput = document.getElementById('global-search-input');
  searchInput?.addEventListener('input', e => {
    state.searchQuery = e.target.value;
    renderAll();
  });
  searchInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && searchInput.value.trim().length > 3) {
      triggerAISemanticSearch();
    }
  });

  // Recherche sémantique IA
  document.getElementById('btn-ai-semantic-search')?.addEventListener('click', triggerAISemanticSearch);
  document.getElementById('btn-close-ai-search')?.addEventListener('click', () => {
    document.getElementById('ai-search-banner').classList.add('hidden');
  });

  // Sélection d'une note dans la liste
  document.getElementById('editor-notes-list')?.addEventListener('click', e => {
    const card = e.target.closest('.note-list-item');
    if (!card) return;
    state.activeNoteId = card.dataset.noteId;
    renderNotesList();
    renderActiveNoteEditor();
    if (window.innerWidth <= 768) {
      document.getElementById('view-editor')?.classList.add('mobile-viewing-note');
    }
  });

  // Édition des champs de la note active
  document.getElementById('note-emoji-input')?.addEventListener('input', e => {
    const n = getActiveNote();
    if (!n) return;
    n.emoji = e.target.value || '📝';
    scheduleAutoSave();
  });

  document.getElementById('note-title-input')?.addEventListener('input', e => {
    const n = getActiveNote();
    if (!n) return;
    n.title = e.target.value;
    scheduleAutoSave();
  });

  document.getElementById('note-folder-select')?.addEventListener('change', e => {
    const n = getActiveNote();
    if (!n) return;
    n.folderId = e.target.value;
    saveActiveNoteNow();
  });

  document.getElementById('note-kanban-select')?.addEventListener('change', e => {
    const n = getActiveNote();
    if (!n) return;
    n.kanbanStatus = e.target.value;
    saveActiveNoteNow();
  });

  document.getElementById('note-priority-select')?.addEventListener('change', e => {
    const n = getActiveNote();
    if (!n) return;
    n.priority = e.target.value;
    saveActiveNoteNow();
  });

  document.getElementById('note-color-select')?.addEventListener('change', e => {
    const n = getActiveNote();
    if (!n) return;
    n.color = e.target.value;
    saveActiveNoteNow();
  });

  document.getElementById('note-duedate-input')?.addEventListener('change', e => {
    const n = getActiveNote();
    if (!n) return;
    n.dueDate = e.target.value;
    saveActiveNoteNow();
  });

  // Épingler / Archiver / Supprimer
  document.getElementById('btn-pin-note')?.addEventListener('click', () => {
    const n = getActiveNote();
    if (!n) return;
    n.pinned = !n.pinned;
    renderActiveNoteEditor();
    saveActiveNoteNow();
    showToast(n.pinned ? '📌 Note épinglée aux favoris' : 'Note désépinglée');
  });

  document.getElementById('btn-archive-note')?.addEventListener('click', () => {
    const n = getActiveNote();
    if (!n) return;
    n.archived = !n.archived;
    saveActiveNoteNow();
    showToast(n.archived ? '🗄️ Note archivée' : 'Note restaurée');
  });

  document.getElementById('btn-delete-note')?.addEventListener('click', async () => {
    const n = getActiveNote();
    if (!n) return;
    if (!confirm(`Supprimer définitivement la note "${n.title}" ?`)) return;
    await fetch(`/api/notes/${n.id}`, { method: 'DELETE' });
    state.notes = state.notes.filter(x => x.id !== n.id);
    state.activeNoteId = state.notes.find(x => !x.archived)?.id || null;
    renderAll();
    showToast('🗑️ Note supprimée');
  });

  // Ajout & suppression de tags
  document.getElementById('note-add-tag-input')?.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const val = e.target.value.trim().replace(/^#/, '');
    if (!val) return;
    const n = getActiveNote();
    if (!n) return;
    if (!n.tags) n.tags = [];
    if (!n.tags.includes(val)) {
      n.tags.push(val);
      e.target.value = '';
      renderActiveNoteEditor();
      saveActiveNoteNow();
    }
  });

  document.getElementById('note-tags-list')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-remove-tag]');
    if (!btn) return;
    const idx = Number(btn.dataset.removeTag);
    const n = getActiveNote();
    if (!n) return;
    n.tags.splice(idx, 1);
    renderActiveNoteEditor();
    saveActiveNoteNow();
  });

  // Éditeur de texte Markdown
  const textarea = document.getElementById('note-content-textarea');
  textarea?.addEventListener('input', e => {
    const n = getActiveNote();
    if (!n) return;
    n.content = e.target.value;
    updateMarkdownPreviewAndLinks(n);
    scheduleAutoSave();
  });

  // Outils de formatage Markdown
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      insertMarkdownSnippet(btn.dataset.md);
    });
  });

  // Mode d'affichage Split / Édition / Aperçu
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const area = document.getElementById('editor-split-area');
      area.className = `editor-split-area mode-${btn.dataset.mode}`;
    });
  });

  // Clic sur un WikiLink [[Titre]] dans l'aperçu ou les backlinks
  document.addEventListener('click', async e => {
    const wiki = e.target.closest('.wikilink-pill');
    if (!wiki) return;
    e.preventDefault();

    if (wiki.dataset.openId) {
      state.activeNoteId = wiki.dataset.openId;
      switchToEditorView();
      renderAll();
      return;
    }

    const targetTitle = wiki.dataset.wikilink;
    if (!targetTitle) return;
    const existing = state.notes.find(n => n.title.toLowerCase() === targetTitle.toLowerCase());
    if (existing) {
      state.activeNoteId = existing.id;
      switchToEditorView();
      renderAll();
      showToast(`🔗 Ouverture de "${existing.title}"`);
    } else {
      const created = await createNewNote({
        title: targetTitle,
        content: `# ${targetTitle}\n\nNote reliée depuis [[${getActiveNote()?.title || 'Note'}]].`
      });
      if (created) switchToEditorView();
    }
  });

  // Checklist interactive dans l'éditeur
  document.getElementById('note-checklist-items')?.addEventListener('change', e => {
    if (e.target.matches('input[type="checkbox"][data-chk-idx]')) {
      const idx = Number(e.target.dataset.chkIdx);
      const n = getActiveNote();
      if (!n || !n.checklist[idx]) return;
      n.checklist[idx].done = e.target.checked;
      renderNoteChecklist(n);
      saveActiveNoteNow();
    }
  });

  document.getElementById('note-checklist-items')?.addEventListener('click', e => {
    const delBtn = e.target.closest('button[data-del-chk]');
    if (!delBtn) return;
    const idx = Number(delBtn.dataset.delChk);
    const n = getActiveNote();
    if (!n) return;
    n.checklist.splice(idx, 1);
    renderNoteChecklist(n);
    saveActiveNoteNow();
  });

  const addChecklistItem = () => {
    const input = document.getElementById('new-checklist-item-input');
    const text = input.value.trim();
    if (!text) return;
    const n = getActiveNote();
    if (!n) return;
    if (!n.checklist) n.checklist = [];
    n.checklist.push({ id: `chk_${Date.now()}`, text, done: false });
    input.value = '';
    renderNoteChecklist(n);
    saveActiveNoteNow();
  };

  document.getElementById('btn-add-checklist-item')?.addEventListener('click', addChecklistItem);
  document.getElementById('new-checklist-item-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addChecklistItem();
    }
  });

  // =========================================================================
  // ACTIONS IA SUR LA NOTE ACTIVE
  // =========================================================================
  document.getElementById('btn-ai-autoorganize')?.addEventListener('click', async () => {
    const n = getActiveNote();
    if (!n) return;
    showToast('🧠 Cortex IA analyse et organise votre note...');
    try {
      const res = await fetch('/api/ai/auto-organize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: n.title, content: n.content })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur IA');

      if (data.suggestedTitle && (!n.title || n.title === 'Nouvelle note')) {
        n.title = data.suggestedTitle;
      }
      if (data.emoji) n.emoji = data.emoji;
      if (data.suggestedFolderId) n.folderId = data.suggestedFolderId;
      if (data.priority) n.priority = data.priority;
      if (Array.isArray(data.tags)) {
        n.tags = [...new Set([...(n.tags || []), ...data.tags])];
      }
      if (Array.isArray(data.checklist) && data.checklist.length > 0) {
        n.checklist = [...(n.checklist || []), ...data.checklist];
      }

      renderActiveNoteEditor();
      await saveActiveNoteNow();
      showToast('✨ Tags, dossier, priorité et plan d\'action générés !');
    } catch (err) {
      showToast(`❌ Erreur IA : ${err.message}`);
    }
  });

  document.querySelectorAll('.ai-action-chip[data-ai-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.aiAction;
      await runAIWritingAction(action);
    });
  });

  document.getElementById('ai-translate-lang')?.addEventListener('change', async e => {
    const lang = e.target.value;
    if (!lang) return;
    e.target.value = '';
    await runAIWritingAction('translate', lang);
  });

  // =========================================================================
  // ÉVÉNEMENTS VUE CARTES KEEP
  // =========================================================================
  document.getElementById('btn-keep-create')?.addEventListener('click', async () => {
    const titleInput = document.getElementById('keep-quick-title');
    const contentInput = document.getElementById('keep-quick-content');
    const colorSelect = document.getElementById('keep-quick-color');

    const title = titleInput.value.trim() || 'Note rapide';
    const rawContent = contentInput.value.trim();
    if (!rawContent && !titleInput.value.trim()) return;

    const lines = rawContent.split('\n');
    const checklist = [];
    const mdLines = [];
    lines.forEach((l, i) => {
      if (l.trim().startsWith('- ')) {
        checklist.push({ id: `chk_k_${Date.now()}_${i}`, text: l.trim().substring(2), done: false });
      } else {
        mdLines.push(l);
      }
    });

    await createNewNote({
      title,
      emoji: '📌',
      color: colorSelect.value,
      content: mdLines.join('\n') || `# ${title}`,
      checklist
    });

    titleInput.value = '';
    contentInput.value = '';
  });

  document.getElementById('btn-keep-voice')?.addEventListener('click', () => {
    openModal('modal-voice');
  });

  document.getElementById('keep-cards-grid')?.addEventListener('click', async e => {
    const openEl = e.target.closest('[data-open-editor]');
    if (openEl) {
      state.activeNoteId = openEl.dataset.openEditor;
      switchToEditorView();
      renderAll();
      return;
    }

    const pinBtn = e.target.closest('[data-keep-pin]');
    if (pinBtn) {
      const note = state.notes.find(n => n.id === pinBtn.dataset.keepPin);
      if (note) {
        note.pinned = !note.pinned;
        await fetch(`/api/notes/${note.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(note)
        });
        renderAll();
      }
      return;
    }

    const delBtn = e.target.closest('[data-keep-delete]');
    if (delBtn) {
      const noteId = delBtn.dataset.keepDelete;
      await fetch(`/api/notes/${noteId}`, { method: 'DELETE' });
      state.notes = state.notes.filter(n => n.id !== noteId);
      renderAll();
      showToast('🗑️ Carte supprimée');
    }
  });

  document.getElementById('keep-cards-grid')?.addEventListener('change', async e => {
    if (e.target.matches('input[data-keep-note]')) {
      const noteId = e.target.dataset.keepNote;
      const chkIdx = Number(e.target.dataset.keepChk);
      const note = state.notes.find(n => n.id === noteId);
      if (note && note.checklist[chkIdx]) {
        note.checklist[chkIdx].done = e.target.checked;
        await fetch(`/api/notes/${note.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(note)
        });
        renderAll();
      }
    }
  });

  // =========================================================================
  // ÉVÉNEMENTS VUE KANBAN (DRAG & DROP + SELECT + AJOUT)
  // =========================================================================
  document.querySelectorAll('.kanban-add-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const status = btn.dataset.addStatus;
      const title = prompt('Titre de la carte Kanban :');
      if (!title || !title.trim()) return;
      await createNewNote({
        title: title.trim(),
        emoji: '📋',
        kanbanStatus: status,
        priority: 'medium'
      });
    });
  });

  document.getElementById('view-kanban')?.addEventListener('click', e => {
    const openEl = e.target.closest('[data-open-editor]');
    if (openEl) {
      state.activeNoteId = openEl.dataset.openEditor;
      switchToEditorView();
      renderAll();
    }
  });

  document.getElementById('view-kanban')?.addEventListener('change', async e => {
    if (e.target.matches('.kb-move-select')) {
      const noteId = e.target.dataset.kbMove;
      const newStatus = e.target.value;
      await moveKanbanCard(noteId, newStatus);
    }
  });

  // Drag & Drop Kanban
  let draggedNoteId = null;
  document.getElementById('view-kanban')?.addEventListener('dragstart', e => {
    const card = e.target.closest('.kanban-card');
    if (card) {
      draggedNoteId = card.dataset.kbId;
    }
  });

  document.querySelectorAll('.kanban-cards-list').forEach(col => {
    col.addEventListener('dragover', e => e.preventDefault());
    col.addEventListener('drop', async e => {
      e.preventDefault();
      const targetStatus = col.dataset.status;
      if (draggedNoteId && targetStatus) {
        await moveKanbanCard(draggedNoteId, targetStatus);
        draggedNoteId = null;
      }
    });
  });

  // =========================================================================
  // MODALS : DICTÉE VOCALE, GÉNÉRATION IA, PARTAGE & EXPORT
  // =========================================================================
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.closeModal)?.classList.add('hidden');
      stopVoiceRecognition();
    });
  });

  document.getElementById('btn-open-voice-modal')?.addEventListener('click', () => {
    openModal('modal-voice');
  });

  document.getElementById('btn-start-recording')?.addEventListener('click', toggleVoiceRecognition);

  document.getElementById('btn-structure-voice')?.addEventListener('click', async () => {
    const transcript = document.getElementById('voice-transcript-textarea').value.trim();
    if (!transcript) {
      showToast('Veuillez dicter ou saisir un texte à structurer.');
      return;
    }
    const btn = document.getElementById('btn-structure-voice');
    btn.disabled = true;
    btn.textContent = '⏳ Structuration IA en cours...';

    try {
      const lang = document.getElementById('voice-lang-select').value;
      const res = await fetch('/api/ai/voice-structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, lang, saveImmediately: true })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur IA');

      state.notes.unshift(data.note);
      state.activeNoteId = data.note.id;
      document.getElementById('voice-transcript-textarea').value = '';
      document.getElementById('modal-voice').classList.add('hidden');
      switchToEditorView();
      renderAll();
      showToast('🎙️ Dictée structurée en note Markdown avec succès !');
    } catch (err) {
      showToast(`❌ Erreur : ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ Structurer & Créer la Note par IA';
    }
  });

  // Génération de note par IA
  document.getElementById('btn-open-ai-gen-modal')?.addEventListener('click', () => {
    openModal('modal-ai-gen');
  });

  document.querySelectorAll('.chip-suggest').forEach(chip => {
    chip.addEventListener('click', () => {
      document.getElementById('ai-gen-prompt-input').value = chip.dataset.gen;
    });
  });

  document.getElementById('btn-submit-ai-gen')?.addEventListener('click', async () => {
    const promptInput = document.getElementById('ai-gen-prompt-input');
    const promptText = promptInput.value.trim();
    if (!promptText) return;

    const btn = document.getElementById('btn-submit-ai-gen');
    btn.disabled = true;
    btn.textContent = '⏳ Génération par ai.oussamma.tn...';

    try {
      const res = await fetch('/api/ai/generate-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText })
      });
      const created = await res.json();
      if (!res.ok) throw new Error(created.error || 'Erreur génération IA');

      state.notes.unshift(created);
      state.activeNoteId = created.id;
      promptInput.value = '';
      document.getElementById('modal-ai-gen').classList.add('hidden');
      switchToEditorView();
      renderAll();
      showToast('✨ Note générée avec succès par Cortex IA !');
    } catch (err) {
      showToast(`❌ Erreur : ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = '🚀 Générer la Note';
    }
  });

  // Partage public & Export
  document.getElementById('btn-share-note')?.addEventListener('click', () => {
    const n = getActiveNote();
    if (!n) return;
    const chk = document.getElementById('share-public-checkbox');
    const box = document.getElementById('share-url-box');
    const urlInput = document.getElementById('share-url-input');

    chk.checked = Boolean(n.isPublic && n.shareToken);
    if (chk.checked) {
      box.classList.remove('hidden');
      urlInput.value = `${window.location.origin}/?share=${n.shareToken}`;
    } else {
      box.classList.add('hidden');
    }
    openModal('modal-share');
  });

  document.getElementById('share-public-checkbox')?.addEventListener('change', async e => {
    const n = getActiveNote();
    if (!n) return;
    const enable = e.target.checked;
    const res = await fetch(`/api/notes/${n.id}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable })
    });
    if (res.ok) {
      const data = await res.json();
      const idx = state.notes.findIndex(x => x.id === n.id);
      if (idx >= 0) state.notes[idx] = data.note;
      const box = document.getElementById('share-url-box');
      const urlInput = document.getElementById('share-url-input');
      if (data.shareUrl) {
        box.classList.remove('hidden');
        urlInput.value = data.shareUrl;
        showToast('🌐 Lien public activé !');
      } else {
        box.classList.add('hidden');
        showToast('🔒 Lien public révoqué');
      }
    }
  });

  document.getElementById('btn-copy-share-url')?.addEventListener('click', () => {
    const val = document.getElementById('share-url-input').value;
    navigator.clipboard.writeText(val);
    showToast('🔗 Lien de partage copié !');
  });

  // Exports
  document.getElementById('btn-export-md')?.addEventListener('click', () => {
    const n = getActiveNote();
    if (!n) return;
    downloadFile(`${slugify(n.title)}.md`, n.content || '', 'text/markdown');
  });

  document.getElementById('btn-export-html')?.addEventListener('click', () => {
    const n = getActiveNote();
    if (!n) return;
    const htmlDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(n.title)}</title><style>body{font-family:sans-serif;max-width:800px;margin:2rem auto;padding:1rem;line-height:1.6}</style></head><body>${renderMarkdown(n.content)}</body></html>`;
    downloadFile(`${slugify(n.title)}.html`, htmlDoc, 'text/html');
  });

  document.getElementById('btn-export-print')?.addEventListener('click', () => {
    window.print();
  });

  document.getElementById('btn-export-copy')?.addEventListener('click', () => {
    const n = getActiveNote();
    if (!n) return;
    navigator.clipboard.writeText(n.content || '');
    showToast('📋 Note copiée dans le presse-papiers !');
  });

  // =========================================================================
  // CHAT LATÉRAL CORTEX IA (SECOND BRAIN)
  // =========================================================================
  document.getElementById('btn-toggle-chat')?.addEventListener('click', () => {
    document.getElementById('chat-drawer').classList.toggle('hidden');
  });

  document.getElementById('btn-close-chat')?.addEventListener('click', () => {
    document.getElementById('chat-drawer').classList.add('hidden');
  });

  document.getElementById('btn-clear-chat')?.addEventListener('click', async () => {
    const res = await fetch('/api/chat', { method: 'DELETE' });
    if (res.ok) {
      state.chatHistory = await res.json();
      renderChatMessages();
    }
  });

  document.querySelectorAll('.chat-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      sendChatMessage(chip.dataset.prompt);
    });
  });

  document.getElementById('chat-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendChatMessage(text);
  });
}

// =============================================================================
// FONCTIONS AUXILIAIRES (IA, KANBAN, DICTÉE VOCALE, EXPORT)
// =============================================================================
function switchToEditorView() {
  state.activeView = 'editor';
  document.querySelectorAll('.view-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.view === 'editor');
  });
  document.querySelectorAll('.stage-view').forEach(v => v.classList.remove('active'));
  const editorView = document.getElementById('view-editor');
  editorView?.classList.add('active');
  if (window.innerWidth <= 768 && state.activeNoteId) {
    editorView?.classList.add('mobile-viewing-note');
  }
}

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

async function moveKanbanCard(noteId, newStatus) {
  const note = state.notes.find(n => n.id === noteId);
  if (!note) return;
  note.kanbanStatus = newStatus;
  renderAll();
  await fetch(`/api/notes/${noteId}/kanban`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kanbanStatus: newStatus })
  });
  showToast('📋 Statut Kanban mis à jour');
}

async function runAIWritingAction(action, targetLang = '') {
  const n = getActiveNote();
  if (!n) return;
  showToast('✨ Cortex IA traite votre note...');

  try {
    const res = await fetch('/api/ai/assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        title: n.title,
        content: n.content,
        targetLang
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur IA');

    if (action === 'summarize' || action === 'action_plan') {
      n.content = `${n.content}\n\n---\n\n${data.result}`;
    } else if (action === 'continue') {
      n.content = `${n.content}\n\n${data.result}`;
    } else {
      n.content = data.result;
    }

    document.getElementById('note-content-textarea').value = n.content;
    updateMarkdownPreviewAndLinks(n);
    await saveActiveNoteNow();
    showToast('✨ Contenu mis à jour par Cortex IA !');
  } catch (err) {
    showToast(`❌ Erreur IA : ${err.message}`);
  }
}

async function triggerAISemanticSearch() {
  const query = document.getElementById('global-search-input').value.trim();
  if (!query) {
    showToast('Saisissez une question ou un sujet dans la barre de recherche.');
    return;
  }

  showToast('🧠 Recherche sémantique IA en cours...');
  try {
    const res = await fetch('/api/ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur recherche IA');

    const banner = document.getElementById('ai-search-banner');
    document.getElementById('ai-search-direct-answer').textContent = data.directAnswer || '';

    const matchesBox = document.getElementById('ai-search-matches');
    matchesBox.innerHTML = (data.matches || []).map(m => {
      const found = state.notes.find(n => n.id === m.noteId);
      if (!found) return '';
      return `
        <div class="ai-match-chip" data-open-match="${found.id}" title="${escapeHtml(m.reason || '')}">
          <span>${escapeHtml(found.emoji || '📝')} <strong>${escapeHtml(found.title)}</strong></span>
          <span style="color:#34d399;font-weight:700">${m.matchScore || 90}%</span>
        </div>
      `;
    }).join('');

    banner.classList.remove('hidden');

    matchesBox.querySelectorAll('[data-open-match]').forEach(chip => {
      chip.addEventListener('click', () => {
        state.activeNoteId = chip.dataset.openMatch;
        switchToEditorView();
        renderAll();
      });
    });
  } catch (err) {
    showToast(`❌ Erreur recherche IA : ${err.message}`);
  }
}

function renderChatMessages() {
  const box = document.getElementById('chat-messages');
  if (!box) return;

  box.innerHTML = state.chatHistory.map(m => `
    <div class="chat-bubble ${m.sender === 'user' ? 'user' : 'ai'} markdown-body">
      ${m.sender === 'user' ? escapeHtml(m.text) : renderMarkdown(m.text)}
    </div>
  `).join('');
  box.scrollTop = box.scrollHeight;
}

async function sendChatMessage(message) {
  document.getElementById('chat-drawer').classList.remove('hidden');
  state.chatHistory.push({
    id: `temp_${Date.now()}`,
    sender: 'user',
    text: message,
    timestamp: new Date().toISOString()
  });
  renderChatMessages();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, lang: 'fr' })
    });
    const data = await res.json();
    if (res.ok && data.history) {
      state.chatHistory = data.history;
      renderChatMessages();
    }
  } catch (err) {
    showToast(`❌ Erreur Cortex IA : ${err.message}`);
  }
}

function insertMarkdownSnippet(type) {
  const textarea = document.getElementById('note-content-textarea');
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.substring(start, end);

  const snippets = {
    h1: `# ${selected || 'Titre principal'}\n`,
    h2: `## ${selected || 'Sous-titre'}\n`,
    h3: `### ${selected || 'Section'}\n`,
    bold: `**${selected || 'texte en gras'}**`,
    italic: `*${selected || 'texte en italique'}*`,
    code: `\`${selected || 'code'}\``,
    codeblock: `\n\`\`\`bash\n${selected || '# Votre code ici'}\n\`\`\`\n`,
    list: `\n- ${selected || 'Élément de liste'}`,
    check: `\n- [ ] ${selected || 'Tâche à accomplir'}`,
    quote: `\n> ${selected || 'Citation importante'}`,
    wikilink: `[[${selected || 'Titre de la note'}]]`
  };

  const replacement = snippets[type] || selected;
  textarea.setRangeText(replacement, start, end, 'end');
  textarea.focus();
  textarea.dispatchEvent(new Event('input'));
}

// Reconnaissance vocale Web Speech API
function toggleVoiceRecognition() {
  if (state.isRecording) {
    stopVoiceRecognition();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('⚠️ La reconnaissance vocale directe n\'est pas supportée par ce navigateur. Saisissez votre texte et cliquez sur Structurer par IA.');
    return;
  }

  state.recognition = new SpeechRecognition();
  state.recognition.lang = document.getElementById('voice-lang-select').value || 'fr-FR';
  state.recognition.continuous = true;
  state.recognition.interimResults = true;

  const btn = document.getElementById('btn-start-recording');
  const statusBadge = document.getElementById('voice-status-badge');
  const textarea = document.getElementById('voice-transcript-textarea');
  const initialText = textarea.value ? textarea.value + ' ' : '';

  state.recognition.onstart = () => {
    state.isRecording = true;
    btn.classList.add('recording');
    btn.textContent = '⏹️ Arrêter l\'écoute';
    statusBadge.textContent = '🔴 Écoute en cours... Parlez librement';
  };

  state.recognition.onresult = event => {
    let transcript = '';
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    textarea.value = initialText + transcript;
  };

  state.recognition.onerror = () => {
    stopVoiceRecognition();
  };

  state.recognition.onend = () => {
    stopVoiceRecognition();
  };

  state.recognition.start();
}

function stopVoiceRecognition() {
  if (state.recognition && state.isRecording) {
    try { state.recognition.stop(); } catch (e) {}
  }
  state.isRecording = false;
  const btn = document.getElementById('btn-start-recording');
  const statusBadge = document.getElementById('voice-status-badge');
  if (btn) {
    btn.classList.remove('recording');
    btn.textContent = '🎙️ Démarrer l\'écoute';
  }
  if (statusBadge) {
    statusBadge.textContent = 'Prêt';
  }
}

function slugify(str) {
  return String(str || 'note')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'note';
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
