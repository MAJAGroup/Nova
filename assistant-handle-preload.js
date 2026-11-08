"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("orbitAssistantHandle", {
  open: () => ipcRenderer.send("assistant:open-from-handle")
});
