import { el } from "../lib/dom.js";

export function createReadingListView({ browser, onVisibilityChange = () => {} }) {
  const dialog = el("reading-list-dialog");
  const list = el("reading-list-items");
  const empty = el("reading-list-empty");
  const search = el("reading-list-search");
  const clearRead = el("reading-list-clear");
  let items = [];

  function render() {
    const query = search.value.trim().toLowerCase();
    const visible = [...items].sort((a, b) => Number(Boolean(a.readAt)) - Number(Boolean(b.readAt)) || b.addedAt - a.addedAt)
      .filter(item => `${item.title} ${item.url}`.toLowerCase().includes(query));
    list.replaceChildren();
    empty.hidden = visible.length > 0;
    empty.textContent = query ? "No saved pages match this search." : "Save pages to read later. You can mark them read when you’re done.";
    clearRead.hidden = !items.some(item => item.readAt);
    for (const item of visible) {
      const row = document.createElement("article"); row.className = "reading-list-item"; row.setAttribute("role", "listitem");
      const icon = document.createElement("span"); icon.className = "reading-list-icon";
      if (item.favicon) { const image = document.createElement("img"); image.src = item.favicon; image.alt = ""; icon.append(image); }
      else { try { icon.textContent = new URL(item.url).hostname.slice(0, 1).toUpperCase(); } catch { icon.textContent = "↗"; } }
      const content = document.createElement("div"); content.className = "reading-list-copy";
      const title = document.createElement("strong"); title.textContent = item.title || item.url;
      const url = document.createElement("span"); url.textContent = item.url;
      const meta = document.createElement("small");
      meta.textContent = `${item.readAt ? "Read" : "Unread"} · Added ${new Date(item.addedAt).toLocaleDateString()}` + (item.liveTabId ? " · Open tab" : "");
      content.append(title, url, meta);
      const actions = document.createElement("div"); actions.className = "reading-list-actions";
      const addButton = (action, label, accessible) => {
        const button = document.createElement("button"); button.type = "button"; button.dataset.action = action; button.dataset.id = item.id;
        button.textContent = label; button.title = accessible; button.setAttribute("aria-label", `${accessible}: ${item.title || item.url}`); actions.append(button);
      };
      addButton("open", "Open", "Open page");
      addButton("toggle-read", item.readAt ? "Mark unread" : "Mark read", item.readAt ? "Mark as unread" : "Mark as read");
      addButton("remove", "×", "Remove from Reading List");
      row.append(icon, content, actions); list.append(row);
    }
  }

  async function open() {
    if (!dialog.open) { dialog.showModal(); onVisibilityChange(true); }
    items = await browser.getReadingList(); render(); search.focus();
  }
  list.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]"); if (!button) return;
    const item = items.find(entry => entry.id === button.dataset.id); if (!item) return;
    if (button.dataset.action === "open") void browser.openReadingListItem(item.id, { newTab: event.ctrlKey || event.metaKey, activate: !(event.ctrlKey || event.metaKey) });
    else if (button.dataset.action === "toggle-read") void browser.markReadingListItem(item.id, !item.readAt);
    else if (button.dataset.action === "remove") void browser.removeReadingListItem(item.id);
  });
  search.addEventListener("input", render);
  el("reading-list-add-current").addEventListener("click", async () => {
    await browser.addCurrentToReadingList();
  });
  clearRead.addEventListener("click", async () => {
    const read = items.filter(item => item.readAt);
    await Promise.all(read.map(item => browser.removeReadingListItem(item.id)));
  });
  browser.onReadingListUpdated(next => { items = Array.isArray(next) ? next : []; render(); });
  dialog.addEventListener("click", event => {
    if (event.target === dialog || event.target.closest("[data-close-utility]")) dialog.close();
  });
  dialog.addEventListener("close", () => onVisibilityChange(false));
  el("reading-list-toggle").addEventListener("click", open);
  return { open, close: () => dialog.close(), isOpen: () => dialog.open };
}
