// Çok katmanlı grafik klipleri (Essential Graphics benzeri): katmanlar, giriş/çıkış animasyonları, şablonlar
import { uid } from './util.js';
import { renderTextCanvas } from './text.js';

export const ANIMS = ['none', 'fade', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'scale', 'pop', 'typewriter', 'wipe',
  'charFade', 'charPop', 'charRise', 'charDrop', 'charBlur', 'charRandom', 'wordPop', 'glitchIn'];
export const ANIM_LABELS = {
  none: 'None', fade: 'Fade', slideUp: 'Slide Up', slideDown: 'Slide Down', slideLeft: 'Slide Left', slideRight: 'Slide Right',
  scale: 'Scale', pop: 'Pop', typewriter: 'Typewriter', wipe: 'Wipe',
  charFade: 'Letters: Fade', charPop: 'Letters: Pop', charRise: 'Letters: Rise', charDrop: 'Letters: Drop', charBlur: 'Letters: Blur In',
  charRandom: 'Letters: Random', wordPop: 'Words: Pop', glitchIn: 'Glitch',
};
// harf/kelime bazlı animasyonlar (yalnız metin katmanları)
export const CHAR_ANIMS = new Set(['charFade', 'charPop', 'charRise', 'charDrop', 'charBlur', 'charRandom', 'wordPop', 'glitchIn']);
// sürekli (döngü) animasyonlar
export const LOOPS = ['none', 'wave', 'bounce', 'rainbow', 'pulse', 'shake', 'float', 'swing', 'flicker', 'glowPulse'];
export const LOOP_LABELS = { none: 'None', wave: 'Wave', bounce: 'Bounce', rainbow: 'Rainbow', pulse: 'Pulse', shake: 'Shake', float: 'Float', swing: 'Swing', flicker: 'Flicker', glowPulse: 'Glow Pulse' };
const CHAR_LOOPS = new Set(['wave', 'bounce', 'rainbow']);

export function newLayer(type, W, H, extra = {}) {
  const base = {
    id: uid('lyr'), type, name: type, x: W / 2, y: H / 2, w: Math.round(W * 0.3), h: Math.round(H * 0.1), rotation: 0, opacity: 100,
    fill: '#ffffff', fillOpacity: 100, stroke: '#000000', strokeWidth: 0, radius: 0,
    shadow: false, shadowColor: '#000000', shadowBlur: 10, shadowDist: 4,
    delay: 0, animIn: { type: 'fade', dur: 15 }, animOut: { type: 'fade', dur: 12 },
  };
  if (type === 'text') Object.assign(base, { name: 'Text', text: 'Metin', font: 'Segoe UI', size: Math.round(H * 0.07), bold: false, italic: false, align: 'center', tracking: 0, lineHeight: 1.15 });
  if (type === 'rect') Object.assign(base, { name: 'Rectangle', fill: '#2d8ceb' });
  if (type === 'ellipse') Object.assign(base, { name: 'Ellipse', w: Math.round(H * 0.15), h: Math.round(H * 0.15), fill: '#e0533d' });
  if (type === 'svg') Object.assign(base, { name: 'Shape', w: Math.round(H * 0.2), h: Math.round(H * 0.2), fill: '#ffffff', path: 'M2 10h13V5l7 7-7 7v-5H2z' });
  if (type === 'line') Object.assign(base, { name: 'Line', h: Math.max(2, Math.round(H * 0.005)), fill: '#ffffff' });
  if (type === 'progress') Object.assign(base, { name: 'Progress Bar', y: H * 0.95, w: Math.round(W * 0.9), h: Math.max(4, Math.round(H * 0.012)), fill: '#e62117', stroke: '#ffffff', strokeWidth: 0, trackOpacity: 30, radius: Math.round(H * 0.006), animIn: { type: 'none', dur: 15 }, animOut: { type: 'none', dur: 12 } });
  if (type === 'countdown') Object.assign(base, { name: 'Countdown', text: '', font: 'Segoe UI', size: Math.round(H * 0.12), bold: true, italic: false, align: 'center', tracking: 0, lineHeight: 1.15, countFrom: 10, countFormat: 'ss', animIn: { type: 'pop', dur: 12 } });
  return Object.assign(base, extra);
}

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

