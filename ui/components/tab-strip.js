import { el, escapeHTML } from "../lib/dom.js";
import { domainOf } from "../lib/url.js";

export function createTabStrip({ browser, tabs }) {
  const strip = el("browser-tabs");

  function renderTab(tab) {
    const item = document.createElement("div");
    item.className = "browser-tab-container" + (tabs.isActive(tab) ? " active" : "");
    const button = document.createElement("button");
    button.className = "browser-tab" + (tabs.isActive(tab) ? " active" : "");
    button.title = tab.title || domainOf(tab.url);
    button.setAttribute("aria-label", `Select tab: ${tab.title || domainOf(tab.url)}`);
    if (tabs.isActive(tab)) button.setAttribute("aria-current", "page");
    const mark = tab.favicon
      ? '<img src="' + escapeHTML(tab.favicon) + '" alt="">'
      : escapeHTML(domainOf(tab.url).slice(0, 1).toUpperCase());
    button.innerHTML =
      '<span class="browser-tab-favicon">' + mark + "</span>" +
      '<span class="browser-tab-title">' + escapeHTML(tab.title || "New tab") + "</span>";
    button.addEventListener("click", () => browser.activateTab(tab.id));
    const close = document.createElement("button");
    close.type = "button";
    close.className = "browser-tab-close";
    close.textContent = "×";
    close.setAttribute("aria-label", `Close tab: ${tab.title || domainOf(tab.url)}`);
    close.addEventListener("click", () => browser.closeTab(tab.id));
    item.append(button, close);
    return item;
  }

  tabs.subscribe(() => {
    strip.replaceChildren(...tabs.tabs.map(renderTab));
    const current = strip.querySelector(".browser-tab.active");
    if (current) current.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}
