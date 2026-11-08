export const HOME_URL = "nova://newtab";

// Display-only elision. Preserve paths, queries, fragments, ports and every
// other subdomain; never rewrite the URL that is loaded, edited or copied.
export function simplifyAddress(value) {
  if (value === HOME_URL) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return value || "";
    const scheme = url.protocol === "http:" ? "http://" : "";
    const host = url.host.replace(/^www\./i, "");
    const path = url.pathname === "/" && !url.search && !url.hash ? "" : url.pathname;
    return scheme + host + path + url.search + url.hash;
  } catch { return value || ""; }
}

export function domainOf(url) {
  if (url === HOME_URL) return "New tab";
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return "New tab"; }
}

export function searchUrl(query) {
  return "https://www.google.com/search?q=" + encodeURIComponent(query);
}

// Turns what the user typed into a URL: a web address as-is, a bare host
// (example.com, localhost:3000) over https, anything else as a search.
export function normalizeAddress(value) {
  const query = String(value || "").trim();
  if (!query) return HOME_URL;
  if (query === HOME_URL || query === HOME_URL + "/") return HOME_URL;
  try {
    const parsed = new URL(query);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
  } catch (_) {}
  if (/^(localhost(?::\d+)?|[\w-]+(?:\.[\w-]+)+(?:\/[^\s]*)?)$/i.test(query)) return "https://" + query;
  return searchUrl(query);
}