const bounceOut = (t) => {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};
const hash1 = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// Katmanın o karedeki animasyon durumu: { visible, alpha, dx, dy, scale, rot, reveal (0..1), chars (0..1), charIn, charOut }
export function layerState(L, local, duration, W, H, fps = 30) {
  const st = { visible: true, alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, reveal: 1, chars: 1, charIn: null, charOut: null };
  const t = local - (L.delay || 0);
  if (t < 0) { st.visible = false; return st; }
  const apply = (anim, p, isIn) => {
    if (!anim || anim.type === 'none' || p >= 1) return;
    if (CHAR_ANIMS.has(anim.type)) {
      if (L.type === 'text' || L.type === 'countdown') { st[isIn ? 'charIn' : 'charOut'] = { type: anim.type, p: Math.max(0, p) }; return; }
      anim = { type: anim.type === 'charPop' || anim.type === 'wordPop' ? 'pop' : 'fade' };
    }
    const e = easeOut(Math.max(0, p));
    const dist = Math.min(W, H) * 0.08;
    switch (anim.type) {
      case 'fade': st.alpha *= e; break;
      case 'slideUp': st.dy += (1 - e) * dist; st.alpha *= e; break;
      case 'slideDown': st.dy -= (1 - e) * dist; st.alpha *= e; break;
      case 'slideLeft': st.dx += (1 - e) * dist * 1.5; st.alpha *= e; break;
      case 'slideRight': st.dx -= (1 - e) * dist * 1.5; st.alpha *= e; break;
      case 'scale': st.scale *= 0.6 + 0.4 * e; st.alpha *= e; break;
      case 'pop': st.scale *= Math.max(0, easeBack(Math.max(0, p))); st.alpha *= Math.min(1, p * 3); break;
      case 'typewriter': st.chars *= Math.max(0, p); break;
      case 'wipe': st.reveal *= e; break;
    }
  };
  const di = Math.max(1, L.animIn?.dur || 1);
  apply(L.animIn, t / di, true);
  const remain = duration - local;
  const dout = Math.max(1, L.animOut?.dur || 1);
  apply(L.animOut, remain / dout, false);
  // döngü animasyonları (katman düzeyi)
  const lp = L.loop;
  if (lp && lp.type && lp.type !== 'none' && !CHAR_LOOPS.has(lp.type)) {
    const ph = (t / fps) * (lp.speed || 1);
    const amt = (lp.amount ?? 100) / 100;
    const size = Math.min(W, H);
    switch (lp.type) {
      case 'pulse': st.scale *= 1 + 0.06 * amt * Math.sin(ph * Math.PI * 2); break;
      case 'shake': { const k = Math.floor(ph * 12); st.dx += (hash1(k) - 0.5) * size * 0.02 * amt; st.dy += (hash1(k + 99) - 0.5) * size * 0.02 * amt; break; }
      case 'float': st.dy += Math.sin(ph * Math.PI * 2) * size * 0.015 * amt; break;
      case 'swing': st.rot += Math.sin(ph * Math.PI * 2) * 8 * amt; break;
      case 'flicker': { const k = Math.floor(ph * 10); st.alpha *= hash1(k) > 0.15 * amt ? 1 : 0.25; break; }
      case 'glowPulse': st.glowK = Math.round((1 + 0.6 * amt * Math.sin(ph * Math.PI * 2)) * 20) / 20; break;
    }
  }
  return st;
}

// Harf/kelime animasyonunun tek karakter için durumu. pc: 0 (gizli) .. 1 (tam görünür)
function charAnim(type, pc, size, frameSeed, idx) {
  const o = { alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, blur: 0 };
  if (pc >= 1) return o;
  const e = easeOut(Math.max(0, pc));
  switch (type) {
    case 'charFade': case 'charRandom': o.alpha = e; break;
    case 'charPop': case 'wordPop': o.scale = Math.max(0, easeBack(Math.max(0, pc))); o.alpha = Math.min(1, pc * 3); break;
    case 'charRise': o.dy = (1 - e) * size * 0.8; o.alpha = e; break;
    case 'charDrop': o.dy = -(1 - bounceOut(Math.max(0, pc))) * size * 1.2; o.alpha = Math.min(1, pc * 4); break;
    case 'charBlur': o.blur = (1 - e) * size * 0.25; o.alpha = e; o.scale = 1 + (1 - e) * 0.5; break;
    case 'glitchIn': {
      const r = hash1(frameSeed * 13.1 + idx * 7.7);
      o.dx = (r - 0.5) * size * 0.6 * (1 - pc);
      o.alpha = pc > hash1(idx * 3.3) * 0.8 ? 1 : (r > 0.6 ? 0.6 : 0);
      break;
    }
  }
  return o;
}

