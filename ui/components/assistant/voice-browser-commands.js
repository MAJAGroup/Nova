const HELP_TEXT = "You can go back or forward; refresh or stop a page; scroll up or down, by a screen, or to the top or bottom; search this page and move through matches; close page search; zoom in, out, or reset; read a page in short parts, continue reading, or read selected text; repeat my last reply; open a named link; open or close a tab; switch tabs; mute or unmute a tab; or ask for voice help.";

function clean(value) {
  return String(value || "").trim().replace(/[.!?]+$/, "").replace(/\s+/g, " ").toLowerCase();
}

function success(ok, message, failure) {
  return ok === false ? failure : message;
}

export async function handleVoiceBrowserCommand(input, {
  browser,
  tabs,
  onFindPage = () => {},
  onFindNext = () => {},
  readPage = async () => "I can't read the current page right now.",
  readMore = () => "There isn't a page reading in progress. Say “read this page” to start.",
  readSelection = async () => "I can't read the selected text right now.",
  repeatLast = () => "I don't have a previous reply to repeat."
} = {}) {
  const text = clean(input);
  if (!text) return null;

  if (/^(?:voice )?help$|^what (?:can|commands) (?:i|you) say$|^what voice commands (?:are there|can i use)$|^what can you do$/.test(text)) return HELP_TEXT;

  if (/^(?:go )?back(?: a page)?$|^previous page$/.test(text)) {
    await browser.goBack(); return "Going back one page.";
  }
  if (/^(?:go )?forward(?: a page)?$|^next page$/.test(text)) {
    await browser.goForward(); return "Going forward one page.";
  }
  if (/^(?:reload|refresh)(?: this| the)? page$|^(?:reload|refresh)$/.test(text)) {
    await browser.reload(); return "Refreshing this page.";
  }
  if (/^(?:stop|cancel) (?:loading|the page)$/.test(text)) {
    await browser.stop(); return "Stopped the page from loading.";
  }

  const scrollMatch = /^(?:scroll )?(up|down)(?: a little| slightly)?$/.exec(text);
  if (scrollMatch) {
    await browser.scrollPage(scrollMatch[1]);
    return scrollMatch[1] === "up" ? "Scrolling up." : "Scrolling down.";
  }
  if (/^(?:page )?up$|^scroll up one page$/.test(text)) {
    await browser.scrollPage("page-up"); return "Moving up one screen.";
  }
  if (/^(?:page )?down$|^scroll down one page$/.test(text)) {
    await browser.scrollPage("page-down"); return "Moving down one screen.";
  }
  if (/^(?:(?:go|scroll) to )?(?:the )?top(?: of (?:the )?page)?$/.test(text)) {
    await browser.scrollPage("top"); return "Moving to the top of the page.";
  }
  if (/^(?:(?:go|scroll) to )?(?:the )?bottom(?: of (?:the )?page)?$/.test(text)) {
    await browser.scrollPage("bottom"); return "Moving to the bottom of the page.";
  }

  const findMatch = /^(?:find|search for|look for) (.+?) (?:on|in) (?:this|the current|the) page$/.exec(text)
    || /^search (?:this|the) page for (.+)$/.exec(text);
  if (findMatch) {
    const query = findMatch[1].trim();
    if (!query) return "Tell me what words to find on this page.";
    onFindPage(query);
    return `Searching this page for ${query}.`;
  }
  if (/^(?:find )?next (?:match|result)$|^next match$/.test(text)) {
    onFindNext(true); return "Showing the next match.";
  }
  if (/^(?:find )?(?:previous|prior) (?:match|result)$|^previous match$/.test(text)) {
    onFindNext(false); return "Showing the previous match.";
  }
  if (/^(?:close|clear|hide) (?:the )?(?:find|search)(?: bar)?$|^close page search$/.test(text)) {
    onFindPage(null); return "Closed page search.";
  }

  if (/^(?:zoom in|make (?:the )?page bigger|increase (?:the )?zoom)$/.test(text)) {
    await browser.zoom({ delta: 1 }); return "Making the page bigger.";
  }
  if (/^(?:zoom out|make (?:the )?page smaller|decrease (?:the )?zoom)$/.test(text)) {
    await browser.zoom({ delta: -1 }); return "Making the page smaller.";
  }
  if (/^(?:reset|default) (?:the )?(?:page )?zoom$|^reset page size$/.test(text)) {
    await browser.zoom({ level: 0 }); return "Reset the page to its default size.";
  }

  if (/^(?:read|read aloud|start reading)(?: this| current| the current| the)? page(?: aloud)?$/.test(text)) return readPage();
  if (/^(?:read )?(?:more|the next part)$|^continue reading$/.test(text)) return readMore();
  if (/^(?:read|say) (?:the )?(?:selected text|selection)$/.test(text)) return readSelection();
  if (/^(?:repeat|say) (?:that|(?:your|my) last (?:reply|answer)|that again)$|^repeat that please$/.test(text)) return repeatLast();

  const linkMatch = /^(?:click|open|follow) (?:on )?(?:the )?link(?: called| named| that says)? (.+)$/.exec(text)
    || /^click (?:on )?(?:the )?(.+?) link$/.exec(text);
  if (linkMatch) {
    const label = linkMatch[1].trim();
    if (!label) return "Say the words shown on the link you want to open.";
    const result = await browser.activateLinkByText(label);
    if (result?.ok) return `Opening ${result.label || label}.`;
    if (result?.reason === "ambiguous") return `I found several links with similar names: ${(result.options || []).slice(0, 4).join(", ")}. Please say a more specific link name.`;
    return `I couldn't find a link named ${label}.`;
  }

  if (/^(?:open|create|new) (?:a )?new tab$/.test(text)) {
    await browser.newTab(); return "Opened a new tab.";
  }
  if (/^(?:close|shut) (?:this|the current|current) tab$|^close tab$/.test(text)) {
    const id = tabs?.activeId;
    if (id == null) return "There isn't an active tab to close.";
    await browser.closeTab(id); return "Closed the current tab.";
  }
  if (/^(?:switch to the )?next tab$|^go to next tab$/.test(text)) {
    const list = tabs?.tabs || [];
    if (list.length < 2) return "There is only one tab open.";
    const index = list.findIndex(tab => String(tab.id) === String(tabs.activeId));
    const next = list[(index + 1 + list.length) % list.length];
    await browser.activateTab(next.id); return `Switched to ${next.title || "the next tab"}.`;
  }
  if (/^(?:switch to the )?previous tab$|^go to previous tab$/.test(text)) {
    const list = tabs?.tabs || [];
    if (list.length < 2) return "There is only one tab open.";
    const index = list.findIndex(tab => String(tab.id) === String(tabs.activeId));
    const previous = list[(index - 1 + list.length) % list.length];
    await browser.activateTab(previous.id); return `Switched to ${previous.title || "the previous tab"}.`;
  }

  if (/^(?:mute|silence) (?:this|the current|current) tab$|^mute tab$/.test(text)) {
    const tab = tabs?.activeTab();
    if (!tab) return "There isn't an active tab to mute.";
    const ok = await browser.muteTab(tab.id, true);
    return success(ok, "Muted the current tab.", "I couldn't mute the current tab.");
  }
  if (/^(?:unmute|turn on sound for) (?:this|the current|current) tab$|^unmute tab$/.test(text)) {
    const tab = tabs?.activeTab();
    if (!tab) return "There isn't an active tab to unmute.";
    const ok = await browser.muteTab(tab.id, false);
    return success(ok, "Turned sound on for the current tab.", "I couldn't unmute the current tab.");
  }
  return null;
}
