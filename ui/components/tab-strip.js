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
  let rendered = new Map();
  let shownActiveId = null;
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
    button.className = "browser-tab" + (tabs.isActive(tab) ? " active" : "") + (group ? " grouped" : "");
    button.setAttribute("aria-label", (group ? group.name + " · " : "") + (tab.title || domainOf(tab.url)));
    if (group) button.style.setProperty("--group-color", group.color); else button.style.removeProperty("--group-color");
    button.querySelector(".browser-tab-title").textContent = tab.title || "New tab";
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
      '<span class="browser-tab-close" role="button" aria-label="Close tab">×</span>';
    updateTab(button, tab);
    button.addEventListener("click", (event) => {
      if (event.target.closest(".browser-tab-close")) {
        event.stopPropagation();
        browser.closeTab(tab.id);
      } else if (tabs.isActive(tab)) {
        onActivateCurrent(tab);
      } else {
        browser.activateTab(tab.id);
      }
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      browser.showTabMenu(tab.id);
    });
    return button;
  }

  tabs.subscribe(() => {
    const open = new Set(tabs.tabs.map((tab) => String(tab.id)));
    for (const [id, button] of rendered) if (!open.has(id) && button.isConnected) swallow(button);
    if (requestedId && !open.has(requestedId)) { hoveredId = null; focusedId = null; dismiss(); }
    const buttons = tabs.tabs.map(tab => {
      const button = rendered.get(String(tab.id)) || renderTab(tab); updateTab(button, tab); return button;
    });
    rendered = new Map(tabs.tabs.map((tab, index) => [String(tab.id), buttons[index]]));
    strip.style.setProperty("--tab-count", Math.max(1, tabs.tabs.length));
    buttons.forEach((button, index) => { if (strip.children[index] !== button) strip.insertBefore(button, strip.children[index] || null); });
    for (const button of [...strip.children]) if (!open.has(button.dataset.tabId)) button.remove();
    const current = strip.querySelector(".browser-tab.active");
    if (current && shownActiveId !== tabs.activeId) current.scrollIntoView({ block: "nearest", inline: "nearest" });
    shownActiveId = tabs.activeId;
  });
}
