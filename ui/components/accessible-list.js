import { el } from "../lib/dom.js";
import { domainOf } from "../lib/url.js";

export function createAccessibleList({ browser, tabs, onVisibilityChange }) {
  const modal = el("accessible-list-modal");
  const search = el("accessible-list-search");
  const tabList = el("accessible-tabs");
  const historyList = el("accessible-history");
  let snapshot = { tabs: [], visits: [] };
  let returnFocus = null;

  function addEmpty(list, message) {
    const item = document.createElement("li");
    item.className = "accessible-empty";
    item.textContent = message;
    list.append(item);
  }

  function addResult(list, title, url, detail, onSelect) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "accessible-result";
    button.setAttribute("aria-label", `${title}. ${url}. ${detail}`);
    const heading = document.createElement("strong");
    heading.textContent = title || domainOf(url) || "Untitled page";
    const address = document.createElement("small");
    address.textContent = [domainOf(url), detail].filter(Boolean).join(" · ");
    button.append(heading, address);
    button.addEventListener("click", onSelect);
    item.append(button);
    list.append(item);
  }

  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const openTabs = tabs.tabs.filter((tab) => `${tab.title} ${tab.url}`.toLocaleLowerCase().includes(query));
    tabList.replaceChildren();
    el("accessible-tabs-count").textContent = `(${openTabs.length})`;
    openTabs.forEach((tab) => addResult(tabList, tab.title || "Untitled tab", tab.url,
      String(tab.id) === String(tabs.activeId) ? "Current tab" : "Open tab", () => {
        browser.activateTab(tab.id, tab.pane || tabs.layout.focusedPane || "primary");
        close();
      }));
    if (!openTabs.length) addEmpty(tabList, query ? "No matching open tabs." : "No open tabs.");

    const visits = [...(snapshot.visits || [])]
      .filter((visit) => `${visit.title} ${visit.url}`.toLocaleLowerCase().includes(query))
      .sort((left, right) => right.visitedAt - left.visitedAt);
    historyList.replaceChildren();
    el("accessible-history-count").textContent = `(${visits.length})`;
    visits.forEach((visit) => addResult(historyList, visit.title || "Visited page", visit.url,
      new Date(visit.visitedAt).toLocaleString(), () => {
        browser.goToVisit(visit.id);
        close();
      }));
    if (!visits.length) addEmpty(historyList, query ? "No matching visits." : "Your visited pages will appear here.");
  }

  function open() {
    if (!modal.hidden) return;
    returnFocus = document.activeElement;
    search.value = "";
    modal.hidden = false;
    onVisibilityChange(true);
    browser.getNavigation().then((next) => { snapshot = next || snapshot; render(); });
    render();
    setTimeout(() => search.focus(), 30);
  }

  function close() {
    if (modal.hidden) return;
    modal.hidden = true;
    onVisibilityChange(false);
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  }

  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  modal.querySelectorAll("[data-close-accessible-list]").forEach((button) => button.addEventListener("click", close));
  search.addEventListener("input", render);
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const items = [...modal.querySelectorAll("button:not([disabled]),input:not([disabled]),select:not([disabled])")];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  browser.onNavigationUpdated((next) => { snapshot = next || snapshot; if (!modal.hidden) render(); });
  tabs.subscribe(() => { if (!modal.hidden) render(); });

  return { open, close, isOpen: () => !modal.hidden };
}
