/* =========================================================================
   actions.js — Mode Actions : cockpit opérationnel centré sur les tâches
   Volet gauche : liste de toutes les tâches (groupées priorité → section)
   Volet central : détail de la tâche active + sœurs de la même section
   ========================================================================= */

import {
  state,
  saveDataFile,
  activeSection,
  sortHierarchically,
  uid,
  now,
} from "./store.js?v=1775498583";
import { toast, confirmDialog } from "./ui.js?v=1775498583";

const STATUT_ORDER = ["a_faire", "en_cours", "bloque", "termine"];
const STATUT_LABELS = {
  a_faire: "À faire",
  en_cours: "En cours",
  termine: "Terminé",
  bloque: "Bloqué",
};
const PRIO_ORDER = ["haute", "normale", "basse"];
const PRIO_LABELS = { haute: "Haute", normale: "Normale", basse: "Basse" };
const STATUT_OPTIONS = STATUT_ORDER.map((s) => ({
  value: s,
  label: STATUT_LABELS[s],
}));
const PRIO_OPTIONS = PRIO_ORDER.map((p) => ({
  value: p,
  label: PRIO_LABELS[p],
}));

let el = {};
let filterStatut = "active"; // 'active' | 'all' | specific statut
let filterSearch = "";

export function initActions() {
  el = {
    list: document.querySelector("#tasks-global-list"),
    search: document.querySelector("#tasks-search"),
    filterStatut: document.querySelector("#tasks-filter-statut"),
    detail: document.querySelector("#task-detail-panel"),
    addBtn: document.querySelector("#btn-add-task-global"),
  };

  // Event delegation sur la liste
  el.list.addEventListener("click", (e) => {
    const item = e.target.closest(".task-item");
    if (item?.dataset.id) selectTask(item.dataset.id);
  });

  el.search.addEventListener("input", (e) => {
    filterSearch = e.target.value.toLowerCase();
    renderTasksList();
  });
  el.filterStatut.addEventListener("change", (e) => {
    filterStatut = e.target.value;
    renderTasksList();
  });
  el.addBtn.addEventListener("click", addTaskGlobal);
}

// =========================================================================
// LISTE DES TÂCHES (volet gauche)
// =========================================================================
export function renderTasksList() {
  const sections = sortHierarchically(state.manifeste.data.sections);
  const sectionById = new Map(sections.map((s) => [s.id, s]));

  let tasks = state.taches.data.taches.filter((t) => !t.archive);

  // Filtre statut
  if (filterStatut === "active") tasks = tasks.filter((t) => t.statut !== "termine");
  else if (filterStatut !== "all") tasks = tasks.filter((t) => t.statut === filterStatut);

  // Filtre recherche
  if (filterSearch) {
    tasks = tasks.filter(
      (t) =>
        t.label.toLowerCase().includes(filterSearch) ||
        (t.description || "").toLowerCase().includes(filterSearch)
    );
  }

  // Groupement : priorité → section
  const grouped = {};
  for (const prio of PRIO_ORDER) grouped[prio] = new Map();
  for (const t of tasks) {
    const prio = t.priorite || "normale";
    const sid = t.section_id;
    const map = grouped[prio] || grouped["normale"];
    if (!map.has(sid)) map.set(sid, []);
    map.get(sid).push(t);
  }

  const frag = document.createDocumentFragment();
  let totalShown = 0;

  for (const prio of PRIO_ORDER) {
    const sectionMap = grouped[prio];
    if (sectionMap.size === 0) continue;

    // Header de priorité
    const prioHeader = document.createElement("div");
    prioHeader.className = `prio-group-header prio-${prio}`;
    let prioCount = 0;
    for (const arr of sectionMap.values()) prioCount += arr.length;
    prioHeader.innerHTML = `<span class="prio-group-label">${PRIO_LABELS[prio]}</span><span class="prio-group-count">${prioCount}</span>`;
    frag.appendChild(prioHeader);

    // Sections triées selon l'ordre hiérarchique
    const orderedSids = sections
      .filter((s) => sectionMap.has(s.id))
      .map((s) => s.id);

    for (const sid of orderedSids) {
      const sectionTasks = sectionMap.get(sid);

      for (const t of sectionTasks) {
        const item = document.createElement("div");
        item.className = `task-item statut-${t.statut}`;
        if (state.activeTaskId === t.id) item.classList.add("active");
        item.dataset.id = t.id;

        item.innerHTML = `<span class="task-status-dot ${t.statut}"></span><span class="task-item-label">${escapeHtml(t.label)}</span>`;
        frag.appendChild(item);
        totalShown++;
      }
    }
  }

  el.list.innerHTML = "";
  if (totalShown === 0) {
    el.list.innerHTML = '<div class="empty">Aucune tâche correspondante.</div>';
  } else {
    el.list.appendChild(frag);
  }
}

