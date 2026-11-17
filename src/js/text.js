// Metin klipleri ve grafik metin katmanları için 2D canvas çizimi
// Desteklenen biçimler: dolgu (düz renk veya renk geçişi), ana kontur + ek konturlar, gölge,
// neon parlama (renkli ışıma + beyaz çekirdek), 3B derinlik (ekstrüzyon), arka plan kutusu.
import { hexToRgb } from './util.js';

export function textKey(t) {
  return JSON.stringify(t);
}

function rgbaStr(hex, a = 1) {
  const [r, g, b] = hexToRgb(hex || '#ffffff');
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}
function mixHex(a, b, k) {
  const A = hexToRgb(a || '#000000'), B = hexToRgb(b || '#ffffff');
  return `rgb(${A.map((v, i) => Math.round((v + (B[i] - v) * k) * 255)).join(',')})`;
}

// Metin bloğunun dış payı (kontur, gölge, parlama, derinlik)
function effectPad(t) {
  const strokes = (t.strokeWidth || 0) + (t.strokes || []).reduce((s, x) => s + (x.width || 0), 0);
  const shadowPad = t.shadow ? (t.shadowBlur || 0) * 2 + Math.abs(t.shadowDist || 0) : 0;
  const glowPad = t.glow && t.glow.on ? (t.glow.size || 0) * 2 : 0;
  const ex = t.extrude && t.extrude.on ? (t.extrude.depth || 0) : 0;
  return strokes + Math.max(shadowPad, glowPad) + ex;
}