// Metni karakter karakter çiz (harf animasyonları ve harf döngüleri için)
function graphemes(str) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str)].map((x) => x.segment);
  return Array.from(str);
}
let measCtx = null;
function drawCharText(ctx, L, text, st, t, fps) {
  const size = Math.max(1, L.size || 40);
  const font = `${L.italic ? 'italic ' : ''}${L.bold ? '700 ' : '400 '}${size}px "${L.font}", "Segoe UI", sans-serif`;
  if (!measCtx) measCtx = document.createElement('canvas').getContext('2d');
  measCtx.font = font;
  if ('letterSpacing' in measCtx) measCtx.letterSpacing = (L.tracking || 0) + 'px';
  const lines = String(text ?? '').split('\n').map(graphemes);
  const lh = size * (L.lineHeight || 1.15);
  const widths = lines.map((g) => measCtx.measureText(g.join('') || ' ').width);
  const maxW = Math.max(1, ...widths);
  const baseLeft = L.align === 'left' ? 0 : L.align === 'right' ? -maxW : -maxW / 2;
  // sıralama: karakter, kelime veya rastgele
  const all = [];
  let word = 0;
  lines.forEach((g, li) => { g.forEach((ch, ci) => { all.push({ li, ci, ch, word }); if (/\s/.test(ch)) word++; }); word++; });
  const n = all.length, nw = word;
  const order = (it, k, type) => {
    if (type === 'wordPop') return nw > 1 ? it.word / (nw - 1) : 0;
    if (type === 'charRandom') return hash1(k + 0.5);
    return n > 1 ? k / (n - 1) : 0;
  };
  const stag = (p, o) => Math.max(0, Math.min(1, (p - 0.6 * o) / 0.4));
  const lp = L.loop && CHAR_LOOPS.has(L.loop.type) ? L.loop : null;
  const ph = (t / fps) * (lp?.speed || 1);
  const amt = (lp?.amount ?? 100) / 100;
  const frameSeed = Math.floor(t / 2);
  all.forEach((it, k) => {
    if (/^\s$/.test(it.ch)) return;
    const g = lines[it.li];
    const lineLeft = baseLeft + (L.align === 'left' ? 0 : L.align === 'right' ? maxW - widths[it.li] : (maxW - widths[it.li]) / 2);
    const prefix = it.ci ? measCtx.measureText(g.slice(0, it.ci).join('')).width : 0;
    const cw = measCtx.measureText(it.ch).width;
    let cx = lineLeft + prefix + cw / 2;
    let cy = -lh * lines.length / 2 + lh * it.li + lh / 2;
    let arcRot = 0;
    if (L.curve) {
      // eğri üstünde yazı: karakterler bir yay boyunca dizilir (+ kemer, - çanak)
      const theta = (Math.abs(L.curve) / 100) * Math.PI * 1.5;
      const R = maxW / Math.max(1e-4, theta);
      const a = cx / R;
      const sg = Math.sign(L.curve);
      cy += sg * R * (1 - Math.cos(a));
      cx = R * Math.sin(a);
      arcRot = (sg * a * 180) / Math.PI;
    }
    let a = 1, dx = 0, dy = 0, sc = 1, rot = 0, blur = 0;
    for (const ca of [st.charIn, st.charOut]) {
      if (!ca) continue;
      const o = charAnim(ca.type, stag(ca.p, order(it, k, ca.type)), size, frameSeed, k);
      a *= o.alpha; dx += o.dx; dy += o.dy; sc *= o.scale; rot += o.rot; blur = Math.max(blur, o.blur);
    }
    if (a <= 0.003 || sc <= 0.003) return;
    let fill = L.fill;
    if (lp) {
      if (lp.type === 'wave') dy += Math.sin(ph * Math.PI * 2 - k * 0.45) * size * 0.12 * amt;
      else if (lp.type === 'bounce') dy -= Math.abs(Math.sin(ph * Math.PI - k * 0.3)) * size * 0.18 * amt;
      else if (lp.type === 'rainbow') fill = hslHex((Math.round(((k * 25 + ph * 360) % 360) / 10) * 10) % 360, 85, 60);
    }
    const cv = cachedText({ ...L, fill }, it.ch);
    ctx.save();
    ctx.translate(cx + dx, cy + dy);
    if (rot || arcRot) ctx.rotate(((rot + arcRot) * Math.PI) / 180);
    if (sc !== 1) ctx.scale(sc, sc);
    ctx.globalAlpha *= Math.min(1, a);
    if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
    ctx.drawImage(cv, -cv.width / 2, -cv.height / 2);
    ctx.restore();
  });
}
function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0');
  return '#' + f(0) + f(8) + f(4);
}
function countdownText(L, t, fps) {
  const left = Math.max(0, Math.ceil((L.countFrom ?? 10) - t / fps - 1e-6));
  if (L.countFormat === 'mm:ss') return String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
  return String(left);
}

