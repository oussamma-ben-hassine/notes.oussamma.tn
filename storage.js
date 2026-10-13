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
      return JSON.parse(raw);
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
    return space.notes.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
    });
  },

  getNoteById(userId, noteId) {
    const db = readDB();
    const space = ensureUserSpace(db, userId);
    return space.notes.find(n => n.id === noteId) || null;
  },

  saveNote(userId, noteData) {
    const db = readDB();
    const space = ensureUserSpace(db, userId);
    const now = new Date().toISOString();

    const existingIdx = noteData.id ? space.notes.findIndex(n => n.id === noteData.id) : -1;

    if (existingIdx >= 0) {
      const current = space.notes[existingIdx];
      const updated = {
        ...current,
        title: noteData.title !== undefined ? (noteData.title.trim() || 'Note sans titre') : current.title,
        emoji: noteData.emoji !== undefined ? noteData.emoji : (current.emoji || '📝'),
        folderId: noteData.folderId !== undefined ? noteData.folderId : current.folderId,
        type: noteData.type !== undefined ? noteData.type : (current.type || 'markdown'),
        color: noteData.color !== undefined ? noteData.color : (current.color || 'indigo'),
        pinned: noteData.pinned !== undefined ? Boolean(noteData.pinned) : Boolean(current.pinned),
        archived: noteData.archived !== undefined ? Boolean(noteData.archived) : Boolean(current.archived),
        kanbanStatus: noteData.kanbanStatus !== undefined ? noteData.kanbanStatus : (current.kanbanStatus || 'todo'),
        priority: noteData.priority !== undefined ? noteData.priority : (current.priority || 'medium'),
        dueDate: noteData.dueDate !== undefined ? noteData.dueDate : (current.dueDate || null),
        tags: Array.isArray(noteData.tags) ? noteData.tags : (current.tags || []),
        content: noteData.content !== undefined ? noteData.content : (current.content || ''),
        checklist: Array.isArray(noteData.checklist) ? noteData.checklist : (current.checklist || []),
        updatedAt: now
      };
      space.notes[existingIdx] = updated;
      writeDB(db);
      return updated;
    } else {
      const newNote = {
        id: noteData.id || `note_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        title: (noteData.title || 'Nouvelle note').trim(),
        emoji: noteData.emoji || '📝',
        folderId: noteData.folderId || space.folders[0]?.id || 'folder_personal',
        type: noteData.type || 'markdown',
        color: noteData.color || 'indigo',
        pinned: Boolean(noteData.pinned),
        archived: Boolean(noteData.archived),
        kanbanStatus: noteData.kanbanStatus || 'todo',
        priority: noteData.priority || 'medium',
        dueDate: noteData.dueDate || null,
        tags: Array.isArray(noteData.tags) ? noteData.tags : [],
        content: noteData.content || '',
        checklist: Array.isArray(noteData.checklist) ? noteData.checklist : [],
        shareToken: null,
        isPublic: false,
        createdAt: now,
        updatedAt: now
      };
      space.notes.unshift(newNote);
      writeDB(db);
      return newNote;
    }
  },

  deleteNote(userId, noteId) {
    const db = readDB();
    const space = ensureUserSpace(db, userId);
    space.notes = space.notes.filter(n => n.id !== noteId);
    writeDB(db);
    return true;
  },

  // === PARTAGE PUBLIC PAR LIEN ===
  toggleShareNote(userId, noteId, enable) {
    const db = readDB();
    const space = ensureUserSpace(db, userId);
    const note = space.notes.find(n => n.id === noteId);
    if (!note) throw new Error('Note introuvable');

    if (enable) {
      if (!note.shareToken) {
        note.shareToken = crypto.randomBytes(12).toString('base64url');
      }
      note.isPublic = true;
    } else {
      note.isPublic = false;
      note.shareToken = null;
    }
    note.updatedAt = new Date().toISOString();
    writeDB(db);
    return note;
  },

  getNoteByShareToken(token) {
    if (!token) return null;
    const db = readDB();
    for (const [uid, space] of Object.entries(db.users || {})) {
      const found = (space.notes || []).find(n => n.isPublic && n.shareToken === token);
      if (found) {
        const folder = (space.folders || []).find(f => f.id === found.folderId);
        return {
          title: found.title,
          emoji: found.emoji,
          color: found.color,
          tags: found.tags,
          content: found.content,
          checklist: found.checklist,
          folderName: folder ? folder.name : 'Notes',
          updatedAt: found.updatedAt,
          createdAt: found.createdAt
        };
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
