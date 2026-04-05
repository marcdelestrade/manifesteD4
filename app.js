/* =========================================================================
   app.js — Orchestration D4 Manifeste
   ========================================================================= */

import * as gh from "./github.js";
import { createEditor } from "./editor.js";
import {
  state,
  setStatusHandler,
  emitStatus,
  saveDataFile,
  activeSection,
  now,
} from "./store.js";
import { initTaches, renderTaches } from "./taches.js";
import { initProjets, renderProjets } from "./projets.js";
import { initAssistant, onSectionChanged as onAssistantSection } from "./assistant.js";
import { initGenerer } from "./generer.js";

const CFG_KEY = "d4_manifeste_cfg_v1";

// ---- DOM refs
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const el = {
  configScreen: $("#config-screen"),
  app: $("#app"),
  configForm: $("#config-form"),
  cfgStatus: $("#cfg-status"),
  cfgSubmit: $("#cfg-submit"),
  tocList: $("#toc-list"),
  tocSearch: $("#toc-search"),
  saveIndicator: $("#save-indicator"),
  activeSectionTitle: $("#active-section-title"),
  editorTextarea: $("#editor-textarea"),
  editorPreview: $("#editor-preview"),
  editorToolbar: $(".editor-toolbar"),
  btnSettings: $("#btn-settings"),
  btnPreviewOnly: $("#btn-preview-only"),
  editorSplit: $("#editor-split"),
  countTaches: $("#count-taches"),
  countProjets: $("#count-projets"),
};

// Local state (non-shared)
let localState = {
  tocFilter: "all",
  tocSearch: "",
  editor: null,
  saveTimer: null,
};

// =========================================================================
// BOOT
// =========================================================================
function boot() {
  setStatusHandler(setSaveStatus);
  const raw = localStorage.getItem(CFG_KEY);
  if (!raw) return showConfig();
  try {
    state.cfg = JSON.parse(raw);
  } catch {
    return showConfig();
  }
  if (!state.cfg.token || !state.cfg.owner || !state.cfg.repo) return showConfig();
  startApp();
}

// =========================================================================
// CONFIG SCREEN
// =========================================================================
function showConfig() {
  el.configScreen.classList.remove("hidden");
  el.app.classList.add("hidden");
  if (state.cfg) {
    $("#cfg-owner").value = state.cfg.owner || "";
    $("#cfg-repo").value = state.cfg.repo || "";
    $("#cfg-token").value = state.cfg.token || "";
    $("#cfg-anthropic").value = state.cfg.anthropicKey || "";
  }
}

el.configForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  el.cfgSubmit.disabled = true;
  el.cfgStatus.className = "config-status";
  el.cfgStatus.textContent = "Test de la connexion GitHub…";

  const cfg = {
    owner: $("#cfg-owner").value.trim(),
    repo: $("#cfg-repo").value.trim(),
    token: $("#cfg-token").value.trim(),
    anthropicKey: $("#cfg-anthropic").value.trim(),
  };

  try {
    await gh.testConnection(cfg);
  } catch (err) {
    el.cfgStatus.className = "config-status error";
    el.cfgStatus.textContent = `Échec : ${err.message}`;
    el.cfgSubmit.disabled = false;
    return;
  }

  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  state.cfg = cfg;
  el.cfgStatus.className = "config-status ok";
  el.cfgStatus.textContent = "Connexion OK. Chargement…";
  setTimeout(() => {
    el.configScreen.classList.add("hidden");
    // Re-démarrer (si l'app tournait déjà, les features sont déjà initialisées)
    if (state.manifeste) {
      el.app.classList.remove("hidden");
    } else {
      startApp();
    }
    el.cfgSubmit.disabled = false;
  }, 400);
});

// =========================================================================
// APP MAIN
// =========================================================================
async function startApp() {
  el.app.classList.remove("hidden");
  setSaveStatus("loading", "Chargement…");

  try {
    const data = await gh.loadAllData(state.cfg);
    state.manifeste = data.manifeste;
    state.taches = data.taches;
    state.projets = data.projets;
    state.memoire = data.memoire;
  } catch (err) {
    setSaveStatus("error", "Erreur chargement");
    alert(`Impossible de charger les données : ${err.message}`);
    return;
  }

  initEditor();
  initTaches((count) => {
    el.countTaches.textContent = count;
  });
  initProjets((count) => {
    el.countProjets.textContent = count;
  });
  initAssistant();
  initGenerer();
  renderTOC();

  // Sélection auto : première section non archivée (H1 de préférence)
  const sections = state.manifeste.data.sections.filter((s) => !s.archive);
  const first = sections.find((s) => s.niveau === 1) || sections[0];
  if (first) selectSection(first.id);

  setSaveStatus("idle", "Prêt");
  bindUI();
}

