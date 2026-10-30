const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "nightbrew",
  Object.freeze({
    session: () => ipcRenderer.invoke("nightbrew:session"),
    checkForUpdates: () => ipcRenderer.invoke("nightbrew:updates"),
    installUpdate: () => ipcRenderer.invoke("nightbrew:install-update"),
  }),
);
