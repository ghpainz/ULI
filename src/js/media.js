// Medya içe aktarma, oynatılabilirlik testi, proxy, küçük resim ve dalga formu yönetimi
import { store } from './store.js';
import { probe, makeThumbnail, loadPeaks, makeProxy, makeFilmstrip, ff, runFFmpeg, registerJob } from './ffmpeg.js';
import { ensureDir } from './util.js';
import { uid, nodeFs, nodePath, mediaUrl, hashString, fileExists, Emitter } from './util.js';
import { t } from './i18n.js';

export const mediaEvents = new Emitter();

// Çalışma zamanı bilgisi (projeye kaydedilmez)
const runtime = new Map();

export function rt(id) {
  // alt klipler ana medyanın çalışma zamanı bilgisini (küçük resim, dalga formu, proxy) paylaşır
  const pm = store.project?.media?.[id];
  if (pm?.parentId && store.project.media[pm.parentId]) id = pm.parentId;
  let r = runtime.get(id);
  if (!r) {
    r = { thumb: null, peaks: null, playable: null, proxyProgress: null, proxyJob: null, image: null, imageReady: false, filmstrip: null, offline: false, testing: false };
    runtime.set(id, r);
  }
  return r;
}

export const VIDEO_EXT = ['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.mxf', '.mts', '.m2ts', '.ts', '.wmv', '.flv', '.3gp', '.mpg', '.mpeg', '.ogv', '.dv', '.r3d', '.braw'];
export const AUDIO_EXT = ['.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg', '.opus', '.aif', '.aiff', '.wma', '.ac3', '.caf'];
export const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp', '.tif', '.tiff', '.tga', '.psd'];
export const ALL_EXT = [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT];

function mediaKey(p) {
  let st = null;
  try { st = nodeFs.statSync(p); } catch (e) { /* */ }
  return hashString(p + '|' + (st ? st.size + '|' + st.mtimeMs : ''));
}

export async function importFiles(paths, binId = store.ui.currentBin || 'root') {
  const results = [];
  const errors = [];
  for (const p of paths) {
    try {
      const st = nodeFs.statSync(p);
      if (st.isDirectory()) {
        // klasör => yeni bin ile içe aktar
        const newBin = { id: uid('bin'), name: nodePath.basename(p), parent: binId };
        store.commit('Import Folder', (pr) => { pr.bins[newBin.id] = newBin; });
        const files = nodeFs.readdirSync(p).map((f) => nodePath.join(p, f));
        const r = await importFiles(files, newBin.id);
        results.push(...r);
        continue;
      }
      const ext = nodePath.extname(p).toLowerCase();
      if (!ALL_EXT.includes(ext)) continue;
      const existing = Object.values(store.project.media).find((m) => m.path === p);
      if (existing) { results.push(existing); continue; }
      const info = await probe(p);
      if (info.type === 'unknown') throw new Error(t('No video or audio stream found'));
      const m = {
        id: uid('med'),
        name: nodePath.basename(p),
        path: p,
        key: mediaKey(p),
        binId,
        ...info,
        inPoint: null,
        outPoint: null,
        proxyPath: null,
        label: null,
        importedAt: Date.now(),
      };
      store.commit('Import', (pr) => { pr.media[m.id] = m; });
      results.push(m);
      prepareMedia(m.id);
    } catch (e) {
      console.error(e);
      errors.push(nodePath.basename(p) + ': ' + e.message);
    }
  }
  if (errors.length) mediaEvents.emit('error', errors.join('\n'));
  return results;
}

// Arka plan hazırlıkları: küçük resim, dalga formu, oynatılabilirlik, proxy
export async function prepareMedia(id) {
  const m = store.project.media[id];
  if (!m) return;
  const r = rt(id);
  if (!fileExists(m.path)) {
    r.offline = true;
    mediaEvents.emit('update', id);
    if (m.proxyPath && fileExists(m.proxyPath)) { r.playable = { video: false, audio: false }; }
    return;
  }
  r.offline = false;
  if (!m.key) m.key = mediaKey(m.path);
  const parent = m.parentId ? store.project.media[m.parentId] : null;
  if (parent) { m.proxyPath = parent.proxyPath; mediaEvents.emit('update', id); return; }
  if (m.type === 'image') {
    r.thumb = mediaUrl(m.path);
    loadImage(id);
    r.playable = { video: true, audio: false };
    mediaEvents.emit('update', id);
    return;
  }
  if (m.hasVideo) {
    makeThumbnail(m.path, m.key, Math.min(1, (m.duration || 0) * 0.1)).then((p) => {
      r.thumb = mediaUrl(p);
      mediaEvents.emit('update', id);
    }).catch((e) => console.warn('thumb', e));
  }
  if (m.hasAudio) {
    loadPeaks(m.path, m.key).then((pk) => {
      r.peaks = pk;
      mediaEvents.emit('peaks', id);
    }).catch((e) => console.warn('peaks', e));
  }
  // kayıtlı proxy var mı
  const proxyFile = nodePath.join(ff.proxyDir, m.key + '.mp4');
  if (fileExists(proxyFile)) {
    if (m.proxyPath !== proxyFile) m.proxyPath = proxyFile;
  } else if (m.proxyPath && !fileExists(m.proxyPath)) {
    m.proxyPath = null;
  }
  await testPlayable(id);
  const pl = r.playable;
  const needs = (m.hasVideo && !pl.video) || (m.hasAudio && !pl.audio);
  const heavy = m.hasVideo && (m.height > 2200 || /prores|dnxh|cfhd|v210|r210/.test(m.vcodec || ''));
  if ((needs || (heavy && store.settings?.autoProxyHeavy)) && !m.proxyPath) createProxy(id);
  mediaEvents.emit('update', id);
}