function rgba(hex, a) {
  const n = parseInt(String(hex || '#ffffff').slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function textData(L) {
  return {
    text: L.text, font: L.font, size: L.size, bold: L.bold, italic: L.italic, align: L.align, color: L.fill,
    strokeWidth: L.strokeWidth, strokeColor: L.stroke, shadow: L.shadow, shadowColor: L.shadowColor, shadowBlur: L.shadowBlur, shadowDist: L.shadowDist,
    bgEnabled: false, lineHeight: L.lineHeight || 1.15, tracking: L.tracking || 0,
    gradient: L.gradient?.on ? L.gradient : null, strokes: L.strokes?.length ? L.strokes : null,
    glow: L.glow?.on ? L.glow : null, extrude: L.extrude?.on ? L.extrude : null,
  };
}

const svgCache = new Map();
const textCache = new Map();
function cachedText(L, text) {
  const td = { ...textData(L), text };
  const key = JSON.stringify(td);
  let c = textCache.get(key);
  if (!c) {
    if (textCache.size > 400) textCache.clear();
    c = renderTextCanvas(td);
    textCache.set(key, c);
  }
  return c;
}

// Grafiği verilen canvas'a çizer (W×H = sekans boyutu). Animasyon dışında sonuç değişmiyorsa çağıran önbellekleyebilir.
export function renderGraphic(canvas, graphic, local, duration, W, H, fps = 30) {
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  for (const L of graphic.layers || []) {
    if (L.hidden) continue;
    const s = layerState(L, local, duration, W, H, fps);
    if (!s.visible || s.alpha <= 0.001 || s.scale <= 0.001) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, s.alpha * (L.opacity ?? 100) / 100));
    ctx.translate(L.x + s.dx, L.y + s.dy);
    ctx.rotate((((L.rotation || 0) + s.rot) * Math.PI) / 180);
    ctx.scale(s.scale, s.scale);
    let w = L.w, h = L.h;
    const lt = local - (L.delay || 0);
    const isText = L.type === 'text' || L.type === 'countdown';
    const content = L.type === 'countdown' ? countdownText(L, lt, fps) : L.text;
    const LS = s.glowK && s.glowK !== 1 && L.glow?.on ? { ...L, glow: { ...L.glow, intensity: (L.glow.intensity ?? 100) * s.glowK } } : L;
    if (isText && (s.charIn || s.charOut || L.curve || (L.loop && CHAR_LOOPS.has(L.loop.type)))) {
      drawCharText(ctx, LS, content, s, lt, fps);
    } else if (L.type === 'progress') {
      const total = Math.max(1, duration - (L.delay || 0));
      const pr = Math.max(0, Math.min(1, lt / total));
      const rr = Math.min(L.radius || 0, Math.abs(h) / 2);
      const shape = (x0, ww) => { ctx.beginPath(); if (rr > 0 && ctx.roundRect) ctx.roundRect(x0, -h / 2, ww, h, rr); else ctx.rect(x0, -h / 2, ww, h); };
      if ((L.trackOpacity ?? 30) > 0) { shape(-w / 2, w); ctx.fillStyle = rgba(L.stroke, (L.trackOpacity ?? 30) / 100); ctx.fill(); }
      if (pr > 0) { shape(-w / 2, w * pr); ctx.fillStyle = rgba(L.fill, (L.fillOpacity ?? 100) / 100); ctx.fill(); }
    } else if (isText) {
      // hizalama noktası: sol = sol kenar, sağ = sağ kenar, orta = merkez
      const full = String(content ?? '');
      const txt = s.chars < 1 ? full.slice(0, Math.floor(full.length * s.chars)) : full;
      const cv = cachedText(LS, txt || ' ');
      const ref = s.chars < 1 ? cachedText(LS, full || ' ') : cv;
      w = ref.width; h = ref.height;
      const left = L.align === 'left' ? 0 : L.align === 'right' ? -w : -w / 2;
      if (s.reveal < 1) { ctx.beginPath(); ctx.rect(left, -h / 2, w * s.reveal, h); ctx.clip(); }
      const dx = L.align === 'right' ? -cv.width : left;
      ctx.drawImage(cv, dx, -cv.height / 2);
    } else {
      if (s.reveal < 1) { ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w * s.reveal, h); ctx.clip(); }
      if (L.shadow) {
        ctx.shadowColor = L.shadowColor; ctx.shadowBlur = L.shadowBlur; ctx.shadowOffsetX = L.shadowDist; ctx.shadowOffsetY = L.shadowDist;
      }
      if (L.type === 'svg') {
        // vektör çıkartma: 24×24 SVG yolu katman kutusuna ölçeklenir
        let p2 = svgCache.get(L.path);
        if (!p2) { try { p2 = new Path2D(L.path || ''); } catch (e) { p2 = new Path2D(); } svgCache.set(L.path, p2); }
        ctx.scale(w / 24, h / 24);
        ctx.translate(-12, -12);
        const rule = L.evenodd ? 'evenodd' : 'nonzero';
        if ((L.fillOpacity ?? 100) > 0) { ctx.fillStyle = rgba(L.fill, (L.fillOpacity ?? 100) / 100); ctx.fill(p2, rule); }
        ctx.shadowColor = 'transparent';
        if (L.strokeWidth > 0) { ctx.strokeStyle = L.stroke; ctx.lineJoin = 'round'; ctx.lineWidth = (L.strokeWidth * 24) / Math.max(1, Math.max(Math.abs(w), Math.abs(h))); ctx.stroke(p2); }
        ctx.restore();
        continue;
      }
      ctx.beginPath();
      if (L.type === 'ellipse') ctx.ellipse(0, 0, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
      else if (L.type === 'rect' && L.radius > 0 && ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(L.radius, Math.abs(w) / 2, Math.abs(h) / 2));
      else ctx.rect(-w / 2, -h / 2, w, h);
      if ((L.fillOpacity ?? 100) > 0) { ctx.fillStyle = rgba(L.fill, (L.fillOpacity ?? 100) / 100); ctx.fill(); }
      ctx.shadowColor = 'transparent';
      if (L.strokeWidth > 0) { ctx.strokeStyle = L.stroke; ctx.lineWidth = L.strokeWidth; ctx.stroke(); }
    }
    ctx.restore();
  }
}

// Bu karede herhangi bir katman animasyonda mı? (değilse önceki çizim yeniden kullanılabilir)
export function graphicAnimating(graphic, local, duration) {
  for (const L of graphic.layers || []) {
    if ((L.loop && L.loop.type && L.loop.type !== 'none') || L.type === 'progress' || L.type === 'countdown') return true;
    const t = local - (L.delay || 0);
    if (t < 0 && t > -2) return true;
    if (t >= 0 && L.animIn && L.animIn.type !== 'none' && t < (L.animIn.dur || 1) + 1) return true;
    if (L.animOut && L.animOut.type !== 'none' && duration - local < (L.animOut.dur || 1) + 1) return true;
  }
  return false;
}

// Katmanın (döndürülmemiş) sınır kutusu, grafik koordinatlarında: { x, y, w, h }
let boundsCtx = null;
export function layerBounds(L) {
  if (L.type === 'text' || L.type === 'countdown') {
    const size = Math.max(1, L.size || 40);
    if (!boundsCtx) boundsCtx = document.createElement('canvas').getContext('2d');
    boundsCtx.font = `${L.italic ? 'italic ' : ''}${L.bold ? '700 ' : '400 '}${size}px "${L.font}", "Segoe UI", sans-serif`;
    if ('letterSpacing' in boundsCtx) boundsCtx.letterSpacing = (L.tracking || 0) + 'px';
    const lines = String((L.type === 'countdown' ? '00' : L.text) ?? '').split('\n');
    const w = Math.max(1, ...lines.map((l) => boundsCtx.measureText(l || ' ').width));
    const h = size * (L.lineHeight || 1.15) * lines.length;
    const x = L.align === 'left' ? L.x : L.align === 'right' ? L.x - w : L.x - w / 2;
    return { x, y: L.y - h / 2, w, h };
  }
  return { x: L.x - Math.abs(L.w) / 2, y: L.y - Math.abs(L.h) / 2, w: Math.abs(L.w), h: Math.abs(L.h) };
}

