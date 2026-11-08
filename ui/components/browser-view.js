import { el } from "../lib/dom.js";

// The area where the web page appears. The page is a native view that the
// main process draws on top of this document, so we report this element's
// position to it. Modal and cosmos views hide the page; the assistant reserves
// a right-hand lane so both the page and chat stay visible.
export function createBrowserView({ browser, tabs }) {
  const content = el("browser-content");
  const coveredBy = new Set();
  let assistantOpen = false;

  function syncBounds() {
    const assistantWidth = assistantOpen ? Math.min(380, Math.max(300, window.innerWidth * 0.34)) : 0;
    content.style.setProperty("--assistant-width", assistantWidth + "px");
    if (coveredBy.size) {
      browser.setBrowserBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    const rect = content.getBoundingClientRect();
    browser.setBrowserBounds({ x: rect.left, y: rect.top, width: Math.max(0, rect.width - assistantWidth), height: rect.height });
  }

  tabs.subscribe(() => {
    el("browser-placeholder").hidden = Boolean(tabs.activeTab());
  });

  new ResizeObserver(syncBounds).observe(content);
  window.addEventListener("resize", syncBounds);
  requestAnimationFrame(syncBounds);

  return {
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