function testElement(url, kind) {
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    el.muted = true;
    el.preload = 'auto';
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.removeAttribute('src');
      try { el.load(); } catch (e) { /* */ }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 10000);
    el.addEventListener('error', () => finish(false));
    if (kind === 'video') {
      el.addEventListener('loadeddata', () => finish(el.videoWidth > 0));
    } else {
      el.addEventListener('loadedmetadata', () => finish(isFinite(el.duration) || el.duration === Infinity));
    }
    el.src = url;
  });
}

export async function testPlayable(id) {
  const m = store.project.media[id];
  const r = rt(id);
  r.testing = true;
  const url = mediaUrl(m.path);
  const pl = { video: true, audio: true };
  if (m.hasVideo) pl.video = await testElement(url, 'video');
  if (m.hasAudio) {
    // ses kodlayıcısı tarayıcıda yoksa video oynasa bile ses sessiz kalır
    const okCodecs = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le', 'pcm_u8', 'pcm_s32le', 'alac'];
    pl.audio = okCodecs.includes(m.acodec) ? await testElement(url, 'audio') : false;
  }
  r.playable = pl;
  r.testing = false;
  return pl;
}

// Alt kliplerin kendi küçük resmi (aralığının başından); ana medyanın çalışma zamanı bilgisi paylaşılsa da resim ayrı
const subThumbs = new Map();
export function thumbOf(id) {
  const m = store.project?.media?.[id];
  if (!m) return null;
  if (!m.parentId || !m.hasVideo || m.subStart == null) return rt(id).thumb;
  const k = id + '@' + m.subStart;
  if (subThumbs.has(k)) return subThumbs.get(k);
  subThumbs.set(k, rt(id).thumb);
  const dur = (m.subEnd ?? m.duration) - m.subStart;
  makeThumbnail(m.path, m.key || mediaKey(m.path), m.subStart + Math.min(1, dur * 0.1)).then((p) => {
    subThumbs.set(k, mediaUrl(p));
    mediaEvents.emit('update', id);
  }).catch(() => {});
  return subThumbs.get(k);
}

const rootId = (id) => { const m = store.project.media[id]; return m?.parentId && store.project.media[m.parentId] ? m.parentId : id; };

export function createProxy(id) {
  id = rootId(id);
  const m = store.project.media[id];
  if (!m || m.type === 'image') return;
  const r = rt(id);
  if (r.proxyJob) return;
  const out = nodePath.join(ff.proxyDir, (m.key || mediaKey(m.path)) + '.mp4');
  const tmp = out.replace(/\.mp4$/, '.tmp.mp4');
  r.proxyProgress = 0;
  mediaEvents.emit('update', id);
  const job = makeProxy(m, tmp, {
    height: store.settings?.proxyHeight || 720,
    onProgress: (p) => { r.proxyProgress = p; mediaEvents.emit('proxyProgress', id); },
  });
  r.proxyJob = job;
  job.promise.then(() => {
    try { nodeFs.renameSync(tmp, out); } catch (e) { /* */ }
    r.proxyJob = null;
    r.proxyProgress = null;
    const mm = store.project.media[id];
    if (mm) mm.proxyPath = out;
    for (const sub of Object.values(store.project.media)) if (sub.parentId === id) sub.proxyPath = out;
    store.markDirty();
    mediaEvents.emit('update', id);
    mediaEvents.emit('proxyReady', id);
  }).catch((e) => {
    r.proxyJob = null;
    r.proxyProgress = null;
    try { nodeFs.unlinkSync(tmp); } catch (er) { /* */ }
    if (!e.cancelled) mediaEvents.emit('error', t('Proxy failed') + ': ' + m.name + '\n' + e.message);
    mediaEvents.emit('update', id);
  });
}

export function cancelProxy(id) {
  const r = rt(id);
  if (r.proxyJob) r.proxyJob.kill();
}

