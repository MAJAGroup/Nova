"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("novaBrowser", {
  showTabResources: (id, anchor) => ipcRenderer.send("browser:show-tab-resources", { id, anchor }),
  hideTabResources: immediate => ipcRenderer.send("browser:hide-tab-resources", immediate === true),
  onTabResourcesUpdated: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("browser:tab-resources-updated", listener);
    return () => ipcRenderer.removeListener("browser:tab-resources-updated", listener);
  },
  getBookmarks: () => ipcRenderer.invoke("browser:get-bookmarks"),
  getReadingList: () => ipcRenderer.invoke("browser:get-reading-list"),
  addCurrentToReadingList: () => ipcRenderer.invoke("browser:add-current-to-reading-list"),
  removeReadingListItem: id => ipcRenderer.invoke("browser:remove-reading-list-item", id),
  markReadingListItem: (id, read) => ipcRenderer.invoke("browser:mark-reading-list-item", id, read),
  clearReadingList: () => ipcRenderer.invoke("browser:clear-reading-list"),
  openReadingListItem: (id, options) => ipcRenderer.invoke("browser:open-reading-list-item", id, options),
  onReadingListUpdated: callback => {
    const listener = (_event, items) => callback(items);
    ipcRenderer.on("browser:reading-list-updated", listener);
    ipcRenderer.send("browser:reading-list-updated-request");
    return () => ipcRenderer.removeListener("browser:reading-list-updated", listener);
  },
  saveBookmark: bookmark => ipcRenderer.invoke("browser:save-bookmark", bookmark),
  removeBookmark: id => ipcRenderer.invoke("browser:remove-bookmark", id),
  openBookmark: id => ipcRenderer.invoke("browser:open-bookmark", id),
  clearBookmarks: () => ipcRenderer.invoke("browser:clear-bookmarks"),
  showBookmarkTransferMenu: () => ipcRenderer.send("browser:bookmark-transfer-menu"),
  onBookmarksUpdated: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("browser:bookmarks-updated", listener);
    return () => ipcRenderer.removeListener("browser:bookmarks-updated", listener);
  },
  getLocalSuggestions: query => ipcRenderer.invoke("browser:suggest-local", query),
  getWebSuggestions: query => ipcRenderer.invoke("browser:suggest-web", query),
  cancelSuggestions: () => ipcRenderer.send("browser:suggest-cancel"),
  chooseSuggestion: suggestion => ipcRenderer.invoke("browser:choose-suggestion", suggestion),
  getHistory: () => ipcRenderer.invoke("browser:get-history"),
  openHistory: (id, options) => ipcRenderer.invoke("browser:open-history", id, options),
  deleteHistoryEntry: id => ipcRenderer.invoke("browser:delete-history-entry", id),
  deleteHistoryGroup: ids => ipcRenderer.invoke("browser:delete-history-group", ids),
  showHistoryMenu: id => ipcRenderer.send("browser:show-history-menu", id),
  showHistoryDateMenu: key => ipcRenderer.send("browser:show-history-date-menu", key),
  clearHistory: () => ipcRenderer.invoke("browser:clear-history"),
  clearBrowsingData: (options) => ipcRenderer.invoke("browser:clear-browsing-data", options),
  onHistoryUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("browser:history-updated", listener);
    return () => ipcRenderer.removeListener("browser:history-updated", listener);
  },
  getTabs: () => ipcRenderer.invoke("browser:get-tabs"),
  getBrowserPreferences: () => ipcRenderer.invoke("browser:get-browser-preferences"),
  saveBrowserPreferences: preferences => ipcRenderer.invoke("browser:save-browser-preferences", preferences),
  getPermissions: () => ipcRenderer.invoke("browser:get-permissions"),
  revokePermission: (origin, permission) => ipcRenderer.send("browser:revoke-permission", origin, permission),
  clearSiteData: origin => ipcRenderer.invoke("browser:clear-site-data", origin),
  onPermissionsUpdated: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("browser:permissions-updated", listener);
    return () => ipcRenderer.removeListener("browser:permissions-updated", listener);
  },
  newTab: (url, options) => ipcRenderer.invoke("browser:new-tab", url, options),
  activateTab: (id) => ipcRenderer.invoke("browser:activate-tab", id),
  closeTab: (id) => ipcRenderer.invoke("browser:close-tab", id),
  reopenClosedTab: () => ipcRenderer.invoke("browser:reopen-closed-tab"),
  duplicateTab: id => ipcRenderer.invoke("browser:duplicate-tab", id),
  pinTab: (id, pinned) => ipcRenderer.invoke("browser:pin-tab", id, pinned),
  muteTab: (id, muted) => ipcRenderer.invoke("browser:mute-tab", id, muted),
  reorderTabs: order => ipcRenderer.invoke("browser:reorder-tabs", order),
  getDownloads: () => ipcRenderer.invoke("browser:get-downloads"),
  downloadAction: (id, action) => ipcRenderer.invoke("browser:download-action", id, action),
  onDownloadsUpdated: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("browser:downloads-updated", listener);
    return () => ipcRenderer.removeListener("browser:downloads-updated", listener);
  },
  findPage: (query, options) => ipcRenderer.invoke("browser:find-page", query, options),
  stopFind: () => ipcRenderer.invoke("browser:stop-find"),
  focusPage: () => ipcRenderer.invoke("browser:focus-page"),
  onFindResult: callback => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on("browser:find-result", listener);
    return () => ipcRenderer.removeListener("browser:find-result", listener);
  },
  printPage: () => ipcRenderer.invoke("browser:print-page"),
  savePDF: () => ipcRenderer.invoke("browser:save-pdf"),
  savePage: () => ipcRenderer.invoke("browser:save-page"),
  saveScreenshot: () => ipcRenderer.invoke("browser:save-screenshot"),
  navigate: (url) => ipcRenderer.invoke("browser:navigate", url),
  goBack: () => ipcRenderer.invoke("browser:back"),
  goForward: () => ipcRenderer.invoke("browser:forward"),
  reload: hard => ipcRenderer.invoke("browser:reload", hard === true),
  zoom: request => ipcRenderer.invoke("browser:zoom", request),
  stop: () => ipcRenderer.invoke("browser:stop"),
  groupTabs: (tabIds, options) => ipcRenderer.invoke("browser:group-tabs", tabIds, options),
  ungroupTabs: (tabIds) => ipcRenderer.invoke("browser:ungroup-tabs", tabIds),
  renameGroup: (groupId, name) => ipcRenderer.invoke("browser:rename-group", groupId, name),
  removeGroup: (groupId) => ipcRenderer.invoke("browser:remove-group", groupId),
  showTabMenu: (id, selectedIds = []) => ipcRenderer.send("browser:show-tab-menu", { id, selectedIds }),
  showNavigationMenu: direction => ipcRenderer.send("browser:show-navigation-menu", direction),
  showAddressMenu: () => ipcRenderer.send("browser:show-address-menu"),
  showRecentlyClosedMenu: () => ipcRenderer.send("browser:show-closed-menu"),
  capturePage: () => ipcRenderer.invoke("browser:capture-page"),
  setBrowserBounds: (bounds, side) => ipcRenderer.send("browser:set-bounds", bounds, side),
  openSideTab: (url) => ipcRenderer.invoke("browser:open-side-tab", url),
  closeSideTab: () => ipcRenderer.invoke("browser:close-side-tab"),
  promoteSideTab: () => ipcRenderer.invoke("browser:promote-side-tab"),
  openMultiTab: (leftId, rightId) => ipcRenderer.invoke("browser:open-multi-tab", leftId, rightId),
  openOrbitSplit: tabId => ipcRenderer.invoke("browser:open-orbit-split", tabId),
  closeMultiView: () => ipcRenderer.invoke("browser:close-multi-view"),
  setOrbitVisibility: visible => ipcRenderer.send("browser:orbit-visible", visible === true),
  getVoiceConfig: () => ipcRenderer.invoke("voice:get-config"),
  saveVoiceConfig: (config) => ipcRenderer.invoke("voice:save-config", config),
  getWakeWord: () => ipcRenderer.invoke("voice:get-wake-word"),
  transcribe: (audio, mimeType) => ipcRenderer.invoke("voice:transcribe", audio, mimeType),
  speak: (text) => ipcRenderer.invoke("voice:speak", text),
  onAssistantProgress: (callback) => {
    const listener = (_event, note) => callback(note);
    ipcRenderer.on("ai:progress", listener);
    return () => ipcRenderer.removeListener("ai:progress", listener);
  },
  getAIConfig: () => ipcRenderer.invoke("ai:get-config"),
  saveAIConfig: (config) => ipcRenderer.invoke("ai:save-config", config),
  clearAIConfig: () => ipcRenderer.invoke("ai:clear-config"),
  askAssistant: (request) => ipcRenderer.invoke("ai:ask", request),
  organizeTabs: (request) => ipcRenderer.invoke("ai:organize-tabs", request),
  onTabsUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("browser:tabs-updated", listener);
    return () => ipcRenderer.removeListener("browser:tabs-updated", listener);
  },
  onCommand: (callback) => {
    const listener = (_event, command, arg) => callback(command, arg);
    ipcRenderer.on("browser:command", listener);
    return () => ipcRenderer.removeListener("browser:command", listener);
  }
});
