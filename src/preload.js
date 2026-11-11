'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nou', {
  list: () => ipcRenderer.invoke('stories:list'),
  load: (id, version) => ipcRenderer.invoke('script:load', { id, version }),
  approve: (id, version, note) => ipcRenderer.invoke('script:approve', { id, version, note }),
  save: (id, version, edits) => ipcRenderer.invoke('script:save', { id, version, edits }),
  attach: () => ipcRenderer.invoke('ask:attach'),
  ask: (req) => ipcRenderer.invoke('ask:send', req),
  fetchPages: (req) => ipcRenderer.invoke('lane:fetch', req),
  digest: (req) => ipcRenderer.invoke('lane:digest', req),
  files: (id) => ipcRenderer.invoke('story:files', { id }),
  media: (id) => ipcRenderer.invoke('media:list', { id }),
  mediaAttach: (id, url) => ipcRenderer.invoke('media:attach', { id, url }),
  mediaOpen: (id, url) => ipcRenderer.invoke('media:open', { id, url }),
  research: (req) => ipcRenderer.invoke('lane:research', req),
  exportClap: (id, version) => ipcRenderer.invoke('script:exportClap', { id, version }),
  reveal: (p) => ipcRenderer.invoke('file:reveal', p),
  open: (p) => ipcRenderer.invoke('file:open', p),
  onChange: (fn) => { ipcRenderer.on('stories:changed', () => fn()); },
});
