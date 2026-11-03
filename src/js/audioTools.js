// Ses araçları: ses yüksekliği (LUFS) ölçümü/eşleme, müzik ducking, seslendirme kaydı, sese göre senkron
import { store } from './store.js';
import { app } from './appContext.js';
import { ff, registerJob } from './ffmpeg.js';
import { childProcess, nodeFs, nodePath, ensureDir } from './util.js';
import { linkedClips, createEffect } from './model.js';
import { evalParam } from './keyframes.js';
import { importFiles } from './media.js';
import * as E from './editing.js';
import { t } from './i18n.js';
import { toast, alertDialog } from './ui/dialogs.js';

function clipSourceRange(c, fps) {
  const a = Math.max(0, c.inPoint);
  return { start: a, dur: (c.duration / fps) * c.speed };
}

// Entegre ses yüksekliği (LUFS) — klibin kaynak aralığında, efektler öncesi
export function measureLoudness(c) {
  const s = store.seq;
  const m = store.project.media[c.mediaId];
  if (!m || !m.hasAudio) return Promise.resolve(null);
  const { start, dur } = clipSourceRange(c, s.fps);
  return new Promise((resolve, reject) => {
    const p = childProcess.spawn(ff.ffmpeg, ['-hide_banner', '-nostats', '-ss', start.toFixed(3), '-t', Math.max(0.1, dur).toFixed(3), '-i', m.path, '-vn', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', () => {
      const mm = /I:\s+(-?[\d.]+|-inf)\s+LUFS/.exec(err.slice(err.lastIndexOf('Summary')));
      if (!mm || mm[1] === '-inf') resolve(null);
      else resolve(parseFloat(mm[1]));
    });
  });
}

export async function autoMatchLoudness(ids, target) {
  const s = store.seq;
  const clips = ids.map((id) => s.clips[id]).filter((c) => c && c.type === 'audio' && c.kind === 'media');
  if (!clips.length) return [];
  const job = registerJob(t('Measuring loudness'));
  const results = [];
  try {
    for (let i = 0; i < clips.length; i++) {
      const lufs = await measureLoudness(clips[i]);
      results.push({ id: clips[i].id, lufs });
      job.progress((i + 1) / clips.length);
    }
  } finally { job.done(); }
  store.commit('Auto-Match Loudness', (p) => {
    const sq = p.sequences[p.activeSequenceId];
    for (const r of results) {
      const c = sq.clips[r.id];
      if (!c || r.lufs == null) continue;
      const gain = Math.max(-40, Math.min(24, target - r.lufs));
      c.props.volume = { v: Math.round(gain * 10) / 10, kf: null };
      c.loudness = { lufs: r.lufs, target };
    }
  });
  return results;
}

// Müziği diyalog kliplerinin altında kıs: ses seviyesi keyframe'leri üretir
export function duckMusic(musicIds, { amount = -12, fade = 12, gap = 15 } = {}) {
  const s = store.seq;
  const dialog = Object.values(s.clips).filter((c) => c.type === 'audio' && c.enabled && c.soundType === 'dialogue');
  if (!dialog.length) { toast(t('Mark some clips as Dialogue first'), 'error'); return 0; }
  // diyalog aralıklarını birleştir
  const iv = dialog.map((c) => [c.start, c.start + c.duration]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of iv) {
    if (merged.length && r[0] <= merged[merged.length - 1][1] + gap) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], r[1]);
    else merged.push([...r]);
  }
  let n = 0;
  store.commit('Auto Duck Music', (p) => {
    const sq = p.sequences[p.activeSequenceId];
    for (const id of musicIds) {
      const c = sq.clips[id];
      if (!c || c.type !== 'audio') continue;
      const base = evalParam(c.props.volume, 0) ?? 0;
      const kf = [{ f: 0, v: base, e: 'linear' }];
      for (const [a, b] of merged) {
        const la = a - c.start, lb = b - c.start;
        if (lb < 0 || la > c.duration) continue;
        const down = base + amount;
        kf.push({ f: Math.max(0, la - fade), v: base, e: 'linear' }, { f: Math.max(0, la), v: down, e: 'linear' },
          { f: Math.min(c.duration - 1, lb), v: down, e: 'linear' }, { f: Math.min(c.duration - 1, lb + fade), v: base, e: 'linear' });
        n++;
      }
      kf.push({ f: c.duration - 1, v: base, e: 'linear' });
      // aynı karedeki keyframe'leri tekilleştir
      const map = new Map();
      for (const k of kf) map.set(Math.round(k.f), { ...k, f: Math.round(k.f) });
      c.props.volume = { v: base, kf: [...map.values()].sort((x, y) => x.f - y.f) };
    }
  });
  return n;
}

// ---- Sese göre senkron ----
function envelope(c) {
  const s = store.seq;
  const m = store.project.media[c.mediaId];
  const { start, dur } = clipSourceRange(c, s.fps);
  return envelopeOf(m.path, start, dur);
}

