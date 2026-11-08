"use strict";

const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  Menu,
  dialog,
  safeStorage,
  screen,
  shell,
  session
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const START_PAGE_URL = pathToFileURL(path.join(__dirname, "ui", "newtab", "index.html")).href;
const START_PAGE_ICON = pathToFileURL(path.join(__dirname, "ui", "newtab", "icon.svg")).href;
const isStartPage = url => url === START_PAGE_URL;
const { createTabGroups } = require("./tab-groups");
const { buildGroupingMessages, parseGroupingPlan } = require("./ai-grouping");
const { runAgent } = require("./ai-agent");

const { HistoryStore } = require("./history-store");
const { trackConnectionSecurity } = require("./connection-security");
if (process.env.ORBIT_USER_DATA) app.setPath("userData", process.env.ORBIT_USER_DATA);
let visitHistory;

const tabs = new Map();
const groups = createTabGroups();
const permissionGrants = new Map();
const hiddenBounds = { x: 0, y: 0, width: 0, height: 0 };
let mainWindow = null;
let assistantHandleView = null;
let activeTabId = null;
// A tab the assistant opened beside the current page. It is an ordinary tab
// shown next to the active one until it is closed or switched to.
let sideTabId = null;
let nextTabId = 1;
let browserBounds = { ...hiddenBounds };
let assistantExpanded = false;
let sideBounds = { ...hiddenBounds };
let settingsCache = null;

function normalizeDestination(input) {
  const value = String(input || "").trim();
  if (!value || value === "orbit://newtab" || value === "orbit://newtab/" || isStartPage(value)) return START_PAGE_URL;

  const looksLikeHost = /^(localhost(?::\d+)?|[\w-]+(?:\.[\w-]+)+(?:\/[^\s]*)?)$/i.test(value);
  if (looksLikeHost) {
    try { return new URL("https://" + value).href; } catch (_) {}
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
    return "https://www.google.com/search?q=" + encodeURIComponent(value);
  } catch (_) {
    return "https://www.google.com/search?q=" + encodeURIComponent(value);
  }
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
    url: isStartPage(tab.url) ? "orbit://newtab" : tab.url || "",
    isStartPage: isStartPage(tab.url),
    favicon: tab.favicon || "",
    active: tab.id === activeTabId,
    side: tab.id === sideTabId,
    loading: tab.loading,
    lastAccessed: tab.lastAccessed,
    canGoBack: history.canGoBack(),
    canGoForward: history.canGoForward(),
    currentVisit: tab.currentVisit,
    connection: isStartPage(tab.url) ? { state: "local", message: "Orbit start page — stored on this device" } : tab.connection?.snapshot(tab.url),
    groupId: tab.groupId || null
  };
}

function tabsPayload() {
  groups.prune(tabs);
  return {
    tabs: Array.from(tabs.values()).map(tabSnapshot),
    groups: groups.list(),
    activeId: activeTabId,
    sideId: sideTabId
  };
}

function sendTabs() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("browser:tabs-updated", tabsPayload());
  mainWindow.webContents.send("browser:history-updated", visitHistory.snapshot(tabs));
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

function showTabMenu(id) {
  const tab = tabs.get(String(id));
  if (!tab || !mainWindow) return;
  const current = tab.groupId ? groups.get(tab.groupId) : null;
  const others = groups.list().filter((group) => group.id !== tab.groupId);
  const template = [
    { label: "New constellation with this tab", click: () => groupTabs([tab.id]) }
  ];
  if (others.length) {
    template.push({
      label: "Add to constellation",
      submenu: others.map((group) => ({ label: group.name, click: () => groupTabs([tab.id], { groupId: group.id }) }))
    });
  }
  if (current) {
    template.push(
      { type: "separator" },
      { label: "Remove from " + current.name, click: () => ungroupTabs([tab.id]) },
      { label: "Rename " + current.name + "…", click: () => sendCommand("rename-group", { focusUI: true, arg: current.id }) },
      { label: "Ungroup " + current.name, click: () => removeGroup(current.id) }
    );
  }
  template.push({ type: "separator" }, { label: "Close tab", click: () => closeTab(tab.id) });
  Menu.buildFromTemplate(template).popup({ window: mainWindow });
}

