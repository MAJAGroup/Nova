export const HOME_URL = "https://www.google.com";

export function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return "New tab"; }
}

export function searchUrl(query) {
  return HOME_URL + "/search?q=" + encodeURIComponent(query);
}

// Turns what the user typed into a URL: a web address as-is, a bare host
// (example.com, localhost:3000) over https, anything else as a search.
export function normalizeAddress(value) {
  const query = String(value || "").trim();
  if (!query) return HOME_URL;
  try {
    const parsed = new URL(query);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
  } catch (_) {}
  if (/^(localhost(?::\d+)?|[\w-]+(?:\.[\w-]+)+(?:\/[^\s]*)?)$/i.test(query)) return "https://" + query;
  return searchUrl(query);
}