export function renderTextCanvas(t) {
  const lines = String(t.text ?? '').split('\n');
  const font = `${t.italic ? 'italic ' : ''}${t.bold ? '700 ' : '400 '}${Math.max(1, t.size)}px "${t.font}", "Segoe UI", sans-serif`;
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = font;
  if ('letterSpacing' in meas) meas.letterSpacing = (t.tracking || 0) + 'px';
  const lh = t.size * (t.lineHeight || 1.15);
  let maxW = 1;
  const widths = lines.map((l) => {
    const w = meas.measureText(l || ' ').width;
    maxW = Math.max(maxW, w);
    return w;
  });
  const bgPad = t.bgEnabled ? (t.bgPadding || 0) : 0;
  const pad = Math.ceil(effectPad(t) + bgPad + 4);
  const W = Math.ceil(maxW + pad * 2);
  const H = Math.ceil(lh * lines.length + pad * 2);
  const cv = document.createElement('canvas');
  cv.width = Math.min(8192, W);
  cv.height = Math.min(8192, H);
  const ctx = cv.getContext('2d');
  ctx.font = font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = (t.tracking || 0) + 'px';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (t.bgEnabled) {
    ctx.fillStyle = rgbaStr(t.bgColor, (t.bgOpacity ?? 100) / 100);
    const x0 = pad - bgPad, y0 = pad - bgPad;
    const w = maxW + bgPad * 2, h = lh * lines.length + bgPad * 2;
    const rad = Math.min(bgPad, 16);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x0, y0, w, h, rad); else ctx.rect(x0, y0, w, h);
    ctx.fill();
  }
  // dolgu: düz renk veya bloğa yayılan renk geçişi
  let fillStyle = t.color || '#fff';
  const gr = t.gradient;
  if (gr && gr.on) {
    const a = ((gr.angle ?? 90) * Math.PI) / 180;
    const cx = pad + maxW / 2, cy = pad + (lh * lines.length) / 2;
    const half = Math.abs(Math.cos(a)) * maxW / 2 + Math.abs(Math.sin(a)) * (lh * lines.length) / 2;
    const g = ctx.createLinearGradient(cx - Math.cos(a) * half, cy - Math.sin(a) * half, cx + Math.cos(a) * half, cy + Math.sin(a) * half);
    const stops = [gr.c1 || '#ffffff', ...(gr.c3 ? [gr.c2 || '#888888', gr.c3] : [gr.c2 || '#888888'])];
    stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
    fillStyle = g;
  }
  const glow = t.glow && t.glow.on ? t.glow : null;
  if (glow && !(gr && gr.on)) fillStyle = mixHex(t.color || '#ffffff', '#ffffff', (glow.core ?? 50) / 100);
  // konturlar: ana kontur en içte, ek konturlar dışa doğru
  const rings = [];
  let acc = 0;
  if ((t.strokeWidth || 0) > 0) { acc += t.strokeWidth; rings.push({ color: t.strokeColor || '#000', w: acc }); }
  for (const s of t.strokes || []) { if ((s.width || 0) <= 0) continue; acc += s.width; rings.push({ color: s.color || '#000', w: acc }); }
  const ex = t.extrude && t.extrude.on && (t.extrude.depth || 0) > 0 ? t.extrude : null;
  const xFor = (w) => (t.align === 'left' ? pad : t.align === 'right' ? pad + maxW - w : pad + (maxW - w) / 2);

  // vurgu aralığı (tüm metindeki karakter konumu) → satır içi aralık
  const hlRanges = {};
  if (t.hl && t.hl.to > t.hl.from) {
    let off = 0;
    lines.forEach((l, i) => { const a = Math.max(t.hl.from, off), b = Math.min(t.hl.to, off + l.length); if (b > a) hlRanges[i] = [a - off, b - off]; off += l.length + 1; });
  }
  lines.forEach((line, i) => {
    const y = pad + lh * i + lh / 2;
    const x = xFor(widths[i]);
    const outer = rings.length ? rings[rings.length - 1] : null;
    // gölgeyi ilk boyanan katmana uygula
    let shadowPending = !!t.shadow;
    const applyShadow = () => {
      if (!shadowPending) return;
      ctx.shadowColor = t.shadowColor || '#000';
      ctx.shadowBlur = t.shadowBlur || 0;
      ctx.shadowOffsetX = t.shadowDist || 0;
      ctx.shadowOffsetY = t.shadowDist || 0;
      shadowPending = false;
    };
    const noShadow = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };
    ctx.save();
    // 1) neon parlama (arkada, çok katmanlı)
    if (glow) {
      const passes = [1, 0.55, 0.25];
      const inten = Math.max(0, glow.intensity ?? 100) / 100;
      ctx.fillStyle = glow.color || t.color || '#fff';
      for (let k = 0; k < passes.length; k++) {
        let rep = inten;
        while (rep > 0.001) {
          ctx.globalAlpha = Math.min(1, rep);
          ctx.shadowColor = glow.color || t.color || '#fff';
          ctx.shadowBlur = Math.max(0.5, (glow.size || 20) * passes[k]);
          ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
          if (outer) { ctx.strokeStyle = glow.color || '#fff'; ctx.lineWidth = outer.w * 2; ctx.strokeText(line, x, y); }
          ctx.fillText(line, x, y);
          rep -= 1;
        }
      }
      ctx.globalAlpha = 1;
      noShadow();
    }
    // 2) 3B derinlik: arkaya doğru katmanlar
    if (ex) {
      const a = ((ex.angle ?? 135) * Math.PI) / 180;
      const dx = Math.cos(a), dy = Math.sin(a);
      const depth = Math.round(ex.depth);
      for (let d = depth; d >= 1; d--) {
        if (d === depth) applyShadow(); else noShadow();
        ctx.fillStyle = mixHex(ex.color || '#333333', '#000000', ((ex.shade ?? 40) / 100) * (d / depth));
        ctx.strokeStyle = ctx.fillStyle;
        if (outer) { ctx.lineWidth = outer.w * 2; ctx.strokeText(line, x + dx * d, y + dy * d); }
        ctx.fillText(line, x + dx * d, y + dy * d);
      }
      noShadow();
    }
    // 3) konturlar (dıştan içe)
    for (let r = rings.length - 1; r >= 0; r--) {
      applyShadow();
      ctx.strokeStyle = rings[r].color;
      ctx.lineWidth = rings[r].w * 2;
      ctx.strokeText(line, x, y);
      noShadow();
    }
    // 4) dolgu
    const hl = hlRanges[i];
    if (hl && t.hl.box) {
      // etkin kelimenin arkasına renkli kutu (CapCut tarzı)
      const bx = x + ctx.measureText(line.slice(0, hl[0])).width, bw = ctx.measureText(line.slice(hl[0], hl[1])).width;
      const px = t.size * 0.14;
      noShadow();
      ctx.fillStyle = t.hl.box;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx - px, y - lh * 0.46, bw + px * 2, lh * 0.92, t.size * 0.16); else ctx.rect(bx - px, y - lh * 0.46, bw + px * 2, lh * 0.92);
      ctx.fill();
    }
    applyShadow();
    ctx.fillStyle = fillStyle;
    ctx.fillText(line, x, y);
    if (hl && t.hl.color) {
      // etkin kelimeyi vurgu rengiyle yeniden boya
      noShadow();
      ctx.fillStyle = t.hl.color;
      ctx.fillText(line.slice(hl[0], hl[1]), x + ctx.measureText(line.slice(0, hl[0])).width, y);
    }
    ctx.restore();
  });
  return cv;
}
