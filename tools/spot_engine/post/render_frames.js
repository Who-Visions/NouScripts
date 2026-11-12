// Render a deterministic page frame by frame with Electron (run with the Nou Scripts Electron binary).
//
//   electron render_frames.js <page.html> <out_dir> <first> <last> <canvas|page> [data.json]
//
// canvas: the page exposes window.renderOverlay(f) and a #c canvas; frames are the canvas's own PNG, so the
//         alpha channel is exact (overlays).
// page:   the page exposes window.renderFrame(f) and window.hudReady; frames are a capture of the whole page at
//         1920x1080 (the HUD page, whose labels are DOM over WebGL).
// Both wait for the page's ready flag before the first frame.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// Electron's argv is [electron, this script, ...args]
const [page, out, first, last, mode, data] = process.argv.slice(2);
if (!page || !out || first === undefined || last === undefined || !['canvas', 'page'].includes(mode)) {
  console.error('usage: electron render_frames.js <page.html> <out_dir> <first> <last> <canvas|page> [data.json]');
  process.exit(2);
}

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const w = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, transparent: mode === 'canvas',
                                webPreferences: { webSecurity: false } });
  const q = mode === 'canvas' ? (data ? { data: 'file://' + path.resolve(data) } : {}) : { w: '1920', h: '1080' };
  await w.loadFile(path.resolve(page), { query: q });
  const ready = mode === 'canvas' ? 'window.overlayReady' : 'window.hudReady';
  for (let i = 0; i < 150 && !(await w.webContents.executeJavaScript('!!' + ready)); i++) await new Promise((r) => setTimeout(r, 100));
  let n = 0;
  for (let f = Number(first); f <= Number(last); f++) {
    let png;
    if (mode === 'canvas') {
      const url = await w.webContents.executeJavaScript(`window.renderOverlay(${f}); document.getElementById('c').toDataURL('image/png')`);
      png = Buffer.from(url.split(',')[1], 'base64');
    } else {
      await w.webContents.executeJavaScript(`window.renderFrame(${f})`);
      png = (await w.webContents.capturePage()).resize({ width: 1920, height: 1080 }).toPNG();
    }
    fs.writeFileSync(path.join(out, 'o_' + String(f).padStart(3, '0') + '.png'), png); n++;
  }
  console.log(`rendered ${n} frames (${mode}) ${first}-${last}`);
  app.quit();
});
