import { domainOf } from "../../lib/url.js";

// Plain-language browser commands the assistant handles itself, without a
// model. Returns the reply text, or "" when the prompt isn't a command.
export async function handleBrowserIntent(prompt, { browser, tabs, aiAvailable = false, onBookmarkAction = operation => operation() }) {
  const text = prompt.trim();
  const lower = text.toLowerCase();
  let match;

  if (!aiAvailable) {
    const bookmarkIntent = await handleBookmarkIntent(text, browser, onBookmarkAction);
    if (bookmarkIntent) return bookmarkIntent;
  }

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

  const clearHistory = /^(?:(?:please|can you|could you)\s+)*(?:clear|delete|erase|remove)\s+(?:(?:my|the)\s+)?(?:(?:all|every|entire|whole|everything)\s+)?(?:(?:my|the)\s+)?(?:browsing\s+)?history(?:\s+(?:in|from)\s+(?:the\s+)?history\s+section)?[.!?]*$/i;
  if (clearHistory.test(text)) {
    const cleared = await browser.clearHistory();
    return cleared ? "Cleared your browsing history." : "I couldn’t clear your browsing history.";
  }

  match = text.match(/^(?:search(?: the web)?(?: for)?|google)\s+(.+)$/i);
  if (match) {
    if (aiAvailable && /\b(?:new\s+)?(?:tabs?|websites?|sites?|pages?)\b/i.test(text)) return "";
    browser.newTab(match[1]);
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
    browser.newTab(match[1]);
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
  const followUpGrouping = /\b(?:and|then|afterwards?|before)\b[\s\S]*\b(?:group|regroup|organi[sz]e|categori[sz]e|sort|arrange)\b/i.test(lower);
  const ungroupAll = !/\bhistory\b/i.test(lower) && (
    /\bungroup\s+(?:everything|all|every|each)(?:\s+(?:of\s+)?(?:(?:my|the)\s+)?(?:tabs?|groups?|constellations?))?\b/i.test(text) ||
    /\b(?:remove|delete|clear)\s+(?:(?:all|every|each)\s+)?(?:tab\s+)?groups?\b/i.test(text)
  );
  if (ungroupAll && !followUpGrouping) {
    const groups = [...(tabs.groups || [])];
    if (!groups.length) return "There are no tab groups to ungroup.";
    const groupedTabIds = tabs.tabs.filter(tab => tabs.groupOf(tab)).map(tab => tab.id);
    await browser.ungroupTabs(groupedTabIds);
    return "Ungrouped all tabs from " + groups.length + (groups.length === 1 ? " group." : " groups.");
  }

  match = text.match(/^ungroup\s+(.+)$/i);
  if (match) {
    // Compound reorganisation commands must reach the grouping planner; a
    // greedy local match would treat the whole sentence as one group name.
    if (aiAvailable && isGroupingRequest(text)) return "";
    const group = tabs.findGroup(match[1]);
    if (group) {
      await browser.removeGroup(group.id);
      return "Ungrouped “" + group.name + "”.";
    }
    const target = tabs.findTab(match[1]);
    const targetGroup = target && tabs.groupOf(target);
    if (!target || !targetGroup) return "I couldn’t find a constellation or grouped tab matching “" + match[1] + "”.";
    const targetTitle = target.title || domainOf(target.url);
    await browser.ungroupTabs([target.id]);
    return "Took “" + targetTitle + "” out of “" + targetGroup.name + "”.";
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

async function handleBookmarkIntent(prompt, browser, onBookmarkAction) {
  const text = prompt.trim();
  const run = operation => onBookmarkAction(operation);
  const loadBookmarks = async () => typeof browser.getBookmarks === "function" ? browser.getBookmarks() : [];
  const matchBookmarks = (items, query) => {
    const terms = String(query || "").toLowerCase().split(/[^\p{L}\p{N}.-]+/u).filter(term => term.length > 1 && !["the", "my", "bookmark", "bookmarks", "saved", "page", "site", "website", "from", "in", "on"].includes(term));
    return items.filter(item => {
      let site = "";
      try { site = new URL(item.url).hostname.replace(/^www\./i, ""); } catch { /* malformed bookmarks cannot be queried by host */ }
      const haystack = `${item.title || ""} ${item.url || ""} ${site}`.toLowerCase();
      return terms.length > 0 && terms.every(term => haystack.includes(term));
    });
  };
  const clearAll = /^(?:(?:please|can you|could you)\s+)*(?:clear|delete|remove|erase)\s+(?:(?:all|every|entire|whole|everything)\s+)?(?:(?:my|the)\s+)?(?:saved\s+)?bookmarks?[.!?]*$/i.test(text);
  if (clearAll) {
    return run(async () => {
      const result = await browser.clearBookmarks?.();
      return result?.ok === false ? `I couldn't clear bookmarks: ${result.error}` : "Cleared all saved bookmarks.";
    });
  }

  if (/^(?:(?:please|can you|could you)\s+)*(?:bookmark|save|add)\s+(?:(?:this|the current|current)\s+)?(?:page|website|site|tab)(?:\s+to\s+(?:my\s+)?bookmarks?)?[.!?]*$/i.test(text)) {
    return run(async () => {
      const result = await browser.saveBookmark?.();
      return result?.ok ? `Saved ${result.bookmark?.title || "this page"} to bookmarks.` : `I couldn't save that page: ${result?.error || "Open a website first."}`;
    });
  }

  if (/\b(?:group|organize|organise|sort|categorize|categorise)\b[\s\S]*\bbookmarks?\b/i.test(text) && /\b(?:by|into|as|website|site|domain|group|category|type)\b/i.test(text)) {
    return run(async () => "Your Bookmark universe already groups saved pages by website.");
  }

  const removeMatch = text.match(/^(?:please\s+)?(?:delete|remove|erase|unbookmark)\s+(?:(?:the|my)\s+)?(?:bookmark|bookmarked page)(?:\s+(?:for|named|called))?\s+(.+?)[.!?]*$/i)
    || text.match(/^(?:please\s+)?(?:delete|remove|erase)\s+(.+?)\s+bookmark[.!?]*$/i);
  if (removeMatch) {
    return run(async () => {
      const items = matchBookmarks(await loadBookmarks(), removeMatch[1]);
      if (!items.length) return `I couldn't find a bookmark matching “${removeMatch[1]}”.`;
      if (items.length > 1) return `I found ${items.length} bookmarks matching “${removeMatch[1]}”. Please include a more specific title or website.`;
      const result = await browser.removeBookmark?.(items[0].id);
      return result?.ok === false ? `I couldn't remove that bookmark: ${result.error}` : `Removed ${items[0].title || "the bookmark"} from bookmarks.`;
    });
  }

  const removeGroupMatch = text.match(/^(?:please\s+)?(?:delete|remove|erase|clear)\s+(?:(?:all|every)\s+)?(?:the\s+)?bookmarks?\s+(?:from|for|in|under)\s+(.+?)[.!?]*$/i)
    || text.match(/^(?:please\s+)?(?:delete|remove|erase|clear)\s+(?:the\s+)?bookmark group\s+(.+?)[.!?]*$/i);
  if (removeGroupMatch) {
    return run(async () => {
      const items = matchBookmarks(await loadBookmarks(), removeGroupMatch[1]);
      if (!items.length) return `I couldn't find a website group matching “${removeGroupMatch[1]}”.`;
      for (const item of items) await browser.removeBookmark?.(item.id);
      return `Removed ${items.length} ${items.length === 1 ? "bookmark" : "bookmarks"} from the “${removeGroupMatch[1]}” group.`;
    });
  }

  const renameMatch = text.match(/^(?:please\s+)?(?:rename|edit|update|change)\s+(?:(?:the|my)\s+)?bookmark(?:\s+(?:for|named|called))?\s+(.+?)\s+(?:to|as)\s+(.+?)[.!?]*$/i);
  if (renameMatch) {
    return run(async () => {
      const items = matchBookmarks(await loadBookmarks(), renameMatch[1]);
      if (!items.length) return `I couldn't find a bookmark matching “${renameMatch[1]}”.`;
      if (items.length > 1) return `I found ${items.length} bookmarks matching “${renameMatch[1]}”. Please include a more specific title or website.`;
      const result = await browser.saveBookmark?.({ id: items[0].id, title: renameMatch[2], url: items[0].url });
      return result?.ok ? `Renamed the bookmark to “${result.bookmark?.title || renameMatch[2]}”.` : `I couldn't update that bookmark: ${result?.error || "Unknown error."}`;
    });
  }

  const searchMatch = text.match(/^(?:search|find)\s+(?:(?:my|the)\s+)?bookmarks?\s+(?:for\s+)?(.+?)[.!?]*$/i)
    || text.match(/^(?:find|search for)\s+(.+?)\s+(?:in|among|from)\s+(?:(?:my|the)\s+)?bookmarks?[.!?]*$/i)
    || text.match(/^find\s+(?:the\s+)?(.+?)\s+(?:bookmark|bookmarked page)[.!?]*$/i);
  if (searchMatch) {
    return run(async () => {
      const items = matchBookmarks(await loadBookmarks(), searchMatch[1]);
      if (!items.length) return `I couldn't find a bookmark matching “${searchMatch[1]}”.`;
      return `Found ${items.length} ${items.length === 1 ? "bookmark" : "bookmarks"} matching “${searchMatch[1]}”:\n` +
        items.slice(0, 10).map(item => `• ${item.title || item.url} — ${item.url}`).join("\n");
    });
  }

  const openMatch = text.match(/^(?:open|visit|go to|navigate to)\s+(?:(?:my|the)\s+)?(.+?)\s+(?:bookmark|bookmarked page|from bookmarks)[.!?]*$/i)
    || text.match(/^(?:open|visit|go to)\s+(?:(?:my|the)\s+)?bookmark(?:\s+(?:for|named|called))\s+(.+?)[.!?]*$/i)
    || text.match(/^(?:open|visit)\s+(?:the\s+)?bookmarked\s+page\s+(.+?)[.!?]*$/i);
  if (openMatch) {
    return run(async () => {
      const items = matchBookmarks(await loadBookmarks(), openMatch[1]);
      if (!items.length) return `I couldn't find a bookmark matching “${openMatch[1]}”.`;
      if (items.length > 1) return `I found ${items.length} bookmarks matching “${openMatch[1]}”. Please include a more specific title or website.`;
      const opened = await browser.openBookmark?.(items[0].id);
      return opened ? `Opening ${items[0].title || "the saved page"}.` : `I couldn't open ${items[0].title || "that bookmark"}.`;
    });
  }

  if (/\b(?:summari[sz]e|list|show|count|how many|what are|which)\b[\s\S]*\bbookmarks?\b/i.test(text)) {
    return run(async () => {
      const items = await loadBookmarks();
      const sites = new Map();
      for (const item of items) {
        try {
          const site = new URL(item.url).hostname.replace(/^www\./i, "");
          sites.set(site, (sites.get(site) || 0) + 1);
        } catch { /* ignore malformed legacy entries */ }
      }
      const groups = [...sites].sort((a, b) => b[1] - a[1]);
      const head = `You have ${items.length} saved ${items.length === 1 ? "page" : "pages"} across ${sites.size} website ${sites.size === 1 ? "group" : "groups"}.`;
      if (/\b(?:count|how many)\b/i.test(text)) return head;
      const list = items.slice(0, 8).map(item => `• ${item.title || item.url}`).join("\n");
      const popular = groups.slice(0, 5).map(([site, count]) => `${site} (${count})`).join(", ");
      return `${head}${popular ? ` Largest groups: ${popular}.` : ""}${list ? `\n${list}` : ""}`;
    });
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
  return "I can help with your open tabs and saved bookmarks. Connect an AI endpoint for model-powered answers, research, and flexible bookmark tasks. You can say “summarize my bookmarks”, “open the Wikipedia bookmark”, “save this page”, “remove the bookmark for GitHub”, “open <site>”, “search for <topic>”, “group my tabs by site”, “clear history”, “back”, or “reload”.";
}
