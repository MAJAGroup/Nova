"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("novaAssistantHandle", {
  open: () => ipcRenderer.send("assistant:open-from-handle")
});
