import * as THREE from "three";
import { el, escapeHTML, currentTime } from "../../lib/dom.js";
import { showToast } from "../toast.js";
import { createExplorerFlight } from "../cosmos/explorer-flight.js";
import {
  handleBrowserIntent, localAssistantReply, isGroupingRequest, groupBySiteLocally, describeGroupingResult
} from "./intents.js";
import { createVoice } from "./voice.js";
import { handleVoiceBrowserCommand } from "./voice-browser-commands.js";

const AVATAR = '<div class="message-avatar"><span class="mini-nova">✦</span></div>';

// A right-side dock for chat, with a narrow edge handle while minimized.
export function createAssistantPanel({ browser, tabs, aiConfig, onOpenSettings, onFindPage = () => {}, onFindNext = () => {}, onVisibilityChange, onExplorationChange = () => {} }) {
  const root = el("assistant");
  const suggestions = el("assistant-suggestions");
  const scroll = el("chat-scroll");
  const input = el("chat-input");
  const sendButton = el("chat-send");
  const status = el("ai-status");
  const chatMenu = el("assistant-chat-menu");
  const chatMenuToggle = el("assistant-chat-menu-toggle");
  const chatList = el("assistant-chat-list");
  const flightFrame = el("assistant-flight-frame");
  const voice = createVoice({
    browser,
    onTranscript: (text) => { open(); return ask(text, { spoken: true }); },
    onStateChange: (state) => {
      const labels = {
        listening: "Say “Hey Nova…”",
        hearing: "Hearing you…",
        transcribing: "Working…",
        awaiting: "Yes? Go ahead…"
      };
      if (labels[state]) status.textContent = labels[state];
      else showConfigStatus(aiConfig.get());
    }
  });
  let pendingMessage = null;
  const CHAT_ARCHIVE_KEY = "nova.assistant.chats";
  const CHAT_ARCHIVE_LIMIT = 5;
  let archivedChats = readChatArchive();
  let activeChatId = null;
  let activeMessages = [];
  let assistantRenderer = null, assistantScene = null, assistantCamera = null, assistantFlight = null;
  let assistantFlightFrame = 0, assistantFlightTime = null, assistantFlightBusy = false;
  let assistantFlightRunning = false, assistantFlightReturnPending = false;
  // Keep the explorer attached to the active scene while Nova performs page
  // actions; progress updates describe the work but do not end the task.
  browser.onAssistantProgress((note) => {
    const name = pendingMessage && pendingMessage.querySelector(".message-name span");
    if (name) name.textContent = String(note).slice(0, 120);
    status.textContent = String(note).slice(0, 80);
    // Say what Nova is doing ("Let me pull up Google Flights") so a spoken
    // request isn't met with silence.
    voice.fill(note, { spoken: currentSpoken });
  });
  let currentSpoken = false;
  let lastVoiceReply = "";
  let voicePageText = "";
  let voicePageOffset = 0;

  async function readPageForVoice() {
    const page = await browser.readCurrentPage();
    if (!page?.ok) return "I couldn't read the current page. It may still be loading.";
    voicePageText = String(page.text || "").replace(/\s+/g, " ").trim();
    voicePageOffset = 0;
    if (!voicePageText) return `This page is titled ${page.title || "Untitled"}, but it has no readable text.`;
    const chunk = voicePageText.slice(0, 720);
    voicePageOffset = chunk.length;
    const more = voicePageOffset < voicePageText.length ? " Say “read more” to continue." : " That's the end of the readable page text.";
    return `${page.title ? `${page.title}. ` : ""}${chunk}${more}`;
  }

  function readMoreForVoice() {
    if (!voicePageText) return "There isn't a page reading in progress. Say “read this page” to start.";
    if (voicePageOffset >= voicePageText.length) return "You've reached the end of the readable page text.";
    const chunk = voicePageText.slice(voicePageOffset, voicePageOffset + 720);
    voicePageOffset += chunk.length;
    const more = voicePageOffset < voicePageText.length ? " Say “read more” to continue." : " That's the end of the readable page text.";
    return chunk + more;
  }

  async function readSelectionForVoice() {
    const selectedText = await browser.readSelection();
    const selected = String(selectedText || "").replace(/\s+/g, " ").trim();
    return selected ? `The selected text says: ${selected.slice(0, 1400)}` : "I don't see any selected text. Select text on the page, then ask me to read the selection.";
  }

  function showConfigStatus(config) {
    status.textContent = config.connected ? "AI configured" : "Ready to explore";
  }

  function readChatArchive() {
    try {
      const saved = JSON.parse(localStorage.getItem("nova.assistant.chats") || "[]");
      if (!Array.isArray(saved)) return [];
      return saved.filter(chat => chat && typeof chat.id === "string" && Array.isArray(chat.messages))
        .map(chat => ({ ...chat, title: String(chat.title || "New chat"), messages: chat.messages.filter(message => message && ["user", "assistant"].includes(message.role) && typeof message.text === "string").slice(-80) }))
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)).slice(0, CHAT_ARCHIVE_LIMIT);
    } catch { return []; }
  }

  function saveChatArchive() {
    archivedChats = archivedChats.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)).slice(0, CHAT_ARCHIVE_LIMIT);
    try { localStorage.setItem(CHAT_ARCHIVE_KEY, JSON.stringify(archivedChats)); } catch { /* keep this session usable when storage is unavailable */ }
    renderChatArchive();
  }

  function chatTitle(messages) {
    const prompt = messages.find(message => message.role === "user")?.text || "New chat";
    return prompt.length > 48 ? `${prompt.slice(0, 45).trimEnd()}…` : prompt;
  }

  function ensureActiveChat() {
    if (activeChatId) return;
    activeChatId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeMessages = [];
  }

  function storeMessage(chatId, role, text) {
    const chat = archivedChats.find(item => item.id === chatId);
    if (!chat) return;
    chat.messages.push({ role, text: String(text), at: Date.now() });
    chat.messages = chat.messages.slice(-80);
    chat.updatedAt = Date.now();
    chat.title = chatTitle(chat.messages);
    saveChatArchive();
  }

  function persistActiveMessage(role, text) {
    ensureActiveChat();
    const at = Date.now();
    activeMessages.push({ role, text: String(text), at });
    let chat = archivedChats.find(item => item.id === activeChatId);
    if (!chat) {
      chat = { id: activeChatId, title: "New chat", updatedAt: at, messages: [] };
      archivedChats.unshift(chat);
    }
    chat.messages = activeMessages.slice(-80);
    chat.updatedAt = at;
    chat.title = chatTitle(chat.messages);
    saveChatArchive();
  }

  function renderChatArchive() {
    if (!chatList) return;
    chatList.replaceChildren();
    if (!archivedChats.length) {
      const empty = document.createElement("div"); empty.className = "assistant-chat-empty"; empty.textContent = "Your recent chats will appear here."; chatList.append(empty); return;
    }
    for (const chat of archivedChats) {
      const row = document.createElement("div"); row.className = "assistant-chat-row";
      const openButton = document.createElement("button"); openButton.type = "button"; openButton.className = "assistant-chat-open";
      openButton.textContent = chat.title || "New chat"; openButton.title = chat.title || "New chat";
      openButton.setAttribute("aria-current", String(chat.id === activeChatId));
      openButton.addEventListener("click", () => openArchivedChat(chat.id));
      const deleteButton = document.createElement("button"); deleteButton.type = "button"; deleteButton.className = "assistant-chat-delete";
      deleteButton.textContent = "×"; deleteButton.setAttribute("aria-label", `Delete chat: ${chat.title || "New chat"}`);
      deleteButton.addEventListener("click", () => deleteArchivedChat(chat.id));
      row.append(openButton, deleteButton); chatList.append(row);
    }
  }

  function clearRenderedConversation() {
    scroll.querySelectorAll(".message").forEach(message => message.remove());
    pendingMessage = null;
    suggestions.hidden = false;
    input.value = ""; input.style.height = ""; syncSendButton();
  }

  function openArchivedChat(chatId) {
    const chat = archivedChats.find(item => item.id === chatId);
    if (!chat) return;
    activeChatId = chat.id;
    activeMessages = chat.messages.map(message => ({ ...message }));
    clearRenderedConversation();
    for (const message of activeMessages) {
      const time = message.at ? new Date(message.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : currentTime();
      appendMessage(message.text, message.role, { persist: false, speak: false, time });
    }
    hideChatMenu();
    renderChatArchive();
    input.focus();
  }

  function deleteArchivedChat(chatId) {
    archivedChats = archivedChats.filter(chat => chat.id !== chatId);
    if (activeChatId === chatId) resetCurrentChat(false);
    saveChatArchive();
  }

  function resetCurrentChat(removeSaved = true) {
    if (removeSaved && activeChatId) archivedChats = archivedChats.filter(chat => chat.id !== activeChatId);
    activeChatId = null; activeMessages = [];
    clearRenderedConversation();
    saveChatArchive();
    hideChatMenu();
    input.focus();
  }

  function hideChatMenu() {
    chatMenu.hidden = true;
    chatMenuToggle.setAttribute("aria-expanded", "false");
  }

  renderChatArchive();

  function syncSendButton() {
    sendButton.disabled = !input.value.trim();
  }

  function resizeAssistantFlight() {
    if (!assistantRenderer || !assistantCamera || flightFrame.hidden) return;
    const { width, height } = flightFrame.getBoundingClientRect();
    if (!width || !height) return;
    assistantRenderer.setSize(width, height);
    assistantCamera.aspect = width / height;
    assistantCamera.updateProjectionMatrix();
  }

  function ensureAssistantFlight() {
    if (assistantRenderer) return true;
    const canvas = el("assistant-flight-canvas");
    try {
      assistantRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      flightFrame.hidden = true;
      return false;
    }
    assistantRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    assistantRenderer.setClearColor(0x000000, 0);
    assistantScene = new THREE.Scene();
    assistantScene.background = null;
    assistantCamera = new THREE.PerspectiveCamera(48, 1, .1, 1000);
    assistantCamera.position.set(0, 0, 18); assistantCamera.lookAt(0, 0, 0);
    const targets = new Map([
      ["assistant-left", new THREE.Vector3(-15, -1.25, 0)],
      ["assistant-mid-left", new THREE.Vector3(-7, 1.35, 0)],
      ["assistant-mid-right", new THREE.Vector3(6, -1.35, 0)],
      ["assistant-right", new THREE.Vector3(15, .95, 0)]
    ]);
    const center = targets.get("assistant-mid-left");
    assistantFlight = createExplorerFlight(assistantScene, assistantCamera, {
      getArrivalStar: () => ({ id: "assistant-hub", position: center }),
      getOrbitTargets: () => [...targets].map(([id, position]) => ({ id, position })),
      positionOf: id => String(id) === "assistant-hub" ? center : targets.get(String(id)) || null,
      orbitRadius: 0.28,
      shipScale: 2.4,
      trailLength: 54
    });
    new ResizeObserver(resizeAssistantFlight).observe(flightFrame);
    return true;
  }

  function tickAssistantFlight(now) {
    if (!assistantRenderer || !assistantFlight) { assistantFlightFrame = 0; return; }
    assistantFlightFrame = requestAnimationFrame(tickAssistantFlight);
    const time = now / 1000;
    const delta = assistantFlightTime === null ? 0 : Math.min(.1, time - assistantFlightTime);
    assistantFlightTime = time;
    const ended = assistantFlight.update(time, delta);
    assistantRenderer.render(assistantScene, assistantCamera);
    if (ended) {
      assistantFlightRunning = false;
      assistantFlightTime = null;
      if (!assistantFlightBusy && assistantFlightReturnPending && root.classList.contains("expanded")) {
        assistantFlightReturnPending = false;
        startAssistantIdleFlight();
      } else if (assistantFlightBusy || !root.classList.contains("expanded")) {
        cancelAnimationFrame(assistantFlightFrame); assistantFlightFrame = 0;
        flightFrame.hidden = true;
      }
    }
  }

  function startAssistantIdleFlight() {
    if (assistantFlightBusy || !root.classList.contains("expanded") || !ensureAssistantFlight()) return;
    assistantFlightReturnPending = false;
    flightFrame.hidden = false;
    assistantFlight.cancel();
    resizeAssistantFlight();
    assistantFlight.start();
    assistantFlightRunning = true;
    assistantFlightTime = null;
    if (!assistantFlightFrame) assistantFlightFrame = requestAnimationFrame(tickAssistantFlight);
  }

  function setAssistantFlight(busy) {
    assistantFlightBusy = Boolean(busy);
    if (assistantFlightBusy) {
      if (!ensureAssistantFlight()) return;
      assistantFlightReturnPending = false;
      if (!assistantFlightRunning) {
        flightFrame.hidden = false;
        resizeAssistantFlight();
        assistantFlight.start();
        assistantFlightRunning = true;
        assistantFlightTime = null;
        if (!assistantFlightFrame) assistantFlightFrame = requestAnimationFrame(tickAssistantFlight);
      }
      assistantFlight.finish();
      flightFrame.hidden = false;
      return;
    }
    assistantFlightReturnPending = true;
    if (!assistantFlightRunning) {
      if (root.classList.contains("expanded")) startAssistantIdleFlight();
      else { assistantFlightReturnPending = false; flightFrame.hidden = true; }
    }
  }

  let activeAIRequests = 0;
  function beginExploration() {
    activeAIRequests++;
    if (activeAIRequests === 1) {
      root.setAttribute("aria-busy", "true");
      setAssistantFlight(true);
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
        setAssistantFlight(false);
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
      if (!assistantFlightBusy) startAssistantIdleFlight();
      input.focus();
    });
  }

  function close({ restoreFocus = true } = {}) {
    if (!root.classList.contains("expanded")) return;
    root.classList.remove("expanded");
    el("assistant-reopen").setAttribute("aria-expanded", "false");
    if (!assistantFlightBusy) {
      cancelAnimationFrame(assistantFlightFrame); assistantFlightFrame = 0; assistantFlightTime = null;
      assistantFlight?.cancel(); assistantFlightRunning = false; assistantFlightReturnPending = false;
      flightFrame.hidden = true;
    }
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

  function appendMessage(text, role, { spoken = false, persist = true, speak = true, time = currentTime() } = {}) {
    suggestions.hidden = true;
    const isAssistant = role === "assistant";
    const message = document.createElement("div");
    message.className = "message " + (isAssistant ? "assistant-message" : "user-message");
    message.innerHTML = (isAssistant ? AVATAR : "") +
      '<div class="message-content"><div class="message-name">' + (isAssistant ? "Nova" : "YOU") +
      " <span>" + escapeHTML(time) + '</span></div><div class="message-bubble">' +
      escapeHTML(text).replace(/\n/g, "<br>") + "</div></div>";
    scroll.appendChild(message);
    scrollToEnd();
    if (persist) persistActiveMessage(role, text);
    if (isAssistant && speak) voice.speak(text, { spoken });
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
    pendingMessage = pending;
    return pending;
  }

  // spoken: the prompt came from the mic, so the reply is read aloud.
  async function ask(prompt, { spoken = false } = {}) {
    const trimmed = String(prompt || "").trim();
    if (!trimmed) return;
    appendMessage(trimmed, "user");
    const responseChatId = activeChatId;
    input.value = "";
    input.style.height = "";
    syncSendButton();
    // Requests often start by addressing the assistant ("Nova, open github").
    const command = trimmed.replace(/^(?:(?:hey|hi|ok(?:ay)?)[\s,]+)?(?:nova|orbit)[\s,.:!-]+/i, "").replace(/[.!?]+$/, "");
    const reply = (text) => {
      if (spoken && typeof text === "string" && !/^(?:repeat|say) (?:that|(?:your|my) last (?:reply|answer)|that again)$|^repeat that please$/i.test(command)) lastVoiceReply = text;
      if (activeChatId === responseChatId) appendMessage(text, "assistant", { spoken });
      else storeMessage(responseChatId, "assistant", text);
    };

    const aiAvailable = Boolean(aiConfig.get().url);
    if (spoken) {
      const voiceReply = await handleVoiceBrowserCommand(command, {
        browser,
        tabs,
        onFindPage,
        onFindNext,
        readPage: readPageForVoice,
        readMore: readMoreForVoice,
        readSelection: readSelectionForVoice,
        repeatLast: () => lastVoiceReply ? `I'll repeat my last reply. ${lastVoiceReply}` : "I don't have a previous reply to repeat yet."
      });
      if (voiceReply) return reply(voiceReply);
    }
    const intentReply = await handleBrowserIntent(command, { browser, tabs, aiAvailable });
    if (intentReply) return reply(intentReply);
    if (isGroupingRequest(command)) return organize(command, aiAvailable, reply);
    if (!aiAvailable) return reply(localAssistantReply(trimmed, { tabs }));

    const pending = appendPending();
    status.textContent = "Thinking…";
    currentSpoken = spoken;
    voice.fill("", { spoken });
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
      currentSpoken = false;
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
    showToast("When you ask Nova, it shares open tab titles and URLs with your configured AI endpoint.");
  });
  el("assistant-menu").addEventListener("click", () => { close({ restoreFocus: false }); onOpenSettings(); });
  chatMenuToggle.addEventListener("click", () => {
    const openMenu = chatMenu.hidden;
    chatMenu.hidden = !openMenu;
    chatMenuToggle.setAttribute("aria-expanded", String(openMenu));
    if (openMenu) renderChatArchive();
  });
  el("assistant-new-chat").addEventListener("click", () => resetCurrentChat(false));
  el("assistant-clear-chat").addEventListener("click", () => resetCurrentChat(true));
  document.addEventListener("pointerdown", event => {
    if (!chatMenu.hidden && !chatMenu.contains(event.target) && !chatMenuToggle.contains(event.target)) hideChatMenu();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !chatMenu.hidden) { hideChatMenu(); chatMenuToggle.focus(); }
  });
  el("assistant-reopen").addEventListener("click", open);
  el("assistant-toolbar-open").addEventListener("click", open);
  el("assistant-minimize").addEventListener("click", close);

  return { open, close, toggle, isOpen: () => root.classList.contains("expanded") };
}
