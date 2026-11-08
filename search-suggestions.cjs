"use strict";
const WEB_ENDPOINT = "https://suggestqueries.google.com/complete/search";
const clean = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";

function webQueryAllowed(value) {
  const query = clean(value);
  // Requests contain only ordinary search words, never full addresses,
  // credentials, email addresses, URL parameters, or long token-like strings.
  return query.length >= 2 && query.length <= 100 && !/[\/:\\@?#=]/.test(query)
    && !/^\S+\.\S+$/.test(query) && !/^[\w-]{28,}$/.test(query);
}
function localSuggestions(value, { visits = [], bookmarks = [], tabs = [], activeId = null } = {}) {
  const query = clean(value), needle = query.toLowerCase();
  const candidates = new Map();
  function add(item, source) {
    let url;
    try { url = new URL(item.url); if (!/^https?:$/.test(url.protocol)) return; } catch { return; }
    const title = clean(item.title) || url.hostname;
    const match = `${title} ${url.href}`.toLowerCase();
    const words = needle.split(/\s+/).filter(Boolean);
    if (words.some(word => !match.includes(word))) return;
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const score = (source === "tab" ? 100 : source === "bookmark" ? 60 : 0) + (needle && host.startsWith(needle) ? 80 : 0)
      + (needle && title.toLowerCase().startsWith(needle) ? 50 : 0);
    const at = Number(item.lastVisited || item.lastAccessed || item.at) || 0;
    const display = new URL(url); display.username = ""; display.password = "";
    const suggestion = { key: `url:${url.href}`, kind: source === "tab" ? "tab" : "url", source,
      value: url.href, label: title, description: display.href, tabId: source === "tab" ? String(item.id) : undefined, score, at };
    const previous = candidates.get(url.href);
    if (!previous || score > previous.score || score === previous.score && at > previous.at) candidates.set(url.href, suggestion);
  }
  for (const visit of visits) add(visit, "history");
  for (const bookmark of bookmarks) add(bookmark, "bookmark");
  for (const tab of tabs) if (String(tab.id) !== String(activeId)) add(tab, "tab");
  const results = [...candidates.values()].sort((a, b) => b.score - a.score || b.at - a.at).slice(0, query ? 6 : 7);
  if (query) {
    let address;
    if (query === "orbit://newtab" || query === "orbit://newtab/") address = "orbit://newtab";
    try {
      const parsed = new URL(/^https?:\/\//i.test(query) ? query : `https://${query}`);
      if (!/\s/.test(query) && (/^https?:\/\//i.test(query) || /^[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:[/?#]|$)/.test(query) || /^localhost(?::\d+)?(?:\/|$)/i.test(query) || /^\[[:\da-f]+\]/i.test(query))) address = parsed.href;
    } catch { /* Treat it as search text. */ }
    results.unshift({ key: "action", kind: address ? "url" : "search", source: "action", value: address || query,
      label: query.slice(0, 256), description: address ? "Visit address" : "Search Google" });
  }
  return results;
}
function createWebSuggestions(fetcher) {
  const cache = new Map();
  return async function suggestions(value, signal) {
    const query = clean(value); if (!webQueryAllowed(query)) return [];
    const key = query.toLowerCase(), cached = cache.get(key);
    if (cached && cached.until > Date.now()) return cached.rows;
    const url = new URL(WEB_ENDPOINT); url.searchParams.set("client", "firefox"); url.searchParams.set("q", query);
    try {
      const response = await fetcher(url.href, { signal, credentials: "omit", redirect: "error", cache: "no-store" });
      if (!response.ok) return [];
      const text = await response.text(); if (text.length > 65536) return [];
      const payload = JSON.parse(text);
      if (!Array.isArray(payload) || !Array.isArray(payload[1])) return [];
      const seen = new Set([key]);
      const rows = [];
      for (const value of payload[1]) {
        const label = clean(value).slice(0, 160); if (!label || seen.has(label.toLowerCase())) continue;
        seen.add(label.toLowerCase());
        rows.push({ key: `search:${label.toLowerCase()}`, kind: "search", source: "google", value: label, label, description: "Google suggestion" });
        if (rows.length === 6) break;
      }
      if (!signal?.aborted) {
        if (cache.size >= 50) cache.delete(cache.keys().next().value);
        cache.set(key, { until: Date.now() + 60000, rows });
      }
      return signal?.aborted ? [] : rows;
    } catch { return []; }
  };
}
module.exports = { localSuggestions, createWebSuggestions, webQueryAllowed };
