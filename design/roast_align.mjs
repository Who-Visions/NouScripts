import fs from 'fs';
const pg=(await (await fetch('http://localhost:9334/json')).json()).find(t=>t.type==='page');
const ws=new WebSocket(pg.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
let i=0; const call=(m,p={})=>new Promise(r=>{const id=++i; ws.addEventListener('message',function h(x){const d=JSON.parse(x.data); if(d.id===id){ws.removeEventListener('message',h); r(d.result);}}); ws.send(JSON.stringify({id,method:m,params:p}));});
await new Promise(r=>setTimeout(r,7000));
const res=(await call('Runtime.evaluate',{returnByValue:true,expression:fs.readFileSync(process.argv[3],'utf8')})).result;
console.log(JSON.stringify(res.value ?? res.description));
const s=await call('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(process.argv[2], Buffer.from(s.data,'base64')); ws.close();
