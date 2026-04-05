/* =========================================================================
   assistant.js — Colonne droite, assistant IA contextuel
   Streaming Anthropic + injection de contexte + mémorisation de décisions.
   ========================================================================= */

import { state, saveDataFile, activeSection, uid, now } from "./store.js?v=1775399826";
import { streamMessage } from "./anthropic.js?v=1775399826";
import { toast, promptDialog } from "./ui.js?v=1775399826";

const MAX_MESSAGES = 20; // 10 échanges max par section (cap des coûts tokens)
const PERSIST_DEBOUNCE_MS = 3000;

const SUGGESTIONS = [
  "Challenge ce contenu",
  "Quelles tâches devrais-je programmer sur cette partie ?",
  "Qu'est-ce qui manque ?",
  "Génère une FAQ à partir de ça",
];

let el = {};
let isStreaming = false;
let rafPending = null;
let persistTimer = null;

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

function renderSuggestions() {
  el.suggestions.innerHTML = "";
  for (const text of SUGGESTIONS) {
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

  // Bouton "Mémoriser cette décision" sur les réponses de l'IA
  if (m.role === "assistant" && !m.streaming) {
    const actions = document.createElement("div");
    actions.className = "ai-msg-actions";
    const btn = document.createElement("button");
    btn.className = "ai-action-btn";
    btn.textContent = "💾 Mémoriser cette décision";
    btn.addEventListener("click", () => memoriser(m.content));
    actions.appendChild(btn);
    wrap.appendChild(actions);
  }
  return wrap;
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
  } catch (err) {
    assistantMsg.content = `Erreur : ${err.message}`;
    assistantMsg.streaming = false;
    replaceLastMessage(assistantMsg);
  } finally {
    isStreaming = false;
    el.send.disabled = false;
    trimAndSchedulePersist();
    renderPersistenceHeader();
  }
}

/** Tronque à MAX_MESSAGES + planifie la sauvegarde GitHub (debounce). */
function trimAndSchedulePersist() {
  if (state.aiMessages.length > MAX_MESSAGES) {
    state.aiMessages = state.aiMessages.slice(-MAX_MESSAGES);
  }
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persistConversation, PERSIST_DEBOUNCE_MS);
}

async function persistConversation() {
  persistTimer = null;
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
  // Purger aussi côté GitHub
  if (persistTimer) clearTimeout(persistTimer);
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

  return `Tu es l'assistant stratégique de Marc Delestrade, fondateur de D4 Immobilier.

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

PROJETS LIÉS :
${projetsSection}

Tu dois challenger, conseiller, reformuler. Sois direct, précis, sans complaisance. Propose des alternatives concrètes. Si une idée est mauvaise, dis-le et explique pourquoi. Réponses courtes et structurées en markdown.`;
}
