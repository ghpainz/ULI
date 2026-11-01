// Çok katmanlı grafik klipleri (Essential Graphics benzeri): katmanlar, giriş/çıkış animasyonları, şablonlar
import { uid } from './util.js';
import { renderTextCanvas } from './text.js';

export const ANIMS = ['none', 'fade', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'scale', 'pop', 'typewriter', 'wipe'];
export const ANIM_LABELS = {
  none: 'None', fade: 'Fade', slideUp: 'Slide Up', slideDown: 'Slide Down', slideLeft: 'Slide Left', slideRight: 'Slide Right',
  scale: 'Scale', pop: 'Pop', typewriter: 'Typewriter', wipe: 'Wipe',
};

export function newLayer(type, W, H, extra = {}) {
  const base = {
    id: uid('lyr'), type, name: type, x: W / 2, y: H / 2, w: Math.round(W * 0.3), h: Math.round(H * 0.1), rotation: 0, opacity: 100,
    fill: '#ffffff', fillOpacity: 100, stroke: '#000000', strokeWidth: 0, radius: 0,
    shadow: false, shadowColor: '#000000', shadowBlur: 10, shadowDist: 4,
    delay: 0, animIn: { type: 'fade', dur: 15 }, animOut: { type: 'fade', dur: 12 },
  };
  if (type === 'text') Object.assign(base, { name: 'Text', text: 'Metin', font: 'Segoe UI', size: Math.round(H * 0.07), bold: true, italic: false, align: 'center', tracking: 0, lineHeight: 1.15 });
  if (type === 'rect') Object.assign(base, { name: 'Rectangle', fill: '#2d8ceb' });
  if (type === 'ellipse') Object.assign(base, { name: 'Ellipse', w: Math.round(H * 0.15), h: Math.round(H * 0.15), fill: '#e0533d' });
  if (type === 'line') Object.assign(base, { name: 'Line', h: Math.max(2, Math.round(H * 0.005)), fill: '#ffffff' });
  return Object.assign(base, extra);
}

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

// Katmanın o karedeki animasyon durumu: { visible, alpha, dx, dy, scale, reveal (0..1), chars (0..1) }
export function layerState(L, local, duration, W, H) {
  const st = { visible: true, alpha: 1, dx: 0, dy: 0, scale: 1, reveal: 1, chars: 1 };
  const t = local - (L.delay || 0);
  if (t < 0) { st.visible = false; return st; }
  const apply = (anim, p, isIn) => {
    if (!anim || anim.type === 'none' || p >= 1) return;
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
  return st;
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
  };
}

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
export function renderGraphic(canvas, graphic, local, duration, W, H) {
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  for (const L of graphic.layers || []) {
    if (L.hidden) continue;
    const s = layerState(L, local, duration, W, H);
    if (!s.visible || s.alpha <= 0.001 || s.scale <= 0.001) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, s.alpha * (L.opacity ?? 100) / 100));
    ctx.translate(L.x + s.dx, L.y + s.dy);
    ctx.rotate(((L.rotation || 0) * Math.PI) / 180);
    ctx.scale(s.scale, s.scale);
    let w = L.w, h = L.h;
    if (L.type === 'text') {
      // hizalama noktası: sol = sol kenar, sağ = sağ kenar, orta = merkez
      const full = String(L.text ?? '');
      const txt = s.chars < 1 ? full.slice(0, Math.floor(full.length * s.chars)) : full;
      const cv = cachedText(L, txt || ' ');
      const ref = s.chars < 1 ? cachedText(L, full || ' ') : cv;
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
    const t = local - (L.delay || 0);
    if (t < 0 && t > -2) return true;
    if (t >= 0 && L.animIn && L.animIn.type !== 'none' && t < (L.animIn.dur || 1) + 1) return true;
    if (L.animOut && L.animOut.type !== 'none' && duration - local < (L.animOut.dur || 1) + 1) return true;
  }
  return false;
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
];

export function makeTemplate(id, W, H) {
  const k = H / 1080;
  const L = (type, o) => newLayer(type, W, H, o);
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
    default: return { layers: [L('text', {})] };
  }
}
