/* =========================================================================
   tasks-view.js — Vue globale des tâches + export PDF
   Ouvre une nouvelle fenêtre listant toutes les tâches groupées par section.
   ========================================================================= */

import { state, sortHierarchically } from "./store.js?v=1775499740";
import { toast } from "./ui.js?v=1775499740";

const STATUT_LABELS = {
  a_faire: "À faire",
  en_cours: "En cours",
  termine: "Terminé",
  bloque: "Bloqué",
};
const PRIORITE_LABELS = { basse: "Basse", normale: "Normale", haute: "Haute" };

export function openTasksView() {
  if (!state.taches?.data?.taches?.length) {
    toast("Aucune tâche à afficher.", "warn");
    return;
  }
  const html = buildTasksHTML();
  const win = window.open("", "_blank");
  if (!win) {
    toast("Autorise les pop-ups pour ouvrir la vue.", "error", 5000);
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function buildTasksHTML() {
  const tasks = state.taches.data.taches.filter((t) => !t.archive);
  const sections = sortHierarchically(state.manifeste.data.sections);
  const sectionById = new Map(sections.map((s) => [s.id, s]));

  // Stats globales
  const stats = { a_faire: 0, en_cours: 0, termine: 0, bloque: 0 };
  for (const t of tasks) stats[t.statut] = (stats[t.statut] || 0) + 1;
  const totalActive = tasks.length - stats.termine;

  // Groupement par section — préserver l'ordre hiérarchique de la TOC
  const bySection = new Map();
  for (const t of tasks) {
    const sid = t.section_id;
    if (!bySection.has(sid)) bySection.set(sid, []);
    bySection.get(sid).push(t);
  }
  // Tri interne : priorité haute → basse, puis non-terminées avant terminées
  const prioOrder = { haute: 0, normale: 1, basse: 2 };
  for (const arr of bySection.values()) {
    arr.sort((a, b) => {
      if ((a.statut === "termine") !== (b.statut === "termine"))
        return a.statut === "termine" ? 1 : -1;
      return (prioOrder[a.priorite] ?? 1) - (prioOrder[b.priorite] ?? 1);
    });
  }

  const dateStr = new Date().toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Rendu des groupes, dans l'ordre hiérarchique des sections
  const groupsHtml = sections
    .filter((s) => bySection.has(s.id))
    .map((s) => {
      const tasksOfSection = bySection.get(s.id);
      const breadcrumb = buildBreadcrumb(s, sectionById);
      const rows = tasksOfSection
        .map(
          (t) => `
        <tr class="task-row statut-${t.statut}">
          <td class="col-statut"><span class="chip chip-statut chip-${t.statut}">${STATUT_LABELS[t.statut]}</span></td>
          <td class="col-label">
            <div class="task-label">${escapeHtml(t.label)}</div>
            ${t.description ? `<div class="task-desc">${escapeHtml(t.description)}</div>` : ""}
          </td>
          <td class="col-prio"><span class="chip chip-prio chip-prio-${t.priorite}">${PRIORITE_LABELS[t.priorite]}</span></td>
        </tr>`
        )
        .join("");
      return `
      <section class="group">
        <header class="group-head">
          <div class="group-breadcrumb">${breadcrumb}</div>
          <div class="group-count">${tasksOfSection.length} tâche${tasksOfSection.length > 1 ? "s" : ""}</div>
        </header>
        <table class="tasks-table">
          <colgroup>
            <col class="colw-statut"><col class="colw-label"><col class="colw-prio">
          </colgroup>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Tâches D4 — ${dateStr}</title>
<style>${CSS}</style>
</head>
<body>
  <header class="doc-header">
    <div class="header-top">
      <div class="logo">D4</div>
      <div class="header-title">
        <div class="brand">D4 Immobilier</div>
        <h1>Tâches du manifeste</h1>
      </div>
      <div class="header-date">${dateStr}</div>
    </div>
    <div class="stats">
      <div class="stat stat-total">
        <div class="stat-value">${totalActive}</div>
        <div class="stat-label">En cours</div>
      </div>
      <div class="stat stat-a_faire">
        <div class="stat-value">${stats.a_faire}</div>
        <div class="stat-label">À faire</div>
      </div>
      <div class="stat stat-en_cours">
        <div class="stat-value">${stats.en_cours}</div>
        <div class="stat-label">En cours</div>
      </div>
      <div class="stat stat-bloque">
        <div class="stat-value">${stats.bloque}</div>
        <div class="stat-label">Bloqué</div>
      </div>
      <div class="stat stat-termine">
        <div class="stat-value">${stats.termine}</div>
        <div class="stat-label">Terminé</div>
      </div>
    </div>
  </header>

  <main class="content">${groupsHtml}</main>

  <div class="print-bar">
    <button onclick="window.print()">Imprimer / Enregistrer en PDF</button>
    <button onclick="window.close()" class="secondary">Fermer</button>
  </div>
</body>
</html>`;
}

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
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #1a1a18;
  background: #f5f5f2;
  line-height: 1.5;
  font-size: 11pt;
}
body { padding: 40px 0 120px; }

.doc-header, .content { max-width: 21cm; margin: 0 auto; padding: 0 2cm; }

.doc-header {
  background: white;
  padding: 2cm 2cm 1.4cm;
  margin-bottom: 14px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
}
.header-top {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}
.logo {
  width: 48px; height: 48px;
  background: #1D9E75; color: white;
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  font-weight: 800; font-size: 20px;
  letter-spacing: -0.5px;
  flex-shrink: 0;
}
.header-title { flex: 1; }
.header-title .brand {
  font-size: 10pt; font-weight: 600;
  color: #1D9E75; text-transform: uppercase; letter-spacing: 0.5px;
}
.header-title h1 { font-size: 22pt; font-weight: 700; line-height: 1.1; letter-spacing: -0.5px; }
.header-date {
  font-size: 10pt; color: #6b6b68; font-weight: 500; white-space: nowrap;
}

/* Stats */
.stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
  padding-top: 16px;
  border-top: 1px solid #e0e0db;
}
.stat {
  padding: 10px 12px;
  border-radius: 6px;
  background: #f5f5f2;
  border-left: 3px solid #c8c8c2;
}
.stat-value { font-size: 22pt; font-weight: 700; line-height: 1; }
.stat-label { font-size: 9pt; color: #6b6b68; text-transform: uppercase; letter-spacing: 0.4px; margin-top: 4px; font-weight: 500; }
.stat-total { border-left-color: #1D9E75; background: #eef8f3; }
.stat-total .stat-value { color: #17805f; }
.stat-a_faire { border-left-color: #9c9c99; }
.stat-en_cours { border-left-color: #EF9F27; }
.stat-en_cours .stat-value { color: #a06e0f; }
.stat-bloque { border-left-color: #E24B4A; }
.stat-bloque .stat-value { color: #a13333; }
.stat-termine { border-left-color: #639922; opacity: 0.75; }

/* Groupes */
.group {
  background: white;
  padding: 1.2cm 2cm 1.4cm;
  margin-bottom: 14px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  page-break-inside: auto;
}
.group-head {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 16px;
  padding-bottom: 10px; margin-bottom: 12px;
  border-bottom: 2px solid #1D9E75;
}
.group-breadcrumb { font-size: 11.5pt; font-weight: 600; color: #1a1a18; flex: 1; }
.crumb-parent { color: #9c9c99; font-weight: 500; }
.crumb-current { color: #1a1a18; }
.crumb-sep { color: #c8c8c2; margin: 0 6px; font-weight: 400; }
.group-count {
  font-size: 9pt; color: #6b6b68; text-transform: uppercase;
  letter-spacing: 0.4px; font-weight: 500;
  background: #f5f5f2; padding: 3px 10px; border-radius: 10px;
  white-space: nowrap;
}

/* Table */
.tasks-table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
.colw-statut { width: 90px; }
.colw-prio { width: 80px; }
.tasks-table td {
  padding: 9px 10px;
  border-bottom: 1px solid #e8e8e5;
  vertical-align: top;
}
.tasks-table tr:last-child td { border-bottom: none; }
.tasks-table .col-statut, .tasks-table .col-prio { text-align: center; white-space: nowrap; }
.tasks-table tr.statut-termine .task-label { text-decoration: line-through; color: #9c9c99; }
.tasks-table tr.statut-termine { opacity: 0.65; }
.task-label { font-size: 10.5pt; line-height: 1.4; font-weight: 500; }
.task-desc { font-size: 9.5pt; color: #6b6b68; margin-top: 4px; line-height: 1.4; }

/* Chips */
.chip {
  display: inline-block;
  padding: 3px 9px;
  border-radius: 10px;
  font-size: 9pt; font-weight: 500;
  white-space: nowrap;
}
.chip-a_faire { background: #e8e8e5; color: #58584f; }
.chip-en_cours { background: #fdf0d6; color: #a06e0f; }
.chip-termine { background: #e0ecce; color: #3d6611; }
.chip-bloque { background: #fde0e0; color: #a13333; }
.chip-prio-haute { background: #fde0e0; color: #a13333; font-weight: 600; }
.chip-prio-normale { background: #f5f5f2; color: #6b6b68; }
.chip-prio-basse { background: #f5f5f2; color: #9c9c99; }

/* Barre d'action (écran uniquement) */
.print-bar {
  position: fixed; bottom: 20px; right: 20px;
  display: flex; gap: 8px;
  padding: 10px 14px;
  background: white; border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  z-index: 100;
}
.print-bar button {
  padding: 8px 14px; border: none; border-radius: 5px;
  font: inherit; font-weight: 500; font-size: 11pt;
  background: #1D9E75; color: white; cursor: pointer;
}
.print-bar button:hover { background: #17805f; }
.print-bar button.secondary { background: #f0f0ed; color: #1a1a18; }
.print-bar button.secondary:hover { background: #e0e0db; }

/* Impression A4 */
@page {
  size: A4;
  margin: 1.5cm 1.8cm;
  @bottom-right {
    content: counter(page) " / " counter(pages);
    font-family: "Inter", sans-serif; font-size: 9pt; color: #9c9c99;
  }
  @bottom-left {
    content: "D4 · Tâches";
    font-family: "Inter", sans-serif; font-size: 9pt; color: #9c9c99;
  }
}
@media print {
  html, body { background: white; padding: 0; }
  .doc-header, .group { max-width: none; margin: 0; padding: 0; box-shadow: none; background: white; }
  .doc-header { padding: 0 0 20px; margin-bottom: 20px; border-bottom: 2px solid #1D9E75; }
  .group { padding: 0; margin-bottom: 24px; page-break-inside: avoid; }
  .group-head { border-color: #1D9E75; }
  .print-bar { display: none !important; }
  .stat { background: white !important; border-left-width: 4px; }
  .tasks-table tr { page-break-inside: avoid; }
}
`;
