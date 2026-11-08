"use strict";
const { contextBridge, ipcRenderer } = require("electron");

if (location.protocol === "https:" || location.protocol === "http:") {
  const openInTab = (event, background) => {
    const anchor = event.target && event.target.closest?.("a[href]");
    if (!anchor || !anchor.href || !/^https?:/i.test(anchor.href)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    ipcRenderer.send("browser:open-link", { url: anchor.href, activate: !background });
  };
  document.addEventListener("auxclick", event => {
    if (event.button === 1) openInTab(event, true);
  }, true);
  document.addEventListener("click", event => {
    if ((event.metaKey || event.ctrlKey) && event.button === 0) openInTab(event, !event.shiftKey);
  }, true);

  // Windows/Linux trackpads usually arrive as a stream of horizontal wheel
  // events. Treat a deliberate horizontal stroke as history navigation only
  // when it is not moving a horizontally scrollable page control.
  if (process.platform !== "darwin") {
    let horizontal = 0;
    let resetTimer = 0;
    let triggered = false;
    document.addEventListener("wheel", event => {
      const delta = Number(event.deltaX) || 0;
      if (Math.abs(delta) < 3 || Math.abs(delta) < Math.abs(Number(event.deltaY) || 0) * 1.6) return;
      const target = event.target;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "")) return;
      const path = typeof event.composedPath === "function" ? event.composedPath() : [target];
      for (const node of path) {
        if (!(node instanceof Element)) continue;
        const style = getComputedStyle(node);
        const scrollable = node.scrollWidth > node.clientWidth + 4 && /auto|scroll|overlay/.test(style.overflowX);
        if (!scrollable) continue;
        const canScroll = delta > 0
          ? node.scrollLeft + node.clientWidth < node.scrollWidth - 2
          : node.scrollLeft > 2;
        if (canScroll) return;
      }
      event.preventDefault();
      const sign = Math.sign(delta);
      if (horizontal && Math.sign(horizontal) !== sign) horizontal = 0;
      horizontal += delta;
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { horizontal = 0; triggered = false; }, 260);
      if (!triggered && Math.abs(horizontal) >= 120) {
        triggered = true;
        ipcRenderer.send("browser:history-gesture", horizontal < 0 ? "back" : "forward");
      }
    }, { passive: false, capture: true });
  }
}

// This restricted bridge is available only to the bundled start document.
// The main process independently verifies the exact file URL and main frame.
if (location.protocol === "file:" && location.pathname.endsWith("/ui/newtab/index.html")) {
  contextBridge.exposeInMainWorld("novaSearch", {
    getLocalSuggestions: query => ipcRenderer.invoke("browser:suggest-local", query),
    getWebSuggestions: query => ipcRenderer.invoke("browser:suggest-web", query),
    cancelSuggestions: () => ipcRenderer.send("browser:suggest-cancel"),
    chooseSuggestion: suggestion => ipcRenderer.invoke("browser:choose-suggestion", suggestion)
  });
}
