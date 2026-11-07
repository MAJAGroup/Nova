import { el } from "../lib/dom.js";

// The area where the web page appears. The page is a native view that the
// main process draws on top of this document, so we report this element's
// position to it, and hide the page while an overlay needs to be seen.
export function createBrowserView({ browser, tabs }) {
  const content = el("browser-content");
  let covered = false;

  function syncBounds() {
    if (covered) {
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
    setCovered(value) {
      covered = Boolean(value);
      syncBounds();
    }
  };
}
