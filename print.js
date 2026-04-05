/* =========================================================================
   print.js — Génération d'une vue imprimable du manifeste complet
   Ouvre une nouvelle fenêtre avec le doc entier, prête à « Enregistrer en PDF ».
   ========================================================================= */

import { state, sortHierarchically } from "./store.js?v=1775413103";
import { toast } from "./ui.js?v=1775413103";

/**
 * Point d'entrée : ouvre la fenêtre d'impression.
 */
export function openPrintView() {
  if (!state.manifeste?.data?.sections?.length) {
    toast("Manifeste vide.", "warn");
    return;
  }
  const html = buildPrintHTML();
  const win = window.open("", "_blank");
  if (!win) {
    toast("Autorise les pop-ups pour imprimer.", "error", 5000);
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  // Déclencher l'impression une fois la fenêtre chargée
  win.addEventListener("load", () => {
    setTimeout(() => win.print(), 250);
  });
}

/**
 * Construit le document HTML complet prêt à imprimer.
 */
function buildPrintHTML() {
  // Tri hiérarchique des sections (non archivées)
  const sections = sortHierarchically(
    state.manifeste.data.sections.filter((s) => !s.archive)
  );

  // Date de génération
  const now = new Date();
  const dateStr = now.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Tagline depuis le contexte général mémoire (première phrase)
  const memoire = state.memoire?.data;
  const tagline =
    memoire?.contexte_general?.split(".").slice(0, 2).join(".") + "." ||
    "Manifeste stratégique et opérationnel";

  // Extraire l'ambition si présente
  const ambitionSection = sections.find(
    (s) =>
      s.titre.toLowerCase().includes("ambition") ||
      s.id === "notre-ambition-gagner-pas-juste-jouer"
  );
  const ambition = extractFirstQuote(ambitionSection?.contenu) || "";

  // TOC : uniquement H1 et H2
  const tocItems = sections
    .filter((s) => s.niveau <= 2)
    .map(
      (s) =>
        `<li class="toc-${s.niveau}"><a href="#s-${s.id}"><span class="toc-text">${escapeHtml(s.titre)}</span><span class="toc-dots"></span></a></li>`
    )
    .join("\n");

  // Contenu — chaque H1 démarre sur une nouvelle page
  const content = sections
    .map((s) => {
      const level = Math.min(3, Math.max(1, s.niveau));
      const tag = `h${level}`;
      const htmlContent = window.marked.parse(s.contenu || "", { breaks: true });
      const pageBreak = s.niveau === 1 ? " page-break" : "";
      return `<section id="s-${s.id}" class="sec sec-n${level}${pageBreak}">
  <${tag} class="sec-title">${escapeHtml(s.titre)}</${tag}>
  <div class="sec-body">${htmlContent}</div>
</section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Le Manifeste D4</title>
<style>${PRINT_CSS}</style>
</head>
<body>
  <!-- Page de garde -->
  <section class="cover">
    <div class="cover-logo">D4</div>
    <div class="cover-brand">D4 Immobilier</div>
    <h1 class="cover-title">Le Manifeste</h1>
    <p class="cover-tagline">${escapeHtml(tagline)}</p>
    ${ambition ? `<blockquote class="cover-ambition">${escapeHtml(ambition)}</blockquote>` : ""}
    <div class="cover-footer">
      <div class="cover-date">${dateStr}</div>
      <div class="cover-version">Version vivante — document de référence interne</div>
    </div>
  </section>

  <!-- Table des matières -->
  <section class="toc-page">
    <h1 class="toc-title">Sommaire</h1>
    <ul class="toc-list">
${tocItems}
    </ul>
  </section>

  <!-- Contenu -->
  <main class="content">
${content}
  </main>

  <!-- Bandeau d'action (visible à l'écran uniquement) -->
  <div class="print-bar">
    <button onclick="window.print()">Imprimer / Enregistrer en PDF</button>
    <button onclick="window.close()" class="secondary">Fermer</button>
  </div>
</body>
</html>`;
}

// =========================================================================
// HELPERS
// =========================================================================
function extractFirstQuote(md) {
  if (!md) return "";
  // Chercher une ligne blockquote > "..."
  const m = md.match(/^>\s*\*?\*?(.+?)\*?\*?$/m);
  return m ? m[1].trim() : "";
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// =========================================================================
// CSS PRINT — intégré dans le <head> de la fenêtre d'impression
// =========================================================================
const PRINT_CSS = `
/* ===== Base ===== */
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #1a1a18;
  background: #f5f5f2;
  line-height: 1.6;
  font-size: 11pt;
}
body { padding: 40px 0; }

/* ===== Chaque "page" à l'écran ===== */
.cover, .toc-page, .content > .sec {
  background: white;
  max-width: 18cm;
  margin: 0 auto 14px;
  padding: 2.2cm 2.4cm;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  border-radius: 2px;
}

/* ===== Page de garde ===== */
.cover {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  min-height: 24cm;
  padding: 3.5cm 2.4cm;
}
.cover-logo {
  width: 64px;
  height: 64px;
  background: #1D9E75;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 28px;
  border-radius: 6px;
  letter-spacing: -1px;
}
.cover-brand {
  margin-top: 16px;
  font-size: 13pt;
  font-weight: 600;
  color: #1D9E75;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.cover-title {
  margin-top: 3.5cm;
  font-size: 48pt;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -2px;
}
.cover-tagline {
  margin-top: 10px;
  font-size: 14pt;
  color: #6b6b68;
  font-style: italic;
  max-width: 14cm;
}
.cover-ambition {
  margin-top: 3cm;
  padding: 18px 22px;
  border-left: 4px solid #1D9E75;
  background: #f8f8f6;
  font-size: 13pt;
  line-height: 1.45;
  color: #1a1a18;
  font-weight: 500;
  max-width: 14cm;
}
.cover-footer {
  margin-top: auto;
  padding-top: 3cm;
  font-size: 10pt;
  color: #6b6b68;
}
.cover-date {
  font-weight: 600;
  color: #1a1a18;
  font-size: 11pt;
}
.cover-version {
  margin-top: 4px;
  font-style: italic;
}

/* ===== Table des matières ===== */
.toc-page { min-height: 24cm; }
.toc-title {
  font-size: 22pt;
  font-weight: 700;
  color: #1D9E75;
  margin-bottom: 24px;
  padding-bottom: 12px;
  border-bottom: 2px solid #1D9E75;
}
.toc-list { list-style: none; }
.toc-list li { margin: 0; }
.toc-list a {
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: #1a1a18;
  text-decoration: none;
  padding: 3px 0;
}
.toc-text { flex-shrink: 0; }
.toc-dots {
  flex: 1;
  border-bottom: 1px dotted #c8c8c2;
  margin-bottom: 4px;
}
.toc-list .toc-1 { margin-top: 14px; }
.toc-list .toc-1 > a {
  font-weight: 600;
  font-size: 12pt;
  color: #1a1a18;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.toc-list .toc-1:first-child { margin-top: 0; }
.toc-list .toc-2 { padding-left: 14px; }
.toc-list .toc-2 > a {
  font-size: 10.5pt;
  color: #48483f;
}

/* ===== Sections de contenu ===== */
.content { }
.sec { min-height: 1cm; }
.sec-title {
  color: #1D9E75;
  line-height: 1.25;
  margin-bottom: 12px;
}
.sec-n1 .sec-title {
  font-size: 26pt;
  font-weight: 700;
  padding-bottom: 10px;
  border-bottom: 2px solid #1D9E75;
  margin-bottom: 18px;
  letter-spacing: -0.5px;
}
.sec-n2 .sec-title {
  font-size: 17pt;
  font-weight: 600;
  margin-top: 0;
  color: #1a1a18;
  border-left: 3px solid #1D9E75;
  padding-left: 12px;
}
.sec-n3 .sec-title {
  font-size: 13pt;
  font-weight: 600;
  color: #48483f;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

/* Corps markdown */
.sec-body p { margin: 0.7em 0; }
.sec-body h1, .sec-body h2, .sec-body h3, .sec-body h4 {
  margin: 1.2em 0 0.4em;
  color: #1a1a18;
}
.sec-body h1 { font-size: 14pt; }
.sec-body h2 { font-size: 12.5pt; }
.sec-body h3 { font-size: 11.5pt; text-transform: none; color: #48483f; }
.sec-body ul, .sec-body ol { margin: 0.6em 0 0.6em 20px; }
.sec-body li { margin: 0.25em 0; }
.sec-body blockquote {
  margin: 1em 0;
  padding: 10px 16px;
  background: #f5f5f2;
  border-left: 3px solid #1D9E75;
  font-style: italic;
  color: #48483f;
  font-size: 10.5pt;
}
.sec-body blockquote strong { color: #1a1a18; font-style: normal; }
.sec-body strong { font-weight: 600; color: #1a1a18; }
.sec-body em { font-style: italic; color: #48483f; }
.sec-body code {
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 10pt;
  background: #f0f0ed;
  padding: 1px 5px;
  border-radius: 3px;
}
.sec-body hr {
  border: none;
  border-top: 1px solid #e0e0db;
  margin: 1.4em 0;
}
.sec-body table {
  border-collapse: collapse;
  margin: 1em 0;
  font-size: 10pt;
  width: auto;
  max-width: 100%;
}
.sec-body th, .sec-body td {
  border: 1px solid #c8c8c2;
  padding: 5px 9px;
  text-align: left;
  vertical-align: top;
}
.sec-body th { background: #f5f5f2; font-weight: 600; color: #1a1a18; }
.sec-body tr:nth-child(even) td { background: #fafaf7; }
.sec-body a { color: #1D9E75; }

/* ===== Barre d'action (écran uniquement) ===== */
.print-bar {
  position: fixed;
  bottom: 20px;
  right: 20px;
  display: flex;
  gap: 8px;
  padding: 10px 14px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  z-index: 100;
}
.print-bar button {
  padding: 8px 14px;
  border: none;
  border-radius: 5px;
  font: inherit;
  font-weight: 500;
  font-size: 12pt;
  background: #1D9E75;
  color: white;
  cursor: pointer;
}
.print-bar button:hover { background: #17805f; }
.print-bar button.secondary {
  background: #f0f0ed;
  color: #1a1a18;
}
.print-bar button.secondary:hover { background: #e0e0db; }

/* =========================================================================
   IMPRESSION
   ========================================================================= */
@page {
  size: A4;
  margin: 2cm 2.2cm 2.4cm;
  @bottom-center {
    content: counter(page);
    font-family: "Inter", sans-serif;
    font-size: 9pt;
    color: #9c9c99;
  }
}
@page :first { @bottom-center { content: ""; } }

@media print {
  html, body {
    background: white;
    padding: 0;
    font-size: 10.5pt;
  }
  .cover, .toc-page, .content > .sec {
    max-width: none;
    margin: 0;
    padding: 0;
    box-shadow: none;
    border-radius: 0;
    background: white;
  }
  .cover { min-height: auto; page-break-after: always; }
  .toc-page { page-break-after: always; min-height: auto; }
  .sec.page-break { page-break-before: always; }
  .sec-title, .toc-title, .cover-title { page-break-after: avoid; }
  .sec-body p, .sec-body li, .sec-body blockquote { page-break-inside: avoid; }
  a { color: #1a1a18 !important; text-decoration: none; }
  .print-bar { display: none !important; }
  .cover-title { font-size: 42pt; }
  .cover-ambition { margin-top: 2cm; }
}
`;