// =========================================================================
// DÉTAIL D'UNE TÂCHE (volet central)
// =========================================================================
function selectTask(taskId) {
  state.activeTaskId = taskId;
  const task = state.taches.data.taches.find((t) => t.id === taskId);
  if (!task) return;

  // Mettre à jour la section active (pour l'IA)
  if (task.section_id !== state.activeSectionId) {
    state.activeSectionId = task.section_id;
    localStorage.setItem("d4_manifeste_last_section", task.section_id);
  }

  renderTaskDetail(task);
  renderTasksList(); // refresh active highlight
  // Notifier l'assistant IA du changement de section
  document.dispatchEvent(new CustomEvent("section-changed-for-ia"));
}

function renderTaskDetail(task) {
  const sections = sortHierarchically(state.manifeste.data.sections);
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const section = sectionById.get(task.section_id);
  const breadcrumb = section ? buildBreadcrumb(section, sectionById) : "(section inconnue)";

  // Tâches sœurs (même section, non archivées, sauf la tâche active)
  const siblings = state.taches.data.taches.filter(
    (t) => t.section_id === task.section_id && !t.archive && t.id !== task.id
  );

  const siblingsHtml = siblings.length
    ? siblings
        .map(
          (t) =>
            `<div class="sibling-task ${t.statut === "termine" ? "done" : ""}" data-id="${t.id}">
              <span class="task-status-dot ${t.statut}"></span>
              <span>${escapeHtml(t.label)}</span>
            </div>`
        )
        .join("")
    : '<div class="empty-small">Aucune autre tâche sur cette section.</div>';

  el.detail.innerHTML = `
    <div class="task-detail">
      <div class="task-detail-breadcrumb" id="task-breadcrumb">${breadcrumb}
        <button class="btn-goto-section" id="btn-goto-section" title="Ouvrir dans le mode Manifeste">→ Voir la section</button>
      </div>

      <div class="task-detail-field">
        <label>Titre</label>
        <input type="text" id="task-edit-label" value="${escapeAttr(task.label)}" />
      </div>

      <div class="task-detail-row">
        <div class="task-detail-field">
          <label>Statut</label>
          <select id="task-edit-statut">
            ${STATUT_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === task.statut ? "selected" : ""}>${o.label}</option>`).join("")}
          </select>
        </div>
        <div class="task-detail-field">
          <label>Priorité</label>
          <select id="task-edit-prio">
            ${PRIO_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === task.priorite ? "selected" : ""}>${o.label}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="task-detail-field">
        <label>Description</label>
        <textarea id="task-edit-desc" rows="4" placeholder="Détail, contexte, critères de réussite…">${escapeHtml(task.description || "")}</textarea>
      </div>

      <div class="task-detail-actions">
        <button class="btn-secondary" id="btn-archive-task">🗄 Archiver cette tâche</button>
      </div>

      <div class="task-detail-siblings">
        <div class="siblings-header">Autres tâches de cette section</div>
        <div class="siblings-list" id="siblings-list">${siblingsHtml}</div>
        <button class="btn-add" id="btn-add-sibling">＋ Nouvelle tâche (même section)</button>
      </div>
    </div>
  `;

  // Bind events
  const qs = (sel) => el.detail.querySelector(sel);
  qs("#task-edit-label").addEventListener("change", (e) => {
    task.label = e.target.value.trim();
    task.updated_at = now();
    saveAndRefresh(task);
  });
  qs("#task-edit-statut").addEventListener("change", (e) => {
    task.statut = e.target.value;
    task.updated_at = now();
    saveAndRefresh(task);
  });
  qs("#task-edit-prio").addEventListener("change", (e) => {
    task.priorite = e.target.value;
    task.updated_at = now();
    saveAndRefresh(task);
  });
  qs("#task-edit-desc").addEventListener("change", (e) => {
    task.description = e.target.value.trim();
    task.updated_at = now();
    saveAndRefresh(task);
  });
  qs("#btn-archive-task").addEventListener("click", async () => {
    const ok = await confirmDialog(`Archiver la tâche « ${task.label} » ?`, {
      title: "Archiver",
      okLabel: "Archiver",
      danger: true,
    });
    if (!ok) return;
    task.archive = true;
    task.updated_at = now();
    state.activeTaskId = null;
    el.detail.innerHTML =
      '<div class="empty">Sélectionne une tâche à gauche.</div>';
    await saveDataFile("taches", `Archive tache ${task.id}`);
    renderTasksList();
    toast("Tâche archivée", "success");
  });
  qs("#btn-goto-section").addEventListener("click", () => {
    document.dispatchEvent(
      new CustomEvent("goto-manifeste-section", {
        detail: { sectionId: task.section_id },
      })
    );
  });
  qs("#btn-add-sibling").addEventListener("click", () =>
    addTaskInSection(task.section_id)
  );

  // Siblings click
  el.detail.querySelectorAll(".sibling-task").forEach((sib) => {
    sib.addEventListener("click", () => selectTask(sib.dataset.id));
  });
}

async function saveAndRefresh(task) {
  try {
    await saveDataFile("taches", `Update tache ${task.id}`);
    renderTaskDetail(task);
    renderTasksList();
  } catch (err) {
    toast(err.message, "error");
  }
}

// =========================================================================
// AJOUT DE TÂCHES
// =========================================================================
async function addTaskGlobal() {
  // Si une tâche est active, hériter de sa section
  const active = state.taches.data.taches.find(
    (t) => t.id === state.activeTaskId
  );
  const sectionId = active?.section_id || state.activeSectionId;
  if (!sectionId) {
    toast("Sélectionne d'abord une tâche ou une section.", "warn");
    return;
  }
  await addTaskInSection(sectionId);
}

async function addTaskInSection(sectionId) {
  const label = prompt("Titre de la tâche :");
  if (!label?.trim()) return;
  const t = {
    id: uid("t"),
    section_id: sectionId,
    label: label.trim(),
    description: "",
    statut: "a_faire",
    priorite: "normale",
    archive: false,
    created_at: now(),
    updated_at: now(),
  };
  state.taches.data.taches.push(t);
  try {
    await saveDataFile("taches", `Add tache ${t.id}`);
    selectTask(t.id);
    toast(`Tâche créée : ${t.label}`, "success");
  } catch (err) {
    toast(err.message, "error");
  }
}

export function renderEmptyDetail() {
  if (el.detail) {
    el.detail.innerHTML =
      '<div class="empty">Sélectionne une tâche à gauche pour la travailler.</div>';
  }
}

// =========================================================================
// STATS (pour le header ou autre)
// =========================================================================
export function getTasksStats() {
  const tasks = state.taches.data.taches.filter((t) => !t.archive);
  const stats = { total: tasks.length, a_faire: 0, en_cours: 0, bloque: 0, termine: 0 };
  for (const t of tasks) stats[t.statut] = (stats[t.statut] || 0) + 1;
  stats.actives = stats.total - stats.termine;
  return stats;
}

// =========================================================================
// HELPERS
// =========================================================================
function buildBreadcrumb(section, sectionById) {
  const parts = [];
  let cur = section;
  while (cur) {
    parts.unshift(escapeHtml(cur.titre));
    cur = cur.parent_id ? sectionById.get(cur.parent_id) : null;
  }
  return parts
    .map((p, i) =>
      i === parts.length - 1
        ? `<span class="crumb-current">${p}</span>`
        : `<span class="crumb-parent">${p}</span>`
    )
    .join('<span class="crumb-sep">›</span>');
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
