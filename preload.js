const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, data) => ipcRenderer.invoke('store:set', key, data)
  },
  ai: {
    chat: (msg) => ipcRenderer.invoke('ai:chat', msg),
    confirm: (ok) => ipcRenderer.invoke('ai:confirm', ok),
    checkKey: () => ipcRenderer.invoke('ai:check-key'),
    onChunk: (cb) => ipcRenderer.on('ai:chunk', (_, t) => cb(t)),
    onToolCall: (cb) => ipcRenderer.on('ai:tool-call', (_, tc) => cb(tc)),
    onDataChanged: (cb) => ipcRenderer.on('ai:data-changed', () => cb()),
    clearListeners: () => {
      ['ai:chunk', 'ai:tool-call', 'ai:data-changed'].forEach(ch => ipcRenderer.removeAllListeners(ch));
    }
  },
  platform: process.platform
});
