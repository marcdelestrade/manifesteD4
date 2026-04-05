/* =========================================================================
   app.js — Logique principale D4 Manifeste
   État global + orchestration des modules.
   ========================================================================= */

import * as gh from "./github.js";
import { createEditor } from "./editor.js";

// ---- État global
const state = {
  cfg: null, // { owner, repo, token, anthropicKey }
  manifeste: null, // { data: { sections: [] }, sha: "..." }
  taches: null,
  projets: null,
  memoire: null,
  activeSectionId: null,
  tocFilter: "all", // 'all' | 'actives'
  tocSearch: "",
  editor: null,
  saveTimer: null,
  isSaving: false,
};

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
};

// =========================================================================
// BOOT
// =========================================================================
function boot() {
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

  // Pré-remplir si config existante (depuis bouton ⚙)
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
    startApp();
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
  renderTOC();

  // Sélection auto : première section non-intro (H1 ou première section)
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
  state.editor = createEditor({
    textarea: el.editorTextarea,
    preview: el.editorPreview,
    toolbar: el.editorToolbar,
    onChange: onEditorChange,
  });
}

function onEditorChange(value) {
  if (!state.activeSectionId) return;
  // Debounce 2s puis sauvegarde
  if (state.saveTimer) clearTimeout(state.saveTimer);
  setSaveStatus("dirty", "Modifications non sauvées");
  state.saveTimer = setTimeout(() => saveSectionContent(value), 2000);
}

async function saveSectionContent(value) {
  if (!state.activeSectionId) return;
  const section = state.manifeste.data.sections.find(
    (s) => s.id === state.activeSectionId
  );
  if (!section) return;
  if (section.contenu === value) {
    setSaveStatus("saved", "Sauvegardé");
    return;
  }
  section.contenu = value;
  section.updated_at = new Date().toISOString();
  await saveManifeste(`Update section ${section.id}`);
}

async function saveManifeste(message) {
  if (state.isSaving) return;
  state.isSaving = true;
  setSaveStatus("saving", "Sauvegarde…");
  try {
    const newSha = await gh.writeFile(
      state.cfg,
      "data/manifeste.json",
      state.manifeste.data,
      state.manifeste.sha,
      message
    );
    state.manifeste.sha = newSha;
    setSaveStatus("saved", "Sauvegardé");
  } catch (err) {
    console.error(err);
    setSaveStatus("error", "Erreur sauvegarde");
    alert(`Erreur sauvegarde : ${err.message}\n\nRecharger la page pour synchroniser.`);
  } finally {
    state.isSaving = false;
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
    el.tocList.appendChild(item);
  }
}

function getFilteredSections() {
  let list = [...state.manifeste.data.sections];
  // Tri : par niveau 1 d'abord → puis parcours hiérarchique (ordre par parent)
  list = sortHierarchically(list);

  if (state.tocFilter === "actives") list = list.filter((s) => !s.archive);

  if (state.tocSearch) {
    const q = state.tocSearch.toLowerCase();
    list = list.filter(
      (s) =>
        s.titre.toLowerCase().includes(q) ||
        (s.contenu || "").toLowerCase().includes(q)
    );
  }
  return list;
}

/**
 * Trie les sections hiérarchiquement : H1 > ses H2 > leurs H3 > H1 suivant…
 */
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
  // Forcer sauvegarde avant changement de section
  if (state.saveTimer) {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    if (state.activeSectionId) {
      saveSectionContent(state.editor.getValue());
    }
  }

  state.activeSectionId = id;
  const section = state.manifeste.data.sections.find((s) => s.id === id);
  if (!section) return;

  el.activeSectionTitle.textContent = section.titre;
  state.editor.setValue(section.contenu || "");

  // Refresh TOC active state
  $$(".toc-item").forEach((i) =>
    i.classList.toggle("active", i.dataset.id === id)
  );
}

// =========================================================================
// UI BINDINGS
// =========================================================================
function bindUI() {
  // Recherche
  el.tocSearch.addEventListener("input", (e) => {
    state.tocSearch = e.target.value;
    renderTOC();
  });

  // Filtres
  $$(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.tocFilter = btn.dataset.filter;
      renderTOC();
    });
  });

  // Tabs
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      $$(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $$(".tab-panel").forEach((p) => p.classList.remove("active"));
      $(`#tab-${tab}`).classList.add("active");
    });
  });

  // Mobile nav
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
  // Initial : colonne centrale sur mobile
  if (window.innerWidth <= 768) {
    $(".col-center").classList.add("mobile-active");
    $$(".mobile-nav-btn").forEach((b) => b.classList.remove("active"));
    $('.mobile-nav-btn[data-col="center"]').classList.add("active");
  }

  // Settings
  el.btnSettings.addEventListener("click", () => {
    showConfig();
  });

  // Preview only toggle
  el.btnPreviewOnly.addEventListener("click", () => {
    el.editorSplit.classList.toggle("preview-only");
  });

  // Bouton ajout section
  $("#btn-add-section").addEventListener("click", addSection);

  // Keyboard: Cmd+S pour sauvegarde manuelle
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      if (state.saveTimer) clearTimeout(state.saveTimer);
      if (state.activeSectionId) saveSectionContent(state.editor.getValue());
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
  // Parent : dernière section de niveau < current
  let parent_id = null;
  if (niveau > 1) {
    const candidates = state.manifeste.data.sections.filter(
      (s) => s.niveau < niveau && !s.archive
    );
    const parentTitle = prompt(
      "ID de la section parente (voir TOC) :",
      candidates.length ? candidates[candidates.length - 1].id : ""
    );
    parent_id = parentTitle || null;
  }

  // ID unique
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
  const now = new Date().toISOString();

  const newSection = {
    id,
    titre: titre.trim(),
    niveau,
    parent_id,
    ordre,
    statut: "en_travail",
    contenu: "",
    tags: [],
    archive: false,
    created_at: now,
    updated_at: now,
  };
  state.manifeste.data.sections.push(newSection);
  renderTOC();
  selectSection(id);
  await saveManifeste(`Add section ${id}`);
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

// ---- Go
boot();
