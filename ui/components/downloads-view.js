import { el } from "../lib/dom.js";

const humanSize = bytes => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
};

export function createDownloadsView({ browser, onVisibilityChange = () => {} }) {
  const dialog = el("downloads-dialog");
  const list = el("downloads-list");
  const empty = el("downloads-empty");
  let items = [];

  function render() {
    list.replaceChildren();
    empty.hidden = items.length > 0;
    for (const item of items) {
      const row = document.createElement("article");
      row.className = "download-row";
      row.setAttribute("role", "listitem");
      const detail = document.createElement("div"); detail.className = "download-detail";
      const name = document.createElement("strong"); name.textContent = item.filename || "Download";
      const status = document.createElement("span");
      status.textContent = item.state === "progressing"
        ? `${item.paused ? "Paused" : "Downloading"} · ${humanSize(item.receivedBytes)}${item.totalBytes > 0 ? ` of ${humanSize(item.totalBytes)}` : ""}`
        : item.state === "completed" ? (item.savePath || "Completed")
          : item.state === "interrupted" ? "Interrupted" : "Cancelled";
      detail.append(name, status);
      const progress = document.createElement("progress");
      progress.max = 100; progress.value = item.percent || 0;
      progress.hidden = item.state !== "progressing";
      const actions = document.createElement("div"); actions.className = "download-actions";
      const addButton = (action, label, title) => {
        const button = document.createElement("button");
        button.type = "button"; button.dataset.action = action; button.dataset.id = item.id;
        button.textContent = label; button.title = title; button.setAttribute("aria-label", `${title}: ${name.textContent}`);
        actions.append(button);
      };
      if (item.state === "progressing") {
        addButton(item.paused ? "resume" : "pause", item.paused ? "▶" : "Ⅱ", item.paused ? "Resume download" : "Pause download");
        addButton("cancel", "×", "Cancel download");
      } else if (item.state === "completed") {
        addButton("open", "↗", "Open downloaded file");
        addButton("reveal", "⌕", "Show in folder");
        addButton("remove", "×", "Remove from downloads");
      } else {
        addButton("remove", "×", "Remove from downloads");
      }
      row.append(detail, progress, actions);
      list.append(row);
    }
  }

  async function open() {
    if (!dialog.open) { dialog.showModal(); onVisibilityChange(true); }
    items = await browser.getDownloads();
    render();
  }
  list.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    void browser.downloadAction(button.dataset.id, button.dataset.action);
  });
  browser.onDownloadsUpdated(next => { items = Array.isArray(next) ? next : []; render(); });
  dialog.addEventListener("click", event => {
    if (event.target === dialog || event.target.closest("[data-close-utility]")) dialog.close();
  });
  dialog.addEventListener("close", () => onVisibilityChange(false));
  document.getElementById("downloads-toggle").addEventListener("click", open);
  return { open, close: () => dialog.close(), isOpen: () => dialog.open };
}
