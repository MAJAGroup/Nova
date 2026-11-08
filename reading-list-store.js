"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { bookmarkUrl } = require("./bookmark-store");

const cleanText = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 512) : "";

class ReadingListStore {
  constructor(file) {
    this.file = file;
    this.items = [];
    if (!file || !fs.existsSync(file)) return;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(data.items)) throw Error("Invalid reading list file");
    const seen = new Set();
    for (const item of data.items) {
      try {
        const url = bookmarkUrl(item?.url);
        if (typeof item.id !== "string" || !/^[\w-]+$/.test(item.id) || seen.has(url)) continue;
        this.items.push({ id: item.id, url, title: cleanText(item.title) || new URL(url).hostname,
          favicon: typeof item.favicon === "string" && /^(https?:\/\/|data:image\/)/i.test(item.favicon) ? item.favicon.slice(0, 8192) : "",
          addedAt: Number.isFinite(item.addedAt) && item.addedAt > 0 ? item.addedAt : Date.now(),
          readAt: Number.isFinite(item.readAt) && item.readAt > 0 ? item.readAt : null });
        seen.add(url);
      } catch { /* Ignore malformed or unsupported entries without changing the file. */ }
    }
  }
  snapshot(tabs = new Map()) {
    return this.items.map(item => ({ ...item, liveTabId: [...tabs.values()].find(tab => {
      try { return bookmarkUrl(tab.url) === item.url; } catch { return false; }
    })?.id || null }));
  }
  save(input = {}) {
    const url = bookmarkUrl(input.url);
    const existing = this.items.find(item => item.url === url);
    if (existing) return { ...existing };
    const item = { id: randomUUID(), url, title: cleanText(input.title) || new URL(url).hostname,
      favicon: typeof input.favicon === "string" && /^(https?:\/\/|data:image\/)/i.test(input.favicon) ? input.favicon.slice(0, 8192) : "",
      addedAt: Date.now(), readAt: null };
    this.write([...this.items, item]);
    return { ...item };
  }
  markRead(id, read) {
    const current = this.items.find(item => item.id === id);
    if (!current) return false;
    const updated = { ...current, readAt: read === true ? (current.readAt || Date.now()) : null };
    this.write(this.items.map(item => item.id === id ? updated : item));
    return true;
  }
  remove(id) { this.write(this.items.filter(item => item.id !== id)); }
  clear() { this.write([]); }
  write(items) {
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + ".tmp", JSON.stringify({ version: 1, items }), { mode: 0o600 });
      fs.renameSync(this.file + ".tmp", this.file);
    }
    this.items = items;
  }
}

module.exports = { ReadingListStore };
