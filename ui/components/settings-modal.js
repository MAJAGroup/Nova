import { el } from "../lib/dom.js";
import { showToast } from "./toast.js";

const PRESETS = {
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-3.8-flash",
    keyPlaceholder: "Paste your Google AI Studio API key",
    message: "Google Gemini selected. Add your AI Studio API key or set GEMINI_API_KEY."
  }
};

// The "Connect an AI model" dialog. onVisibilityChange lets the browser view
// step out of the way while it is open.
export function createSettingsModal({ browser, aiConfig, onVisibilityChange }) {
  const modal = el("settings-modal");
  const urlInput = el("api-url");
  const modelInput = el("api-model");
  const keyInput = el("api-key");
  let returnFocus = null;

  function open() {
    const config = aiConfig.get();
    returnFocus = document.activeElement;
    modal.hidden = false;
    onVisibilityChange(true);
    urlInput.value = config.url || "";
    modelInput.value = config.model || "";
    keyInput.value = "";
    const localOllama = /^http:\/\/localhost(?::\d+)?\//i.test(config.url || "");
    keyInput.placeholder = localOllama
      ? PRESETS.local.keyPlaceholder
      : (config.keyConfigured ? "Key stored securely — leave blank to keep" : "Paste the API key for this provider");
    setTimeout(() => urlInput.focus(), 50);
  }

  function close() {
    if (modal.hidden) return;
    modal.hidden = true;
    onVisibilityChange(false);
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
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

  document.querySelectorAll("[data-provider-preset]").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.providerPreset));
  });
  el("save-settings").addEventListener("click", save);
  el("clear-settings").addEventListener("click", clear);
  document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", close));
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const items = [...modal.querySelectorAll("button:not([disabled]),input:not([disabled])")];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  return { open, close, isOpen: () => !modal.hidden };
}
