import { historyLayout } from "../history/history-layout.mjs";

const website = url => new URL(url).hostname.replace(/^www\./, "");

// A bookmark connection means "same website", never a browsing-history trail.
// Keep every bookmark's identity and saved date while reusing the tree layout.
export function bookmarkVisits(bookmarks) {
  const roots = new Map();
  return [...bookmarks].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).map(bookmark => {
    const host = website(bookmark.url), parent = roots.get(host) || null;
    if (!parent) roots.set(host, bookmark.id);
    return { ...bookmark, parent, kind: "bookmark" };
  });
}

export function bookmarksLayout(visits, allVisits = visits) {
  const shape = historyLayout(visits, allVisits);
  const byId = new Map(allVisits.map(visit => [visit.id, visit]));
  for (const group of shape.groups) group.name = website(byId.get(group.id).url);
  return shape;
}
