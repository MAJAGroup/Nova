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

  const toolbar = createToolbar({
    browser,
    tabs,
    onNavigate: () => { cosmos.close(); history.close(); },
    onToggleCosmos: () => { history.close(); cosmos.toggle(); }
  });
  createTabStrip({ browser, tabs });
  const browserView = createBrowserView({ browser, tabs });
  const settings = createSettingsModal({
    browser,
    aiConfig,
    onVisibilityChange: (open) => browserView.cover("settings", open)
  });
  const cosmos = createCosmosView({
    browser,
    tabs,
    onVisibilityChange: (open) => {
      browserView.cover("cosmos", open);
      toolbar.setCosmosOpen(open);
    }
  });

  const history = createHistoryView({
    browser,
    onVisibilityChange: (open) => {
      if (open) cosmos.close();
      browserView.cover("history", open);
      document.getElementById("history-toggle").setAttribute("aria-pressed", String(open));
    }
  });
  document.getElementById("history-toggle").onclick = () => history.toggle();

  // Switching tabs (a star, the tab strip, the assistant, a new tab) brings
  // the page back.
  let shownTabId = tabs.activeId;
  tabs.subscribe(() => {
    if (tabs.activeId === shownTabId) return;
    shownTabId = tabs.activeId;
    cosmos.close();
    history.close();
  });
  const assistant = createAssistantPanel({
    browser,
    tabs,
    aiConfig,
    onOpenSettings: settings.open,
    onVisibilityChange: (open) => browserView.cover("assistant", open)
  });
  // Like Spotlight, the popup steps away once it has taken you to a tab.
  let assistantTabId = tabs.activeId;
  tabs.subscribe(() => {
    if (tabs.activeId === assistantTabId) return;
    assistantTabId = tabs.activeId;
    assistant.close();
  });

  // Commands from the application menu and its shortcuts.
  const commands = {
    "new-tab": () => browser.newTab(),
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
}

if (browser && browser.getTabs) start();
else document.body.textContent = "ORBIT must be run as the desktop app (npm start).";
