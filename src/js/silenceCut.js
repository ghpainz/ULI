// Sessizlikleri kaldır: seçili konuşma kliplerindeki duraklamaları bulur, keser ve boşlukları kapatır (jump cut).
// Yalnız seçili kliplerin izleri değişir; diğer izlerdeki müzik vb. olduğu gibi kalır. Tek geri al ile geri alınır.
import { store } from './store.js';
import { t } from './i18n.js';
import { el, uid, childProcess } from './util.js';
import { ff } from './ffmpeg.js';
import { clipsOnTrack, linkedClips } from './model.js';
import * as E from './editing.js';
import { modal, toast, selectEl } from './ui/dialogs.js';

// Hassasiyet: sessizlik eşiği = kaydın en yüksek seviyesinin kaç dB altı
export const SENSITIVITY = { gentle: 38, normal: 32, aggressive: 24 };

function ffRun(args) {
  return new Promise((res) => {
    const p = childProcess.spawn(ff.ffmpeg, ['-hide_banner', '-nostats', ...args, '-f', 'null', '-'], { windowsHide: true });
    let e = '';
    p.stderr.on('data', (d) => { e += d; });
    p.on('close', () => res(e));
    p.on('error', () => res(''));
  });
}

// Kaynak dosyanın [t0, t0+dur] aralığındaki sessizlikler (aralığa göre saniye)
export async function detectSilences(path, t0, dur, { sensitivity = 'normal', minSilence = 0.5 } = {}) {
  const src = ['-ss', t0.toFixed(3), '-t', dur.toFixed(3), '-i', path, '-vn'];
  const v = await ffRun([...src, '-af', 'volumedetect']);
  const m = /max_volume:\s*(-?[\d.]+)/.exec(v);
  const thr = Math.max(-65, Math.min(-18, (m ? +m[1] : 0) - (SENSITIVITY[sensitivity] ?? 32)));
  const out = await ffRun([...src, '-af', `silencedetect=n=${thr}dB:d=${Math.max(0.1, minSilence).toFixed(2)}`]);
  const res = [];
  let st = null;
  for (const line of out.split(/\r?\n/)) {
    let mm = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (mm) st = Math.max(0, +mm[1]);
    mm = /silence_end:\s*([\d.]+)/.exec(line);
    if (mm && st != null) { res.push([st, +mm[1]]); st = null; }
  }
  if (st != null) res.push([st, dur]);
  return res;
}

// Konuşma grupları: seçili klipler + bağlı ortakları; sesi olan klip analiz edilir
function speechGroups(seq, ids) {
  const seen = new Set(), groups = [];
  for (const id of ids) {
    const c = seq.clips[id];
    if (!c || seen.has(c.id)) continue;
    const g = linkedClips(seq, c);
    g.forEach((x) => seen.add(x.id));
    const a = g.find((x) => x.type === 'audio' && x.kind === 'media') || g.find((x) => x.kind === 'media');
    if (a) groups.push({ clips: g, audio: a });
  }
  return groups;
}

// Kesilecek sekans aralıkları [başla, bitir) (kare)
export async function planSilenceCuts(seq, ids, { sensitivity = 'normal', minSilence = 0.5, padding = 0.12 } = {}) {
  const fps = seq.fps;
  const p = store.project;
  const cuts = [];
  const tracks = new Set();
  let skipped = 0;
  for (const g of speechGroups(seq, ids)) {
    const c = g.audio;
    const m = p.media[c.mediaId];
    const hasRemap = c.props?.timeRemap?.kf?.length;
    if (!m || !m.path || !m.hasAudio || c.reverse || hasRemap) { skipped++; continue; }
    for (const x of g.clips) tracks.add(x.type + ':' + x.track);
    const sp = c.speed || 1;
    const dur = (c.duration / fps) * sp;
    const sil = await detectSilences(m.path, c.inPoint, dur, { sensitivity, minSilence });
    for (const [a, b] of sil) {
      // konuşmanın başını/sonunu kırpmamak için iki yanda pay bırak (klip kenarlarında pay gerekmez)
      const s0 = a <= 0.01 ? 0 : a + padding, s1 = b >= dur - 0.01 ? dur : b - padding;
      if (s1 - s0 < Math.min(minSilence, 0.15)) continue;
      const f0 = c.start + Math.round((s0 / sp) * fps), f1 = c.start + Math.round((s1 / sp) * fps);
      if (f1 - f0 >= 2) cuts.push([f0, f1]);
    }
  }
  // birleştir
  cuts.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of cuts) {
    if (merged.length && r[0] <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], r[1]);
    else merged.push([...r]);
  }
  return { cuts: merged, tracks: [...tracks].map((k) => { const [type, i] = k.split(':'); return [type, +i]; }), skipped };
}

