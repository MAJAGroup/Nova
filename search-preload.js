"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// This restricted bridge is available only to the bundled start document.
// The main process independently verifies the exact file URL and main frame.
if (location.protocol === "file:" && location.pathname.endsWith("/ui/newtab/index.html")) {
  contextBridge.exposeInMainWorld("orbitSearch", {
    getLocalSuggestions: query => ipcRenderer.invoke("browser:suggest-local", query),
    getWebSuggestions: query => ipcRenderer.invoke("browser:suggest-web", query),
    cancelSuggestions: () => ipcRenderer.send("browser:suggest-cancel"),
    chooseSuggestion: suggestion => ipcRenderer.invoke("browser:choose-suggestion", suggestion)
  });
}
