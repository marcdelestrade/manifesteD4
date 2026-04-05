/* =========================================================================
   ui.js — Système de toasts + modals custom (remplace alert/confirm/prompt)
   ========================================================================= */

// Conteneurs créés paresseusement
let toastContainer = null;
let modalBackdrop = null;

function ensureToastContainer() {
  if (toastContainer) return toastContainer;
  toastContainer = document.createElement("div");
  toastContainer.className = "toast-container";
  document.body.appendChild(toastContainer);
  return toastContainer;
}

/**
 * Affiche un toast. kind: 'info' | 'success' | 'error' | 'warn'
 * duration en ms (0 = persistant, click pour fermer)
 */
export function toast(message, kind = "info", duration = 3500) {
  const root = ensureToastContainer();
  const t = document.createElement("div");
  t.className = `toast toast-${kind}`;
  t.textContent = message;
  t.addEventListener("click", () => dismiss());
  root.appendChild(t);
  // Animation entrée
  requestAnimationFrame(() => t.classList.add("visible"));
  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    t.classList.remove("visible");
    setTimeout(() => t.remove(), 200);
  };
  if (duration > 0) timer = setTimeout(dismiss, duration);
  return dismiss;
}

// =========================================================================
// MODALS
// =========================================================================
function ensureBackdrop() {
  if (modalBackdrop) return modalBackdrop;
  modalBackdrop = document.createElement("div");
  modalBackdrop.className = "modal-backdrop";
  document.body.appendChild(modalBackdrop);
  return modalBackdrop;
}

function openModal({ title, body, buttons }) {
  return new Promise((resolve) => {
    const backdrop = ensureBackdrop();
    backdrop.innerHTML = "";
    backdrop.classList.add("visible");

    const modal = document.createElement("div");
    modal.className = "modal";

    if (title) {
      const h = document.createElement("div");
      h.className = "modal-title";
      h.textContent = title;
      modal.appendChild(h);
    }

    const bodyEl = document.createElement("div");
    bodyEl.className = "modal-body";
    if (typeof body === "string") bodyEl.textContent = body;
    else bodyEl.appendChild(body);
    modal.appendChild(bodyEl);

    const footer = document.createElement("div");
    footer.className = "modal-footer";
    for (const btn of buttons) {
      const b = document.createElement("button");
      b.className = btn.primary ? "btn-primary" : "btn-secondary";
      b.textContent = btn.label;
      b.addEventListener("click", () => {
        close();
        resolve(btn.value !== undefined ? btn.value : btn.handler?.());
      });
      footer.appendChild(b);
    }
    modal.appendChild(footer);
    backdrop.appendChild(modal);

    const onKey = (e) => {
      if (e.key === "Escape") {
        close();
        resolve(null);
      }
    };
    const onClickOutside = (e) => {
      if (e.target === backdrop) {
        close();
        resolve(null);
      }
    };
    const close = () => {
      document.removeEventListener("keydown", onKey);
      backdrop.removeEventListener("click", onClickOutside);
      backdrop.classList.remove("visible");
      backdrop.innerHTML = "";
    };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", onClickOutside);

    // Focus premier input ou bouton primaire
    setTimeout(() => {
      const input = modal.querySelector("input, textarea, select");
      if (input) input.focus();
      else modal.querySelector(".btn-primary")?.focus();
    }, 20);
  });
}

/**
 * Confirmation simple. Renvoie true/false.
 */
export function confirmDialog(message, { title = "Confirmer", okLabel = "OK", cancelLabel = "Annuler", danger = false } = {}) {
  const buttons = [];
  if (cancelLabel) buttons.push({ label: cancelLabel, value: false });
  buttons.push({ label: okLabel, primary: true, value: true, danger });
  return openModal({ title, body: message, buttons });
}

/**
 * Prompt texte simple. Renvoie la valeur ou null.
 */
export function promptDialog(label, { title = "Saisir", defaultValue = "", placeholder = "", multiline = false, okLabel = "OK" } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "form-field";
  if (label) {
    const l = document.createElement("label");
    l.textContent = label;
    wrap.appendChild(l);
  }
  const input = multiline
    ? document.createElement("textarea")
    : document.createElement("input");
  if (!multiline) input.type = "text";
  input.value = defaultValue;
  input.placeholder = placeholder;
  if (multiline) input.rows = 4;
  wrap.appendChild(input);
  input.addEventListener("keydown", (e) => {
    if (!multiline && e.key === "Enter") {
      e.preventDefault();
      input.closest(".modal").querySelector(".btn-primary").click();
    }
  });
  return openModal({
    title,
    body: wrap,
    buttons: [
      { label: "Annuler", value: null },
      {
        label: okLabel,
        primary: true,
        handler: () => input.value.trim() || null,
      },
    ],
  });
}

/**
 * Formulaire multi-champs. fields = [{ name, label, type, value, options?, placeholder?, multiline? }]
 * Renvoie un objet {name: value} ou null.
 */
export function formDialog({ title, fields, okLabel = "Valider" }) {
  const wrap = document.createElement("div");
  wrap.className = "form-fields";
  const inputs = {};
  for (const f of fields) {
    const field = document.createElement("div");
    field.className = "form-field";
    const l = document.createElement("label");
    l.textContent = f.label;
    field.appendChild(l);
    let input;
    if (f.type === "select") {
      input = document.createElement("select");
      for (const opt of f.options) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === f.value) o.selected = true;
        input.appendChild(o);
      }
    } else if (f.multiline) {
      input = document.createElement("textarea");
      input.rows = f.rows || 3;
      input.value = f.value || "";
      input.placeholder = f.placeholder || "";
    } else {
      input = document.createElement("input");
      input.type = f.type || "text";
      input.value = f.value || "";
      input.placeholder = f.placeholder || "";
    }
    field.appendChild(input);
    wrap.appendChild(field);
    inputs[f.name] = input;
  }
  return openModal({
    title,
    body: wrap,
    buttons: [
      { label: "Annuler", value: null },
      {
        label: okLabel,
        primary: true,
        handler: () => {
          const out = {};
          for (const k in inputs) out[k] = inputs[k].value.trim();
          return out;
        },
      },
    ],
  });
}

/**
 * Menu d'actions (liste de boutons cliquables).
 * actions = [{ label, value, danger? }]
 */
export function actionMenu({ title, actions }) {
  const wrap = document.createElement("div");
  wrap.className = "action-menu";
  return new Promise((resolve) => {
    const backdrop = ensureBackdrop();
    backdrop.innerHTML = "";
    backdrop.classList.add("visible");
    const modal = document.createElement("div");
    modal.className = "modal modal-menu";
    if (title) {
      const h = document.createElement("div");
      h.className = "modal-title";
      h.textContent = title;
      modal.appendChild(h);
    }
    for (const a of actions) {
      const b = document.createElement("button");
      b.className = `action-item${a.danger ? " danger" : ""}`;
      b.textContent = a.label;
      b.addEventListener("click", () => {
        close();
        resolve(a.value);
      });
      wrap.appendChild(b);
    }
    modal.appendChild(wrap);
    backdrop.appendChild(modal);

    const onKey = (e) => {
      if (e.key === "Escape") {
        close();
        resolve(null);
      }
    };
    const onClick = (e) => {
      if (e.target === backdrop) {
        close();
        resolve(null);
      }
    };
    const close = () => {
      document.removeEventListener("keydown", onKey);
      backdrop.removeEventListener("click", onClick);
      backdrop.classList.remove("visible");
      backdrop.innerHTML = "";
    };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", onClick);
  });
}
