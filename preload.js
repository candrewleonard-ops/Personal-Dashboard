const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, data) => ipcRenderer.invoke('store:set', key, data)
  },
  platform: process.platform
});
