/* =========================================================================
   assistant.js — Colonne droite, assistant IA contextuel
   Streaming Anthropic + injection de contexte + mémorisation de décisions.
   ========================================================================= */

import { state, saveDataFile, activeSection, uid, now } from "./store.js?v=1775497852";
import { streamMessage } from "./anthropic.js?v=1775497852";
import { toast, promptDialog, confirmDialog } from "./ui.js?v=1775497852";

const MAX_MESSAGES = 20; // 10 échanges max par section (cap des coûts tokens)

const SUGGESTIONS_MANIFESTE = [
  "Challenge ce contenu",
  "Quelles tâches devrais-je programmer sur cette partie ?",
  "Qu'est-ce qui manque ?",
  "Génère une FAQ à partir de ça",
];

const SUGGESTIONS_ACTIONS = [
  "Qu'est-ce qui bloque ?",
  "Décompose cette tâche en sous-étapes",
  "Priorise les tâches de cette section",
  "Comment avancer concrètement ?",
];

let el = {};
let isStreaming = false;
let rafPending = null;

export function initAssistant() {
  el = {
    messages: document.querySelector("#ai-messages"),
    suggestions: document.querySelector("#ai-suggestions"),
    input: document.querySelector("#ai-input"),
    send: document.querySelector("#ai-send"),
    clear: document.querySelector("#btn-ai-clear"),
  };

  renderSuggestions();
  renderMessages();

  el.send.addEventListener("click", onSend);
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSend();
    }
  });
  el.clear.addEventListener("click", clearConversation);
}

export function onSectionChanged() {
  // Charger la conversation persistée pour la section active (si elle existe)
  const sectionId = state.activeSectionId;
  const bySection = state.conversations?.data?.bySection || {};
  const saved = sectionId ? bySection[sectionId] : null;
  state.aiMessages = saved?.messages ? [...saved.messages] : [];
  renderMessages();
  renderSuggestions();
  renderPersistenceHeader();
}

function getSuggestions() {
  const mode = document.querySelector("#app")?.dataset.mode;
  return mode === "actions" ? SUGGESTIONS_ACTIONS : SUGGESTIONS_MANIFESTE;
}

function renderSuggestions() {
  el.suggestions.innerHTML = "";
  for (const text of getSuggestions()) {
    const chip = document.createElement("button");
    chip.className = "ai-chip";
    chip.textContent = text;
    chip.addEventListener("click", () => {
      el.input.value = text;
      onSend();
    });
    el.suggestions.appendChild(chip);
  }
}

function renderIntro() {
  const intro = document.createElement("div");
  intro.className = "ai-intro";
  const section = activeSection();
  intro.textContent = section
    ? `Assistant contextuel — connecté à « ${section.titre} »`
    : "Sélectionne une section pour démarrer";
  return intro;
}

/** Affiche un indicateur en haut de la zone messages si des échanges sont persistés. */
function renderPersistenceHeader() {
  const count = state.aiMessages.length;
  const existing = el.messages.querySelector(".ai-persist-header");
  if (count === 0) {
    existing?.remove();
    return;
  }
  const exchanges = Math.ceil(count / 2);
  if (existing) {
    existing.querySelector(".ai-persist-count").textContent =
      `${exchanges} échange${exchanges > 1 ? "s" : ""} persisté${exchanges > 1 ? "s" : ""}`;
    return;
  }
  const header = document.createElement("div");
  header.className = "ai-persist-header";
  header.innerHTML = `<span class="ai-persist-count">${exchanges} échange${exchanges > 1 ? "s" : ""} persisté${exchanges > 1 ? "s" : ""}</span>`;
  el.messages.prepend(header);
}

function renderMessages() {
  el.messages.innerHTML = "";
  if (state.aiMessages.length === 0) {
    el.messages.appendChild(renderIntro());
    return;
  }
  renderPersistenceHeader();
  for (const m of state.aiMessages) {
    el.messages.appendChild(renderMessage(m));
  }
  el.messages.scrollTop = el.messages.scrollHeight;
}

/** Ajoute un nouveau message sans rebuild de la liste entière. */
function appendMessage(m) {
  // Retirer l'intro s'il existe
  el.messages.querySelector(".ai-intro")?.remove();
  el.messages.appendChild(renderMessage(m));
  el.messages.scrollTop = el.messages.scrollHeight;
}

