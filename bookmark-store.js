"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function bookmarkUrl(value) {
  if (typeof value !== "string" || value.length > 8192) throw Error("Enter a valid http or https website address.");
  let url;
  try { url = new URL(value.trim()); } catch { throw Error("Enter a full website address, including https:// or http://."); }
  if (!/^https?:$/.test(url.protocol)) throw Error("Only http and https pages can be bookmarked.");
  url.username = ""; url.password = "";
  return url.href;
}
const text = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 512) : "";
const icon = value => typeof value === "string" && /^(https?:\/\/|data:image\/)/i.test(value) ? value.slice(0, 8192) : "";

class BookmarkStore {
  constructor(file) {
    this.file = file; this.items = [];
    if (!file || !fs.existsSync(file)) return;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(data.bookmarks)) throw Error("Invalid bookmarks file");
    const urls = new Set(), ids = new Set();
    for (const item of data.bookmarks) {
      try {
        if (!item || typeof item.id !== "string" || !/^[\w-]+$/.test(item.id) || ids.has(item.id)) continue;
        const url = bookmarkUrl(item.url); if (urls.has(url)) continue;
        this.items.push({ id: item.id, url, title: text(item.title) || new URL(url).hostname,
          favicon: icon(item.favicon), at: Number.isFinite(item.at) && item.at > 0 ? item.at : Date.now() });
        urls.add(url); ids.add(item.id);
      } catch { /* Skip invalid imported entries without accepting executable URLs. */ }
    }
  }
  has(url) { try { return this.items.some(item => item.url === bookmarkUrl(url)); } catch { return false; } }
  snapshot(tabs = new Map()) {
    return this.items.map(item => ({ ...item, liveTabId: [...tabs.values()].find(tab => {
      try { return bookmarkUrl(tab.url) === item.url; } catch { return false; }
    })?.id || null }));
  }
  save(input = {}) {
    const url = bookmarkUrl(input.url);
    const existing = input.id ? this.items.find(item => item.id === input.id) : this.items.find(item => item.url === url);
    if (input.id && !existing) throw Error("This bookmark no longer exists.");
    if (this.items.some(item => item.url === url && item.id !== existing?.id)) throw Error("That page is already bookmarked.");
    const item = { id: existing?.id || randomUUID(), url, title: text(input.title) || new URL(url).hostname,
      favicon: input.favicon === undefined ? (existing?.url === url ? existing.favicon : "") : icon(input.favicon), at: existing?.at || Date.now() };
    const next = existing ? this.items.map(row => row.id === item.id ? item : row) : [...this.items, item];
    this.write(next); return { ...item };
  }
  remove(id) { const next = this.items.filter(item => item.id !== id); this.write(next); }
  clear() { this.write([]); }
  write(items) {
    // Commit to memory only after the atomic write succeeds, so errors cannot
    // report a bookmark as saved when it was not persisted.
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + ".tmp", JSON.stringify({ version: 1, bookmarks: items }), { mode: 0o600 });
      fs.renameSync(this.file + ".tmp", this.file);
    }
    this.items = items;
  }
}
module.exports = { BookmarkStore, bookmarkUrl };
