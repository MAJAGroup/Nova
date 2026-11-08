"use strict";
const { WebContentsView } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createTabResourceSampler } = require("./tab-resources");

// A native overlay keeps the card above web pages without hiding, pausing or
// resizing the page whose resource usage we are measuring.
function createTabResourceView({ window, tabs, getMetrics }) {
  const sampler = createTabResourceSampler({ getMetrics });
  let view = null, loaded = false, currentId = null, anchor = null, timer = null, closeTimer = null;
  const file = path.join(__dirname, "ui", "tab-resources.html");
  function position() {
    if (!view || !currentId || !anchor || window.isDestroyed()) return;
    const [width, height] = window.getContentSize();
    const cardWidth = Math.min(326, width - 16), cardHeight = Math.min(218, height - 16);
    view.setBounds({ x: Math.round(Math.max(8, Math.min(anchor.x, width - cardWidth - 8))),
      y: Math.round(Math.max(8, Math.min(anchor.y + anchor.height + 6, height - cardHeight - 8))), width: cardWidth, height: cardHeight });
  }
  function raise() {
    if (view && currentId && loaded && !window.isDestroyed()) window.contentView.addChildView(view);
  }
  function hide() {
    clearTimeout(closeTimer); closeTimer = null; clearInterval(timer); timer = null;
    currentId = null; anchor = null; sampler.reset();
    if (view && !view.webContents.isDestroyed()) { view.setVisible(false); view.setBounds({ x:0, y:0, width:0, height:0 }); }
    if (!window.isDestroyed()) window.webContents.send("browser:tab-resources-updated", { visible: false });
  }
  function update() {
    if (!currentId || window.isDestroyed()) return;
    const payload = sampler.sample(tabs.get(currentId), tabs);
    if (!payload) { hide(); return; }
    if (!loaded) return;
    view.webContents.send("tab-resources:data", payload);
    window.webContents.send("browser:tab-resources-updated", { ...payload, visible: true });
  }
  function show(id, rect) {
    if (!tabs.has(id) || !rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) { hide(); return; }
    clearTimeout(closeTimer); closeTimer = null;
    if (currentId !== id) { sampler.reset(); clearInterval(timer); timer = null; }
    currentId = id; anchor = rect;
    if (!view) {
      view = new WebContentsView({ webPreferences: {
        preload: path.join(__dirname, "tab-resources-preload.js"),
        contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true
      } });
      view.setBackgroundColor("#00000000"); window.contentView.addChildView(view); view.setVisible(false);
      view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      view.webContents.on("will-navigate", (event, url) => { if (url !== pathToFileURL(file).href) event.preventDefault(); });
      view.webContents.once("did-finish-load", () => {
        loaded = true; if (!currentId) return;
        sampler.reset(); update(); position(); view.setVisible(true); raise();
      });
      view.webContents.on("render-process-gone", hide);
      view.webContents.loadFile(file).catch(hide);
    }
    if (loaded) { update(); position(); view.setVisible(true); raise(); }
    if (!timer) { timer = setInterval(update, 1000); timer.unref?.(); }
  }
  function scheduleHide() { clearTimeout(closeTimer); closeTimer = setTimeout(hide, 160); }
  function pointer(inside) { clearTimeout(closeTimer); closeTimer = null; if (!inside) scheduleHide(); }
  const onResize = () => hide();
  window.on("resize", onResize); window.on("blur", hide); window.on("minimize", hide);
  return { show, hide, scheduleHide, pointer, raise,
    owns: event => Boolean(view && event.sender === view.webContents && event.senderFrame === view.webContents.mainFrame),
    refresh() { if (currentId && !tabs.has(currentId)) hide(); },
    dispose() {
      hide(); window.removeListener("resize", onResize); window.removeListener("blur", hide); window.removeListener("minimize", hide);
      if (view && !view.webContents.isDestroyed()) view.webContents.close();
    }
  };
}
module.exports = { createTabResourceView };
