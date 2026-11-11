// Müzik vuruşu algılama (spektral akı + otokorelasyon tempo + dinamik programlama ile vuruş takibi)
// ve vuruşa göre kurgu: vuruşlara işaretçi, vuruşlarda kes, seçili kliplerden ritmik montaj.
import { store } from './store.js';
import { t } from './i18n.js';
import { el, uid, childProcess } from './util.js';
import { ff, registerJob } from './ffmpeg.js';
import * as E from './editing.js';
import { modal, toast, selectEl } from './ui/dialogs.js';

const SR = 11025, WIN = 1024, HOP = 256;

function decodeMono(path, start, dur) {
  return new Promise((resolve, reject) => {
    const p = childProcess.spawn(ff.ffmpeg, ['-hide_banner', '-v', 'error', '-ss', String(Math.max(0, start)), '-t', String(dur), '-i', path, '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { windowsHide: true });
    const chunks = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error('ffmpeg exit ' + code));
      const b = Buffer.concat(chunks);
      resolve(new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4)));
    });
  });
}

// yerinde radix-2 FFT
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar; im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar; im[i + k] += ai;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

// Başlangıç (onset) zarfı: log genlik spektral akısı
export function onsetEnvelope(x) {
  const nF = Math.max(0, Math.floor((x.length - WIN) / HOP) + 1);
  const env = new Float32Array(nF);
  const win = new Float32Array(WIN).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN));
  let prev = new Float32Array(WIN / 2);
  const re = new Float32Array(WIN), im = new Float32Array(WIN);
  for (let f = 0; f < nF; f++) {
    for (let i = 0; i < WIN; i++) { re[i] = x[f * HOP + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let s = 0;
    const cur = new Float32Array(WIN / 2);
    for (let k = 1; k < WIN / 2; k++) {
      cur[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = cur[k] - prev[k];
      if (d > 0) s += d;
    }
    env[f] = s;
    prev = cur;
  }
  // yerel ortalamayı çıkar, normalize et
  const out = new Float32Array(nF);
  const R = 8;
  let sd = 0;
  for (let f = 0; f < nF; f++) {
    let m = 0, c = 0;
    for (let k = Math.max(0, f - R); k <= Math.min(nF - 1, f + R); k++) { m += env[k]; c++; }
    out[f] = Math.max(0, env[f] - m / c);
    sd += out[f] * out[f];
  }
  sd = Math.sqrt(sd / Math.max(1, nF)) || 1;
  for (let f = 0; f < nF; f++) out[f] /= sd;
  return out;
}

// Tempo (kare cinsinden vuruş periyodu): 60–200 BPM, 120 civarı tercih
export function estimatePeriod(env) {
  const fr = SR / HOP;
  const minLag = Math.floor((60 / 200) * fr), maxLag = Math.ceil((60 / 60) * fr);
  let best = 0, bestV = -Infinity;
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    ac[lag] = s / Math.max(1, env.length - lag);
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fr) / lag;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const v = ac[lag] * w;
    if (v > bestV) { bestV = v; best = lag; }
  }
  // parabolik iyileştirme
  const a = ac[best - 1] || 0, b = ac[best], c = ac[best + 1] || 0;
  const den = a - 2 * b + c;
  return den !== 0 ? best + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : best;
}

// Ellis (2007) dinamik programlama ile vuruş takibi
export function trackBeats(env, period, tightness = 100) {
  const n = env.length;
  const score = new Float32Array(n), back = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let bestV = 0, bestJ = -1;
    const lo = Math.max(0, Math.round(i - 2 * period)), hi = Math.min(i - 1, Math.round(i - period / 2));
    for (let j = lo; j <= hi; j++) {
      const v = score[j] - tightness * Math.pow(Math.log((i - j) / period), 2);
      if (bestJ < 0 || v > bestV) { bestV = v; bestJ = j; }
    }
    score[i] = env[i] + (bestJ >= 0 ? bestV : 0);
    back[i] = bestJ;
  }
  // son periyot içindeki en iyi skordan geri izle
  let end = n - 1, bv = -Infinity;
  for (let i = Math.max(0, Math.floor(n - period)); i < n; i++) if (score[i] > bv) { bv = score[i]; end = i; }
  const beats = [];
  for (let i = end; i >= 0; i = back[i]) beats.push(i);
  return beats.reverse();
}

// Bir kaynak aralığında vuruşlar (saniye, aralık başına göre değil mutlak kaynak zamanı)
export async function detectBeats(path, start, dur) {
  const x = await decodeMono(path, start, dur);
  const env = onsetEnvelope(x);
  if (env.length < 20) return { bpm: 0, beats: [] };
  const period = estimatePeriod(env);
  const beats = trackBeats(env, period).map((f) => start + (f * HOP + WIN / 2 + HOP) / SR); // akı tepe noktası ~1 adım erken
  return { bpm: (60 * SR) / HOP / period, beats };
}

// ---- Komutlar ----
const BEAT_TAG = 'beat';

