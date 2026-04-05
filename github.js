/* =========================================================================
   github.js — Module API GitHub REST
   Lecture/écriture des fichiers JSON dans le repo privé manifesteD4-data.
   ========================================================================= */

const API = "https://api.github.com";

// ---- Encodage UTF-8 safe base64 (nécessaire pour les caractères accentués)
const utf8ToBase64 = (str) => {
  // btoa ne gère que du latin1 — on passe par TextEncoder
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

const base64ToUtf8 = (b64) => {
  // GitHub renvoie parfois du base64 avec des \n — on les retire
  const clean = b64.replace(/\s/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

/**
 * Teste la connexion GitHub et l'accès au repo.
 */
export async function testConnection(cfg) {
  const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}`, {
    headers: {
      Authorization: `token ${cfg.token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${res.status} : ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Lit un fichier JSON du repo. Renvoie { data, sha }.
 */
export async function readFile(cfg, path) {
  const res = await fetch(
    `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`,
    {
      headers: {
        Authorization: `token ${cfg.token}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );
  if (!res.ok) throw new Error(`GET ${path} : ${res.status}`);
  const json = await res.json();
  const content = base64ToUtf8(json.content);
  return { data: JSON.parse(content), sha: json.sha };
}

/**
 * Écrit un fichier JSON dans le repo. Nécessite le sha courant.
 * Renvoie le nouveau sha.
 */
export async function writeFile(cfg, path, data, sha, message) {
  const body = {
    message: message || `Update ${path} — ${new Date().toISOString()}`,
    content: utf8ToBase64(JSON.stringify(data, null, 2)),
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `token ${cfg.token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PUT ${path} : ${res.status} — ${err.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.content.sha;
}

/**
 * Charge les 4 fichiers de données en parallèle.
 * Renvoie { manifeste, taches, projets, memoire } avec data + sha chacun.
 */
export async function loadAllData(cfg) {
  const files = ["manifeste", "taches", "projets", "memoire"];
  const results = await Promise.all(
    files.map((name) => readFile(cfg, `data/${name}.json`))
  );
  const out = {};
  files.forEach((name, i) => {
    out[name] = results[i];
  });
  return out;
}
