'use strict';
const { app, BrowserWindow, ipcMain, shell, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const S = require('./scripts');

const capture = (process.argv.find((a) => a.startsWith('--capture=')) || '').split('=')[1];
const captureMode = (process.argv.find((a) => a.startsWith('--mode=')) || '').split('=')[1] || 'read';
const captureRail = (process.argv.find((a) => a.startsWith('--rail=')) || '').split('=')[1] || '';
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

async function broadcastApproval(storyId, version, note) {
  const text = `[APPROVED] Story "${storyId}" script v${version} approved by Dave${note ? ` ("${note}")` : ''}`;
  try {
    const res = await fetch('http://127.0.0.1:8766/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: 'phoebus/nouscripts',
        to: '@all',
        content: text,
      }),
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      console.log('Broadcasted approval to MsgNode 8766');
      return;
    }
  } catch {
    // MsgNode not responding on 8766; fall back to CLI
  }

  const nougenBin = path.join(require('os').homedir(), 'The Observatory', 'NouGen', 'nougenshards', '.venv', 'bin', 'nougen');
  if (fs.existsSync(nougenBin)) {
    execFile(nougenBin, ['msg', '--to', '@all', text], (err) => {
      if (err) console.log('nougen msg fallback skipped:', err.message);
      else console.log('Broadcasted approval via nougen msg CLI');
    });
  }
}

ipcMain.handle('stories:list', () => ({
  root: S.storiesRoot(),
  stories: S.listStories().map((s) => ({ ...s, approvalCurrent: S.approvalIsCurrent(s.dir, s.approval) })),
}));

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

ipcMain.handle('script:approve', async (_e, { id, version, note }) => {
  const story = storyById(id);
  if (!story) throw new Error('story not found');
  const result = S.writeApproval(story.dir, version, note);
  try {
    S.exportOpenClap(story.dir, version);
  } catch (e) {
    console.error('Failed to auto-export OpenClap on approval:', e.message);
  }
  broadcastApproval(story.id, version, note).catch(() => {});
  return result;
});

ipcMain.handle('script:exportClap', (_e, { id, version }) => {
  const story = storyById(id);
  if (!story) throw new Error('story not found');
  return S.exportOpenClap(story.dir, version);
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
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { mode: captureMode, rail: captureRail } });
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
