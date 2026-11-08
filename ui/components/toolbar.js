import { createSearchSuggestions } from "./search-suggestions.js";
import { el } from "../lib/dom.js";
import { HOME_URL, normalizeAddress, simplifyAddress } from "../lib/url.js";

// Back / forward / reload, the address bar and the new-tab button.
export function createToolbar({ browser, tabs, onNavigate, onToggleCosmos, onBookmark, onNewTab = () => browser.newTab(), onSuggestionsVisibilityChange = () => {} }) {
  const omnibox = el("omnibox");
  const cosmosToggle = el("cosmos-toggle");
  const cosmosTab = el("cosmos-tab");

  const connection = el("connection-status");
  let shownTabId = null, suggestions;
  function activeUrl() { return tabs.activeTab()?.isStartPage ? "" : tabs.activeTab()?.url || ""; }
  function showActiveUrl(editing = false) {
    omnibox.value = editing ? activeUrl() : simplifyAddress(activeUrl());
    omnibox.title = activeUrl();
  }
  function showConnection() {
    const editing = document.activeElement === omnibox && omnibox.value !== activeUrl();
    const status = editing ? { state: "unknown", message: "Editing address — connection information applies to the current page" }
      : tabs.activeTab()?.connection || { state: "unknown", message: "Connection security has not been verified" };
    connection.dataset.state = status.state;
    connection.title = status.message;
    connection.setAttribute("aria-label", status.message);
  }

  tabs.subscribe(() => {
    const active = tabs.activeTab();
    el("go-back").disabled = !active || !active.canGoBack;
    el("go-forward").disabled = !active || !active.canGoForward;
    const bookmark = el("bookmark-page");
    bookmark.disabled = !/^https?:\/\//i.test(active?.url || "");
    bookmark.setAttribute("aria-pressed", String(Boolean(active?.bookmarked)));
    bookmark.setAttribute("aria-label", active?.bookmarked ? "Edit bookmark for this page" : "Bookmark this page");
    bookmark.title = (active?.bookmarked ? "Edit bookmark" : "Bookmark this page") + " (Ctrl+D)";
    const switched = shownTabId !== tabs.activeId;
    if (switched) suggestions?.close();
    shownTabId = tabs.activeId;
    if (document.activeElement !== omnibox) showActiveUrl();
    else if (switched) { showActiveUrl(true); omnibox.select(); }
    showConnection();
  });

  omnibox.addEventListener("focus", () => { showActiveUrl(true); omnibox.select(); showConnection(); });
  omnibox.addEventListener("pointerdown", event => {
    if (event.button === 0 && document.activeElement !== omnibox) {
      event.preventDefault(); omnibox.focus(); omnibox.select();
    }
  });
  omnibox.addEventListener("input", showConnection);
  omnibox.addEventListener("blur", () => { showActiveUrl(); showConnection(); });
  omnibox.addEventListener("suggestion-preview", showConnection);
  suggestions = createSearchSuggestions({
    input: omnibox, popup: el("address-suggestions"),
    requestLocal: query => browser.getLocalSuggestions(query),
    requestWeb: query => browser.getWebSuggestions(query),
    cancelRequests: () => browser.cancelSuggestions(),
    onEscape: () => { showActiveUrl(); omnibox.blur(); },
    onVisibilityChange: onSuggestionsVisibilityChange,
    onCommit: item => { void browser.chooseSuggestion(item); omnibox.blur(); onNavigate(); }
  });
  omnibox.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const query = omnibox.value.trim();
      if (!query) return;
      browser.navigate(normalizeAddress(query));
      omnibox.blur();
      onNavigate();
    }
    if (event.key === "Escape") {
      showActiveUrl();
      omnibox.blur();
    }
  });


  el("go-back").addEventListener("click", () => browser.goBack());
  el("bookmark-page").addEventListener("click", onBookmark);
  el("go-forward").addEventListener("click", () => browser.goForward());
  el("reload-page").addEventListener("click", () => browser.reload());
  el("go-home").addEventListener("click", () => {
    browser.navigate(HOME_URL);
    onNavigate();
  });
  el("new-tab").addEventListener("click", onNewTab);
  cosmosToggle.addEventListener("click", onToggleCosmos);
  cosmosTab.addEventListener("click", onToggleCosmos);

  return {
    setCosmosOpen(open) {
      cosmosToggle.classList.toggle("active", open);
      cosmosToggle.setAttribute("aria-pressed", String(open));
      cosmosTab.classList.toggle("active", open);
      cosmosTab.setAttribute("aria-pressed", String(open));
    },
    focusAddress() {
      omnibox.focus();
      omnibox.select();
    }
  };
}
