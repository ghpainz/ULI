// Dışa aktarma: kaynakları FFmpeg ile kare kare çözer, aynı WebGL compositor ile birleştirir,
// sesi örnek düzeyinde karıştırır ve FFmpeg ile kodlar.
import { store } from './store.js';
import { app } from './appContext.js';
import { ff } from './ffmpeg.js';
import { Compositor } from './compositor.js';
import { videoLayersAt, itemsOfLayers, clipSpan, clipAudioGain, trackAudible, anySolo, flattenMediaItems } from './renderGraph.js';
import { audioFxFilters } from './effectsDef.js';
import { needsNoiseFloor, ensureNoiseFloor } from './audioTools.js';
import { sourceTimeAt, sequenceDuration, remapActive, audioRemapClip, remapIntegral, multicamAudioTrack } from './model.js';
import { evalParam } from './keyframes.js';
import { rt, loadImage } from './media.js';
import { childProcess, nodeFs, nodePath, nodeOs, fpsToFraction, dbToGain, uid, ensureDir, sleep } from './util.js';
import { t } from './i18n.js';
import { ensureSegmenter } from './vision.js';

function even(n) { return Math.max(2, Math.round(n / 2) * 2); }

// ---- Kare okuyucu ----
class FrameReader {
  constructor(args, w, h) {
    this.w = w; this.h = h;
    this.frameBytes = w * h * 4;
    this.queue = [];
    this.partial = Buffer.allocUnsafe(this.frameBytes);
    this.pOff = 0;
    this.ended = false;
    this.waiters = [];
    this.idx = -1;
    this.last = null;
    this.err = '';
    this.proc = childProcess.spawn(ff.ffmpeg, ['-hide_banner', '-v', 'error', ...args], { windowsHide: true });
    this.proc.stdout.on('data', (chunk) => {
      let off = 0;
      while (off < chunk.length) {
        const n = Math.min(this.frameBytes - this.pOff, chunk.length - off);
        chunk.copy(this.partial, this.pOff, off, off + n);
        this.pOff += n;
        off += n;
        if (this.pOff === this.frameBytes) {
          this.queue.push(this.partial);
          this.partial = Buffer.allocUnsafe(this.frameBytes);
          this.pOff = 0;
        }
      }
      if (this.queue.length > 4) this.proc.stdout.pause();
      this._wake();
    });
    this.proc.stderr.on('data', (d) => { this.err = (this.err + d).slice(-2000); });
    this.proc.stdout.on('end', () => { this.ended = true; this._wake(); });
    this.proc.on('error', () => { this.ended = true; this._wake(); });
  }
  _wake() { const w = this.waiters; this.waiters = []; w.forEach((f) => f()); }
  async _next() {
    while (!this.queue.length && !this.ended) await new Promise((r) => this.waiters.push(r));
    if (this.queue.length) {
      const f = this.queue.shift();
      if (this.queue.length < 2) this.proc.stdout.resume();
      return f;
    }
    return null;
  }
  async frame(j) {
    j = Math.max(0, j);
    while (this.idx < j) {
      const f = await this._next();
      if (!f) break;
      this.last = f;
      this.idx++;
    }
    return this.last;
  }
  close() { try { this.proc.kill('SIGKILL'); } catch (e) { /* */ } }
}

function maxScaleOf(clip) {
  const vals = (p) => (p ? [p.v, ...(p.kf || []).map((k) => k.v)].filter((x) => typeof x === 'number') : [100]);
  let m = Math.max(...vals(clip.props.scale), 1);
  if (clip.props.uniformScale === false) m = Math.max(m, ...vals(clip.props.scaleWidth));
  return m / 100;
}

function atempoChain(speed) {
  const out = [];
  let s = speed;
  while (s > 100) { out.push('atempo=100'); s /= 100; }
  while (s < 0.5) { out.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-6) out.push('atempo=' + s.toFixed(6));
  return out;
}

// Zaman interpolasyonu (yavaşlatılmış kliplerde ara kareler): 'blend' kare harmanlama, 'flow' optik akış
export function interpFilter(mode, fpsExpr) {
  if (mode === 'blend') return `minterpolate=fps=${fpsExpr}:mi_mode=blend`;
  if (mode === 'flow') return `minterpolate=fps=${fpsExpr}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=fdiff`;
  return null;
}
// Videonun içindeki harekete bulanıklık: ardışık kareleri karıştır (deklanşör benzetimi)
export function contentBlurFilter(level) {
  if (level === 1) return "tmix=frames=3:weights='1 2 1'";
  if (level === 2) return "tmix=frames=5:weights='1 2 3 2 1'";
  return null;
}

