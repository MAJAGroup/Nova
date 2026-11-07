import { domainOf } from "./url.js";

// Mirror of the main process's tab list. Components subscribe to it instead
// of talking to each other.
export function createTabStore(browser) {
  let tabs = [];
  let activeId = null;
  const listeners = new Set();

  function update(payload) {
    tabs = payload.tabs || [];
    activeId = payload.activeId;
    listeners.forEach((listener) => listener(store));
  }

  const store = {
    get tabs() { return tabs; },
    get activeId() { return activeId; },
    activeTab() {
      return tabs.find((tab) => String(tab.id) === String(activeId));
    },
    isActive(tab) {
      return String(tab.id) === String(activeId);
    },
    findTab(query) {
      const needle = String(query || "").trim().toLowerCase();
      if (!needle) return null;
      return tabs.find((tab) =>
        (tab.title || "").toLowerCase().includes(needle) ||
        domainOf(tab.url).toLowerCase().includes(needle));
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(store);
      return () => listeners.delete(listener);
    }
  };

  browser.getTabs().then(update);
  browser.onTabsUpdated(update);
  return store;
}
