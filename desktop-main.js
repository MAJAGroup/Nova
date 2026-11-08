"use strict";

const {
  app,
  BrowserWindow,
  WebContentsView,
  clipboard,
  ipcMain,
  Menu,
  dialog,
  safeStorage,
  screen,
  shell,
  net,
  session
} = require("electron");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const START_PAGE_URL = pathToFileURL(path.join(__dirname, "ui", "newtab", "index.html")).href;
const START_PAGE_ICON = pathToFileURL(path.join(__dirname, "ui", "newtab", "icon.svg")).href;
const isStartPage = url => url === START_PAGE_URL;
const START_PAGE_FOCUS_SCRIPT = `(() => { const focus = () => { const input = document.getElementById("start-search"); if (input) input.focus({ preventScroll: true }); }; requestAnimationFrame(() => requestAnimationFrame(focus)); })()`;

function focusStartSearch(tab) {
  if (!tab || tab.view.webContents.isDestroyed()) return;
  const currentUrl = tab.view.webContents.getURL() || tab.url;
  if (!isStartPage(currentUrl)) return;
  tab.view.webContents.executeJavaScript(START_PAGE_FOCUS_SCRIPT).catch(() => {});
}
const { createTabGroups } = require("./tab-groups");
const { buildGroupingMessages, parseGroupingPlan } = require("./ai-grouping");
const { runAgent } = require("./ai-agent");

const { HistoryStore } = require("./history-store");
const { BookmarkStore } = require("./bookmark-store");
const { ReadingListStore } = require("./reading-list-store");
const { registerLinuxDesktop } = require("./linux-desktop");
const { createTabResourceView } = require("./tab-resources-view");
const { configureNovaProfile } = require("./profile-migration");
const { trackConnectionSecurity } = require("./connection-security");
const { localSuggestions, createWebSuggestions } = require("./search-suggestions.cjs");
const fetchWebSuggestions = createWebSuggestions((url, options) => net.fetch(url, options));
const suggestionRequests = new Map();
const launch = configureNovaProfile(app);
let visitHistory;
let bookmarks;
let readingList;

const tabs = new Map();
const groups = createTabGroups();
const permissionGrants = new Map();
const closedTabs = [];
const downloads = new Map();
const siteZoomLevels = new Map();
const hiddenBounds = { x: 0, y: 0, width: 0, height: 0 };
let mainWindow = null;
let assistantHandleView = null;
let tabResourceView = null;
let activeTabId = null;
// A tab the assistant opened beside the current page. It is an ordinary tab
// shown next to the active one until it is closed or switched to.
let sideTabId = null;
let multiView = null; // { kind: "tabs", leftId, rightId } or { kind: "orbit", tabId }
let orbitSceneVisible = false;
let nextTabId = 1;
let nextDownloadId = 1;
let browserBounds = { ...hiddenBounds };
let assistantExpanded = false;
let sideBounds = { ...hiddenBounds };
let settingsCache = null;
let restoreSessionOnLaunch = true;
let clearDataOnExit = false;
let clearingDataForExit = false;
let searchProvider = "google";
let sessionRestoreSnapshot = null;
let sessionSaveTimer = null;

function normalizeDestination(input) {
  const value = String(input || "").trim();
  if (!value || value === "nova://newtab" || value === "nova://newtab/" || isStartPage(value)) return START_PAGE_URL;

  const looksLikeHost = /^(localhost(?::\d+)?|[\w-]+(?:\.[\w-]+)+(?:\/[^\s]*)?)$/i.test(value);
  if (looksLikeHost) {
    try { return new URL("https://" + value).href; } catch (_) {}
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
    return searchDestination(value);
  } catch (_) {
    return searchDestination(value);
  }
}

const searchProviders = {
  google: query => "https://www.google.com/search?q=" + encodeURIComponent(query),
  bing: query => "https://www.bing.com/search?q=" + encodeURIComponent(query),
  duckduckgo: query => "https://duckduckgo.com/?q=" + encodeURIComponent(query),
  brave: query => "https://search.brave.com/search?q=" + encodeURIComponent(query)
};

function searchDestination(input) {
  const value = String(input || "").trim();
  const keyword = value.match(/^(g|google|b|bing|ddg|duckduckgo|br|brave):?\s+(.+)$/i);
  if (keyword) {
    const provider = /^(g|google)$/i.test(keyword[1]) ? "google" : /^(b|bing)$/i.test(keyword[1]) ? "bing" : /^(br|brave)$/i.test(keyword[1]) ? "brave" : "duckduckgo";
    return searchProviders[provider](keyword[2]);
  }
  return searchProviders[searchProvider](value);
}

function navigateActive(input, { searchOnly = false } = {}) {
  const target = searchOnly ? searchDestination(input) : normalizeDestination(input);
  if (!activeTabId || !tabs.has(activeTabId)) return createTab(target);
  const tab = tabs.get(activeTabId);
  tab.freshNavigation = true;
  tab.view.webContents.loadURL(target).catch(() => {});
  return target;
}

function isWebUrl(value) {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch (_) {
    return false;
  }
}

function tabSnapshot(tab) {
  const contents = tab.view.webContents;
  const history = contents.navigationHistory;
  return {
    id: tab.id,
    title: tab.title || "New tab",
    url: isStartPage(tab.url) ? "nova://newtab" : tab.url || "",
    isStartPage: isStartPage(tab.url),
    bookmarked: bookmarks.has(tab.url),
    favicon: tab.favicon || "",
    active: tab.id === activeTabId,
    side: tab.id === sideTabId,
    multiTab: multiView?.kind === "tabs" && (tab.id === multiView.leftId || tab.id === multiView.rightId),
    loading: tab.loading,
    lastAccessed: tab.lastAccessed,
    canGoBack: history.canGoBack(),
    canGoForward: history.canGoForward(),
    pinned: tab.pinned === true,
    audible: contents.isCurrentlyAudible(),
    muted: contents.isAudioMuted(),
    zoomLevel: contents.getZoomLevel(),
    currentVisit: tab.currentVisit,
    connection: isStartPage(tab.url) ? { state: "local", message: "Nova start page — stored on this device" } : tab.connection?.snapshot(tab.url),
    groupId: tab.groupId || null
  };
}

function tabsPayload() {
  groups.prune(tabs);
  return {
    tabs: Array.from(tabs.values()).map(tabSnapshot),
    groups: groups.list(),
    activeId: activeTabId,
    sideId: sideTabId,
    multiView
  };
}

function sendTabs() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  tabResourceView?.refresh();
  mainWindow.webContents.send("browser:tabs-updated", tabsPayload());
  mainWindow.webContents.send("browser:history-updated", visitHistory.snapshot(tabs));
  mainWindow.webContents.send("browser:bookmarks-updated", bookmarks.snapshot(tabs));
  mainWindow.webContents.send("browser:reading-list-updated", readingList?.snapshot(tabs) || []);
  scheduleSessionSave();
}

function sessionSnapshotPath() {
  return path.join(app.getPath("userData"), "nova-session.json");
}

function saveSessionSnapshot() {
  clearTimeout(sessionSaveTimer); sessionSaveTimer = null;
  try {
    const snapshot = {
      version: 1,
      activeIndex: Array.from(tabs.keys()).indexOf(activeTabId),
      tabs: Array.from(tabs.values()).map(tab => ({
        url: isStartPage(tab.url) ? "nova://newtab" : isWebUrl(tab.url) ? tab.url : "",
        title: tab.title, favicon: tab.favicon, pinned: tab.pinned === true,
        groupName: tab.groupId ? groups.get(tab.groupId)?.name || "" : ""
      })).filter(tab => tab.url),
      closedTabs: closedTabs.slice(-25).map(tab => ({
        url: isStartPage(tab.url) ? "nova://newtab" : isWebUrl(tab.url) ? tab.url : "",
        title: tab.title, favicon: tab.favicon, pinned: tab.pinned === true,
        groupName: tab.groupName || (tab.groupId ? groups.get(tab.groupId)?.name || "" : "")
      })).filter(tab => tab.url)
    };
    const destination = sessionSnapshotPath();
    fsSync.mkdirSync(path.dirname(destination), { recursive: true });
    fsSync.writeFileSync(destination + ".tmp", JSON.stringify(snapshot), { mode: 0o600 });
    fsSync.renameSync(destination + ".tmp", destination);
  } catch (error) { console.error("Could not save the previous session:", error.message); }
}

function scheduleSessionSave() {
  if (!app.isReady()) return;
  clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(saveSessionSnapshot, 500);
  sessionSaveTimer.unref?.();
}

function restoreSavedTabs() {
  const saved = sessionRestoreSnapshot;
  sessionRestoreSnapshot = null;
  if (!restoreSessionOnLaunch || !saved || !Array.isArray(saved.tabs)) return false;
  const groupIds = new Map();
  const restored = [];
  let restoredActiveId = null;
  for (const [savedIndex, item] of saved.tabs.slice(0, 100).entries()) {
    const url = item.url === "nova://newtab" ? START_PAGE_URL : isWebUrl(item.url) ? item.url : "";
    if (!url) continue;
    let groupId = null;
    if (typeof item.groupName === "string" && item.groupName.trim()) {
      const name = item.groupName.trim().slice(0, 64);
      if (!groupIds.has(name)) groupIds.set(name, groups.create(name));
      groupId = groupIds.get(name);
    }
    const id = createTab(url, { groupId, activate: false });
    const tab = id && tabs.get(id);
    if (!tab) continue;
    tab.title = typeof item.title === "string" ? item.title.slice(0, 512) : tab.title;
    tab.favicon = typeof item.favicon === "string" && /^(https?:|data:image\/)/i.test(item.favicon) ? item.favicon.slice(0, 8192) : "";
    tab.pinned = item.pinned === true;
    restored.push(id);
    if (savedIndex === saved.activeIndex) restoredActiveId = id;
  }
  closedTabs.length = 0;
  for (const item of Array.isArray(saved.closedTabs) ? saved.closedTabs.slice(-25) : []) {
    const url = item?.url === "nova://newtab" ? START_PAGE_URL : isWebUrl(item?.url) ? item.url : "";
    if (!url) continue;
    let groupId = null;
    if (typeof item.groupName === "string" && item.groupName.trim()) {
      const name = item.groupName.trim().slice(0, 64);
      if (!groupIds.has(name)) groupIds.set(name, groups.create(name));
      groupId = groupIds.get(name);
    }
    closedTabs.push({ url, title: typeof item.title === "string" ? item.title.slice(0, 512) : "",
      favicon: typeof item.favicon === "string" && /^(https?:|data:image\/)/i.test(item.favicon) ? item.favicon.slice(0, 8192) : "",
      pinned: item.pinned === true, groupId });
  }
  if (restored.length) {
    reorderTabs(restored);
    setActiveTab(restoredActiveId && tabs.has(restoredActiveId) ? restoredActiveId : restored[0]);
    return true;
  }
  return false;
}

// Puts tabs into a group: an existing one (groupId) or a new one (optional
// name). Returns the group id, or null when none of the tabs exist.
function groupTabs(tabIds, { groupId, name } = {}) {
  const members = (Array.isArray(tabIds) ? tabIds : [tabIds])
    .map((id) => tabs.get(String(id)))
    .filter(Boolean);
  if (!members.length) return null;
  const target = groupId && groups.get(groupId) ? String(groupId) : groups.create(name);
  for (const tab of members) tab.groupId = target;
  sendTabs();
  return target;
}

function ungroupTabs(tabIds) {
  for (const id of Array.isArray(tabIds) ? tabIds : [tabIds]) {
    const tab = tabs.get(String(id));
    if (tab) tab.groupId = null;
  }
  sendTabs();
}

function removeGroup(groupId) {
  for (const tab of tabs.values()) if (tab.groupId === String(groupId)) tab.groupId = null;
  sendTabs();
}

function showTabMenu(id, selectedIds = []) {
  const tab = tabs.get(String(id));
  if (!tab || !mainWindow) return;
  const targets = Array.isArray(selectedIds) ? [...new Set(selectedIds.map(String).filter(tabId => tabs.has(tabId)))] : [];
  if (!targets.includes(tab.id)) targets.push(tab.id);
  const targetIds = targets.length > 1 ? targets : [tab.id];
  const current = tab.groupId ? groups.get(tab.groupId) : null;
  const others = groups.list().filter((group) => group.id !== tab.groupId);
  const template = [
    { label: "Duplicate tab", click: () => duplicateTab(tab.id) },
    { label: tab.pinned ? "Unpin tab" : "Pin tab", click: () => pinTab(tab.id, !tab.pinned) },
    { label: tab.view.webContents.isAudioMuted() ? "Unmute tab" : "Mute tab", click: () => targetIds.forEach(targetId => { const target = tabs.get(targetId); if (target) setTabMuted(targetId, !target.view.webContents.isAudioMuted()); }) },
    { type: "separator" },
    { label: targetIds.length > 1 ? `New constellation with ${targetIds.length} tabs` : "New constellation with this tab", click: () => groupTabs(targetIds) }
  ];
  if (others.length) {
    template.push({
      label: "Add to constellation",
      submenu: others.map((group) => ({ label: group.name, click: () => groupTabs(targetIds, { groupId: group.id }) }))
    });
  }
  if (current) {
    template.push(
      ...(others.length ? [{
        label: "Merge all tabs into…",
        submenu: others.map((group) => ({
          label: group.name,
          click: () => {
            const memberIds = Array.from(tabs.values())
              .filter((member) => String(member.groupId) === String(current.id))
              .map((member) => member.id);
            groupTabs(memberIds, { groupId: group.id });
          }
        }))
      }] : []),
      { type: "separator" },
      { label: "Remove from " + current.name, click: () => ungroupTabs(targetIds) },
      { label: "Rename " + current.name + "…", click: () => sendCommand("rename-group", { focusUI: true, arg: current.id }) },
      { label: "Ungroup " + current.name, click: () => removeGroup(current.id) }
    );
  }
  const ordered = Array.from(tabs.keys());
  const index = ordered.indexOf(tab.id);
  const otherTabs = ordered.filter((tabId) => tabId !== tab.id);
  const tabsToRight = ordered.slice(index + 1);
  const previousTabId = ordered[index - 1];
  const nextTabId = ordered[index + 1];
  if (targetIds.length === 2 || previousTabId || nextTabId) {
    template.push({ type: "separator" });
    if (targetIds.length === 2) {
      const pair = ordered.filter(tabId => targetIds.includes(tabId));
      template.push({ label: "Split selected tabs side by side", click: () => setMultiTabPair(pair[0], pair[1]) });
    }
    if (previousTabId) template.push({ label: "Split with previous tab", click: () => setMultiTabPair(previousTabId, tab.id) });
    if (nextTabId) template.push({ label: "Split with next tab", click: () => setMultiTabPair(tab.id, nextTabId) });
    template.push({ label: "Pair with Orbit scene", click: () => setOrbitMultiView(tab.id) });
  }
  template.push(
    { type: "separator" },
    { label: "Close other tabs", enabled: otherTabs.length > 0, click: () => otherTabs.forEach((tabId) => closeTab(tabId)) },
    { label: "Close tabs to the right", enabled: tabsToRight.length > 0, click: () => tabsToRight.forEach((tabId) => closeTab(tabId)) },
    { label: "Close tab", click: () => closeTab(tab.id) }
  );
  Menu.buildFromTemplate(template).popup({ window: mainWindow });
}

