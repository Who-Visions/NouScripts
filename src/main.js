'use strict';
const { app, BrowserWindow, ipcMain, shell, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const S = require('./scripts');

const capture = (process.argv.find((a) => a.startsWith('--capture=')) || '').split('=')[1];
const captureMode = (process.argv.find((a) => a.startsWith('--mode=')) || '').split('=')[1] || 'read';
let win;
let watcher;

function storyById(id) {
  return S.listStories().find((s) => s.id === id);
}

function inRoot(p) {
  const root = path.resolve(S.storiesRoot());
  const abs = path.resolve(p);
  return abs === root || abs.startsWith(root + path.sep);
}

ipcMain.handle('stories:list', () => ({ root: S.storiesRoot(), stories: S.listStories() }));

ipcMain.handle('script:load', (_e, { id, version }) => {
  const story = storyById(id);
  if (!story) throw new Error('story not found');
  const idx = story.versions.findIndex((v) => v.version === version);
  if (idx < 0) throw new Error('version not found');
  const cur = story.versions[idx];
  const parsed = S.parseScript(fs.readFileSync(cur.path, 'utf8'));
  const prevV = idx > 0 ? story.versions[idx - 1] : null;
  const prev = prevV ? S.parseScript(fs.readFileSync(prevV.path, 'utf8')) : null;
  return {
    story: { id: story.id, title: story.title, dir: story.dir, versions: story.versions.map((v) => v.version) },
    version, path: cur.path, prevVersion: prevV ? prevV.version : null,
    script: parsed, diff: S.compare(prev, parsed),
    approval: story.approval, approvalCurrent: S.approvalIsCurrent(story.dir, story.approval),
    modified: S.easternTime(new Date(cur.mtime)),
  };
});

ipcMain.handle('script:approve', (_e, { id, version, note }) => {
  const story = storyById(id);
  if (!story) throw new Error('story not found');
  return S.writeApproval(story.dir, version, note);
});

ipcMain.handle('file:reveal', (_e, p) => { if (inRoot(p)) shell.showItemInFolder(p); });
ipcMain.handle('file:open', (_e, p) => { if (inRoot(p)) return shell.openPath(p); });

function watchStories() {
  const root = S.storiesRoot();
  if (!fs.existsSync(root)) return;
  let t;
  try {
    watcher = fs.watch(root, { recursive: true }, (_ev, f) => {
      if (f && !/\.(md|json)$/i.test(f)) return;
      clearTimeout(t);
      t = setTimeout(() => win && !win.isDestroyed() && win.webContents.send('stories:changed'), 250);
    });
  } catch (e) { console.error('watch failed:', e.message); }
}

function createWindow() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    title: 'Nou Scripts', backgroundColor: '#0b0814', show: !capture,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { mode: captureMode } });
  if (capture) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const img = await win.webContents.capturePage();
      fs.mkdirSync(path.dirname(path.resolve(capture)), { recursive: true });
      fs.writeFileSync(capture, img.toPNG());
      console.log('captured', capture, img.getSize());
      app.quit();
    }, 1500));
  }
}

app.whenReady().then(() => { createWindow(); watchStories(); });
app.on('window-all-closed', () => { if (watcher) watcher.close(); app.quit(); });
