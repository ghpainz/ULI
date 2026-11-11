// Tuval / en-boy oranı (CapCut tarzı): sekansı 9:16, 1:1, 4:5... yap, klipleri sığdır/doldur,
// V1'deki kliplerin arkasını bulanık kopya ya da renkle doldur.
import { store } from './store.js';
import { app } from './appContext.js';
import { t } from './i18n.js';
import { el } from './util.js';
import { clipMedia } from './model.js';
import { modal, selectEl } from './ui/dialogs.js';

export const RATIOS = [
  ['16:9', 16, 9, 'YouTube'], ['9:16', 9, 16, 'TikTok / Reels / Shorts'], ['1:1', 1, 1, 'Instagram'], ['4:5', 4, 5, 'Instagram'],
  ['4:3', 4, 3, ''], ['21:9', 21, 9, 'Cinema'], ['2.35:1', 2.35, 1, 'Cinema'],
];

const even = (v) => Math.max(2, Math.round(v / 2) * 2);

// Kısa kenar korunur
export function sizeFor(seq, rw, rh) {
  const short = Math.min(seq.width, seq.height);
  return rw >= rh ? [even((short * rw) / rh), even(short)] : [even(short), even((short * rh) / rw)];
}

function shiftParam(p, dx, dy) {
  if (!p) return;
  const f = (v) => (Array.isArray(v) ? [v[0] + dx, v[1] + dy] : v);
  p.v = f(p.v);
  if (p.kf) for (const k of p.kf) k.v = f(k.v);
}

export async function canvasDialog() {
  const seq = store.seq;
  if (!seq) return;
  let ratio = null;
  const btns = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '12px' } });
  const cur = seq.width / seq.height;
  for (const [id, rw, rh, hint] of RATIOS) {
    const box = el('div', { style: { width: (rw >= rh ? 44 : (44 * rw) / rh) + 'px', height: (rw >= rh ? (44 * rh) / rw : 44) + 'px', border: '2px solid currentColor', borderRadius: '3px', margin: '0 auto 4px' } });
    const b = el('button', { style: { padding: '8px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }, title: hint },
      el('div', { style: { height: '48px', display: 'flex', alignItems: 'center' } }, box), el('b', { text: id }), el('span', { text: hint ? t(hint) : '', style: { fontSize: '10px', color: 'var(--text-dim)' } }));
    if (Math.abs(rw / rh - cur) < 0.01) { b.classList.add('primary'); ratio = id; }
    b.addEventListener('click', () => { ratio = id; for (const x of btns.children) x.classList.remove('primary'); b.classList.add('primary'); upd(); });
    btns.appendChild(b);
  }
  const info = el('div', { style: { color: 'var(--text-dim)', fontSize: '11px', margin: '-4px 0 10px' } });
  const upd = () => { const r = RATIOS.find((x) => x[0] === ratio); if (r) { const [w, h] = sizeFor(seq, r[1], r[2]); info.textContent = `${seq.width}×${seq.height} → ${w}×${h}`; } };
  upd();
  const fit = selectEl([{ value: 'fill', label: t('Fill (crop to cover)') }, { value: 'fit', label: t('Fit (show whole frame)') }, { value: 'keep', label: t('Keep current size') }], 'fit');
  const bg = selectEl([{ value: 'blur', label: t('Blurred copy') }, { value: 'color', label: t('Color') }, { value: 'none', label: t('None (black)') }], 'blur');
  const color = el('input', { type: 'color', value: '#000000' });
  const row = (label, ...c) => el('div', { style: { display: 'grid', gridTemplateColumns: '130px 1fr', alignItems: 'center', gap: '8px', margin: '6px 0' } }, el('span', { text: label }), el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, ...c));
  const body = el('div', {}, btns, info, row(t('Clips'), fit), row(t('Background'), bg, color),
    el('div', { text: t('The background fills the empty area behind clips on track V1.'), style: { color: 'var(--text-dim)', fontSize: '11px', marginTop: '6px' } }));
  const r = await modal({ title: t('Canvas / Aspect Ratio'), body, width: 520, buttons: [
    { label: t('Cancel'), value: null },
    { label: t('OK'), primary: true, onClick: () => ({ ratio, fit: fit.value, bg: bg.value, color: color.value }) },
  ] });
  if (!r || !r.ratio) return;
  applyCanvas(r);
}

export function applyCanvas({ ratio, fit = 'fit', bg = 'blur', color = '#000000' }) {
  const seq = store.seq;
  const rr = RATIOS.find((x) => x[0] === ratio);
  if (!seq || !rr) return;
  const [W, H] = sizeFor(seq, rr[1], rr[2]);
  store.commit('Canvas', (p) => {
    const s = p.sequences[p.activeSequenceId];
    const dx = (W - s.width) / 2, dy = (H - s.height) / 2;
    for (const c of Object.values(s.clips)) {
      if (c.type !== 'video') continue;
      if (c.kind === 'graphic') { for (const L of c.graphic?.layers || []) { L.x += dx; L.y += dy; } }
      shiftParam(c.props.position, dx, dy);
      if ((c.kind === 'media' || c.kind === 'sequence') && fit !== 'keep') {
        const m = clipMedia(p, c);
        if (m && m.width && m.height && c.props.scale) {
          const k = fit === 'fill' ? Math.max(W / m.width, H / m.height) : Math.min(W / m.width, H / m.height);
          c.props.scale = { v: Math.round(k * 1000) / 10, kf: null };
          c.props.position = { v: [W / 2, H / 2], kf: null };
        }
      }
      if (c.track === 0 && (c.kind === 'media' || c.kind === 'sequence')) c.bgFill = bg === 'none' ? null : { mode: bg, color, blur: 40, dim: 20 };
    }
    s.width = W; s.height = H;
  });
  app.engine?.requestRender();
  app.program?.onResize?.();
}