// Aralıkları yalnız verilen izlerde sil ve o izlerde sonraki klipleri sola kaydır
export function applySilenceCuts(seq, cuts, tracks) {
  for (let k = cuts.length - 1; k >= 0; k--) {
    const [s, e] = cuts[k];
    const len = e - s;
    for (const [type, i] of tracks) {
      if (seq.tracks[type][i]?.locked) continue;
      E.clearRange(seq, type, i, s, e);
      for (const c of clipsOnTrack(seq, type, i)) if (c.start >= e) c.start -= len;
    }
  }
  // bölünen video+ses parçalarını yeniden bağla (aynı yer, aynı kaynak)
  const byKey = new Map();
  for (const [type, i] of tracks) {
    for (const c of clipsOnTrack(seq, type, i)) {
      if (c.kind !== 'media') continue;
      const key = c.start + ':' + c.duration + ':' + c.mediaId;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(c);
    }
  }
  for (const list of byKey.values()) {
    if (list.length < 2 || !list.some((c) => c.type === 'video') || !list.some((c) => c.type === 'audio')) continue;
    const l = uid('lnk');
    for (const c of list) c.linkId = l;
  }
}

export async function removeSilences(ids, opts = {}) {
  const seq = store.seq;
  const plan = await planSilenceCuts(seq, ids, opts);
  if (!plan.cuts.length) return { cuts: 0, seconds: 0, skipped: plan.skipped };
  const removed = plan.cuts.reduce((a, [s, e]) => a + e - s, 0);
  store.commit(t('Remove Silences'), (p) => applySilenceCuts(p.sequences[seq.id], plan.cuts, plan.tracks));
  return { cuts: plan.cuts.length, seconds: removed / seq.fps, skipped: plan.skipped };
}

export async function removeSilencesDialog() {
  const seq = store.seq;
  if (!seq) return null;
  let ids = store.selectedClips().map((c) => c.id);
  if (!ids.length) { toast(t('Select the talking clips in the timeline first'), 'warn'); return null; }
  const sens = selectEl([{ value: 'gentle', label: t('Gentle (only clear pauses)') }, { value: 'normal', label: t('Normal') }, { value: 'aggressive', label: t('Aggressive (also quiet breaths)') }], store.settings.silSens || 'normal');
  const minSil = selectEl([0.3, 0.5, 0.75, 1, 1.5].map((v) => ({ value: v, label: v + ' ' + t('sec') })), store.settings.silMin || 0.5);
  const pad = selectEl([0.05, 0.12, 0.2, 0.3].map((v) => ({ value: v, label: v + ' ' + t('sec') })), store.settings.silPad || 0.12);
  const row = (label, c) => el('div', { style: { display: 'grid', gridTemplateColumns: '170px 1fr', alignItems: 'center', gap: '8px', margin: '7px 0' } }, el('span', { text: label }), c);
  const body = el('div', {}, row(t('Sensitivity'), sens), row(t('Shortest pause to remove'), minSil), row(t('Keep around speech'), pad),
    el('div', { text: t('Only the tracks of the selected clips change; music on other tracks is not cut.'), style: { color: 'var(--text-dim)', fontSize: '11px', marginTop: '8px' } }));
  const r = await modal({ title: t('Remove Silences'), body, width: 480, buttons: [
    { label: t('Cancel'), value: null },
    { label: t('Remove Silences'), primary: true, onClick: () => ({ sensitivity: sens.value, minSilence: +minSil.value, padding: +pad.value }) },
  ] });
  if (!r) return null;
  Object.assign(store.settings, { silSens: r.sensitivity, silMin: r.minSilence, silPad: r.padding });
  toast(t('Finding pauses...'));
  const res = await removeSilences(ids, r);
  if (!res.cuts) toast(t('No pauses were found'), 'info');
  else toast(t('{n} pauses removed, {s} seconds shorter', { n: res.cuts, s: res.seconds.toFixed(1) }), 'success', 5000);
  if (res.skipped) toast(t('Some clips were skipped (reversed or speed-ramped)'), 'warn');
  return res;
}
