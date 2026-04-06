/* =========================================================================
   app.js — Orchestration D4 Manifeste
   ========================================================================= */

import * as gh from "./github.js?v=1775497992";
import { createEditor } from "./editor.js?v=1775497992";
import {
  state,
  setStatusHandler,
  saveDataFile,
  activeSection,
  sortHierarchically,
  now,
} from "./store.js?v=1775497992";
import { initTaches, renderTaches } from "./taches.js?v=1775497992";
import { initAssistant, onSectionChanged as onAssistantSection } from "./assistant.js?v=1775497992";
import { initGenerer } from "./generer.js?v=1775497992";
import { initActions, renderTasksList, renderEmptyDetail } from "./actions.js?v=1775497992";
import { toast, confirmDialog, formDialog, actionMenu } from "./ui.js?v=1775497992";
import { openPrintView } from "./print.js?v=1775497992";
import { openTasksView } from "./tasks-view.js?v=1775497992";

const CFG_KEY = "d4_manifeste_cfg_v1";
const LAST_SECTION_KEY = "d4_manifeste_last_section";

// ---- DOM refs
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const escapeHtml = (s) =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

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
  btnToggleMode: $("#btn-toggle-mode"),
  editorSplit: $("#editor-split"),
  btnPrev: $("#btn-prev"),
  btnNext: $("#btn-next"),
  prevTitle: $("#prev-title"),
  nextTitle: $("#next-title"),
  btnPrevMobile: $("#btn-prev-mobile"),
  btnNextMobile: $("#btn-next-mobile"),
  countTaches: $("#count-taches"),
};

// Local state (non-shared)
let localState = {
  mode: "manifeste", // 'manifeste' | 'actions'
  tocFilter: "all",
  tocSearch: "",
  editor: null,
  saveTimer: null,
  searchTimer: null,
  sortedSections: null, // Cache du tri hiérarchique, invalidé sur add/archive/reorder
};

const SAVE_DEBOUNCE_MS = 2000;
const SEARCH_DEBOUNCE_MS = 150;

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
    state.conversations = data.conversations;
  } catch (err) {
    setSaveStatus("error", "Erreur chargement");
    toast(`Impossible de charger les données : ${err.message}`, "error", 8000);
    return;
  }

  initEditor();
  initTaches((count) => {
    el.countTaches.textContent = count;
  });
  initAssistant();
  initGenerer();
  initActions();
  renderTOC();

  // Restaurer la dernière section visitée ou tomber sur la première H1
  const lastId = localStorage.getItem(LAST_SECTION_KEY);
  const sections = state.manifeste.data.sections.filter((s) => !s.archive);
  const restored = lastId && sections.find((s) => s.id === lastId);
  const target = restored || sections.find((s) => s.niveau === 1) || sections[0];
  if (target) selectSection(target.id);

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
    getHeader: () => {
      const s = activeSection();
      if (!s) return "";
      const isEmpty = !(s.contenu || "").trim();
      const hint = isEmpty
        ? '<p class="preview-empty-hint">Cette section est vide. Clique sur ✏️ Modifier pour écrire.</p>'
        : "";
      return `<header class="section-preview-header n${s.niveau}"><h1 class="preview-section-title">${escapeHtml(s.titre)}</h1>${hint}</header>`;
    },
  });
}

function onEditorChange(value) {
  if (!state.activeSectionId) return;
  if (localState.saveTimer) clearTimeout(localState.saveTimer);
  setSaveStatus("dirty", "Non sauvé");
  localState.saveTimer = setTimeout(() => saveSectionContent(value), SAVE_DEBOUNCE_MS);
}

/** Force la sauvegarde en attente immédiatement (sur changement de section, ⌘S, toggle mode). */
function flushPendingSave() {
  if (!localState.saveTimer) return;
  clearTimeout(localState.saveTimer);
  localState.saveTimer = null;
  if (state.activeSectionId) {
    saveSectionContent(localState.editor.getValue());
  }
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
    toast(`Erreur sauvegarde : ${err.message}`, "error", 6000);
  }
}

// =========================================================================
// TOC
// =========================================================================

/** Cache du tri hiérarchique. Invalidé quand les sections sont ajoutées/archivées/réordonnées. */
function getSortedSections() {
  if (!localState.sortedSections) {
    localState.sortedSections = sortHierarchically(state.manifeste.data.sections);
  }
  return localState.sortedSections;
}
function invalidateSortedCache() {
  localState.sortedSections = null;
}

/** Construit un Map section_id → nombre de tâches ouvertes, en un seul pass sur les tâches. */
function buildOpenTachesMap() {
  const map = new Map();
  for (const t of state.taches.data.taches) {
    if (t.archive || t.statut === "termine") continue;
    map.set(t.section_id, (map.get(t.section_id) || 0) + 1);
  }
  return map;
}

