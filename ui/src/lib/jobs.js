// Page side of the job ports (see src/main.js withJob and src/preload.js). The main process opens one
// MessagePort per long job and the preload hands it to this window; we route it to the job's listener by id.
const listeners = new Map();
const ports = new Map();

window.addEventListener('message', (ev) => {
  if (ev.source !== window || !ev.data || ev.data.type !== 'nou-job-port' || !ev.ports || !ev.ports[0]) return;
  const port = ev.ports[0];
  const on = listeners.get(ev.data.jobId);
  if (!on) { port.close(); return; }
  ports.set(ev.data.jobId, port);
  port.onmessage = (m) => on(m.data);
});

// startJob(onEvent) -> { jobId, cancel(), end() }. Pass jobId with the request; events are
// { type: 'step' | 'done' | 'error', text?, t } where t is seconds since the job started.
export function startJob(onEvent) {
  const jobId = crypto.randomUUID();
  listeners.set(jobId, onEvent);
  return {
    jobId,
    cancel: () => { const p = ports.get(jobId); if (p) p.postMessage({ type: 'cancel' }); },
    end: () => { listeners.delete(jobId); const p = ports.get(jobId); if (p) p.close(); ports.delete(jobId); },
  };
}
