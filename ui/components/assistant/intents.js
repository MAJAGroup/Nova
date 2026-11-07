import { domainOf, normalizeAddress, searchUrl } from "../../lib/url.js";

// Plain-language browser commands the assistant handles itself, without a
// model. Returns the reply text, or "" when the prompt isn't a command.
export function handleBrowserIntent(prompt, { browser, tabs }) {
  const text = prompt.trim();
  const lower = text.toLowerCase();
  let match;

  if (/^(go back|back)$/.test(lower)) {
    browser.goBack();
    return "Going back in the current tab.";
  }
  if (/^(go forward|forward)$/.test(lower)) {
    browser.goForward();
    return "Going forward in the current tab.";
  }
  if (/^(reload|refresh)( this page| the page)?$/.test(lower)) {
    browser.reload();
    return "Reloading the current page.";
  }

  match = text.match(/^(?:search(?: the web)?(?: for)?|google)\s+(.+)$/i);
  if (match) {
    browser.newTab(searchUrl(match[1]));
    return "Searching the web for “" + match[1] + "”.";
  }

  match = text.match(/^(?:switch to|show me) (?:the )?tab (?:called |named )?(.+)$/i) ||
    text.match(/^(?:switch to|show me) (?:the )?(.+) tab$/i);
  if (match) {
    const target = tabs.findTab(match[1]);
    if (!target) return "I couldn’t find a tab matching “" + match[1] + "”.";
    browser.activateTab(target.id);
    return "Switching to “" + (target.title || domainOf(target.url)) + "”.";
  }

  match = text.match(/^(?:open|visit|go to)\s+(.+)$/i);
  if (match) {
    browser.newTab(normalizeAddress(match[1]));
    return "Opening " + match[1] + ".";
  }

  match = text.match(/^close (?:the )?tab\s+(?:called\s+|named\s+)?(.+)$/i);
  if (match) {
    const target = tabs.findTab(match[1]);
    if (!target) return "I couldn’t find a tab matching “" + match[1] + "”.";
    browser.closeTab(target.id);
    return "Closed “" + (target.title || domainOf(target.url)) + "”.";
  }

  return "";
}

// Canned replies used when no AI endpoint is connected.
export function localAssistantReply(prompt, { tabs }) {
  const text = prompt.toLowerCase();
  const open = tabs.tabs;
  if (text.includes("summar") || text.includes("overview")) {
    const lines = ["You have " + open.length + (open.length === 1 ? " tab" : " tabs") + " open."];
    open.slice(0, 5).forEach((tab) => lines.push("• " + (tab.title || domainOf(tab.url)) + " — " + domainOf(tab.url)));
    lines.push("Connect an AI endpoint in settings to get AI-powered summaries.");
    return lines.join("\n");
  }
  if (text.includes("find")) {
    return "I can help locate a tab. Try “switch to <name> tab”. I can also use your open-tab context once an AI endpoint is connected.";
  }
  if (text.includes("plan") || text.includes("hour")) {
    return "A simple next-hour plan:\n1. Pick one tab as your focus.\n2. Close anything unrelated.\n3. Spend 40 minutes on the main task, then take a short reset.\n\nConnect an AI endpoint for a plan tailored to your open pages.";
  }
  return "I can help with your open tabs. Connect an AI endpoint in settings to enable model-powered answers. You can still say “open <site>”, “switch to <name> tab”, “close tab <name>”, “back”, or “reload”.";
}