function renderTOC() {
  let list = getSortedSections();
  if (localState.tocFilter === "actives") list = list.filter((s) => !s.archive);
  if (localState.tocSearch) {
    const q = localState.tocSearch.toLowerCase();
    list = list.filter(
      (s) =>
        s.titre.toLowerCase().includes(q) ||
        (s.contenu || "").toLowerCase().includes(q)
    );
  }

  const openTaches = buildOpenTachesMap();
  const activeId = state.activeSectionId;

  // Construction via DocumentFragment pour minimiser les reflows
  const frag = document.createDocumentFragment();
  for (const s of list) {
    const item = document.createElement("div");
    item.className = `toc-item n${s.niveau}`;
    if (s.archive) item.classList.add("archived");
    if (s.id === activeId) item.classList.add("active");
    item.dataset.id = s.id;

    const dot = document.createElement("span");
    dot.className = `toc-status-dot ${s.archive ? "archive" : s.statut}`;
    dot.title = "Clic droit pour changer le statut";
    item.appendChild(dot);

    const title = document.createElement("span");
    title.className = "toc-title";
    title.textContent = s.titre;
    item.appendChild(title);

    const count = openTaches.get(s.id) || 0;
    if (count > 0) {
      const badge = document.createElement("span");
      badge.className = "toc-badge";
      badge.textContent = count;
      item.appendChild(badge);
    }
    frag.appendChild(item);
  }
  el.tocList.innerHTML = "";
  el.tocList.appendChild(frag);
}

function selectSection(id) {
  flushPendingSave();

  state.activeSectionId = id;
  localStorage.setItem(LAST_SECTION_KEY, id);
  const section = activeSection();
  if (!section) return;

  el.activeSectionTitle.textContent = section.titre;
  localState.editor.setValue(section.contenu || "");

  toggleEditMode("read");

  // Màj visuelle TOC sans re-render complet
  for (const i of el.tocList.querySelectorAll(".toc-item")) {
    i.classList.toggle("active", i.dataset.id === id);
  }

  renderTaches();
  onAssistantSection();
  updateNavButtons();
}

// =========================================================================
// NAVIGATION PREV / NEXT
// =========================================================================
function getNavList() {
  return getSortedSections().filter((s) => !s.archive);
}

function updateNavButtons() {
  const list = getNavList();
  const idx = list.findIndex((s) => s.id === state.activeSectionId);
  const prev = idx > 0 ? list[idx - 1] : null;
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;

  for (const b of [el.btnPrev, el.btnPrevMobile]) b.disabled = !prev;
  for (const b of [el.btnNext, el.btnNextMobile]) b.disabled = !next;
  el.prevTitle.textContent = prev ? prev.titre : "—";
  el.nextTitle.textContent = next ? next.titre : "—";
  el.btnPrev.title = prev ? `Précédent : ${prev.titre} (←)` : "Aucune section avant";
  el.btnNext.title = next ? `Suivant : ${next.titre} (→)` : "Aucune section après";
}

