import { createTabStore } from "./lib/tab-store.js";
import { createAIConfig } from "./lib/ai-config.js";
import { createToolbar } from "./components/toolbar.js";
import { createTabStrip } from "./components/tab-strip.js";
import { createBrowserView } from "./components/browser-view.js";
import { createSettingsModal } from "./components/settings-modal.js";
import { createAssistantPanel } from "./components/assistant/assistant-panel.js";
import { createCosmosView } from "./components/cosmos/cosmos-view.js";

import { createHistoryView } from "./components/history/history-view.js";

const browser = window.orbitBrowser;

function start() {
  const tabs = createTabStore(browser);
  const aiConfig = createAIConfig(browser);
  let cosmos, history;
  let preserveCosmosTabChanges = 0;
  const openNewTab = () => {
    const preserveOrbit = Boolean(cosmos && cosmos.isOpen() && cosmos.stayOnNewTab());
    if (preserveOrbit) preserveCosmosTabChanges++;
    const pending = browser.newTab();
    if (preserveOrbit && pending && typeof pending.catch === "function") {
      pending.catch(() => { preserveCosmosTabChanges = Math.max(0, preserveCosmosTabChanges - 1); });
    }
    return pending;
  };

  const toolbar = createToolbar({
    browser,
    tabs,
    onNewTab: openNewTab,
    onNavigate: () => { cosmos.close(); history.close(); },
    onToggleCosmos: () => { history.close(); cosmos.toggle(); }
  });
  createTabStrip({
    browser,
    tabs,
    onActivateCurrent: () => { cosmos?.close(); history?.close(); }
  });
  const browserView = createBrowserView({ browser, tabs });
  const settings = createSettingsModal({
    browser,
    aiConfig,
    onVisibilityChange: (open) => browserView.cover("settings", open)
  });
  cosmos = createCosmosView({
    browser,
    tabs,
    onVisibilityChange: (open) => {
      browserView.cover("cosmos", open);
      toolbar.setCosmosOpen(open);
    }
  });

  history = createHistoryView({ browser, onVisibilityChange: (open) => {
    if (open) cosmos.close();
    browserView.cover("history", open);
    const button = document.getElementById("history-tab");
    button.classList.toggle("active", open);
    button.setAttribute("aria-pressed", String(open));
  }});
  document.getElementById("history-tab").addEventListener("click", () => history.toggle());

  // Switching to an existing tab normally returns to its page. The New Tab
  // preference can preserve Orbit for the activation caused by the + button;
  // closing the shown tab also leaves Orbit visible for its falling star.
  let shownTabId = tabs.activeId;
  tabs.subscribe(() => {
    if (tabs.activeId === shownTabId) return;
    const wasClosed = shownTabId != null && !tabs.tabs.some((tab) => String(tab.id) === String(shownTabId));
    const hasPendingNewTab = preserveCosmosTabChanges > 0;
    const preserveOrbit = hasPendingNewTab && cosmos.isOpen();
    if (hasPendingNewTab) preserveCosmosTabChanges--;
    shownTabId = tabs.activeId;
    if (!wasClosed && !preserveOrbit) cosmos.close();
    history.close();
  });
  const assistant = createAssistantPanel({
    browser,
    tabs,
    aiConfig,
    onOpenSettings: settings.open,
    onVisibilityChange: (open) => browserView.setAssistantOpen(open),
    onExplorationChange: (busy) => {
      if (busy) history.close();
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
    "cosmos": () => { history.close(); cosmos.toggle(); },
    "history": () => history.toggle(),
    "rename-group": (groupId) => cosmos.renameGroup(groupId)
  };
  browser.onCommand((command, arg) => { if (commands[command]) commands[command](arg); });

  document.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "l") { event.preventDefault(); toolbar.focusAddress(); }
    if (event.key === "Escape") {
      if (settings.isOpen()) settings.close();
      else if (assistant.isOpen()) assistant.close();
      else if (history.isOpen()) history.close();
      else if (!cosmos.clearSelection()) cosmos.close();
    }
  });
  document.documentElement.dataset.orbitReady = "true";
}

if (browser && browser.getTabs) start();
else document.body.textContent = "ORBIT must be run as the desktop app (npm start).";
