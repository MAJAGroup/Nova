"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// Visits belong to journeys, not URLs. Native history slots let back/forward
// return to an existing star while a new navigation retains the old branch.
class HistoryStore {
  constructor(file, limit = 3000) {
    this.file = file;
    this.limit = limit;
    this.nodes = [];
    if (file && fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!Array.isArray(data.nodes)) throw new Error("Invalid history file");
      this.nodes = data.nodes.filter(n => typeof n.id === "string" && /^https?:\/\//.test(n.url)).slice(-limit);
    }
  }
  attach(tab, parent = null) {
    tab.journeyId = randomUUID();
    tab.currentVisit = null;
    tab.visitSlots = [];
    tab.visitIndex = -1;
    tab.openerVisit = parent;
  }
  commit(tab, { url, title, index, fresh = false, favicon = "" }) {
    if (!/^https?:\/\//.test(url)) return;
    const known = this.nodes.find(n => n.id === tab.visitSlots[index]);
    let node;
    if (!fresh && known && known.url === url) {
      node = known;
    } else {
      node = {
        id: randomUUID(), journey: tab.journeyId, url,
        title: title || url, favicon, at: Date.now(),
        parent: tab.currentVisit || tab.openerVisit || null,
        kind: tab.currentVisit ? "navigation" : tab.openerVisit ? "new-tab" : "root"
      };
      this.nodes.push(node);
      tab.visitSlots = tab.visitSlots.slice(0, index);
      tab.visitSlots[index] = node.id;
      this.nodes = this.nodes.slice(-this.limit);
      const retained = new Set(this.nodes.map(n => n.id));
      for (const n of this.nodes) if (n.parent && !retained.has(n.parent)) n.parent = null;
    }
    tab.currentVisit = node.id;
    tab.visitIndex = index;
    node.lastVisited = Date.now();
    this.schedule();
    return node;
  }
  title(tab, title) {
    const node = this.nodes.find(n => n.id === tab.currentVisit);
    if (node && title && node.title !== title) { node.title = title; this.schedule(); }
  }
  favicon(tab, value) {
    const visit = this.nodes.find(n => n.id === tab.currentVisit);
    const icon = String(value || "").slice(0, 8192);
    if (visit && /^(https?:|data:image\/)/i.test(icon) && visit.favicon !== icon) {
      visit.favicon = icon;
      this.schedule();
    }
  }
  snapshot(tabs) {
    const live = new Map(Array.from(tabs.values(), t => [t.currentVisit, t.id]));
    return this.nodes.map(n => ({ ...n, liveTabId: live.get(n.id) || null }));
  }
  clear(tabs) {
    this.nodes = [];
    for (const tab of tabs.values()) this.attach(tab);
    this.flush();
  }
  remove(id, tabs) {
    return this.removeMany([id], tabs) > 0;
  }
  removeMany(ids, tabs) {
    const removedIds = new Set((Array.isArray(ids) ? ids : []).filter(id => typeof id === "string"));
    const byId = new Map(this.nodes.map(node => [node.id, node]));
    for (const id of [...removedIds]) if (!byId.has(id)) removedIds.delete(id);
    if (!removedIds.size) return 0;
    const nearestParent = id => {
      const seen = new Set();
      while (id && removedIds.has(id) && !seen.has(id)) { seen.add(id); id = byId.get(id)?.parent || null; }
      return id && byId.has(id) ? id : null;
    };
    for (const node of this.nodes) if (!removedIds.has(node.id) && removedIds.has(node.parent)) node.parent = nearestParent(node.parent);
    this.nodes = this.nodes.filter(node => !removedIds.has(node.id));
    for (const tab of tabs.values()) {
      tab.visitSlots = tab.visitSlots.map(visitId => removedIds.has(visitId) ? null : visitId);
      if (removedIds.has(tab.currentVisit)) tab.currentVisit = null;
      if (removedIds.has(tab.openerVisit)) tab.openerVisit = nearestParent(tab.openerVisit);
    }
    this.flush();
    return removedIds.size;
  }
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
    this.timer.unref?.();
  }
  flush() {
    clearTimeout(this.timer);
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + ".tmp", JSON.stringify({ version: 1, nodes: this.nodes }), { mode: 0o600 });
      fs.renameSync(this.file + ".tmp", this.file);
    } catch (error) { console.error("Could not save browsing history:", error.message); }
  }
}
module.exports = { HistoryStore };
