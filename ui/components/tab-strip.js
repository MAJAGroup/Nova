import { el, escapeHTML } from "../lib/dom.js";
import { domainOf } from "../lib/url.js";

export function createTabStrip({ browser, tabs }) {
  const strip = el("browser-tabs");

  function renderTab(tab) {
    const button = document.createElement("button");
    button.className = "browser-tab" + (tabs.isActive(tab) ? " active" : "");
    button.title = tab.title || domainOf(tab.url);
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
      } else {
        browser.activateTab(tab.id);
      }
    });
    return button;
  }

  tabs.subscribe(() => {
    strip.replaceChildren(...tabs.tabs.map(renderTab));
    const current = strip.querySelector(".browser-tab.active");
    if (current) current.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}