/** Remplace la dernière bulle par un nouveau rendu final (bouton mémoriser inclus). */
function replaceLastMessage(m) {
  const all = el.messages.querySelectorAll(".ai-msg");
  const last = all[all.length - 1];
  if (last) last.replaceWith(renderMessage(m));
  el.messages.scrollTop = el.messages.scrollHeight;
}

function renderMessage(m) {
  const wrap = document.createElement("div");
  wrap.className = `ai-msg ai-msg-${m.role}`;

  const bubble = document.createElement("div");
  bubble.className = "ai-bubble";
  if (m.role === "assistant") {
    bubble.innerHTML = window.marked.parse(m.content || "", { breaks: true });
  } else {
    bubble.textContent = m.content;
  }
  wrap.appendChild(bubble);

  // Boutons d'action sur les réponses de l'IA
  if (m.role === "assistant" && !m.streaming) {
    const actions = document.createElement("div");
    actions.className = "ai-msg-actions";

    const btnMem = document.createElement("button");
    btnMem.className = "ai-action-btn";
    btnMem.textContent = "💾 Mémoriser la décision";
    btnMem.addEventListener("click", () => memoriser(m.content));
    actions.appendChild(btnMem);

    const btnTasks = document.createElement("button");
    btnTasks.className = "ai-action-btn";
    btnTasks.textContent = "📋 Créer les tâches";
    btnTasks.addEventListener("click", () => extractAndProposeTasks(m.content));
    actions.appendChild(btnTasks);

    wrap.appendChild(actions);
  }
  return wrap;
}

// =========================================================================
// EXTRACTION DE TÂCHES DEPUIS UNE RÉPONSE IA
// =========================================================================
async function extractAndProposeTasks(assistantText) {
  const section = activeSection();
  if (!section) return;
  if (!state.cfg.anthropicKey) {
    toast("Clé API Anthropic manquante.", "warn");
    return;
  }

  const dismissLoading = toast("Extraction des tâches…", "info", 0);
  let proposals;
  try {
    proposals = await extractTasks(assistantText);
  } catch (err) {
    dismissLoading();
    toast(err.message, "error");
    return;
  }
  dismissLoading();
  if (!proposals.length) {
    toast("Aucune tâche actionnable détectée", "warn");
    return;
  }

  // Modale de sélection avec cases à cocher
  const listEl = document.createElement("div");
  listEl.className = "task-proposal-list";
  const checkboxes = [];
  proposals.forEach((p, i) => {
    const row = document.createElement("label");
    row.className = "task-proposal-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.dataset.idx = i;
    const info = document.createElement("div");
    info.className = "task-proposal-info";
    const label = document.createElement("div");
    label.className = "task-proposal-label";
    label.textContent = p.label;
    info.appendChild(label);
    if (p.description) {
      const desc = document.createElement("div");
      desc.className = "task-proposal-desc";
      desc.textContent = p.description;
      info.appendChild(desc);
    }
    const prio = document.createElement("span");
    prio.className = `prio-chip prio-${p.priorite || "normale"}`;
    prio.textContent = p.priorite || "normale";
    row.appendChild(cb);
    row.appendChild(info);
    row.appendChild(prio);
    listEl.appendChild(row);
    checkboxes.push(cb);
  });

  const ok = await confirmDialog(listEl, {
    title: `${proposals.length} tâche${proposals.length > 1 ? "s" : ""} détectée${proposals.length > 1 ? "s" : ""}`,
    okLabel: "Ajouter les sélectionnées",
  });
  if (!ok) return;

  const selected = checkboxes
    .filter((cb) => cb.checked)
    .map((cb) => proposals[parseInt(cb.dataset.idx, 10)]);
  if (selected.length === 0) return;

  for (const p of selected) {
    state.taches.data.taches.push({
      id: uid("t"),
      section_id: section.id,
      label: p.label,
      description: p.description || "",
      statut: "a_faire",
      priorite: p.priorite || "normale",
      archive: false,
      created_at: now(),
      updated_at: now(),
    });
  }

  try {
    await saveDataFile("taches", `Add ${selected.length} tasks (IA) for ${section.id}`);
    toast(
      `${selected.length} tâche${selected.length > 1 ? "s" : ""} ajoutée${selected.length > 1 ? "s" : ""} ✓`,
      "success"
    );
    document.dispatchEvent(new CustomEvent("taches-changed"));
  } catch (err) {
    toast(err.message, "error");
  }
}

