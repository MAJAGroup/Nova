import { createTabStore } from "./lib/tab-store.js";
import { createAIConfig } from "./lib/ai-config.js";
import { createToolbar } from "./components/toolbar.js";
import { createTabStrip } from "./components/tab-strip.js";
import { createBrowserView } from "./components/browser-view.js";
import { createSettingsModal } from "./components/settings-modal.js";
import { createAssistantPanel } from "./components/assistant/assistant-panel.js";

const browser = window.orbitBrowser;

function start() {
  const tabs = createTabStore(browser);
  const aiConfig = createAIConfig(browser);

  const toolbar = createToolbar({ browser, tabs });
  createTabStrip({ browser, tabs });
  const browserView = createBrowserView({ browser, tabs });
  const settings = createSettingsModal({
    browser,
    aiConfig,
    onVisibilityChange: (open) => browserView.setCovered(open)
  });
  const assistant = createAssistantPanel({ browser, tabs, aiConfig, onOpenSettings: settings.open });

  // Commands from the application menu and its shortcuts.
  const commands = {
    "new-tab": () => browser.newTab(),
    "close-tab": () => { if (tabs.activeId) browser.closeTab(tabs.activeId); },
    "focus-address": () => toolbar.focusAddress(),
    "reload": () => browser.reload(),
    "assistant": () => assistant.focus(),
    "settings": () => settings.open()
  };
  browser.onCommand((command) => { if (commands[command]) commands[command](); });

  document.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "l") { event.preventDefault(); toolbar.focusAddress(); }
    if (mod && key === "j") { event.preventDefault(); assistant.focus(); }
    if (event.key === "Escape") settings.close();
  });
}

if (browser && browser.getTabs) start();
else document.body.textContent = "ORBIT must be run as the desktop app (npm start).";
