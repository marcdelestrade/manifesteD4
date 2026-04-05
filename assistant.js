/* =========================================================================
   assistant.js — Colonne droite, assistant IA contextuel
   Streaming Anthropic + injection de contexte + mémorisation de décisions.
   ========================================================================= */

import { state, saveDataFile, activeSection, uid, now } from "./store.js?v=1775398372";
import { streamMessage } from "./anthropic.js?v=1775398372";
import { toast, promptDialog } from "./ui.js?v=1775398372";

const SUGGESTIONS = [
  "Challenge ce contenu",
  "Quelles décisions ont été prises ici ?",
  "Qu'est-ce qui manque ?",
  "Génère une FAQ à partir de ça",
  "Est-ce aligné avec l'ambition D4 ?",
];

let el = {};
let isStreaming = false;

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
  el.clear.addEventListener("click", () => {
    state.aiMessages = [];
    renderMessages();
  });
}

export function onSectionChanged() {
  // Reset conversation à chaque changement de section — contexte neuf.
  state.aiMessages = [];
  renderMessages();
  renderSuggestions();
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

function renderMessages() {
  el.messages.innerHTML = "";
  if (state.aiMessages.length === 0) {
    const intro = document.createElement("div");
    intro.className = "ai-intro";
    const section = activeSection();
    intro.textContent = section
      ? `Assistant contextuel — connecté à « ${section.titre} »`
      : "Sélectionne une section pour démarrer";
    el.messages.appendChild(intro);
    return;
  }
  for (let i = 0; i < state.aiMessages.length; i++) {
    const m = state.aiMessages[i];
    el.messages.appendChild(renderMessage(m, i));
  }
  el.messages.scrollTop = el.messages.scrollHeight;
}

function renderMessage(m, idx) {
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
  state.aiMessages.push({ role: "user", content: text });
  const assistantMsg = { role: "assistant", content: "", streaming: true };
  state.aiMessages.push(assistantMsg);
  renderMessages();

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
        // Re-render live seulement la dernière bulle pour éviter flicker
        updateLastBubble(full);
      },
    });
    assistantMsg.streaming = false;
    renderMessages();
  } catch (err) {
    assistantMsg.content = `Erreur : ${err.message}`;
    assistantMsg.streaming = false;
    renderMessages();
  } finally {
    isStreaming = false;
    el.send.disabled = false;
  }
}

function updateLastBubble(text) {
  const bubbles = el.messages.querySelectorAll(".ai-msg-assistant .ai-bubble");
  const last = bubbles[bubbles.length - 1];
  if (last) {
    last.innerHTML = window.marked.parse(text, { breaks: true });
    el.messages.scrollTop = el.messages.scrollHeight;
  }
}

function buildSystemPrompt() {
  const section = activeSection();
  const m = state.memoire.data;

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
${m.contexte_general}

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
