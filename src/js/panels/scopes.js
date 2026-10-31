// Lumetri Kapsamları: Waveform (RGB / Luma), RGB Parade, Vektörskop, Histogram
import { store } from '../store.js';
import { app } from '../appContext.js';
import { t } from '../i18n.js';
import { el } from '../util.js';

const MODES = [
  ['all', 'All Scopes'],
  ['waveRGB', 'Waveform (RGB)'],
  ['waveLuma', 'Waveform (Luma)'],
  ['parade', 'RGB Parade'],
  ['vector', 'Vectorscope YUV'],
  ['histogram', 'Histogram'],
];

// Rec.709 Y'CbCr
const toY = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const toCb = (r, g, b) => -0.1146 * r - 0.3854 * g + 0.5 * b;
const toCr = (r, g, b) => 0.5 * r - 0.4542 * g - 0.0458 * b;

export class ScopesPanel {
  constructor() {
    this.id = 'scopes';
    this.mode = localStorage.getItem('uli.scopeMode') || 'all';
    this.gain = +(localStorage.getItem('uli.scopeGain') || 1);
    this._last = 0;
    this._queued = false;
  }
  title() { return t('Lumetri Scopes'); }

  mount(body) {
    const tb = el('div', { class: 'toolbar' });
    this.sel = el('select');
    for (const [v, l] of MODES) this.sel.appendChild(el('option', { value: v, text: t(l) }));
    this.sel.value = this.mode;
    this.sel.addEventListener('change', () => { this.mode = this.sel.value; localStorage.setItem('uli.scopeMode', this.mode); this.update(true); });
    this.gainIn = el('input', { type: 'range', min: 0.25, max: 4, step: 0.05, title: t('Brightness'), style: { width: '90px' } });
    this.gainIn.value = this.gain;
    this.gainIn.addEventListener('input', () => { this.gain = +this.gainIn.value; localStorage.setItem('uli.scopeGain', this.gain); this.update(true); });
    tb.append(this.sel, el('span', { class: 'grow' }), el('span', { class: 'muted', text: t('Brightness') }), this.gainIn);
    this.wrap = el('div', { style: { flex: '1', position: 'relative', background: '#0b0b0b', minHeight: '0' } });
    this.cv = el('canvas', { style: { position: 'absolute', left: '0', top: '0' } });
    this.wrap.appendChild(this.cv);
    body.append(tb, this.wrap);
    app.engine.on('rendered', () => this._schedule());
    app.scopes = this;
  }

  get visible() { return this.group && this.group.active === this && this.body.isConnected; }

  onShow() { this.update(true); }
  onResize() { this.update(true); }

  _schedule() {
    if (!this.visible || this._queued) return;
    const now = performance.now();
    // oynatırken saniyede ~12 kez, duraklatılmışken her karede
    const wait = app.engine.playing ? Math.max(0, 80 - (now - this._last)) : 0;
    this._queued = true;
    setTimeout(() => requestAnimationFrame(() => { this._queued = false; this.update(); }), wait);
  }

  update(force = false) {
    if (!this.visible) return;
    this._last = performance.now();
    const dpr = window.devicePixelRatio || 1;
    const W = this.wrap.clientWidth, H = this.wrap.clientHeight;
    if (!W || !H) return;
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (this.cv.width !== cw || this.cv.height !== ch) {
      this.cv.width = cw; this.cv.height = ch;
      this.cv.style.width = W + 'px'; this.cv.style.height = H + 'px';
    }
    const ctx = this.cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, 0, cw, ch);
    const s = store.seq ? app.compositor.sampleResult(this.mode === 'all' ? 320 : 480) : null;
    const pad = Math.round(6 * dpr);
    const rects = [];
    if (this.mode === 'all') {
      const hw = Math.floor(cw / 2), hh = Math.floor(ch / 2);
      rects.push(['waveRGB', 0, 0, hw, hh], ['vector', hw, 0, cw - hw, hh], ['parade', 0, hh, hw, ch - hh], ['histogram', hw, hh, cw - hw, ch - hh]);
    } else rects.push([this.mode, 0, 0, cw, ch]);
    for (const [m, x, y, w, h] of rects) {
      const r = { x: x + pad, y: y + pad, w: w - pad * 2, h: h - pad * 2 };
      if (r.w < 20 || r.h < 20) continue;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      if (m === 'vector') this._vector(ctx, r, s, dpr);
      else if (m === 'histogram') this._histogram(ctx, r, s, dpr);
      else this._waveform(ctx, r, s, m, dpr);
      ctx.restore();
      if (this.mode === 'all') { ctx.strokeStyle = '#222'; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
    }
  }

