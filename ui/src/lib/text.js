// Shared text helpers for the renderer. Pure functions; React does the escaping.
import { createElement as h, Fragment } from 'react';

export const fmtTime = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`);
export const countWords = (s) => (String(s).match(/[A-Za-z0-9][A-Za-z0-9'’.,-]*/g) || []).length;
export const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();

export function lint(text, terms = []) {
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...new Set(terms.filter((t) => new RegExp(`(?:^|[^a-zA-Z0-9])${esc(t)}(?:$|[^a-zA-Z0-9])`, 'i').test(text)))];
}

// Inline markdown for notes and source lines: `code`, **bold**, *italic*, rendered as React nodes (never raw HTML).
export function Inline({ text }) {
  const parts = [];
  const rx = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0; let m; let k = 0;
  const s = String(text || '');
  while ((m = rx.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    if (m[1]) parts.push(h('code', { key: k++, className: 'font-mono text-[0.9em]' }, m[1]));
    else if (m[2]) parts.push(h('b', { key: k++ }, m[2]));
    else parts.push(h('i', { key: k++ }, m[3]));
    last = rx.lastIndex;
  }
  if (last < s.length) parts.push(s.slice(last));
  return h(Fragment, null, ...parts);
}

export const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
export const eastern = (t) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
export const cleanErr = (err) => String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
export const fileUrl = (p) => 'file://' + p.split('/').map(encodeURIComponent).join('/');