// Katmanı kareye hizala: mode = left | hcenter | right | top | vcenter | bottom
export function alignLayer(L, mode, W, H) {
  const b = layerBounds(L);
  if (mode === 'left') L.x += -b.x;
  else if (mode === 'hcenter') L.x += W / 2 - (b.x + b.w / 2);
  else if (mode === 'right') L.x += W - (b.x + b.w);
  else if (mode === 'top') L.y += -b.y;
  else if (mode === 'vcenter') L.y += H / 2 - (b.y + b.h / 2);
  else if (mode === 'bottom') L.y += H - (b.y + b.h);
  L.x = Math.round(L.x * 10) / 10; L.y = Math.round(L.y * 10) / 10;
  return L;
}

// ---- Yazı stilleri ----
// Değerler 100 px yazı boyutuna göredir; uygulanırken katmanın boyutuna ölçeklenir.
const NOFX = { gradient: null, strokes: [], glow: null, extrude: null, curve: 0, shadow: false, strokeWidth: 0 };
export const TEXT_STYLES = [
  { id: 'neonPink', name: 'Neon Pink', p: { fill: '#ff6fe0', glow: { on: true, color: '#ff1fd0', size: 28, intensity: 220, core: 70 } } },
  { id: 'neonBlue', name: 'Neon Blue', p: { fill: '#6ff2ff', glow: { on: true, color: '#00b8ff', size: 28, intensity: 220, core: 70 } } },
  { id: 'neonGreen', name: 'Neon Green', p: { fill: '#9cff8a', glow: { on: true, color: '#2cff3a', size: 26, intensity: 200, core: 65 } } },
  { id: 'neonPurple', name: 'Neon Purple', p: { fill: '#e6c8ff', glow: { on: true, color: '#9b4dff', size: 34, intensity: 180, core: 60 } } },
  { id: 'neonSign', name: 'Neon Sign', p: { fill: '#ffe27a', strokeWidth: 2, stroke: '#ff7a00', glow: { on: true, color: '#ff8a00', size: 30, intensity: 200, core: 75 }, loop: { type: 'glowPulse', speed: 0.8, amount: 60 } } },
  { id: 'fire', name: 'Fire', p: { gradient: { on: true, c1: '#fff6a8', c2: '#ff8a00', c3: '#c81400', angle: 90 }, strokeWidth: 1.5, stroke: '#6a0a00', glow: { on: true, color: '#ff4a00', size: 24, intensity: 140, core: 0 } } },
  { id: 'gold', name: 'Gold', p: { gradient: { on: true, c1: '#fff3b8', c2: '#d9a521', c3: '#7a5200', angle: 90 }, strokeWidth: 2.5, stroke: '#4d3200', extrude: { on: true, depth: 7, angle: 120, color: '#5a3a00', shade: 50 }, shadow: true, shadowColor: '#000000', shadowBlur: 14, shadowDist: 5 } },
  { id: 'chrome', name: 'Chrome', p: { gradient: { on: true, c1: '#ffffff', c2: '#8e98a3', c3: '#2f353b', angle: 90 }, strokeWidth: 2, stroke: '#e6ebf0', strokes: [{ color: '#15181b', width: 3 }], shadow: true, shadowColor: '#000000', shadowBlur: 12, shadowDist: 4 } },
  { id: 'ice', name: 'Ice', p: { gradient: { on: true, c1: '#ffffff', c2: '#aee9ff', c3: '#3a9be0', angle: 90 }, strokeWidth: 1.5, stroke: '#ffffff', glow: { on: true, color: '#7fd6ff', size: 18, intensity: 100, core: 0 } } },
  { id: 'retro80s', name: 'Retro 80s', p: { gradient: { on: true, c1: '#fff07a', c2: '#ff5fa2', c3: '#7a2cff', angle: 90 }, strokes: [{ color: '#ffffff', width: 3 }, { color: '#2a0a5e', width: 5 }], extrude: { on: true, depth: 9, angle: 110, color: '#2a0a5e', shade: 30 }, italic: true } },
  { id: 'comic', name: 'Comic', p: { fill: '#ffd23f', strokeWidth: 5, stroke: '#111111', strokes: [{ color: '#ffffff', width: 4 }], extrude: { on: true, depth: 9, angle: 45, color: '#111111', shade: 0 }, font: 'Arial Black' } },
  { id: 'youtube', name: 'Bold Thumbnail', p: { fill: '#ffffff', strokeWidth: 7, stroke: '#000000', extrude: { on: true, depth: 10, angle: 60, color: '#000000', shade: 0 }, font: 'Arial Black' } },
  { id: 'block3d', name: '3D Block', p: { fill: '#ff4a4a', extrude: { on: true, depth: 16, angle: 135, color: '#8a0d0d', shade: 60 }, font: 'Arial Black' } },
  { id: 'doubleOutline', name: 'Double Outline', p: { fill: '#ffffff', strokeWidth: 3.5, stroke: '#ff2d55', strokes: [{ color: '#ffffff', width: 3.5 }, { color: '#ff2d55', width: 3.5 }] } },
  { id: 'sunset', name: 'Sunset Gradient', p: { gradient: { on: true, c1: '#ffcf5a', c2: '#ff6a3d', c3: '#c2185b', angle: 0 }, shadow: true, shadowColor: '#000000', shadowBlur: 16, shadowDist: 4 } },
  { id: 'ocean', name: 'Ocean Gradient', p: { gradient: { on: true, c1: '#7cf7e4', c2: '#2aa7ff', c3: '#3d3bd6', angle: 0 }, strokeWidth: 2, stroke: '#ffffff' } },
  { id: 'glitchRgb', name: 'Glitch RGB', p: { fill: '#ffffff', shadow: true, shadowColor: '#00e5ff', shadowBlur: 0, shadowDist: 5, strokeWidth: 0, loop: { type: 'shake', speed: 1, amount: 20 } } },
  { id: 'elegant', name: 'Elegant', p: { fill: '#ffffff', font: 'Georgia', italic: true, bold: false, shadow: true, shadowColor: '#000000', shadowBlur: 24, shadowDist: 0 } },
  { id: 'arcTitle', name: 'Arc Title', p: { fill: '#ffffff', strokeWidth: 3, stroke: '#1b1b1b', curve: 35, font: 'Arial Black' } },
  { id: 'plain', name: 'Plain', p: { fill: '#ffffff', font: 'Segoe UI', bold: true, italic: false } },
];

