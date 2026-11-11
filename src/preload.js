'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nou', {
  list: () => ipcRenderer.invoke('stories:list'),
  load: (id, version) => ipcRenderer.invoke('script:load', { id, version }),
  approve: (id, version, note) => ipcRenderer.invoke('script:approve', { id, version, note }),
  save: (id, version, edits) => ipcRenderer.invoke('script:save', { id, version, edits }),
  exportClap: (id, version) => ipcRenderer.invoke('script:exportClap', { id, version }),
  reveal: (p) => ipcRenderer.invoke('file:reveal', p),
  open: (p) => ipcRenderer.invoke('file:open', p),
  onChange: (fn) => { ipcRenderer.on('stories:changed', () => fn()); },
});
