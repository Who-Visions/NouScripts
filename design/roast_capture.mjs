// Captures Read, As Broadcast and Write from a visible Electron window over DevTools, plus an overflow scan.
import fs from 'fs';
const [port, dir, tag] = process.argv.slice(2);
const pg = (await (await fetch(`http://localhost:${port}/json`)).json()).find((t) => t.type === 'page');
const ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let i = 0;
const call = (method, params = {}) => new Promise((r) => { const id = ++i; ws.addEventListener('message', function h(m) { const d = JSON.parse(m.data); if (d.id === id) { ws.removeEventListener('message', h); r(d.result); } }); ws.send(JSON.stringify({ id, method, params })); });
const val = async (e) => (await call('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (text) => {
  const p = await val(`(()=>{const e=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)}); if(!e) return null; const b=e.getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2];})()`);
  if (!p) return false;
  for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, x: p[0], y: p[1], button: 'left', clickCount: 1 });
  await sleep(600); return true;
};
const shot = async (n) => { const s = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${dir}/${tag}_${n}.png`, Buffer.from(s.data, 'base64')); };
await sleep(3500);
const overflow = () => val(`(()=>{let n=0;for(const e of document.querySelectorAll('body *')){const r=e.getBoundingClientRect(); if(r.right>innerWidth+1&&r.width>0) n++;} return n;})()`);
await shot('read'); console.log('read overflow', await overflow());
await click('As Broadcast'); await shot('broadcast'); console.log('broadcast overflow', await overflow());
await click('Write'); await shot('write'); console.log('write overflow', await overflow());
await click('Discard'); await click('Read');
ws.close();
