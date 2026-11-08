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

const browser = window.novaBrowser;

function start() {
  migrateNovaPreferences();
  const tabs = createTabStore(browser);
  const aiConfig = createAIConfig(browser);
  let cosmos, history, bookmarks;
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
    }
  });

  history = createHistoryView({ browser, onVisibilityChange: (open) => {
    if (open) { cosmos.close(); bookmarks?.close(); }
    browserView.cover("history", open);
    const button = document.getElementById("history-tab");
    button.classList.toggle("active", open);
    button.setAttribute("aria-pressed", String(open));
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
  tabs.subscribe(() => {
    if (tabs.activeId === shownTabId) return;
    const wasClosed = shownTabId != null && !tabs.tabs.some((tab) => String(tab.id) === String(shownTabId));
    const hasPendingNewTab = preserveCosmosTabChanges > 0;
    const preserveNova = hasPendingNewTab && cosmos.isOpen();
    if (hasPendingNewTab) preserveCosmosTabChanges--;
    shownTabId = tabs.activeId;
    if (!wasClosed && !preserveNova) cosmos.close();
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
      if (busy) { history.close(); bookmarks.close(); }
      cosmos.setExploring(busy);
    }
  });

  // Commands from the application menu and its shortcuts.
  const commands = {
    "new-tab": openNewTab,
    "close-tab": () => { if (tabs.activeId) browser.closeTab(tabs.activeId); },
    "focus-address": () => toolbar.focusAddress(),
    "reload": () => browser.reload(),
    "assistant": () => { if (!settings.isOpen()) assistant.toggle(); },
    "settings": () => settings.open(),
    "cosmos": () => { history.close(); bookmarks.close(); cosmos.toggle(); },
    "history": () => history.toggle(),
    "bookmarks": () => bookmarks.toggle(),
    "bookmark-page": () => bookmarks.bookmarkCurrent(),
    "rename-group": (groupId) => cosmos.renameGroup(groupId)
  };
  browser.onCommand((command, arg) => { if (commands[command]) commands[command](arg); });

  document.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "l") { event.preventDefault(); toolbar.focusAddress(); }
    if (mod && !event.shiftKey && key === "d") { event.preventDefault(); bookmarks.bookmarkCurrent(); }
    if (mod && event.shiftKey && key === "b") { event.preventDefault(); bookmarks.toggle(); }
    if (event.key === "Escape") {
      if (bookmarks.isEditorOpen()) bookmarks.closeEditor();
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
