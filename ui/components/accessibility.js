import { el } from "../lib/dom.js";

const STORAGE_KEY = "orbit.accessibility";

export function createAccessibility({ browserView, cosmos }) {
  const modal = el("accessibility-modal");
  const motion = el("reduced-motion-toggle");
  const contrast = el("high-contrast-toggle");
  const scale = el("text-scale");
  const focusButton = el("focus-mode");
  const systemReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let preferences = { reducedMotion: systemReducedMotion, highContrast: false, textScale: "1", focusMode: false };
  let returnFocus = null;

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (stored && typeof stored === "object") preferences = { ...preferences, ...stored };
  } catch (_) {}
  if (!["1", "1.15", "1.3"].includes(String(preferences.textScale))) preferences.textScale = "1";

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch (_) {}
  }

  function apply() {
    document.body.classList.toggle("reduced-motion", Boolean(preferences.reducedMotion));
    document.body.classList.toggle("high-contrast", Boolean(preferences.highContrast));
    document.body.classList.toggle("focus-mode", Boolean(preferences.focusMode));
    document.body.dataset.textScale = String(preferences.textScale);
    motion.checked = Boolean(preferences.reducedMotion);
    contrast.checked = Boolean(preferences.highContrast);
    scale.value = String(preferences.textScale);
    focusButton.setAttribute("aria-pressed", String(Boolean(preferences.focusMode)));
    cosmos.setReducedMotion(Boolean(preferences.reducedMotion));
  }

  function open() {
    if (!modal.hidden) return;
    returnFocus = document.activeElement;
    modal.hidden = false;
    browserView.cover("accessibility", true);
    setTimeout(() => motion.focus(), 30);
  }

  function close() {
    if (modal.hidden) return;
    modal.hidden = true;
    browserView.cover("accessibility", false);
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  }

  el("accessibility-open").addEventListener("click", open);
  el("accessibility-close").addEventListener("click", close);
  focusButton.addEventListener("click", () => {
    preferences.focusMode = !preferences.focusMode;
    save();
    apply();
  });
  motion.addEventListener("change", () => { preferences.reducedMotion = motion.checked; save(); apply(); });
  contrast.addEventListener("change", () => { preferences.highContrast = contrast.checked; save(); apply(); });
  scale.addEventListener("change", () => { preferences.textScale = scale.value; save(); apply(); });
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const items = [...modal.querySelectorAll("button:not([disabled]),input:not([disabled]),select:not([disabled])")];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  apply();
  return {
    open,
    close,
    isOpen: () => !modal.hidden,
    toggleFocusMode() {
      preferences.focusMode = !preferences.focusMode;
      save();
      apply();
    }
  };
}
