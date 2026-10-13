import dotenv from 'dotenv';
dotenv.config();

const LITELLM_BASE_URL = (process.env.LITELLM_BASE_URL || 'https://ai.oussamma.tn/v1').replace(/\/+$/, '');
const LITELLM_API_KEY = process.env.LITELLM_API_KEY || 'sk-oussamma-master-gateway-2026';
const DEFAULT_MODEL = process.env.LITELLM_DEFAULT_MODEL || 'gemini/gemini-3.1-flash-lite-preview';

function cleanJsonString(str) {
  if (!str) return '{}';
  let cleaned = str.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  return cleaned;
}

async function callLiteLLM(messages, options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const jsonMode = options.jsonMode || false;

  const bodyPayload = {
    model: model,
    messages: messages,
    drop_params: true,
  };

  if (jsonMode) {
    bodyPayload.response_format = { type: 'json_object' };
  }

  const response = await fetch(`${LITELLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LITELLM_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(bodyPayload),
    signal: AbortSignal.timeout(45000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Erreur LiteLLM [${response.status}]:`, errorText);
    throw new Error(`Erreur IA (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

export const AIService = {
  // 1. Assistant d'écriture (Résumer, Corriger, Reformuler, Traduire, Continuer...)
  async assistWriting({ action, content, title, targetLang, customPrompt }) {
    const actionInstructions = {
      summarize: `Rédige un résumé exécutif structuré en Markdown (avec points clés à retenir et conclusion) de cette note.`,
      improve: `Corrige l'orthographe, la grammaire et améliore la fluidité, la clarté et la mise en forme Markdown de ce texte sans dénaturer le propos. Retourne directement la version améliorée en Markdown.`,
      rephrase_pro: `Reformule cette note dans un style professionnel, exécutif, clair et structuré en Markdown.`,
      simplify: `Explique et simplifie le contenu de cette note de manière pédagogique et limpide en Markdown.`,
      continue: `Continue et développe la rédaction de cette note de manière pertinente, approfondie et bien structurée en Markdown. Retourne uniquement la suite ou le texte complété.`,
      translate: `Traduis intégralement cette note en ${targetLang || 'Anglais'} en conservant exactement le formatage Markdown, les titres et les listes.`,
      action_plan: `Transforme cette note en un plan d'action opérationnel structuré en Markdown avec des étapes numérotées et une liste de tâches à cocher (- [ ] ...).`,
      custom: customPrompt || `Améliore et structure cette note en Markdown.`
    };

    const instruction = actionInstructions[action] || actionInstructions.improve;

    const systemPrompt = `Tu es "Cortex IA", l'assistant d'écriture expert de NoteVault AI (notes.oussamma.tn).
Tu maîtrises parfaitement le formatage Markdown (titres, listes, gras, blocs de code, citations, checklists \`- [ ]\`).
Réponds directement avec le texte Markdown demandé, sans préambule inutile.`;

    const userPrompt = `Titre de la note : "${title || 'Sans titre'}"

Contenu actuel :
${content || '(Note vide)'}

Instruction : ${instruction}`;

    const result = await callLiteLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]);

    return { result: result.trim(), action };
  },

  // 2. Auto-Organisation : Génération automatique de tags, titre, dossier et extraction de plan d'action / checklist
  async autoOrganizeAndExtractTasks({ title, content, folders }) {
    const folderList = (folders || []).map(f => ({ id: f.id, name: f.name }));

    const systemPrompt = `Tu es l'intelligence d'organisation de NoteVault AI (notes.oussamma.tn).
Analyse la note fournie et génère automatiquement :
1. Un titre clair et percutant (si le titre actuel est générique ou vide, sinon garde ou affine-le).
2. Un emoji représentatif.
3. L'ID du dossier le plus approprié parmi : ${JSON.stringify(folderList)}.
4. Entre 3 et 5 tags pertinents (courts, sans #).
5. Un niveau de priorité ("low", "medium", "high" ou "urgent").
6. Une checklist d'actions concrètes extraites ou déduites de la note (entre 3 et 6 tâches actionnables).
7. Un court résumé en une phrase.

Réponds OBLIGATOIREMENT en JSON strict avec la structure suivante :
{
  "suggestedTitle": "Titre optimisé",
  "emoji": "🚀",
  "suggestedFolderId": "folder_projects",
  "tags": ["Tag1", "Tag2", "Tag3"],
  "priority": "high",
  "summary": "Résumé concis en une phrase",
  "checklist": [
    { "text": "Action concrète 1", "done": false },
    { "text": "Action concrète 2", "done": false }
  ]
}`;

    const raw = await callLiteLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Titre : ${title || ''}\n\nContenu :\n${content || ''}` }
    ], { jsonMode: true });

    const parsed = JSON.parse(cleanJsonString(raw));
    if (Array.isArray(parsed.checklist)) {
      parsed.checklist = parsed.checklist.map((item, idx) => ({
        id: `chk_ai_${Date.now()}_${idx}`,
        text: item.text || String(item),
        done: Boolean(item.done)
      }));
    } else {
      parsed.checklist = [];
    }
    return parsed;
  },

  // 3. Dictée Vocale -> Structuration automatique en note propre
  async structureVoiceTranscript({ transcript, lang = 'fr', folders = [] }) {
    const folderList = folders.map(f => ({ id: f.id, name: f.name }));

    const systemPrompt = `Tu es l'assistant de transcription et structuration vocale de NoteVault AI (notes.oussamma.tn).
L'utilisateur vient de dicter une note à la voix. Le texte brut peut contenir des hésitations, répétitions ou manquer de ponctuation.
Transforme cette dictée vocale brute en une note Markdown parfaitement structurée, claire et professionnelle :
- Corrige les erreurs de reconnaissance vocale tout en gardant 100% des idées et informations.
- Structure avec des sections Markdown claires (ex: Résumé, Points Clés, Détails, Prochaines Étapes).
- Extrais les tâches mentionnées dans une checklist interactive.
- Choisis le meilleur dossier parmi : ${JSON.stringify(folderList)}.

Réponds OBLIGATOIREMENT en JSON strict avec la structure suivante :
{
  "title": "Titre clair de la note dictée",
  "emoji": "🎙️",
  "folderId": "folder_ideas",
  "color": "indigo",
  "priority": "medium",
  "tags": ["Dictée Vocale", "Tag2", "Tag3"],
  "content": "# 🎙️ Titre\\n\\n## Synthèse\\n...\\n\\n## Points Clés\\n- ...",
  "checklist": [
    { "text": "Tâche extraite de la dictée", "done": false }
  ]
}`;

    const raw = await callLiteLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Langue : ${lang}\nTranscription vocale brute :\n"${transcript}"` }
    ], { jsonMode: true });

    const parsed = JSON.parse(cleanJsonString(raw));
    parsed.checklist = (parsed.checklist || []).map((c, i) => ({
      id: `chk_voice_${Date.now()}_${i}`,
      text: c.text || String(c),
      done: false
    }));
    return parsed;
  },

  // 4. Génération d'une note complète par IA à partir d'un sujet / prompt
  async generateNoteFromPrompt({ prompt, folders = [] }) {
    const folderList = folders.map(f => ({ id: f.id, name: f.name }));

    const systemPrompt = `Tu es l'architecte de connaissances de NoteVault AI (notes.oussamma.tn), intégré à l'écosystème oussamma.tn.
Conçois une note complète, riche, structurée en Markdown (avec titres, listes, exemples ou extraits de code si technique, et checklist d'actions) selon la demande de l'utilisateur.
Choisis le dossier pertinent parmi : ${JSON.stringify(folderList)}.

Réponds OBLIGATOIREMENT en JSON strict avec la structure exacte suivante :
{
  "title": "Titre complet de la note",
  "emoji": "✨",
  "folderId": "folder_projects",
  "color": "indigo",
  "priority": "medium",
  "kanbanStatus": "todo",
  "tags": ["Tag1", "Tag2", "Tag3"],
  "content": "# Titre de la note\\n\\nContenu riche en Markdown...",
  "checklist": [
    { "text": "Étape 1 à réaliser", "done": false },
    { "text": "Étape 2 à réaliser", "done": false }
  ]
}`;

    const raw = await callLiteLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Crée une note complète sur : ${prompt}` }
    ], { jsonMode: true });

    const parsed = JSON.parse(cleanJsonString(raw));
    parsed.checklist = (parsed.checklist || []).map((c, i) => ({
      id: `chk_gen_${Date.now()}_${i}`,
      text: c.text || String(c),
      done: false
    }));
    return parsed;
  },

  // 5. Recherche Sémantique Intelligente à travers toutes les notes
  async semanticSearch({ query, allNotes }) {
    const notesCatalog = (allNotes || []).map(n => ({
      id: n.id,
      title: n.title,
      emoji: n.emoji,
      tags: n.tags,
      kanbanStatus: n.kanbanStatus,
      priority: n.priority,
      excerpt: (n.content || '').substring(0, 500),
      checklist: (n.checklist || []).map(c => `${c.done ? '[x]' : '[ ]'} ${c.text}`).join(' | ')
    }));

    const systemPrompt = `Tu es le moteur de recherche sémantique Second Brain de NoteVault AI (notes.oussamma.tn).
Voici l'ensemble des notes de l'utilisateur :
${JSON.stringify(notesCatalog, null, 2)}

L'utilisateur recherche : "${query}"

Identifie les notes qui répondent sémantiquement ou thématiquement à la requête, et fournis également une réponse directe synthétique basée sur ses notes.
Réponds OBLIGATOIREMENT en JSON strict :
{
  "directAnswer": "Synthèse directe répondant à la recherche de l'utilisateur à partir de ses notes",
  "matches": [
    {
      "noteId": "id_de_la_note",
      "matchScore": 95,
      "reason": "Pourquoi cette note correspond précisément à la demande"
    }
  ]
}`;

    try {
      const raw = await callLiteLLM([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query }
      ], { jsonMode: true });
      return JSON.parse(cleanJsonString(raw));
    } catch (err) {
      console.warn('Fallback recherche locale suite à erreur IA:', err.message);
      const q = query.toLowerCase();
      const filtered = (allNotes || []).filter(n =>
        n.title.toLowerCase().includes(q) ||
        (n.content || '').toLowerCase().includes(q) ||
        (n.tags || []).some(t => t.toLowerCase().includes(q))
      );
      return {
        directAnswer: `${filtered.length} note(s) trouvée(s) contenant "${query}".`,
        matches: filtered.map(n => ({
          noteId: n.id,
          matchScore: 85,
          reason: `Correspondance directe avec "${query}".`
        }))
      };
    }
  },

  // 6. Chat avec mes notes ("Cortex IA" - Second Brain RAG)
  async chatWithNotes({ userMessage, history = [], allNotes = [], folders = [], lang = 'fr' }) {
    const folderMap = {};
    folders.forEach(f => { folderMap[f.id] = f.name; });

    const notesKnowledgeBase = allNotes.map(n => ({
      id: n.id,
      title: n.title,
      folder: folderMap[n.folderId] || 'Général',
      status: n.kanbanStatus,
      priority: n.priority,
      tags: n.tags,
      content: (n.content || '').substring(0, 1200),
      checklist: (n.checklist || []).map(c => `${c.done ? '✓' : '☐'} ${c.text}`)
    }));

    const systemPrompt = `Tu es "Cortex IA", l'assistant Second Brain intelligent intégré à NoteVault AI (notes.oussamma.tn) au sein de l'écosystème souverain oussamma.tn.
Tu as accès en temps réel à la base de connaissances (notes, checklists et cartes Kanban) de l'utilisateur :

=== BASE DE NOTES DE L'UTILISATEUR (${allNotes.length} notes) ===
${JSON.stringify(notesKnowledgeBase, null, 2)}
=================================================================

Règles :
1. Lorsque tu réponds à une question portant sur les notes ou projets de l'utilisateur, appuie-toi précisément sur le contenu ci-dessus et cite les notes pertinentes sous la forme \`[[Titre de la note]]\`.
2. Tu peux synthétiser plusieurs notes, lister les tâches restantes à faire (\`☐\`), préparer un compte-rendu, ou aider à rédiger une nouvelle note.
3. Réponds de manière claire, structurée en Markdown et chaleureuse (langue préférée : ${lang}).`;

    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-8).map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text
      })),
      { role: 'user', content: userMessage }
    ];

    return await callLiteLLM(formattedMessages);
  }
};
