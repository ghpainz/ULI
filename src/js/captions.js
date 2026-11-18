// Altyazılar: sekans başına altyazı listesi, stil, SRT/VTT içe-dışa aktarma ve render için sentetik metin klibi
import { uid } from './util.js';
import { settings } from './settings.js';

export const DEFAULT_CAPTION_STYLE = {
  font: 'Segoe UI',
  size: 54, // 1080p'ye göre piksel; diğer çözünürlüklerde orantılanır
  color: '#ffffff',
  bold: false,
  italic: false,
  outline: 0,
  outlineColor: '#000000',
  bgEnabled: true,
  bgColor: '#000000',
  bgOpacity: 65,
  margin: 7, // alttan % uzaklık
  x: 50, // yatay konum (% genişlik, ortası)
  anim: 'none', // none | karaoke (konuşulan kelime renkli) | box (kelime renkli kutuda) | single (tek kelime)
  hlColor: '#ffd60a',
};

// Hazır altyazı stilleri
export const CAPTION_PRESETS = [
  { id: 'classic', name: 'Classic', st: { font: 'Segoe UI', size: 54, bold: false, color: '#ffffff', outline: 0, bgEnabled: true, bgColor: '#000000', bgOpacity: 65, margin: 7, anim: 'none' } },
  { id: 'social', name: 'Social (yellow word)', st: { font: 'Arial Black', size: 74, bold: true, color: '#ffffff', outline: 6, outlineColor: '#000000', bgEnabled: false, margin: 24, anim: 'karaoke', hlColor: '#ffd60a' } },
  { id: 'box', name: 'Word box', st: { font: 'Arial Black', size: 70, bold: true, color: '#ffffff', outline: 0, bgEnabled: false, margin: 24, anim: 'box', hlColor: '#7b2ff7' } },
  { id: 'single', name: 'One word at a time', st: { font: 'Arial Black', size: 120, bold: true, color: '#ffffff', outline: 8, outlineColor: '#000000', bgEnabled: false, margin: 40, anim: 'single', hlColor: '#ffd60a' } },
  { id: 'minimal', name: 'Minimal', st: { font: 'Segoe UI', size: 50, bold: true, color: '#ffffff', outline: 0, bgEnabled: false, margin: 8, anim: 'none' } },
];

// Altyazı metnindeki kelimelerin [başla, bitir) karakter konumu ve zamanı. Kullanıcı metni düzelttiyse
// yeni kelimeler eski kelimelerle hizalanır (eşleşen kelime eski zamanını alır, yeni eklenenler aradaki süreye yayılır).
const alignCache = new WeakMap();
const norm = (w) => w.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]/gu, '');
function similar(a, b) {
  a = norm(a); b = norm(b);
  if (a === b) return 0;
  if (!a || !b) return 1;
  // kısa Levenshtein oranı
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  const r = prev[n] / Math.max(m, n);
  return r <= 0.5 ? 0.5 : 1;
}
export function wordSpans(cap) {
  if (!cap.words || !cap.words.length || !cap.text) return null;
  const hit = alignCache.get(cap);
  if (hit && hit.text === cap.text && hit.words === cap.words) return hit.res;
  // yeni metnin kelimeleri
  const toks = [];
  const re = /\S+/g;
  let mm;
  while ((mm = re.exec(cap.text))) toks.push({ text: mm[0], a: mm.index, b: mm.index + mm[0].length });
  const old = cap.words;
  // kelime düzeyinde hizalama (dinamik programlama)
  const n = old.length, m = toks.length;
  const D = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  for (let i = 0; i <= n; i++) D[i][0] = i;
  for (let j = 0; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + similar(old[i - 1].text, toks[j - 1].text));
  const match = new Array(m).fill(-1);
  for (let i = n, j = m; i > 0 && j > 0;) {
    const sc = similar(old[i - 1].text, toks[j - 1].text);
    if (D[i][j] === D[i - 1][j - 1] + sc && sc < 1) { match[j - 1] = i - 1; i--; j--; } else if (D[i][j] === D[i - 1][j] + 1) i--; else if (D[i][j] === D[i][j - 1] + 1) j--; else { i--; j--; }
  }
  // zamanlar: eşleşenler eski zaman; eşleşmeyen ardışık kelimeler komşular arasındaki süreye eşit yayılır
  const res = toks.map((tk, j) => ({ from: tk.a, to: tk.b, start: match[j] >= 0 ? old[match[j]].start : null }));
  for (let j = 0; j < m;) {
    if (res[j].start != null) { j++; continue; }
    let k = j; while (k < m && res[k].start == null) k++;
    const s0 = j > 0 ? res[j - 1].start + 1 : cap.start;
    const s1 = k < m ? res[k].start : Math.max(s0 + (k - j), cap.end);
    for (let q = j; q < k; q++) res[q].start = Math.round(s0 + ((s1 - s0) * (q - j)) / (k - j));
    j = k;
  }
  alignCache.set(cap, { text: cap.text, words: cap.words, res });
  return res;
}
function activeWord(spans, f) {
  let k = -1;
  for (let i = 0; i < spans.length; i++) if (spans[i].start <= f) k = i; else break;
  return k;
}

export function ensureCaptions(seq) {
  if (!seq.captions) seq.captions = [];
  // yeni sekanslar kullanıcının son seçtiği altyazı stiliyle başlar
  if (!seq.captionStyle) seq.captionStyle = { ...DEFAULT_CAPTION_STYLE, ...(settings.captionStyleDefault || {}) };
  if (seq.captionsVisible === undefined) seq.captionsVisible = true;
  return seq.captions;
}