  _label(ctx, text, x, y, dpr) {
    ctx.fillStyle = '#7a7a7a';
    ctx.font = `${Math.round(9 * dpr)}px Consolas, monospace`;
    ctx.fillText(text, x, y);
  }

  // Waveform: x = görüntü x, y = seviye (0-100 IRE)
  _waveform(ctx, r, s, mode, dpr) {
    const lblW = Math.round(22 * dpr);
    const gx = r.x + lblW, gw = r.w - lblW;
    const gh = r.h;
    // ızgara
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    for (let ire = 0; ire <= 100; ire += 10) {
      const yy = Math.round(r.y + gh - (ire / 100) * gh) + 0.5;
      ctx.globalAlpha = ire % 50 === 0 ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(gx, yy); ctx.lineTo(gx + gw, yy); ctx.stroke();
      if (ire % 20 === 0 || ire === 100) { ctx.globalAlpha = 1; this._label(ctx, String(ire), r.x, yy + 3 * dpr); }
    }
    ctx.globalAlpha = 1;
    this._label(ctx, t(mode === 'parade' ? 'RGB Parade' : mode === 'waveLuma' ? 'Waveform (Luma)' : 'Waveform (RGB)'), gx + 4, r.y + 10 * dpr);
    if (!s) return;
    const W = Math.max(8, Math.floor(gw)), H = Math.max(8, Math.floor(gh));
    const R = new Float32Array(W * H), G = new Float32Array(W * H), B = new Float32Array(W * H);
    const d = s.data, sw = s.w, sh = s.h;
    const parade = mode === 'parade';
    const luma = mode === 'waveLuma';
    const segW = parade ? Math.floor(W / 3) : W;
    for (let yy = 0; yy < sh; yy++) {
      for (let xx = 0; xx < sw; xx++) {
        const i = (yy * sw + xx) * 4;
        const rr = d[i], gg = d[i + 1], bb = d[i + 2];
        const col = Math.min(segW - 1, Math.floor((xx / sw) * segW));
        const row = (v) => H - 1 - Math.round((v / 255) * (H - 1));
        if (luma) {
          const yv = row(toY(rr, gg, bb));
          R[yv * W + col] += 1;
        } else if (parade) {
          R[row(rr) * W + col] += 1;
          G[row(gg) * W + col + segW] += 1;
          B[row(bb) * W + col + segW * 2] += 1;
        } else {
          R[row(rr) * W + col] += 1;
          G[row(gg) * W + col] += 1;
          B[row(bb) * W + col] += 1;
        }
      }
    }
    const perCol = (sh * sw) / segW;
    const k = ((this.gain * 70) / perCol) * (H / 100);
    const img = ctx.createImageData(W, H);
    const o = img.data;
    for (let i = 0; i < W * H; i++) {
      const vr = 1 - Math.exp(-R[i] * k), vg = 1 - Math.exp(-G[i] * k), vb = 1 - Math.exp(-B[i] * k);
      if (luma) { o[i * 4] = vr * 170; o[i * 4 + 1] = vr * 255; o[i * 4 + 2] = vr * 170; o[i * 4 + 3] = vr * 255; }
      else { o[i * 4] = vr * 255; o[i * 4 + 1] = vg * 255; o[i * 4 + 2] = vb * 255; o[i * 4 + 3] = Math.max(vr, vg, vb) * 255; }
    }
    const tmp = el('canvas', { width: W, height: H });
    tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(tmp, gx, r.y);
    ctx.globalCompositeOperation = 'source-over';
    if (parade) {
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      for (let i = 1; i < 3; i++) { const xx = Math.round(gx + segW * i) + 0.5; ctx.beginPath(); ctx.moveTo(xx, r.y); ctx.lineTo(xx, r.y + gh); ctx.stroke(); }
    }
  }

