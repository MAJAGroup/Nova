import { el, escapeHTML, currentTime } from "../../lib/dom.js";
import { showToast } from "../toast.js";
import {
  handleBrowserIntent, localAssistantReply, isGroupingRequest, groupBySiteLocally, describeGroupingResult
} from "./intents.js";
import { createVoice } from "./voice.js";

const AVATAR = '<div class="message-avatar"><span class="mini-orbit">✦</span></div>';

// A right-side dock for chat, with a narrow edge handle while minimized.
export function createAssistantPanel({ browser, tabs, aiConfig, onOpenSettings, onVisibilityChange, onExplorationChange = () => {} }) {
  const root = el("assistant");
  const suggestions = el("assistant-suggestions");
  const scroll = el("chat-scroll");
  const input = el("chat-input");
  const sendButton = el("chat-send");
  const status = el("ai-status");
  const voice = createVoice({
    browser,
    onTranscript: (text) => { open(); ask(text, { spoken: true }); },
    onStateChange: (state) => {
      if (state === "recording") status.textContent = "Listening… click the mic to send";
      else if (state === "transcribing") status.textContent = "Transcribing…";
      else showConfigStatus(aiConfig.get());
    }
  });
  let pendingMessage = null;
  let finishCurrentExploration = null;
  // Orbit is opening a page: end the cosmos animation so the side tab can be
  // seen loading.
  browser.onAssistantProgress((note) => {
    if (finishCurrentExploration) finishCurrentExploration();
    const name = pendingMessage && pendingMessage.querySelector(".message-name span");
    if (name) name.textContent = String(note).slice(0, 120);
    status.textContent = String(note).slice(0, 80);
  });

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
      catch (error) { console.warn("Orbit exploration animation unavailable", error); }
    }
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      activeAIRequests--;
      if (activeAIRequests === 0) {
        root.setAttribute("aria-busy", "false");
        try { onExplorationChange(false); }
        catch (error) { console.warn("Orbit exploration animation unavailable", error); }
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

  function appendMessage(text, role, { spoken = false } = {}) {
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
    if (isAssistant) voice.speak(text, { spoken });
  }

  function appendPending() {
    suggestions.hidden = true;
    const pending = document.createElement("div");
    pending.className = "message assistant-message pending-message";
    pending.setAttribute("role", "status");
    pending.setAttribute("aria-label", "Orbit is thinking");
    pending.innerHTML = AVATAR + '<div class="message-content"><div class="message-name">ORBIT <span>thinking</span></div><div class="message-bubble"><span class="loading-dots" aria-hidden="true">•••</span></div></div>';
    scroll.appendChild(pending);
    scrollToEnd();
    pendingMessage = pending;
    return pending;
  }

  // spoken: the prompt came from the mic, so the reply is read aloud.
  async function ask(prompt, { spoken = false } = {}) {
    const trimmed = String(prompt || "").trim();
    if (!trimmed) return;
    appendMessage(trimmed, "user");
    input.value = "";
    input.style.height = "";
    syncSendButton();
    const reply = (text) => appendMessage(text, "assistant", { spoken });

    const aiAvailable = Boolean(aiConfig.get().url);
    // Spoken requests often start by addressing Orbit ("Orbit, open github").
    const command = trimmed.replace(/^(?:hey\s+)?orbit[\s,.:!-]+/i, "").replace(/[.!?]+$/, "");
    const intentReply = handleBrowserIntent(command, { browser, tabs, aiAvailable });
    if (intentReply) return reply(intentReply);
    if (isGroupingRequest(command)) return organize(command, aiAvailable, reply);
    if (!aiAvailable) return reply(localAssistantReply(trimmed, { tabs }));

    const pending = appendPending();
    status.textContent = "Thinking…";
    const finishExploration = beginExploration();
    finishCurrentExploration = finishExploration;
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
        reply("I couldn’t reach the configured AI endpoint. " + result.error);
        status.textContent = "Connection issue";
        return;
      }
      reply(result.text);
      status.textContent = "AI connected";
    } catch (error) {
      pending.remove();
      reply("I couldn’t reach the configured AI endpoint. " + ((error && error.message) || ""));
      status.textContent = "Connection issue";
    } finally {
      finishExploration();
    }
  }

  // "Group my tabs by project" and the like: the model plans the groups and
  // the main process applies them.
  async function organize(instruction, aiAvailable, reply = (text) => appendMessage(text, "assistant")) {
    if (!aiAvailable) {
      const local = groupBySiteLocally(instruction, { browser, tabs });
      return reply(local || "Connect an AI endpoint in settings and I can group your tabs however you describe. Without one, try “group my tabs by site” or “group <tabs> as <name>”.");
    }
    const pending = appendPending();
    status.textContent = "Arranging constellations…";
    const finishExploration = beginExploration();
    try {
      const result = await browser.organizeTabs({ instruction });
      pending.remove();
      if (!result.ok) {
        reply("I couldn’t group your tabs. " + result.error);
        status.textContent = "Connection issue";
        return;
      }
      reply(describeGroupingResult(result));
      status.textContent = "AI connected";
    } catch (error) {
      pending.remove();
      reply("I couldn’t group your tabs. " + ((error && error.message) || ""));
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
    showToast("When you ask Orbit, it shares open tab titles and URLs with your configured AI endpoint.");
  });
  el("assistant-menu").addEventListener("click", () => { close({ restoreFocus: false }); onOpenSettings(); });
  el("assistant-reopen").addEventListener("click", open);
  el("assistant-toolbar-open").addEventListener("click", open);
  el("assistant-minimize").addEventListener("click", close);

  return { open, close, toggle, isOpen: () => root.classList.contains("expanded") };
}
