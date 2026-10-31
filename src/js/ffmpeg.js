// FFmpeg / FFprobe sarmalayıcıları
import { childProcess, nodeFs, nodePath, ensureDir, parseFraction, Emitter } from './util.js';

export const ff = {
  ffmpeg: null,
  ffprobe: null,
  cacheDir: null,
  proxyDir: null,
  encoders: new Set(),
  hwaccel: null,
};

export const jobs = new Emitter();
const activeJobs = new Map();
let jobSeq = 0;

export function jobList() {
  return [...activeJobs.values()];
}

function registerJob(name) {
  const id = ++jobSeq;
  const j = { id, name, progress: 0 };
  activeJobs.set(id, j);
  jobs.emit('change');
  return {
    progress(p) { j.progress = p; jobs.emit('change'); },
    done() { activeJobs.delete(id); jobs.emit('change'); },
  };
}

export async function initFF(paths) {
  ff.ffmpeg = paths.ffmpeg;
  ff.ffprobe = paths.ffprobe;
  ff.cacheDir = ensureDir(nodePath.join(paths.userData, 'cache'));
  ff.proxyDir = ensureDir(nodePath.join(paths.userData, 'proxies'));
  ensureDir(nodePath.join(ff.cacheDir, 'thumbs'));
  ensureDir(nodePath.join(ff.cacheDir, 'peaks'));
  try {
    const out = await runCapture(ff.ffmpeg, ['-hide_banner', '-encoders']);
    for (const line of out.split('\n')) {
      const m = /^\s*[VAS][\.FSXBD]{5}\s+(\S+)/.exec(line);
      if (m) ff.encoders.add(m[1]);
    }
  } catch (e) {
    console.warn('encoder list failed', e);
  }
  // NVENC gerçekten çalışıyor mu? (sürücü / GPU kontrolü)
  ff.nvenc = false;
  if (ff.encoders.has('h264_nvenc')) {
    try {
      await runCapture(ff.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.1', '-c:v', 'h264_nvenc', '-f', 'null', '-']);
      ff.nvenc = true;
    } catch (e) {
      ff.nvenc = false;
    }
  }
}

export function runCapture(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = childProcess.spawn(bin, args, { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(out || err);
      else reject(new Error(err.split('\n').slice(-6).join('\n') || 'exit ' + code));
    });
    if (opts.signal) opts.signal.addEventListener('abort', () => p.kill('SIGKILL'));
  });
}

// Uzun süren ffmpeg işi: ilerleme stderr'deki time= değerinden
export function runFFmpeg(args, { duration = 0, onProgress, onSpawn } = {}) {
  let proc;
  const promise = new Promise((resolve, reject) => {
    proc = childProcess.spawn(ff.ffmpeg, ['-hide_banner', '-y', ...args], { windowsHide: true });
    if (onSpawn) onSpawn(proc);
    let tail = '';
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-4000);
      if (onProgress && duration > 0) {
        const m = /time=\s*(-?\d+):(\d+):(\d+(?:\.\d+)?)/g;
        let last = null, mm;
        while ((mm = m.exec(s))) last = mm;
        if (last) {
          const t = parseInt(last[1], 10) * 3600 + parseInt(last[2], 10) * 60 + parseFloat(last[3]);
          onProgress(Math.max(0, Math.min(1, t / duration)));
        }
      }
    });
    proc.on('error', reject);
    proc.on('close', (code, sig) => {
      if (code === 0) resolve();
      else {
        const err = new Error(sig ? 'cancelled' : tail.split('\n').filter((l) => l.trim()).slice(-5).join('\n'));
        err.cancelled = !!sig;
        reject(err);
      }
    });
  });
  return { promise, kill: () => { try { proc.kill('SIGKILL'); } catch (e) { /* */ } }, get proc() { return proc; } };
}

export async function probe(path) {
  const out = await runCapture(ff.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path]);
  const j = JSON.parse(out);
  const streams = j.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = streams.find((s) => s.codec_type === 'audio');
  const fmt = j.format || {};
  const ext = nodePath.extname(path).toLowerCase();
  const imageExts = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp', '.tif', '.tiff', '.tga', '.psd', '.exr', '.dpx'];
  const isImage = imageExts.includes(ext) || (v && ['png', 'mjpeg', 'bmp', 'tiff', 'webp', 'targa', 'psd'].includes(v.codec_name) && !a && (!fmt.duration || parseFloat(fmt.duration) < 0.1 || v.nb_frames === '1'));
  let rotation = 0;
  if (v) {
    if (v.tags && v.tags.rotate) rotation = parseInt(v.tags.rotate, 10) || 0;
    for (const sd of v.side_data_list || []) if (sd.rotation != null) rotation = -parseInt(sd.rotation, 10) || 0;
    rotation = ((rotation % 360) + 360) % 360;
  }
  let width = v ? v.width : 0, height = v ? v.height : 0;
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  let fps = v ? parseFraction(v.avg_frame_rate) || parseFraction(v.r_frame_rate) : 0;
  if (!isFinite(fps) || fps <= 0 || fps > 240) fps = parseFraction(v?.r_frame_rate) || 30;
  let duration = parseFloat(fmt.duration || v?.duration || a?.duration || 0) || 0;
  return {
    type: isImage ? 'image' : v ? 'video' : a ? 'audio' : 'unknown',
    hasVideo: !!v,
    hasAudio: !!a,
    duration: isImage ? null : duration,
    width, height, rotation,
    fps: isImage ? null : (v ? fps : null),
    vcodec: v?.codec_name || null,
    pixFmt: v?.pix_fmt || null,
    acodec: a?.codec_name || null,
    channels: a?.channels || 0,
    sampleRate: a ? parseInt(a.sample_rate, 10) : 0,
    bitrate: parseInt(fmt.bit_rate || 0, 10) || 0,
    size: parseInt(fmt.size || 0, 10) || 0,
    formatName: fmt.format_name || '',
    sar: v?.sample_aspect_ratio || '1:1',
  };
}

