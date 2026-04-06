/* =========================================================================
   projets.js — CRUD des projets liés à la section active
   ========================================================================= */

import { state, saveDataFile, uid, now } from "./store.js?v=1775500573";
import { toast, confirmDialog, formDialog } from "./ui.js?v=1775500573";

const STATUTS = ["a_specifier", "en_cours", "en_pause", "termine"];
const STATUT_LABELS = {
  a_specifier: "À spécifier",
  en_cours: "En cours",
  en_pause: "En pause",
  termine: "Terminé",
};

let el = {};
let onCountChange = () => {};

export function initProjets(onCount) {
  onCountChange = onCount || (() => {});
  el = {
    addBtn: document.querySelector("#btn-add-projet"),
    list: document.querySelector("#projets-list"),
  };
  el.addBtn.addEventListener("click", addProjet);
}

export function renderProjets() {
  const sectionId = state.activeSectionId;
  if (!sectionId) {
    el.list.innerHTML = '<div class="empty">Sélectionne une section.</div>';
    onCountChange(0);
    return;
  }
  const active = state.projets.data.projets.filter(
    (p) => p.section_id === sectionId && !p.archive
  );
  onCountChange(active.filter((p) => p.statut !== "termine").length);
  if (active.length === 0) {
    el.list.innerHTML = '<div class="empty">Aucun projet lié à cette section.</div>';
    return;
  }
  el.list.innerHTML = "";
  for (const p of active) el.list.appendChild(renderProjet(p));
}

function renderProjet(p) {
  const card = document.createElement("div");
  card.className = `projet-card statut-${p.statut}`;

  const head = document.createElement("div");
  head.className = "projet-head";

  const title = document.createElement("div");
  title.className = "projet-title";
  title.textContent = p.nom;
  title.title = "Double-clic pour éditer";
  title.addEventListener("dblclick", () => editNom(p, title));
  head.appendChild(title);

  const statut = document.createElement("button");
  statut.className = `statut-chip statut-${p.statut}`;
  statut.textContent = STATUT_LABELS[p.statut];
  statut.addEventListener("click", () => cycleStatut(p));
  head.appendChild(statut);

  const arch = document.createElement("button");
  arch.className = "btn-icon-sm";
  arch.innerHTML = "✕";
  arch.title = "Archiver";
  arch.addEventListener("click", () => archiveProjet(p));
  head.appendChild(arch);

  card.appendChild(head);

  const desc = document.createElement("div");
  desc.className = "projet-desc";
  desc.textContent = p.description || "(pas de description)";
  desc.title = "Double-clic pour éditer";
  desc.addEventListener("dblclick", () => editDesc(p, desc));
  card.appendChild(desc);

  if (p.lien_vision) {
    const link = document.createElement("a");
    link.href = p.lien_vision;
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "projet-link";
    link.textContent = "→ " + p.lien_vision;
    card.appendChild(link);
  }

  return card;
}

async function addProjet() {
  const result = await formDialog({
    title: "Nouveau projet",
    fields: [
      { name: "nom", label: "Nom du projet", type: "text", placeholder: "Ex. Scoring fournisseurs IA" },
      {
        name: "description",
        label: "Description (optionnelle)",
        type: "text",
        multiline: true,
        rows: 3,
        placeholder: "À quoi sert ce projet ? Objectif, livrable attendu…",
      },
      { name: "lien_vision", label: "Lien Vision / externe (optionnel)", type: "text", placeholder: "https://…" },
    ],
    okLabel: "Créer",
  });
  if (!result || !result.nom) return;
  const p = {
    id: uid("p"),
    section_id: state.activeSectionId,
    nom: result.nom,
    description: result.description || "",
    statut: "a_specifier",
    lien_vision: result.lien_vision || "",
    archive: false,
    created_at: now(),
    updated_at: now(),
  };
  state.projets.data.projets.push(p);
  renderProjets();
  try {
    await saveDataFile("projets", `Add projet ${p.id}`);
    toast(`Projet créé : ${p.nom}`, "success");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function cycleStatut(p) {
  const i = STATUTS.indexOf(p.statut);
  p.statut = STATUTS[(i + 1) % STATUTS.length];
  p.updated_at = now();
  renderProjets();
  await saveDataFile("projets", `Projet ${p.id} → ${p.statut}`);
}

async function archiveProjet(p) {
  const ok = await confirmDialog(`Archiver le projet « ${p.nom} » ?`, {
    title: "Archiver le projet",
    okLabel: "Archiver",
    danger: true,
  });
  if (!ok) return;
  p.archive = true;
  p.updated_at = now();
  renderProjets();
  try {
    await saveDataFile("projets", `Archive projet ${p.id}`);
    toast("Projet archivé", "success");
  } catch (err) {
    toast(err.message, "error");
  }
}

function editNom(p, titleEl) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = p.nom;
  input.className = "inline-edit";
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  input.addEventListener("blur", async () => {
    const nv = input.value.trim();
    if (nv && nv !== p.nom) {
      p.nom = nv;
      p.updated_at = now();
      await saveDataFile("projets", `Edit projet ${p.id}`);
    }
    renderProjets();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") renderProjets();
  });
}

function editDesc(p, descEl) {
  const ta = document.createElement("textarea");
  ta.value = p.description || "";
  ta.rows = 3;
  ta.className = "inline-edit";
  descEl.replaceWith(ta);
  ta.focus();
  ta.addEventListener("blur", async () => {
    const nv = ta.value.trim();
    if (nv !== (p.description || "")) {
      p.description = nv;
      p.updated_at = now();
      await saveDataFile("projets", `Edit projet ${p.id}`);
    }
    renderProjets();
  });
}
