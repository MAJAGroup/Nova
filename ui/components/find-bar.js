import { el } from "../lib/dom.js";

export function createFindBar({ browser, tabs }) {
  const bar = el("find-bar");
  const input = el("find-input");
  const count = el("find-count");
  let term = "";

  function update(query, options = {}) {
    term = String(query || "");
    count.textContent = "";
    if (!term.trim()) { void browser.stopFind(); return; }
    void browser.findPage(term, options);
  }
  function open() {
    bar.hidden = false;
    input.focus();
    input.select();
    if (input.value.trim()) update(input.value, { findNext: true });
  }
  function close({ restoreFocus = true } = {}) {
    if (bar.hidden) return;
    bar.hidden = true;
    void browser.stopFind();
    count.textContent = "";
    input.blur();
    if (restoreFocus) void browser.focusPage();
  }
  function next(forward = true) {
    if (bar.hidden) open();
    if (input.value.trim()) update(input.value, { forward, findNext: false });
    else input.focus();
  }

  input.addEventListener("input", () => update(input.value, { findNext: true }));
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); next(!event.shiftKey); }
    else if (event.key === "Escape") { event.preventDefault(); close(); }
  });
  el("find-next").addEventListener("click", () => next(true));
  el("find-previous").addEventListener("click", () => next(false));
  el("find-close").addEventListener("click", () => close());
  browser.onFindResult(result => {
    if (bar.hidden) return;
    const matches = Number(result.matches) || 0;
    const active = Number(result.activeMatchOrdinal) || 0;
    count.textContent = matches ? `${active} of ${matches}` : (term.trim() ? "No matches" : "");
  });
  let previousActiveId;
  tabs?.subscribe(store => {
    if (previousActiveId !== undefined && String(previousActiveId) !== String(store.activeId)) {
      if (!bar.hidden) close({ restoreFocus: false });
      input.value = ""; term = ""; count.textContent = "";
    }
    previousActiveId = store.activeId;
  });

  return { open, close, next, isOpen: () => !bar.hidden };
}
