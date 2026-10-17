import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { DEFAULT_FOLDERS, DEFAULT_NOTES } from './default-notes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_FILE = path.join(DATA_DIR, 'notes_store.json');

function readDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const db = JSON.parse(raw);
      let modified = false;

      // Nettoyage automatique de toutes les anciennes données de test/démo
      const demoNoteIds = new Set([
        'note_ecosystem_arch',
        'note_roadmap_q4',
        'note_devops_snippets',
        'note_ai_ideas',
        'note_meeting_template'
      ]);

      if (db && db.users) {
        for (const uid of Object.keys(db.users)) {
          const userSpace = db.users[uid];
          if (Array.isArray(userSpace.notes)) {
            const initialCount = userSpace.notes.length;
            userSpace.notes = userSpace.notes.filter(n => !demoNoteIds.has(n.id));
            if (userSpace.notes.length !== initialCount) {
              modified = true;
            }
          }
        }
      }

      if (modified) {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
      }

      return db;
    }
  } catch (err) {
    console.error('Erreur lecture notes_store.json:', err.message);
  }
  return { users: {} };
}

function writeDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erreur écriture notes_store.json:', err.message);
  }
}

function ensureUserSpace(db, userId) {
  const safeId = userId || 'default_user';
  if (!db.users) db.users = {};
  if (!db.users[safeId]) {
    db.users[safeId] = {
      folders: JSON.parse(JSON.stringify(DEFAULT_FOLDERS)),
      notes: JSON.parse(JSON.stringify(DEFAULT_NOTES)),
      chatHistory: [
        {
          id: 'msg_welcome',
          sender: 'ai',
          text: "Bonjour ! Je suis **Cortex IA**, votre assistant Second Brain connecté à toutes vos notes sur `notes.oussamma.tn`. Posez-moi une question sur vos notes, demandez-moi de résumer un dossier, d'extraire des tâches Kanban ou de rédiger un document !",
          timestamp: new Date().toISOString()
        }
      ]
    };
    writeDB(db);
  }
  return db.users[safeId];
}

