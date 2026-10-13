export const DEFAULT_FOLDERS = [
  { id: 'folder_cloud', name: 'Architecture & Cloud', icon: '☁️', color: '#6366f1' },
  { id: 'folder_projects', name: 'Projets oussamma.tn', icon: '🚀', color: '#10b981' },
  { id: 'folder_ideas', name: 'Idées & Second Brain', icon: '🧠', color: '#f59e0b' },
  { id: 'folder_meetings', name: 'Réunions & Sprints', icon: '📋', color: '#ec4899' },
  { id: 'folder_personal', name: 'Personnel & Quotidien', icon: '🌟', color: '#06b6d4' }
];

export const DEFAULT_NOTES = [
  {
    id: 'note_ecosystem_arch',
    title: 'Architecture Souveraine oussamma.tn',
    emoji: '🏛️',
    folderId: 'folder_cloud',
    type: 'markdown',
    color: 'indigo',
    pinned: true,
    archived: false,
    kanbanStatus: 'done',
    priority: 'high',
    dueDate: '2026-10-20',
    tags: ['Architecture', 'SSO', 'Coolify', 'LiteLLM', 'Cloud'],
    content: `# 🏛️ Architecture de l'Écosystème Souverain oussamma.tn

Bienvenue dans **NoteVault AI** (\`notes.oussamma.tn\`), votre Second Brain hybride combinant **Éditeur Markdown**, **Cartes Rapides (Keep)** et **Tableaux Kanban**, propulsé par la passerelle IA **LiteLLM** (\`ai.oussamma.tn\`).

## 🔗 Briques Fondamentales
L'écosystème repose sur une architecture modulaire auto-hébergée et interconnectée :

1. **SSO AuthCore** (\`sso-a.oussamma.tn\`) : Fournisseur d'identité OAuth 2.0 / OpenID Connect avec PKCE S256 et rotation de clés RS256.
2. **Coolify Engine** (\`coolify.oussamma.tn\`) : Orchestration Docker, CI/CD GitHub et reverse-proxy Traefik avec SSL Let's Encrypt.
3. **Passerelle IA Universelle** (\`ai.oussamma.tn\`) : Proxy LiteLLM unifié donnant accès aux modèles Gemini, GPT et Claude.
4. **Portail Central** (\`oussamma.tn\`) : Hub d'applications RBAC et vitrine professionnelle.
5. **Applications Métiers** :
   - \`drive.oussamma.tn\` : Stockage Cloud & transfert chiffré
   - \`devspace.oussamma.tn\` : Environnement de développement
   - \`recettes.oussamma.tn\` : Planificateur culinaire & courses IA
   - \`notes.oussamma.tn\` : Prise de notes hybride & Second Brain IA

## 📌 Liens Internes (WikiLinks)
Vous pouvez relier vos notes entre elles avec la syntaxe \`[[Titre de la note]]\` :
- Voir [[Roadmap Q4 — Nouvelles Fonctionnalités]]
- Voir [[Commandes Docker & Coolify Utiles]]

## ✅ Checklist de Vérification
- [x] Authentification OIDC avec PKCE S256 opérationnelle
- [x] Intégration de l'assistant IA d'écriture et de synthèse
- [x] Recherche sémantique et Chat Cortex IA sur toutes les notes
- [x] Partage public de notes par lien sécurisé`,
    checklist: [
      { id: 'chk_1', text: 'Authentification OIDC avec PKCE S256 opérationnelle', done: true },
      { id: 'chk_2', text: 'Intégration de l\'assistant IA d\'écriture et de synthèse', done: true },
      { id: 'chk_3', text: 'Recherche sémantique et Chat Cortex IA sur toutes les notes', done: true },
      { id: 'chk_4', text: 'Partage public de notes par lien sécurisé', done: true }
    ],
    shareToken: null,
    isPublic: false,
    createdAt: '2026-10-12T10:00:00.000Z',
    updatedAt: '2026-10-13T01:30:00.000Z'
  },
  {
    id: 'note_roadmap_q4',
    title: 'Roadmap Q4 — Nouvelles Fonctionnalités',
    emoji: '🚀',
    folderId: 'folder_projects',
    type: 'checklist',
    color: 'emerald',
    pinned: true,
    archived: false,
    kanbanStatus: 'in_progress',
    priority: 'urgent',
    dueDate: '2026-10-25',
    tags: ['Roadmap', 'Produit', 'Sprint', 'IA'],
    content: `# 🚀 Roadmap Q4 — Écosystème oussamma.tn

Objectifs prioritaires pour l'évolution des services cloud personnels et des agents IA connectés à [[Architecture Souveraine oussamma.tn]].

## Priorités de la semaine
- [x] Déployer la passerelle LiteLLM sur \`ai.oussamma.tn\`
- [x] Lancer \`recettes.oussamma.tn\` avec calcul de courses intelligent
- [x] Lancer \`notes.oussamma.tn\` (NoteVault AI) avec Markdown + Keep + Kanban
- [ ] Connecter les webhooks de notification Telegram / Bot sur \`bot.oussamma.tn\`
- [ ] Automatiser les sauvegardes chiffrées quotidiennes vers ByteVault Drive`,
    checklist: [
      { id: 'chk_r1', text: 'Déployer la passerelle LiteLLM sur ai.oussamma.tn', done: true },
      { id: 'chk_r2', text: 'Lancer recettes.oussamma.tn avec calcul de courses intelligent', done: true },
      { id: 'chk_r3', text: 'Lancer notes.oussamma.tn (NoteVault AI) avec Markdown + Keep + Kanban', done: true },
      { id: 'chk_r4', text: 'Connecter les webhooks de notification sur bot.oussamma.tn', done: false },
      { id: 'chk_r5', text: 'Automatiser les sauvegardes chiffrées vers ByteVault Drive', done: false }
    ],
    shareToken: null,
    isPublic: false,
    createdAt: '2026-10-12T14:20:00.000Z',
    updatedAt: '2026-10-13T01:45:00.000Z'
  },
  {
    id: 'note_devops_snippets',
    title: 'Commandes Docker & Coolify Utiles',
    emoji: '🐳',
    folderId: 'folder_cloud',
    type: 'markdown',
    color: 'cyan',
    pinned: false,
    archived: false,
    kanbanStatus: 'review',
    priority: 'medium',
    dueDate: '2026-10-30',
    tags: ['Docker', 'DevOps', 'Coolify', 'Snippets'],
    content: `# 🐳 Aide-mémoire Docker, Traefik & Coolify

Référence rapide liée à [[Architecture Souveraine oussamma.tn]] pour le diagnostic et la maintenance des conteneurs en production.

## 1. Inspection rapide des conteneurs actifs
\`\`\`bash
docker ps --format "table {{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}"
\`\`\`

## 2. Vérifier les logs d'un service Coolify
\`\`\`bash
docker logs -f --tail 100 <container_name>
\`\`\`

## 3. Tester la sonde de santé (Healthcheck)
\`\`\`bash
wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health
\`\`\`

> **Astuce IA** : Sélectionnez ce texte ou cliquez sur le bouton **✨ Assistant IA** dans la barre d'outils pour générer automatiquement de nouveaux scripts ou traduire cette documentation !`,
    checklist: [],
    shareToken: null,
    isPublic: false,
    createdAt: '2026-10-12T16:00:00.000Z',
    updatedAt: '2026-10-13T01:15:00.000Z'
  },
  {
    id: 'note_ai_ideas',
    title: 'Idées d’Agents & Workflows IA Autonomes',
    emoji: '🤖',
    folderId: 'folder_ideas',
    type: 'markdown',
    color: 'amber',
    pinned: true,
    archived: false,
    kanbanStatus: 'todo',
    priority: 'high',
    dueDate: '2026-11-05',
    tags: ['IA', 'Agents', 'Brainstorming', 'RAG'],
    content: `# 🤖 Idées d'Agents & Workflows IA Autonomes

Brainstorming sur les prochaines intégrations autour de \`ai.oussamma.tn\` :

- **Agent Veille Technologique** : Résume chaque matin les nouveautés Cloud, DevOps & IA et crée automatiquement une note dans le dossier *Idées & Second Brain*.
- **Pont Notes ↔ Recettes** : Transformer une note libre d'idées de repas en menu structuré.
- **Dictée Vocale en Déplacement** : Utiliser le bouton **🎙️ Dictée Vocale IA** pour capturer des idées à la volée et laisser l'IA les structurer en plan d'action propre.`,
    checklist: [
      { id: 'chk_ai1', text: 'Tester la dictée vocale avec structuration automatique IA', done: false },
      { id: 'chk_ai2', text: 'Extraire un plan d\'action Kanban depuis une note de réunion', done: false },
      { id: 'chk_ai3', text: 'Interroger Cortex IA sur l\'ensemble de ma base de connaissances', done: false }
    ],
    shareToken: null,
    isPublic: false,
    createdAt: '2026-10-12T19:00:00.000Z',
    updatedAt: '2026-10-13T01:50:00.000Z'
  },
  {
    id: 'note_meeting_template',
    title: 'Brief Réunion Architecture & Sécurité OIDC',
    emoji: '🔐',
    folderId: 'folder_meetings',
    type: 'markdown',
    color: 'rose',
    pinned: false,
    archived: false,
    kanbanStatus: 'in_progress',
    priority: 'medium',
    dueDate: '2026-10-18',
    tags: ['Sécurité', 'OIDC', 'Réunion', 'PKCE'],
    content: `# 🔐 Brief Réunion Architecture & Sécurité OIDC

## Contexte
Revue des politiques d'accès et des jetons OAuth2 sur \`sso-a.oussamma.tn\` (voir [[Architecture Souveraine oussamma.tn]]).

## Points Clés Décidés
- Utilisation systématique de **PKCE (S256)** sur tous les sous-domaines.
- Sessions cookies \`HttpOnly\`, \`SameSite=Lax\` et signature HMAC SHA-256.
- Possibilité de partager une note spécifique via un **lien public révocable** sans exposer le reste du coffre de notes.

## Actions à suivre
- [x] Configurer le client OIDC \`client_notes_app\`
- [ ] Vérifier les scopes \`openid profile email\`
- [ ] Tester le partage public en lecture seule`,
    checklist: [
      { id: 'chk_m1', text: 'Configurer le client OIDC client_notes_app', done: true },
      { id: 'chk_m2', text: 'Vérifier les scopes openid profile email', done: false },
      { id: 'chk_m3', text: 'Tester le partage public en lecture seule', done: false }
    ],
    shareToken: null,
    isPublic: false,
    createdAt: '2026-10-12T21:00:00.000Z',
    updatedAt: '2026-10-13T01:55:00.000Z'
  }
];
