// Hız eğrisi ön ayarları (CapCut tarzı): zaman yeniden eşleme keyframe'leri üretir.
// Klibin kaynak aralığı korunur; süre, eğrinin ortalama hızına göre yeniden hesaplanır ve sonraki klipler kaydırılır.
import { store } from './store.js';
import { t } from './i18n.js';
import { remapActive, remapIntegral } from './model.js';
import { toast } from './ui/dialogs.js';

// [konum (0..1), hız çarpanı]
export const SPEED_CURVES = [
  ['montage', 'Montage', [[0, 1], [0.2, 3], [0.35, 0.4], [0.55, 0.4], [0.7, 3], [1, 1]]],
  ['hero', 'Hero', [[0, 1], [0.3, 3], [0.4, 0.25], [0.6, 0.25], [0.7, 3], [1, 1]]],
  ['bullet', 'Bullet', [[0, 3], [0.3, 3], [0.4, 0.15], [0.7, 0.15], [0.8, 3], [1, 3]]],
  ['jumpCut', 'Jump Cut', [[0, 0.5], [0.45, 0.5], [0.5, 4], [0.55, 0.5], [1, 0.5]]],
  ['flashIn', 'Flash In', [[0, 4], [0.3, 1], [1, 1]]],
  ['flashOut', 'Flash Out', [[0, 1], [0.7, 1], [1, 4]]],
  ['slowMo', 'Slow Motion Middle', [[0, 1], [0.3, 0.3], [0.7, 0.3], [1, 1]]],
  ['rampUp', 'Speed Up', [[0, 0.5], [1, 2.5]]],
  ['rampDown', 'Slow Down', [[0, 2.5], [1, 0.5]]],
];

const avg = (pts) => { let a = 0; for (let i = 1; i < pts.length; i++) a += ((pts[i][1] + pts[i - 1][1]) / 2) * (pts[i][0] - pts[i - 1][0]); return a; };

// Klibin şu an tükettiği kaynak (kare, c.speed hariç)
function sourceFrames(c) {
  return remapActive(c) ? remapIntegral(c.props.timeRemap, c.duration) : c.duration;
}

// id: SPEED_CURVES anahtarı veya 'none' (normal hıza dön)
export function applySpeedCurve(clipIds, id) {
  const seq = store.seq;
  if (!seq) return;
  const curve = SPEED_CURVES.find((x) => x[0] === id);
  const targets = clipIds.map((cid) => seq.clips[cid]).filter((c) => c && c.type === 'video' && (c.kind === 'media' || c.kind === 'sequence') && !c.reverse && c.props.timeRemap);
  if (!targets.length) { toast(t('Select a video clip (not reversed)'), 'warn'); return; }
  store.commit(curve ? 'Speed Curve' : 'Reset Speed', (p) => {
    const s = p.sequences[p.activeSequenceId];
    for (const c0 of targets) {
      const c = s.clips[c0.id];
      if (!c) continue;
      const S = sourceFrames(c);
      const oldEnd = c.start + c.duration;
      let D;
      if (curve) {
        D = Math.max(2, Math.round(S / avg(curve[2])));
        c.props.timeRemap = { v: 100, kf: curve[2].map(([u, k]) => ({ f: Math.round(u * (D - 1)), v: Math.round(k * 1000) / 10, e: 'linear' })) };
      } else {
        D = Math.max(1, Math.round(S));
        c.props.timeRemap = { v: 100, kf: null };
      }
      const d = D - c.duration;
      // bağlı ses de aynı süreyi alır (ses hız rampasını izler)
      const group = c.linkId ? Object.values(s.clips).filter((x) => x.linkId === c.linkId && x.start === c.start && x.duration === c.duration) : [c];
      const tracks = new Set(group.map((x) => x.type + ':' + x.track));
      for (const g of group) g.duration = D;
      // aynı izlerdeki sonraki klipleri kaydır
      if (d) {
        const after = Object.values(s.clips).filter((x) => !group.includes(x) && tracks.has(x.type + ':' + x.track) && x.start >= oldEnd);
        const minStart = after.length ? Math.min(...after.map((x) => x.start)) : Infinity;
        const shift = d > 0 ? Math.max(0, oldEnd + d - minStart) : (minStart === oldEnd ? d : 0);
        if (shift) for (const x of after) x.start += shift;
      }
    }
  });
}
