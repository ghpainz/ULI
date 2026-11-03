// Sahne kesim algılama: ffmpeg "scene" skoruyla kaynak videodaki kesimleri bulur;
// seçili kliplere kesim uygular, klip işaretçisi ya da alt klip oluşturur.
import { store } from './store.js';
import { t } from './i18n.js';
import { el, uid, childProcess } from './util.js';
import { ff, registerJob } from './ffmpeg.js';
import { remapActive } from './model.js';
import * as E from './editing.js';
import { modal, toast } from './ui/dialogs.js';

// Kaynak aralığında kesim zamanları (mutlak saniye, artan)
export function detectScenes(path, startSec, durSec, threshold = 0.3, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-ss', String(Math.max(0, startSec)), '-t', String(durSec), '-i', path,
      '-an', '-sn', '-dn', '-vf', `scale=320:-2,select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'];
    const p = childProcess.spawn(ff.ffmpeg, args, { windowsHide: true });
    const times = [];
    let buf = '';
    p.stderr.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r|\n/);
      buf = lines.pop();
      for (const ln of lines) {
        const m = /Parsed_showinfo.*pts_time:\s*([\d.]+)/.exec(ln);
        if (m) times.push(startSec + parseFloat(m[1]));
        const tm = /time=\s*(\d+):(\d+):([\d.]+)/.exec(ln);
        if (tm && onProgress && durSec > 0) onProgress(Math.min(1, (+tm[1] * 3600 + +tm[2] * 60 + +tm[3]) / durSec));
      }
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(times.sort((a, b) => a - b)) : reject(new Error('ffmpeg exit ' + code))));
    if (signal) signal.addEventListener('abort', () => p.kill('SIGKILL'));
  });
}

// Klibin kaynak aralığı (s) ve kaynak zamanı -> zaman çizelgesi karesi dönüşümü
function clipSource(c, fps) {
  const sp = Math.abs(c.speed) || 1;
  const a = c.inPoint, b = c.inPoint + (c.duration / fps) * sp;
  const toFrame = (tm) => c.start + Math.round(((c.reverse ? b - tm : tm - a) * fps) / sp);
  return { a, b, toFrame };
}

export async function sceneEditDetection() {
  const seq = store.seq;
  const project = store.project;
  if (!seq) return;
  const clips = store.selectedClips().filter((c) => c.kind === 'media' && c.type === 'video' && project.media[c.mediaId]?.hasVideo && project.media[c.mediaId].type !== 'image');
  if (!clips.length) { toast(t('Select one or more video clips in the timeline'), 'warn'); return; }
  const remapped = clips.filter((c) => remapActive(c));

  const cut = el('input', { type: 'checkbox' }); cut.checked = true;
  const mark = el('input', { type: 'checkbox' });
  const sub = el('input', { type: 'checkbox' });
  const sens = el('input', { type: 'range', min: '5', max: '60', step: '1', value: '30', style: { width: '160px' } });
  const sensVal = el('span', { text: '0.30', style: { fontFamily: 'var(--mono)', marginLeft: '8px' } });
  sens.addEventListener('input', () => { sensVal.textContent = (sens.value / 100).toFixed(2); });
  const row = (inp, label) => el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0' } }, inp, el('span', { text: label }));
  const body = el('div', {},
    el('div', { text: t('Analyze the selected clips and find the cuts in the original footage.'), style: { marginBottom: '10px', color: 'var(--text-dim)' } }),
    row(cut, t('Apply a cut at each detected cut point')),
    row(mark, t('Create a clip marker at each detected cut point')),
    row(sub, t('Generate subclips in bin for each detected cut point')),
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' } }, el('span', { text: t('Threshold') }), sens, sensVal),
    el('div', { text: t('Lower threshold finds more cuts (more sensitive).'), style: { fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' } }),
    remapped.length ? el('div', { text: t('Clips with Time Remapping are skipped.'), style: { fontSize: '11px', color: '#e3a42c', marginTop: '6px' } }) : null);
  const opts = await modal({ title: t('Scene Edit Detection'), body, width: 460, buttons: [
    { label: t('Cancel'), value: null },
    { label: t('Analyze'), primary: true, onClick: () => ({ cut: cut.checked, mark: mark.checked, sub: sub.checked, th: sens.value / 100 }) },
  ] });
  if (!opts || !(opts.cut || opts.mark || opts.sub)) return;

  const work = clips.filter((c) => !remapActive(c));
  const job = registerJob(t('Scene Edit Detection'));
  const results = [];
  try {
    for (let i = 0; i < work.length; i++) {
      const c = work[i];
      const m = project.media[c.mediaId];
      const { a, b, toFrame } = clipSource(c, seq.fps);
      const times = await detectScenes(m.path, a, b - a, opts.th, { onProgress: (p) => job.progress((i + p) / work.length) });
      // çok yakın kesimleri ele (en az 0.25 sn arayla)
      const minGap = 0.25;
      const ts = [];
      for (const tm of times) if (tm > a + 1 / seq.fps && tm < b - 1 / seq.fps && (!ts.length || tm - ts[ts.length - 1] >= minGap)) ts.push(tm);
      results.push({ id: c.id, mediaId: m.id, times: ts, frames: ts.map(toFrame).filter((f) => f > c.start && f < c.start + c.duration), a, b });
    }
  } catch (e) {
    job.done();
    toast(t('Scene detection failed') + ': ' + e.message, 'error');
    return;
  }
  job.done();
  const total = results.reduce((n, r) => n + r.times.length, 0);
  if (!total) { toast(t('No cuts detected'), 'info'); return; }

  store.commit('Scene Edit Detection', (p) => {
    const s2 = p.sequences[seq.id];
    for (const r of results) {
      const m = p.media[r.mediaId];
      if (opts.mark && m) {
        m.markers = m.markers || [];
        for (const tm of r.times) if (!m.markers.some((x) => Math.abs(x.t - tm) < 0.5 / seq.fps)) m.markers.push({ id: uid('mk'), t: tm, name: t('Scene'), color: '#e3a42c' });
        m.markers.sort((x, y) => x.t - y.t);
      }
      if (opts.sub && m) {
        const root = (m.parentId && p.media[m.parentId]) || m;
        const bounds = [r.a, ...r.times, r.b];
        const base = m.name.replace(/\.[^.]+$/, '');
        for (let k = 0; k < bounds.length - 1; k++) {
          const id = uid('med');
          const sc = structuredClone(root);
          Object.assign(sc, { id, parentId: root.id, name: `${base}.Scene.${String(k + 1).padStart(2, '0')}`, subStart: bounds[k], subEnd: bounds[k + 1], inPoint: null, outPoint: null, markers: [], binId: m.binId ?? null });
          p.media[id] = sc;
        }
      }
      if (opts.cut && s2.clips[r.id]) {
        const c = s2.clips[r.id];
        const group = new Set(c.linkId ? Object.values(s2.clips).filter((x) => x.linkId === c.linkId).map((x) => x.id) : [c.id]);
        for (const f of r.frames) {
          const list = [...group].map((id) => s2.clips[id]).filter(Boolean);
          for (const n of E.razorAt(s2, f, list)) group.add(n.id);
        }
      }
    }
  });
  toast(t('Detected cuts') + ': ' + total);
}
