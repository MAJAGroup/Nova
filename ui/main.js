import { createTabStore } from "./lib/tab-store.js";
import { createAIConfig } from "./lib/ai-config.js";
import { createToolbar } from "./components/toolbar.js";
import { createTabStrip } from "./components/tab-strip.js";
import { createBrowserView } from "./components/browser-view.js";
import { createSettingsModal } from "./components/settings-modal.js";
import { createAssistantPanel } from "./components/assistant/assistant-panel.js";
import { createCosmosView } from "./components/cosmos/cosmos-view.js";

import { createHistoryView } from "./components/history/history-view.js";
import { createBookmarksView } from "./components/bookmarks/bookmarks-view.js";
import { migrateNovaPreferences } from "./lib/preferences.js";
import { createFindBar } from "./components/find-bar.js";
import { createDownloadsView } from "./components/downloads-view.js";
import { createPermissionsView } from "./components/permissions-view.js";
import { createReadingListView } from "./components/reading-list-view.js";
import { showToast } from "./components/toast.js";

const browser = window.novaBrowser;

function start() {
  migrateNovaPreferences();
  try { document.documentElement.dataset.enhancedContrast = String(localStorage.getItem("nova.enhancedContrast") === "1"); } catch { document.documentElement.dataset.enhancedContrast = "false"; }
  const tabs = createTabStore(browser);
  const aiConfig = createAIConfig(browser);
  const findBar = createFindBar({ browser, tabs });
  const downloads = createDownloadsView({ browser, onVisibilityChange: open => browserView?.cover("downloads", open) });
  const shortcutsDialog = document.getElementById("shortcuts-dialog");
  const showShortcuts = () => {
    if (!shortcutsDialog.open) { shortcutsDialog.showModal(); browserView?.cover("shortcuts", true); }
  };
  shortcutsDialog.addEventListener("close", () => browserView?.cover("shortcuts", false));
  shortcutsDialog.addEventListener("click", event => {
    if (event.target === shortcutsDialog || event.target.closest("[data-close-utility]")) shortcutsDialog.close();
  });
  let cosmos, history, bookmarks, permissions, readingList;
  let aiTaskBusy = false, aiSceneTransferTimer = 0, aiSceneStartedForTask = false;
  let preserveCosmosTabChanges = 0;
  const openNewTab = () => {
    const preserveNova = Boolean(cosmos && cosmos.isOpen() && cosmos.stayOnNewTab());
    if (preserveNova) preserveCosmosTabChanges++;
    const pending = browser.newTab();
    if (preserveNova && pending && typeof pending.catch === "function") {
      pending.catch(() => { preserveCosmosTabChanges = Math.max(0, preserveCosmosTabChanges - 1); });
    }
    return pending;
  };

  let browserView;
  const toolbar = createToolbar({
    browser,
    tabs,
    onNewTab: openNewTab,
    onBookmark: () => bookmarks.bookmarkCurrent(),
    onSuggestionsVisibilityChange: open => browserView?.setSuggestionsOpen(open),
    onNavigate: () => { cosmos.close(); history.close(); bookmarks.close(); },
    onToggleCosmos: () => { history.close(); bookmarks.close(); cosmos.toggle(); }
  });
  createTabStrip({
    browser,
    tabs,
    onActivateCurrent: () => { cosmos?.close(); history?.close(); bookmarks?.close(); }
  });
  browserView = createBrowserView({ browser, tabs });
  permissions = createPermissionsView({ browser, onVisibilityChange: open => browserView.cover("permissions", open) });
  readingList = createReadingListView({ browser, onVisibilityChange: open => browserView.cover("reading-list", open) });
  const settings = createSettingsModal({
    browser,
    aiConfig,
    onVisibilityChange: (open) => browserView.cover("settings", open)
  });
  cosmos = createCosmosView({
    browser,
    tabs,
    onVisibilityChange: (open) => {
      if (open) bookmarks?.close();
      browserView.cover("cosmos", open);
      toolbar.setCosmosOpen(open);
      browser.setOrbitVisibility(open);
      if (!open && tabs.multiView?.kind === "orbit") void browser.closeMultiView();
      if (open && aiTaskBusy && tabs.sideId) void browser.openOrbitSplit(tabs.sideId);
      if (open) queueMicrotask(() => { if (aiTaskBusy) { aiSceneStartedForTask = true; cosmos.setExploring(true); } });
    }
  });
  tabs.subscribe(() => {
    const orbitSplit = tabs.multiView?.kind === "orbit" && String(tabs.multiView.tabId) === String(tabs.activeId);
    cosmos.setSplitPane(orbitSplit);
    if (orbitSplit) {
      history?.close(); bookmarks?.close();
      if (!cosmos.isOpen()) cosmos.open();
    } else if (tabs.multiView?.kind === "tabs" && cosmos.isOpen()) {
      cosmos.close();
    }
  });

  history = createHistoryView({ browser, onVisibilityChange: (open) => {
    if (open) { cosmos.close(); bookmarks?.close(); }
    browserView.cover("history", open);
    const button = document.getElementById("history-tab");
    button.classList.toggle("active", open);
    button.setAttribute("aria-pressed", String(open));
    if (open) queueMicrotask(() => { if (aiTaskBusy) { aiSceneStartedForTask = true; history.setExploring(true); } });
  }});
  document.getElementById("history-tab").addEventListener("click", () => history.toggle());
  bookmarks = createBookmarksView({ browser, tabs,
    onVisibilityChange: open => {
      if (open) { cosmos.close(); history.close(); }
      browserView.cover("bookmarks", open);
      const button = document.getElementById("bookmarks-tab");
      button.classList.toggle("active", open); button.setAttribute("aria-pressed", String(open));
    },
    onEditorVisibilityChange: open => browserView.cover("bookmark-editor", open)
  });
  document.getElementById("bookmarks-tab").addEventListener("click", () => bookmarks.toggle());

  // Switching to an existing tab normally returns to its page. The New Tab
  // preference can preserve Nova for the activation caused by the + button;
  // closing the shown tab also leaves Nova visible for its falling star.
  let shownTabId = tabs.activeId;
  let announcedTabId = null;
  let preparedLastTabClose = false;
  const announcer = document.getElementById("browser-announcer");
  tabs.subscribe(() => {
    const active = tabs.activeTab();
    if (active && String(announcedTabId) !== String(active.id)) {
      announcedTabId = active.id;
      announcer.textContent = `Switched to tab: ${active.title || active.url || "New tab"}`;
    }
    if (tabs.activeId === shownTabId) return;
    const wasClosed = shownTabId != null && !tabs.tabs.some((tab) => String(tab.id) === String(shownTabId));
    const hasPendingNewTab = preserveCosmosTabChanges > 0;
    const preserveNova = hasPendingNewTab && cosmos.isOpen();
    const keepOrbitForReplacement = preparedLastTabClose && Boolean(active?.isStartPage);
    if (keepOrbitForReplacement) preparedLastTabClose = false;
    const orbitSplit = tabs.multiView?.kind === "orbit" && String(tabs.multiView.tabId) === String(tabs.activeId);
    if (hasPendingNewTab) preserveCosmosTabChanges--;
    shownTabId = tabs.activeId;
    if (!wasClosed && !preserveNova && !keepOrbitForReplacement && !orbitSplit) cosmos.close();
    history.close();
    bookmarks.close();
  });
  const assistant = createAssistantPanel({
    browser,
    tabs,
    aiConfig,
    onOpenSettings: settings.open,
    onVisibilityChange: (open) => browserView.setAssistantOpen(open),
    onExplorationChange: (busy) => {
      aiTaskBusy = Boolean(busy);
      const transferWasPending = Boolean(aiSceneTransferTimer);
      clearTimeout(aiSceneTransferTimer); aiSceneTransferTimer = 0;
      if (aiTaskBusy) {
        aiSceneStartedForTask = false;
        bookmarks.close();
        aiSceneTransferTimer = setTimeout(() => {
          aiSceneTransferTimer = 0;
          if (!aiTaskBusy) return;
          if (cosmos.isOpen()) { aiSceneStartedForTask = true; cosmos.setExploring(true); }
          else if (history.isOpen()) { aiSceneStartedForTask = true; history.setExploring(true); }
        }, 950);
      } else {
        const scene = cosmos.isOpen() ? cosmos : history.isOpen() ? history : null;
        const shouldPlayBriefReturn = Boolean(scene && transferWasPending && !aiSceneStartedForTask);
        aiSceneTransferTimer = 0;
        if (shouldPlayBriefReturn) {
          scene.setExploring(true);
          requestAnimationFrame(() => scene.setExploring(false));
        } else {
          cosmos.setExploring(false);
          history.setExploring(false);
        }
        aiSceneStartedForTask = false;
      }
    }
  });

  // Commands from the application menu and its shortcuts.
  const commands = {
    "new-tab": openNewTab,
    "close-tab": () => { if (tabs.activeId) browser.closeTab(tabs.activeId); },
    "focus-address": () => toolbar.focusAddress(),
    "toggle-focus": () => {
      if (document.activeElement?.id === "omnibox") browser.focusPage();
      else toolbar.focusAddress();
    },
    "go-home": () => { browser.navigate("nova://newtab"); cosmos.close(); history.close(); bookmarks.close(); },
    "reload": () => browser.reload(),
    "assistant": () => { if (!settings.isOpen()) assistant.toggle(); },
    "settings": () => settings.open(),
    "clear-data-settings": () => { settings.open(); setTimeout(() => document.getElementById("clear-browsing-data").focus(), 80); },
    "cosmos": () => { history.close(); bookmarks.close(); cosmos.toggle(); },
    "history": () => history.toggle(),
    "bookmarks": () => bookmarks.toggle(),
    "bookmark-page": () => bookmarks.bookmarkCurrent(),
    "rename-group": (groupId) => cosmos.renameGroup(groupId),
    "find": () => findBar.open(),
    "find-next": () => findBar.next(true),
    "find-previous": () => findBar.next(false),
    "downloads": () => downloads.open(),
    "permissions": () => permissions.open(),
    "reading-list": () => readingList.open(),
    "print": () => browser.printPage(),
    "save-pdf": () => browser.savePDF(),
    "save-page": () => browser.savePage(),
    "save-screenshot": () => browser.saveScreenshot(),
    "shortcut-guide": showShortcuts,
    "toast": message => showToast(String(message || ""))
  };
  browser.onCommand((command, arg) => {
    if (command === "prepare-last-tab-close") { preparedLastTabClose = true; return; }
    if (command === "cancel-last-tab-close") { preparedLastTabClose = false; return; }
    if (command === "open-cosmos") {
      preparedLastTabClose = false;
      history.close(); bookmarks.close();
      if (!cosmos.isOpen()) cosmos.open();
      return;
    }
    if (commands[command]) commands[command](arg);
  });

  document.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && ["l", "k"].includes(key)) { event.preventDefault(); toolbar.focusAddress(); }
    if (event.key === "F6") {
      event.preventDefault();
      commands["toggle-focus"]();
    }
    if (mod && !event.shiftKey && key === "d") { event.preventDefault(); bookmarks.bookmarkCurrent(); }
    if (mod && event.shiftKey && key === "b") { event.preventDefault(); bookmarks.toggle(); }
    if (mod && key === "h") { event.preventDefault(); history.toggle(); }
    if (mod && event.shiftKey && key === "o") { event.preventDefault(); history.close(); bookmarks.close(); cosmos.toggle(); }
    if (mod && key === ",") { event.preventDefault(); settings.open(); }
    if (mod && key === "f") { event.preventDefault(); findBar.open(); }
    if (mod && key === "g") { event.preventDefault(); findBar.next(!event.shiftKey); }
    if (event.key === "F3") { event.preventDefault(); findBar.next(!event.shiftKey); }
    if (mod && key === "j") { event.preventDefault(); downloads.open(); }
    if (mod && key === "t" && event.shiftKey) { event.preventDefault(); browser.reopenClosedTab(); }
    if (mod && key === "t" && !event.shiftKey) { event.preventDefault(); openNewTab(); }
    if (mod && key === "w") { event.preventDefault(); if (tabs.activeId) browser.closeTab(tabs.activeId); }
    if (mod && key === "r") { event.preventDefault(); browser.reload(event.shiftKey); }
    if (mod && key === "p") { event.preventDefault(); browser.printPage(); }
    if (mod && key === "s" && event.shiftKey) { event.preventDefault(); browser.saveScreenshot(); }
    if (mod && key === "s" && !event.shiftKey) { event.preventDefault(); browser.savePage(); }
    if (mod && key === "m" && tabs.activeTab()) { event.preventDefault(); browser.muteTab(tabs.activeId, !tabs.activeTab().muted); }
    if (event.key === "F5") { event.preventDefault(); browser.reload(event.ctrlKey && !event.metaKey); }
    if (mod && ["+", "="].includes(key)) { event.preventDefault(); browser.zoom({ delta: 1 }); }
    if (mod && ["-", "_"].includes(key)) { event.preventDefault(); browser.zoom({ delta: -1 }); }
    if (mod && key === "0") { event.preventDefault(); browser.zoom({ level: 0 }); }
    if (mod && key === "/") { event.preventDefault(); showShortcuts(); }
    if (mod && event.shiftKey && key === "delete") { event.preventDefault(); settings.open(); setTimeout(() => document.getElementById("clear-browsing-data").focus(), 80); }
    if (event.altKey && event.key === "ArrowLeft") { event.preventDefault(); browser.goBack(); }
    if (event.altKey && event.key === "ArrowRight") { event.preventDefault(); browser.goForward(); }
    if (event.altKey && event.key === "Home") { event.preventDefault(); commands["go-home"](); }
    if (event.ctrlKey && !event.metaKey && key === "Tab") {
      event.preventDefault();
      const index = tabs.tabs.findIndex(tab => String(tab.id) === String(tabs.activeId));
      const next = tabs.tabs[(index + (event.shiftKey ? -1 : 1) + tabs.tabs.length) % tabs.tabs.length];
      if (next) browser.activateTab(next.id);
    }
    if (event.ctrlKey && !event.metaKey && ["PageUp", "PageDown"].includes(event.key)) {
      event.preventDefault();
      const direction = event.key === "PageUp" ? -1 : 1;
      if (event.shiftKey) {
        const order = tabs.tabs.map(tab => String(tab.id));
        const active = order.indexOf(String(tabs.activeId));
        if (active >= 0) {
          const pinnedCount = tabs.tabs.filter(tab => tab.pinned).length;
          const activeTab = tabs.tabs[active];
          const minimum = activeTab.pinned ? 0 : pinnedCount;
          const maximum = activeTab.pinned ? Math.max(0, pinnedCount - 1) : order.length - 1;
          const target = Math.max(minimum, Math.min(maximum, active + direction));
          if (target !== active) {
            const [id] = order.splice(active, 1);
            order.splice(target, 0, id);
            browser.reorderTabs(order);
          }
        }
      }
      else {
        const index = tabs.tabs.findIndex(tab => String(tab.id) === String(tabs.activeId));
        const next = tabs.tabs[(index + direction + tabs.tabs.length) % tabs.tabs.length];
        if (next) browser.activateTab(next.id);
      }
    }
    if (mod && /^[1-9]$/.test(key)) {
      event.preventDefault();
      const index = key === "9" ? tabs.tabs.length - 1 : Number(key) - 1;
      if (tabs.tabs[index]) browser.activateTab(tabs.tabs[index].id);
    }
    if (event.key === "Escape") {
      if (findBar.isOpen()) findBar.close();
      else if (shortcutsDialog.open) shortcutsDialog.close();
      else if (permissions.isOpen()) permissions.close();
      else if (readingList.isOpen()) readingList.close();
      else if (downloads.isOpen()) downloads.close();
      else if (bookmarks.isEditorOpen()) bookmarks.closeEditor();
      else if (settings.isOpen()) settings.close();
      else if (assistant.isOpen()) assistant.close();
      else if (history.isOpen()) history.close();
      else if (bookmarks.isOpen()) bookmarks.close();
      else if (!cosmos.clearSelection()) cosmos.close();
    }
  });
  document.documentElement.dataset.novaReady = "true";
}

if (browser && browser.getTabs) start();
else document.body.textContent = "Nova must be run as the desktop app (npm start).";