// Stili bir metin katmanına uygula (önceki stil etkileri temizlenir)
export function applyTextStyle(L, id) {
  const st = TEXT_STYLES.find((x) => x.id === id);
  if (!st) return L;
  const k = (L.size || 100) / 100;
  const sc = (v) => Math.round(v * k * 10) / 10;
  const p = structuredClone(st.p);
  Object.assign(L, structuredClone(NOFX), { font: 'Segoe UI', bold: true, italic: false, loop: L.loop?.type && !p.loop ? L.loop : null }, p);
  if (p.strokeWidth) L.strokeWidth = sc(p.strokeWidth);
  if (L.strokes) L.strokes = L.strokes.map((x) => ({ ...x, width: sc(x.width) }));
  if (L.glow) L.glow.size = sc(L.glow.size);
  if (L.extrude) L.extrude.depth = Math.max(1, Math.round(L.extrude.depth * k));
  if (p.shadow) { L.shadowBlur = sc(p.shadowBlur || 0); L.shadowDist = sc(p.shadowDist || 0); }
  L.styleId = id;
  return L;
}

// ---- Şablonlar ----
export const TEMPLATES = [
  { id: 'lowerThird', name: 'Lower Third' },
  { id: 'lowerThirdBox', name: 'Lower Third (Box)' },
  { id: 'title', name: 'Title' },
  { id: 'subscribe', name: 'Subscribe Button' },
  { id: 'socialTag', name: 'Social Tag' },
  { id: 'quote', name: 'Quote' },
  { id: 'chapter', name: 'Chapter Title' },
  { id: 'endCard', name: 'End Card' },
  { id: 'kineticTitle', name: 'Kinetic Title' },
  { id: 'wordByWord', name: 'Word by Word' },
  { id: 'neonSign', name: 'Neon Sign' },
  { id: 'bounceText', name: 'Bouncy Text' },
  { id: 'glitchTitle', name: 'Glitch Title' },
  { id: 'rainbowText', name: 'Rainbow Text' },
  { id: 'countdown', name: 'Countdown' },
  { id: 'progressBar', name: 'Progress Bar' },
  { id: 'emojiLaugh', name: 'Emoji: Laugh' },
  { id: 'heartLike', name: 'Like Heart' },
  { id: 'neonTitle', name: 'Neon Title' },
  { id: 'fireTitle', name: 'Fire Title' },
  { id: 'goldTitle', name: 'Gold Title' },
  { id: 'retroTitle', name: 'Retro 80s Title' },
  { id: 'arcText', name: 'Curved Text' },
  { id: 'videoInText', name: 'Video Inside Text', blend: 'stencilAlpha' },
];