  _vector(ctx, r, s, dpr) {
    const size = Math.min(r.w, r.h);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const rad = size / 2 - 4 * dpr;
    // graticule
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, rad * 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - rad, cy); ctx.lineTo(cx + rad, cy); ctx.moveTo(cx, cy - rad); ctx.lineTo(cx, cy + rad); ctx.stroke();
    // ten rengi çizgisi (~123°)
    const sk = (123 * Math.PI) / 180;
    ctx.strokeStyle = 'rgba(230,170,120,0.45)';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sk) * rad, cy - Math.sin(sk) * rad); ctx.stroke();
    const scale = rad / 0.5;
    // %75 renk hedefleri
    const targets = [['R', [0.75, 0, 0]], ['Mg', [0.75, 0, 0.75]], ['B', [0, 0, 0.75]], ['Cy', [0, 0.75, 0.75]], ['G', [0, 0.75, 0]], ['Yl', [0.75, 0.75, 0]]];
    ctx.font = `${Math.round(9 * dpr)}px Consolas, monospace`;
    for (const [n, [rr, gg, bb]] of targets) {
      const x = cx + toCb(rr, gg, bb) * scale, y = cy - toCr(rr, gg, bb) * scale;
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.strokeRect(x - 4 * dpr, y - 4 * dpr, 8 * dpr, 8 * dpr);
      ctx.fillStyle = '#888';
      ctx.fillText(n, x + 6 * dpr, y + 3 * dpr);
    }
    this._label(ctx, t('Vectorscope YUV'), r.x + 4, r.y + 10 * dpr);
    if (!s) return;
    const N = Math.max(16, Math.floor(rad * 2));
    const acc = new Float32Array(N * N);
    const accR = new Float32Array(N * N), accG = new Float32Array(N * N), accB = new Float32Array(N * N);
    const d = s.data;
    for (let i = 0; i < s.w * s.h; i++) {
      const rr = d[i * 4] / 255, gg = d[i * 4 + 1] / 255, bb = d[i * 4 + 2] / 255;
      const x = Math.round((toCb(rr, gg, bb) / 0.5) * (N / 2) + N / 2);
      const y = Math.round(N / 2 - (toCr(rr, gg, bb) / 0.5) * (N / 2));
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const j = y * N + x;
      acc[j] += 1; accR[j] += rr; accG[j] += gg; accB[j] += bb;
    }
    const k = (this.gain * 60) / (s.w * s.h) * (N / 10);
    const img = ctx.createImageData(N, N);
    const o = img.data;
    for (let j = 0; j < N * N; j++) {
      if (!acc[j]) continue;
      const v = 1 - Math.exp(-acc[j] * k * 10);
      // piksel renginin doygun hali ile boya
      const mr = accR[j] / acc[j], mg = accG[j] / acc[j], mb = accB[j] / acc[j];
      const mx = Math.max(mr, mg, mb, 0.001);
      o[j * 4] = (150 + 105 * (mr / mx)) * v;
      o[j * 4 + 1] = (150 + 105 * (mg / mx)) * v;
      o[j * 4 + 2] = (150 + 105 * (mb / mx)) * v;
      o[j * 4 + 3] = 255 * v;
    }
    const tmp = el('canvas', { width: N, height: N });
    tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(tmp, cx - rad, cy - rad, rad * 2, rad * 2);
    ctx.globalCompositeOperation = 'source-over';
  }

  _histogram(ctx, r, s, dpr) {
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i <= 4; i++) {
      const x = Math.round(r.x + (r.w * i) / 4) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, r.y); ctx.lineTo(x, r.y + r.h); ctx.stroke();
    }
    this._label(ctx, t('Histogram'), r.x + 4, r.y + 10 * dpr);
    if (!s) return;
    const bins = [new Float32Array(256), new Float32Array(256), new Float32Array(256)];
    const d = s.data;
    for (let i = 0; i < s.w * s.h; i++) {
      bins[0][d[i * 4]]++; bins[1][d[i * 4 + 1]]++; bins[2][d[i * 4 + 2]]++;
    }
    // uç değerleri ölçeklemede yoksay (siyah/beyaz kırpmalar grafiği ezmesin)
    let max = 1;
    for (const b of bins) for (let i = 1; i < 255; i++) max = Math.max(max, b[i]);
    const colors = ['rgba(255,60,60,0.75)', 'rgba(60,255,60,0.75)', 'rgba(80,120,255,0.75)'];
    ctx.globalCompositeOperation = 'lighter';
    bins.forEach((b, ci) => {
      ctx.fillStyle = colors[ci];
      ctx.beginPath();
      ctx.moveTo(r.x, r.y + r.h);
      for (let i = 0; i < 256; i++) {
        const v = Math.min(1, Math.sqrt(b[i] / max) * this.gain * 0.9);
        ctx.lineTo(r.x + (i / 255) * r.w, r.y + r.h - v * r.h);
      }
      ctx.lineTo(r.x + r.w, r.y + r.h);
      ctx.closePath();
      ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';
  }
}
