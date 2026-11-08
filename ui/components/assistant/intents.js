import { domainOf, normalizeAddress, searchUrl } from "../../lib/url.js";

// Plain-language browser commands the assistant handles itself, without a
// model. Returns the reply text, or "" when the prompt isn't a command.
export function handleBrowserIntent(prompt, { browser, tabs, aiAvailable = false }) {
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
    if (aiAvailable && /\b(?:new\s+)?(?:tabs?|websites?|sites?|pages?)\b/i.test(text)) return "";
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
    if (aiAvailable && /\b(?:new\s+)?(?:tabs?|websites?|sites?|pages?)\b/i.test(text)) return "";
    browser.newTab(normalizeAddress(match[1]));
    return "Opening " + match[1] + ".";
  }

  // "group github, mdn and wikipedia as Research"
  match = text.match(/^group\s+(.+?)\s+(?:as|into|in|called|named)\s+(.+)$/i);
  if (match) {
    const names = match[1].split(/\s*(?:,|&|\band\b)\s*/i).filter(Boolean);
    const found = names.map((name) => tabs.findTab(name));
    const missing = names.filter((_, index) => !found[index]);
    // "group my work stuff as Work" isn't a list of tab names; let the AI read it.
    if (missing.length && aiAvailable) return "";
    if (missing.length) return "I couldn’t find a tab matching “" + missing.join("”, “") + "”.";
    const existing = tabs.findGroup(match[2]);
    browser.groupTabs(found.map((tab) => tab.id), existing ? { groupId: existing.id } : { name: match[2] });
    return (existing ? "Added " + found.length + (found.length === 1 ? " tab to " : " tabs to ") : "Made a new constellation, ") +
      "“" + (existing ? existing.name : match[2].trim()) + "”" + (existing ? "." : ", with " + found.length + (found.length === 1 ? " tab." : " tabs."));
  }

  // "ungroup Research" (a whole constellation) or "ungroup github" (one tab)
  match = text.match(/^ungroup\s+(.+)$/i);
  if (match) {
    // Compound reorganisation commands must reach the grouping planner; a
    // greedy local match would treat the whole sentence as one group name.
    if (aiAvailable && isGroupingRequest(text)) return "";
    const group = tabs.findGroup(match[1]);
    if (group) {
      browser.removeGroup(group.id);
      return "Ungrouped “" + group.name + "”.";
    }
    const target = tabs.findTab(match[1]);
    if (!target || !tabs.groupOf(target)) return "I couldn’t find a constellation or grouped tab matching “" + match[1] + "”.";
    browser.ungroupTabs([target.id]);
    return "Took “" + (target.title || domainOf(target.url)) + "” out of “" + tabs.groupOf(target).name + "”.";
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

// Free-form requests to organise tabs ("group my tabs by project", "put the
// shopping tabs together"), which go to the AI grouping planner.
export function isGroupingRequest(prompt) {
  const text = prompt.toLowerCase();
  if (/^ungroup\b/.test(text)) {
    const ungroupAll = /^ungroup\s+(?:all|every|each)\b/.test(text);
    const followUpGrouping = /\b(?:and|then|afterwards?|before)\b[\s\S]*\b(?:group|regroup|organi[sz]e|categori[sz]e|sort|arrange)\b/.test(text);
    return ungroupAll || followUpGrouping;
  }
  if (/\b(group|regroup|organi[sz]e|reorgani[sz]e|split|separate|cluster|categori[sz]e|sort|arrange|tidy( up)?)\b/.test(text) &&
    /\b(tabs?|pages?|constellations?|groups?|them|everything|by|into|together)\b/.test(text)) return true;
  return /\b(put|move|gather|collect|bundle)\b.+\b(together|into (a |one )?(group|constellation))\b/.test(text) ||
    /\b(make|create)\b.+\b(groups?|constellations?)\b/.test(text);
}

// Without a model, "group my tabs by site" can still be done locally.
export function groupBySiteLocally(prompt, { browser, tabs }) {
  if (!/\bby (site|domain|website)s?\b/i.test(prompt)) return "";
  const bySite = new Map();
  for (const tab of tabs.tabs) {
    const site = domainOf(tab.url).replace(/^www\./, "");
    if (!site) continue;
    if (!bySite.has(site)) bySite.set(site, []);
    bySite.get(site).push(tab);
  }
  const made = [];
  for (const [site, members] of bySite) {
    if (members.length < 2) continue;
    const existing = tabs.findGroup(site);
    browser.groupTabs(members.map((tab) => tab.id), existing ? { groupId: existing.id } : { name: site });
    made.push(site + " (" + members.length + ")");
  }
  if (!made.length) return "No site has more than one open tab, so there was nothing to group.";
  return "Grouped your tabs by site:\n• " + made.join("\n• ");
}

// Turns the main process's summary of an applied plan into a reply.
export function describeGroupingResult(result) {
  const lines = [];
  if (result.reply) lines.push(result.reply);
  for (const group of result.groups || []) {
    lines.push("• " + group.name + " — " + (group.created ? "new, " : "added ") + group.count + (group.count === 1 ? " tab" : " tabs"));
  }
  if (result.ungrouped) lines.push("• Took " + result.ungrouped + (result.ungrouped === 1 ? " tab" : " tabs") + " out of their groups");
  if (!(result.groups || []).length && !result.ungrouped && !result.reply) lines.push("I didn’t find anything to regroup for that request.");
  return lines.join("\n");
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
  return "I can help with your open tabs. Connect an AI endpoint for model-powered answers and requests to open several websites. You can still say “open <site>”, “search for <topic>”, “switch to <name> tab”, “close tab <name>”, “group <tabs> as <name>”, “group my tabs by site”, “ungroup <name>”, “back”, or “reload”.";
}