async function extractTasks(assistantText) {
  const prompt = `Analyse le texte ci-dessous et extrais-en les tâches actionnables concrètes. Renvoie UNIQUEMENT un tableau JSON strict, sans texte avant ni après, sans balises markdown.

Format attendu :
[
  {"label": "verbe à l'infinitif + objet court (max 80 chars)", "priorite": "haute|normale|basse", "description": "détail optionnel"}
]

Règles :
- "label" : court, actionnable, commence par un verbe ("Définir…", "Créer…", "Valider…")
- "priorite" : "haute" si urgence explicite dans le texte, sinon "normale"
- "description" : uniquement si elle apporte du contexte utile au-delà du label
- Ignore les réflexions, challenges, questions. Garde uniquement les actions concrètes à faire
- Si aucune tâche claire : renvoie []

Texte à analyser :
---
${assistantText}
---

JSON :`;

  const full = await streamMessage({
    apiKey: state.cfg.anthropicKey,
    system: "Tu es un extracteur de tâches. Tu renvoies uniquement du JSON valide, rien d'autre.",
    messages: [{ role: "user", content: prompt }],
    maxTokens: 1024,
    onDelta: () => {},
  });

  // Extraire le tableau JSON de la réponse
  const match = full.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]);
    return Array.isArray(arr) ? arr.filter((t) => t && t.label) : [];
  } catch {
    return [];
  }
}

async function memoriser(texte) {
  const section = activeSection();
  if (!section) return;
  const decision = await promptDialog("Formule la décision à mémoriser :", {
    title: "Mémoriser une décision",
    defaultValue: texte.slice(0, 280),
    multiline: true,
    okLabel: "Mémoriser",
  });
  if (!decision) return;

  if (!state.memoire.data) state.memoire.data = { decisions: [] };
  state.memoire.data.decisions = state.memoire.data.decisions || [];
  state.memoire.data.decisions.push({
    id: uid("d"),
    section_id: section.id,
    decision,
    date: now().slice(0, 10),
  });
  state.memoire.data.updated_at = now();

  try {
    await saveDataFile("memoire", `Memo decision pour ${section.id}`);
    toast("Décision mémorisée ✓", "success");
  } catch (err) {
    toast(err.message, "error");
  }
}

// =========================================================================
// ENVOI MESSAGE
// =========================================================================
async function onSend() {
  if (isStreaming) return;
  const text = el.input.value.trim();
  if (!text) return;
  if (!state.cfg.anthropicKey) {
    toast("Clé API Anthropic manquante. Configure-la via ⚙.", "warn");
    return;
  }

  el.input.value = "";
  const userMsg = { role: "user", content: text };
  state.aiMessages.push(userMsg);
  appendMessage(userMsg);
  const assistantMsg = { role: "assistant", content: "", streaming: true };
  state.aiMessages.push(assistantMsg);
  appendMessage(assistantMsg);

  isStreaming = true;
  el.send.disabled = true;

  const systemPrompt = buildSystemPrompt();
  // Historique pour l'API : tous les messages non-streaming (donc sans le placeholder vide).
  const cleanMessages = state.aiMessages
    .filter((m) => !m.streaming)
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    await streamMessage({
      apiKey: state.cfg.anthropicKey,
      system: systemPrompt,
      messages: cleanMessages,
      maxTokens: 2048,
      onDelta: (_delta, full) => {
        assistantMsg.content = full;
        scheduleBubbleUpdate(full);
      },
    });
    assistantMsg.streaming = false;
    replaceLastMessage(assistantMsg);
    trimAndPersist(); // sauvegarde immédiate côté GitHub
  } catch (err) {
    assistantMsg.content = `Erreur : ${err.message}`;
    assistantMsg.streaming = false;
    replaceLastMessage(assistantMsg);
    // Ne pas persister une conversation qui s'est terminée en erreur
    state.aiMessages = state.aiMessages.filter((m) => m !== assistantMsg);
  } finally {
    isStreaming = false;
    el.send.disabled = false;
    renderPersistenceHeader();
  }
}

/** Tronque à MAX_MESSAGES + sauvegarde immédiate sur GitHub. */
function trimAndPersist() {
  if (state.aiMessages.length > MAX_MESSAGES) {
    state.aiMessages = state.aiMessages.slice(-MAX_MESSAGES);
  }
  persistConversation();
}

