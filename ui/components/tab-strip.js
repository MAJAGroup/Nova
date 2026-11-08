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

  function renderTab(tab) {
    const button = document.createElement("button");
    const group = tabs.groupOf(tab);
    button.className = "browser-tab" + (tabs.isActive(tab) ? " active" : "") + (group ? " grouped" : "");
    button.title = (group ? group.name + " · " : "") + (tab.title || domainOf(tab.url));
    if (group) button.style.setProperty("--group-color", group.color);
    const mark = tab.favicon
      ? '<img src="' + escapeHTML(tab.favicon) + '" alt="">'
      : escapeHTML(domainOf(tab.url).slice(0, 1).toUpperCase());
    button.innerHTML =
      '<span class="browser-tab-favicon">' + mark + "</span>" +
      '<span class="browser-tab-title">' + escapeHTML(tab.title || "New tab") + "</span>" +
      '<span class="browser-tab-close" role="button" aria-label="Close tab">×</span>';
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
    const buttons = tabs.tabs.map(renderTab);
    rendered = new Map(tabs.tabs.map((tab, index) => [String(tab.id), buttons[index]]));
    strip.style.setProperty("--tab-count", Math.max(1, tabs.tabs.length));
    strip.replaceChildren(...buttons);
    const current = strip.querySelector(".browser-tab.active");
    if (current) current.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}