function showNavigationMenu(direction) {
  const contents = activeContents();
  if (!contents || !mainWindow || !["back", "forward"].includes(direction)) return;
  const history = contents.navigationHistory;
  const entries = history.getAllEntries();
  const activeIndex = history.getActiveIndex();
  const indices = entries.map((_, index) => index).filter(index => direction === "back" ? index < activeIndex : index > activeIndex);
  indices.sort((a, b) => direction === "back" ? b - a : a - b);
  const template = indices.slice(0, 20).map(index => {
    const entry = entries[index];
    const title = String(entry.title || entry.url || "Page").replace(/\s+/g, " ");
    return { label: title.length > 64 ? title.slice(0, 61) + "…" : title, click: () => history.goToIndex(index) };
  });
  if (!template.length) return;
  Menu.buildFromTemplate(template).popup({ window: mainWindow });
}

function showAddressMenu() {
  if (!mainWindow) return;
  const pasted = clipboard.readText().trim().slice(0, 8192);
  const template = [
    { role: "undo" }, { role: "redo" }, { type: "separator" },
    { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
    { type: "separator" },
    { label: "Paste and Go", enabled: Boolean(pasted), click: () => navigateActive(pasted) },
    { label: "Paste and Search", enabled: Boolean(pasted), click: () => navigateActive(pasted, { searchOnly: true }) },
    { label: "Open Clipboard in New Tab", enabled: Boolean(pasted), click: () => createTab(normalizeDestination(pasted)) }
  ];
  Menu.buildFromTemplate(template).popup({ window: mainWindow });
}

function showHistoryMenu(id) {
  const visit = visitHistory.nodes.find(node => node.id === String(id));
  if (!visit || !mainWindow) return;
  const hostname = (() => { try { return new URL(visit.url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const removeSite = () => {
    const ids = visitHistory.nodes.filter(node => {
      try { const current = new URL(node.url).hostname.replace(/^www\./, ""); return current === hostname || current.endsWith("." + hostname); } catch { return false; }
    }).map(node => node.id);
    const count = visitHistory.removeMany(ids, tabs);
    if (count) { sendTabs(); sendCommand("toast", { arg: `Removed ${count} visit${count === 1 ? "" : "s"} from ${hostname}.` }); }
  };
  Menu.buildFromTemplate([
    { label: "Open page", click: () => openHistoryVisit(visit.id) },
    { label: "Open in new tab", click: () => createTab(visit.url, { openerVisit: visit.id }) },
    { label: "Open in background tab", click: () => createTab(visit.url, { openerVisit: visit.id, activate: false }) },
    { label: "Copy link address", click: () => clipboard.writeText(visit.url) },
    { type: "separator" },
    { label: "Remove this visit", click: () => { visitHistory.remove(visit.id, tabs); sendTabs(); sendCommand("toast", { arg: "Removed from browsing history." }); } },
    ...(hostname ? [{ label: `Remove all history from ${hostname}`, click: removeSite }] : [])
  ]).popup({ window: mainWindow });
}

function showHistoryDateMenu(key) {
  if (!mainWindow || typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
  const [year, month, day] = key.split("-").map(Number);
  const start = new Date(year, month - 1, day).getTime();
  const end = new Date(year, month - 1, day + 1).getTime();
  const count = visitHistory.nodes.filter(node => node.at >= start && node.at < end).length;
  if (!count) return;
  Menu.buildFromTemplate([
    { label: `Remove ${count} visit${count === 1 ? "" : "s"} from this date`, click: () => {
      const ids = visitHistory.nodes.filter(node => node.at >= start && node.at < end).map(node => node.id);
      const removed = visitHistory.removeMany(ids, tabs);
      if (removed) { sendTabs(); sendCommand("toast", { arg: `Removed ${removed} visits from history.` }); }
    } }
  ]).popup({ window: mainWindow });
}

function saveToReadingList(input) {
  if (!readingList || !input || !isWebUrl(input.url)) return false;
  const existed = readingList.items.some(item => item.url === input.url);
  try {
    const item = readingList.save(input);
    sendTabs();
    sendCommand("toast", { arg: existed ? "This page is already in your Reading List." : "Added to your Reading List." });
    return item;
  } catch (error) {
    sendCommand("toast", { arg: error.message || "Could not add this page to the Reading List." });
    return false;
  }
}

function openHistoryVisit(id, options = {}) {
  const { newTab = false, activate = true } = options && typeof options === "object" ? options : {};
  const node = visitHistory.nodes.find(item => item.id === String(id));
  if (!node) return false;
  const live = Array.from(tabs.values()).find(tab => tab.currentVisit === id);
  if (live && !newTab) return setActiveTab(live.id);
  return createTab(node.url, { openerVisit: node.id, activate });
}

function activeContents() {
  return activeTabId ? tabs.get(activeTabId)?.view.webContents || null : null;
}

function setActiveZoom(level) {
  const contents = activeContents();
  if (!contents) return false;
  const next = Math.max(-7.6, Math.min(8.8, Number(level) || 0));
  contents.setZoomLevel(next);
  const origin = permissionOrigin(contents.getURL());
  if (origin) {
    siteZoomLevels.set(origin, next);
    void readSettings().then(settings => {
      settings.siteZoomLevels = Object.fromEntries(siteZoomLevels);
      return writeSettings(settings);
    }).catch(error => console.error("Could not save site zoom:", error.message));
  }
  sendTabs();
  return true;
}

function adjustActiveZoom(delta) {
  const contents = activeContents();
  return contents ? setActiveZoom(contents.getZoomLevel() + delta) : false;
}

function cycleTab(direction) {
  const ordered = Array.from(tabs.keys());
  if (ordered.length < 2) return false;
  const current = ordered.indexOf(activeTabId);
  const next = (current + direction + ordered.length) % ordered.length;
  return setActiveTab(ordered[next]);
}

function moveTab(id, direction) {
  const ordered = Array.from(tabs.values());
  const index = ordered.findIndex(tab => tab.id === String(id));
  if (index < 0 || !Number.isFinite(direction) || direction === 0) return false;
  const tab = ordered[index];
  const pinnedCount = ordered.filter(item => item.pinned === true).length;
  const minimum = tab.pinned ? 0 : pinnedCount;
  const maximum = tab.pinned ? Math.max(0, pinnedCount - 1) : ordered.length - 1;
  const target = Math.max(minimum, Math.min(maximum, index + Math.sign(direction)));
  if (target === index) return false;
  ordered.splice(index, 1);
  ordered.splice(target, 0, tab);
  return reorderTabs(ordered.map(item => item.id));
}

function activateTabNumber(number) {
  const ordered = Array.from(tabs.keys());
  if (!ordered.length) return false;
  const index = number === 9 ? ordered.length - 1 : number - 1;
  return index >= 0 && index < ordered.length ? setActiveTab(ordered[index]) : false;
}

function reopenClosedTab(reverseIndex = 0) {
  const index = closedTabs.length - 1 - Math.max(0, Math.min(closedTabs.length - 1, Number(reverseIndex) || 0));
  const closed = closedTabs.splice(index, 1)[0];
  if (!closed) return false;
  let groupId = closed.groupId && groups.get(closed.groupId) ? closed.groupId : null;
  if (!groupId && closed.groupName) {
    const existing = groups.list().find(group => group.name.toLowerCase() === closed.groupName.toLowerCase());
    groupId = existing ? existing.id : groups.create(closed.groupName);
  }
  const id = createTab(closed.url, { groupId, activate: true });
  const tab = id && tabs.get(id);
  if (tab) {
    tab.title = closed.title || tab.title;
    tab.favicon = closed.favicon || "";
    tab.pinned = closed.pinned === true;
    if (tab.pinned) pinTab(tab.id, true);
  }
  sendTabs();
  return Boolean(id);
}

function showRecentlyClosedMenu() {
  if (!mainWindow) return;
  const recent = [...closedTabs].reverse().slice(0, 15);
  const template = recent.length
    ? recent.map((tab, index) => ({ label: String(tab.title || tab.url || "Closed tab").replace(/\s+/g, " ").slice(0, 76), click: () => reopenClosedTab(index) }))
    : [{ label: "No recently closed tabs", enabled: false }];
  Menu.buildFromTemplate(template).popup({ window: mainWindow });
}

function pinTab(id, pinned) {
  const tab = tabs.get(String(id));
  if (!tab) return false;
  tab.pinned = pinned === true;
  const ordered = Array.from(tabs.values());
  ordered.sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true));
  tabs.clear();
  for (const item of ordered) tabs.set(item.id, item);
  sendTabs();
  return true;
}

function setTabMuted(id, muted) {
  const tab = tabs.get(String(id));
  if (!tab) return false;
  tab.view.webContents.setAudioMuted(muted === true);
  sendTabs();
  return true;
}

function duplicateTab(id) {
  const tab = tabs.get(String(id));
  return tab ? createTab(tab.url, { groupId: tab.groupId }) : null;
}

function reorderTabs(order) {
  if (!Array.isArray(order) || order.length > 500) return false;
  const seen = new Set();
  const ordered = [];
  for (const id of order) {
    const tab = tabs.get(String(id));
    if (tab && !seen.has(tab.id)) { seen.add(tab.id); ordered.push(tab); }
  }
  for (const tab of tabs.values()) if (!seen.has(tab.id)) ordered.push(tab);
  const pinned = ordered.filter((tab) => tab.pinned === true);
  const regular = ordered.filter((tab) => tab.pinned !== true);
  tabs.clear();
  for (const tab of [...pinned, ...regular]) tabs.set(tab.id, tab);
  sendTabs();
  return true;
}

function downloadSnapshot(entry) {
  const item = entry.item;
  let totalBytes = 0, receivedBytes = 0, state = entry.state, filename = entry.filename, savePath = entry.savePath;
  try {
    totalBytes = item.getTotalBytes();
    receivedBytes = item.getReceivedBytes();
    state = item.getState();
    filename = item.getFilename();
    savePath = item.getSavePath();
  } catch { /* The item may have been released after a terminal event. */ }
  return { id: entry.id, filename, url: entry.url, savePath, state, totalBytes, receivedBytes,
    percent: totalBytes > 0 ? Math.min(100, Math.round(receivedBytes / totalBytes * 100)) : 0,
    canResume: (() => { try { return item.canResume(); } catch { return false; } })(),
    paused: (() => { try { return item.isPaused(); } catch { return false; } })() };
}

function downloadsPayload() {
  return Array.from(downloads.values()).reverse().map(downloadSnapshot);
}

function sendDownloads() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("browser:downloads-updated", downloadsPayload());
}

function updateWebViewVisibility() {
  const hasArea = (bounds) => bounds.width > 0 && bounds.height > 0;
  for (const tab of tabs.values()) {
    let bounds = hiddenBounds;
    if (multiView?.kind === "tabs") {
      if (tab.id === multiView.leftId && hasArea(browserBounds)) bounds = browserBounds;
      else if (tab.id === multiView.rightId && hasArea(sideBounds)) bounds = sideBounds;
    } else if (multiView?.kind === "orbit") {
      if (tab.id === multiView.tabId && hasArea(browserBounds)) bounds = browserBounds;
    } else if (tab.id === activeTabId && hasArea(browserBounds)) bounds = browserBounds;
    else if (tab.id === sideTabId && hasArea(sideBounds)) bounds = sideBounds;
    tab.view.setVisible(bounds !== hiddenBounds);
    tab.view.setBounds(bounds);
  }

  if (assistantHandleView && mainWindow && !mainWindow.isDestroyed()) {
    const shouldShow = browserBounds.width > 0 &&
      browserBounds.height > 0 &&
      !assistantExpanded &&
      Boolean(activeTabId && tabs.has(activeTabId));
    // The handle sits on the window's right edge: over the side tab when
    // one is showing, otherwise over the page.
    const edge = sideTabId && tabs.has(sideTabId) && hasArea(sideBounds) ? sideBounds : browserBounds;
    assistantHandleView.setBounds(shouldShow ? {
      x: edge.x + edge.width - 44,
      y: browserBounds.y + Math.round((browserBounds.height - 70) / 2),
      width: 44,
      height: 70
    } : hiddenBounds);
    assistantHandleView.setVisible(shouldShow);
    if (shouldShow) mainWindow.contentView.addChildView(assistantHandleView);
  }
  tabResourceView?.raise();
}

// After the active tab goes away: the most recent remaining tab, preferring
// one that isn't the side tab.
function pickFallbackTab() {
  const ids = Array.from(tabs.keys()).filter((id) => id !== sideTabId);
  return ids.pop() || Array.from(tabs.keys()).pop() || null;
}

function setActiveTab(id) {
  const targetId = String(id);
  if (!tabs.has(targetId)) return false;
  if (multiView?.kind === "tabs" && targetId !== multiView.leftId && targetId !== multiView.rightId) clearMultiViewState();
  else if (multiView?.kind === "orbit" && targetId !== multiView.tabId) clearMultiViewState();
  activeTabId = targetId;
  if (sideTabId === activeTabId && multiView?.kind !== "tabs") sideTabId = null;
  tabs.get(activeTabId).lastAccessed = Date.now();
  updateWebViewVisibility();
  sendTabs();
  focusStartSearch(tabs.get(activeTabId));
  return true;
}

function clearMultiViewState() {
  if (!multiView) return false;
  if (multiView.kind === "tabs" && sideTabId === multiView.rightId) sideTabId = null;
  multiView = null;
  return true;
}

function setMultiTabPair(leftId, rightId) {
  leftId = String(leftId); rightId = String(rightId);
  if (!tabs.has(leftId) || !tabs.has(rightId) || leftId === rightId) return false;
  multiView = { kind: "tabs", leftId, rightId };
  sideTabId = rightId;
  activeTabId = leftId;
  tabs.get(leftId).lastAccessed = Date.now();
  updateWebViewVisibility(); sendTabs();
  return true;
}

function setOrbitMultiView(tabId) {
  tabId = String(tabId);
  if (!tabs.has(tabId)) return false;
  multiView = { kind: "orbit", tabId };
  sideTabId = null;
  activeTabId = tabId;
  tabs.get(tabId).lastAccessed = Date.now();
  updateWebViewVisibility(); sendTabs();
  return true;
}

function closeMultiView() {
  if (!clearMultiViewState()) return false;
  updateWebViewVisibility(); sendTabs();
  return true;
}

function attachWebContentsHandlers(tab) {
  const contents = tab.view.webContents;
  const updateUrl = (_event, url, isMainFrame = true) => {
    if (isMainFrame === false) return;
    const nextUrl = url || contents.getURL();
    // Chromium can reuse an unchanged favicon without emitting another update.
    // Carry it into same-site visits, and clear it when moving to another site.
    try { if (new URL(tab.url).origin !== new URL(nextUrl).origin) tab.favicon = ""; } catch (_) { tab.favicon = ""; }
    tab.url = nextUrl;
    if (isStartPage(nextUrl)) {
      tab.currentVisit = null;
      tab.openerVisit = null;
      tab.favicon = START_PAGE_ICON;
    }
    tab.title = contents.getTitle() || tab.title;
    tab.loading = contents.isLoading();
    const origin = permissionOrigin(tab.url);
    if (origin && origin !== tab.origin) {
      tab.origin = origin;
      contents.setZoomLevel(siteZoomLevels.get(origin) || 0);
    }
    visitHistory.commit(tab, { url: tab.url, title: tab.title, index: contents.navigationHistory.getActiveIndex(), fresh: tab.freshNavigation, favicon: tab.favicon });
    tab.freshNavigation = false;
    sendTabs();
  };

  contents.on("did-start-loading", () => {
    tab.loading = true;
    sendTabs();
  });
  contents.on("did-stop-loading", () => {
    tab.loading = false;
    tab.url = contents.getURL();
    tab.title = contents.getTitle() || tab.title;
    if (!isStartPage(tab.url)) visitHistory.title(tab, tab.title);
    sendTabs();
  });
  contents.on("did-finish-load", () => { if (tab.id === activeTabId) focusStartSearch(tab); });
  contents.on("did-navigate", (event, url) => updateUrl(event, url));
  contents.on("did-navigate-in-page", updateUrl);
  contents.on("page-title-updated", (_event, title) => {
    tab.title = title || tab.title;
    if (!isStartPage(contents.getURL())) visitHistory.title(tab, tab.title);
    sendTabs();
  });
  contents.on("page-favicon-updated", (_event, favicons) => {
    tab.favicon = Array.isArray(favicons) ? favicons[0] || "" : "";
    if (!isStartPage(contents.getURL())) visitHistory.favicon(tab, tab.favicon);
    sendTabs();
  });
  // Browser shortcuts must work while a native page view has focus too. These
  // are intercepted here because the page's renderer is a separate process.
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.isComposing) return;
    const mod = input.control || input.meta;
    const key = String(input.key || "").toLowerCase();
    let handled = true;
    if (input.control && !input.alt && !input.meta && input.code === "Space") sendCommand("assistant", { focusUI: true });
    else if (mod && !input.alt && key === "l") sendCommand("focus-address", { focusUI: true });
    else if (mod && !input.alt && key === "k") sendCommand("focus-address", { focusUI: true });
    else if (mod && !input.alt && key === "d") sendCommand("bookmark-page", { focusUI: true });
    else if (mod && !input.alt && key === "h") sendCommand("history", { focusUI: true });
    else if (mod && input.shift && key === "b") sendCommand("bookmarks", { focusUI: true });
    else if (mod && input.shift && key === "o") sendCommand("cosmos", { focusUI: true });
    else if (mod && !input.alt && key === ",") sendCommand("settings", { focusUI: true });
    else if (mod && !input.alt && key === "/") sendCommand("shortcut-guide", { focusUI: true });
    else if (input.key === "F6") sendCommand("focus-address", { focusUI: true });
    else if (input.alt && !input.control && !input.meta && input.key === "ArrowLeft" && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
    else if (input.alt && !input.control && !input.meta && input.key === "ArrowRight" && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
    else if (input.alt && !input.control && !input.meta && input.key === "Home") sendCommand("go-home");
    else if (mod && !input.alt && key === "t" && input.shift) reopenClosedTab();
    else if (mod && !input.alt && key === "t") createTab();
    else if (mod && !input.alt && key === "w") closeTab(tab.id);
    else if (mod && !input.alt && key === "r" && input.shift) contents.reloadIgnoringCache();
    else if (mod && !input.alt && key === "r") contents.reload();
    else if (mod && !input.alt && key === "f") sendCommand("find", { focusUI: true });
    else if (mod && !input.alt && key === "g" && input.shift) sendCommand("find-previous", { focusUI: true });
    else if (mod && !input.alt && key === "g") sendCommand("find-next", { focusUI: true });
    else if (input.key === "F3" && input.shift) sendCommand("find-previous", { focusUI: true });
    else if (input.key === "F3") sendCommand("find-next", { focusUI: true });
    else if (input.control && !input.alt && !input.meta && input.code === "Tab") cycleTab(input.shift ? -1 : 1);
    else if (mod && !input.alt && /^[1-9]$/.test(key)) activateTabNumber(Number(key));
    else if (mod && !input.alt && ["+", "=", "add"].includes(key)) adjustActiveZoom(1);
    else if (mod && !input.alt && ["-", "_", "subtract"].includes(key)) adjustActiveZoom(-1);
    else if (mod && !input.alt && key === "0") setActiveZoom(0);
    else if (mod && !input.alt && key === "j") sendCommand("downloads", { focusUI: true });
    else if (mod && !input.alt && key === "p") sendCommand("print");
    else if (mod && !input.alt && key === "s" && input.shift) sendCommand("save-screenshot");
    else if (mod && !input.alt && key === "s") sendCommand("save-page");
    else if (input.control && !input.alt && !input.meta && input.code === "PageUp" && input.shift) moveTab(tab.id, -1);
    else if (input.control && !input.alt && !input.meta && input.code === "PageDown" && input.shift) moveTab(tab.id, 1);
    else if (input.control && !input.alt && !input.meta && input.code === "PageUp") cycleTab(-1);
    else if (input.control && !input.alt && !input.meta && input.code === "PageDown") cycleTab(1);
    else if (mod && !input.alt && key === "m") setTabMuted(tab.id, !contents.isAudioMuted());
    else if (input.key === "F5" && !input.alt && input.control && !input.meta) contents.reloadIgnoringCache();
    else if (input.key === "F5" && !input.alt) contents.reload();
    else if (input.key === "Escape" && contents.isLoading()) contents.stop();
    else if (mod && input.shift && key === "delete") sendCommand("clear-data-settings", { focusUI: true });
    else handled = false;
    if (handled) event.preventDefault();
  });
  contents.on("before-mouse-event", (event, mouse) => {
    if (mouse.type !== "mouseDown") return;
    if (mouse.button === "back") {
      event.preventDefault();
      if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
    } else if (mouse.button === "forward") {
      event.preventDefault();
      if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
    }
  });
  contents.on("found-in-page", (_event, result) => {
    if (tab.id === activeTabId && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("browser:find-result", result);
  });
  contents.on("update-target-url", (_event, url) => {
    if (tab.id === activeTabId && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("browser:link-preview", String(url || ""));
  });
  contents.on("audio-state-changed", () => sendTabs());
  contents.on("will-navigate", (event, url) => {
    if (isStartPage(url)) return;
    if (isWebUrl(url)) { tab.freshNavigation = true; return; }
    event.preventDefault();
    if (/^mailto:/i.test(url)) shell.openExternal(url);
  });
  contents.on("will-redirect", (event, url) => {
    if (!isWebUrl(url) && !isStartPage(url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    // Links opened from a grouped tab join its group.
    if (isWebUrl(url)) createTab(url, { groupId: tab.groupId, openerVisit: tab.currentVisit });
    else if (/^mailto:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("context-menu", (_event, params) => {
    const template = [
      ...(params.misspelledWord ? (Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions.slice(0, 8).map(suggestion => ({
        label: suggestion,
        click: () => contents.replaceMisspelling(suggestion)
      })) : []) : []),
      ...(params.misspelledWord ? [{
        label: "Add to dictionary",
        click: () => contents.session.addWordToSpellCheckerDictionary(String(params.misspelledWord).slice(0, 128))
      }, { type: "separator" }] : []),
      { label: "Back", enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() },
      { label: "Forward", enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() },
      { type: "separator" },
      ...(isWebUrl(params.linkURL) ? [
        { label: "Open link in new tab", click: () => createTab(params.linkURL, { groupId: tab.groupId, openerVisit: tab.currentVisit }) },
        { label: "Open link in background tab", click: () => createTab(params.linkURL, { groupId: tab.groupId, openerVisit: tab.currentVisit, activate: false }) },
        { label: "Add link to Reading List", click: () => saveToReadingList({ url: params.linkURL, title: params.linkText || params.linkURL }) },
        { label: "Copy link address", click: () => clipboard.writeText(params.linkURL) },
        { type: "separator" }
      ] : []),
      ...(params.selectionText ? [
        { label: `Search the web for “${String(params.selectionText).trim().slice(0, 48)}${String(params.selectionText).length > 48 ? "…" : ""}”`, click: () => createTab(searchDestination(params.selectionText), { groupId: tab.groupId, openerVisit: tab.currentVisit }) },
        { type: "separator" }
      ] : []),
      { role: "copy", enabled: params.selectionText.length > 0 },
      { role: "paste" },
      { role: "selectAll" },
      { type: "separator" },
      ...(isWebUrl(tab.url) ? [{ label: "Add current page to Reading List", click: () => saveToReadingList({ url: tab.url, title: tab.title, favicon: tab.favicon }) }, { type: "separator" }] : []),
      { label: "Reload", click: () => contents.reload() }
    ];
    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });
  contents.on("render-process-gone", () => {
    tab.loading = false;
    tab.title = "This page stopped responding";
    sendTabs();
  });
  contents.on("destroyed", () => {
    suggestionRequests.get(contents.id)?.abort(); suggestionRequests.delete(contents.id);
    if (!tabs.has(tab.id)) return;
    tabs.delete(tab.id);
    if ((multiView?.kind === "tabs" && (multiView.leftId === tab.id || multiView.rightId === tab.id)) ||
        (multiView?.kind === "orbit" && multiView.tabId === tab.id)) clearMultiViewState();
    if (sideTabId === tab.id) sideTabId = null;
    if (activeTabId === tab.id) {
      activeTabId = pickFallbackTab();
      if (sideTabId === activeTabId) sideTabId = null;
      if (activeTabId) tabs.get(activeTabId).lastAccessed = Date.now();
    }
    updateWebViewVisibility();
    sendTabs();
  });
}

// activate: switch to the new tab (otherwise it opens in the background).
// side: show it beside the active one instead, replacing any earlier side tab.
function createTab(url, { groupId = null, openerVisit = null, activate = true, side = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const id = String(nextTabId++);
  const view = new WebContentsView({
    webPreferences: {
      partition: "persist:nova",
      preload: path.join(__dirname, "search-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true
    }
  });
  const tab = {
    id,
    view,
    title: "Loading…",
    url: "",
    favicon: "",
    loading: true,
    lastAccessed: Date.now(),
    groupId: groupId && groups.get(groupId) ? String(groupId) : null
  };
  tab.pinned = false;
  if (typeof view.webContents.setZoomMode === "function") view.webContents.setZoomMode("isolated");
  visitHistory.attach(tab, openerVisit);
  tab.connection = trackConnectionSecurity(view.webContents, sendTabs, {
    verificationDisabled: app.commandLine.hasSwitch("ignore-certificate-errors") || app.commandLine.hasSwitch("ignore-certificate-errors-spki-list")
  });
  tabs.set(id, tab);
  mainWindow.contentView.addChildView(view);
  view.setVisible(false);
  view.setBounds(hiddenBounds);
  attachWebContentsHandlers(tab);
  if (side && activeTabId) {
    const previous = sideTabId;
    clearMultiViewState();
    sideTabId = id;
    if (previous) closeTab(previous);
    updateWebViewVisibility();
    sendTabs();
  } else if (activate || !activeTabId || !tabs.has(activeTabId)) {
    setActiveTab(id);
  } else {
    updateWebViewVisibility();
    sendTabs();
  }
  view.webContents.loadURL(normalizeDestination(url)).catch(() => {});
  return id;
}

function closeTab(id) {
  const tab = tabs.get(String(id));
  if (!tab) return false;
  if (tabs.size === 1) {
    sendCommand("prepare-last-tab-close");
    if (!createTab(START_PAGE_URL)) { sendCommand("cancel-last-tab-close"); return false; }
    const closed = closeTab(id);
    if (closed) sendCommand("open-cosmos");
    else sendCommand("cancel-last-tab-close");
    return closed;
  }
  if (multiView?.kind === "tabs" && (tab.id === multiView.leftId || tab.id === multiView.rightId)) clearMultiViewState();
  else if (multiView?.kind === "orbit" && tab.id === multiView.tabId) clearMultiViewState();
  closedTabs.push({ url: tab.url || START_PAGE_URL, title: tab.title, favicon: tab.favicon,
    groupId: tab.groupId, groupName: tab.groupId ? groups.get(tab.groupId)?.name || "" : "", pinned: tab.pinned === true });
  if (closedTabs.length > 25) closedTabs.shift();
  const wasActive = activeTabId === tab.id;
  mainWindow.contentView.removeChildView(tab.view);
  tabs.delete(tab.id);
  if (sideTabId === tab.id) sideTabId = null;
  tab.view.webContents.close();
  if (wasActive) {
    activeTabId = pickFallbackTab();
    if (sideTabId === activeTabId) sideTabId = null;
    if (activeTabId) tabs.get(activeTabId).lastAccessed = Date.now();
  }
  updateWebViewVisibility();
  sendTabs();
  return true;
}

async function settingsPath() {
  return path.join(app.getPath("userData"), "nova-settings.json");
}

async function hasProtectedSecretStore() {
  if (!await safeStorage.isAsyncEncryptionAvailable()) return false;
  if (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") return false;
  return true;
}

async function readSettings() {
  if (settingsCache) return settingsCache;
  try {
    const raw = await fs.readFile(await settingsPath(), "utf8");
    settingsCache = JSON.parse(raw);
  } catch (_) {
    settingsCache = {};
  }
  return settingsCache;
}

async function writeSettings(settings) {
  settingsCache = settings;
  const target = await settingsPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(settings, null, 2), { mode: 0o600 });
}

async function getStoredAPIKey(settings) {
  const environmentKey = getEnvironmentAPIKey(settings.bullsaiUrl);
  if (environmentKey) return environmentKey;
  if (!settings.apiKeyCiphertext || !await hasProtectedSecretStore()) return "";
  if (settings.apiKeyOrigin && settings.apiKeyOrigin !== endpointOrigin(settings.bullsaiUrl)) return "";
  try {
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(settings.apiKeyCiphertext, "base64"));
    if (decrypted.shouldReEncrypt) {
      const rotated = await safeStorage.encryptStringAsync(decrypted.result);
      settings.apiKeyCiphertext = rotated.toString("base64");
      await writeSettings(settings);
    }
    return decrypted.result;
  } catch (_) {
    return "";
  }
}

function validateAPIEndpoint(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch (_) {
    return false;
  }
}

// Plain-HTTP endpoints are self-hosted (local Ollama, an SSH tunnel, a
// machine on the network), so an API key is optional for them. A stored key
// is still sent if there is one.
function isKeyOptionalEndpoint(value) {
  try {
    return new URL(value).protocol === "http:";
  } catch (_) {
    return false;
  }
}

function isOllamaCloudEndpoint(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "ollama.com";
  } catch (_) {
    return false;
  }
}

function endpointOrigin(value) {
  try { return new URL(value).origin; } catch (_) { return ""; }
}

// Environment keys are meant for the hosted HTTPS providers; never send them
// in plain text to a self-hosted endpoint.
function getEnvironmentAPIKey(value) {
  if (isKeyOptionalEndpoint(value)) return "";
  return isOllamaCloudEndpoint(value)
    ? (process.env.OLLAMA_API_KEY || "")
    : (process.env.BULLSAI_API_KEY || "");
}

function permissionOrigin(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "file:" ? "file://" : parsed.origin;
  } catch (_) {
    return "";
  }
}

function permissionsPayload() {
  return Array.from(permissionGrants, ([origin, permissions]) => ({ origin, permissions: [...permissions].sort() }))
    .filter(entry => entry.permissions.length).sort((a, b) => a.origin.localeCompare(b.origin));
}

function sendPermissions() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("browser:permissions-updated", permissionsPayload());
}

function installPermissionPrompts() {
  const configureSession = (ses) => {
    ses.setPermissionCheckHandler((contents, permission, requestingOrigin) => {
      if (mainWindow && contents === mainWindow.webContents && permission === "media") return true;
      const grant = permissionGrants.get(permissionOrigin(requestingOrigin));
      return Boolean(grant && grant.has(permission));
    });
    ses.setPermissionRequestHandler(async (contents, permission, callback, details) => {
      // Nova's own window may use the microphone for voice activation.
      const shellAudio = mainWindow && contents === mainWindow.webContents && permission === "media" &&
        Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0 && details.mediaTypes.every((type) => type === "audio");
      if (shellAudio) return callback(true);
      const origin = permissionOrigin(details.requestingUrl);
      if (!origin || !mainWindow) return callback(false);
      const grant = permissionGrants.get(origin);
      if (grant && grant.has(permission)) return callback(true);
      const labels = {
        media: "use your camera or microphone",
        geolocation: "access your location",
        notifications: "show notifications",
        midi: "use MIDI devices",
        "clipboard-read": "read clipboard content"
      };
      const displayOrigin = origin === "file://" ? "Nova desktop" : origin;
      const answer = await dialog.showMessageBox(mainWindow, {
        type: "question",
        buttons: ["Allow this time", "Allow for this session", "Block"],
        defaultId: 2,
        cancelId: 2,
        title: "Website permission",
        message: displayOrigin + " wants to " + (labels[permission] || ("use " + permission)),
        detail: "A one-time grant expires after this request. Session grants can be revoked in Settings."
      });
      if (answer.response === 0) return callback(true);
      if (answer.response !== 1) return callback(false);
      const updated = permissionGrants.get(origin) || new Set();
      updated.add(permission);
      permissionGrants.set(origin, updated);
      sendPermissions();
      callback(true);
    });
  };
  configureSession(session.defaultSession);
  const browserSession = session.fromPartition("persist:nova");
  configureSession(browserSession);
  browserSession.on("will-download", (_event, item) => {
    const entry = { id: String(nextDownloadId++), item, filename: item.getFilename(), url: item.getURL(), savePath: "", state: "progressing" };
    downloads.set(entry.id, entry);
    const trim = () => {
      if (downloads.size <= 100) return;
      for (const [id, candidate] of downloads) {
        if (downloads.size <= 100) break;
        if (candidate.state !== "progressing") downloads.delete(id);
      }
    };
    item.on("updated", (_event, state) => {
      entry.state = state;
      try { entry.savePath = item.getSavePath(); } catch {}
      trim(); sendDownloads();
    });
    item.once("done", (_event, state) => {
      entry.state = state;
      try { entry.savePath = item.getSavePath(); } catch {}
      trim(); sendDownloads();
    });
    sendDownloads();
  });
}

function sendCommand(command, { focusUI = false, arg } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (focusUI) mainWindow.webContents.focus();
  mainWindow.webContents.send("browser:command", command, arg);
}

function printActivePage() {
  const contents = activeContents();
  if (!contents || contents.isDestroyed()) return false;
  contents.print({ printBackground: true });
  return true;
}

async function saveActivePageAsPDF() {
  const contents = activeContents();
  if (!contents || contents.isDestroyed() || !mainWindow) return false;
  const safeTitle = (contents.getTitle() || "Nova page").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").trim().slice(0, 100) || "Nova page";
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Save page as PDF",
    defaultPath: path.join(app.getPath("downloads"), safeTitle + ".pdf"),
    filters: [{ name: "PDF document", extensions: ["pdf"] }]
  });
  if (canceled || !filePath) return false;
  try {
    const pdf = await contents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    await fs.writeFile(filePath, pdf);
    sendCommand("toast", { arg: "Saved PDF: " + path.basename(filePath) });
    return true;
  } catch (error) {
    console.error("Could not save page as PDF:", error.message);
    sendCommand("toast", { arg: "Nova could not save this page as a PDF." });
    return false;
  }
}

async function saveActivePage() {
  const contents = activeContents();
  if (!contents || contents.isDestroyed() || !mainWindow) return false;
  const safeTitle = (contents.getTitle() || "Nova page").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").trim().slice(0, 100) || "Nova page";
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Save webpage",
    defaultPath: path.join(app.getPath("downloads"), safeTitle + ".html"),
    filters: [{ name: "Webpage, complete", extensions: ["html"] }, { name: "Webpage archive", extensions: ["mhtml"] }]
  });
  if (canceled || !filePath) return false;
  const saveType = path.extname(filePath).toLowerCase() === ".mhtml" ? "MHTML" : "HTMLComplete";
  try {
    await contents.savePage(filePath, saveType);
    sendCommand("toast", { arg: "Saved webpage: " + path.basename(filePath) });
    return true;
  } catch (error) {
    console.error("Could not save webpage:", error.message);
    sendCommand("toast", { arg: "Nova could not save this webpage." });
    return false;
  }
}

async function saveActiveScreenshot() {
  const contents = activeContents();
  if (!contents || contents.isDestroyed() || !mainWindow) return false;
  const title = (contents.getTitle() || "Nova page").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").trim().slice(0, 90) || "Nova page";
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Save page screenshot",
    defaultPath: path.join(app.getPath("pictures"), title + ".png"),
    filters: [{ name: "PNG image", extensions: ["png"] }]
  });
  if (canceled || !filePath) return false;
  try {
    const image = await contents.capturePage();
    if (image.isEmpty()) throw Error("The page has no visible image to save.");
    await fs.writeFile(filePath, image.toPNG());
    sendCommand("toast", { arg: `Saved screenshot: ${path.basename(filePath)}` });
    return true;
  } catch (error) {
    console.error("Could not save screenshot:", error.message);
    sendCommand("toast", { arg: error.message || "Could not save the screenshot." });
    return false;
  }
}

function decodeBookmarkHTML(value) {
  return String(value || "").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Math.min(0x10ffff, Number(code))))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Math.min(0x10ffff, parseInt(code, 16))));
}

