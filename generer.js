/* =========================================================================
   generer.js — Onglet Générer : contenu dérivé via Anthropic
   ========================================================================= */

import { state, activeSection } from "./store.js?v=1775413327";
import { streamMessage } from "./anthropic.js?v=1775413327";
import { toast } from "./ui.js?v=1775413327";

const PROMPTS = {
  guide: (s, p) =>
    `À partir de la section « ${s.titre} » du manifeste D4, rédige un **guide pratique** à destination des collaborateurs D4. Structure : objectif, points clés, étapes concrètes, pièges à éviter. Ton direct, actionnable. ${p ? "Précision : " + p : ""}`,
  faq: (s, p) =>
    `À partir de la section « ${s.titre} » du manifeste D4, rédige une **FAQ** (8-12 questions) pour des clients (copropriétaires, conseils syndicaux) et le pôle client service. Questions réelles et réponses claires, ton professionnel et accessible. ${p ? "Précision : " + p : ""}`,
  html: (s, p) =>
    `À partir de la section « ${s.titre} » du manifeste D4, rédige une **page HTML autonome** (doctype, head, body, CSS inline minimal) pour le site d4immobilier.fr. Design sobre, pro, responsive. Contenu en français. ${p ? "Précision : " + p : ""}`,
  resume: (s, p) =>
    `À partir de la section « ${s.titre} » du manifeste D4, produis un **résumé exécutif** d'une page maximum : enjeu, position, engagements, impacts concrets. Ton synthétique et décidé. ${p ? "Précision : " + p : ""}`,
  formation: (s, p) =>
    `À partir de la section « ${s.titre} » du manifeste D4, produis une liste de **points de formation** (bullet points pédagogiques) pour un nouveau collaborateur : à retenir, à comprendre, à savoir faire. ${p ? "Précision : " + p : ""}`,
};

let el = {};
let isGenerating = false;

export function initGenerer() {
  el = {
    type: document.querySelector("#generer-type"),
    precisions: document.querySelector("#generer-precisions"),
    btn: document.querySelector("#btn-generer"),
    result: document.querySelector("#generer-result"),
    actions: document.querySelector("#generer-actions"),
    copy: document.querySelector("#btn-copy"),
    dlMd: document.querySelector("#btn-dl-md"),
    dlHtml: document.querySelector("#btn-dl-html"),
  };
  el.btn.addEventListener("click", onGenerate);
  el.copy.addEventListener("click", () => copyResult());
  el.dlMd.addEventListener("click", () => download("md"));
  el.dlHtml.addEventListener("click", () => download("html"));
}

let lastResult = "";
let lastType = "guide";

async function onGenerate() {
  if (isGenerating) return;
  const section = activeSection();
  if (!section) {
    toast("Sélectionne d'abord une section.", "warn");
    return;
  }
  if (!state.cfg.anthropicKey) {
    toast("Clé API Anthropic manquante.", "warn");
    return;
  }

  const type = el.type.value;
  const precisions = el.precisions.value.trim();
  lastType = type;

  const prompt = PROMPTS[type](section, precisions);
  const userMessage = `${prompt}\n\n---\nContenu de la section :\n\n${section.contenu}`;

  isGenerating = true;
  el.btn.disabled = true;
  el.btn.textContent = "Génération…";
  el.result.innerHTML = "";
  el.actions.classList.add("hidden");
  lastResult = "";

  try {
    await streamMessage({
      apiKey: state.cfg.anthropicKey,
      system:
        "Tu aides Marc Delestrade, fondateur de D4 Immobilier, à produire du contenu dérivé depuis son manifeste stratégique. Ton direct, structuré, en français.",
      messages: [{ role: "user", content: userMessage }],
      maxTokens: 4096,
      onDelta: (_d, full) => {
        lastResult = full;
        el.result.innerHTML = window.marked.parse(full, { breaks: true });
      },
    });
    el.actions.classList.remove("hidden");
  } catch (err) {
    el.result.innerHTML = `<p style="color:var(--c-a-revoir)">Erreur : ${err.message}</p>`;
  } finally {
    isGenerating = false;
    el.btn.disabled = false;
    el.btn.textContent = "Générer";
  }
}

function copyResult() {
  navigator.clipboard.writeText(lastResult).then(() => {
    el.copy.textContent = "Copié ✓";
    setTimeout(() => (el.copy.textContent = "Copier"), 1500);
  });
}

function download(format) {
  const section = activeSection();
  const slug = section?.id || "manifeste";
  let blob, filename;
  if (format === "md") {
    blob = new Blob([lastResult], { type: "text/markdown;charset=utf-8" });
    filename = `${slug}-${lastType}.md`;
  } else {
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${section?.titre || "D4"}</title>
<style>
body { font-family: -apple-system, "Segoe UI", sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a18; line-height: 1.6; }
h1, h2, h3 { color: #1D9E75; }
blockquote { border-left: 3px solid #1D9E75; padding: 8px 14px; background: #f8f8f6; color: #6b6b68; }
code { background: #f0f0ed; padding: 1px 5px; border-radius: 3px; }
</style>
</head>
<body>
${window.marked.parse(lastResult, { breaks: true })}
</body>
</html>`;
    blob = new Blob([html], { type: "text/html;charset=utf-8" });
    filename = `${slug}-${lastType}.html`;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
