"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("orbitBrowser", {
  getTabs: () => ipcRenderer.invoke("browser:get-tabs"),
  newTab: (url) => ipcRenderer.invoke("browser:new-tab", url),
  activateTab: (id) => ipcRenderer.invoke("browser:activate-tab", id),
  closeTab: (id) => ipcRenderer.invoke("browser:close-tab", id),
  navigate: (url) => ipcRenderer.invoke("browser:navigate", url),
  goBack: () => ipcRenderer.invoke("browser:back"),
  goForward: () => ipcRenderer.invoke("browser:forward"),
  reload: () => ipcRenderer.invoke("browser:reload"),
  stop: () => ipcRenderer.invoke("browser:stop"),
  setBrowserBounds: (bounds) => ipcRenderer.send("browser:set-bounds", bounds),
  getAIConfig: () => ipcRenderer.invoke("ai:get-config"),
  saveAIConfig: (config) => ipcRenderer.invoke("ai:save-config", config),
  clearAIConfig: () => ipcRenderer.invoke("ai:clear-config"),
  askAssistant: (request) => ipcRenderer.invoke("ai:ask", request),
  onTabsUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("browser:tabs-updated", listener);
    return () => ipcRenderer.removeListener("browser:tabs-updated", listener);
  },
  onCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("browser:command", listener);
    return () => ipcRenderer.removeListener("browser:command", listener);
  }
});