const queue = [];
let running = 0;
const MAX_PAR = 2;
function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}
function pump() {
  while (running < MAX_PAR && queue.length) {
    const { fn, resolve, reject } = queue.shift();
    running++;
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { running--; pump(); });
  }
}

export function thumbPath(key, t) {
  return nodePath.join(ff.cacheDir, 'thumbs', key + '_' + Math.round(t * 1000) + '.jpg');
}

export function makeThumbnail(path, key, t = 0, width = 320) {
  const out = thumbPath(key, t);
  if (nodeFs.existsSync(out)) return Promise.resolve(out);
  return enqueue(async () => {
    await runFFmpeg(['-ss', String(Math.max(0, t)), '-i', path, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', out]).promise;
    return out;
  });
}

// Zaman çizelgesi film şeridi için: kaynakta eşit aralıklı küçük kareler
export function makeFilmstrip(path, key, duration, count = 24, height = 54) {
  const out = nodePath.join(ff.cacheDir, 'thumbs', key + '_strip' + count + '.jpg');
  if (nodeFs.existsSync(out)) return Promise.resolve({ path: out, count });
  return enqueue(async () => {
    const step = Math.max(0.04, duration / count);
    await runFFmpeg(['-i', path, '-vf', `fps=1/${step.toFixed(4)},scale=-2:${height},tile=${count}x1`, '-frames:v', '1', '-q:v', '5', out]).promise;
    return { path: out, count };
  });
}

export const PEAK_RATE = 200; // saniye başına tepe noktası

export function loadPeaks(path, key) {
  const out = nodePath.join(ff.cacheDir, 'peaks', key + '.pk');
  if (nodeFs.existsSync(out)) {
    const b = nodeFs.readFileSync(out);
    return Promise.resolve(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
  }
  return enqueue(() => new Promise((resolve, reject) => {
    const job = registerJob('Waveform: ' + nodePath.basename(path));
    const p = childProcess.spawn(ff.ffmpeg, ['-hide_banner', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { windowsHide: true });
    const bucket = 8000 / PEAK_RATE;
    const peaks = [];
    let cur = 0, n = 0;
    let leftover = null;
    p.stdout.on('data', (d) => {
      let buf = d;
      if (leftover) { buf = Buffer.concat([leftover, d]); leftover = null; }
      const len = buf.length - (buf.length % 2);
      if (len < buf.length) leftover = buf.subarray(len);
      for (let i = 0; i < len; i += 2) {
        const s = Math.abs(buf.readInt16LE(i));
        if (s > cur) cur = s;
        if (++n >= bucket) { peaks.push(Math.min(255, Math.round(Math.sqrt(cur / 32768) * 255))); cur = 0; n = 0; }
      }
    });
    p.on('error', (e) => { job.done(); reject(e); });
    p.on('close', () => {
      job.done();
      const arr = new Uint8Array(peaks);
      try { nodeFs.writeFileSync(out, arr); } catch (e) { /* */ }
      resolve(arr);
    });
  }));
}

export function videoEncoderArgs(kind, quality = 'medium') {
  const crf = { high: 18, medium: 23, low: 28 }[quality] || 23;
  if (kind === 'h264') {
    if (ff.nvenc) return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', String(crf + 2), '-b:v', '0'];
    return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf)];
  }
  return [];
}

// Oynatma için proxy (H.264 + AAC, kısa GOP => hızlı scrub)
export function makeProxy(media, outPath, { height = 720, onProgress } = {}) {
  const job = registerJob('Proxy: ' + media.name);
  const args = ['-i', media.path];
  if (media.hasVideo && media.type !== 'image') {
    args.push('-map', '0:v:0', '-vf', `scale=-2:'min(${height},ih)':flags=bicubic,format=yuv420p`, '-g', '12', '-bf', '0');
    if (ff.nvenc) args.push('-c:v', 'h264_nvenc', '-preset', 'p3', '-rc', 'vbr', '-cq', '26', '-b:v', '0');
    else args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-tune', 'fastdecode');
  }
  if (media.hasAudio) args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2');
  args.push('-movflags', '+faststart', outPath);
  const r = runFFmpeg(args, {
    duration: media.duration,
    onProgress: (p) => { job.progress(p); if (onProgress) onProgress(p); },
  });
  r.promise = r.promise.finally(() => job.done());
  return r;
}

export { registerJob };