export function sortCaptions(seq) {
  seq.captions.sort((a, b) => a.start - b.start);
}

export function captionAt(seq, f) {
  if (!seq.captions) return null;
  for (const c of seq.captions) if (f >= c.start && f < c.end) return c;
  return null;
}

// Oynatma kafasında yeni altyazı: sonraki altyazıya kadar en fazla 3 sn
export function addCaption(seq, f, text = '') {
  ensureCaptions(seq);
  const fps = seq.fps;
  const next = seq.captions.filter((c) => c.start > f).sort((a, b) => a.start - b.start)[0];
  const inside = captionAt(seq, f);
  let start = f;
  if (inside) start = inside.end;
  let end = Math.min(start + Math.round(3 * fps), next ? next.start : Infinity);
  if (end <= start) end = start + Math.round(fps);
  const c = { id: uid('cap'), start, end, text };
  seq.captions.push(c);
  sortCaptions(seq);
  return c;
}

// Render için sentetik metin klibi (compositor'ın metin yolunu kullanır)
const synthCache = new Map();
// Altyazının sekanstaki kutusu (sürükleme ve seçim için): { x0, y0, x1, y1 }
export function captionBox(seq, cap, f, measure) {
  const c = captionClip(seq, cap, f);
  const { w, h } = measure(c.text);
  const [px, py] = c.props.position.v;
  return { x0: px - w / 2, y0: py - h, x1: px + w / 2, y1: py };
}

export function captionClip(seq, cap, f = null) {
  const st = { ...DEFAULT_CAPTION_STYLE, ...(seq.captionStyle || {}) };
  const k = seq.height / 1080;
  const key = cap.id + '|' + seq.width + 'x' + seq.height;
  // kelime kelime animasyon (yalnız otomatik altyazılarda kelime zamanları vardır)
  let shown = cap.text || ' ', hl = null;
  const spans = st.anim && st.anim !== 'none' && f != null ? wordSpans(cap) : null;
  if (spans) {
    const a = Math.max(0, activeWord(spans, f));
    if (st.anim === 'single') shown = cap.text.slice(spans[a].from, spans[a].to);
    else if (st.anim === 'karaoke') hl = { from: spans[a].from, to: spans[a].to, color: st.hlColor };
    else if (st.anim === 'box') hl = { from: spans[a].from, to: spans[a].to, box: st.hlColor };
  }
  const text = {
    text: shown, hl,
    font: st.font, size: Math.max(6, st.size * k), bold: st.bold, italic: st.italic, align: 'center', color: st.color,
    strokeWidth: (st.outline || 0) * k, strokeColor: st.outlineColor,
    shadow: !st.bgEnabled, shadowColor: '#000000', shadowBlur: 6 * k, shadowDist: 2 * k,
    bgEnabled: !!st.bgEnabled, bgColor: st.bgColor, bgOpacity: st.bgOpacity, bgPadding: 12 * k, lineHeight: 1.2, tracking: 0,
  };
  let c = synthCache.get(key);
  if (!c) {
    c = { id: 'cap_' + cap.id, kind: 'text', type: 'video', anchorBottom: true, effects: [], props: { scale: { v: 100 }, rotation: { v: 0 }, opacity: { v: 100 }, anchor: { v: null }, uniformScale: true, blendMode: 'normal' } };
    synthCache.set(key, c);
    if (synthCache.size > 2000) synthCache.clear();
  }
  c.text = text;
  c.props.position = { v: [seq.width * (st.x ?? 50) / 100, seq.height * (1 - (st.margin ?? 7) / 100)] };
  return c;
}

// ---- SRT / VTT ----
function parseTime(s) {
  const m = /(?:(\d+):)?(\d+):(\d+)[,.](\d{1,3})/.exec(s.trim());
  if (!m) return null;
  return (parseInt(m[1] || '0', 10) * 3600) + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4].padEnd(3, '0'), 10) / 1000;
}

export function parseSubtitles(text, fps) {
  const out = [];
  const blocks = String(text).replace(/\r/g, '').replace(/^﻿/, '').split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() !== '');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, z] = lines[ti].split('-->');
    const s = parseTime(a), e = parseTime(z);
    if (s == null || e == null || e <= s) continue;
    const body = lines.slice(ti + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]+\}/g, '');
    out.push({ id: uid('cap'), start: Math.round(s * fps), end: Math.max(Math.round(s * fps) + 1, Math.round(e * fps)), text: body });
  }
  return out;
}

function fmtTime(sec, sep) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`;
}

export function toSRT(seq, offsetFrames = 0) {
  const fps = seq.fps;
  return (seq.captions || []).slice().sort((a, b) => a.start - b.start)
    .map((c, i) => `${i + 1}\n${fmtTime((c.start - offsetFrames) / fps, ',')} --> ${fmtTime((c.end - offsetFrames) / fps, ',')}\n${c.text}\n`).join('\n');
}

export function toVTT(seq, offsetFrames = 0) {
  const fps = seq.fps;
  return 'WEBVTT\n\n' + (seq.captions || []).slice().sort((a, b) => a.start - b.start)
    .map((c) => `${fmtTime((c.start - offsetFrames) / fps, '.')} --> ${fmtTime((c.end - offsetFrames) / fps, '.')}\n${c.text}\n`).join('\n');
}

// Dışa aktarma aralığına göre kırpılmış altyazılar (SRT yan dosyası için)
export function captionsInRange(seq, f0, f1) {
  return (seq.captions || []).filter((c) => c.end > f0 && c.start < f1).map((c) => ({ ...c, start: Math.max(c.start, f0), end: Math.min(c.end, f1) }));
}
