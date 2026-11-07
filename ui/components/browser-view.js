import { el } from "../lib/dom.js";

const MIN_SPLIT = 25;
const MAX_SPLIT = 75;
const HEADER_HEIGHT = 31;

// Native web pages are positioned over the two pane elements. Modal and cosmos
// overlays hide those native views until the overlay closes.
export function createBrowserView({ browser, tabs }) {
  const content = el("browser-content");
  const primary = el("browser-pane-primary");
  const secondary = el("browser-pane-secondary");
  const divider = el("pane-divider");
  const coveredBy = new Set();
  let splitRatio = Number(localStorage.getItem("orbit.splitRatio")) || 50;
  splitRatio = Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, splitRatio));

  function boundsFor(pane, hasHeader) {
    const rect = pane.getBoundingClientRect();
    const top = hasHeader ? Math.min(rect.bottom, rect.top + HEADER_HEIGHT) : rect.top;
    return {
      x: rect.left,
      y: top,
      width: Math.max(0, rect.width),
      height: Math.max(0, rect.bottom - top)
    };
  }

  function syncBounds() {
    if (coveredBy.size) {
      browser.setBrowserBounds({ primary: {}, secondary: {} });
      return;
    }
    const split = tabs.layout.mode !== "single";
    browser.setBrowserBounds({
      primary: boundsFor(primary, split),
      secondary: split ? boundsFor(secondary, true) : {}
    });
  }

  function renderLayout() {
    const layout = tabs.layout;
    const split = layout.mode !== "single";
    content.classList.toggle("is-split", split);
    content.classList.toggle("split-horizontal", layout.mode === "horizontal");
    content.classList.toggle("split-vertical", layout.mode === "vertical");
    content.style.setProperty("--split-ratio", splitRatio + "%");
    secondary.hidden = !split;
    divider.hidden = !split;
    divider.setAttribute("aria-orientation", layout.mode === "horizontal" ? "horizontal" : "vertical");
    divider.setAttribute("aria-valuenow", String(splitRatio));
    el("primary-pane-header").classList.toggle("focused", layout.focusedPane === "primary");
    el("secondary-pane-header").classList.toggle("focused", layout.focusedPane === "secondary");
    for (const id of ["split-swap", "split-maximize", "split-close"]) el(id).hidden = !split;
    el("split-vertical").setAttribute("aria-pressed", String(layout.mode === "vertical"));
    el("split-horizontal").setAttribute("aria-pressed", String(layout.mode === "horizontal"));
    el("browser-placeholder").hidden = Boolean(tabs.activeTab());
    requestAnimationFrame(syncBounds);
  }

  async function setLayout(mode) {
    const layout = await browser.setLayout(mode);
    if (mode !== "single" && layout && !layout.secondaryTabId) {
      await browser.newTab("https://www.google.com", "secondary");
    }
  }

  el("split-vertical").addEventListener("click", () => setLayout("vertical"));
  el("split-horizontal").addEventListener("click", () => setLayout("horizontal"));
  el("split-swap").addEventListener("click", () => browser.swapPanes());
  el("split-maximize").addEventListener("click", () => setLayout("single"));
  el("split-close").addEventListener("click", () => browser.closeSecondPane());
  document.querySelectorAll("[data-focus-pane]").forEach((button) => {
    button.addEventListener("click", () => browser.focusPane(button.dataset.focusPane));
  });

  let resizing = false;
  function setRatioFromPointer(event) {
    const rect = content.getBoundingClientRect();
    const horizontal = tabs.layout.mode === "horizontal";
    const extent = horizontal ? rect.height : rect.width;
    const offset = horizontal ? event.clientY - rect.top : event.clientX - rect.left;
    if (!extent) return;
    splitRatio = Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, Math.round(offset / extent * 100)));
    content.style.setProperty("--split-ratio", splitRatio + "%");
    divider.setAttribute("aria-valuenow", String(splitRatio));
    requestAnimationFrame(syncBounds);
  }
  divider.addEventListener("pointerdown", (event) => {
    resizing = true;
    divider.setPointerCapture(event.pointerId);
    setRatioFromPointer(event);
  });
  divider.addEventListener("pointermove", (event) => { if (resizing) setRatioFromPointer(event); });
  divider.addEventListener("pointerup", () => {
    if (!resizing) return;
    resizing = false;
    localStorage.setItem("orbit.splitRatio", String(splitRatio));
  });
  divider.addEventListener("keydown", (event) => {
    const horizontal = tabs.layout.mode === "horizontal";
    const decrement = horizontal ? event.key === "ArrowUp" : event.key === "ArrowLeft";
    const increment = horizontal ? event.key === "ArrowDown" : event.key === "ArrowRight";
    if (event.key === "Home") splitRatio = MIN_SPLIT;
    else if (event.key === "End") splitRatio = MAX_SPLIT;
    else if (decrement) splitRatio = Math.max(MIN_SPLIT, splitRatio - 5);
    else if (increment) splitRatio = Math.min(MAX_SPLIT, splitRatio + 5);
    else return;
    event.preventDefault();
    content.style.setProperty("--split-ratio", splitRatio + "%");
    divider.setAttribute("aria-valuenow", String(splitRatio));
    localStorage.setItem("orbit.splitRatio", String(splitRatio));
    requestAnimationFrame(syncBounds);
  });

  tabs.subscribe(renderLayout);
  new ResizeObserver(syncBounds).observe(content);
  window.addEventListener("resize", syncBounds);
  requestAnimationFrame(syncBounds);

  return {
    setLayout,
    cover(reason, covered) {
      if (covered) coveredBy.add(reason);
      else coveredBy.delete(reason);
      syncBounds();
    }
  };
}