async function persistConversation() {
  const sectionId = state.activeSectionId;
  if (!sectionId || !state.conversations) return;
  const data = state.conversations.data;
  data.bySection = data.bySection || {};
  // Ne persister que les messages finalisés (streaming: false)
  const messages = state.aiMessages
    .filter((m) => !m.streaming)
    .map((m) => ({ role: m.role, content: m.content }));
  if (messages.length === 0) {
    delete data.bySection[sectionId];
  } else {
    data.bySection[sectionId] = { messages, updated_at: now() };
  }
  try {
    await saveDataFile("conversations", `Conversation ${sectionId}`);
  } catch (err) {
    console.error("Persist conversation failed:", err);
  }
}

async function clearConversation() {
  state.aiMessages = [];
  renderMessages();
  const sectionId = state.activeSectionId;
  if (!sectionId || !state.conversations) return;
  const data = state.conversations.data;
  if (data.bySection?.[sectionId]) {
    delete data.bySection[sectionId];
    try {
      await saveDataFile("conversations", `Clear conversation ${sectionId}`);
    } catch (err) {
      console.error(err);
    }
  }
}

/** Met à jour la dernière bulle, coalescée en RAF (cap ~60Hz). */
function scheduleBubbleUpdate(text) {
  if (rafPending !== null) return;
  rafPending = requestAnimationFrame(() => {
    rafPending = null;
    const bubbles = el.messages.querySelectorAll(".ai-msg-assistant .ai-bubble");
    const last = bubbles[bubbles.length - 1];
    if (last) {
      last.innerHTML = window.marked.parse(text, { breaks: true });
      el.messages.scrollTop = el.messages.scrollHeight;
    }
  });
}

/**
 * Construit le prompt système sous forme de content block avec cache_control.
 * Anthropic facture les tokens cachés à 10% du prix normal lors des ré-utilisations.
 * Nécessite ≥1024 tokens pour activer le cache (sinon l'API l'ignore silencieusement).
 */
function buildSystemPrompt() {
  const section = activeSection();
  const m = state.memoire?.data || {};

  const decisionsSection = (m.decisions || [])
    .filter((d) => d.section_id === section?.id)
    .map((d) => `- (${d.date}) ${d.decision}`)
    .join("\n") || "(aucune)";

  const tachesSection = (state.taches.data.taches || [])
    .filter((t) => t.section_id === section?.id && !t.archive)
    .map((t) => `- [${t.statut}] ${t.label}`)
    .join("\n") || "(aucune)";

  const projetsSection = (state.projets.data.projets || [])
    .filter((p) => p.section_id === section?.id && !p.archive)
    .map((p) => `- [${p.statut}] ${p.nom} : ${p.description || ""}`)
    .join("\n") || "(aucun)";

  const text = `Tu es l'assistant stratégique de Marc Delestrade, fondateur de D4 Immobilier.

CONTEXTE D4 :
${m.contexte_general || "(contexte non renseigné)"}

PRINCIPES DE TRAVAIL AVEC MARC :
${(m.principes_travail || []).map((p) => `- ${p}`).join("\n")}

CHANTIERS OUVERTS :
${(m.chantiers_ouverts || []).map((c) => `- ${c}`).join("\n")}

SECTION EN COURS DE TRAVAIL : « ${section?.titre || "(aucune)"} »
---
${section?.contenu || ""}
---

DÉCISIONS DÉJÀ PRISES SUR CETTE SECTION :
${decisionsSection}

TÂCHES LIÉES :
${tachesSection}
${activeTaskBlock()}
Tu dois challenger, conseiller, reformuler. Sois direct, précis, sans complaisance. Propose des alternatives concrètes. Si une idée est mauvaise, dis-le et explique pourquoi. Réponses courtes et structurées en markdown.`;

  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

function activeTaskBlock() {
  if (!state.activeTaskId) return "";
  const t = state.taches?.data?.taches?.find((x) => x.id === state.activeTaskId);
  if (!t) return "";
  return `
TÂCHE ACTIVE EN COURS DE TRAVAIL :
- Label : ${t.label}
- Statut : ${t.statut}
- Priorité : ${t.priorite}
- Description : ${t.description || "(vide)"}
`;
}
