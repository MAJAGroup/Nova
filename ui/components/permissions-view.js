import { el } from "../lib/dom.js";
import { showToast } from "./toast.js";

const labels = {
  media: "Camera or microphone",
  geolocation: "Location",
  notifications: "Notifications",
  midi: "MIDI devices",
  "clipboard-read": "Clipboard access",
  "display-capture": "Screen sharing",
  hid: "USB or HID devices",
  serial: "Serial devices",
  usb: "USB devices"
};

export function createPermissionsView({ browser, onVisibilityChange = () => {} }) {
  const dialog = el("permissions-dialog");
  const list = el("permissions-list");
  const empty = el("permissions-empty");
  let entries = [];

  function render() {
    list.replaceChildren();
    empty.hidden = entries.length > 0;
    for (const entry of entries) {
      const group = document.createElement("section");
      group.className = "permission-origin";
      const heading = document.createElement("h3"); heading.textContent = entry.origin;
      group.append(heading);
      for (const permission of entry.permissions) {
        const row = document.createElement("div"); row.className = "permission-row";
        const name = document.createElement("span"); name.textContent = labels[permission] || permission;
        const revoke = document.createElement("button"); revoke.type = "button"; revoke.className = "permission-action";
        revoke.dataset.action = "revoke"; revoke.dataset.origin = entry.origin; revoke.dataset.permission = permission;
        revoke.textContent = "Revoke"; revoke.setAttribute("aria-label", `Revoke ${labels[permission] || permission} for ${entry.origin}`);
        row.append(name, revoke); group.append(row);
      }
      try {
        if (new URL(entry.origin).protocol !== "file:") {
          const clear = document.createElement("button"); clear.type = "button"; clear.className = "permission-clear-data";
          clear.dataset.action = "clear-site-data"; clear.dataset.origin = entry.origin; clear.textContent = "Clear cookies and site data";
          group.append(clear);
        }
      } catch { /* A permission can belong to Nova's local voice surface. */ }
      list.append(group);
    }
  }

  async function open() {
    if (!dialog.open) { dialog.showModal(); onVisibilityChange(true); }
    entries = await browser.getPermissions(); render();
  }
  list.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "revoke") browser.revokePermission(button.dataset.origin, button.dataset.permission);
    if (button.dataset.action === "clear-site-data") {
      const result = await browser.clearSiteData(button.dataset.origin);
      if (result?.ok) showToast(`Cleared stored data for ${result.origin}.`);
      else if (!result?.canceled) showToast(result?.error || "Could not clear website data.");
    }
  });
  browser.onPermissionsUpdated(next => { entries = Array.isArray(next) ? next : []; render(); });
  dialog.addEventListener("click", event => {
    if (event.target === dialog || event.target.closest("[data-close-utility]")) dialog.close();
  });
  dialog.addEventListener("close", () => onVisibilityChange(false));
  el("manage-site-permissions").addEventListener("click", open);
  return { open, close: () => dialog.close(), isOpen: () => dialog.open };
}
