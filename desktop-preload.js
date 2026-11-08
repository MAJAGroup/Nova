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
  saveBookmark: bookmark => ipcRenderer.invoke("browser:save-bookmark", bookmark),
  removeBookmark: id => ipcRenderer.invoke("browser:remove-bookmark", id),
  openBookmark: id => ipcRenderer.invoke("browser:open-bookmark", id),
  clearBookmarks: () => ipcRenderer.invoke("browser:clear-bookmarks"),
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
  openHistory: (id) => ipcRenderer.invoke("browser:open-history", id),
  clearHistory: () => ipcRenderer.invoke("browser:clear-history"),
  clearBrowsingData: (options) => ipcRenderer.invoke("browser:clear-browsing-data", options),
  onHistoryUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("browser:history-updated", listener);
    return () => ipcRenderer.removeListener("browser:history-updated", listener);
  },
  getTabs: () => ipcRenderer.invoke("browser:get-tabs"),
  newTab: (url) => ipcRenderer.invoke("browser:new-tab", url),
  activateTab: (id) => ipcRenderer.invoke("browser:activate-tab", id),
  closeTab: (id) => ipcRenderer.invoke("browser:close-tab", id),
  navigate: (url) => ipcRenderer.invoke("browser:navigate", url),
  goBack: () => ipcRenderer.invoke("browser:back"),
  goForward: () => ipcRenderer.invoke("browser:forward"),
  reload: () => ipcRenderer.invoke("browser:reload"),
  stop: () => ipcRenderer.invoke("browser:stop"),
  groupTabs: (tabIds, options) => ipcRenderer.invoke("browser:group-tabs", tabIds, options),
  ungroupTabs: (tabIds) => ipcRenderer.invoke("browser:ungroup-tabs", tabIds),
  renameGroup: (groupId, name) => ipcRenderer.invoke("browser:rename-group", groupId, name),
  removeGroup: (groupId) => ipcRenderer.invoke("browser:remove-group", groupId),
  showTabMenu: (id) => ipcRenderer.send("browser:show-tab-menu", id),
  capturePage: () => ipcRenderer.invoke("browser:capture-page"),
  setBrowserBounds: (bounds) => ipcRenderer.send("browser:set-bounds", bounds),
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
