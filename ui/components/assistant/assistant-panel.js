import { el, escapeHTML, currentTime } from "../../lib/dom.js";
import { showToast } from "../toast.js";
import {
  handleBrowserIntent, localAssistantReply, isGroupingRequest, groupBySiteLocally, describeGroupingResult
} from "./intents.js";
import { createVoice } from "./voice.js";

const AVATAR = '<div class="message-avatar"><span class="mini-orbit">✦</span></div>';

// The Ctrl+Space assistant: a Spotlight-style popup with the chat, composer
// and AI status. The live page is a native view drawn above this document, so
// while the popup is open the page is hidden (onVisibilityChange) and a still
// snapshot of it sits blurred behind the popup instead.
export function createAssistantPanel({ browser, tabs, aiConfig, onOpenSettings, onVisibilityChange }) {
  const root = el("assistant");
  const snapshot = el("assistant-snapshot");
  const suggestions = el("assistant-suggestions");
  const scroll = el("chat-scroll");
  const input = el("chat-input");
  const status = el("ai-status");
  const voice = createVoice({ onTranscript: (text) => ask(text) });

  function showConfigStatus(config) {
    status.textContent = config.connected ? "AI configured" : "Ready to explore";
  }

  let lastToggle = 0;
  let opening = 0;

  async function open() {
    if (!root.hidden) return input.focus();
    const attempt = ++opening;
    let image = null;
    try { image = browser.capturePage ? await browser.capturePage() : null; } catch (_) {}
    if (attempt !== opening) return;
    snapshot.hidden = !image;
    if (image) {
      const rect = el("browser-content").getBoundingClientRect();
      Object.assign(snapshot.style, {
        left: rect.left + "px", top: rect.top + "px", width: rect.width + "px", height: rect.height + "px"
      });
      snapshot.src = image;
    }
    root.hidden = false;
    onVisibilityChange(true);
    requestAnimationFrame(() => {
      root.classList.add("visible");
      input.focus();
      input.select();
    });
  }

  function close() {
    opening++;
    if (root.hidden) return;
    root.classList.remove("visible");
    root.hidden = true;
    snapshot.removeAttribute("src");
    onVisibilityChange(false);
  }

  // The shortcut can arrive both from the menu and the page, so ignore a
  // second toggle in quick succession.
  function toggle() {
    const now = Date.now();
    if (now - lastToggle < 200) return;
    lastToggle = now;
    if (root.hidden) open();
    else close();
  }

  function scrollToEnd() {
    scroll.scrollTop = scroll.scrollHeight;
  }

  function appendMessage(text, role) {
    suggestions.hidden = true;
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
    suggestions.hidden = true;
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

    const aiAvailable = Boolean(aiConfig.get().url);
    const intentReply = handleBrowserIntent(trimmed, { browser, tabs, aiAvailable });
    if (intentReply) return appendMessage(intentReply, "assistant");
    if (isGroupingRequest(trimmed)) return organize(trimmed, aiAvailable);
    if (!aiAvailable) return appendMessage(localAssistantReply(trimmed, { tabs }), "assistant");

    const pending = appendPending();
    status.textContent = "Thinking…";
    try {
      const result = await browser.askAssistant({
        prompt: trimmed,
        context: tabs.tabs.map((tab) => {
          const group = tabs.groupOf(tab);
          return { title: tab.title || "Untitled tab", url: tab.url, ...(group ? { group: group.name } : {}) };
        })
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

  // "Group my tabs by project" and the like: the model plans the groups and
  // the main process applies them.
  async function organize(instruction, aiAvailable) {
    if (!aiAvailable) {
      const local = groupBySiteLocally(instruction, { browser, tabs });
      return appendMessage(local || "Connect an AI endpoint in settings and I can group your tabs however you describe. Without one, try “group my tabs by site” or “group <tabs> as <name>”.", "assistant");
    }
    const pending = appendPending();
    status.textContent = "Arranging constellations…";
    try {
      const result = await browser.organizeTabs({ instruction });
      pending.remove();
      if (!result.ok) {
        appendMessage("I couldn’t group your tabs. " + result.error, "assistant");
        status.textContent = "Connection issue";
        return;
      }
      appendMessage(describeGroupingResult(result), "assistant");
      status.textContent = "AI connected";
    } catch (error) {
      pending.remove();
      appendMessage("I couldn’t group your tabs. " + ((error && error.message) || ""), "assistant");
      status.textContent = "Connection issue";
    }
  }

  tabs.subscribe(() => {
    const count = tabs.tabs.length;
    el("context-count").textContent = count + (count === 1 ? " tab" : " tabs");
  });
  aiConfig.subscribe(showConfigStatus);

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      ask(input.value);
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });
  document.querySelectorAll(".suggestion-chip").forEach((button) => {
    button.addEventListener("click", () => ask(button.dataset.prompt));
  });
  el("context-info").addEventListener("click", () => {
    showToast("When you ask Orbit, it shares open tab titles and URLs with your configured AI endpoint.");
  });
  el("assistant-menu").addEventListener("click", () => { close(); onOpenSettings(); });
  root.addEventListener("mousedown", (event) => { if (event.target === root || event.target === snapshot) close(); });

  return { open, close, toggle, isOpen: () => !root.hidden };
}
