import { el } from "../lib/dom.js";
import { showToast } from "./toast.js";

const PRESETS = {
  local: {
    url: "http://localhost:11434/v1/chat/completions",
    model: "kimi-k3.1-pro:cloud",
    keyPlaceholder: "Not required for local Ollama",
    message: "Local Ollama selected. Sign in to Ollama to use its cloud model."
  },
  cloud: {
    url: "https://ollama.com/v1/chat/completions",
    model: "kimi-k3.1-pro",
    keyPlaceholder: "Paste your Ollama API key",
    message: "Ollama Cloud selected. Add your API key before saving."
  }
};

function isPlainHTTP(url) {
  return /^http:\/\//i.test(url || "");
}

function isLoopback(url) {
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname); } catch (_) { return false; }
}

// The "Connect an AI model" dialog. onVisibilityChange lets the browser view
// step out of the way while it is open.
export function createSettingsModal({ browser, aiConfig, onVisibilityChange }) {
  const modal = el("settings-modal");
  const urlInput = el("api-url");
  const modelInput = el("api-model");
  const keyInput = el("api-key");
  const voiceKeyInput = el("elevenlabs-key");
  const voiceIdInput = el("elevenlabs-voice");
  const voiceKeyState = el("elevenlabs-key-state");
  const wakeKeyInput = el("picovoice-key");
  const wakeKeyState = el("picovoice-key-state");
  let voiceConfig = {};

  async function loadVoiceConfig() {
    try { voiceConfig = await browser.getVoiceConfig(); } catch (_) { voiceConfig = {}; }
    voiceIdInput.value = voiceConfig.voiceId || "";
    voiceKeyInput.value = "";
    voiceKeyInput.placeholder = voiceConfig.fromEnvironment
      ? "Using ELEVENLABS_API_KEY from the environment"
      : (voiceConfig.keyConfigured ? "Key stored securely — leave blank to keep" : "Paste your ElevenLabs API key");
    voiceKeyState.textContent = voiceConfig.keyConfigured ? "connected" : "stored securely in the desktop app";
    wakeKeyInput.value = "";
    wakeKeyInput.placeholder = voiceConfig.wakeKeyFromEnvironment
      ? "Using PICOVOICE_ACCESS_KEY from the environment"
      : (voiceConfig.wakeKeyConfigured ? "Key stored securely — leave blank to keep" : "Paste your Picovoice AccessKey");
    wakeKeyState.textContent = voiceConfig.wakeKeyConfigured
      ? "connected · “Hey Nova” is detected on this computer"
      : "optional · detects “Hey Nova” on this computer";
  }

  const clearCookies = el("clear-cookies");
  const clearCache = el("clear-cache");
  const dataConfirmation = el("browsing-data-confirm");
  const dataConfirmationText = el("browsing-data-confirm-text");
  const confirmClearData = el("confirm-clear-browsing-data");
  const restoreSession = el("restore-previous-session");
  const clearDataOnExit = el("clear-data-on-exit");
  const enhancedContrast = el("enhanced-contrast");
  const searchProvider = el("search-provider");

  function hideDataConfirmation() {
    dataConfirmation.hidden = true;
    clearCookies.disabled = false;
    clearCache.disabled = false;
  }

  function open() {
    const config = aiConfig.get();
    modal.hidden = false;
    hideDataConfirmation();
    onVisibilityChange(true);
    urlInput.value = config.url || "";
    modelInput.value = config.model || "";
    keyInput.value = "";
    keyInput.placeholder = config.keyConfigured
      ? "Key stored securely — leave blank to keep"
      : (isPlainHTTP(config.url) ? "Optional for http:// endpoints" : "Paste the API key for this provider");
    loadVoiceConfig();
    browser.getBrowserPreferences().then(preferences => {
      restoreSession.checked = preferences.restorePreviousSession !== false;
      clearDataOnExit.checked = preferences.clearDataOnExit === true;
      searchProvider.value = preferences.searchProvider || "google";
    }).catch(() => {});
    try { enhancedContrast.checked = localStorage.getItem("nova.enhancedContrast") === "1"; } catch { enhancedContrast.checked = false; }
    setTimeout(() => urlInput.focus(), 50);
  }

  function close() {
    if (modal.hidden) return;
    hideDataConfirmation();
    modal.hidden = true;
    onVisibilityChange(false);
  }

  function applyPreset(name) {
    const preset = PRESETS[name];
    urlInput.value = preset.url;
    modelInput.value = preset.model;
    keyInput.value = "";
    keyInput.placeholder = preset.keyPlaceholder;
    showToast(preset.message);
  }

  async function save() {
    const url = urlInput.value.trim();
    const model = modelInput.value.trim();
    const apiKey = keyInput.value.trim();
    if (url && !/^https?:\/\/[^\s/]+/i.test(url)) {
      return showToast("Enter an http:// or https:// URL.");
    }
    const previous = aiConfig.get();
    let sameProvider = false;
    try { sameProvider = new URL(previous.url).origin === new URL(url).origin; } catch (_) {}
    if (/^https:\/\/ollama\.com\//i.test(url) && !apiKey && !(previous.keyConfigured && sameProvider)) {
      return showToast("Add your Ollama API key before saving this cloud endpoint.");
    }
    try {
      const voiceKey = voiceKeyInput.value.trim();
      const wakeKey = wakeKeyInput.value.trim();
      const voiceId = voiceIdInput.value.trim();
      if (voiceKey || wakeKey || voiceId !== (voiceConfig.voiceId || "")) {
        const voiceResult = await browser.saveVoiceConfig({ apiKey: voiceKey, wakeKey, voiceId });
        if (!voiceResult.ok) return showToast(voiceResult.error);
        voiceConfig = { ...voiceConfig, voiceId, keyConfigured: voiceResult.keyConfigured, wakeKeyConfigured: voiceResult.wakeKeyConfigured };
        voiceKeyInput.value = "";
        wakeKeyInput.value = "";
        if (wakeKey) document.dispatchEvent(new CustomEvent("nova:wake-word-changed"));
      }
      const result = await browser.saveAIConfig({ url, model, apiKey });
      if (!result.ok) return showToast(result.error);
      aiConfig.set({ url, model, keyConfigured: result.keyConfigured, connected: result.connected });
      close();
      showToast(isPlainHTTP(url) && !isLoopback(url)
        ? "Saved. This endpoint isn’t encrypted: prompts, tab titles and page text travel in plain text."
        : "Settings saved.");
    } catch (_) {
      showToast("Could not save the AI settings.");
    }
  }

  async function clear() {
    await browser.clearAIConfig();
    aiConfig.set({});
    urlInput.value = "";
    modelInput.value = "";
    keyInput.value = "";
    close();
    showToast("AI connection cleared.");
  }

  function requestClearBrowsingData() {
    const choices = { cookies: clearCookies.checked, cache: clearCache.checked };
    if (!choices.cookies && !choices.cache) return showToast("Choose cookies/site data, cached files, or both.");
    const selected = [
      ...(choices.cookies ? ["cookies and other site data"] : []),
      ...(choices.cache ? ["cached images and files"] : [])
    ];
    dataConfirmationText.textContent = `Clear ${selected.join(" and ")} for all websites and all time?${choices.cookies ? " This may sign you out of websites and remove their saved preferences." : ""}`;
    confirmClearData.dataset.cookies = String(choices.cookies);
    confirmClearData.dataset.cache = String(choices.cache);
    clearCookies.disabled = true;
    clearCache.disabled = true;
    dataConfirmation.hidden = false;
    confirmClearData.focus();
  }

  async function clearBrowsingData() {
    const choices = {
      cookies: confirmClearData.dataset.cookies === "true",
      cache: confirmClearData.dataset.cache === "true"
    };
    confirmClearData.disabled = true;
    try {
      const result = await browser.clearBrowsingData(choices);
      if (!result?.ok) return showToast(result?.error || "Could not clear browsing data.");
      hideDataConfirmation();
      const cleared = [
        ...(choices.cookies ? ["cookies and site data"] : []),
        ...(choices.cache ? ["cached files"] : [])
      ];
      showToast(`Cleared ${cleared.join(" and ")}. Browsing history remains saved.`);
    } catch (_) {
      showToast("Could not clear browsing data.");
    } finally {
      confirmClearData.disabled = false;
    }
  }

  document.querySelectorAll("[data-ollama-preset]").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.ollamaPreset));
  });
  el("save-settings").addEventListener("click", save);
  el("clear-settings").addEventListener("click", clear);
  el("clear-browsing-data").addEventListener("click", requestClearBrowsingData);
  el("cancel-clear-browsing-data").addEventListener("click", () => {
    hideDataConfirmation();
    el("clear-browsing-data").focus();
  });
  confirmClearData.addEventListener("click", clearBrowsingData);
  restoreSession.addEventListener("change", async () => {
    restoreSession.disabled = true;
    try {
      const result = await browser.saveBrowserPreferences({ restorePreviousSession: restoreSession.checked });
      if (!result?.ok) throw Error(result?.error || "Could not save this preference.");
      showToast(restoreSession.checked ? "Nova will restore your last session." : "Nova will start with a new tab next time.");
    } catch (error) { restoreSession.checked = !restoreSession.checked; showToast(error.message); }
    finally { restoreSession.disabled = false; }
  });
  clearDataOnExit.addEventListener("change", async () => {
    clearDataOnExit.disabled = true;
    try {
      const result = await browser.saveBrowserPreferences({ clearDataOnExit: clearDataOnExit.checked });
      if (!result?.ok) throw Error(result?.error || "Could not save this preference.");
      showToast(clearDataOnExit.checked ? "Nova will clear cookies and cache when it quits." : "Nova will keep website data when it quits.");
    } catch (error) { clearDataOnExit.checked = !clearDataOnExit.checked; showToast(error.message); }
    finally { clearDataOnExit.disabled = false; }
  });
  enhancedContrast.addEventListener("change", () => {
    const enabled = enhancedContrast.checked;
    document.documentElement.dataset.enhancedContrast = String(enabled);
    try { localStorage.setItem("nova.enhancedContrast", enabled ? "1" : "0"); } catch { /* Preference is optional in restricted sessions. */ }
    showToast(enabled ? "Enhanced contrast enabled." : "Enhanced contrast disabled.");
  });
  searchProvider.addEventListener("change", async () => {
    searchProvider.disabled = true;
    try {
      const result = await browser.saveBrowserPreferences({ searchProvider: searchProvider.value });
      if (!result?.ok) throw Error(result?.error || "Could not save this preference.");
      showToast(`Search provider set to ${searchProvider.options[searchProvider.selectedIndex].text}.`);
    } catch (error) { showToast(error.message); }
    finally { searchProvider.disabled = false; }
  });
  document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", close));
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });

  return { open, close, isOpen: () => !modal.hidden };
}
