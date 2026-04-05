/* =========================================================================
   editor.js — Éditeur markdown split-view
   Gère textarea ↔ rendu live + actions de la toolbar.
   ========================================================================= */

/**
 * Initialise l'éditeur. Renvoie un contrôleur avec setValue / getValue / onChange.
 */
export function createEditor({ textarea, preview, toolbar, onChange, getHeader }) {
  const renderNow = () => {
    const headerHtml = getHeader ? getHeader() : "";
    preview.innerHTML = headerHtml + window.marked.parse(textarea.value || "", { breaks: true });
  };

  // RAF-coalesce : plafonne le rendu à ~60fps même en frappe rapide
  let rafPending = null;
  const scheduleRender = () => {
    if (rafPending !== null) return;
    rafPending = requestAnimationFrame(() => {
      rafPending = null;
      renderNow();
    });
  };

  // Rendu initial immédiat (pas de flash)
  renderNow();

  textarea.addEventListener("input", () => {
    scheduleRender();
    if (onChange) onChange(textarea.value);
  });

  // Toolbar — insertions markdown simples
  const wrap = (prefix, suffix = prefix) => {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    textarea.value = before + prefix + selected + suffix + after;
    const cursor = start + prefix.length + selected.length;
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
    textarea.dispatchEvent(new Event("input"));
  };

  const insertLinePrefix = (prefix) => {
    const start = textarea.selectionStart;
    const value = textarea.value;
    // Remonter au début de la ligne courante
    let lineStart = start;
    while (lineStart > 0 && value[lineStart - 1] !== "\n") lineStart--;
    textarea.value = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    const cursor = start + prefix.length;
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
    textarea.dispatchEvent(new Event("input"));
  };

  const insertAtCursor = (text) => {
    const start = textarea.selectionStart;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(textarea.selectionEnd);
    textarea.value = before + text + after;
    const cursor = start + text.length;
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
    textarea.dispatchEvent(new Event("input"));
  };

  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-md]");
    if (!btn) return;
    const action = btn.dataset.md;
    switch (action) {
      case "bold":
        wrap("**");
        break;
      case "italic":
        wrap("*");
        break;
      case "h2":
        insertLinePrefix("## ");
        break;
      case "h3":
        insertLinePrefix("### ");
        break;
      case "list":
        insertLinePrefix("- ");
        break;
      case "quote":
        insertLinePrefix("> ");
        break;
      case "hr":
        insertAtCursor("\n\n---\n\n");
        break;
    }
  });

  return {
    setValue(v) {
      textarea.value = v || "";
      renderNow();
    },
    getValue() {
      return textarea.value;
    },
  };
}