// Medya dosyaları arasındaki ses kayması (sn): media'nın t anı ref'in t+offset anına denk gelir
export async function audioOffset(refMedia, media) {
  const envR = await envelopeOf(refMedia.path, refMedia.subStart ?? 0, (refMedia.subEnd ?? refMedia.duration) - (refMedia.subStart ?? 0));
  const envX = await envelopeOf(media.path, media.subStart ?? 0, (media.subEnd ?? media.duration) - (media.subStart ?? 0));
  const { lag, score } = bestLag(envR, envX, Math.min(12000, envR.length + envX.length));
  return score < 0.05 ? null : lag * 0.005;
}

function envelopeOf(path, start, dur) {
  return new Promise((resolve, reject) => {
    const p = childProcess.spawn(ff.ffmpeg, ['-hide_banner', '-v', 'error', '-ss', start.toFixed(3), '-t', Math.min(600, dur).toFixed(3), '-i', path, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { windowsHide: true });
    const chunks = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.on('error', reject);
    p.on('close', () => {
      const buf = Buffer.concat(chunks);
      const n = Math.floor(buf.length / 2 / 40); // 5 ms pencereler
      const env = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < 40; j++) { const v = buf.readInt16LE((i * 40 + j) * 2) / 32768; sum += v * v; }
        env[i] = Math.sqrt(sum / 40);
      }
      // başlangıç (onset) vurgusu: türev, korelasyonu keskinleştirir
      const d = new Float32Array(n);
      for (let i = 1; i < n; i++) d[i] = Math.max(0, env[i] - env[i - 1]);
      let mean = 0; for (const v of d) mean += v; mean /= n || 1;
      let sd = 0; for (const v of d) sd += (v - mean) ** 2; sd = Math.sqrt(sd / (n || 1)) || 1;
      for (let i = 0; i < n; i++) d[i] = (d[i] - mean) / sd;
      resolve(d);
    });
  });
}

function bestLag(R, X, maxLag) {
  let best = 0, bestV = -Infinity;
  const minOverlap = 400; // 2 sn
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    // corr(lag) = Σ R[t+lag] * X[t]
    let s = 0, n = 0;
    const t0 = Math.max(0, -lag), t1 = Math.min(X.length, R.length - lag);
    for (let t2 = t0; t2 < t1; t2++) { s += R[t2 + lag] * X[t2]; n++; }
    if (n < minOverlap) continue;
    const v = s / n;
    if (v > bestV) { bestV = v; best = lag; }
  }
  return { lag: best, score: bestV };
}

export async function syncByAudio(ids) {
  const s = store.seq;
  const audio = [...new Set(ids)].map((id) => s.clips[id]).filter((c) => c && c.type === 'audio' && c.kind === 'media' && store.project.media[c.mediaId]?.hasAudio);
  if (audio.length < 2) { toast(t('Select at least two clips with audio'), 'error'); return; }
  audio.sort((a, b) => a.track - b.track || a.start - b.start);
  const ref = audio[0];
  const job = registerJob(t('Synchronizing'));
  try {
    const envR = await envelope(ref);
    const moves = [];
    for (let i = 1; i < audio.length; i++) {
      const X = audio[i];
      const envX = await envelope(X);
      const maxLag = Math.min(12000, envR.length + envX.length);
      const { lag, score } = bestLag(envR, envX, maxLag);
      job.progress(i / (audio.length - 1));
      if (score < 0.05) { toast(t('Could not find a match for') + ': ' + X.name, 'error'); continue; }
      const target = ref.start + Math.round(lag * 0.005 * s.fps);
      moves.push({ id: X.id, delta: target - X.start });
    }
    if (!moves.length) return;
    store.commit('Synchronize', (p) => {
      const sq = p.sequences[p.activeSequenceId];
      for (const mv of moves) {
        const c = sq.clips[mv.id];
        if (!c || !mv.delta) continue;
        const group = linkedClips(sq, c).map((x) => x.id);
        E.moveClips(sq, group, mv.delta, { video: 0, audio: 0 }, 'overwrite');
      }
    });
    toast(t('{n} clip(s) synchronized', { n: moves.length }));
  } finally { job.done(); }
}

// ---- Seslendirme kaydı ----
let rec = null;
export function isRecording() { return !!rec; }

