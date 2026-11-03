// Proje veri modeli: fabrikalar ve sorgular
import { uid } from './util.js';
import { effectDef } from './effectsDef.js';
import { evalParam, isAnimated } from './keyframes.js';

export const PROJECT_VERSION = 1;

export function createProject(name = 'Untitled') {
  return {
    app: 'ULIPremiere',
    version: PROJECT_VERSION,
    name,
    media: {},
    sequences: {},
    bins: { root: { id: 'root', name: '', parent: null } },
    activeSequenceId: null,
    openSequenceIds: [],
    createdAt: Date.now(),
  };
}

export const SEQUENCE_PRESETS = [
  { key: '1080p2398', name: 'HD 1080p 23.976', width: 1920, height: 1080, fps: 23.976 },
  { key: '1080p24', name: 'HD 1080p 24', width: 1920, height: 1080, fps: 24 },
  { key: '1080p25', name: 'HD 1080p 25', width: 1920, height: 1080, fps: 25 },
  { key: '1080p2997', name: 'HD 1080p 29.97', width: 1920, height: 1080, fps: 29.97 },
  { key: '1080p30', name: 'HD 1080p 30', width: 1920, height: 1080, fps: 30 },
  { key: '1080p50', name: 'HD 1080p 50', width: 1920, height: 1080, fps: 50 },
  { key: '1080p5994', name: 'HD 1080p 59.94', width: 1920, height: 1080, fps: 59.94 },
  { key: '1080p60', name: 'HD 1080p 60', width: 1920, height: 1080, fps: 60 },
  { key: '720p30', name: 'HD 720p 30', width: 1280, height: 720, fps: 30 },
  { key: 'uhd24', name: 'UHD 4K 24', width: 3840, height: 2160, fps: 24 },
  { key: 'uhd25', name: 'UHD 4K 25', width: 3840, height: 2160, fps: 25 },
  { key: 'uhd30', name: 'UHD 4K 30', width: 3840, height: 2160, fps: 30 },
  { key: 'uhd60', name: 'UHD 4K 60', width: 3840, height: 2160, fps: 60 },
  { key: 'vert30', name: 'Vertical 1080x1920 30 (Reels/TikTok)', width: 1080, height: 1920, fps: 30 },
  { key: 'vert60', name: 'Vertical 1080x1920 60', width: 1080, height: 1920, fps: 60 },
  { key: 'sq30', name: 'Square 1080x1080 30', width: 1080, height: 1080, fps: 30 },
  { key: 'p45', name: '4:5 1080x1350 30 (Instagram)', width: 1080, height: 1350, fps: 30 },
];

export function createTrack(type, index) {
  return {
    id: uid('trk'),
    name: (type === 'video' ? 'V' : 'A') + (index + 1),
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    volume: 0,
    pan: 0,
    targeted: index === 0,
    height: type === 'video' ? 46 : 46,
  };
}

export function createSequence(opts = {}) {
  const s = {
    id: uid('seq'),
    name: opts.name || 'Sequence 01',
    binId: opts.binId || 'root',
    width: opts.width || 1920,
    height: opts.height || 1080,
    fps: opts.fps || 30,
    sampleRate: 48000,
    tracks: { video: [], audio: [] },
    clips: {},
    markers: [],
    inFrame: null,
    outFrame: null,
    playhead: 0,
    masterVolume: 0,
    createdAt: Date.now(),
  };
  const nv = opts.videoTracks ?? 3, na = opts.audioTracks ?? 3;
  for (let i = 0; i < nv; i++) s.tracks.video.push(createTrack('video', i));
  for (let i = 0; i < na; i++) s.tracks.audio.push(createTrack('audio', i));
  return s;
}

export function param(v) {
  return { v, kf: null };
}

export function defaultVideoProps(seq, media) {
  const sw = media?.width || seq.width, sh = media?.height || seq.height;
  return {
    position: param([seq.width / 2, seq.height / 2]),
    scale: param(100),
    scaleWidth: param(100),
    uniformScale: true,
    rotation: param(0),
    anchor: param([sw / 2, sh / 2]),
    opacity: param(100),
    blendMode: 'normal',
    timeRemap: param(100),
  };
}

export function defaultAudioProps() {
  return {
    volume: param(0),
    pan: param(0),
  };
}

