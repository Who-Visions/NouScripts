'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Job ports: the main process sends one MessagePort per long job; hand it to the page (contextIsolation keeps
// ipcRenderer out of the main world), where ui/src/lib/jobs.js picks it up by jobId.
ipcRenderer.on('nou-job-port', (e, msg) => { window.postMessage({ type: 'nou-job-port', jobId: msg.jobId }, '*', e.ports); });

contextBridge.exposeInMainWorld('nou', {
  list: () => ipcRenderer.invoke('stories:list'),
  load: (id, version) => ipcRenderer.invoke('script:load', { id, version }),
  approve: (id, version, note) => ipcRenderer.invoke('script:approve', { id, version, note }),
  save: (id, version, edits) => ipcRenderer.invoke('script:save', { id, version, edits }),
  attach: () => ipcRenderer.invoke('ask:attach'),
  updater: {
    status: () => ipcRenderer.invoke('updater:status'),
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStatus: (fn) => { ipcRenderer.on('updater:status', (_e, s) => fn(s)); },
  },
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