function parseBookmarkFile(source) {
  const trimmed = String(source || "").trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : parsed.bookmarks;
  }
  const items = [];
  const anchors = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = anchors.exec(trimmed)) && items.length < 10000) {
    items.push({ url: decodeBookmarkHTML(match[2]), title: decodeBookmarkHTML(match[3].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()) });
  }
  return items;
}

async function importBookmarks() {
  if (!mainWindow) return false;
  const selection = await dialog.showOpenDialog(mainWindow, { title: "Import bookmarks", properties: ["openFile"], filters: [{ name: "Bookmarks", extensions: ["html", "htm", "json"] }] });
  if (selection.canceled || !selection.filePaths[0]) return false;
  try {
    const source = await fs.readFile(selection.filePaths[0], "utf8");
    const entries = parseBookmarkFile(source);
    if (!Array.isArray(entries)) throw Error("No bookmark list was found in that file.");
    const count = bookmarks.import(entries);
    sendTabs(); sendCommand("toast", { arg: `Imported ${count} bookmark${count === 1 ? "" : "s"}.` });
    return true;
  } catch (error) {
    console.error("Could not import bookmarks:", error.message);
    sendCommand("toast", { arg: error.message || "Could not import that bookmark file." });
    return false;
  }
}

async function exportBookmarks() {
  if (!mainWindow) return false;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Export bookmarks",
    defaultPath: path.join(app.getPath("documents"), "Nova-bookmarks.html"),
    filters: [{ name: "Browser bookmark file", extensions: ["html"] }, { name: "JSON backup", extensions: ["json"] }]
  });
  if (canceled || !filePath) return false;
  try {
    const items = bookmarks.items;
    let content;
    if (path.extname(filePath).toLowerCase() === ".json") content = JSON.stringify({ version: 1, bookmarks: items }, null, 2);
    else {
      const escape = value => String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      content = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Nova Bookmarks</TITLE>\n<H1>Nova Bookmarks</H1>\n<DL><p>\n${items.map(item => `<DT><A HREF="${escape(item.url)}" ADD_DATE="${Math.floor(item.at / 1000)}">${escape(item.title)}</A>`).join("\n")}\n</DL><p>\n`;
    }
    await fs.writeFile(filePath, content, "utf8");
    sendCommand("toast", { arg: `Exported ${items.length} bookmarks.` });
    return true;
  } catch (error) {
    console.error("Could not export bookmarks:", error.message);
    sendCommand("toast", { arg: "Could not export bookmarks." });
    return false;
  }
}

function createApplicationMenu() {
  const template = [
    {
      label: "Nova",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Settings", accelerator: "CommandOrControl+,", click: () => sendCommand("settings", { focusUI: true }) },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "File",
      submenu: [
        { label: "New Tab", accelerator: "CommandOrControl+T", click: () => sendCommand("new-tab") },
        { label: "Duplicate Tab", accelerator: "CommandOrControl+Shift+K", click: () => duplicateTab(activeTabId) },
        { label: "Bookmark This Page", accelerator: "CommandOrControl+D", click: () => sendCommand("bookmark-page", { focusUI: true }) },
        { label: "Reopen Closed Tab", accelerator: "CommandOrControl+Shift+T", click: () => reopenClosedTab() },
        { label: "Close Tab", accelerator: "CommandOrControl+W", click: () => sendCommand("close-tab") },
        { type: "separator" },
        { label: "Downloads", accelerator: "CommandOrControl+J", click: () => sendCommand("downloads", { focusUI: true }) },
        { label: "Import or Export Bookmarks…", click: () => Menu.buildFromTemplate([{ label: "Import bookmarks…", click: () => importBookmarks() }, { label: "Export bookmarks…", click: () => exportBookmarks() }]).popup({ window: mainWindow }) },
        { label: "Save Webpage…", accelerator: "CommandOrControl+S", click: () => saveActivePage() },
        { label: "Save Page as PDF…", click: () => saveActivePageAsPDF() },
        { label: "Save Screenshot…", accelerator: "CommandOrControl+Shift+S", click: () => saveActiveScreenshot() },
        { label: "Print…", accelerator: "CommandOrControl+P", click: () => printActivePage() },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    {
      label: "View",
      submenu: [
        { label: "Back", accelerator: "Alt+Left", click: () => { const history = activeContents()?.navigationHistory; if (history?.canGoBack()) history.goBack(); } },
        { label: "Forward", accelerator: "Alt+Right", click: () => { const history = activeContents()?.navigationHistory; if (history?.canGoForward()) history.goForward(); } },
        { type: "separator" },
        { label: "Focus Address Bar", accelerator: "CommandOrControl+L", click: () => sendCommand("focus-address", { focusUI: true }) },
        { label: "Focus Address Bar or Page", click: () => sendCommand("toggle-focus", { focusUI: true }) },
        { label: "Reload Page", accelerator: "CommandOrControl+R", click: () => activeContents()?.reload() },
        { label: "Hard Reload", accelerator: "CommandOrControl+Shift+R", click: () => activeContents()?.reloadIgnoringCache() },
        { label: "Find in Page…", accelerator: "CommandOrControl+F", click: () => sendCommand("find", { focusUI: true }) },
        { label: "Find Next", accelerator: "CommandOrControl+G", click: () => sendCommand("find-next", { focusUI: true }) },
        { label: "Find Previous", accelerator: "CommandOrControl+Shift+G", click: () => sendCommand("find-previous", { focusUI: true }) },
        { type: "separator" },
        { label: "Next Tab", accelerator: "Control+Tab", click: () => cycleTab(1) },
        { label: "Previous Tab", accelerator: "Control+Shift+Tab", click: () => cycleTab(-1) },
        { label: "Next Tab (alternate)", accelerator: "Control+PageDown", click: () => cycleTab(1) },
        { label: "Previous Tab (alternate)", accelerator: "Control+PageUp", click: () => cycleTab(-1) },
        { label: "Move Tab Right", accelerator: "Control+Shift+PageDown", click: () => moveTab(activeTabId, 1) },
        { label: "Move Tab Left", accelerator: "Control+Shift+PageUp", click: () => moveTab(activeTabId, -1) },
        ...Array.from({ length: 8 }, (_, index) => ({ label: `Switch to Tab ${index + 1}`, accelerator: `CommandOrControl+${index + 1}`, click: () => activateTabNumber(index + 1) })),
        { label: "Switch to Last Tab", accelerator: "CommandOrControl+9", click: () => activateTabNumber(9) },
        { type: "separator" },
        { label: "Zoom In", accelerator: "CommandOrControl+Plus", click: () => adjustActiveZoom(1) },
        { label: "Zoom Out", accelerator: "CommandOrControl+-", click: () => adjustActiveZoom(-1) },
        { label: "Reset Zoom", accelerator: "CommandOrControl+0", click: () => setActiveZoom(0) },
        { label: "History constellation", accelerator: "CommandOrControl+H", click: () => sendCommand("history", { focusUI: true }) },
        { label: "Bookmarks", accelerator: "CommandOrControl+Shift+B", click: () => sendCommand("bookmarks", { focusUI: true }) },
        { label: "Tab Cosmos", accelerator: "CommandOrControl+Shift+O", click: () => sendCommand("cosmos", { focusUI: true }) },
        { label: "Ask Nova", accelerator: "Control+Space", click: () => sendCommand("assistant", { focusUI: true }) },
        { label: "Keyboard Shortcuts", accelerator: "CommandOrControl+/", click: () => sendCommand("shortcut-guide", { focusUI: true }) },
        { label: "Clear Cookies and Cache…", accelerator: "CommandOrControl+Shift+Delete", click: () => sendCommand("clear-data-settings", { focusUI: true }) },
        { label: "Site Permissions…", click: () => sendCommand("permissions", { focusUI: true }) },
        { label: "Reading List", click: () => sendCommand("reading-list", { focusUI: true }) },
        { label: "Toggle Full Screen", accelerator: "F11", click: () => { if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen()); } },
        { type: "separator" },
        { role: "toggleDevTools", accelerator: "F12" }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  // Fit the window to the display's usable area. On HiDPI screens (e.g. 2x
  // scaling) a fixed minimum can exceed the work area, which makes window
  // managers refuse to maximize or resize the window.
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const minWidth = Math.min(800, workArea.width);
  const minHeight = Math.min(560, workArea.height);
  const width = Math.max(minWidth, Math.min(1500, Math.round(workArea.width * 0.75)));
  const height = Math.max(minHeight, Math.min(940, Math.round(workArea.height * 0.75)));
  const win = new BrowserWindow({
    show: !launch.testHidden,
    width,
    height,
    minWidth,
    minHeight,
    center: true,
    resizable: true,
    maximizable: true,
    backgroundColor: "#080d1c",
    title: "Nova",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "desktop-preload.js"),
      backgroundThrottling: !launch.testHidden,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow = win;
  win.on("app-command", (_event, command) => {
    const focused = Array.from(tabs.values()).find((tab) => tab.view.webContents.isFocused())?.view.webContents || activeContents();
    const history = focused?.navigationHistory;
    if (command === "browser-backward" && history?.canGoBack()) history.goBack();
    else if (command === "browser-forward" && history?.canGoForward()) history.goForward();
  });
  // Electron exposes the legacy macOS page-swipe event when the system
  // "Swipe between pages" gesture is enabled. Modern trackpads may instead
  // route these through Chromium's native history navigation.
  if (process.platform === "darwin") {
    win.on("swipe", (_event, direction) => {
      const history = activeContents()?.navigationHistory;
      if (direction === "right" && history?.canGoBack()) history.goBack();
      else if (direction === "left" && history?.canGoForward()) history.goForward();
    });
  }
  tabResourceView = createTabResourceView({ window: win, tabs, getMetrics: () => app.getAppMetrics() });
  browserBounds = { ...hiddenBounds };
  assistantExpanded = false;
  assistantHandleView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "assistant-handle-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  assistantHandleView.setBackgroundColor("#00000000");
  assistantHandleView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  assistantHandleView.webContents.on("will-navigate", (event, url) => {
    if (url !== pathToFileURL(path.join(__dirname, "ui", "assistant-handle.html")).href) event.preventDefault();
  });
  win.contentView.addChildView(assistantHandleView);
  assistantHandleView.setVisible(false);
  assistantHandleView.setBounds(hiddenBounds);
  assistantHandleView.webContents.loadFile(path.join(__dirname, "ui", "assistant-handle.html"));
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file:")) return;
    event.preventDefault();
  });
  win.loadFile(path.join(__dirname, "ui", "index.html"));
  win.webContents.once("did-finish-load", () => {
    if (mainWindow === win && tabs.size === 0 && !restoreSavedTabs()) createTab(launch.startUrl);
  });
  win.on("close", () => saveSessionSnapshot());
  win.on("closed", () => {
    if (mainWindow === win) {
      tabResourceView?.dispose(); tabResourceView = null;
      mainWindow = null;
      browserBounds = { ...hiddenBounds };
      for (const tab of tabs.values()) {
        if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
      }
      tabs.clear();
      if (assistantHandleView && !assistantHandleView.webContents.isDestroyed()) assistantHandleView.webContents.close();
      assistantHandleView = null;
      activeTabId = null;
      assistantExpanded = false;
      if (process.platform === "darwin" && restoreSessionOnLaunch) {
        try { sessionRestoreSnapshot = JSON.parse(fsSync.readFileSync(sessionSnapshotPath(), "utf8")); }
        catch { sessionRestoreSnapshot = null; }
      }
    }
  });
}

function clampBounds(bounds) {
  if (!bounds) return { ...hiddenBounds };
  const width = Math.max(0, Math.min(10000, Number(bounds.width) || 0));
  const height = Math.max(0, Math.min(10000, Number(bounds.height) || 0));
  if (!(width > 0 && height > 0)) return { ...hiddenBounds };
  return {
    x: Math.max(0, Math.round(Number(bounds.x) || 0)),
    y: Math.max(0, Math.round(Number(bounds.y) || 0)),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function registerIPC() {
  const fromShell = event => mainWindow && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame;
  ipcMain.on("browser:show-tab-resources", (event, payload) => {
    if (fromShell(event) && typeof payload?.id === "string") tabResourceView?.show(payload.id, payload.anchor);
  });
  ipcMain.on("browser:hide-tab-resources", (event, immediate) => {
    if (!fromShell(event)) return;
    if (immediate === true) tabResourceView?.hide(); else tabResourceView?.scheduleHide();
  });
  ipcMain.on("tab-resources:pointer", (event, inside) => { if (tabResourceView?.owns(event)) tabResourceView.pointer(inside === true); });
  ipcMain.on("tab-resources:dismiss", event => { if (tabResourceView?.owns(event)) tabResourceView.hide(); });
  ipcMain.handle("browser:get-bookmarks", event => fromShell(event) ? bookmarks.snapshot(tabs) : []);
  ipcMain.handle("browser:get-reading-list", event => fromShell(event) ? readingList.snapshot(tabs) : []);
  ipcMain.handle("browser:add-current-to-reading-list", event => {
    if (!fromShell(event)) return false;
    const tab = tabs.get(activeTabId);
    return tab ? saveToReadingList({ url: tab.url, title: tab.title, favicon: tab.favicon }) : false;
  });
  ipcMain.handle("browser:remove-reading-list-item", (event, id) => {
    if (!fromShell(event) || typeof id !== "string") return false;
    readingList.remove(id); sendTabs(); return true;
  });
  ipcMain.handle("browser:mark-reading-list-item", (event, id, read) => {
    if (!fromShell(event) || typeof id !== "string" || typeof read !== "boolean") return false;
    const result = readingList.markRead(id, read); if (result) sendTabs(); return result;
  });
  ipcMain.handle("browser:clear-reading-list", event => {
    if (!fromShell(event)) return false;
    readingList.clear(); sendTabs(); return true;
  });
  ipcMain.handle("browser:open-reading-list-item", (event, id, options = {}) => {
    if (!fromShell(event)) return false;
    options = options && typeof options === "object" ? options : {};
    const item = readingList.items.find(entry => entry.id === id);
    if (!item) return false;
    const live = readingList.snapshot(tabs).find(entry => entry.id === id)?.liveTabId;
    const result = live && options.newTab !== true ? setActiveTab(live) : createTab(item.url, { activate: options.activate !== false });
    readingList.markRead(id, true); sendTabs(); return result;
  });
  ipcMain.on("browser:reading-list-updated-request", event => { if (fromShell(event)) event.sender.send("browser:reading-list-updated", readingList.snapshot(tabs)); });
  const changeBookmark = (event, operation) => {
    if (!fromShell(event)) return { ok: false, error: "Bookmarks can only be changed in Nova." };
    try { const bookmark = operation(); sendTabs(); return { ok: true, bookmark }; }
    catch (error) { return { ok: false, error: error.message }; }
  };
  ipcMain.handle("browser:save-bookmark", (event, input) => changeBookmark(event, () => {
    if (input?.id) {
      if (typeof input.id !== "string") throw Error("Invalid bookmark.");
      return bookmarks.save({ id: input.id, title: input.title, url: input.url });
    }
    const tab = tabs.get(activeTabId);
    if (!tab || !isWebUrl(tab.url)) throw Error("Open a website to bookmark it.");
    return bookmarks.save({ url: tab.url, title: tab.title, favicon: tab.favicon });
  }));
  ipcMain.handle("browser:remove-bookmark", (event, id) => changeBookmark(event, () => bookmarks.remove(id)));
  ipcMain.handle("browser:clear-bookmarks", event => changeBookmark(event, () => bookmarks.clear()));
  ipcMain.on("browser:bookmark-transfer-menu", event => {
    if (!fromShell(event)) return;
    Menu.buildFromTemplate([
      { label: "Import bookmarks…", click: () => importBookmarks() },
      { label: "Export bookmarks…", click: () => exportBookmarks() }
    ]).popup({ window: mainWindow });
  });
  ipcMain.handle("browser:open-bookmark", (event, id) => {
    if (!fromShell(event)) return false;
    const bookmark = bookmarks.items.find(item => item.id === id); if (!bookmark) return false;
    const live = bookmarks.snapshot(tabs).find(item => item.id === id)?.liveTabId;
    return live ? setActiveTab(live) : createTab(bookmark.url);
  });
  const fromSearchUI = event => fromShell(event) || (event.senderFrame === event.sender.mainFrame && isStartPage(event.sender.getURL()) && Array.from(tabs.values()).some(tab => tab.view.webContents === event.sender));
  ipcMain.handle("browser:suggest-local", (event, query) => {
    if (!fromSearchUI(event) || typeof query !== "string" || query.length > 8192) return [];
    return localSuggestions(query, { visits: visitHistory.nodes, bookmarks: bookmarks.items, tabs: Array.from(tabs.values()).map(tab => ({ id: tab.id, title: tab.title, url: tab.url, lastAccessed: tab.lastAccessed })), activeId: activeTabId });
  });
  ipcMain.handle("browser:suggest-web", async (event, query) => {
    if (!fromSearchUI(event) || typeof query !== "string" || query.length > 100) return [];
    const id = event.sender.id;
    suggestionRequests.get(id)?.abort();
    const controller = new AbortController(); suggestionRequests.set(id, controller);
    try { return await fetchWebSuggestions(query, AbortSignal.any([controller.signal, AbortSignal.timeout(2500)])); }
    finally { if (suggestionRequests.get(id) === controller) suggestionRequests.delete(id); }
  });
  ipcMain.on("browser:suggest-cancel", event => {
    if (!fromSearchUI(event)) return;
    suggestionRequests.get(event.sender.id)?.abort(); suggestionRequests.delete(event.sender.id);
  });
  ipcMain.handle("browser:choose-suggestion", (event, suggestion) => {
    if (!fromSearchUI(event) || !suggestion || typeof suggestion.value !== "string" || suggestion.value.length > 8192) return false;
    if (suggestion.kind === "tab") return setActiveTab(suggestion.tabId);
    if (suggestion.kind !== "url" && suggestion.kind !== "search") return false;
    const value = suggestion.value.trim(); if (!value) return false;
    const url = suggestion.kind === "search" ? searchDestination(value) : value;
    if (!isWebUrl(url) && url !== "nova://newtab") return false;
    const tab = tabs.get(activeTabId);
    if (!tab) return createTab(url);
    tab.freshNavigation = true; tab.view.webContents.loadURL(normalizeDestination(url)).catch(() => {}); return true;
  });
  ipcMain.handle("browser:get-history", event => fromShell(event) ? visitHistory.snapshot(tabs) : []);
  ipcMain.handle("browser:open-history", (event, id, options) => fromShell(event) ? openHistoryVisit(id, options) : false);
  ipcMain.handle("browser:delete-history-entry", (event, id) => {
    if (!fromShell(event) || typeof id !== "string") return false;
    const removed = visitHistory.remove(id, tabs);
    if (removed) sendTabs();
    return removed;
  });
  ipcMain.handle("browser:delete-history-group", (event, ids) => {
    if (!fromShell(event) || !Array.isArray(ids) || ids.length > 1000) return false;
    const removed = visitHistory.removeMany(ids.filter(id => typeof id === "string").slice(0, 1000), tabs);
    if (removed) sendTabs();
    return removed;
  });
  ipcMain.on("browser:show-history-menu", (event, id) => { if (fromShell(event)) showHistoryMenu(id); });
  ipcMain.on("browser:show-history-date-menu", (event, key) => { if (fromShell(event)) showHistoryDateMenu(key); });
  ipcMain.handle("browser:clear-history", event => {
    if (!fromShell(event)) return false;
    visitHistory.clear(tabs);
    sendTabs();
    return true;
  });
  ipcMain.handle("browser:clear-browsing-data", async (event, options = {}) => {
    if (!fromShell(event)) return { ok: false, error: "This action is only available in Nova settings." };
    options = options && typeof options === "object" ? options : {};
    const cookies = options.cookies === true;
    const cache = options.cache === true;
    if (!cookies && !cache) return { ok: false, error: "Choose cookies/site data, cached files, or both." };

    const dataTypes = [];
    if (cookies) dataTypes.push("cookies", "backgroundFetch", "fileSystems", "indexedDB", "localStorage", "serviceWorkers", "webSQL");
    if (cache) dataTypes.push("cache");
    const browserSession = session.fromPartition("persist:nova");
    try {
      await browserSession.clearData({ dataTypes });
      if (cookies) await browserSession.clearStorageData({ storages: ["cachestorage"] });
      return { ok: true, cookies, cache };
    } catch (error) {
      console.error("Could not clear browsing data:", error.message);
      return { ok: false, error: "Nova could not clear the selected browsing data." };
    }
  });
  ipcMain.handle("browser:get-tabs", () => tabsPayload());
  ipcMain.handle("browser:get-browser-preferences", async event => {
    if (!fromShell(event)) return { restorePreviousSession: true, clearDataOnExit: false, searchProvider: "google" };
    const settings = await readSettings();
    return { restorePreviousSession: settings.restorePreviousSession !== false, clearDataOnExit: settings.clearDataOnExit === true,
      searchProvider: Object.hasOwn(searchProviders, settings.searchProvider) ? settings.searchProvider : "google" };
  });
  ipcMain.handle("browser:get-permissions", event => fromShell(event) ? permissionsPayload() : []);
  ipcMain.on("browser:revoke-permission", (event, origin, permission) => {
    if (!fromShell(event) || typeof origin !== "string" || typeof permission !== "string") return;
    const grants = permissionGrants.get(origin);
    if (!grants) return;
    grants.delete(permission);
    if (!grants.size) permissionGrants.delete(origin);
    sendPermissions();
  });
  ipcMain.handle("browser:clear-site-data", async (event, rawOrigin) => {
    if (!fromShell(event) || typeof rawOrigin !== "string" || !mainWindow) return { ok: false, error: "Invalid website origin." };
    let origin;
    try { const parsed = new URL(rawOrigin); if (!/^https?:$/.test(parsed.protocol)) throw Error(); origin = parsed.origin; }
    catch { return { ok: false, error: "Only http and https website data can be cleared." }; }
    const answer = await dialog.showMessageBox(mainWindow, {
      type: "warning", buttons: ["Clear site data", "Cancel"], defaultId: 1, cancelId: 1,
      title: "Clear website data", message: `Clear cookies and stored data for ${origin}?`,
      detail: "This may sign you out and remove preferences saved by this website."
    });
    if (answer.response !== 0) return { ok: false, canceled: true };
    try {
      await session.fromPartition("persist:nova").clearData({ origins: [origin], dataTypes: ["cookies", "cache", "backgroundFetch", "fileSystems", "indexedDB", "localStorage", "serviceWorkers", "webSQL"] });
      return { ok: true, origin };
    } catch (error) {
      console.error("Could not clear website data:", error.message);
      return { ok: false, error: "Nova could not clear data for this website." };
    }
  });
  ipcMain.handle("browser:save-browser-preferences", async (event, preferences = {}) => {
    if (!fromShell(event) || !preferences || typeof preferences !== "object" ||
      (preferences.restorePreviousSession !== undefined && typeof preferences.restorePreviousSession !== "boolean") ||
      (preferences.clearDataOnExit !== undefined && typeof preferences.clearDataOnExit !== "boolean") ||
      (preferences.searchProvider !== undefined && !Object.hasOwn(searchProviders, preferences.searchProvider))) return { ok: false, error: "Invalid browser preference." };
    const settings = await readSettings();
    if (typeof preferences.restorePreviousSession === "boolean") settings.restorePreviousSession = preferences.restorePreviousSession;
    if (typeof preferences.clearDataOnExit === "boolean") settings.clearDataOnExit = preferences.clearDataOnExit;
    if (typeof preferences.searchProvider === "string") settings.searchProvider = preferences.searchProvider;
    await writeSettings(settings);
    restoreSessionOnLaunch = settings.restorePreviousSession !== false;
    clearDataOnExit = settings.clearDataOnExit === true;
    searchProvider = Object.hasOwn(searchProviders, settings.searchProvider) ? settings.searchProvider : "google";
    return { ok: true, restorePreviousSession: restoreSessionOnLaunch, clearDataOnExit, searchProvider };
  });
  ipcMain.handle("browser:reopen-closed-tab", event => fromShell(event) && reopenClosedTab());
  ipcMain.handle("browser:duplicate-tab", (event, id) => fromShell(event) ? duplicateTab(id) : null);
  ipcMain.handle("browser:pin-tab", (event, id, pinned) => fromShell(event) && pinTab(id, pinned));
  ipcMain.handle("browser:mute-tab", (event, id, muted) => fromShell(event) && setTabMuted(id, muted));
  ipcMain.handle("browser:reorder-tabs", (event, order) => fromShell(event) && reorderTabs(order));
  ipcMain.handle("browser:get-downloads", event => fromShell(event) ? downloadsPayload() : []);
  ipcMain.handle("browser:download-action", async (event, id, action) => {
    if (!fromShell(event) || typeof id !== "string" || !["pause", "resume", "cancel", "open", "reveal", "remove"].includes(action)) return false;
    const entry = downloads.get(id);
    if (!entry) return false;
    const item = entry.item;
    try {
      if (action === "pause" && !item.isPaused()) item.pause();
      else if (action === "resume" && item.isPaused()) item.resume();
      else if (action === "cancel" && item.getState() === "progressing") item.cancel();
      else if (action === "remove" && item.getState() !== "progressing") downloads.delete(id);
      else if (action === "open" && item.getState() === "completed" && item.getSavePath()) return (await shell.openPath(item.getSavePath())) === "";
      else if (action === "reveal" && item.getState() === "completed" && item.getSavePath()) shell.showItemInFolder(item.getSavePath());
      else return false;
      sendDownloads();
      return true;
    } catch (error) {
      console.error("Could not update download:", error.message);
      return false;
    }
  });
  ipcMain.handle("browser:find-page", (event, query, options = {}) => {
    if (!fromShell(event) || typeof query !== "string" || query.length > 512) return false;
    const contents = activeContents();
    if (!contents || !query.trim()) return false;
    contents.findInPage(query.trim(), { forward: options.forward !== false, findNext: options.findNext === true, matchCase: options.matchCase === true });
    return true;
  });
  ipcMain.handle("browser:stop-find", event => {
    if (!fromShell(event)) return false;
    activeContents()?.stopFindInPage("clearSelection");
    return true;
  });
  ipcMain.handle("browser:focus-page", event => {
    if (!fromShell(event)) return false;
    activeContents()?.focus();
    return true;
  });
  ipcMain.handle("browser:print-page", event => fromShell(event) && printActivePage());
  ipcMain.handle("browser:save-pdf", event => fromShell(event) && saveActivePageAsPDF());
  ipcMain.handle("browser:save-page", event => fromShell(event) && saveActivePage());
  ipcMain.handle("browser:save-screenshot", event => fromShell(event) && saveActiveScreenshot());
  ipcMain.handle("browser:group-tabs", (_event, tabIds, options) => groupTabs(tabIds, {
    groupId: options && options.groupId,
    name: options && options.name
  }));
  ipcMain.handle("browser:ungroup-tabs", (_event, tabIds) => ungroupTabs(tabIds));
  ipcMain.handle("browser:rename-group", (_event, groupId, name) => {
    const renamed = groups.rename(groupId, name);
    if (renamed) sendTabs();
    return renamed;
  });
  ipcMain.handle("browser:remove-group", (_event, groupId) => removeGroup(groupId));
  ipcMain.on("browser:show-tab-menu", (event, payload) => {
    if (!fromShell(event)) return;
    if (payload && typeof payload === "object") showTabMenu(payload.id, payload.selectedIds);
    else showTabMenu(payload);
  });
  ipcMain.on("browser:show-navigation-menu", (event, direction) => { if (fromShell(event)) showNavigationMenu(direction); });
  ipcMain.on("browser:show-address-menu", event => { if (fromShell(event)) showAddressMenu(); });
  ipcMain.on("browser:show-closed-menu", event => { if (fromShell(event)) showRecentlyClosedMenu(); });
  ipcMain.on("browser:open-link", (event, payload) => {
    const opener = Array.from(tabs.values()).find(tab => tab.view.webContents === event.sender);
    if (!opener || event.senderFrame !== event.sender.mainFrame || !isWebUrl(payload?.url)) return;
    createTab(payload.url, { groupId: opener.groupId, openerVisit: opener.currentVisit, activate: payload.activate !== false });
  });
  ipcMain.on("browser:history-gesture", (event, direction) => {
    const tab = Array.from(tabs.values()).find(item => item.view.webContents === event.sender);
    if (!tab || event.senderFrame !== event.sender.mainFrame || !["back", "forward"].includes(direction)) return;
    const history = tab.view.webContents.navigationHistory;
    if (direction === "back" && history.canGoBack()) history.goBack();
    else if (direction === "forward" && history.canGoForward()) history.goForward();
  });
  ipcMain.handle("browser:new-tab", (event, url, options = {}) => fromShell(event) ? createTab(url, { activate: options?.activate !== false }) : null);
  ipcMain.handle("browser:activate-tab", (_event, id) => setActiveTab(id));
  ipcMain.handle("browser:close-tab", (_event, id) => closeTab(id));
  ipcMain.handle("browser:navigate", (_event, input) => {
    return navigateActive(input);
  });
  ipcMain.handle("browser:back", () => {
    const history = activeTabId && tabs.get(activeTabId)?.view.webContents.navigationHistory;
    if (history && history.canGoBack()) history.goBack();
  });
  ipcMain.handle("browser:forward", () => {
    const history = activeTabId && tabs.get(activeTabId)?.view.webContents.navigationHistory;
    if (history && history.canGoForward()) history.goForward();
  });
  ipcMain.handle("browser:reload", (_event, ignoreCache = false) => {
    const contents = activeTabId && tabs.get(activeTabId)?.view.webContents;
    if (contents) ignoreCache === true ? contents.reloadIgnoringCache() : contents.reload();
  });
  ipcMain.handle("browser:zoom", (event, request = {}) => {
    if (!fromShell(event)) return false;
    if (Number.isFinite(request.level)) return setActiveZoom(request.level);
    if (Number.isFinite(request.delta)) return adjustActiveZoom(request.delta);
    return false;
  });
  ipcMain.handle("browser:stop", () => {
    const contents = activeTabId && tabs.get(activeTabId)?.view.webContents;
    if (contents) contents.stop();
  });
  // A still image of the visible page, shown behind popups while the live
  // page is hidden.
  ipcMain.handle("browser:capture-page", async () => {
    const tab = activeTabId && tabs.get(activeTabId);
    if (!tab || browserBounds.width === 0 || tab.view.webContents.isDestroyed()) return null;
    try {
      const image = await tab.view.webContents.capturePage();
      return image.isEmpty() ? null : image.toDataURL();
    } catch (_) {
      return null;
    }
  });
  ipcMain.on("browser:set-bounds", (_event, bounds, side) => {
    if (!bounds || !mainWindow) return;
    assistantExpanded = bounds.assistantExpanded === true;
    browserBounds = clampBounds(bounds);
    sideBounds = clampBounds(side);
    updateWebViewVisibility();
  });
  ipcMain.on("assistant:open-from-handle", event => {
    if (!assistantHandleView || event.sender !== assistantHandleView.webContents) return;
    if (browserBounds.width === 0 || browserBounds.height === 0 || assistantExpanded) return;
    sendCommand("assistant", { focusUI: true });
  });
  ipcMain.handle("browser:open-side-tab", (_event, url) => createTab(url, { side: true }));
  ipcMain.handle("browser:close-side-tab", () => (sideTabId ? closeTab(sideTabId) : false));
  // Makes the side tab the main page.
  ipcMain.handle("browser:promote-side-tab", () => (sideTabId ? setActiveTab(sideTabId) : false));
  ipcMain.handle("browser:open-multi-tab", (event, leftId, rightId) => {
    if (!fromShell(event) || !setMultiTabPair(leftId, rightId)) return false;
    return true;
  });
  ipcMain.handle("browser:open-orbit-split", (event, tabId) => {
    if (!fromShell(event) || !setOrbitMultiView(tabId)) return false;
    return true;
  });
  ipcMain.handle("browser:close-multi-view", event => fromShell(event) && closeMultiView());
  ipcMain.on("browser:orbit-visible", (event, visible) => {
    if (fromShell(event)) orbitSceneVisible = visible === true;
  });
  ipcMain.handle("ai:get-config", async () => {
    const settings = await readSettings();
    const keyConfigured = Boolean(await getStoredAPIKey(settings));
    return {
      url: settings.bullsaiUrl || "",
      model: settings.model || "",
      keyConfigured,
      connected: Boolean(settings.bullsaiUrl) && (isKeyOptionalEndpoint(settings.bullsaiUrl) || keyConfigured)
    };
  });
  ipcMain.handle("ai:save-config", async (_event, config) => {
    const url = String(config && config.url || "").trim();
    const model = String(config && config.model || "").trim();
    const apiKey = String(config && config.apiKey || "").trim();
    if (url && !validateAPIEndpoint(url)) return { ok: false, error: "Use an http:// or https:// endpoint URL." };
    const previous = await readSettings();
    const next = { ...voiceSettings(previous), bullsaiUrl: url, model };
    const origin = endpointOrigin(url);
    if (apiKey) {
      if (!await hasProtectedSecretStore()) {
        return { ok: false, error: "OS-backed secret storage is unavailable. Set OLLAMA_API_KEY or BULLSAI_API_KEY before launching Nova." };
      }
      const encrypted = await safeStorage.encryptStringAsync(apiKey);
      next.apiKeyCiphertext = encrypted.toString("base64");
      next.apiKeyOrigin = origin;
    } else if (previous.apiKeyCiphertext && endpointOrigin(previous.bullsaiUrl) === origin && (!previous.apiKeyOrigin || previous.apiKeyOrigin === origin)) {
      next.apiKeyCiphertext = previous.apiKeyCiphertext;
      next.apiKeyOrigin = origin;
    }
    await writeSettings(next);
    const keyConfigured = Boolean(apiKey || next.apiKeyCiphertext || getEnvironmentAPIKey(url));
    return {
      ok: true,
      keyConfigured,
      connected: Boolean(url) && (isKeyOptionalEndpoint(url) || keyConfigured)
    };
  });
  ipcMain.handle("ai:clear-config", async () => {
    await writeSettings(voiceSettings(await readSettings()));
    return { ok: true };
  });
  ipcMain.handle("ai:ask", async (event, request) => {
    const endpoint = await resolveAIEndpoint();
    if (!endpoint.ok) return endpoint;
    const prompt = String(request && request.prompt || "").trim().slice(0, 6000);
    if (!prompt) return { ok: false, error: "Type a question for Nova." };
    const context = Array.isArray(request.context) ? request.context.slice(0, 80).map((tab) => ({
      title: String(tab.title || "Untitled").slice(0, 300),
      url: String(tab.url || "").slice(0, 1000),
      ...(tab.group ? { group: String(tab.group).slice(0, 60) } : {})
    })) : [];
    const sender = event.sender;
    let assistantTargetTabId = null;
    const historySearchIds = new Set();
    return runAgent({
      prompt,
      tabs: context,
      today: localDate(),
      complete: (messages) => chatCompletion(endpoint, messages, { json: true, maxTokens: 800 }),
      openSideTab: async (url) => {
        const useOrbitSplit = orbitSceneVisible;
        const id = createTab(url, useOrbitSplit ? { activate: false } : { side: true });
        assistantTargetTabId = id;
        if (id && useOrbitSplit) setOrbitMultiView(id);
        return id ? { id, ...await readTabText(id) } : null;
      },
      readSideTab: async () => (assistantTargetTabId ? readTabText(assistantTargetTabId, { settle: 1500 }) : null),
      openTabs: (requested, reply) => openRequestedTabs(prompt, requested, reply),
      searchHistory: async (query) => {
        const normalized = String(query || "").trim().toLowerCase().slice(0, 240);
        const ignored = new Set(["a", "an", "the", "my", "this", "that", "from", "about", "history", "page", "pages", "site", "website", "entry", "entries", "delete", "remove", "clear", "matching"]);
        const terms = normalized.split(/[^\p{L}\p{N}.-]+/u).filter(term => term.length > 1 && !ignored.has(term));
        if (!terms.length) return { query: normalized, total: 0, entries: [] };
        const matches = visitHistory.snapshot(tabs).filter(visit => {
          const text = `${visit.title || ""} ${visit.url || ""}`.toLowerCase();
          return terms.every(term => text.includes(term));
        }).sort((a, b) => b.at - a.at);
        const entries = matches.slice(0, 100).map(({ id, title, url, at }) => ({ id, title, url, at }));
        historySearchIds.clear();
        for (const entry of entries) historySearchIds.add(entry.id);
        return { query: normalized, total: matches.length, entries };
      },
      deleteHistory: async ({ ids = [], all = false } = {}) => {
        if (all) {
          const explicitAll = /\b(?:clear|delete|remove|erase)\b[\s\S]*\b(?:all|entire|whole|everything|every)\b[\s\S]*\b(?:browsing\s+)?history(?:\s+(?:in|from)\s+(?:the\s+)?history\s+section)?\s*(?:please)?[.!?]*$/i.test(prompt) ||
            /^\s*(?:(?:please|can you|could you)\s+)*(?:clear|delete|remove|erase)\s+(?:(?:my|the)\s+)?(?:browsing\s+)?history(?:\s+(?:in|from)\s+(?:the\s+)?history\s+section)?\s*(?:please)?[.!?]*\s*$/i.test(prompt);
          if (!explicitAll) return { ok: false, error: "The request didn't explicitly ask to clear all browsing history, so I left it unchanged." };
          const removed = visitHistory.snapshot(tabs).length;
          visitHistory.clear(tabs);
          sendTabs();
          return { ok: true, removed, all: true };
        }
        const safeIds = [...new Set(ids.filter(id => typeof id === "string" && historySearchIds.has(id)))].slice(0, 100);
        if (!safeIds.length) return { ok: true, removed: 0 };
        const removed = visitHistory.removeMany(safeIds, tabs);
        if (removed) sendTabs();
        return { ok: true, removed };
      },
      onProgress: (note) => { if (!sender.isDestroyed()) sender.send("ai:progress", note); }
    });
  });
  ipcMain.handle("voice:get-config", async (event) => {
    if (!fromShell(event)) return {};
    const settings = await readSettings();
    return {
      keyConfigured: Boolean(await getElevenLabsKey()),
      fromEnvironment: Boolean(process.env.ELEVENLABS_API_KEY),
      voiceId: settings.elevenlabsVoiceId || "",
      wakeKeyConfigured: Boolean(await getPicovoiceKey()),
      wakeKeyFromEnvironment: Boolean(process.env.PICOVOICE_ACCESS_KEY)
    };
  });
  ipcMain.handle("voice:save-config", async (event, config) => {
    if (!fromShell(event)) return { ok: false, error: "Not allowed." };
    const apiKey = String(config && config.apiKey || "").trim();
    const wakeKey = String(config && config.wakeKey || "").trim();
    const voiceId = String(config && config.voiceId || "").trim();
    if (voiceId && !/^[\w-]{1,64}$/.test(voiceId)) return { ok: false, error: "That doesn't look like an ElevenLabs voice ID." };
    const next = { ...await readSettings() };
    if (voiceId) next.elevenlabsVoiceId = voiceId;
    else delete next.elevenlabsVoiceId;
    if (config && config.clearKey) delete next.elevenlabsKeyCiphertext;
    if (apiKey) {
      if (!await hasProtectedSecretStore()) {
        return { ok: false, error: "OS-backed secret storage is unavailable. Set ELEVENLABS_API_KEY before launching Nova." };
      }
      next.elevenlabsKeyCiphertext = (await safeStorage.encryptStringAsync(apiKey)).toString("base64");
    }
    if (wakeKey || (config && config.clearWakeKey)) {
      if (wakeKey && !await hasProtectedSecretStore()) {
        return { ok: false, error: "OS-backed secret storage is unavailable. Set PICOVOICE_ACCESS_KEY before launching Nova." };
      }
      if (wakeKey) next.picovoiceKeyCiphertext = (await safeStorage.encryptStringAsync(wakeKey)).toString("base64");
      else delete next.picovoiceKeyCiphertext;
      await fs.rm(wakeWordPath(), { force: true });
    }
    await writeSettings(next);
    return { ok: true, keyConfigured: Boolean(await getElevenLabsKey()), wakeKeyConfigured: Boolean(await getPicovoiceKey()) };
  });
  // The on-device wake word engine runs in the window, so it needs the
  // AccessKey there; Porcupine uses it only to activate the engine.
  ipcMain.handle("voice:get-wake-word", (event) =>
    fromShell(event) ? wakeWordConfig() : { ok: false, configured: false });
  ipcMain.handle("voice:transcribe", (event, audio, mimeType) =>
    fromShell(event) ? transcribeAudio(audio, mimeType) : { ok: false, error: "Not allowed." });
  ipcMain.handle("voice:speak", (event, text) =>
    fromShell(event) ? synthesizeSpeech(text) : { ok: false, error: "Not allowed." });
  // Asks the model how to group the open tabs according to the user's
  // instruction, then applies the plan.
  ipcMain.handle("ai:organize-tabs", async (_event, request) => {
    const endpoint = await resolveAIEndpoint();
    if (!endpoint.ok) return endpoint;
    const instruction = String(request && request.instruction || "").trim();
    if (!instruction) return { ok: false, error: "Describe how you'd like your tabs grouped." };
    // Snapshot the order now; the plan refers to tabs by position in it.
    const ordered = Array.from(tabs.values()).slice(0, 120);
    if (!ordered.length) return { ok: false, error: "There are no open tabs to group." };
    const fullReorganization = /^ungroup\b/i.test(instruction) &&
      /\b(?:all|every|each)\s+(?:of\s+)?(?:the\s+|my\s+)?(?:open\s+)?tabs?\b/i.test(instruction) &&
      /\b(?:and|then|afterwards?)\b/i.test(instruction) &&
      /\b(?:group|regroup|organi[sz]e|categori[sz]e|sort|arrange)\b/i.test(instruction);
    const listing = ordered.map((tab) => {
      const group = tab.groupId ? groups.get(tab.groupId) : null;
      return { title: tab.title, url: tab.url, group: group ? group.name : "" };
    });
    const result = await chatCompletion(endpoint, buildGroupingMessages(instruction, listing), { json: true, maxTokens: 1500 });
    if (!result.ok) return result;
    const plan = parseGroupingPlan(result.text, ordered.length);
    if (!plan) return { ok: false, error: "The model's answer wasn't a grouping plan I could use. Try rephrasing." };
    return { ok: true, ...applyGroupingPlan(plan, ordered, { resetExistingGroups: fullReorganization && plan.groups.length > 0 }) };
  });
}

function localDate() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) +
    " (" + now.toLocaleDateString("en-US", { weekday: "long" }) + ")";
}

// The visible text of a tab once it has finished loading. settle gives
// script-rendered results (flight prices, for one) time to appear.
async function readTabText(id, { settle = 3000 } = {}) {
  const tab = tabs.get(String(id));
  if (!tab) return null;
  const contents = tab.view.webContents;
  if (contents.isLoading()) {
    await new Promise((resolve) => {
      const timer = setTimeout(done, 15000);
      function done() { clearTimeout(timer); contents.removeListener("did-stop-loading", done); resolve(); }
      contents.once("did-stop-loading", done);
    });
  }
  await new Promise((resolve) => setTimeout(resolve, settle));
  if (contents.isDestroyed()) return null;
  let text = "";
  try {
    text = String(await contents.executeJavaScript("document.body ? document.body.innerText : ''", false) || "");
  } catch (_) {}
  return { title: contents.getTitle(), url: contents.getURL(), text: text.replace(/\n{3,}/g, "\n\n").slice(0, 8000) };
}

// ElevenLabs speech-to-text and text-to-speech. The key stays in the main
// process; the renderer only learns whether one is stored.
const ELEVENLABS_API = "https://api.elevenlabs.io/v1";
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";

function voiceSettings(settings) {
  const kept = {};
  for (const key of ["elevenlabsKeyCiphertext", "elevenlabsVoiceId", "picovoiceKeyCiphertext"]) {
    if (settings && settings[key]) kept[key] = settings[key];
  }
  return kept;
}

async function getElevenLabsKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const settings = await readSettings();
  if (!settings.elevenlabsKeyCiphertext || !await hasProtectedSecretStore()) return "";
  try {
    return (await safeStorage.decryptStringAsync(Buffer.from(settings.elevenlabsKeyCiphertext, "base64"))).result;
  } catch (_) {
    return "";
  }
}

// Picovoice Porcupine detects "Hey Nova" on the device, so only the
// request that follows it is sent to ElevenLabs. Optional: without a
// Picovoice AccessKey, Nova checks each transcript for the phrase instead.
const WAKE_PHRASE = "hey nova";
const PORCUPINE_MODEL = path.join(__dirname, "vendor", "porcupine", "porcupine_params.pv");

async function getPicovoiceKey() {
  if (process.env.PICOVOICE_ACCESS_KEY) return process.env.PICOVOICE_ACCESS_KEY;
  const settings = await readSettings();
  if (!settings.picovoiceKeyCiphertext || !await hasProtectedSecretStore()) return "";
  try {
    return (await safeStorage.decryptStringAsync(Buffer.from(settings.picovoiceKeyCiphertext, "base64"))).result;
  } catch (_) {
    return "";
  }
}

function wakeWordPath() {
  return path.join(app.getPath("userData"), "wake-word", "hey-nova_wasm.ppn");
}

// The keyword model is trained once from the phrase through Picovoice's API
// and kept in the profile; a new AccessKey trains it again.
async function wakeWordConfig() {
  const accessKey = await getPicovoiceKey();
  if (!accessKey) return { ok: false, configured: false };
  let keyword;
  try {
    keyword = await fs.readFile(wakeWordPath());
  } catch (_) {
    try {
      const response = await fetch("https://rest.picovoice.ai/en/api/ppn", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": accessKey },
        body: JSON.stringify({ platform: "wasm", phrase: WAKE_PHRASE }),
        signal: AbortSignal.timeout(60000)
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 200);
        return { ok: false, configured: true, error: response.status === 401 || response.status === 403
          ? "Picovoice rejected the AccessKey."
          : "Picovoice couldn't train the wake word (" + response.status + (detail ? ": " + detail : "") + ")." };
      }
      keyword = Buffer.from(await response.arrayBuffer());
      await fs.mkdir(path.dirname(wakeWordPath()), { recursive: true });
      await fs.writeFile(wakeWordPath(), keyword);
    } catch (error) {
      return { ok: false, configured: true, error: "Couldn't reach Picovoice to train the wake word: " + (error.message || "network error") };
    }
  }
  const model = await fs.readFile(PORCUPINE_MODEL);
  return { ok: true, configured: true, accessKey, label: WAKE_PHRASE, keyword: keyword.toString("base64"), model: model.toString("base64") };
}

async function elevenLabsError(response) {
  let detail = "";
  try {
    const data = await response.json();
    detail = typeof data.detail === "string" ? data.detail : (data.detail && data.detail.message) || "";
  } catch (_) {}
  if (response.status === 401) return "ElevenLabs rejected the API key.";
  return "ElevenLabs returned " + response.status + (detail ? ": " + String(detail).slice(0, 200) : ".");
}

async function transcribeAudio(audio, mimeType) {
  const apiKey = await getElevenLabsKey();
  if (!apiKey) return { ok: false, error: "Add an ElevenLabs API key in settings to use voice." };
  const bytes = audio instanceof Uint8Array ? audio : new Uint8Array(audio || []);
  if (!bytes.length) return { ok: false, error: "No audio was recorded." };
  if (bytes.length > 20 * 1024 * 1024) return { ok: false, error: "That recording is too long." };
  const type = /^audio\/[\w.+-]+(;.*)?$/.test(String(mimeType)) ? String(mimeType) : "audio/webm";
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append("file", new Blob([bytes], { type }), /wav/.test(type) ? "speech.wav" : "speech.webm");
  try {
    const response = await fetch(ELEVENLABS_API + "/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) return { ok: false, error: await elevenLabsError(response) };
    const data = await response.json();
    return { ok: true, text: String(data.text || "").trim() };
  } catch (error) {
    return { ok: false, error: error.message || "Could not reach ElevenLabs." };
  }
}

async function synthesizeSpeech(text) {
  const apiKey = await getElevenLabsKey();
  if (!apiKey) return { ok: false, error: "Add an ElevenLabs API key in settings to hear replies." };
  const input = String(text || "").trim().slice(0, 2500);
  if (!input) return { ok: false, error: "Nothing to say." };
  const settings = await readSettings();
  const voiceId = /^[\w-]{1,64}$/.test(settings.elevenlabsVoiceId || "") ? settings.elevenlabsVoiceId : DEFAULT_VOICE_ID;
  try {
    const response = await fetch(ELEVENLABS_API + "/text-to-speech/" + voiceId + "?output_format=mp3_44100_128", {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", "Accept": "audio/mpeg" },
      body: JSON.stringify({ text: input, model_id: "eleven_flash_v2_5" }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) return { ok: false, error: await elevenLabsError(response) };
    return { ok: true, audio: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    return { ok: false, error: error.message || "Could not reach ElevenLabs." };
  }
}

// Settings, key and URL for the configured chat endpoint.
async function resolveAIEndpoint() {
  const settings = await readSettings();
  if (!settings.bullsaiUrl) return { ok: false, error: "Connect an AI endpoint in settings first." };
  const apiKey = await getStoredAPIKey(settings);
  if (!apiKey && !isKeyOptionalEndpoint(settings.bullsaiUrl)) return { ok: false, error: "Add the API key for this endpoint in settings first." };
  return { ok: true, url: settings.bullsaiUrl, model: settings.model || undefined, apiKey };
}

// Opens up to three tabs the model asked for, but only when the user
// explicitly asked for websites or tabs to be opened. Returns the reply.
async function openRequestedTabs(prompt, requested, reply) {
  const allowed = explicitlyRequestsTabs(prompt);
  const opened = [];
  const openedIds = [];
  const comparison = allowed && explicitlyRequestsComparison(prompt);
  const orbitPair = allowed && !comparison && orbitSceneVisible;
  if (allowed) {
    for (const entry of requested.slice(0, 3)) {
      const url = normalizeAssistantWebUrl(entry.url);
      if (!url) continue;
      const id = createTab(url, { activate: !comparison && !orbitPair && entry.activate === true });
      if (id) { opened.push(url); openedIds.push(id); }
    }
    if (comparison && openedIds.length >= 2) setMultiTabPair(openedIds[0], openedIds[1]);
    else if (orbitPair && openedIds.length) setOrbitMultiView(openedIds[0]);
    else if (comparison && openedIds.length) setActiveTab(openedIds[0]);
  }
  let text = reply || (opened.length ? "I opened the requested websites in new tabs." : "");
  if (requested.length && !opened.length) {
    text += (text ? "\n" : "") + (allowed
      ? "I couldn’t open those tabs because their URLs were not valid web addresses."
      : "I didn’t open any tabs because you didn’t ask me to open websites.");
  }
  if (opened.length) text += "\n\nOpened " + opened.length + (opened.length === 1 ? " new tab:" : " new tabs:") + "\n" + opened.join("\n");
  if (openedIds.length) {
    const pages = (await Promise.all(openedIds.map(id => readTabText(id, { settle: 1800 })))).filter(Boolean);
    if (pages.length) return { text, pages };
  }
  return text;
}

function explicitlyRequestsTabs(prompt) {
  const text = String(prompt || "").trim();
  if (/\b(?:don't|do not|never|without)\b[^.!?]{0,60}\b(?:open|visit|browse|search|create|make)\b/i.test(text)) return false;
  const comparison = explicitlyRequestsComparison(text);
  if (!comparison && (/^(?:how|what|why|when|where)\b/i.test(text) || /\bhow (?:do|can|would) I\b/i.test(text))) return false;
  return /\b(?:open|visit|browse to|search(?: the web)? for|navigate to|go to|create|make)\b/i.test(text) ||
    /\b(?:new|another|multiple|\d+)\s+(?:browser\s+)?tabs?\b/i.test(text) || comparison;
}

function explicitlyRequestsComparison(prompt) {
  const text = String(prompt || "").trim();
  if (/\b(?:don't|do not|never|without)\b[^.!?]{0,60}\b(?:compare|comparing|comparison|contrast)\b/i.test(text)) return false;
  return /\b(?:compare|comparing|comparison|versus|vs\.?|side[- ]by[- ]side|differences? between)\b/i.test(text);
}

function normalizeAssistantWebUrl(value) {
  const input = String(value || "").trim().slice(0, 2048);
  if (!input || /^[a-z][a-z\d+.-]*:/i.test(input) && !/^https?:\/\//i.test(input)) return null;
  let parsed;
  try {
    parsed = new URL(input);
  } catch (_) {
    if (!/^(?:localhost|(?:[\w-]+\.)+[a-z\d-]{2,})(?::\d+)?(?:\/[^\s]*)?$/i.test(input)) return null;
    try { parsed = new URL("https://" + input); } catch (_) { return null; }
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
}

// The endpoint's own reason for a failed request, such as an invalid key or
// unknown model, so the message says more than a status code.
async function aiEndpointError(response) {
  let detail = "";
  try {
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      const error = (Array.isArray(data) ? data[0] : data)?.error;
      detail = typeof error === "string" ? error : error?.message || data?.message || "";
    } catch (_) {
      detail = /^\s*</.test(text) ? "" : text;
    }
  } catch (_) {}
  detail = String(detail).replace(/\s+/g, " ").trim().slice(0, 200);
  return "The AI endpoint returned " + response.status + (detail ? ": " + detail : ".");
}

// One OpenAI-style chat completion. With json, asks for JSON output and
// retries without that option for endpoints that reject it.
async function chatCompletion(endpoint, messages, { json = false, maxTokens = 1000 } = {}) {
  const send = (withFormat) => fetch(endpoint.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(endpoint.apiKey ? { "Authorization": "Bearer " + endpoint.apiKey } : {})
    },
    body: JSON.stringify({
      model: endpoint.model,
      max_tokens: maxTokens,
      messages,
      ...(withFormat ? { response_format: { type: "json_object" } } : {})
    }),
    signal: AbortSignal.timeout(60000)
  });
  try {
    let response = await send(json);
    if (json && (response.status === 400 || response.status === 422)) response = await send(false);
    if (!response.ok) return { ok: false, error: await aiEndpointError(response) };
    const data = await response.json();
    let answer = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (Array.isArray(answer)) answer = answer.map((part) => part.text || "").join("");
    if (!answer) return { ok: false, error: "The response did not include a chat completion." };
    return { ok: true, text: answer };
  } catch (error) {
    return { ok: false, error: error.message || "Could not connect to the AI endpoint." };
  }
}

// Applies a parsed plan to the tabs it was made from. Tabs closed while the
// model was thinking are skipped. Returns a summary for the assistant.
function applyGroupingPlan(plan, ordered, { resetExistingGroups = false } = {}) {
  const live = (indexes) => indexes.map((index) => ordered[index]).filter((tab) => tab && tabs.get(tab.id) === tab);
  const summary = [];
  const previouslyGrouped = new Set();
  if (resetExistingGroups) {
    for (const tab of ordered) {
      if (tabs.get(tab.id) !== tab || !tab.groupId) continue;
      previouslyGrouped.add(tab.id);
      tab.groupId = null;
    }
  }
  for (const entry of plan.groups) {
    const members = live(entry.indexes);
    if (!members.length) continue;
    const existing = groups.list().find((group) => group.name.toLowerCase() === entry.name.toLowerCase());
    const id = existing ? existing.id : groups.create(entry.name);
    for (const tab of members) tab.groupId = id;
    summary.push({ name: groups.get(id).name, count: members.length, created: !existing });
  }
  const ungrouped = live(plan.ungroup);
  for (const tab of ungrouped) tab.groupId = null;
  sendTabs();
  const ungroupedCount = resetExistingGroups
    ? ordered.filter(tab => tabs.get(tab.id) === tab && previouslyGrouped.has(tab.id) && !tab.groupId).length
    : ungrouped.length;
  return { groups: summary, ungrouped: ungroupedCount, reply: plan.reply };
}

app.whenReady().then(async () => {
  if (process.platform === "win32") app.setAppUserModelId("edu.buffalo.nova");
  if (process.platform === "linux" && !launch.testHidden) {
    const appImage = app.isPackaged ? process.env.APPIMAGE : null;
    const executable = appImage || process.execPath;
    const args = appImage && process.env.APPIMAGE_EXTRACT_AND_RUN === "1" ? ["--appimage-extract-and-run"] : app.isPackaged ? [] : [app.getAppPath()];
    try {
      await registerLinuxDesktop({
        dataHome: process.env.XDG_DATA_HOME || path.join(app.getPath("home"), ".local", "share"),
        iconPath: path.join(__dirname, "assets", "icon.png"), executable, args
      });
    } catch (error) { console.error("Could not register the Nova desktop icon:", error.message); }
  }
  try {
    const settings = await readSettings();
    restoreSessionOnLaunch = !launch.startUrl && settings.restorePreviousSession !== false;
    clearDataOnExit = settings.clearDataOnExit === true;
    searchProvider = Object.hasOwn(searchProviders, settings.searchProvider) ? settings.searchProvider : "google";
    if (settings.siteZoomLevels && typeof settings.siteZoomLevels === "object") {
      for (const [origin, level] of Object.entries(settings.siteZoomLevels)) {
        if (/^https?:\/\//.test(origin) && Number.isFinite(level)) siteZoomLevels.set(origin, Math.max(-7.6, Math.min(8.8, level)));
      }
    }
    if (restoreSessionOnLaunch) {
      try {
        const snapshot = JSON.parse(fsSync.readFileSync(sessionSnapshotPath(), "utf8"));
        if (snapshot?.version === 1 && Array.isArray(snapshot.tabs)) sessionRestoreSnapshot = snapshot;
      } catch { sessionRestoreSnapshot = null; }
    }
  } catch (error) { console.error("Could not load site zoom preferences:", error.message); }
  try { bookmarks = new BookmarkStore(path.join(app.getPath("userData"), "nova-bookmarks.json")); }
  catch (error) {
    console.error("Bookmarks could not be loaded:", error.message);
    bookmarks = new BookmarkStore(null);
    dialog.showErrorBox("Bookmarks unavailable", "Your bookmarks file could not be read. It has been left untouched; new bookmarks will only last for this session.");
  }
  try { readingList = new ReadingListStore(path.join(app.getPath("userData"), "nova-reading-list.json")); }
  catch (error) {
    console.error("Reading List could not be loaded:", error.message);
    readingList = new ReadingListStore(null);
    dialog.showErrorBox("Reading List unavailable", "Your existing Reading List could not be read. It has been left untouched; new items will only last for this session.");
  }
  try { visitHistory = new HistoryStore(path.join(app.getPath("userData"), "nova-history.json")); }
  catch (error) {
    // Preserve an unreadable file instead of overwriting the user's history.
    console.error("History could not be loaded:", error.message);
    visitHistory = new HistoryStore(null);
    dialog.showErrorBox("History unavailable", "Your existing history file could not be read. It has been left untouched; new history will only last for this session.");
  }
  installPermissionPrompts();
  registerIPC();
  createApplicationMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", event => {
  if (tabs.size) saveSessionSnapshot();
  visitHistory?.flush();
  if (clearDataOnExit && !clearingDataForExit) {
    event.preventDefault();
    clearingDataForExit = true;
    session.fromPartition("persist:nova").clearData({ dataTypes: ["cookies", "cache", "backgroundFetch", "fileSystems", "indexedDB", "localStorage", "serviceWorkers", "webSQL"] })
      .catch(error => console.error("Could not clear site data on exit:", error.message))
      .finally(() => app.quit());
    return;
  }
  for (const tab of tabs.values()) {
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  }
  tabs.clear();
});
