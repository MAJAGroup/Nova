"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
class DesktopState {
  constructor(directory) {
    this.file = path.join(directory, "desktop-session.json");
    this.data = { tabs: [], closed: [], activeId: null, nextId: 1 };
    try {
      this.data = {
        ...this.data,
        ...JSON.parse(fs.readFileSync(this.file, "utf8")),
      };
    } catch {}
  }
  save(snapshot) {
    this.data = { ...this.data, ...snapshot };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.data), {
      mode: 0o600,
    });
    fs.renameSync(this.file + ".tmp", this.file);
  }
}
function recordVisit(tab, url, title, index) {
  tab.journey = tab.journey || [];
  tab.historySlots = tab.historySlots || {};
  const previous = tab.journey.find((v) => v.id === tab.historySlots[index]);
  if (previous && previous.url === url) {
    tab.currentVisit = previous.id;
    previous.title = title || previous.title;
    return;
  }
  const current = tab.journey.find((v) => v.id === tab.currentVisit);
  if (current && current.url === url) {
    current.title = title || current.title;
    tab.historySlots[index] = current.id;
    return;
  }
  const visit = {
    id: randomUUID(),
    url,
    title: title || url,
    parent: tab.currentVisit || null,
    time: Date.now(),
  };
  tab.journey.push(visit);
  tab.journey = tab.journey.slice(-200);
  tab.historySlots[index] = visit.id;
  tab.currentVisit = visit.id;
  for (const key of Object.keys(tab.historySlots))
    if (Number(key) > index) delete tab.historySlots[key];
}
module.exports = { DesktopState, recordVisit };