function navigateRelative(delta) {
  const list = getNavList();
  const idx = list.findIndex((s) => s.id === state.activeSectionId);
  const target = list[idx + delta];
  if (target) {
    selectSection(target.id);
    el.tocList
      .querySelector(`.toc-item[data-id="${target.id}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }
}

// =========================================================================
// MENU CONTEXTUEL SECTION (clic droit)
// =========================================================================
async function openSectionMenu(e, section) {
  const choice = await actionMenu({
    title: section.titre,
    actions: [
      { label: "● Statut : stable", value: "stable" },
      { label: "● Statut : en travail", value: "en_travail" },
      { label: "● Statut : à revoir", value: "a_revoir" },
      {
        label: section.archive ? "↺ Désarchiver" : "🗄 Archiver",
        value: "archive",
      },
      { label: "↑ Monter", value: "up" },
      { label: "↓ Descendre", value: "down" },
    ],
  });
  if (!choice) return;

  if (["stable", "en_travail", "a_revoir"].includes(choice)) {
    section.statut = choice;
    section.updated_at = now();
    renderTOC();
    try {
      await saveDataFile("manifeste", `Statut ${section.id} → ${choice}`);
      toast(`Statut mis à jour`, "success");
    } catch (err) {
      toast(err.message, "error");
    }
  } else if (choice === "archive") {
    section.archive = !section.archive;
    section.updated_at = now();
    invalidateSortedCache();
    renderTOC();
    updateNavButtons();
    try {
      await saveDataFile(
        "manifeste",
        section.archive ? `Archive ${section.id}` : `Restore ${section.id}`
      );
      toast(section.archive ? "Section archivée" : "Section restaurée", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  } else if (choice === "up" || choice === "down") {
    const siblings = state.manifeste.data.sections
      .filter((s) => s.parent_id === section.parent_id)
      .sort((a, b) => a.ordre - b.ordre);
    const idx = siblings.findIndex((s) => s.id === section.id);
    const swapIdx = choice === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) {
      toast("Déjà à l'extrémité", "warn", 1500);
      return;
    }
    const other = siblings[swapIdx];
    [section.ordre, other.ordre] = [other.ordre, section.ordre];
    section.updated_at = other.updated_at = now();
    invalidateSortedCache();
    renderTOC();
    updateNavButtons();
    try {
      await saveDataFile("manifeste", `Réordonnancement ${section.id}`);
    } catch (err) {
      toast(err.message, "error");
    }
  }
}

// =========================================================================
// UI BINDINGS
// =========================================================================
function bindUI() {
  // Recherche TOC debouncée
  el.tocSearch.addEventListener("input", (e) => {
    const v = e.target.value;
    if (localState.searchTimer) clearTimeout(localState.searchTimer);
    localState.searchTimer = setTimeout(() => {
      localState.tocSearch = v;
      renderTOC();
    }, SEARCH_DEBOUNCE_MS);
  });

  // Mode toggle Manifeste / Actions
  $$(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      switchMode(mode);
    });
  });

  // Événements cross-modules
  document.addEventListener("section-changed-for-ia", () => {
    onAssistantSection();
  });
  document.addEventListener("goto-manifeste-section", (e) => {
    switchMode("manifeste");
    selectSection(e.detail.sectionId);
  });

  // Event delegation : un seul listener sur la liste TOC
  el.tocList.addEventListener("click", (e) => {
    const item = e.target.closest(".toc-item");
    if (item?.dataset.id) selectSection(item.dataset.id);
  });
  el.tocList.addEventListener("contextmenu", (e) => {
    const item = e.target.closest(".toc-item");
    if (!item?.dataset.id) return;
    e.preventDefault();
    const s = state.manifeste.data.sections.find((x) => x.id === item.dataset.id);
    if (s) openSectionMenu(e, s);
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
      if (!col) return; // Boutons nav-edge (prev/next) : handler séparé
      $$(".mobile-nav-btn[data-col]").forEach((b) => b.classList.remove("active"));
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
  $("#btn-help").addEventListener("click", showShortcuts);
  $("#btn-print").addEventListener("click", openPrintView);
  $("#btn-tasks-view").addEventListener("click", openTasksView);
  el.btnToggleMode.addEventListener("click", toggleEditMode);
  el.btnPrev.addEventListener("click", () => navigateRelative(-1));
  el.btnNext.addEventListener("click", () => navigateRelative(1));
  el.btnPrevMobile.addEventListener("click", () => navigateRelative(-1));
  el.btnNextMobile.addEventListener("click", () => navigateRelative(1));
  $("#btn-settings-mobile").addEventListener("click", showConfig);
  $("#btn-add-section").addEventListener("click", addSection);

  // Toolbar reflète le mode initial (lecture)
  el.editorToolbar.classList.add("read");

  // Raccourcis clavier globaux
  document.addEventListener("keydown", handleShortcuts);

  // Mutations externes sur taches (depuis assistant IA) → refresh UI
  document.addEventListener("taches-changed", () => {
    renderTaches();
    renderTOC();
    if (localState.mode === "actions") renderTasksList();
  });
}

// =========================================================================
// MODE SWITCH
// =========================================================================
function switchMode(mode) {
  if (localState.mode === mode) return;
  localState.mode = mode;
  const app = $("#app");
  app.dataset.mode = mode;

  // Highlight le bouton actif
  $$(".mode-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === mode)
  );

  if (mode === "actions") {
    renderTasksList();
    renderEmptyDetail();
  }
}

function handleShortcuts(e) {
  const mod = e.metaKey || e.ctrlKey;
  const target = e.target;
  const isInput =
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT";

  // Cmd+S : sauvegarde manuelle
  if (mod && e.key === "s") {
    e.preventDefault();
    flushPendingSave();
    if (state.activeSectionId) toast("Sauvegarde…", "info", 1500);
    return;
  }

  // Cmd+K : focus recherche
  if (mod && e.key === "k") {
    e.preventDefault();
    el.tocSearch.focus();
    el.tocSearch.select();
    return;
  }

  // Cmd+/ ou ? : aide raccourcis
  if ((mod && e.key === "/") || (!isInput && e.key === "?")) {
    e.preventDefault();
    showShortcuts();
    return;
  }

  // Cmd+1-4 : switch tabs
  if (mod && ["1", "2", "3", "4"].includes(e.key)) {
    e.preventDefault();
    const tabs = ["manifeste", "taches", "projets", "generer"];
    const tab = tabs[parseInt(e.key, 10) - 1];
    $(`.tab-btn[data-tab="${tab}"]`)?.click();
    return;
  }

  // Cmd+E : basculer lecture / édition
  if (mod && e.key === "e") {
    e.preventDefault();
    toggleEditMode();
    return;
  }

  // j/k ou flèches ← → : navigation dans les sections (hors input)
  if (!isInput && !mod) {
    if (e.key === "j" || e.key === "ArrowRight") {
      e.preventDefault();
      navigateRelative(1);
      return;
    }
    if (e.key === "k" || e.key === "ArrowLeft") {
      e.preventDefault();
      navigateRelative(-1);
      return;
    }
  }
}

function toggleEditMode(forceMode) {
  const currentlyRead = el.editorSplit.classList.contains("read-mode");
  const goToEdit = forceMode === "edit" ? true : forceMode === "read" ? false : currentlyRead;
  if (goToEdit) {
    el.editorSplit.classList.remove("read-mode");
    el.editorToolbar.classList.remove("read");
    el.btnToggleMode.innerHTML = '<span class="icon">📖</span><span class="label">Lecture</span>';
    setTimeout(() => {
      el.editorTextarea.focus();
      const len = el.editorTextarea.value.length;
      el.editorTextarea.setSelectionRange(len, len);
    }, 50);
  } else {
    flushPendingSave();
    el.editorSplit.classList.add("read-mode");
    el.editorToolbar.classList.add("read");
    el.btnToggleMode.innerHTML = '<span class="icon">✏️</span><span class="label">Modifier</span>';
  }
}

function showShortcuts() {
  const body = document.createElement("div");
  body.className = "shortcut-list";
  const rows = [
    ["Sauvegarder", "⌘ S"],
    ["Rechercher dans la TOC", "⌘ K"],
    ["Section précédente / suivante", "← / → ou K / J"],
    ["Onglet Manifeste / Tâches / Projets / Générer", "⌘ 1-4"],
    ["Basculer Lecture / Édition", "⌘ E"],
    ["Envoyer à l'assistant IA", "⌘ Entrée"],
    ["Fermer modal / menu", "Échap"],
    ["Aide raccourcis", "⌘ / ou ?"],
  ];
  for (const [label, key] of rows) {
    const r = document.createElement("div");
    r.className = "shortcut-row";
    const l = document.createElement("span");
    l.textContent = label;
    const k = document.createElement("span");
    k.innerHTML = key
      .split(" ")
      .map((p) => `<kbd>${p}</kbd>`)
      .join(" ");
    r.appendChild(l);
    r.appendChild(k);
    body.appendChild(r);
  }
  confirmDialog(body, {
    title: "Raccourcis clavier",
    okLabel: "OK",
    cancelLabel: "",
  });
}

// =========================================================================
// AJOUT DE SECTION
// =========================================================================
async function addSection() {
  // Construire la liste des parents candidats
  const parentOptions = [{ value: "", label: "(racine / pas de parent)" }];
  for (const s of sortHierarchically([...state.manifeste.data.sections])) {
    if (s.archive || s.niveau >= 3) continue;
    const indent = "  ".repeat(s.niveau - 1);
    parentOptions.push({
      value: s.id,
      label: `${indent}H${s.niveau} — ${s.titre}`,
    });
  }

  const result = await formDialog({
    title: "Nouvelle section",
    fields: [
      { name: "titre", label: "Titre", type: "text", placeholder: "Ex. Nos engagements clients" },
      {
        name: "niveau",
        label: "Niveau",
        type: "select",
        value: "2",
        options: [
          { value: "1", label: "H1 — titre de partie" },
          { value: "2", label: "H2 — section" },
          { value: "3", label: "H3 — sous-section" },
        ],
      },
      {
        name: "parent_id",
        label: "Parent (si H2 ou H3)",
        type: "select",
        value: "",
        options: parentOptions,
      },
    ],
    okLabel: "Créer",
  });
  if (!result || !result.titre) return;

  const niveau = parseInt(result.niveau, 10);
  let parent_id = result.parent_id || null;
  if (niveau === 1) parent_id = null;

  const slug = result.titre
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

  const siblings = state.manifeste.data.sections.filter((s) => s.parent_id === parent_id);
  const ordre = siblings.length ? Math.max(...siblings.map((s) => s.ordre)) + 1 : 1;
  const n = now();
  state.manifeste.data.sections.push({
    id,
    titre: result.titre,
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
  invalidateSortedCache();
  renderTOC();
  selectSection(id);
  toggleEditMode("edit");
  try {
    await saveDataFile("manifeste", `Add section ${id}`);
    toast(`Section créée : ${result.titre}`, "success");
  } catch (err) {
    toast(err.message, "error");
  }
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
