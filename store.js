/* =========================================================================
   store.js — État partagé + helpers de sauvegarde GitHub
   Importé par tous les modules feature.
   ========================================================================= */

import * as gh from "./github.js?v=1775499502";

export const state = {
  cfg: null, // { owner, repo, token, anthropicKey }
  manifeste: null, // { data: { sections: [] }, sha }
  taches: null, // { data: { taches: [] }, sha }
  projets: null, // { data: { projets: [] }, sha }
  memoire: null, // { data: {...}, sha }
  conversations: null, // { data: { bySection: {...} }, sha }
  activeSectionId: null,
  activeTaskId: null,
  aiMessages: [], // conversation de la section active (chargée depuis conversations.json)
};

let statusHandler = () => {};
export function setStatusHandler(fn) {
  statusHandler = fn;
}
export function emitStatus(kind, text) {
  statusHandler(kind, text);
}

/**
 * Sauvegarde un fichier JSON complet sur GitHub.
 * key = 'manifeste' | 'taches' | 'projets' | 'memoire'
 */
export async function saveDataFile(key, message) {
  const path = `data/${key}.json`;
  emitStatus("saving", "Sauvegarde…");
  try {
    const sha = await gh.writeFile(
      state.cfg,
      path,
      state[key].data,
      state[key].sha,
      message
    );
    state[key].sha = sha;
    emitStatus("saved", "Sauvegardé");
    return sha;
  } catch (err) {
    emitStatus("error", "Erreur sauvegarde");
    throw err;
  }
}

/**
 * Renvoie la section active ou null.
 */
export function activeSection() {
  if (!state.activeSectionId || !state.manifeste) return null;
  return (
    state.manifeste.data.sections.find((s) => s.id === state.activeSectionId) ||
    null
  );
}

/**
 * Helpers UID / dates.
 */
export const uid = (prefix) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const now = () => new Date().toISOString();

/**
 * Tri hiérarchique des sections : H1 → ses H2 → leurs H3 → H1 suivant…
 * Basé sur parent_id + ordre. Renvoie un nouveau tableau aplati.
 */
export function sortHierarchically(sections) {
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
