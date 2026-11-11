// Bölünmüş ekran düzenleri: seçili video kliplerini ızgaraya yerleştirir (ölçek + konum + kırpma).
// Klipler aynı anda görünmüyorsa (art arda) üst üste izlere aynı başlangıca taşınır.
import { store } from './store.js';
import { t } from './i18n.js';
import { el } from './util.js';
import { clipMedia, createEffect } from './model.js';
import * as E from './editing.js';
import { modal, toast } from './ui/dialogs.js';

// hücreler: [x, y, w, h] (0..1)
export const LAYOUTS = [
  ['2v', 'Side by Side', [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]]],
  ['2h', 'Top and Bottom', [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]]],
  ['3v', '3 Columns', [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]]],
  ['3h', '3 Rows', [[0, 0, 1, 1 / 3], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 1 / 3]]],
  ['1+2', '1 Large + 2', [[0, 0, 0.5, 1], [0.5, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]]],
  ['4', '2 × 2 Grid', [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]]],
];

export async function splitScreenDialog() {
  const sel = store.selectedClips().filter((c) => c.type === 'video' && (c.kind === 'media' || c.kind === 'sequence'));
  if (sel.length < 2) { toast(t('Select 2 to 4 video clips for split screen'), 'warn'); return; }
  let pick = sel.length === 2 ? '2v' : sel.length === 3 ? '3v' : '4';
  const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' } });
  for (const [id, name, cells] of LAYOUTS) {
    const box = el('div', { style: { position: 'relative', width: '96px', height: '54px', margin: '0 auto 6px', background: '#111' } });
    cells.forEach(([x, y, w, h], i) => box.appendChild(el('div', { text: String(i + 1), style: { position: 'absolute', left: x * 100 + '%', top: y * 100 + '%', width: w * 100 + '%', height: h * 100 + '%', boxSizing: 'border-box', border: '1px solid #666', background: ['#3a6ea5', '#a5583a', '#4a9a5a', '#8a5ab0'][i], color: '#fff', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' } })));
    const b = el('button', { style: { padding: '8px' } }, box, el('div', { text: t(name), style: { fontSize: '11px' } }));
    if (id === pick) b.classList.add('primary');
    b.addEventListener('click', () => { pick = id; for (const x of grid.children) x.classList.remove('primary'); b.classList.add('primary'); });
    grid.appendChild(b);
  }
  const gap = el('input', { type: 'number', min: '0', max: '200', value: '0', style: { width: '70px' } });
  const body = el('div', {}, grid, el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px' } }, el('span', { text: t('Gap (px)') }), gap),
    el('div', { text: t('Clips fill the cells in timeline order (top track first if they are stacked).'), style: { color: 'var(--text-dim)', fontSize: '11px', marginTop: '8px' } }));
  const r = await modal({ title: t('Split Screen'), body, width: 440, buttons: [
    { label: t('Cancel'), value: null },
    { label: t('OK'), primary: true, onClick: () => ({ layout: pick, gap: Math.max(0, +gap.value || 0) }) },
  ] });
  if (!r) return;
  applySplitScreen(sel.map((c) => c.id), r.layout, r.gap);
}

export function applySplitScreen(ids, layoutId, gap = 0) {
  const lay = LAYOUTS.find((x) => x[0] === layoutId);
  if (!lay) return;
  store.commit('Split Screen', (p) => {
    const s = p.sequences[p.activeSequenceId];
    const W = s.width, H = s.height;
    let clips = ids.map((id) => s.clips[id]).filter(Boolean).slice(0, lay[2].length);
    const overlap = (a, b) => a.start < b.start + b.duration && b.start < a.start + a.duration;
    const allOverlap = clips.every((a) => clips.every((b) => a === b || overlap(a, b)));
    if (!allOverlap) {
      // art arda klipler: en erken başlangıçta ayrı izlere yığ
      const s0 = Math.min(...clips.map((c) => c.start));
      clips.sort((a, b) => a.start - b.start);
      const base = Math.min(...clips.map((c) => c.track));
      clips.forEach((c, i) => {
        const tr = base + i;
        E.ensureTracks(s, 'video', tr + 1);
        if (c.linkId) for (const x of Object.values(s.clips)) if (x.linkId === c.linkId) x.linkId = null;
        E.clearRange(s, 'video', tr, s0, s0 + c.duration, new Set([c.id]));
        c.track = tr; c.start = s0;
      });
    } else clips.sort((a, b) => b.track - a.track);
    clips.forEach((c, i) => {
      const m = clipMedia(p, c);
      if (!m || !m.width || !m.height) return;
      const [x, y, w, h] = lay[2][i];
      const cw = w * W - gap, ch = h * H - gap;
      const k = Math.max(cw / m.width, ch / m.height);
      c.props.scale = { v: Math.round(k * 1000) / 10, kf: null };
      c.props.uniformScale = true;
      c.props.position = { v: [(x + w / 2) * W, (y + h / 2) * H], kf: null };
      c.props.rotation = { v: 0, kf: null };
      c.props.anchor = { v: [m.width / 2, m.height / 2], kf: null };
      // görünen kaynak alanı dışını kırp
      const visW = cw / k / m.width, visH = ch / k / m.height;
      c.effects = (c.effects || []).filter((fx) => fx.tag !== 'split');
      const crop = createEffect('crop');
      crop.tag = 'split';
      crop.params.left.v = crop.params.right.v = Math.max(0, ((1 - visW) / 2) * 100);
      crop.params.top.v = crop.params.bottom.v = Math.max(0, ((1 - visH) / 2) * 100);
      c.effects.unshift(crop);
    });
  });
}