// =========================================================================
// EDITOR
// =========================================================================
function initEditor() {
  localState.editor = createEditor({
    textarea: el.editorTextarea,
    preview: el.editorPreview,
    toolbar: el.editorToolbar,
    onChange: onEditorChange,
  });
}

function onEditorChange(value) {
  if (!state.activeSectionId) return;
  if (localState.saveTimer) clearTimeout(localState.saveTimer);
  setSaveStatus("dirty", "Non sauvé");
  localState.saveTimer = setTimeout(() => saveSectionContent(value), 2000);
}

async function saveSectionContent(value) {
  if (!state.activeSectionId) return;
  const section = activeSection();
  if (!section) return;
  if (section.contenu === value) {
    setSaveStatus("saved", "Sauvegardé");
    return;
  }
  section.contenu = value;
  section.updated_at = now();
  try {
    await saveDataFile("manifeste", `Update section ${section.id}`);
  } catch (err) {
    console.error(err);
    alert(`Erreur sauvegarde : ${err.message}\n\nRecharger la page pour synchroniser.`);
  }
}

// =========================================================================
// TOC
// =========================================================================
function renderTOC() {
  const sections = getFilteredSections();
  el.tocList.innerHTML = "";

  for (const s of sections) {
    const item = document.createElement("div");
    item.className = `toc-item n${s.niveau}`;
    if (s.archive) item.classList.add("archived");
    if (s.id === state.activeSectionId) item.classList.add("active");
    item.dataset.id = s.id;

    const dot = document.createElement("span");
    dot.className = `toc-status-dot ${s.archive ? "archive" : s.statut}`;
    dot.title = "Clic droit pour changer le statut";
    item.appendChild(dot);

    const title = document.createElement("span");
    title.className = "toc-title";
    title.textContent = s.titre;
    item.appendChild(title);

    const tachesCount = state.taches.data.taches.filter(
      (t) => t.section_id === s.id && !t.archive && t.statut !== "termine"
    ).length;
    if (tachesCount > 0) {
      const badge = document.createElement("span");
      badge.className = "toc-badge";
      badge.textContent = tachesCount;
      item.appendChild(badge);
    }

    item.addEventListener("click", () => selectSection(s.id));
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openSectionMenu(e, s);
    });
    el.tocList.appendChild(item);
  }
}

function getFilteredSections() {
  let list = sortHierarchically([...state.manifeste.data.sections]);
  if (localState.tocFilter === "actives") list = list.filter((s) => !s.archive);
  if (localState.tocSearch) {
    const q = localState.tocSearch.toLowerCase();
    list = list.filter(
      (s) =>
        s.titre.toLowerCase().includes(q) ||
        (s.contenu || "").toLowerCase().includes(q)
    );
  }
  return list;
}

function sortHierarchically(sections) {
  const byParent = {};
  for (const s of sections) {
    const key = s.parent_id || "__root__";
    (byParent[key] ||= []).push(s);
  }
  for (const k in byParent) byParent[k].sort((a, b) => a.ordre - b.ordre);
  const result = [];
  const walk = (parentId) => {
    const children = byParent[parentId || "__root__"] || [];
    for (const child of children) {
      result.push(child);
      walk(child.id);
    }
  };
  walk(null);
  return result;
}

function selectSection(id) {
  // Forcer sauvegarde si en cours d'édition
  if (localState.saveTimer) {
    clearTimeout(localState.saveTimer);
    localState.saveTimer = null;
    if (state.activeSectionId) {
      saveSectionContent(localState.editor.getValue());
    }
  }

  state.activeSectionId = id;
  const section = activeSection();
  if (!section) return;

  el.activeSectionTitle.textContent = section.titre;
  localState.editor.setValue(section.contenu || "");

  $$(".toc-item").forEach((i) =>
    i.classList.toggle("active", i.dataset.id === id)
  );

  // Propager aux modules feature
  renderTaches();
  renderProjets();
  onAssistantSection();
}

// =========================================================================
// MENU CONTEXTUEL SECTION (clic droit)
// =========================================================================
function openSectionMenu(e, section) {
  // Simple prompt-based menu pour rester vanilla sans popup custom
  const choice = prompt(
    `Section « ${section.titre} »\n\n` +
      `1 = Statut stable\n2 = Statut en travail\n3 = Statut à revoir\n` +
      `4 = ${section.archive ? "Désarchiver" : "Archiver"}\n` +
      `5 = Monter\n6 = Descendre\n\nTon choix :`
  );
  if (!choice) return;
  handleSectionMenu(choice.trim(), section);
}