export const Storage = {
  // === DOSSIERS ===
  getFolders(userId) {
    const db = readDB();
    const space = ensureUserSpace(db, userId);
    return space.folders;
  },

  saveFolder(userId, folderData) {
    const db = readDB();
    const space = ensureUserSpace(db, userId);
    if (!folderData.name || !folderData.name.trim()) {
      throw new Error('Le nom du dossier est requis');
    }
    const existingIdx = folderData.id ? space.folders.findIndex(f => f.id === folderData.id) : -1;
    if (existingIdx >= 0) {
      space.folders[existingIdx] = {
        ...space.folders[existingIdx],
        name: folderData.name.trim(),
        icon: folderData.icon || space.folders[existingIdx].icon || '📁',
        color: folderData.color || space.folders[existingIdx].color || '#6366f1'
      };
      writeDB(db);
      return space.folders[existingIdx];
    } else {
      const newFolder = {
        id: `folder_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        name: folderData.name.trim(),
        icon: folderData.icon || '📁',
        color: folderData.color || '#6366f1'
      };
      space.folders.push(newFolder);
      writeDB(db);
      return newFolder;
    }
  },

  deleteFolder(userId, folderId) {
    const db = readDB();
    const space = ensureUserSpace(db, userId);
    space.folders = space.folders.filter(f => f.id !== folderId);
    // Déplacer les notes de ce dossier vers le premier dossier disponible ou null
    space.notes.forEach(n => {
      if (n.folderId === folderId) {
        n.folderId = space.folders[0]?.id || 'folder_personal';
      }
    });
    writeDB(db);
    return space.folders;
  },

  // === NOTES ===
  getNotes(userId) {
    const db = readDB();
    const space = ensureUserSpace(db, userId);

    // Notes créées par l'utilisateur
    const myNotes = (space.notes || []).map(n => ({ ...n, isSharedWithMe: false }));

    // Notes partagées avec cet utilisateur (dont il est collaborateur via lien de collaboration)
    const sharedWithMe = [];
    for (const [ownerId, ownerSpace] of Object.entries(db.users || {})) {
      if (ownerId === userId) continue;
      for (const note of (ownerSpace.notes || [])) {
        if (note.collabToken && Array.isArray(note.collaborators)) {
          const isParticipant = note.collaborators.some(c => c.id === userId || c.email === userId);
          if (isParticipant) {
            sharedWithMe.push({
              ...note,
              ownerId,
              isSharedWithMe: true
            });
          }
        }
      }
    }

    const all = [...myNotes, ...sharedWithMe];
    return all.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
    });
  },

  getNoteById(userId, noteId) {
    const db = readDB();
    const space = ensureUserSpace(db, userId);
    const found = space.notes.find(n => n.id === noteId);
    if (found) return { ...found, isSharedWithMe: false };

    // Vérifier si c'est une note partagée dont l'utilisateur est collaborateur
    for (const [ownerId, ownerSpace] of Object.entries(db.users || {})) {
      if (ownerId === userId) continue;
      const sharedNote = (ownerSpace.notes || []).find(n => n.id === noteId);
      if (sharedNote && sharedNote.collabToken) {
        return { ...sharedNote, ownerId, isSharedWithMe: true };
      }
    }
    return null;
  },

  saveNote(userId, noteData, editorUser = null) {
    const db = readDB();
    const space = ensureUserSpace(db, userId);
    const now = new Date().toISOString();

    // 1. Vérifier si c'est une note possédée par l'utilisateur
    const existingIdx = noteData.id ? space.notes.findIndex(n => n.id === noteData.id) : -1;
    if (existingIdx >= 0) {
      const current = space.notes[existingIdx];
      const updated = {
        ...current,
        title: noteData.title !== undefined ? (noteData.title.trim() || 'Note sans titre') : current.title,
        color: noteData.color !== undefined ? noteData.color : (current.color || 'default'),
        pinned: noteData.pinned !== undefined ? Boolean(noteData.pinned) : Boolean(current.pinned),
        archived: noteData.archived !== undefined ? Boolean(noteData.archived) : Boolean(current.archived),
        content: noteData.content !== undefined ? noteData.content : (current.content || ''),
        checklist: Array.isArray(noteData.checklist) ? noteData.checklist : (current.checklist || []),
        lastEditedBy: editorUser ? (editorUser.name || editorUser.email) : (current.lastEditedBy || null),
        version: (current.version || 1) + 1,
        updatedAt: now
      };
      space.notes[existingIdx] = updated;
      writeDB(db);
      return updated;
    }

    // 2. Si non trouvée dans l'espace utilisateur, vérifier si c'est une note partagée appartenant à un autre utilisateur
    if (noteData.id) {
      for (const [ownerId, ownerSpace] of Object.entries(db.users || {})) {
        if (ownerId === userId) continue;
        const sharedIdx = (ownerSpace.notes || []).findIndex(n => n.id === noteData.id);
        if (sharedIdx >= 0) {
          const current = ownerSpace.notes[sharedIdx];
          const updated = {
            ...current,
            title: noteData.title !== undefined ? (noteData.title.trim() || 'Note sans titre') : current.title,
            color: noteData.color !== undefined ? noteData.color : (current.color || 'default'),
            pinned: noteData.pinned !== undefined ? Boolean(noteData.pinned) : Boolean(current.pinned),
            archived: noteData.archived !== undefined ? Boolean(noteData.archived) : Boolean(current.archived),
            content: noteData.content !== undefined ? noteData.content : (current.content || ''),
            checklist: Array.isArray(noteData.checklist) ? noteData.checklist : (current.checklist || []),
            lastEditedBy: editorUser ? (editorUser.name || editorUser.email) : (current.lastEditedBy || null),
            version: (current.version || 1) + 1,
            updatedAt: now
          };
          ownerSpace.notes[sharedIdx] = updated;
          writeDB(db);
          return { ...updated, ownerId, isSharedWithMe: true };
        }
      }
    }

    // 3. Création d'une nouvelle note
    const newNote = {
      id: noteData.id || `note_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      title: (noteData.title || '').trim(),
      color: noteData.color || 'default',
      pinned: Boolean(noteData.pinned),
      archived: Boolean(noteData.archived),
      content: noteData.content || '',
      checklist: Array.isArray(noteData.checklist) ? noteData.checklist : [],
      collabToken: null,
      collaborators: [],
      lastEditedBy: editorUser ? (editorUser.name || editorUser.email) : null,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    space.notes.unshift(newNote);
    writeDB(db);
    return newNote;
  },

  deleteNote(userId, noteId) {
    const db = readDB();
    const space = ensureUserSpace(db, userId);
    const initialLen = space.notes.length;
    space.notes = space.notes.filter(n => n.id !== noteId);
    if (space.notes.length !== initialLen) {
      writeDB(db);
      return true;
    }
    // Si c'était une note partagée dont l'utilisateur veut juste se retirer
    for (const [ownerId, ownerSpace] of Object.entries(db.users || {})) {
      const found = (ownerSpace.notes || []).find(n => n.id === noteId);
      if (found && Array.isArray(found.collaborators)) {
        found.collaborators = found.collaborators.filter(c => c.id !== userId && c.email !== userId);
        writeDB(db);
        return true;
      }
    }
    return false;
  },

  // === COLLABORATION MULTI-UTILISATEURS EN TEMPS RÉEL VIA LIEN ===
  enableCollaboration(userId, noteId) {
    const db = readDB();
    const space = ensureUserSpace(db, userId);
    let note = space.notes.find(n => n.id === noteId);
    let ownerId = userId;

    if (!note) {
      // Chercher si l'utilisateur est déjà collaborateur sur cette note
      for (const [oid, ospace] of Object.entries(db.users || {})) {
        const found = (ospace.notes || []).find(n => n.id === noteId);
        if (found) {
          note = found;
          ownerId = oid;
          break;
        }
      }
    }

    if (!note) throw new Error('Note introuvable');

    if (!note.collabToken) {
      note.collabToken = crypto.randomBytes(12).toString('base64url');
    }
    if (!Array.isArray(note.collaborators)) {
      note.collaborators = [];
    }

    note.updatedAt = new Date().toISOString();
    writeDB(db);
    return { note, ownerId, collabToken: note.collabToken };
  },

  getNoteByCollabToken(token) {
    if (!token) return null;
    const db = readDB();
    for (const [ownerId, space] of Object.entries(db.users || {})) {
      const found = (space.notes || []).find(n => n.collabToken === token);
      if (found) {
        return { note: found, ownerId };
      }
    }
    return null;
  },

  joinCollaboration(token, currentUser) {
    if (!token || !currentUser) return null;
    const db = readDB();
    for (const [ownerId, space] of Object.entries(db.users || {})) {
      const note = (space.notes || []).find(n => n.collabToken === token);
      if (note) {
        if (!Array.isArray(note.collaborators)) {
          note.collaborators = [];
        }
        const userUid = currentUser.id || currentUser.email;
        const exists = note.collaborators.some(c => c.id === userUid || c.email === currentUser.email);
        if (!exists && userUid !== ownerId) {
          note.collaborators.push({
            id: userUid,
            name: currentUser.name || currentUser.email.split('@')[0],
            email: currentUser.email,
            avatar_url: currentUser.avatar_url || null,
            joinedAt: new Date().toISOString()
          });
          writeDB(db);
        }
        return { note, ownerId };
      }
    }
    return null;
  },

  updateCollabNoteContent(token, updateData, user) {
    const db = readDB();
    for (const [ownerId, space] of Object.entries(db.users || {})) {
      const note = (space.notes || []).find(n => n.collabToken === token);
      if (note) {
        const now = new Date().toISOString();
        if (updateData.title !== undefined) note.title = updateData.title.trim();
        if (updateData.content !== undefined) note.content = updateData.content;
        if (updateData.color !== undefined) note.color = updateData.color;
        if (Array.isArray(updateData.checklist)) note.checklist = updateData.checklist;
        note.lastEditedBy = user ? (user.name || user.email) : 'Collaborateur';
        note.version = (note.version || 1) + 1;
        note.updatedAt = now;
        writeDB(db);
        return { note, ownerId };
      }
    }
    return null;
  },

  // === HISTORIQUE DE CHAT CORTEX IA ===
  getChatHistory(userId) {
    const db = readDB();
    const space = ensureUserSpace(db, userId);
    return space.chatHistory || [];
  },

  saveChatHistory(userId, history) {
    const db = readDB();
    const space = ensureUserSpace(db, userId);
    space.chatHistory = history.slice(-40);
    writeDB(db);
    return space.chatHistory;
  },

  clearChatHistory(userId) {
    const db = readDB();
    const space = ensureUserSpace(db, userId);
    space.chatHistory = [
      {
        id: `msg_welcome_${Date.now()}`,
        sender: 'ai',
        text: "Historique réinitialisé. Je suis **Cortex IA**, prêt à analyser vos notes ou rédiger du contenu !",
        timestamp: new Date().toISOString()
      }
    ];
    writeDB(db);
    return space.chatHistory;
  }
};
