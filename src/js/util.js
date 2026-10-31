// Ortak yardımcılar

export const nodeFs = window.require('fs');
export const nodePath = window.require('path');
export const childProcess = window.require('child_process');
export const ipc = window.require('electron').ipcRenderer;
export const nodeCrypto = window.require('crypto');
export const nodeOs = window.require('os');

let _uidCounter = 0;
export function uid(prefix = 'id') {
  _uidCounter = (_uidCounter + 1) % 1e6;
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + _uidCounter.toString(36);
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function fpsTimebase(fps) {
  return Math.round(fps);
}

// Kare -> HH:MM:SS:FF (non-drop)
export function framesToTC(frames, fps) {
  const neg = frames < 0;
  let f = Math.abs(Math.round(frames));
  const base = fpsTimebase(fps);
  const ff = f % base;
  let s = Math.floor(f / base);
  const hh = Math.floor(s / 3600);
  s -= hh * 3600;
  const mm = Math.floor(s / 60);
  const ss = s - mm * 60;
  const p = (n) => String(n).padStart(2, '0');
  return (neg ? '-' : '') + p(hh) + ':' + p(mm) + ':' + p(ss) + ':' + p(ff);
}

export function secToTC(sec, fps) {
  return framesToTC(Math.round(sec * fps), fps);
}

// "01:02:03:04", "1:02", "+10", "-5", "120" (kare) gibi girişleri çözer. current: göreli girişler için.
export function parseTC(str, fps, current = 0) {
  str = String(str).trim();
  if (!str) return null;
  const base = fpsTimebase(fps);
  let rel = 0;
  if (str[0] === '+') { rel = 1; str = str.slice(1); } else if (str[0] === '-') { rel = -1; str = str.slice(1); }
  let frames;
  if (str.includes(':') || str.includes(';') || str.includes('.')) {
    const parts = str.split(/[:;.]/).map((x) => parseInt(x || '0', 10));
    while (parts.length < 4) parts.unshift(0);
    const [hh, mm, ss, ff] = parts.slice(-4);
    frames = ((hh * 60 + mm) * 60 + ss) * base + ff;
  } else {
    const n = parseInt(str, 10);
    if (isNaN(n)) return null;
    if (rel) {
      frames = n;
    } else if (str.length <= 2) {
      frames = n;
    } else {
      // Premiere gibi: "1015" => 00:00:10:15
      const s = str.padStart(8, '0');
      const hh = parseInt(s.slice(0, 2), 10), mm = parseInt(s.slice(2, 4), 10), ss = parseInt(s.slice(4, 6), 10), ff = parseInt(s.slice(6, 8), 10);
      frames = ((hh * 60 + mm) * 60 + ss) * base + ff;
    }
  }
  if (isNaN(frames)) return null;
  if (rel) return current + rel * frames;
  return frames;
}

export function fmtSeconds(sec) {
  if (sec == null || !isFinite(sec)) return '--';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}

export function fpsToFraction(fps) {
  const known = [
    [23.976, '24000/1001'], [29.97, '30000/1001'], [59.94, '60000/1001'], [47.952, '48000/1001'], [119.88, '120000/1001'],
  ];
  for (const [v, f] of known) if (Math.abs(fps - v) < 0.01) return f;
  if (Math.abs(fps - Math.round(fps)) < 1e-6) return String(Math.round(fps));
  return String(Math.round(fps * 1000)) + '/1000';
}

export function parseFraction(str) {
  if (!str) return 0;
  if (String(str).includes('/')) {
    const [a, b] = String(str).split('/').map(Number);
    return b ? a / b : 0;
  }
  return Number(str) || 0;
}

export function niceFps(fps) {
  const known = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
  for (const k of known) if (Math.abs(fps - k) < 0.01) return k;
  return Math.round(fps * 1000) / 1000;
}

export function dbToGain(db) {
  if (db <= -96) return 0;
  return Math.pow(10, db / 20);
}
export function gainToDb(g) {
  if (g <= 0.0000158) return -96;
  return 20 * Math.log10(g);
}

export class Emitter {
  constructor() { this._ev = new Map(); }
  on(name, fn) {
    if (!this._ev.has(name)) this._ev.set(name, new Set());
    this._ev.get(name).add(fn);
    return () => this.off(name, fn);
  }
  off(name, fn) { const s = this._ev.get(name); if (s) s.delete(fn); }
  emit(name, ...args) {
    const s = this._ev.get(name);
    if (!s) return;
    for (const fn of [...s]) {
      try { fn(...args); } catch (e) { console.error('event handler error', name, e); }
    }
  }
}

export function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function rafThrottle(fn) {
  let pending = false;
  let lastArgs = null;
  return (...a) => {
    lastArgs = a;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; fn(...lastArgs); });
  };
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return e;
}

export function mediaUrl(p) {
  return 'uli://media/' + encodeURIComponent(p);
}

export function hashString(s) {
  return nodeCrypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
}

export function fileExists(p) {
  try { return nodeFs.existsSync(p); } catch (e) { return false; }
}

export function ensureDir(p) {
  try { nodeFs.mkdirSync(p, { recursive: true }); } catch (e) { /* var */ }
  return p;
}

export function hexToRgb(hex) {
  const h = String(hex || '#000000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(r, g, b) {
  const c = (x) => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const LABEL_COLORS = {
  violet: '#7472c4', iris: '#5b7fd1', caribbean: '#2aa8a0', lavender: '#b48ad8', cerulean: '#3a9ad9',
  forest: '#3f9a63', rose: '#d9708f', mango: '#e09a3a', purple: '#9a4fb5', blue: '#4060d0',
  teal: '#2a8a8a', magenta: '#c44fa8', tan: '#b59a6a', green: '#5aa84a', brown: '#8a6040', yellow: '#d0c040',
};
