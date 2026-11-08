import { el, escapeHTML } from "../lib/dom.js";
import { domainOf } from "../lib/url.js";

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");
const SWALLOW_MS = 760;

// A closed tab's button is lifted out of the strip and squeezed into a tiny
// black hole that opens at its centre; the hole flares and closes.
function swallow(button) {
  const rect = button.getBoundingClientRect();
  if (!rect.width || REDUCED_MOTION.matches) return;
  const ghost = document.createElement("div");
  ghost.className = "tab-swallow";
  ghost.style.cssText = "left:" + rect.left + "px;top:" + rect.top + "px;width:" + rect.width + "px;height:" + rect.height + "px";
  button.classList.add("tab-swallowed");
  button.style.pointerEvents = "none";
  const hole = document.createElement("div");
  hole.className = "tab-singularity";
  ghost.append(button, hole);
  document.body.appendChild(ghost);

  button.animate([
    { transform: "none", opacity: 1, filter: "none" },
    { offset: 0.35, transform: "scale(.72, .92) skewX(6deg)", opacity: 1, filter: "brightness(1.15)" },
    { offset: 0.75, transform: "scale(.12, .5) skewX(22deg)", opacity: 0.85, filter: "blur(.4px) brightness(1.8) sepia(.8) saturate(2)" },
    { transform: "scale(0, .15) skewX(30deg)", opacity: 0, filter: "blur(1px) brightness(3) sepia(1)" }
  ], { duration: SWALLOW_MS * 0.62, delay: SWALLOW_MS * 0.1, easing: "cubic-bezier(.6,0,.9,.5)", fill: "both" });
  hole.animate([
    { transform: "scale(0)", opacity: 0 },
    { offset: 0.2, transform: "scale(1)", opacity: 1 },
    { offset: 0.72, transform: "scale(1)", opacity: 1, filter: "none" },
    { offset: 0.82, transform: "scale(1.3)", opacity: 1, filter: "brightness(2.2)" },
    { transform: "scale(0)", opacity: 0, filter: "brightness(1)" }
  ], { duration: SWALLOW_MS, easing: "ease-in-out", fill: "forwards" }).finished.then(() => ghost.remove(), () => ghost.remove());
}