export async function toggleRecording() {
  if (rec) { rec.stop(); return; }
  const s = store.seq;
  if (!s) return;
  let track = s.tracks.audio.findIndex((tr) => tr.targeted && !tr.locked);
  if (track < 0) track = s.tracks.audio.findIndex((tr) => !tr.locked);
  if (track < 0) { toast(t('No unlocked audio track'), 'error'); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    alertDialog(t('Microphone access failed') + '\n' + e.message);
    return;
  }
  const startFrame = app.engine.currentFrame;
  const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  const chunks = [];
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const t0 = performance.now();
  const overlay = document.createElement('div');
  overlay.className = 'overlay-msg';
  overlay.style.cssText = 'left:auto;right:12px;top:10px;color:#fff;background:#b3261e;font-size:13px';
  app.program.view.appendChild(overlay);
  const tick = setInterval(() => { overlay.textContent = '● ' + t('REC') + ' ' + ((performance.now() - t0) / 1000).toFixed(1) + 's'; }, 100);
  rec = {
    stop: () => { try { mr.stop(); } catch (e) { /* */ } },
  };
  mr.onstop = async () => {
    clearInterval(tick);
    overlay.remove();
    stream.getTracks().forEach((tr) => tr.stop());
    if (app.engine.playing) app.engine.pause();
    rec = null;
    try {
      const dir = ensureDir(store.projectPath ? nodePath.join(nodePath.dirname(store.projectPath), 'Seslendirmeler') : nodePath.join(app.paths.userData, 'recordings'));
      const base = 'Seslendirme_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const webm = nodePath.join(dir, base + '.webm');
      const wav = nodePath.join(dir, base + '.wav');
      nodeFs.writeFileSync(webm, Buffer.from(await new Blob(chunks).arrayBuffer()));
      // MediaRecorder dosyalarında süre bilgisi olmadığından WAV'a çevir
      await new Promise((res, rej) => {
        const p = childProcess.spawn(ff.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-i', webm, '-ar', '48000', '-c:a', 'pcm_s16le', wav], { windowsHide: true });
        p.on('close', (code) => (code === 0 ? res() : rej(new Error('ffmpeg ' + code))));
        p.on('error', rej);
      });
      try { nodeFs.unlinkSync(webm); } catch (e) { /* */ }
      const [m] = await importFiles([wav]);
      if (!m) return;
      let placed = [];
      store.commit('Record Voiceover', (p) => {
        placed = E.placeMedia(p, p.sequences[p.activeSequenceId], p.media[m.id], { start: startFrame, vTrack: null, aTrack: track, mode: 'overwrite', inSec: 0, outSec: m.duration, settings: {} });
        for (const id of placed) p.sequences[p.activeSequenceId].clips[id].soundType = 'dialogue';
      });
      store.select(placed);
      toast(t('Voiceover recorded') + ': ' + nodePath.basename(wav));
    } catch (e) {
      alertDialog(t('Recording failed') + '\n' + e.message);
    }
  };
  mr.start(250);
  app.engine.play(1);
}

// Essential Sound yardımcıları: türüne göre efekt ekle/kaldır/güncelle
export function setClipFx(clipIds, type, tag, params) {
  store.commit('Essential Sound', (p) => {
    const sq = p.sequences[p.activeSequenceId];
    for (const id of clipIds) {
      const c = sq.clips[id];
      if (!c || c.type !== 'audio') continue;
      let fx = c.effects.find((e) => e.type === type && e.tag === tag);
      if (params === null) { c.effects = c.effects.filter((e) => e !== fx); continue; }
      if (!fx) { fx = createEffect(type); fx.tag = tag; c.effects.push(fx); }
      for (const [k, v] of Object.entries(params)) fx.params[k] = { v, kf: null, static: true };
    }
  });
}

// ---- Gürültü tabanı ölçümü (DeNoise "otomatik") ----
const floorJobs = new Map();
export function needsNoiseFloor(c) {
  return (c.effects || []).some((e) => e.type === 'denoise' && e.enabled && (e.params.autoFloor ? e.params.autoFloor.v : true) && !e.params.measuredFloor);
}

// Klibin kaynak aralığında 50 ms pencerelerin RMS değerlerinin %20'lik dilimi (dBFS)
export function ensureNoiseFloor(clipId) {
  if (floorJobs.has(clipId)) return floorJobs.get(clipId);
  const s = store.seq;
  const c = s && s.clips[clipId];
  const m = c && store.project.media[c.mediaId];
  if (!c || !m || !needsNoiseFloor(c)) return Promise.resolve();
  const { start, dur } = clipSourceRange(c, s.fps);
  const pr = new Promise((resolve) => {
    const p = childProcess.spawn(ff.ffmpeg, ['-hide_banner', '-v', 'error', '-ss', start.toFixed(3), '-t', Math.min(300, Math.max(0.2, dur)).toFixed(3), '-i', m.path, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { windowsHide: true });
    const chunks = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.on('error', () => resolve());
    p.on('close', () => {
      const buf = Buffer.concat(chunks);
      const win = 2400; // 50 ms @ 48 kHz (tam bant: gürültünün tamamı ölçülsün)
      const vals = [];
      for (let i = 0; i + win * 2 <= buf.length; i += win * 2) {
        let sum = 0;
        for (let j = 0; j < win; j++) { const v = buf.readInt16LE(i + j * 2) / 32768; sum += v * v; }
        vals.push(Math.sqrt(sum / win));
      }
      vals.sort((a, b) => a - b);
      const q = vals.length ? vals[Math.floor(vals.length * 0.2)] : 0;
      const db = q > 1e-5 ? 20 * Math.log10(q) : -80;
      // proje verisine sessizce yaz (geri al geçmişine eklemeden)
      const cur = store.seq && store.seq.clips[clipId];
      if (cur) {
        for (const e of cur.effects) if (e.type === 'denoise') e.params.measuredFloor = { v: Math.round(db), kf: null, static: true };
        store.markDirty();
        store.emit('change', { type: 'noiseFloor' });
      }
      floorJobs.delete(clipId);
      resolve();
    });
  });
  floorJobs.set(clipId, pr);
  return pr;
}
