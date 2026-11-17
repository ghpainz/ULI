// Altyazılar: sekans başına altyazı listesi, stil, SRT/VTT içe-dışa aktarma ve render için sentetik metin klibi
import { uid } from './util.js';

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

// Altyazının kelimeleri metinde hâlâ aynı sırada mı (kullanıcı metni değiştirdiyse vurgu kapanır): her kelimenin [başla, bitir) karakter konumu
function wordSpans(cap) {
  if (!cap.words || !cap.words.length) return null;
  const spans = [];
  let pos = 0;
  for (const w of cap.words) {
    const i = cap.text.indexOf(w.text, pos);
    if (i < 0) return null;
    spans.push([i, i + w.text.length]);
    pos = i + w.text.length;
  }
  return spans;
}
function activeWord(cap, f) {
  let k = -1;
  for (let i = 0; i < cap.words.length; i++) if (cap.words[i].start <= f) k = i; else break;
  return k;
}

export function ensureCaptions(seq) {
  if (!seq.captions) seq.captions = [];
  if (!seq.captionStyle) seq.captionStyle = { ...DEFAULT_CAPTION_STYLE };
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
export function captionClip(seq, cap, f = null) {
  const st = { ...DEFAULT_CAPTION_STYLE, ...(seq.captionStyle || {}) };
  const k = seq.height / 1080;
  const key = cap.id + '|' + seq.width + 'x' + seq.height;
  // kelime kelime animasyon (yalnız otomatik altyazılarda kelime zamanları vardır)
  let shown = cap.text || ' ', hl = null;
  const spans = st.anim && st.anim !== 'none' && f != null ? wordSpans(cap) : null;
  if (spans) {
    const a = Math.max(0, activeWord(cap, f));
    if (st.anim === 'single') shown = cap.words[a].text;
    else if (st.anim === 'karaoke') hl = { from: spans[a][0], to: spans[a][1], color: st.hlColor };
    else if (st.anim === 'box') hl = { from: spans[a][0], to: spans[a][1], box: st.hlColor };
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
  c.props.position = { v: [seq.width / 2, seq.height * (1 - (st.margin ?? 7) / 100)] };
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
