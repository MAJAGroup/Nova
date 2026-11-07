import { el } from "../lib/dom.js";

// The area where the web page appears. The page is a native view that the
// main process draws on top of this document, so we report this element's
// position to it, and hide the page while something else must be seen here
// (the settings dialog, the tab cosmos).
export function createBrowserView({ browser, tabs }) {
  const content = el("browser-content");
  const coveredBy = new Set();

  function syncBounds() {
    if (coveredBy.size) {
      browser.setBrowserBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    const rect = content.getBoundingClientRect();
    browser.setBrowserBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
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
    }
  };
}