export function makeTemplate(id, W, H) {
  const k = H / 1080;
  // şablonlar kalın başlık olarak tasarlandı (yeni boş metin katmanı ise normal kalınlıkta)
  const L = (type, o) => newLayer(type, W, H, type === 'text' ? { bold: true, ...o } : o);
  switch (id) {
    case 'lowerThird': return { layers: [
      L('rect', { name: 'Bar', x: 140 * k + 6 * k, y: H - 210 * k, w: 12 * k, h: 120 * k, fill: '#2d8ceb', animIn: { type: 'wipe', dur: 10 }, animOut: { type: 'fade', dur: 10 } }),
      L('text', { name: 'Name', text: 'Ad Soyad', align: 'left', x: 180 * k, y: H - 238 * k, size: 64 * k, shadow: true, animIn: { type: 'slideRight', dur: 15 }, delay: 4 }),
      L('text', { name: 'Title', text: 'Unvan / Açıklama', align: 'left', bold: false, x: 180 * k, y: H - 178 * k, size: 40 * k, fill: '#dddddd', shadow: true, animIn: { type: 'slideRight', dur: 15 }, delay: 8 }),
    ] };
    case 'lowerThirdBox': return { layers: [
      L('rect', { name: 'Box', x: 120 * k + 330 * k, y: H - 200 * k, w: 660 * k, h: 150 * k, fill: '#111111', fillOpacity: 80, radius: 10 * k, animIn: { type: 'wipe', dur: 12 }, animOut: { type: 'wipe', dur: 10 } }),
      L('rect', { name: 'Accent', x: 120 * k + 4 * k, y: H - 200 * k, w: 8 * k, h: 150 * k, fill: '#e3a42c', animIn: { type: 'fade', dur: 8 } }),
      L('text', { name: 'Name', text: 'Ad Soyad', align: 'left', x: 150 * k, y: H - 225 * k, size: 58 * k, animIn: { type: 'fade', dur: 12 }, delay: 6 }),
      L('text', { name: 'Title', text: 'Unvan', align: 'left', bold: false, x: 150 * k, y: H - 170 * k, size: 38 * k, fill: '#e3a42c', animIn: { type: 'fade', dur: 12 }, delay: 10 }),
    ] };
    case 'title': return { layers: [
      L('text', { name: 'Title', text: 'BAŞLIK', y: H / 2 - 30 * k, size: 140 * k, tracking: 8 * k, shadow: true, animIn: { type: 'scale', dur: 20 }, animOut: { type: 'fade', dur: 15 } }),
      L('line', { name: 'Line', y: H / 2 + 60 * k, w: 520 * k, h: 4 * k, fill: '#2d8ceb', animIn: { type: 'wipe', dur: 18 }, delay: 8 }),
      L('text', { name: 'Subtitle', text: 'Alt başlık', y: H / 2 + 120 * k, size: 48 * k, bold: false, fill: '#cccccc', animIn: { type: 'slideUp', dur: 18 }, delay: 12 }),
    ] };
    case 'subscribe': return { layers: [
      L('rect', { name: 'Button', x: W - 330 * k, y: H - 150 * k, w: 380 * k, h: 100 * k, radius: 50 * k, fill: '#e62117', shadow: true, animIn: { type: 'pop', dur: 14 }, animOut: { type: 'scale', dur: 10 } }),
      L('text', { name: 'Label', text: 'ABONE OL', x: W - 300 * k, y: H - 150 * k, size: 48 * k, animIn: { type: 'pop', dur: 14 }, delay: 3 }),
      L('ellipse', { name: 'Icon', x: W - 470 * k, y: H - 150 * k, w: 56 * k, h: 56 * k, fill: '#ffffff', animIn: { type: 'pop', dur: 14 }, delay: 2 }),
    ] };
    case 'socialTag': return { layers: [
      L('rect', { name: 'Pill', x: 340 * k, y: 120 * k, w: 520 * k, h: 90 * k, radius: 45 * k, fill: '#ffffff', fillOpacity: 92, animIn: { type: 'slideDown', dur: 15 } }),
      L('text', { name: 'Handle', text: '@kullaniciadi', x: 340 * k, y: 120 * k, size: 46 * k, fill: '#111111', animIn: { type: 'fade', dur: 12 }, delay: 6 }),
    ] };
    case 'quote': return { layers: [
      L('rect', { name: 'Background', w: W * 0.7, h: H * 0.38, fill: '#000000', fillOpacity: 60, radius: 16 * k, animIn: { type: 'fade', dur: 15 } }),
      L('text', { name: 'Quote', text: '“Buraya alıntı metni gelecek.”', y: H / 2 - 30 * k, size: 64 * k, italic: true, bold: false, animIn: { type: 'typewriter', dur: 45 }, delay: 6 }),
      L('text', { name: 'Author', text: '— Yazar', y: H / 2 + 90 * k, size: 40 * k, bold: false, fill: '#bbbbbb', animIn: { type: 'fade', dur: 15 }, delay: 40 }),
    ] };
    case 'chapter': return { layers: [
      L('text', { name: 'Number', text: '01', align: 'left', x: 160 * k, y: H / 2 - 50 * k, size: 160 * k, fill: '#2d8ceb', animIn: { type: 'slideRight', dur: 18 } }),
      L('text', { name: 'Chapter', text: 'Bölüm Başlığı', align: 'left', x: 160 * k, y: H / 2 + 80 * k, size: 70 * k, animIn: { type: 'slideRight', dur: 18 }, delay: 6 }),
    ] };
    case 'endCard': return { layers: [
      L('rect', { name: 'Background', w: W, h: H, fill: '#0e141e', animIn: { type: 'fade', dur: 15 } }),
      L('text', { name: 'Thanks', text: 'İzlediğiniz için teşekkürler!', y: H * 0.22, size: 72 * k, animIn: { type: 'slideDown', dur: 18 }, delay: 6 }),
      L('rect', { name: 'Video 1', x: W * 0.3, y: H * 0.58, w: W * 0.32, h: W * 0.18, radius: 12 * k, fill: '#ffffff', fillOpacity: 15, stroke: '#ffffff', strokeWidth: 3 * k, animIn: { type: 'pop', dur: 15 }, delay: 12 }),
      L('rect', { name: 'Video 2', x: W * 0.7, y: H * 0.58, w: W * 0.32, h: W * 0.18, radius: 12 * k, fill: '#ffffff', fillOpacity: 15, stroke: '#ffffff', strokeWidth: 3 * k, animIn: { type: 'pop', dur: 15 }, delay: 16 }),
    ] };
    case 'kineticTitle': return { layers: [
      L('text', { name: 'Title', text: 'HAREKETLİ BAŞLIK', y: H / 2 - 20 * k, size: 130 * k, tracking: 6 * k, shadow: true, animIn: { type: 'charRise', dur: 30 }, animOut: { type: 'charFade', dur: 18 } }),
      L('text', { name: 'Subtitle', text: 'alt başlık buraya', y: H / 2 + 100 * k, size: 46 * k, bold: false, fill: '#cfd8ff', animIn: { type: 'charBlur', dur: 24 }, animOut: { type: 'fade', dur: 12 }, delay: 18 }),
    ] };
    case 'wordByWord': return { layers: [
      L('text', { name: 'Caption', text: 'Her kelime sırayla belirir', y: H * 0.8, size: 80 * k, shadow: true, strokeWidth: 4 * k, stroke: '#000000', animIn: { type: 'wordPop', dur: 30 }, animOut: { type: 'fade', dur: 10 } }),
    ] };
    case 'neonSign': return { layers: [
      L('text', { name: 'Neon', text: 'NEON', y: H / 2, size: 200 * k, fill: '#ff4fd8', shadow: true, shadowColor: '#ff4fd8', shadowBlur: 40 * k, shadowDist: 0, tracking: 10 * k, animIn: { type: 'glitchIn', dur: 20 }, loop: { type: 'flicker', speed: 1, amount: 60 } }),
    ] };
    case 'bounceText': return { layers: [
      L('text', { name: 'Bouncy', text: 'Zıplayan Yazı!', y: H / 2, size: 120 * k, fill: '#ffd23f', stroke: '#1b1b1b', strokeWidth: 6 * k, animIn: { type: 'charDrop', dur: 30 }, loop: { type: 'bounce', speed: 1.2, amount: 60 } }),
    ] };
    case 'glitchTitle': return { layers: [
      L('text', { name: 'Glitch', text: 'GLITCH', y: H / 2, size: 180 * k, tracking: 12 * k, shadow: true, shadowColor: '#00e5ff', shadowBlur: 0, shadowDist: 6 * k, animIn: { type: 'glitchIn', dur: 24 }, animOut: { type: 'glitchIn', dur: 16 }, loop: { type: 'shake', speed: 1, amount: 25 } }),
    ] };
    case 'rainbowText': return { layers: [
      L('text', { name: 'Rainbow', text: 'Gökkuşağı', y: H / 2, size: 140 * k, stroke: '#ffffff', strokeWidth: 3 * k, animIn: { type: 'charPop', dur: 24 }, loop: { type: 'rainbow', speed: 0.5, amount: 100 } }),
    ] };
    case 'countdown': return { layers: [
      L('ellipse', { name: 'Circle', w: 300 * k, h: 300 * k, fill: '#000000', fillOpacity: 55, stroke: '#ffffff', strokeWidth: 8 * k, animIn: { type: 'pop', dur: 12 }, loop: { type: 'pulse', speed: 1, amount: 60 } }),
      L('countdown', { name: 'Countdown', size: 150 * k, countFrom: 10, animIn: { type: 'pop', dur: 12 } }),
    ] };
    case 'progressBar': return { layers: [
      L('progress', { name: 'Progress Bar' }),
    ] };
    case 'emojiLaugh': return { layers: [
      L('text', { name: 'Emoji', text: '😂', font: 'Segoe UI Emoji', x: W * 0.8, y: H * 0.3, size: 220 * k, bold: false, animIn: { type: 'pop', dur: 14 }, animOut: { type: 'scale', dur: 10 }, loop: { type: 'swing', speed: 1.5, amount: 100 } }),
    ] };
    case 'heartLike': return { layers: [
      L('text', { name: 'Heart', text: '❤️', font: 'Segoe UI Emoji', x: W * 0.82, y: H * 0.72, size: 200 * k, bold: false, animIn: { type: 'pop', dur: 14 }, animOut: { type: 'fade', dur: 10 }, loop: { type: 'pulse', speed: 2, amount: 100 } }),
      L('text', { name: 'Label', text: 'BEĞEN', x: W * 0.82, y: H * 0.72 + 150 * k, size: 52 * k, shadow: true, animIn: { type: 'charRise', dur: 16 }, delay: 8 }),
    ] };
    case 'neonTitle': return { layers: [applyTextStyle(L('text', { name: 'Neon', text: 'NEON', y: H / 2, size: 190 * k, animIn: { type: 'glitchIn', dur: 18 } }), 'neonSign')] };
    case 'fireTitle': return { layers: [applyTextStyle(L('text', { name: 'Fire', text: 'ATEŞ', y: H / 2, size: 200 * k, animIn: { type: 'charRise', dur: 22 } }), 'fire')] };
    case 'goldTitle': return { layers: [applyTextStyle(L('text', { name: 'Gold', text: 'ALTIN', y: H / 2, size: 190 * k, animIn: { type: 'charPop', dur: 22 } }), 'gold')] };
    case 'retroTitle': return { layers: [applyTextStyle(L('text', { name: 'Retro', text: 'RETRO', y: H / 2, size: 200 * k, animIn: { type: 'charDrop', dur: 26 } }), 'retro80s')] };
    case 'arcText': return { layers: [applyTextStyle(L('text', { name: 'Arc', text: 'EĞRİ ÜSTÜNDE YAZI', y: H / 2, size: 110 * k, animIn: { type: 'charFade', dur: 20 } }), 'arcTitle')] };
    case 'videoInText': return { layers: [L('text', { name: 'Video Text', text: 'VİDEO', y: H / 2, size: 380 * k, font: 'Arial Black', tracking: 10 * k, animIn: { type: 'scale', dur: 20 } })] };
    default: return { layers: [L('text', {})] };
  }
}
