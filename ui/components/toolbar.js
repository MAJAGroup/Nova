import { el } from "../lib/dom.js";
import { normalizeAddress } from "../lib/url.js";

// Back / forward / reload, the address bar and the new-tab button.
export function createToolbar({ browser, tabs }) {
  const omnibox = el("omnibox");

  function showActiveUrl() {
    const active = tabs.activeTab();
    omnibox.value = active ? active.url || "" : "";
  }

  tabs.subscribe(() => {
    const active = tabs.activeTab();
    el("go-back").disabled = !active || !active.canGoBack;
    el("go-forward").disabled = !active || !active.canGoForward;
    if (document.activeElement !== omnibox) showActiveUrl();
  });

  omnibox.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const query = omnibox.value.trim();
      if (!query) return;
      browser.navigate(normalizeAddress(query));
      omnibox.blur();
    }
    if (event.key === "Escape") {
      showActiveUrl();
      omnibox.blur();
    }
  });
  omnibox.addEventListener("focus", () => omnibox.select());
  omnibox.addEventListener("blur", () => {
    if (!omnibox.value.trim()) showActiveUrl();
  });

  el("go-back").addEventListener("click", () => browser.goBack());
  el("go-forward").addEventListener("click", () => browser.goForward());
  el("reload-page").addEventListener("click", () => browser.reload());
  el("new-tab").addEventListener("click", () => browser.newTab());

  return {
    focusAddress() {
      omnibox.focus();
      omnibox.select();
    }
  };
}
