import { el, escapeHTML, currentTime } from "../../lib/dom.js";
import { showToast } from "../toast.js";
import { handleBrowserIntent, localAssistantReply } from "./intents.js";
import { createVoice } from "./voice.js";

const AVATAR = '<div class="message-avatar"><span class="mini-orbit">✦</span></div>';

// The right-hand assistant: chat history, composer and AI status.
export function createAssistantPanel({ browser, tabs, aiConfig, onOpenSettings }) {
  const scroll = el("chat-scroll");
  const input = el("chat-input");
  const status = el("ai-status");
  const voice = createVoice({ onTranscript: (text) => ask(text) });

  function showConfigStatus(config) {
    status.textContent = config.connected ? "AI configured" : "Ready to explore";
  }

  function scrollToEnd() {
    scroll.scrollTop = scroll.scrollHeight;
  }

  function appendMessage(text, role) {
    const isAssistant = role === "assistant";
    const message = document.createElement("div");
    message.className = "message " + (isAssistant ? "assistant-message" : "user-message");
    message.innerHTML = (isAssistant ? AVATAR : "") +
      '<div class="message-content"><div class="message-name">' + (isAssistant ? "ORBIT" : "YOU") +
      " <span>" + currentTime() + '</span></div><div class="message-bubble">' +
      escapeHTML(text).replace(/\n/g, "<br>") + "</div></div>";
    scroll.appendChild(message);
    scrollToEnd();
    if (isAssistant) voice.speak(text);
  }

  function appendPending() {
    const pending = document.createElement("div");
    pending.className = "message assistant-message pending-message";
    pending.innerHTML = AVATAR + '<div class="message-content"><div class="message-name">ORBIT <span>thinking</span></div><div class="message-bubble"><span class="loading-dots">•••</span></div></div>';
    scroll.appendChild(pending);
    scrollToEnd();
    return pending;
  }

  async function ask(prompt) {
    const trimmed = String(prompt || "").trim();
    if (!trimmed) return;
    appendMessage(trimmed, "user");
    input.value = "";
    input.style.height = "";

    const intentReply = handleBrowserIntent(trimmed, { browser, tabs });
    if (intentReply) return appendMessage(intentReply, "assistant");
    if (!aiConfig.get().url) return appendMessage(localAssistantReply(trimmed, { tabs }), "assistant");

    const pending = appendPending();
    status.textContent = "Thinking…";
    try {
      const result = await browser.askAssistant({
        prompt: trimmed,
        context: tabs.tabs.map((tab) => ({ title: tab.title || "Untitled tab", url: tab.url }))
      });
      pending.remove();
      if (!result.ok) {
        appendMessage("I couldn’t reach the configured AI endpoint. " + result.error, "assistant");
        status.textContent = "Connection issue";
        return;
      }
      appendMessage(result.text, "assistant");
      status.textContent = "AI connected";
    } catch (error) {
      pending.remove();
      appendMessage("I couldn’t reach the configured AI endpoint. " + ((error && error.message) || ""), "assistant");
      status.textContent = "Connection issue";
    }
  }

  el("greeting-time").textContent = currentTime();
  tabs.subscribe(() => {
    const count = tabs.tabs.length;
    el("context-count").textContent = count + (count === 1 ? " tab" : " tabs");
  });
  aiConfig.subscribe(showConfigStatus);

  el("send-message").addEventListener("click", () => ask(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      ask(input.value);
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 95) + "px";
  });
  document.querySelectorAll(".suggestion-chip").forEach((button) => {
    button.addEventListener("click", () => ask(button.dataset.prompt));
  });
  el("context-info").addEventListener("click", () => {
    showToast("When you ask Orbit, it shares open tab titles and URLs with your configured AI endpoint.");
  });
  el("assistant-menu").addEventListener("click", onOpenSettings);

  return {
    focus() { input.focus(); }
  };
}