export function deleteProxy(id) {
  id = rootId(id);
  const m = store.project.media[id];
  if (!m || !m.proxyPath) return;
  try { nodeFs.unlinkSync(m.proxyPath); } catch (e) { /* */ }
  m.proxyPath = null;
  for (const sub of Object.values(store.project.media)) if (sub.parentId === id) sub.proxyPath = null;
  store.markDirty();
  mediaEvents.emit('update', id);
  mediaEvents.emit('proxyReady', id);
}

// Önizlemede kullanılacak URL (null => oynatılamaz/hazır değil)
export function playbackUrl(m, kind = 'video') {
  if (!m) return null;
  const r = rt(m.id);
  const hasProxy = m.proxyPath && fileExists(m.proxyPath) && !r.proxyJob;
  const pl = r.playable || { video: true, audio: true };
  const ok = kind === 'video' ? pl.video : pl.audio;
  if (hasProxy && (store.ui.useProxies || !ok || r.offline)) return mediaUrl(m.proxyPath);
  if (r.offline) return null;
  if (r.playable === null) return mediaUrl(m.path);
  return ok ? mediaUrl(m.path) : null;
}

export function mediaStatus(m) {
  const r = rt(m.id);
  if (r.offline) return 'offline';
  if (r.proxyJob) return 'proxy';
  if (r.playable && ((m.hasVideo && !r.playable.video) || (m.hasAudio && !r.playable.audio)) && !m.proxyPath) return 'unsupported';
  return 'ok';
}

export function loadImage(id) {
  const m = store.project.media[id];
  const r = rt(id);
  if (r.image) return r.image;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.onload = () => { r.imageReady = true; mediaEvents.emit('imageReady', id); };
  img.onerror = () => { r.imageReady = false; };
  img.src = mediaUrl(m.path);
  r.image = img;
  return img;
}

export function getFilmstrip(id) {
  const m = store.project.media[id];
  const r = rt(id);
  if (!m || !m.hasVideo || m.type === 'image' || r.offline) return null;
  if (r.filmstrip) return r.filmstrip.ready ? r.filmstrip : null;
  r.filmstrip = { ready: false };
  const count = Math.max(4, Math.min(60, Math.round((m.duration || 1) / 2)));
  makeFilmstrip(m.path, m.key, m.duration || 1, count).then(({ path, count }) => {
    const img = new Image();
    img.onload = () => {
      r.filmstrip = { ready: true, img, count, frameW: img.width / count, frameH: img.height, duration: m.duration };
      mediaEvents.emit('filmstrip', id);
    };
    img.src = mediaUrl(path);
  }).catch(() => { /* */ });
  return null;
}

export function relinkMedia(id, newPath) {
  return probe(newPath).then((info) => {
    store.commit('Relink Media', (pr) => {
      const m = pr.media[id];
      Object.assign(m, info, { path: newPath, name: nodePath.basename(newPath), key: mediaKey(newPath), proxyPath: null });
    });
    runtime.delete(id);
    prepareMedia(id);
    mediaEvents.emit('relinked', id);
  });
}

export function prepareAllMedia() {
  for (const id in store.project.media) prepareMedia(id);
}

export function clearRuntime() {
  for (const [, r] of runtime) if (r.proxyJob) r.proxyJob.kill();
  runtime.clear();
}

// ---- Çevrimdışı ses efektleri için işlenmiş ses dosyası (önizleme) ----
const processing = new Map();
export function processedAudioUrl(m, filters, onReady) {
  if (!m || !filters.length) return null;
  const dir = ensureDir(nodePath.join(ff.cacheDir, 'audiofx'));
  const key = hashString((m.key || m.path) + '|' + filters.join(','));
  const file = nodePath.join(dir, key + '.flac');
  if (fileExists(file) && !processing.has(key)) return mediaUrl(file);
  if (!processing.has(key)) {
    const job = registerJob(t('Processing audio') + ': ' + m.name);
    const tmp = file.replace(/\.flac$/, '.tmp.flac');
    const r = runFFmpeg(['-i', m.path, '-vn', '-af', filters.join(','), '-ar', '48000', '-ac', '2', '-c:a', 'flac', tmp], {
      duration: m.duration || 0, onProgress: (p) => job.progress(p),
    });
    processing.set(key, r);
    r.promise.then(() => {
      try { nodeFs.renameSync(tmp, file); } catch (e) { /* */ }
      processing.delete(key);
      job.done();
      if (onReady) onReady();
      mediaEvents.emit('update', m.id);
    }).catch((e) => {
      processing.delete(key);
      job.done();
      try { nodeFs.unlinkSync(tmp); } catch (er) { /* */ }
      mediaEvents.emit('error', t('Audio processing failed') + ': ' + m.name + '\n' + e.message);
    });
  }
  return null;
}