export function defaultTextData() {
  return {
    text: 'Yeni Metin',
    font: 'Segoe UI',
    size: 96,
    bold: true,
    italic: false,
    align: 'center',
    color: '#ffffff',
    strokeWidth: 0,
    strokeColor: '#000000',
    shadow: true,
    shadowColor: '#000000',
    shadowBlur: 12,
    shadowDist: 4,
    bgEnabled: false,
    bgColor: '#000000',
    bgOpacity: 60,
    bgPadding: 20,
    lineHeight: 1.15,
    tracking: 0,
  };
}

export function createClip(seq, opts) {
  const c = {
    id: uid('clp'),
    kind: opts.kind || 'media',
    mediaId: opts.mediaId || null,
    type: opts.type, // 'video' | 'audio'
    track: opts.track ?? 0,
    start: Math.round(opts.start ?? 0),
    duration: Math.max(1, Math.round(opts.duration ?? 1)),
    inPoint: opts.inPoint ?? 0,
    speed: opts.speed ?? 1,
    reverse: false,
    enabled: true,
    linkId: opts.linkId || null,
    name: opts.name || 'Clip',
    label: opts.label || null,
    props: opts.type === 'video' ? defaultVideoProps(seq, opts.media) : defaultAudioProps(),
    effects: [],
    transIn: null,
    transOut: null,
  };
  if (c.kind === 'text') c.text = { ...defaultTextData(), ...(opts.text || {}) };
  if (c.kind === 'color') c.color = opts.color || '#000000';
  if (c.kind === 'sequence') c.seqId = opts.seqId;
  if (c.kind === 'graphic') c.graphic = structuredClone(opts.graphic || { layers: [] });
  return c;
}

export function createEffect(type) {
  const def = effectDef(type);
  if (!def) throw new Error('Unknown effect ' + type);
  const params = {};
  for (const p of def.params) {
    if (p.animatable === false) params[p.key] = { v: structuredClone(p.default), kf: null, static: true };
    else params[p.key] = param(structuredClone(p.default));
  }
  return { id: uid('fx'), type, enabled: true, params };
}

// Maske: path düz dizi — elips: [x, y, w, h] (kaynak pikseli, sol üst), çokgen: [x0, y0, x1, y1, ...]
export function createMask(type, sw, sh, index = 0) {
  let path;
  if (type === 'ellipse') path = [sw * 0.3, sh * 0.3, sw * 0.4, sh * 0.4];
  else if (type === 'polygon') path = [sw * 0.3, sh * 0.3, sw * 0.7, sh * 0.3, sw * 0.7, sh * 0.7, sw * 0.3, sh * 0.7];
  else path = []; // kalem: noktalar monitörde eklenir
  return {
    id: uid('msk'),
    name: 'Mask (' + (index + 1) + ')',
    type: type === 'pen' ? 'bezier' : type,
    path: param(path.map((v) => Math.round(v * 10) / 10)),
    feather: param(10),
    opacity: param(100),
    expansion: param(0),
    inverted: false,
    mode: 'add',
    enabled: true,
  };
}

export const MASK_PARAM_KEYS = ['path', 'feather', 'opacity', 'expansion'];

// ---- Sorgular ----

export function clipEnd(c) {
  return c.start + c.duration;
}

