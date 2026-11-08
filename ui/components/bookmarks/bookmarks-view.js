import { createHistoryView } from "../history/history-view.js";
import { bookmarkVisits, bookmarksLayout } from "./bookmarks-layout.mjs";
import { showToast } from "../toast.js";

export function createBookmarksView({ browser, tabs, onVisibilityChange, onEditorVisibilityChange }) {
  const root = document.getElementById("bookmarks");
  const editor = document.getElementById("bookmark-editor");
  const form = document.getElementById("bookmark-editor-form");
  const title = document.getElementById("bookmark-title"), url = document.getElementById("bookmark-url");
  const error = document.getElementById("bookmark-editor-error");
  let editing = null, restoreFocus = null, busy = false;
  function closeEditor() {
    if (!editor.open || busy) return;
    editor.close(); editing = null; onEditorVisibilityChange(false);
    if (restoreFocus?.isConnected) restoreFocus.focus();
    else if (!root.hidden) root.querySelector(".history-search").focus();
    else document.getElementById("bookmark-page").focus();
  }
  function edit(bookmark) {
    if (busy) return;
    restoreFocus = document.activeElement; editing = bookmark.id;
    title.value = bookmark.title; url.value = bookmark.url; error.hidden = true;
    onEditorVisibilityChange(true); if (!editor.open) editor.showModal();
    title.focus(); title.select();
  }
  async function remove(bookmark) {
    try {
      const result = await browser.removeBookmark(bookmark.id);
      if (!result.ok) throw Error(result.error);
      showToast("Bookmark removed"); return true;
    } catch (failure) { showToast(failure.message); return false; }
  }
  async function bookmarkCurrent() {
    if (busy || editor.open || !/^https?:\/\//i.test(tabs.activeTab()?.url || "")) return;
    try {
      const current = new URL(tabs.activeTab().url); current.username = ""; current.password = "";
      const existing = (await browser.getBookmarks()).find(bookmark => bookmark.url === current.href);
      if (existing) { edit(existing); return; }
      const result = await browser.saveBookmark();
      if (!result.ok) throw Error(result.error);
      edit(result.bookmark); showToast("Page bookmarked");
    } catch (failure) { showToast(failure.message); }
  }
  const view = createHistoryView({
    browser: {
      getHistory: async () => bookmarkVisits(await browser.getBookmarks()),
      onHistoryUpdated: callback => browser.onBookmarksUpdated(items => callback(bookmarkVisits(items))),
      openHistory: id => browser.openBookmark(id),
      clearHistory: async () => { const result = await browser.clearBookmarks(); if (!result.ok) showToast(result.error); }
    },
    collection: "bookmarks", layout: bookmarksLayout, onEdit: edit, onRemove: remove, onVisibilityChange
  });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy || !editing) return;
    busy = true; form.querySelector('[type="submit"]').disabled = true;
    try {
      const result = await browser.saveBookmark({ id: editing, title: title.value, url: url.value });
      if (!result.ok) throw Error(result.error);
      busy = false; closeEditor(); showToast("Bookmark updated");
    } catch (failure) { error.textContent = failure.message; error.hidden = false; }
    finally { busy = false; form.querySelector('[type="submit"]').disabled = false; }
  });
  document.getElementById("bookmark-editor-remove").onclick = async () => {
    if (busy || !editing) return;
    busy = true; const removed = await remove({ id: editing }); busy = false;
    if (removed) closeEditor();
  };
  document.getElementById("bookmark-editor-close").onclick = closeEditor;
  document.getElementById("bookmark-editor-cancel").onclick = closeEditor;
  editor.addEventListener("cancel", event => { event.preventDefault(); closeEditor(); });
  editor.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
  const saveCurrent = root.querySelector(".bookmarks-save-current"); saveCurrent.onclick = bookmarkCurrent;
  root.querySelector(".bookmark-transfer").addEventListener("click", () => browser.showBookmarkTransferMenu());
  tabs.subscribe(() => { saveCurrent.disabled = !/^https?:\/\//i.test(tabs.activeTab()?.url || ""); });
  return { ...view, bookmarkCurrent, closeEditor, isEditorOpen: () => editor.open };
}