function createReader(clip, media, seq, from, to, renderScale) {
  const fps = seq.fps;
  const native = [media.width || seq.width, media.height || seq.height];
  const k = Math.min(1, maxScaleOf(clip) * renderScale * 1.05);
  let w = even(native[0] * k), h = even(native[1] * k);
  const cap = 4096;
  if (w > cap || h > cap) { const r = cap / Math.max(w, h); w = even(w * r); h = even(h * r); }
  const vf = [];
  let args;
  if (clip.speed < 0.01) {
    // kare dondurma
    const s = Math.max(0, clip.inPoint);
    args = ['-ss', s.toFixed(6), '-i', media.path, '-an', '-frames:v', '1', '-vf', `scale=${w}:${h}:flags=bicubic,vflip,format=rgba`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'];
    const r = new FrameReader(args, w, h);
    r.map = () => 0;
    return r;
  }
  let lead = 0;
  if (remapActive(clip)) {
    // hız rampası: kaynağı kendi kare hızında çöz, her zaman çizelgesi karesi için kaynak zamanına göre kare seç
    const mfps = media.fps || 30;
    const s0 = Math.max(0, sourceTimeAt(clip, from, fps));
    // yumuşak ağır çekim: kaynağı 4 kat kare hızına ara karelerle çıkar, rampadaki zamana en yakın kareyi seç
    const up = interpFilter(clip.timeInterp, mfps * 4) ? 4 : 1;
    const rv = [`fps=${mfps}`, `scale=${w}:${h}:flags=bicubic`];
    if (up > 1) rv.push(interpFilter(clip.timeInterp, mfps * 4));
    const cb = contentBlurFilter(clip.contentBlur);
    if (cb) rv.push(cb);
    rv.push('vflip', 'format=rgba');
    args = ['-ss', s0.toFixed(6), '-i', media.path, '-an', '-sn', '-vf', rv.join(','), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'];
    const r = new FrameReader(args, w, h);
    r.map = (f) => Math.round((sourceTimeAt(clip, f, fps) - s0) * mfps * up);
    return r;
  }
  if (!clip.reverse) {
    let s0 = sourceTimeAt(clip, from, fps);
    if (s0 < 0) { lead = Math.ceil((-s0 / clip.speed) * fps - 1e-6); s0 = sourceTimeAt(clip, from + lead, fps); }
    vf.push(`setpts=(PTS-STARTPTS)/${clip.speed}`, `scale=${w}:${h}:flags=bicubic`);
    // yavaşlatılmışsa ara kareler üret (aksi halde kareler tekrarlanır)
    if (clip.speed < 0.999 && interpFilter(clip.timeInterp, 'x')) vf.push(interpFilter(clip.timeInterp, fpsToFraction(fps)));
    vf.push(`fps=${fpsToFraction(fps)}`);
    if (contentBlurFilter(clip.contentBlur)) vf.push(contentBlurFilter(clip.contentBlur));
    vf.push('vflip', 'format=rgba');
    args = ['-ss', Math.max(0, s0).toFixed(6), '-i', media.path, '-an', '-sn', '-vf', vf.join(','), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'];
  } else {
    const sHi = sourceTimeAt(clip, from, fps) + clip.speed / fps;
    const sLo = Math.max(0, sourceTimeAt(clip, to - 1, fps));
    const dur = Math.max(0.04, sHi - sLo);
    vf.push(`trim=duration=${dur.toFixed(6)}`, 'reverse', `setpts=(PTS-STARTPTS)/${clip.speed}`, `scale=${w}:${h}:flags=bicubic`);
    if (clip.speed < 0.999 && interpFilter(clip.timeInterp, 'x')) vf.push(interpFilter(clip.timeInterp, fpsToFraction(fps)));
    vf.push(`fps=${fpsToFraction(fps)}`);
    if (contentBlurFilter(clip.contentBlur)) vf.push(contentBlurFilter(clip.contentBlur));
    vf.push('vflip', 'format=rgba');
    args = ['-ss', sLo.toFixed(6), '-i', media.path, '-an', '-sn', '-vf', vf.join(','), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'];
  }
  const r = new FrameReader(args, w, h);
  r.map = (f) => f - from - lead;
  return r;
}

// ---- Ses karıştırma ----
// Kaynak örneklerini (srcStart'tan itibaren) zaman çizelgesi örneklerine eşle: hız rampalı ses
async function remapAudioFile(rc, file, srcStart, a, b, fps, sr, realtimeFx, procs) {
  const buf = nodeFs.readFileSync(file);
  const src = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  const nSrc = src.length / 2;
  const N = Math.max(0, Math.round(((b - a) / fps) * sr));
  const out = new Float32Array(N * 2);
  const p = rc.props.timeRemap;
  const srcAt = (j) => rc.inPoint + (remapIntegral(p, a - rc.start + (j / sr) * fps) / fps) * rc.speed;
  const STEP = 64;
  let tA = srcAt(0);
  for (let k = 0; k < N; k += STEP) {
    const e = Math.min(N, k + STEP);
    const tB = srcAt(e);
    for (let j = k; j < e; j++) {
      const tm = tA + ((tB - tA) * (j - k)) / (e - k);
      const pos = (tm - srcStart) * sr;
      const i0 = Math.floor(pos);
      if (i0 < 0 || i0 + 1 >= nSrc) continue;
      const fr = pos - i0;
      out[j * 2] = src[i0 * 2] * (1 - fr) + src[i0 * 2 + 2] * fr;
      out[j * 2 + 1] = src[i0 * 2 + 1] * (1 - fr) + src[i0 * 2 + 3] * fr;
    }
    tA = tB;
  }
  if (!realtimeFx.length) { nodeFs.writeFileSync(file, Buffer.from(out.buffer)); return; }
  const tmp = file + '.tl';
  nodeFs.writeFileSync(tmp, Buffer.from(out.buffer));
  const args = ['-hide_banner', '-v', 'error', '-y', '-f', 'f32le', '-ar', String(sr), '-ac', '2', '-i', tmp, '-af', realtimeFx.join(','), '-ac', '2', '-ar', String(sr), '-f', 'f32le', file];
  await new Promise((resolve, reject) => {
    const pr = childProcess.spawn(ff.ffmpeg, args, { windowsHide: true });
    procs.add(pr);
    let err = '';
    pr.stderr.on('data', (d) => (err += d));
    pr.on('close', (code) => { procs.delete(pr); code === 0 ? resolve() : reject(new Error(err.slice(-400))); });
    pr.on('error', reject);
  });
  try { nodeFs.unlinkSync(tmp); } catch (e) { /* */ }
}

async function renderAudio(project, seq, f0, f1, sr, outFile, { onProgress, signal, procs, depth = 0, onlyTrack = null }) {
  const fps = seq.fps;
  const tmpDir = nodePath.dirname(outFile);
  const totalSamples = Math.max(0, Math.round(((f1 - f0) / fps) * sr));
  const solo = anySolo(seq);
  const clips = [];
  for (const id in seq.clips) {
    const c = seq.clips[id];
    if (c.type !== 'audio' || !c.enabled || (c.kind !== 'media' && c.kind !== 'sequence')) continue;
    if (c.speed < 0.01) continue;
    if (onlyTrack != null && c.track !== onlyTrack) continue;
    let m;
    if (c.kind === 'sequence') {
      const ns = project.sequences[c.seqId];
      if (!ns || (depth || 0) >= 6) continue;
      m = { nested: ns, name: ns.name, hasAudio: true };
    } else {
      m = project.media[c.mediaId];
      if (!m || !m.hasAudio) continue;
    }
    if (onlyTrack == null && !trackAudible(seq, c.track, solo)) continue;
    const sp = clipSpan(seq, c);
    const a = Math.max(sp.from, f0), b = Math.min(sp.to, f1);
    if (b <= a) continue;
    clips.push({ c, m, sp, a, b });
  }
  // her klibin kaynağını çöz
  let i = 0;
  for (const x of clips) {
    if (signal.aborted) throw new Error('cancelled');
    const { c, m, a, b } = x;
    const file = nodePath.join(tmpDir, 'a_' + c.id + '.f32');
    const rc = audioRemapClip(seq, c);
    const remap = remapActive(rc);
    let srcStart, srcDur, lead = 0;
    if (remap) {
      // hız rampası: kaynak penceresini hızlandırmadan çöz, sonra zaman eşlemesiyle yeniden örnekle
      const sA = sourceTimeAt(rc, a, fps), sB = sourceTimeAt(rc, b, fps);
      srcStart = Math.max(0, sA - 0.05);
      srcDur = sB - srcStart + 0.1;
    } else if (!c.reverse) {
      const sA = sourceTimeAt(c, a, fps);
      srcStart = Math.max(0, sA);
      lead = (srcStart - sA) / c.speed; // zaman çizelgesi saniyesi
      srcDur = ((b - a) / fps) * c.speed - (srcStart - sA);
    } else {
      const sHi = sourceTimeAt(c, a, fps) + c.speed / fps;
      const sLo = sourceTimeAt(c, b - 1, fps);
      srcStart = Math.max(0, sLo);
      srcDur = sHi - srcStart;
    }
    if (srcDur <= 0) { x.skip = true; continue; }
    const af = [];
    af.push(...audioFxFilters(c.effects, 'offline'));
    if (c.reverse) af.push('areverse');
    if (!remap) {
      af.push(...atempoChain(c.speed));
      af.push(...audioFxFilters(c.effects, 'realtime'));
    }
    af.push(`aresample=${sr}`);
    let input = ['-ss', srcStart.toFixed(6), '-t', srcDur.toFixed(6), '-i', m.path];
    let nestedFile = null;
    if (m.nested) {
      // nested sekansın sesini önce kendi zaman aralığında karıştır
      const ns = m.nested;
      const n0 = Math.max(0, Math.floor(srcStart * ns.fps));
      const n1 = Math.max(n0 + 1, Math.ceil((srcStart + srcDur) * ns.fps) + 1);
      nestedFile = nodePath.join(tmpDir, 'n_' + c.id + '_' + depth + '.f32');
      await renderAudio(project, ns, n0, n1, sr, nestedFile, { signal, procs, depth: depth + 1, onlyTrack: multicamAudioTrack(ns, c) });
      input = ['-f', 'f32le', '-ar', String(sr), '-ac', '2', '-ss', Math.max(0, srcStart - n0 / ns.fps).toFixed(6), '-t', srcDur.toFixed(6), '-i', nestedFile];
    }
    const args = ['-hide_banner', '-v', 'error', '-y', ...input, '-vn', '-af', af.join(','), '-ac', '2', '-ar', String(sr), '-f', 'f32le', file];
    await new Promise((resolve, reject) => {
      const p = childProcess.spawn(ff.ffmpeg, args, { windowsHide: true });
      procs.add(p);
      let err = '';
      p.stderr.on('data', (d) => (err += d));
      p.on('close', (code) => { procs.delete(p); code === 0 ? resolve() : reject(new Error(t('Audio decode failed') + ': ' + m.name + '\n' + err.slice(-400))); });
      p.on('error', reject);
    });
    if (nestedFile) try { nodeFs.unlinkSync(nestedFile); } catch (e) { /* */ }
    if (remap) await remapAudioFile(rc, file, srcStart, a, b, fps, sr, audioFxFilters(c.effects, 'realtime'), procs);
    x.file = file;
    x.fd = nodeFs.openSync(file, 'r');
    x.samples = Math.floor(nodeFs.statSync(file).size / 8);
    // zaman çizelgesindeki ilk örnek (f0'a göre)
    x.startSample = Math.round((((a - f0) / fps) + lead) * sr);
    i++;
    onProgress && onProgress((i / Math.max(1, clips.length)) * 0.5);
  }
  const out = nodeFs.openSync(outFile, 'w');
  const BLOCK = sr; // 1 sn
  const outBuf = new Float32Array(BLOCK * 2);
  const inBuf = Buffer.allocUnsafe(BLOCK * 8);
  const master = dbToGain(seq.masterVolume || 0);
  const STEP = 32;
  for (let bs = 0; bs < totalSamples; bs += BLOCK) {
    if (signal.aborted) break;
    const n = Math.min(BLOCK, totalSamples - bs);
    outBuf.fill(0);
    for (const x of clips) {
      if (x.skip || !x.fd) continue;
      const cs = x.startSample, ce = x.startSample + x.samples;
      const s0 = Math.max(bs, cs), s1 = Math.min(bs + n, ce);
      if (s1 <= s0) continue;
      const cnt = s1 - s0;
      nodeFs.readSync(x.fd, inBuf, 0, cnt * 8, (s0 - cs) * 8);
      const src = new Float32Array(inBuf.buffer, inBuf.byteOffset, cnt * 2);
      const tr = seq.tracks.audio[x.c.track];
      const tg = dbToGain(tr.volume || 0) * master;
      let gPrev = null, pPrev = null;
      for (let k = 0; k < cnt; k += STEP) {
        const fA = f0 + ((s0 + k) / sr) * fps;
        const fB = f0 + ((s0 + Math.min(cnt, k + STEP)) / sr) * fps;
        const gA = gPrev ?? clipAudioGain(x.c, x.sp, fA) * tg;
        const gB = clipAudioGain(x.c, x.sp, fB) * tg;
        const pA = pPrev ?? Math.max(-1, Math.min(1, ((evalParam(x.c.props.pan, fA - x.c.start) || 0) + (tr.pan || 0)) / 100));
        const pB = Math.max(-1, Math.min(1, ((evalParam(x.c.props.pan, fB - x.c.start) || 0) + (tr.pan || 0)) / 100));
        const end = Math.min(cnt, k + STEP);
        for (let j = k; j < end; j++) {
          const u = (j - k) / STEP;
          const g = gA + (gB - gA) * u;
          const p = pA + (pB - pA) * u;
          let L = src[j * 2] * g, R = src[j * 2 + 1] * g;
          // Web Audio StereoPannerNode ile aynı yasa
          if (p !== 0) {
            const xx = p <= 0 ? p + 1 : p;
            const gl = Math.cos((xx * Math.PI) / 2), gr = Math.sin((xx * Math.PI) / 2);
            if (p <= 0) { const nl = L + R * gl; R = R * gr; L = nl; }
            else { const nr = R + L * gr; L = L * gl; R = nr; }
          }
          const o = (s0 - bs + j) * 2;
          outBuf[o] += L;
          outBuf[o + 1] += R;
        }
        gPrev = gB; pPrev = pB;
      }
    }
    nodeFs.writeSync(out, Buffer.from(outBuf.buffer, 0, n * 8));
    onProgress && onProgress(0.5 + (bs / Math.max(1, totalSamples)) * 0.5);
    if ((bs / BLOCK) % 20 === 0) await sleep(0);
  }
  nodeFs.closeSync(out);
  for (const x of clips) {
    if (x.fd) nodeFs.closeSync(x.fd);
    if (x.file) try { nodeFs.unlinkSync(x.file); } catch (e) { /* */ }
  }
}

// ---- Kodlayıcı argümanları ----
export const FORMATS = {
  mp4_h264: { label: 'H.264 (MP4)', ext: 'mp4', video: true, audio: true },
  mp4_hevc: { label: 'H.265 / HEVC (MP4)', ext: 'mp4', video: true, audio: true },
  mov_prores: { label: 'Apple ProRes (MOV)', ext: 'mov', video: true, audio: true },
  webm_vp9: { label: 'VP9 (WebM)', ext: 'webm', video: true, audio: true },
  gif: { label: 'Animated GIF', ext: 'gif', video: true, audio: false },
  png_seq: { label: 'PNG Sequence', ext: 'png', video: true, audio: false },
  wav: { label: 'Waveform Audio (WAV)', ext: 'wav', video: false, audio: true },
  mp3: { label: 'MP3', ext: 'mp3', video: false, audio: true },
  m4a: { label: 'AAC Audio (M4A)', ext: 'm4a', video: false, audio: true },
  flac: { label: 'FLAC', ext: 'flac', video: false, audio: true },
};

function videoArgs(o) {
  const crf = o.crf;
  const br = o.bitrateMode ? [`-b:v`, `${o.bitrate}M`, '-maxrate', `${Math.round(o.bitrate * 1.5)}M`, '-bufsize', `${o.bitrate * 2}M`] : null;
  switch (o.format) {
    case 'mp4_h264':
      if (o.hw && ff.nvenc) return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-profile:v', 'high', ...(br ? ['-rc', 'vbr', ...br] : ['-rc', 'vbr', '-cq', String(crf), '-b:v', '0']), '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
      return ['-c:v', 'libx264', '-preset', o.preset || 'medium', ...(br || ['-crf', String(crf)]), '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
    case 'mp4_hevc':
      if (o.hw && ff.nvenc) return ['-c:v', 'hevc_nvenc', '-preset', 'p5', '-tune', 'hq', ...(br ? ['-rc', 'vbr', ...br] : ['-rc', 'vbr', '-cq', String(crf + 2), '-b:v', '0']), '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-movflags', '+faststart'];
      return ['-c:v', 'libx265', '-preset', o.preset || 'medium', ...(br || ['-crf', String(crf + 4)]), '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-movflags', '+faststart'];
    case 'mov_prores': {
      const prof = o.proresProfile ?? 3;
      return ['-c:v', 'prores_ks', '-profile:v', String(prof), '-vendor', 'apl0', '-pix_fmt', prof >= 4 ? 'yuva444p10le' : 'yuv422p10le'];
    }
    case 'webm_vp9':
      return ['-c:v', 'libvpx-vp9', ...(br || ['-crf', String(crf + 8), '-b:v', '0']), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p'];
    case 'png_seq':
      return o.flatten ? ['-c:v', 'png', '-pix_fmt', 'rgb24'] : ['-c:v', 'png', '-pix_fmt', 'rgba'];
    default:
      return [];
  }
}

function audioArgs(o) {
  switch (o.format) {
    case 'mov_prores': return ['-c:a', 'pcm_s24le'];
    case 'webm_vp9': return ['-c:a', 'libopus', '-b:a', `${Math.min(o.audioBitrate, 510)}k`];
    case 'wav': return ['-c:a', o.audioBits === 24 ? 'pcm_s24le' : 'pcm_s16le'];
    case 'mp3': return ['-c:a', 'libmp3lame', '-b:a', `${Math.min(o.audioBitrate, 320)}k`];
    case 'flac': return ['-c:a', 'flac'];
    case 'm4a':
    default: return ['-c:a', 'aac', '-b:a', `${o.audioBitrate}k`];
  }
}

// ---- Ana dışa aktarma ----
export async function exportSequence(seqIn, o, { onProgress, onStatus, signal }) {
  // o.project: dışa aktarma kuyruğu, eklendiği andaki projenin kopyasını verir
  const project = o.project || store.project;
  const seq = structuredClone(seqIn);
  if (o.burnCaptions === false) seq.captionsVisible = false;
  else if (o.burnCaptions === true) seq.captionsVisible = true;
  const fmt = FORMATS[o.format];
  const fps = seq.fps;
  const f0 = Math.max(0, o.range[0]), f1 = Math.max(f0 + 1, o.range[1]);
  const total = f1 - f0;
  const tmpDir = ensureDir(nodePath.join(nodeOs.tmpdir(), 'uli_export_' + uid('x')));
  const procs = new Set();
  const readers = new Map();
  let encoder = null;
  let comp = null;
  let canvas = null;
  const abort = () => {
    for (const p of procs) try { p.kill('SIGKILL'); } catch (e) { /* */ }
    for (const r of readers.values()) r.close();
    if (encoder) try { encoder.kill('SIGKILL'); } catch (e) { /* */ }
  };
  signal.addEventListener('abort', abort);
  const t0 = performance.now();
  try {
    // 0a) arka plan silme kullanılıyorsa yapay zekâ modeli dışa aktarmadan önce hazır olsun (her kare aynı sonucu versin)
    {
      const pr = o.project || store.project;
      const qs = new Set();
      for (const s of Object.values(pr.sequences || {})) for (const c of Object.values(s.clips || {})) for (const fx of c.effects || []) if (fx.type === 'bgRemove') qs.add(0);
      for (const q of qs) await ensureSegmenter(q);
    }
    // 0) otomatik gürültü tabanı gereken klipler (en dış sekans)
    if (!o.project) {
      for (const id in seqIn.clips) if (needsNoiseFloor(seqIn.clips[id])) await ensureNoiseFloor(id);
      for (const id in seq.clips) { const live = store.seq && store.seq.clips[id]; if (live) seq.clips[id].effects = structuredClone(live.effects); }
    }
    // 1) ses
    let audioFile = null;
    if (fmt.audio && o.audio) {
      onStatus && onStatus(t('Rendering audio...'));
      audioFile = nodePath.join(tmpDir, 'mix.f32');
      await renderAudio(project, seq, f0, f1, o.sampleRate, audioFile, {
        signal, procs,
        onProgress: (p) => onProgress && onProgress(fmt.video ? p * 0.08 : p * 0.9, null),
      });
      if (signal.aborted) throw new Error('cancelled');
    }
    // yalnız ses
    if (!fmt.video) {
      onStatus && onStatus(t('Encoding...'));
      await runEnc(['-hide_banner', '-y', '-f', 'f32le', '-ar', String(o.sampleRate), '-ac', '2', '-i', audioFile, ...audioArgs(o), '-ar', String(o.sampleRate), o.file], procs);
      onProgress && onProgress(1, 0);
      return { file: o.file, seconds: (performance.now() - t0) / 1000 };
    }
    // 2) görüntü
    const outW = even(o.width), outH = even(o.height);
    const scale = Math.min(outW / seq.width, outH / seq.height);
    canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    comp = new Compositor(canvas, { onError: (e) => console.error('export comp', e) });
    comp.ensureSize(seq, scale);
    const rw = comp.W, rh = comp.H;
    const vf = ['vflip'];
    // alfa kanallı çıktılar düz (straight) alfa ister; compositor premultiplied üretir
    const keepsAlpha = (o.format === 'png_seq' && !o.flatten) || (o.format === 'mov_prores' && (o.proresProfile ?? 3) >= 4);
    if (keepsAlpha) vf.push('unpremultiply=inplace=1');
    if (rw !== outW || rh !== outH) vf.push(`scale=${outW}:${outH}:force_original_aspect_ratio=decrease:flags=lanczos`, `pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:color=black`);
    let outFile = o.file;
    const args = ['-hide_banner', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${rw}x${rh}`, '-r', fpsToFraction(fps), '-i', '-'];
    if (audioFile) args.push('-f', 'f32le', '-ar', String(o.sampleRate), '-ac', '2', '-i', audioFile);
    if (o.format === 'gif') {
      const gfps = Math.min(fps, o.gifFps || 15);
      args.push('-filter_complex', `[0:v]${vf.join(',')},fps=${gfps},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, '-loop', '0');
    } else {
      args.push('-vf', vf.join(','));
    }
    if (o.format === 'png_seq') {
      const dir = o.file.replace(/\.png$/i, '');
      ensureDir(dir);
      outFile = nodePath.join(dir, nodePath.basename(dir) + '_%05d.png');
    }
    args.push(...videoArgs(o));
    if (audioFile) args.push('-map', '0:v', '-map', '1:a', ...audioArgs(o), '-ar', String(o.sampleRate));
    args.push('-r', fpsToFraction(fps), outFile);
    encoder = childProcess.spawn(ff.ffmpeg, args, { windowsHide: true });
    let encErr = '';
    encoder.stderr.on('data', (d) => { encErr = (encErr + d).slice(-4000); });
    const encDone = new Promise((resolve, reject) => {
      encoder.on('close', (code) => (code === 0 ? resolve() : reject(new Error(signal.aborted ? 'cancelled' : encErr.split('\n').filter((l) => l.trim()).slice(-6).join('\n')))));
      encoder.on('error', reject);
    });
    let encClosed = false;
    encDone.catch(() => { encClosed = true; });
    encoder.on('close', () => { encClosed = true; });
    const write = (buf) => new Promise((resolve, reject) => {
      if (encClosed) { reject(new Error(encErr || 'encoder closed')); return; }
      const ok = encoder.stdin.write(buf, (err) => { if (err) reject(err); });
      if (ok) resolve(); else encoder.stdin.once('drain', resolve);
    });
    encoder.stdin.on('error', () => { /* encDone hata verir */ });
    // görüntü kaynaklarının önceden yüklenmesi
    for (const id in seq.clips) {
      const c = seq.clips[id];
      const m = c.mediaId ? project.media[c.mediaId] : null;
      if (m && m.type === 'image' && c.type === 'video') {
        const img = loadImage(m.id);
        for (let k = 0; k < 200 && !rt(m.id).imageReady; k++) await sleep(25);
      }
    }
    onStatus && onStatus(t('Rendering video...'));
    const pix = new Uint8Array(rw * rh * 4);
    const spans = new Map();
    const spanOf = (c) => { let s = spans.get(c.id); if (!s) { s = clipSpan(seq, c); spans.set(c.id, s); } return s; };
    for (let f = f0; f < f1; f++) {
      if (signal.aborted) throw new Error('cancelled');
      const layers = videoLayersAt(project, seq, f);
      const items = flattenMediaItems(project, itemsOfLayers(layers));
      const frames = new Map();
      for (const it of items) {
        const c = it.clip, m = it.media;
        if (c.kind !== 'media' || !m || m.type === 'image') continue;
        const owner = it.ownerSeq || seq;
        const of = it.f ?? f;
        let r = readers.get(c.id);
        // nested sekansta geri sarma (ters hız vb.) olursa okuyucuyu yeniden başlat
        if (r && Math.max(0, r.map(of)) < r.idx) { r.close(); procs.delete(r.proc); readers.delete(c.id); r = null; }
        if (!r) {
          const sp = clipSpan(owner, c);
          r = createReader(c, m, owner, Math.max(sp.from, of), sp.to, scale * (it.scaleMul || 1));
          procs.add(r.proc);
          readers.set(c.id, r);
        }
        r.lastUsed = f;
        const buf = await r.frame(r.map(of));
        if (buf) frames.set(c.id, { data: new Uint8Array(buf.buffer, buf.byteOffset, buf.length), w: r.w, h: r.h, nativeW: m.width || r.w, nativeH: m.height || r.h });
      }
      comp.renderFrame(seq, layers, (it) => {
        const m = it.media;
        if (!m) return null;
        if (m.type === 'image') {
          const rr = rt(m.id);
          if (!rr.image || !rr.imageReady) return null;
          return { type: 'element', el: rr.image, w: rr.image.naturalWidth, h: rr.image.naturalHeight, nativeW: m.width || rr.image.naturalWidth, nativeH: m.height || rr.image.naturalHeight, stable: true, version: 1, key: 'img:' + m.id };
        }
        const fr = frames.get(it.clip.id);
        if (!fr) return null;
        return { type: 'pixels', data: fr.data, w: fr.w, h: fr.h, nativeW: fr.nativeW, nativeH: fr.nativeH, key: it.clip.id };
      }, { scale, time: f / fps, project });
      comp.readPixels(pix);
      await write(Buffer.from(pix.buffer, pix.byteOffset, pix.length));
      // artık gerekmeyen okuyucuları kapat
      for (const [id, r] of readers) {
        if (f - (r.lastUsed ?? f) >= 3) { r.close(); procs.delete(r.proc); readers.delete(id); comp.releaseKey(id); }
      }
      const done = (f - f0 + 1) / total;
      const el = (performance.now() - t0) / 1000;
      const eta = done > 0.01 ? (el / done) * (1 - done) : null;
      onProgress && onProgress((audioFile ? 0.08 : 0) + done * (audioFile ? 0.92 : 1), eta, f - f0 + 1, total);
      if ((f - f0) % 4 === 0) await sleep(0);
    }
    encoder.stdin.end();
    onStatus && onStatus(t('Finalizing...'));
    await encDone;
    onProgress && onProgress(1, 0, total, total);
    return { file: outFile, seconds: (performance.now() - t0) / 1000 };
  } catch (e) {
    abort();
    if (signal.aborted) { const err = new Error('cancelled'); err.cancelled = true; throw err; }
    throw e;
  } finally {
    for (const r of readers.values()) r.close();
    if (comp) comp.destroy();
    try { nodeFs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* */ }
    signal.removeEventListener('abort', abort);
  }
}

function runEnc(args, procs) {
  return new Promise((resolve, reject) => {
    const p = childProcess.spawn(ff.ffmpeg, args, { windowsHide: true });
    procs.add(p);
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
    p.on('close', (code) => { procs.delete(p); code === 0 ? resolve() : reject(new Error(err.split('\n').filter((l) => l.trim()).slice(-5).join('\n'))); });
    p.on('error', reject);
  });
}

// Tek kare dışa aktarma (tam kalite, orijinal kaynaktan)
export async function exportFrame(seq, f, file) {
  const ctrl = new AbortController();
  const ext = nodePath.extname(file).toLowerCase();
  const tmp = nodePath.join(nodeOs.tmpdir(), 'uli_frame_' + uid('f') + '.png');
  await exportSequence(seq, { format: 'png_seq', flatten: true, file: tmp, width: seq.width, height: seq.height, range: [f, f + 1], audio: false, sampleRate: 48000 }, { signal: ctrl.signal });
  const dir = tmp.replace(/\.png$/i, '');
  const produced = nodePath.join(dir, nodePath.basename(dir) + '_00001.png');
  if (ext === '.png') nodeFs.copyFileSync(produced, file);
  else await runEnc(['-hide_banner', '-y', '-i', produced, '-q:v', '2', file], new Set());
  try { nodeFs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ }
  return file;
}