export function clipsOnTrack(seq, type, track) {
  const out = [];
  for (const id in seq.clips) {
    const c = seq.clips[id];
    if (c.type === type && c.track === track) out.push(c);
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

export function sequenceDuration(seq) {
  let end = 0;
  for (const id in seq.clips) {
    const e = clipEnd(seq.clips[id]);
    if (e > end) end = e;
  }
  return end;
}

export function linkedClips(seq, clip) {
  if (!clip.linkId) return [clip];
  const out = [];
  for (const id in seq.clips) if (seq.clips[id].linkId === clip.linkId) out.push(seq.clips[id]);
  return out;
}

export function clipAt(seq, type, track, frame) {
  for (const id in seq.clips) {
    const c = seq.clips[id];
    if (c.type === type && c.track === track && frame >= c.start && frame < c.start + c.duration) return c;
  }
  return null;
}

export function prevAdjacent(seq, clip) {
  for (const id in seq.clips) {
    const c = seq.clips[id];
    if (c !== clip && c.type === clip.type && c.track === clip.track && c.start + c.duration === clip.start) return c;
  }
  return null;
}

export function nextAdjacent(seq, clip) {
  const e = clip.start + clip.duration;
  for (const id in seq.clips) {
    const c = seq.clips[id];
    if (c !== clip && c.type === clip.type && c.track === clip.track && c.start === e) return c;
  }
  return null;
}

// Kaynak süresi (saniye) bir timeline karesi için
// Medya (veya alt klip) kaynak aralığı, saniye
export function mediaRange(m) {
  if (!m) return { lo: 0, hi: 0 };
  return { lo: m.subStart ?? 0, hi: m.subEnd ?? m.duration ?? 0 };
}
export function mediaInOut(m) {
  const r = mediaRange(m);
  return { inSec: m.inPoint ?? r.lo, outSec: m.outPoint ?? r.hi };
}

// ---- Çok kameralı (multicam) ----
// Kaynak sekans: seq.multicam = { cameras: [{ name, vTrack, aTrack }], audioMode: 'fixed' | 'follow', audioTrack }
// Kurgudaki multicam klibi: kind 'sequence' + clip.multicam = { angle }
export function multicamVideoTrack(nested, clip) {
  if (!clip?.multicam || !nested?.multicam) return null;
  const cam = nested.multicam.cameras[clip.multicam.angle];
  return cam ? cam.vTrack : -1;
}
export function multicamAudioTrack(nested, clip) {
  if (!clip?.multicam || !nested?.multicam) return null;
  const mc = nested.multicam;
  if (mc.audioMode !== 'follow') return mc.audioTrack ?? 0;
  const cam = mc.cameras[clip.multicam.angle];
  return cam && cam.aTrack >= 0 ? cam.aTrack : -1;
}

export function sourceTimeAt(clip, frame, fps) {
  const local = frame - clip.start;
  if (clip.reverse) {
    return clip.inPoint + ((clip.duration - local - 1) / fps) * clip.speed;
  }
  if (remapActive(clip)) return clip.inPoint + (remapIntegral(clip.props.timeRemap, local) / fps) * clip.speed;
  return clip.inPoint + (local / fps) * clip.speed;
}

// ---- Zaman yeniden eşleme (hız rampası) ----
// props.timeRemap: hız % (keyframe'lenebilir). Kaynak zamanı = hızın zaman üzerindeki integrali.
export function remapActive(clip) {
  const p = clip.props && clip.props.timeRemap;
  if (!p || clip.reverse || (clip.kind !== 'media' && clip.kind !== 'sequence')) return false;
  return isAnimated(p) || Math.abs((p.v ?? 100) - 100) > 1e-6;
}

// Bağlı video klibinde hız rampası varsa ses klibi de aynı rampayı izler (aynı konum/süre/kaynak)
export function audioRemapClip(seq, c) {
  if (c.type !== 'audio' || !c.linkId || c.reverse) return c;
  for (const id in seq.clips) {
    const v = seq.clips[id];
    if (v.type === 'video' && v.linkId === c.linkId && v.start === c.start && v.duration === c.duration
      && Math.abs(v.speed - c.speed) < 1e-6 && Math.abs(v.inPoint - c.inPoint) < 1e-3 && remapActive(v)) {
      return { ...c, props: { ...c.props, timeRemap: v.props.timeRemap } };
    }
  }
  return c;
}

// Klibin o anki oynatma hızı çarpanı (önizleme için)
export function clipRateAt(clip, local) {
  if (!remapActive(clip)) return clip.speed;
  return clip.speed * Math.max(0, evalParam(clip.props.timeRemap, local) ?? 100) / 100;
}

// ∫_0^L hız(f)/100 df  (kare cinsinden kaynak ilerlemesi; L ondalıklı olabilir)
export function remapIntegral(p, L) {
  const r = (v) => Math.max(0, v ?? 100) / 100;
  if (L <= 0) return 0;
  if (!isAnimated(p)) return r(p.v) * L;
  const k = p.kf;
  let area = 0;
  // ilk keyframe'den önce sabit
  const segEnd = (x) => Math.min(x, L);
  let x = 0;
  if (k[0].f > 0) { const e = segEnd(k[0].f); area += r(k[0].v) * e; x = e; if (x >= L) return area; }
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i], b = k[i + 1];
    if (b.f <= x) continue;
    const s0 = Math.max(a.f, x), s1 = segEnd(b.f);
    if (s1 <= s0) continue;
    const e = a.e || 'linear';
    if (e === 'hold') area += r(a.v) * (s1 - s0);
    else if (e === 'linear') {
      const span = b.f - a.f || 1;
      const v0 = a.v + (b.v - a.v) * ((s0 - a.f) / span), v1 = a.v + (b.v - a.v) * ((s1 - a.f) / span);
      area += ((r(v0) + r(v1)) / 2) * (s1 - s0);
    } else {
      // yumuşak geçiş: Simpson
      const n = 16, h = (s1 - s0) / n;
      let sum = r(evalParam(p, s0)) + r(evalParam(p, s1));
      for (let j = 1; j < n; j++) sum += (j % 2 ? 4 : 2) * r(evalParam(p, s0 + j * h));
      area += (sum * h) / 3;
    }
    x = s1;
    if (x >= L) return area;
  }
  // son keyframe'den sonra sabit
  if (x < L) area += r(k[k.length - 1].v) * (L - x);
  return area;
}