export function createTabStrip({ browser, tabs, onActivateCurrent = () => {} }) {
  const strip = el("browser-tabs");
  strip.setAttribute("role", "tablist");
  strip.setAttribute("aria-multiselectable", "true");
  let rendered = new Map();
  let shownActiveId = null;
  const selectedIds = new Set();
  let selectionAnchorId = null;
  let draggedId = null;
  let splitTarget = null;
  let hoveredId = null, focusedId = null, pendingTimer = 0, requestedId = null;
  const description = document.createElement("div");
  description.id = "tab-resource-description"; description.className = "tab-resource-description"; description.setAttribute("role", "tooltip");
  document.body.append(description);

  function dismiss(immediate = true) {
    clearTimeout(pendingTimer); requestedId = null;
    for (const button of rendered.values()) button.removeAttribute("aria-describedby");
    description.textContent = ""; browser.hideTabResources(immediate);
  }
  function inspect(id) {
    clearTimeout(pendingTimer);
    if (!id || requestedId === id) return;
    pendingTimer = setTimeout(() => {
      pendingTimer = 0;
      const button = rendered.get(id); if (!button?.isConnected) return;
      const rect = button.getBoundingClientRect(), bounds = strip.getBoundingClientRect();
      if (rect.right <= bounds.left || rect.left >= bounds.right) return;
      requestedId = id;
      browser.showTabResources(id, { x: Math.max(bounds.left, rect.left), y: rect.top, width: rect.width, height: rect.height });
    }, 350);
  }
  browser.onTabResourcesUpdated(data => {
    if (!data.visible) {
      for (const button of rendered.values()) button.removeAttribute("aria-describedby");
      description.textContent = ""; requestedId = null; return;
    }
    if (data.id !== requestedId) return;
    const memory = Number.isFinite(data.memoryBytes) ? `${(data.memoryBytes / 1048576).toFixed(1)} MB` : "unavailable";
    const cpu = Number.isFinite(data.cpuPercent) ? `${data.cpuPercent.toFixed(1)} percent` : "measuring";
    description.textContent = `${data.title}. Memory: ${memory}. CPU: ${cpu}. Audio: ${data.audio}.${data.sharedWithTabs ? ` Process totals shared with ${data.sharedWithTabs} other tabs.` : ""}`;
    rendered.get(data.id)?.setAttribute("aria-describedby", description.id);
  });
  strip.addEventListener("pointerover", event => {
    if (event.pointerType === "touch") return;
    const id = event.target.closest(".browser-tab")?.dataset.tabId;
    if (id && hoveredId !== id) { hoveredId = id; inspect(id); }
  });
  strip.addEventListener("pointerout", event => {
    const next = event.relatedTarget?.closest?.(".browser-tab")?.dataset.tabId;
    if (next === hoveredId) return;
    hoveredId = null; dismiss(false);
    if (focusedId) inspect(focusedId);
  });
  strip.addEventListener("focusin", event => { focusedId = event.target.closest(".browser-tab")?.dataset.tabId || null; inspect(focusedId); });
  strip.addEventListener("focusout", () => { focusedId = null; if (!hoveredId) dismiss(); });
  strip.addEventListener("scroll", () => { hoveredId = null; dismiss(); }, { passive: true });
  strip.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...strip.querySelectorAll(".browser-tab")];
    if (!buttons.length) return;
    const focused = document.activeElement.closest?.(".browser-tab");
    const current = buttons.indexOf(focused);
    const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (Math.max(0, current) + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[index].focus(); buttons[index].scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  document.addEventListener("pointerdown", () => { hoveredId = null; dismiss(); }, true);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      const hadCard = requestedId !== null; dismiss();
      if (hadCard) { event.preventDefault(); event.stopPropagation(); }
    }
  }, true);
  window.addEventListener("blur", () => { hoveredId = null; focusedId = null; dismiss(); });
  window.addEventListener("resize", () => dismiss());
  document.addEventListener("visibilitychange", () => { if (document.hidden) dismiss(); });

  function updateTab(button, tab) {
    const group = tabs.groupOf(tab);
    const selected = selectedIds.has(String(tab.id));
    button.className = "browser-tab" + (tabs.isActive(tab) ? " active" : "") + (selected ? " selected" : "") + (tab.pinned ? " pinned" : "") + (String(tab.id) === String(tabs.sideId) ? " side" : "") + (group ? " grouped" : "");
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(tabs.isActive(tab)));
    button.setAttribute("aria-label", (group ? group.name + " · " : "") + (tab.title || domainOf(tab.url)));
    button.title = (tab.title || domainOf(tab.url) || "New tab") + " · Drag to another tab edge to split, or to Orbit to pair with the scene";
    if (group) button.style.setProperty("--group-color", group.color); else button.style.removeProperty("--group-color");
    button.querySelector(".browser-tab-title").textContent = tab.title || "New tab";
    const status = button.querySelector(".browser-tab-status");
    status.textContent = tab.audible ? (tab.muted ? "◖×" : "◖))") : "";
    status.title = tab.audible ? (tab.muted ? "Muted" : "Playing audio") : "";
    status.setAttribute("aria-label", status.title);
    if (button.dataset.favicon !== (tab.favicon || "") || button.dataset.domain !== domainOf(tab.url)) {
      button.querySelector(".browser-tab-favicon").innerHTML = tab.favicon
        ? '<img src="' + escapeHTML(tab.favicon) + '" alt="">' : escapeHTML(domainOf(tab.url).slice(0, 1).toUpperCase());
      button.dataset.favicon = tab.favicon || ""; button.dataset.domain = domainOf(tab.url);
    }
  }

  function renderTab(tab) {
    const button = document.createElement("button");
    button.type = "button"; button.dataset.tabId = String(tab.id);
    button.innerHTML =
      '<span class="browser-tab-favicon"></span>' +
      '<span class="browser-tab-title"></span>' +
      '<span class="browser-tab-status" aria-hidden="true"></span>' +
      '<span class="browser-tab-close" role="button" aria-label="Close tab">×</span>';
    button.draggable = true;
    let suppressClickUntil = 0;
    button.addEventListener("click", event => {
      if (Date.now() >= suppressClickUntil) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    updateTab(button, tab);
    button.addEventListener("click", (event) => {
      if (event.target.closest(".browser-tab-close")) {
        event.stopPropagation();
        selectedIds.delete(String(tab.id));
        browser.closeTab(tab.id);
      } else if (event.shiftKey || event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const id = String(tab.id);
        if (event.shiftKey && selectionAnchorId) {
          const order = tabs.tabs.map(item => String(item.id));
          const start = order.indexOf(selectionAnchorId), end = order.indexOf(id);
          if (start >= 0 && end >= 0) {
            selectedIds.clear();
            order.slice(Math.min(start, end), Math.max(start, end) + 1).forEach(selectedId => selectedIds.add(selectedId));
          }
        } else if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        selectionAnchorId = id;
        tabs.tabs.forEach(item => { const renderedTab = rendered.get(String(item.id)); if (renderedTab) updateTab(renderedTab, item); });
      } else if (tabs.isActive(tab)) {
        selectedIds.clear(); selectionAnchorId = String(tab.id); updateTab(button, tab);
        onActivateCurrent(tab);
        void browser.activateTab(tab.id);
      } else {
        selectedIds.clear(); selectionAnchorId = String(tab.id);
        tabs.tabs.forEach(item => { const renderedTab = rendered.get(String(item.id)); if (renderedTab) updateTab(renderedTab, item); });
        browser.activateTab(tab.id);
      }
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (!selectedIds.has(String(tab.id))) { selectedIds.clear(); selectedIds.add(String(tab.id)); selectionAnchorId = String(tab.id); }
      tabs.tabs.forEach(item => { const renderedTab = rendered.get(String(item.id)); if (renderedTab) updateTab(renderedTab, item); });
      browser.showTabMenu(tab.id, [...selectedIds]);
    });
    button.addEventListener("dragstart", event => {
      draggedId = String(tab.id);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-nova-tab-id", draggedId);
      event.dataTransfer.setData("text/plain", draggedId);
      button.classList.add("dragging");
    });
    button.addEventListener("dragend", () => {
      draggedId = null; splitTarget?.classList.remove("split-target-left", "split-target-right"); splitTarget = null;
      button.classList.remove("dragging");
    });
    button.addEventListener("dragover", event => {
      if (!draggedId || draggedId === String(tab.id)) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "move";
      const rect = button.getBoundingClientRect();
      const fraction = (event.clientX - rect.left) / Math.max(1, rect.width);
      const side = fraction < 0.34 ? "left" : fraction > 0.66 ? "right" : null;
      if (splitTarget && (splitTarget !== button || !side)) splitTarget.classList.remove("split-target-left", "split-target-right");
      splitTarget = side ? button : null;
      if (side) button.classList.add(side === "left" ? "split-target-left" : "split-target-right");
    });
    button.addEventListener("dragleave", event => {
      if (event.relatedTarget && button.contains(event.relatedTarget)) return;
      button.classList.remove("split-target-left", "split-target-right");
      if (splitTarget === button) splitTarget = null;
    });
    button.addEventListener("drop", event => {
      event.preventDefault();
      const from = event.dataTransfer.getData("application/x-nova-tab-id") || event.dataTransfer.getData("text/plain") || draggedId;
      const to = String(tab.id);
      if (!from || from === to) return;
      const rect = button.getBoundingClientRect();
      const fraction = (event.clientX - rect.left) / Math.max(1, rect.width);
      const side = fraction < 0.34 ? "left" : fraction > 0.66 ? "right" : null;
      button.classList.remove("split-target-left", "split-target-right");
      splitTarget = null;
      if (side) {
        const leftId = side === "left" ? from : to;
        const rightId = side === "left" ? to : from;
        suppressClickUntil = Date.now() + 650;
        onActivateCurrent();
        void browser.openMultiTab(leftId, rightId);
        draggedId = null;
        return;
      }
      const order = tabs.tabs.map(item => String(item.id)).filter(id => id !== from);
      const targetIndex = order.indexOf(to);
      order.splice(Math.max(0, targetIndex), 0, from);
      browser.reorderTabs(order);
      draggedId = null;
    });
    return button;
  }

  const cosmosButton = el("cosmos-tab");
  let suppressCosmosClickUntil = 0;
  cosmosButton.title = "Orbit view · Drop a tab here to pair it with the scene";
  cosmosButton.setAttribute("aria-label", "Orbit view. Drop a tab here to pair it with the scene.");
  cosmosButton.addEventListener("click", event => {
    if (Date.now() >= suppressCosmosClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  cosmosButton.addEventListener("dragover", event => {
    const id = event.dataTransfer.getData("application/x-nova-tab-id") || event.dataTransfer.getData("text/plain") || draggedId;
    if (!id) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "move";
    cosmosButton.classList.add("split-drop-target");
  });
  cosmosButton.addEventListener("dragleave", event => {
    if (!event.relatedTarget || !cosmosButton.contains(event.relatedTarget)) cosmosButton.classList.remove("split-drop-target");
  });
  cosmosButton.addEventListener("drop", event => {
    const id = event.dataTransfer.getData("application/x-nova-tab-id") || event.dataTransfer.getData("text/plain") || draggedId;
    if (!id) return;
    event.preventDefault();
    cosmosButton.classList.remove("split-drop-target");
    suppressCosmosClickUntil = Date.now() + 650;
    void browser.openOrbitSplit(id);
    draggedId = null;
  });

  tabs.subscribe(() => {
    const open = new Set(tabs.tabs.map((tab) => String(tab.id)));
    for (const id of selectedIds) if (!open.has(id)) selectedIds.delete(id);
    for (const [id, button] of rendered) if (!open.has(id) && button.isConnected) swallow(button);
    if (requestedId && !open.has(requestedId)) { hoveredId = null; focusedId = null; dismiss(); }
    const buttons = tabs.tabs.map(tab => {
      const button = rendered.get(String(tab.id)) || renderTab(tab); updateTab(button, tab); return button;
    });
    rendered = new Map(tabs.tabs.map((tab, index) => [String(tab.id), buttons[index]]));
    const pinnedCount = tabs.tabs.filter(tab => tab.pinned).length;
    const regularCount = tabs.tabs.length - pinnedCount;
    const columns = Array(pinnedCount).fill("40px");
    if (regularCount) columns.push("repeat(" + regularCount + ", minmax(96px, 1fr))");
    if (!columns.length) columns.push("minmax(96px, 1fr)");
    strip.style.gridTemplateColumns = columns.join(" ");
    buttons.forEach((button, index) => { if (strip.children[index] !== button) strip.insertBefore(button, strip.children[index] || null); });
    for (const button of [...strip.children]) if (!open.has(button.dataset.tabId)) button.remove();
    const current = strip.querySelector(".browser-tab.active");
    if (current && shownActiveId !== tabs.activeId) current.scrollIntoView({ block: "nearest", inline: "nearest" });
    shownActiveId = tabs.activeId;
  });
}