export async function detectBeatsCommand() {
  const seq = store.seq;
  const project = store.project;
  if (!seq) return;
  const c = store.selectedClips().find((x) => x.type === 'audio' && x.kind === 'media' && project.media[x.mediaId]?.hasAudio);
  if (!c) { toast(t('Select a music clip (audio) in the timeline'), 'warn'); return; }
  const m = project.media[c.mediaId];
  const fps = seq.fps;
  const sp = Math.abs(c.speed) || 1;
  const job = registerJob(t('Detecting beats'));
  let r;
  try {
    r = await detectBeats(m.path, c.inPoint, (c.duration / fps) * sp);
  } catch (e) {
    toast(t('Beat detection failed') + ': ' + e.message, 'error');
    return;
  } finally { job.done(); }
  if (!r.beats.length) { toast(t('No beats found'), 'warn'); return; }
  const frames = r.beats.map((tm) => c.start + Math.round(((tm - c.inPoint) * fps) / sp)).filter((f) => f >= c.start && f < c.start + c.duration);
  store.commit('Detect Beats', (p) => {
    const s = p.sequences[seq.id];
    s.markers = s.markers.filter((mk) => !(mk.tag === BEAT_TAG && mk.frame >= c.start && mk.frame < c.start + c.duration));
    frames.forEach((f, i) => s.markers.push({ id: uid('mk'), frame: f, name: i % 4 === 0 ? String(i / 4 + 1) : '', comment: '', color: i % 4 === 0 ? '#e8c547' : '#c27a2c', duration: 0, tag: BEAT_TAG }));
    s.markers.sort((a, b) => a.frame - b.frame);
  });
  toast(t('{n} beats found', { n: frames.length }) + ` · ${Math.round(r.bpm)} BPM`);
  return { bpm: r.bpm, frames };
}

export function beatFrames(seq) {
  return seq.markers.filter((m) => m.tag === BEAT_TAG).map((m) => m.frame).sort((a, b) => a - b);
}

export async function cutToBeatDialog() {
  const seq = store.seq;
  if (!seq) return;
  const beats = beatFrames(seq);
  if (beats.length < 2) { toast(t('Detect beats first: select the music clip and use Detect Beats'), 'warn'); return; }
  const vids = store.selectedClips().filter((c) => c.type === 'video');
  if (!vids.length) { toast(t('Select one or more video clips in the timeline'), 'warn'); return; }
  const mode = selectEl([
    { value: 'montage', label: t('Build a montage from the selected clips') },
    { value: 'cut', label: t('Add edits to the selected clips at beats') },
  ], vids.length > 1 ? 'montage' : 'cut');
  const every = selectEl([1, 2, 4, 8].map((n) => ({ value: n, label: t('Every {n} beat(s)', { n }) })), 2);
  const fill = el('input', { type: 'checkbox' }); fill.checked = true;
  const row = (label, input) => el('div', { style: { display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', gap: '8px', margin: '6px 0' } }, el('span', { text: label }), input);
  const body = el('div', {},
    row(t('Mode'), mode), row(t('Cut Length'), every),
    el('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' } }, fill, el('span', { text: t('Repeat clips until the beats run out (montage)') })),
    el('div', { text: t('{n} beat markers in the sequence', { n: beats.length }), style: { color: 'var(--text-dim)', fontSize: '11px', marginTop: '8px' } }));
  const r = await modal({ title: t('Auto Cut to Beat'), body, width: 460, buttons: [
    { label: t('Cancel'), value: null },
    { label: t('OK'), primary: true, onClick: () => ({ mode: mode.value, every: +every.value, fill: fill.checked }) },
  ] });
  if (!r) return;
  return cutToBeat(vids.map((c) => c.id), r);
}

export function cutToBeat(ids, { mode = 'montage', every = 2, fill = true } = {}) {
  const seq = store.seq;
  const beats = beatFrames(seq);
  const marks = beats.filter((_, i) => i % every === 0);
  let made = 0;
  store.commit('Auto Cut to Beat', (p) => {
    const s = p.sequences[seq.id];
    const clips = ids.map((id) => s.clips[id]).filter(Boolean).sort((a, b) => a.start - b.start || a.track - b.track);
    if (mode === 'cut') {
      for (const c of clips) {
        const group = new Set(c.linkId ? Object.values(s.clips).filter((x) => x.linkId === c.linkId).map((x) => x.id) : [c.id]);
        for (const f of marks) {
          const list = [...group].map((id) => s.clips[id]).filter(Boolean);
          for (const n of E.razorAt(s, f, list)) { group.add(n.id); made++; }
        }
      }
      return;
    }
    // montaj: klipler sırayla vuruş aralıklarına yerleştirilir (yalnız video; bağlı sesleri kaldırılır)
    const track = clips[0].track;
    const templates = clips.map((c) => structuredClone(c));
    for (const c of clips) {
      if (c.linkId) for (const x of Object.values(s.clips)) if (x.linkId === c.linkId && x.type === 'audio') delete s.clips[x.id];
      delete s.clips[c.id];
    }
    const project = p;
    let k = 0;
    for (let i = 0; i + 1 < marks.length; i++) {
      if (k >= templates.length && !fill) break;
      const tpl = templates[k % templates.length];
      k++;
      const start = marks[i], want = marks[i + 1] - marks[i];
      const media = tpl.kind === 'media' ? project.media[tpl.mediaId] : null;
      const hr = E.headroom({ ...tpl, duration: 1 }, media, s.fps);
      const dur = Math.max(1, Math.min(want, isFinite(hr.end) ? hr.end + 1 : want));
      E.clearRange(s, 'video', track, start, start + dur);
      const n = { ...structuredClone(tpl), id: uid('clp'), start, duration: dur, linkId: null, transIn: null, transOut: null };
      s.clips[n.id] = n;
      made++;
    }
  });
  toast(t('Auto Cut to Beat') + ': ' + made);
  return made;
}

