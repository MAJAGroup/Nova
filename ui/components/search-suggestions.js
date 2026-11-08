// Shared combobox interaction for the toolbar and the local new-tab search.
export function createSearchSuggestions({ input, popup, requestLocal, requestWeb, cancelRequests = () => {}, onCommit, onEscape, onVisibilityChange = () => {} }) {
  let items = [], local = [], remote = [], selected = -1, typed = input.value;
  let timer = 0, generation = 0, shown = false, composing = false;
  input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", popup.id); input.setAttribute("aria-expanded", "false");
  popup.setAttribute("role", "listbox"); popup.setAttribute("aria-label", "Search suggestions");
  function visible(open) {
    popup.hidden = !open; input.setAttribute("aria-expanded", String(open));
    if (open !== shown) { shown = open; onVisibilityChange(open); }
  }
  function close({ restore = false } = {}) {
    generation++; clearTimeout(timer); cancelRequests();
    if (restore) { input.value = typed; input.dispatchEvent(new Event("suggestion-preview")); }
    selected = -1; items = []; popup.replaceChildren(); input.removeAttribute("aria-activedescendant"); visible(false);
  }
  function choose(item, event) { if (!item) return; close(); onCommit(item, event); }
  function render() {
    const previousKey = items[selected]?.key;
    const seen = new Set();
    items = [...local, ...remote].filter(item => {
      if (!item || !["url", "tab", "search"].includes(item.kind) || typeof item.label !== "string" || typeof item.value !== "string") return false;
      const key = `${item.kind === "tab" ? "url" : item.kind}:${item.kind === "search" ? item.value.toLowerCase() : item.value}`;
      if (seen.has(key)) return false; seen.add(key); return true;
    }).slice(0, 9);
    selected = previousKey ? items.findIndex(item => item.key === previousKey) : -1;
    popup.replaceChildren();
    items.forEach((item, index) => {
      const option = document.createElement("button"); option.type = "button"; option.tabIndex = -1;
      option.className = "search-suggestion"; option.id = `${popup.id}-option-${index}`; option.setAttribute("role", "option");
      option.dataset.kind = item.kind; option.dataset.source = item.source;
      const mark = document.createElement("span"); mark.className = "search-suggestion-icon"; mark.setAttribute("aria-hidden", "true");
      mark.textContent = item.kind === "tab" ? "▣" : item.source === "bookmark" ? "☆" : item.source === "history" ? "◷" : item.kind === "url" ? "↗" : "⌕";
      const copy = document.createElement("span"); copy.className = "search-suggestion-copy";
      const label = document.createElement("span"); label.className = "search-suggestion-title"; label.textContent = item.label;
      const description = document.createElement("span"); description.className = "search-suggestion-description"; description.textContent = item.description || "";
      copy.append(label, description);
      const source = document.createElement("span"); source.className = "search-suggestion-source";
      source.textContent = item.kind === "tab" ? "Switch to tab" : item.source === "bookmark" ? "Bookmark" : item.source === "history" ? "History" : item.source === "google" ? "Google" : item.kind === "url" ? "Visit" : "Search";
      option.append(mark, copy, source);
      option.addEventListener("pointerdown", event => { if (event.button === 0) event.preventDefault(); });
      option.addEventListener("click", () => choose(item));
      popup.append(option);
    });
    highlight(); visible(items.length > 0 && document.activeElement === input);
  }
  function highlight() {
    [...popup.children].forEach((option, index) => option.setAttribute("aria-selected", String(index === selected)));
    if (selected >= 0) input.setAttribute("aria-activedescendant", `${popup.id}-option-${selected}`);
    else input.removeAttribute("aria-activedescendant");
  }
  function refresh() {
    if (composing || document.activeElement !== input) return;
    const version = ++generation, query = input.value;
    typed = query; selected = -1; local = []; remote = []; clearTimeout(timer); cancelRequests();
    // Discard old rows immediately so Enter cannot accept a previous query.
    items = []; popup.replaceChildren(); input.removeAttribute("aria-activedescendant");
    Promise.resolve().then(() => requestLocal(query)).then(rows => {
      if (generation !== version || document.activeElement !== input) return;
      local = Array.isArray(rows) ? rows : []; render();
    }).catch(() => { if (generation === version) { local = []; render(); } });
    if (query.trim().length >= 2) timer = setTimeout(() => {
      Promise.resolve().then(() => requestWeb(query)).then(rows => {
        if (generation !== version || document.activeElement !== input) return;
        remote = Array.isArray(rows) ? rows : []; render();
      }).catch(() => {});
    }, 180);
    else render();
  }
  input.addEventListener("input", refresh);
  input.addEventListener("focus", () => { typed = input.value; refresh(); });
  input.addEventListener("blur", () => close());
  input.addEventListener("compositionstart", () => { composing = true; close(); });
  input.addEventListener("compositionend", () => { composing = false; refresh(); });
  input.addEventListener("keydown", event => {
    if (composing || event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!items.length) { refresh(); return; }
      event.preventDefault(); event.stopImmediatePropagation();
      selected = event.key === "ArrowDown" ? (selected + 1) % items.length : (selected < 0 ? items.length - 1 : (selected - 1 + items.length) % items.length);
      input.value = items[selected].value; input.dispatchEvent(new Event("suggestion-preview")); highlight(); visible(true);
      popup.children[selected]?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && shown && (selected >= 0 || typed.trim())) {
      event.preventDefault(); event.stopImmediatePropagation(); choose(items[selected >= 0 ? selected : 0], event);
    } else if (event.key === "Escape" && shown) {
      event.preventDefault(); event.stopImmediatePropagation(); close({ restore: true }); onEscape?.();
    } else if (event.key === "Tab") close();
  });
  document.addEventListener("pointerdown", event => { if (event.target !== input && !popup.contains(event.target)) close(); }, true);
  document.addEventListener("visibilitychange", () => { if (document.hidden) close(); });
  return { close, refresh, isOpen: () => shown };
}
