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

// The "Connect an AI model" dialog. onVisibilityChange lets the browser view
// step out of the way while it is open.
export function createSettingsModal({ browser, aiConfig, onVisibilityChange }) {
  const modal = el("settings-modal");
  const urlInput = el("api-url");
  const modelInput = el("api-model");
  const keyInput = el("api-key");

  function open() {
    const config = aiConfig.get();
    modal.hidden = false;
    onVisibilityChange(true);
    urlInput.value = config.url || "";
    modelInput.value = config.model || "";
    keyInput.value = "";
    const localOllama = /^http:\/\/localhost:11434\//i.test(config.url || "");
    keyInput.placeholder = localOllama
      ? PRESETS.local.keyPlaceholder
      : (config.keyConfigured ? "Key stored securely — leave blank to keep" : "Paste the API key for this provider");
    setTimeout(() => urlInput.focus(), 50);
  }

  function close() {
    if (modal.hidden) return;
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
    if (url && !/^https:\/\//i.test(url) && !/^http:\/\/localhost(?::\d+)?(?:\/|$)/i.test(url)) {
      return showToast("Enter an HTTPS URL (or a localhost URL for development).");
    }
    const previous = aiConfig.get();
    let sameProvider = false;
    try { sameProvider = new URL(previous.url).origin === new URL(url).origin; } catch (_) {}
    if (/^https:\/\/ollama\.com\//i.test(url) && !apiKey && !(previous.keyConfigured && sameProvider)) {
      return showToast("Add your Ollama API key before saving this cloud endpoint.");
    }
    try {
      const result = await browser.saveAIConfig({ url, model, apiKey });
      if (!result.ok) return showToast(result.error);
      aiConfig.set({ url, model, keyConfigured: result.keyConfigured, connected: result.connected });
      close();
      showToast("AI connection saved.");
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

  document.querySelectorAll("[data-ollama-preset]").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.ollamaPreset));
  });
  el("save-settings").addEventListener("click", save);
  el("clear-settings").addEventListener("click", clear);
  document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", close));
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });

  return { open, close };
}
