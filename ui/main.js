import { createTabStore } from "./lib/tab-store.js";
import { createAIConfig } from "./lib/ai-config.js";
import { createToolbar } from "./components/toolbar.js";
import { createTabStrip } from "./components/tab-strip.js";
import { createBrowserView } from "./components/browser-view.js";
import { createSettingsModal } from "./components/settings-modal.js";
import { createAssistantPanel } from "./components/assistant/assistant-panel.js";
import { createCosmosView } from "./components/cosmos/cosmos-view.js";
import { createAccessibleList } from "./components/accessible-list.js";
import { createAccessibility } from "./components/accessibility.js";
import { el } from "./lib/dom.js";

const browser = window.orbitBrowser;

function start() {
  const tabs = createTabStore(browser);
  const aiConfig = createAIConfig(browser);

  const toolbar = createToolbar({
    browser,
    tabs,
    onNavigate: () => cosmos.close(),
    onToggleCosmos: () => cosmos.toggle()
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
  const accessibility = createAccessibility({ browserView, cosmos });
  const accessibleList = createAccessibleList({
    browser,
    tabs,
    onVisibilityChange: (open) => browserView.cover("accessible-list", open)
  });
  el("accessible-list-open").addEventListener("click", () => accessibleList.open());

  // Switching tabs (a star, the tab strip, the assistant, a new tab) brings
  // the page back.
  let shownTabId = tabs.activeId;
  tabs.subscribe(() => {
    if (tabs.activeId === shownTabId) return;
    shownTabId = tabs.activeId;
    cosmos.close();
  });
  const assistant = createAssistantPanel({ browser, tabs, aiConfig, onOpenSettings: settings.open });

  // Commands from the application menu and its shortcuts.
  const commands = {
    "new-tab": () => browser.newTab(),
    "close-tab": () => { if (tabs.activeId) browser.closeTab(tabs.activeId); },
    "focus-address": () => toolbar.focusAddress(),
    "reload": () => browser.reload(),
    "assistant": () => assistant.focus(),
    "settings": () => settings.open(),
    "cosmos": () => cosmos.toggle(),
    "accessible-list": () => accessibleList.open(),
    "accessibility": () => accessibility.open(),
    "focus-mode": () => accessibility.toggleFocusMode(),
    "split-vertical": () => browserView.setLayout("vertical"),
    "split-horizontal": () => browserView.setLayout("horizontal")
  };
  browser.onCommand((command) => { if (commands[command]) commands[command](); });

  document.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "l") { event.preventDefault(); toolbar.focusAddress(); }
    if (mod && key === "j") { event.preventDefault(); assistant.focus(); }
    if (mod && event.shiftKey && key === "h") { event.preventDefault(); accessibleList.open(); }
    if (mod && event.shiftKey && key === "a") { event.preventDefault(); accessibility.open(); }
    if (event.key === "Escape") {
      if (accessibleList.isOpen()) accessibleList.close();
      else if (accessibility.isOpen()) accessibility.close();
      else if (settings.isOpen()) settings.close();
      else cosmos.close();
    }
  });
}

if (browser && browser.getTabs) start();
else document.body.textContent = "ORBIT must be run as the desktop app (npm start).";