export function clipSourceDuration(clip, fps) {
  return (clip.duration / fps) * clip.speed;
}

// Bir kliple kenarındaki kaynak payı (saniye): kırpma sınırları için
export function maxClipDurationFrames(clip, media, fps) {
  if (!media || media.type === 'image' || clip.kind !== 'media') return Infinity;
  const avail = Math.max(0, (media.duration || 0) - clip.inPoint);
  return Math.max(1, Math.floor((avail / clip.speed) * fps + 1e-6));
}

// Klibin kaynak bilgisi: medya ya da nested sekans (süre saniye)
export function clipMedia(project, c) {
  if (!c) return null;
  if (c.kind === 'sequence') {
    const s = project.sequences[c.seqId];
    if (!s) return null;
    return { type: 'video', duration: sequenceDuration(s) / s.fps, fps: s.fps, width: s.width, height: s.height, hasVideo: true, hasAudio: s.tracks.audio.length > 0 };
  }
  return c.mediaId ? project.media[c.mediaId] : null;
}

// outerId sekansı innerId sekansını (dolaylı da olsa) içeriyor mu? / döngü engeli
export function sequenceContains(project, outerId, innerId, seen = new Set()) {
  if (outerId === innerId) return true;
  if (seen.has(outerId)) return false;
  seen.add(outerId);
  const s = project.sequences[outerId];
  if (!s) return false;
  for (const id in s.clips) {
    const c = s.clips[id];
    if (c.kind === 'sequence' && sequenceContains(project, c.seqId, innerId, seen)) return true;
  }
  return false;
}

export function allSequenceIds(project) {
  return Object.keys(project.sequences);
}

export function mediaInUse(project, mediaId) {
  for (const sid in project.sequences) {
    const s = project.sequences[sid];
    for (const cid in s.clips) if (s.clips[cid].mediaId === mediaId) return true;
  }
  return false;
}

export function binChildren(project, binId) {
  const bins = Object.values(project.bins).filter((b) => b.parent === binId);
  const media = Object.values(project.media).filter((m) => (m.binId || 'root') === binId);
  const seqs = Object.values(project.sequences).filter((s) => (s.binId || 'root') === binId);
  return { bins, media, seqs };
}

// Proje dosyasının eski sürümlerini güncelle ve eksik alanları tamamla
export function normalizeProject(p) {
  if (!p.bins) p.bins = { root: { id: 'root', name: '', parent: null } };
  if (!p.bins.root) p.bins.root = { id: 'root', name: '', parent: null };
  p.media = p.media || {};
  p.sequences = p.sequences || {};
  p.openSequenceIds = (p.openSequenceIds || []).filter((id) => p.sequences[id]);
  for (const id in p.sequences) {
    const s = p.sequences[id];
    s.markers = s.markers || [];
    s.masterVolume = s.masterVolume ?? 0;
    for (const t of [...s.tracks.video, ...s.tracks.audio]) {
      t.height = t.height || 46;
      t.volume = t.volume ?? 0;
      t.pan = t.pan ?? 0;
    }
    for (const cid in s.clips) {
      const c = s.clips[cid];
      c.effects = c.effects || [];
      c.speed = c.speed || 1;
      if (c.type === 'video' && c.props && !c.props.timeRemap) c.props.timeRemap = { v: 100, kf: null };
      if (c.enabled === undefined) c.enabled = true;
    }
  }
  if (p.activeSequenceId && !p.sequences[p.activeSequenceId]) p.activeSequenceId = null;
  return p;
}
