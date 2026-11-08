import { el } from "../lib/dom.js";
import { domainOf } from "../lib/url.js";

const SIDE_HEADER_HEIGHT = 34;

// The area where the web page appears. Pages are native views that the main
// process draws on top of this document, so we report where they go. Modal
// and cosmos views hide the pages; the assistant reserves a right-hand lane
// so both the page and chat stay visible. A side tab that Nova opened splits
// the remaining width with the current page. Electron places the assistant
// handle in a small transparent native view above live web pages.
export function createBrowserView({ browser, tabs }) {
  const content = el("browser-content");
  const sidePane = el("side-pane");
  const sideTitle = el("side-pane-title");
  const sideIcon = el("side-pane-icon");
  const coveredBy = new Set();
  let assistantOpen = false;
  let suggestionGeneration = 0;
  const suggestionPreview = el("browser-suggestion-preview");

  function syncBounds() {
    const assistantWidth = assistantOpen ? Math.min(380, Math.max(300, window.innerWidth * 0.34)) : 0;
    content.style.setProperty("--assistant-width", assistantWidth + "px");
    const rect = content.getBoundingClientRect();
    const available = Math.max(0, rect.width - assistantWidth);
    content.style.setProperty("--orbit-split-left", Math.floor(available / 2) + "px");
    const side = tabs.sideTab();
    const multiView = tabs.multiView;
    const tabSplit = multiView?.kind === "tabs";
    const orbitSplit = multiView?.kind === "orbit";
    const splitWidth = Math.floor(available / 2);
    const sideWidth = tabSplit ? available - splitWidth : side ? Math.round(Math.min(available - 240, Math.max(320, available * 0.48))) : 0;
    const showSide = (tabSplit || side) && sideWidth > 0;
    const hasBlockingCover = [...coveredBy].some(reason => !(reason === "cosmos" && orbitSplit));
    sidePane.classList.toggle("multi-tab-pane", Boolean(tabSplit));
    sidePane.hidden = !showSide || hasBlockingCover || orbitSplit;
    if (showSide) {
      sidePane.style.left = tabSplit ? "0px" : (available - sideWidth) + "px";
      sidePane.style.width = (tabSplit ? available : sideWidth) + "px";
      const leftTab = tabSplit ? tabs.tabs.find(tab => String(tab.id) === String(multiView.leftId)) : null;
      const rightTab = tabSplit ? tabs.tabs.find(tab => String(tab.id) === String(multiView.rightId)) : null;
      sideTitle.textContent = tabSplit
        ? `${leftTab?.title || "Left tab"}  ↔  ${rightTab?.title || "Right tab"}`
        : side.loading && !side.title ? "Loading…" : (side.title || domainOf(side.url) || "Side tab");
      sideTitle.title = tabSplit
        ? `${leftTab?.url || ""}\n${rightTab?.url || ""}`
        : (side.url || "");
      sideIcon.hidden = tabSplit || !side.favicon;
      if (!tabSplit && side.favicon && sideIcon.src !== side.favicon) sideIcon.src = side.favicon;
      sidePane.classList.toggle("loading", !tabSplit && Boolean(side.loading));
    }
    sidePane.setAttribute("aria-label", tabSplit ? "Two tab split view" : "Side tab opened by Nova");
    el("side-pane-kicker").textContent = tabSplit ? "SPLIT VIEW" : "NOVA";
    el("side-pane-promote").hidden = Boolean(tabSplit);
    el("side-pane-close").title = tabSplit ? "Close split view" : "Close side tab";
    el("side-pane-close").setAttribute("aria-label", tabSplit ? "Close split view" : "Close side tab");
    if (hasBlockingCover) {
      browser.setBrowserBounds({ x: 0, y: 0, width: 0, height: 0, assistantExpanded: assistantOpen }, null);
      return;
    }
    const mainWidth = tabSplit ? splitWidth : orbitSplit ? splitWidth : showSide ? available - sideWidth - 1 : available;
    const contentTop = tabSplit ? rect.top + SIDE_HEADER_HEIGHT : rect.top;
    const contentHeight = tabSplit ? Math.max(0, rect.height - SIDE_HEADER_HEIGHT) : rect.height;
    browser.setBrowserBounds(
      { x: rect.left, y: contentTop, width: Math.max(0, mainWidth), height: contentHeight, assistantExpanded: assistantOpen },
      showSide
        ? {
          x: rect.left + (tabSplit ? splitWidth + 1 : available - sideWidth),
          y: tabSplit ? contentTop : rect.top + SIDE_HEADER_HEIGHT,
          width: Math.max(0, tabSplit ? sideWidth - 1 : sideWidth),
          height: Math.max(0, rect.height - SIDE_HEADER_HEIGHT)
        }
        : null
    );
  }

  tabs.subscribe(() => {
    el("browser-placeholder").hidden = Boolean(tabs.activeTab());
    const side = tabs.sideTab();
    if (side && tabs.multiView?.kind !== "tabs") {
      sideTitle.textContent = side.loading && !side.title ? "Loading…" : (side.title || domainOf(side.url) || "Side tab");
      sideTitle.title = side.url || "";
      sideIcon.hidden = !side.favicon;
      if (side.favicon && sideIcon.src !== side.favicon) sideIcon.src = side.favicon;
      sidePane.classList.toggle("loading", Boolean(side.loading));
    }
    syncBounds();
  });

  el("side-pane-close").addEventListener("click", () => {
    if (tabs.multiView?.kind === "tabs") browser.closeMultiView();
    else browser.closeSideTab();
  });
  el("side-pane-promote").addEventListener("click", () => browser.promoteSideTab());

  new ResizeObserver(syncBounds).observe(content);
  window.addEventListener("resize", syncBounds);
  requestAnimationFrame(syncBounds);

  return {
    async setSuggestionsOpen(open) {
      const generation = ++suggestionGeneration;
      if (!open) {
        suggestionPreview.hidden = true; suggestionPreview.removeAttribute("src");
        coveredBy.delete("suggestions"); syncBounds(); return;
      }
      const activeId = tabs.activeId;
      const preview = coveredBy.size ? null : await browser.capturePage().catch(() => null);
      if (generation !== suggestionGeneration || activeId !== tabs.activeId) return;
      if (preview) { suggestionPreview.src = preview; suggestionPreview.hidden = false; }
      coveredBy.add("suggestions"); syncBounds();
    },
    // reason: a name for what is covering the page; the page shows again
    // once nothing covers it.
    cover(reason, covered) {
      if (covered) coveredBy.add(reason);
      else coveredBy.delete(reason);
      syncBounds();
    },
    setAssistantOpen(open) {
      assistantOpen = open;
      syncBounds();
    }
  };
}
