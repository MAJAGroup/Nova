import { el, escapeHTML, currentTime } from "../../lib/dom.js";
import { showToast } from "../toast.js";
import {
  handleBrowserIntent, localAssistantReply, isGroupingRequest, groupBySiteLocally, describeGroupingResult
} from "./intents.js";
import { createVoice } from "./voice.js";

const AVATAR = '<div class="message-avatar"><span class="mini-nova">✦</span></div>';

// A right-side dock for chat, with a narrow edge handle while minimized.
export function createAssistantPanel({ browser, tabs, aiConfig, onOpenSettings, onVisibilityChange, onExplorationChange = () => {} }) {
  const root = el("assistant");
  const suggestions = el("assistant-suggestions");
  const scroll = el("chat-scroll");
  const input = el("chat-input");
  const sendButton = el("chat-send");
  const status = el("ai-status");
  const voice = createVoice({ onTranscript: (text) => {
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  } });

  function showConfigStatus(config) {
    status.textContent = config.connected ? "AI configured" : "Ready to explore";
  }

  function syncSendButton() {
    sendButton.disabled = !input.value.trim();
  }

  let activeAIRequests = 0;
  function beginExploration() {
    activeAIRequests++;
    if (activeAIRequests === 1) {
      root.setAttribute("aria-busy", "true");
      try { onExplorationChange(true); }
      catch (error) { console.warn("Nova exploration animation unavailable", error); }
    }
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      activeAIRequests--;
      if (activeAIRequests === 0) {
        root.setAttribute("aria-busy", "false");
        try { onExplorationChange(false); }
        catch (error) { console.warn("Nova exploration animation unavailable", error); }
      }
    };
  }

  let lastToggle = 0;
  function open() {
    if (root.classList.contains("expanded")) return input.focus();
    root.classList.add("expanded");
    el("assistant-reopen").setAttribute("aria-expanded", "true");
    onVisibilityChange(true);
    requestAnimationFrame(() => {
      input.focus();
    });
  }

  function close({ restoreFocus = true } = {}) {
    if (!root.classList.contains("expanded")) return;
    root.classList.remove("expanded");
    el("assistant-reopen").setAttribute("aria-expanded", "false");
    onVisibilityChange(false);
    if (restoreFocus) requestAnimationFrame(() => el("assistant-reopen").focus());
  }

  // The shortcut can arrive both from the menu and the page, so ignore a
  // second toggle in quick succession.
  function toggle() {
    const now = Date.now();
    if (now - lastToggle < 200) return;
    lastToggle = now;
    if (!root.classList.contains("expanded")) open();
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
      '<div class="message-content"><div class="message-name">' + (isAssistant ? "Nova" : "YOU") +
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
    pending.setAttribute("role", "status");
    pending.setAttribute("aria-label", "Nova is thinking");
    pending.innerHTML = AVATAR + '<div class="message-content"><div class="message-name">Nova <span>thinking</span></div><div class="message-bubble"><span class="loading-dots" aria-hidden="true">•••</span></div></div>';
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
    syncSendButton();

    const aiAvailable = Boolean(aiConfig.get().url);
    const intentReply = handleBrowserIntent(trimmed, { browser, tabs, aiAvailable });
    if (intentReply) return appendMessage(intentReply, "assistant");
    if (isGroupingRequest(trimmed)) return organize(trimmed, aiAvailable);
    if (!aiAvailable) return appendMessage(localAssistantReply(trimmed, { tabs }), "assistant");

    const pending = appendPending();
    status.textContent = "Thinking…";
    const finishExploration = beginExploration();
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
    } finally {
      finishExploration();
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
    const finishExploration = beginExploration();
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
    } finally {
      finishExploration();
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
    syncSendButton();
  });
  sendButton.addEventListener("click", () => ask(input.value));
  document.querySelectorAll(".suggestion-chip").forEach((button) => {
    button.addEventListener("click", () => ask(button.dataset.prompt));
  });
  el("context-info").addEventListener("click", () => {
    showToast("When you ask Nova, it shares open tab titles and URLs with your configured AI endpoint.");
  });
  el("assistant-menu").addEventListener("click", () => { close({ restoreFocus: false }); onOpenSettings(); });
  el("assistant-reopen").addEventListener("click", open);
  el("assistant-toolbar-open").addEventListener("click", open);
  el("assistant-minimize").addEventListener("click", close);

  return { open, close, toggle, isOpen: () => root.classList.contains("expanded") };
}
