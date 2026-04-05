/* =========================================================================
   taches.js — CRUD des tâches liées à la section active
   ========================================================================= */

import { state, saveDataFile, uid, now } from "./store.js?v=1775398372";
import { toast, confirmDialog } from "./ui.js?v=1775398372";

const STATUTS = ["a_faire", "en_cours", "termine", "bloque"];
const STATUT_LABELS = {
  a_faire: "À faire",
  en_cours: "En cours",
  termine: "Terminé",
  bloque: "Bloqué",
};
const PRIORITES = ["basse", "normale", "haute"];
const PRIORITE_LABELS = { basse: "Basse", normale: "Normale", haute: "Haute" };

let el = {};
let onCountChange = () => {};

export function initTaches(onCount) {
  onCountChange = onCount || (() => {});
  el = {
    quickAdd: document.querySelector("#tache-quick-add"),
    list: document.querySelector("#taches-list"),
  };
  el.quickAdd.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && el.quickAdd.value.trim()) {
      addTache(el.quickAdd.value.trim());
      el.quickAdd.value = "";
    }
  });
}

export function renderTaches() {
  const sectionId = state.activeSectionId;
  if (!sectionId) {
    el.list.innerHTML = '<div class="empty">Sélectionne une section.</div>';
    onCountChange(0);
    return;
  }
  const all = state.taches.data.taches.filter((t) => t.section_id === sectionId);
  const active = all.filter((t) => !t.archive);
  onCountChange(active.filter((t) => t.statut !== "termine").length);

  if (active.length === 0) {
    el.list.innerHTML =
      '<div class="empty">Aucune tâche. Ajoute-en une ci-dessus (Entrée pour valider).</div>';
    return;
  }

  el.list.innerHTML = "";
  // Tri : non-terminées en priorité (par priorité haute→basse), terminées en bas
  active.sort((a, b) => {
    if ((a.statut === "termine") !== (b.statut === "termine"))
      return a.statut === "termine" ? 1 : -1;
    const order = { haute: 0, normale: 1, basse: 2 };
    return (order[a.priorite] ?? 1) - (order[b.priorite] ?? 1);
  });
  for (const t of active) el.list.appendChild(renderTache(t));
}

function renderTache(t) {
  const item = document.createElement("div");
  item.className = `crud-item tache statut-${t.statut}`;
  if (t.statut === "termine") item.classList.add("done");

  // Statut (bouton cyclique)
  const btnStatut = document.createElement("button");
  btnStatut.className = `statut-chip statut-${t.statut}`;
  btnStatut.textContent = STATUT_LABELS[t.statut];
  btnStatut.title = "Cliquer pour changer le statut";
  btnStatut.addEventListener("click", () => cycleStatut(t));
  item.appendChild(btnStatut);

  // Label (éditable)
  const label = document.createElement("div");
  label.className = "crud-label";
  label.textContent = t.label;
  label.title = "Double-clic pour éditer";
  label.addEventListener("dblclick", () => editLabel(t, label));
  item.appendChild(label);

  // Priorité
  const prio = document.createElement("button");
  prio.className = `prio-chip prio-${t.priorite}`;
  prio.textContent = PRIORITE_LABELS[t.priorite];
  prio.title = "Changer la priorité";
  prio.addEventListener("click", () => cyclePriorite(t));
  item.appendChild(prio);

  // Archive
  const archBtn = document.createElement("button");
  archBtn.className = "btn-icon-sm";
  archBtn.innerHTML = "✕";
  archBtn.title = "Archiver";
  archBtn.addEventListener("click", () => archiveTache(t));
  item.appendChild(archBtn);

  return item;
}

async function addTache(label) {
  const t = {
    id: uid("t"),
    section_id: state.activeSectionId,
    label,
    description: "",
    statut: "a_faire",
    priorite: "normale",
    archive: false,
    created_at: now(),
    updated_at: now(),
  };
  state.taches.data.taches.push(t);
  renderTaches();
  await saveDataFile("taches", `Add tache ${t.id}`);
}

async function cycleStatut(t) {
  const i = STATUTS.indexOf(t.statut);
  t.statut = STATUTS[(i + 1) % STATUTS.length];
  t.updated_at = now();
  renderTaches();
  await saveDataFile("taches", `Tache ${t.id} → ${t.statut}`);
}

async function cyclePriorite(t) {
  const i = PRIORITES.indexOf(t.priorite);
  t.priorite = PRIORITES[(i + 1) % PRIORITES.length];
  t.updated_at = now();
  renderTaches();
  await saveDataFile("taches", `Tache ${t.id} prio → ${t.priorite}`);
}

async function archiveTache(t) {
  const ok = await confirmDialog(`Archiver la tâche « ${t.label} » ?`, {
    title: "Archiver la tâche",
    okLabel: "Archiver",
    danger: true,
  });
  if (!ok) return;
  t.archive = true;
  t.updated_at = now();
  renderTaches();
  try {
    await saveDataFile("taches", `Archive tache ${t.id}`);
    toast("Tâche archivée", "success");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function editLabel(t, labelEl) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = t.label;
  input.className = "inline-edit";
  labelEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = async () => {
    const nv = input.value.trim();
    if (nv && nv !== t.label) {
      t.label = nv;
      t.updated_at = now();
      await saveDataFile("taches", `Edit tache ${t.id}`);
    }
    renderTaches();
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") renderTaches();
  });
}
