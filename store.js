/* =========================================================================
   store.js — État partagé + helpers de sauvegarde GitHub
   Importé par tous les modules feature.
   ========================================================================= */

import * as gh from "./github.js?v=1775398045";

export const state = {
  cfg: null, // { owner, repo, token, anthropicKey }
  manifeste: null, // { data: { sections: [] }, sha }
  taches: null, // { data: { taches: [] }, sha }
  projets: null, // { data: { projets: [] }, sha }
  memoire: null, // { data: {...}, sha }
  activeSectionId: null,
  aiMessages: [], // conversation courante (reset à chaque changement de section)
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
