"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("orbitTabResources", {
  onUpdate: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("tab-resources:data", listener);
    return () => ipcRenderer.removeListener("tab-resources:data", listener);
  },
  pointerInside: inside => ipcRenderer.send("tab-resources:pointer", inside === true),
  dismiss: () => ipcRenderer.send("tab-resources:dismiss")
});
