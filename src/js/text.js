// Metin klipleri için 2D canvas çizimi
import { hexToRgb } from './util.js';

export function textKey(t) {
  return JSON.stringify(t);
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
  const stroke = t.strokeWidth || 0;
  const shadowPad = t.shadow ? (t.shadowBlur || 0) * 2 + Math.abs(t.shadowDist || 0) : 0;
  const bgPad = t.bgEnabled ? (t.bgPadding || 0) : 0;
  const pad = Math.ceil(stroke + shadowPad + bgPad + 4);
  const W = Math.ceil(maxW + pad * 2);
  const H = Math.ceil(lh * lines.length + pad * 2);
  const cv = document.createElement('canvas');
  cv.width = Math.min(8192, W);
  cv.height = Math.min(8192, H);
  const ctx = cv.getContext('2d');
  ctx.font = font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = (t.tracking || 0) + 'px';
  ctx.textBaseline = 'middle';
  if (t.bgEnabled) {
    const [r, g, b] = hexToRgb(t.bgColor);
    ctx.fillStyle = `rgba(${r * 255},${g * 255},${b * 255},${(t.bgOpacity ?? 100) / 100})`;
    const x0 = pad - bgPad, y0 = pad - bgPad;
    const w = maxW + bgPad * 2, h = lh * lines.length + bgPad * 2;
    const rad = Math.min(bgPad, 16);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x0, y0, w, h, rad); else ctx.rect(x0, y0, w, h);
    ctx.fill();
  }
  const xFor = (w) => (t.align === 'left' ? pad : t.align === 'right' ? pad + maxW - w : pad + (maxW - w) / 2);
  lines.forEach((line, i) => {
    const y = pad + lh * i + lh / 2;
    const x = xFor(widths[i]);
    ctx.save();
    if (t.shadow) {
      ctx.shadowColor = t.shadowColor || '#000';
      ctx.shadowBlur = t.shadowBlur || 0;
      ctx.shadowOffsetX = t.shadowDist || 0;
      ctx.shadowOffsetY = t.shadowDist || 0;
    }
    if (stroke > 0) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = t.strokeColor || '#000';
      ctx.lineWidth = stroke * 2;
      ctx.strokeText(line, x, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = t.color || '#fff';
    ctx.fillText(line, x, y);
    ctx.restore();
  });
  return cv;
}