function updateWebViewVisibility() {
  const hasArea = (bounds) => bounds.width > 0 && bounds.height > 0;
  for (const tab of tabs.values()) {
    let bounds = hiddenBounds;
    if (tab.id === activeTabId && hasArea(browserBounds)) bounds = browserBounds;
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
}

// After the active tab goes away: the most recent remaining tab, preferring
// one that isn't the side tab.
function pickFallbackTab() {
  const ids = Array.from(tabs.keys()).filter((id) => id !== sideTabId);
  return ids.pop() || Array.from(tabs.keys()).pop() || null;
}

function setActiveTab(id) {
  if (!tabs.has(String(id))) return false;
  activeTabId = String(id);
  if (sideTabId === activeTabId) sideTabId = null;
  tabs.get(activeTabId).lastAccessed = Date.now();
  updateWebViewVisibility();
  sendTabs();
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
  // Ctrl+Space opens the assistant even while the page has focus, in case the
  // menu accelerator does not reach a focused child view.
  contents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.control && !input.alt && !input.meta && input.code === "Space") {
      event.preventDefault();
      sendCommand("assistant", { focusUI: true });
    }
  });
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
    const menu = Menu.buildFromTemplate([
      { label: "Back", enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() },
      { label: "Forward", enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() },
      { type: "separator" },
      { role: "copy", enabled: params.selectionText.length > 0 },
      { role: "paste" },
      { role: "selectAll" },
      { type: "separator" },
      { label: "Reload", click: () => contents.reload() }
    ]);
    menu.popup({ window: mainWindow });
  });
  contents.on("render-process-gone", () => {
    tab.loading = false;
    tab.title = "This page stopped responding";
    sendTabs();
  });
  contents.on("destroyed", () => {
    if (!tabs.has(tab.id)) return;
    tabs.delete(tab.id);
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
      partition: "persist:orbit",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
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
    if (!createTab()) return false;
    return closeTab(id);
  }
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
  return path.join(app.getPath("userData"), "orbit-settings.json");
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

function installPermissionPrompts() {
  const configureSession = (ses) => {
    ses.setPermissionCheckHandler((contents, permission, requestingOrigin) => {
      if (mainWindow && contents === mainWindow.webContents && permission === "media") return true;
      const grant = permissionGrants.get(permissionOrigin(requestingOrigin));
      return Boolean(grant && grant.has(permission));
    });
    ses.setPermissionRequestHandler(async (contents, permission, callback, details) => {
      // ORBIT's own window may use the microphone for push-to-talk.
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
      const displayOrigin = origin === "file://" ? "ORBIT desktop" : origin;
      const answer = await dialog.showMessageBox(mainWindow, {
        type: "question",
        buttons: ["Allow", "Block"],
        defaultId: 1,
        cancelId: 1,
        title: "Website permission",
        message: displayOrigin + " wants to " + (labels[permission] || ("use " + permission)),
        detail: "Only allow access for websites you trust."
      });
      if (answer.response !== 0) return callback(false);
      const updated = permissionGrants.get(origin) || new Set();
      updated.add(permission);
      permissionGrants.set(origin, updated);
      callback(true);
    });
  };
  configureSession(session.defaultSession);
  configureSession(session.fromPartition("persist:orbit"));
}

function sendCommand(command, { focusUI = false, arg } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (focusUI) mainWindow.webContents.focus();
  mainWindow.webContents.send("browser:command", command, arg);
}

function createApplicationMenu() {
  const template = [
    {
      label: "ORBIT",
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
        { label: "Close Tab", accelerator: "CommandOrControl+W", click: () => sendCommand("close-tab") },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    {
      label: "View",
      submenu: [
        { label: "Focus Address Bar", accelerator: "CommandOrControl+L", click: () => sendCommand("focus-address", { focusUI: true }) },
        { label: "Reload Page", accelerator: "CommandOrControl+R", click: () => sendCommand("reload") },
        { label: "History constellation", accelerator: "CommandOrControl+H", click: () => sendCommand("history", { focusUI: true }) },
        { label: "Tab Cosmos", accelerator: "CommandOrControl+Shift+O", click: () => sendCommand("cosmos", { focusUI: true }) },
        { label: "Ask Orbit", accelerator: "Control+Space", click: () => sendCommand("assistant", { focusUI: true }) },
        { type: "separator" },
        { role: "toggleDevTools" }
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
    show: process.env.ORBIT_TEST_HIDDEN !== "1",
    width,
    height,
    minWidth,
    minHeight,
    center: true,
    resizable: true,
    maximizable: true,
    backgroundColor: "#080d1c",
    title: "ORBIT",
    webPreferences: {
      preload: path.join(__dirname, "desktop-preload.js"),
      backgroundThrottling: process.env.ORBIT_TEST_HIDDEN !== "1",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow = win;
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
    if (mainWindow === win && tabs.size === 0) createTab(process.env.ORBIT_START_URL);
  });
  win.on("closed", () => {
    if (mainWindow === win) {
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
  ipcMain.handle("browser:get-history", event => fromShell(event) ? visitHistory.snapshot(tabs) : []);
  ipcMain.handle("browser:open-history", (event, id) => {
    if (!fromShell(event)) return false;
    const node = visitHistory.nodes.find(n => n.id === id);
    if (!node) return false;
    const live = Array.from(tabs.values()).find(t => t.currentVisit === id);
    if (live) return setActiveTab(live.id);
    return createTab(node.url, { openerVisit: node.id });
  });
  ipcMain.handle("browser:clear-history", event => {
    if (!fromShell(event)) return false;
    visitHistory.clear(tabs);
    sendTabs();
    return true;
  });
  ipcMain.handle("browser:get-tabs", () => tabsPayload());
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
  ipcMain.on("browser:show-tab-menu", (_event, id) => showTabMenu(id));
  ipcMain.handle("browser:new-tab", (_event, url) => createTab(url));
  ipcMain.handle("browser:activate-tab", (_event, id) => setActiveTab(id));
  ipcMain.handle("browser:close-tab", (_event, id) => closeTab(id));
  ipcMain.handle("browser:navigate", (_event, input) => {
    if (!activeTabId || !tabs.has(activeTabId)) return createTab(input);
    const target = normalizeDestination(input);
    tabs.get(activeTabId).freshNavigation = true;
    tabs.get(activeTabId).view.webContents.loadURL(target).catch(() => {});
    return target;
  });
  ipcMain.handle("browser:back", () => {
    const history = activeTabId && tabs.get(activeTabId)?.view.webContents.navigationHistory;
    if (history && history.canGoBack()) history.goBack();
  });
  ipcMain.handle("browser:forward", () => {
    const history = activeTabId && tabs.get(activeTabId)?.view.webContents.navigationHistory;
    if (history && history.canGoForward()) history.goForward();
  });
  ipcMain.handle("browser:reload", () => {
    const contents = activeTabId && tabs.get(activeTabId)?.view.webContents;
    if (contents) contents.reload();
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
        return { ok: false, error: "OS-backed secret storage is unavailable. Set OLLAMA_API_KEY or BULLSAI_API_KEY before launching ORBIT." };
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
    if (!prompt) return { ok: false, error: "Type a question for Orbit." };
    const context = Array.isArray(request.context) ? request.context.slice(0, 80).map((tab) => ({
      title: String(tab.title || "Untitled").slice(0, 300),
      url: String(tab.url || "").slice(0, 1000),
      ...(tab.group ? { group: String(tab.group).slice(0, 60) } : {})
    })) : [];
    const sender = event.sender;
    return runAgent({
      prompt,
      tabs: context,
      today: localDate(),
      complete: (messages) => chatCompletion(endpoint, messages, { json: true, maxTokens: 800 }),
      openSideTab: async (url) => {
        const id = createTab(url, { side: true });
        return id ? { id, ...await readTabText(id) } : null;
      },
      readSideTab: async () => (sideTabId ? readTabText(sideTabId, { settle: 1500 }) : null),
      openTabs: (requested, reply) => openRequestedTabs(prompt, requested, reply),
      onProgress: (note) => { if (!sender.isDestroyed()) sender.send("ai:progress", note); }
    });
  });
  ipcMain.handle("voice:get-config", async (event) => {
    if (!fromShell(event)) return {};
    const settings = await readSettings();
    return {
      keyConfigured: Boolean(await getElevenLabsKey()),
      fromEnvironment: Boolean(process.env.ELEVENLABS_API_KEY),
      voiceId: settings.elevenlabsVoiceId || ""
    };
  });
  ipcMain.handle("voice:save-config", async (event, config) => {
    if (!fromShell(event)) return { ok: false, error: "Not allowed." };
    const apiKey = String(config && config.apiKey || "").trim();
    const voiceId = String(config && config.voiceId || "").trim();
    if (voiceId && !/^[\w-]{1,64}$/.test(voiceId)) return { ok: false, error: "That doesn't look like an ElevenLabs voice ID." };
    const next = { ...await readSettings() };
    if (voiceId) next.elevenlabsVoiceId = voiceId;
    else delete next.elevenlabsVoiceId;
    if (config && config.clearKey) delete next.elevenlabsKeyCiphertext;
    if (apiKey) {
      if (!await hasProtectedSecretStore()) {
        return { ok: false, error: "OS-backed secret storage is unavailable. Set ELEVENLABS_API_KEY before launching ORBIT." };
      }
      next.elevenlabsKeyCiphertext = (await safeStorage.encryptStringAsync(apiKey)).toString("base64");
    }
    await writeSettings(next);
    return { ok: true, keyConfigured: Boolean(await getElevenLabsKey()) };
  });
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
    const listing = ordered.map((tab) => {
      const group = tab.groupId ? groups.get(tab.groupId) : null;
      return { title: tab.title, url: tab.url, group: group ? group.name : "" };
    });
    const result = await chatCompletion(endpoint, buildGroupingMessages(instruction, listing), { json: true, maxTokens: 1500 });
    if (!result.ok) return result;
    const plan = parseGroupingPlan(result.text, ordered.length);
    if (!plan) return { ok: false, error: "The model's answer wasn't a grouping plan I could use. Try rephrasing." };
    return { ok: true, ...applyGroupingPlan(plan, ordered) };
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
  for (const key of ["elevenlabsKeyCiphertext", "elevenlabsVoiceId"]) {
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
  form.append("file", new Blob([bytes], { type }), "speech.webm");
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
function openRequestedTabs(prompt, requested, reply) {
  const allowed = explicitlyRequestsTabs(prompt);
  const opened = [];
  if (allowed) {
    for (const entry of requested.slice(0, 3)) {
      const url = normalizeAssistantWebUrl(entry.url);
      if (!url) continue;
      if (createTab(url, { activate: entry.activate === true })) opened.push(url);
    }
  }
  let text = reply || (opened.length ? "I opened the requested websites in new tabs." : "");
  if (requested.length && !opened.length) {
    text += (text ? "\n" : "") + (allowed
      ? "I couldn’t open those tabs because their URLs were not valid web addresses."
      : "I didn’t open any tabs because you didn’t ask me to open websites.");
  }
  return opened.length
    ? text + "\n\nOpened " + opened.length + (opened.length === 1 ? " new tab:" : " new tabs:") + "\n" + opened.join("\n")
    : text;
}

function explicitlyRequestsTabs(prompt) {
  const text = String(prompt || "").trim();
  if (/\b(?:don't|do not|never|without)\b[^.!?]{0,60}\b(?:open|visit|browse|create|make)\b/i.test(text)) return false;
  if (/^(?:how|what|why|when|where)\b/i.test(text) || /\bhow (?:do|can|would) I\b/i.test(text)) return false;
  return /\b(?:open|visit|browse to|navigate to|go to|create|make)\b/i.test(text) ||
    /\b(?:new|another|multiple|\d+)\s+(?:browser\s+)?tabs?\b/i.test(text);
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
    if (!response.ok) return { ok: false, error: "The AI endpoint returned " + response.status + "." };
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
function applyGroupingPlan(plan, ordered) {
  const live = (indexes) => indexes.map((index) => ordered[index]).filter((tab) => tab && tabs.get(tab.id) === tab);
  const summary = [];
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
  return { groups: summary, ungrouped: ungrouped.length, reply: plan.reply };
}

app.whenReady().then(() => {
  try { visitHistory = new HistoryStore(path.join(app.getPath("userData"), "orbit-history.json")); }
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

app.on("before-quit", () => {
  visitHistory?.flush();
  for (const tab of tabs.values()) {
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  }
  tabs.clear();
});