async function handleSectionMenu(choice, section) {
  const statutMap = { 1: "stable", 2: "en_travail", 3: "a_revoir" };
  if (statutMap[choice]) {
    section.statut = statutMap[choice];
    section.updated_at = now();
    renderTOC();
    await saveDataFile("manifeste", `Statut ${section.id} → ${section.statut}`);
  } else if (choice === "4") {
    section.archive = !section.archive;
    section.updated_at = now();
    renderTOC();
    await saveDataFile(
      "manifeste",
      section.archive ? `Archive ${section.id}` : `Restore ${section.id}`
    );
  } else if (choice === "5" || choice === "6") {
    // Échanger ordre avec le sibling adjacent
    const siblings = state.manifeste.data.sections
      .filter((s) => s.parent_id === section.parent_id)
      .sort((a, b) => a.ordre - b.ordre);
    const idx = siblings.findIndex((s) => s.id === section.id);
    const swapIdx = choice === "5" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const other = siblings[swapIdx];
    [section.ordre, other.ordre] = [other.ordre, section.ordre];
    section.updated_at = other.updated_at = now();
    renderTOC();
    await saveDataFile("manifeste", `Réordonnancement ${section.id}`);
  }
}

// =========================================================================
// UI BINDINGS
// =========================================================================
function bindUI() {
  el.tocSearch.addEventListener("input", (e) => {
    localState.tocSearch = e.target.value;
    renderTOC();
  });

  $$(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      localState.tocFilter = btn.dataset.filter;
      renderTOC();
    });
  });

  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      $$(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $$(".tab-panel").forEach((p) => p.classList.remove("active"));
      $(`#tab-${tab}`).classList.add("active");
    });
  });

  $$(".mobile-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const col = btn.dataset.col;
      $$(".mobile-nav-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ["left", "center", "right"].forEach((c) => {
        $(`.col-${c}`).classList.toggle("mobile-active", c === col);
      });
    });
  });
  if (window.innerWidth <= 768) {
    $(".col-center").classList.add("mobile-active");
    $$(".mobile-nav-btn").forEach((b) => b.classList.remove("active"));
    $('.mobile-nav-btn[data-col="center"]').classList.add("active");
  }

  el.btnSettings.addEventListener("click", () => {
    showConfig();
  });
  el.btnPreviewOnly.addEventListener("click", () => {
    el.editorSplit.classList.toggle("preview-only");
  });
  $("#btn-add-section").addEventListener("click", addSection);

  // Cmd+S sauvegarde manuelle
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      if (localState.saveTimer) clearTimeout(localState.saveTimer);
      if (state.activeSectionId) saveSectionContent(localState.editor.getValue());
    }
  });
}

// =========================================================================
// AJOUT DE SECTION
// =========================================================================
async function addSection() {
  const titre = prompt("Titre de la nouvelle section :");
  if (!titre) return;
  const niveauStr = prompt("Niveau (1, 2 ou 3) :", "2");
  const niveau = parseInt(niveauStr, 10);
  if (![1, 2, 3].includes(niveau)) {
    alert("Niveau invalide.");
    return;
  }
  let parent_id = null;
  if (niveau > 1) {
    const candidates = state.manifeste.data.sections.filter(
      (s) => s.niveau < niveau && !s.archive
    );
    const def = candidates.length ? candidates[candidates.length - 1].id : "";
    const pid = prompt("ID de la section parente (voir TOC) :", def);
    parent_id = pid || null;
  }

  const slug = titre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  let id = slug || "section";
  const existing = new Set(state.manifeste.data.sections.map((s) => s.id));
  if (existing.has(id)) {
    let i = 2;
    while (existing.has(`${id}-${i}`)) i++;
    id = `${id}-${i}`;
  }

  const siblings = state.manifeste.data.sections.filter(
    (s) => s.parent_id === parent_id
  );
  const ordre = siblings.length
    ? Math.max(...siblings.map((s) => s.ordre)) + 1
    : 1;

  const n = now();
  state.manifeste.data.sections.push({
    id,
    titre: titre.trim(),
    niveau,
    parent_id,
    ordre,
    statut: "en_travail",
    contenu: "",
    tags: [],
    archive: false,
    created_at: n,
    updated_at: n,
  });
  renderTOC();
  selectSection(id);
  await saveDataFile("manifeste", `Add section ${id}`);
}

// =========================================================================
// SAVE INDICATOR
// =========================================================================
function setSaveStatus(kind, text) {
  el.saveIndicator.className = "save-indicator";
  if (kind === "saving") el.saveIndicator.classList.add("saving");
  if (kind === "saved") el.saveIndicator.classList.add("saved");
  if (kind === "error") el.saveIndicator.classList.add("error");
  el.saveIndicator.textContent = text;
}

boot();
