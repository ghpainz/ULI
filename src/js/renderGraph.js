// Bir zaman çizelgesi karesinde hangi kliplerin, hangi geçişlerle görüneceğini hesaplar.
// Önizleme ve dışa aktarma aynı fonksiyonları kullanır.
import { sourceTimeAt, sequenceDuration, audioRemapClip, clipRateAt, multicamVideoTrack, multicamAudioTrack } from './model.js';
import { evalParam } from './keyframes.js';
import { audioTransitionGains } from './effectsDef.js';
import { dbToGain } from './util.js';
import { captionAt, captionClip } from './captions.js';

function enabledAdjPrev(seq, clip) {
  for (const id in seq.clips) {
    const c = seq.clips[id];
    if (c !== clip && c.enabled && c.type === clip.type && c.track === clip.track && c.start + c.duration === clip.start) return c;
  }
  return null;
}
function enabledAdjNext(seq, clip) {
  const e = clip.start + clip.duration;
  for (const id in seq.clips) {
    const c = seq.clips[id];
    if (c !== clip && c.enabled && c.type === clip.type && c.track === clip.track && c.start === e) return c;
  }
  return null;
}

// Klibin görünür aralığı (geçiş payları dahil) ve geçiş bölgeleri
export function clipSpan(seq, clip) {
  let from = clip.start;
  let to = clip.start + clip.duration;
  let tin = null, tout = null;
  if (clip.transIn) {
    const d = Math.max(1, clip.transIn.duration);
    const prev = enabledAdjPrev(seq, clip);
    if (prev) {
      const al = clip.transIn.align || 'center';
      const rs = al === 'start' ? clip.start : al === 'end' ? clip.start - d : clip.start - Math.floor(d / 2);
      tin = { rs, d, type: clip.transIn.type, two: true };
      from = rs;
    } else {
      tin = { rs: clip.start, d: Math.min(d, clip.duration), type: clip.transIn.type, two: false };
    }
  }
  const next = enabledAdjNext(seq, clip);
  if (next && next.transIn) {
    const d = Math.max(1, next.transIn.duration);
    const al = next.transIn.align || 'center';
    const rs = al === 'start' ? next.start : al === 'end' ? next.start - d : next.start - Math.floor(d / 2);
    tout = { rs, d, type: next.transIn.type, two: true };
    to = rs + d;
  } else if (clip.transOut) {
    const d = Math.min(Math.max(1, clip.transOut.duration), clip.duration);
    tout = { rs: to - d, d, type: clip.transOut.type, two: false };
  }
  return { from, to, tin, tout };
}

function clampSrc(t, media) {
  if (!media || media.type === 'image') return Math.max(0, t);
  const dur = media.duration || 0;
  const fr = media.fps || 30;
  return Math.max(0, Math.min(t, Math.max(0, dur - 0.5 / fr)));
}

const MAX_NEST = 6;

export function makeItem(project, seq, clip, f) {
  if (clip.kind === 'sequence') {
    const nested = project.sequences[clip.seqId] || null;
    let srcTime = 0, nf = 0;
    if (nested) {
      const dur = sequenceDuration(nested) / nested.fps;
      srcTime = Math.max(0, Math.min(sourceTimeAt(clip, f, seq.fps), Math.max(0, dur - 0.5 / nested.fps)));
      nf = Math.floor(srcTime * nested.fps + 1e-6);
    }
    return { clip, media: null, nested, nestedFrame: nf, onlyTrack: multicamVideoTrack(nested, clip), local: f - clip.start, srcTime, ownerSeq: seq, f };
  }
  const media = clip.mediaId ? project.media[clip.mediaId] : null;
  return {
    clip,
    media,
    local: f - clip.start,
    srcTime: clip.kind === 'media' ? clampSrc(sourceTimeAt(clip, f, seq.fps), media) : 0,
    ownerSeq: seq,
    f,
  };
}

// Nested sekansların içindeki medya öğelerini düzleştir (oynatma/dışa aktarma kaynak hazırlığı için)
// Her öğe: rateMul (üst kliplerin hız çarpanı), scaleMul (üst kliplerin en büyük ölçeği)
export function flattenMediaItems(project, items, depth = 0, rateMul = 1, scaleMul = 1, out = []) {
  for (const it of items) {
    if (it.clip.kind === 'sequence') {
      if (!it.nested || depth >= MAX_NEST) continue;
      const inner = itemsOfLayers(videoLayersAt(project, it.nested, it.nestedFrame, depth + 1, it.onlyTrack));
      const P = it.clip.props || {};
      const sc = Math.max(1, ...[P.scale?.v, ...(P.scale?.kf || []).map((k) => k.v)].filter((x) => typeof x === 'number')) / 100;
      flattenMediaItems(project, inner, depth + 1, rateMul * it.clip.speed, scaleMul * sc, out);
    } else {
      it.rateMul = rateMul;
      it.scaleMul = scaleMul;
      out.push(it);
    }
  }
  return out;
}

// Alt izden üst ize katman listesi (onlyTrack: multicam açısı için tek iz)
export function videoLayersAt(project, seq, f, depth = 0, onlyTrack = null) {
  const layers = [];
  const nTracks = seq.tracks.video.length;
  // izlere göre grupla (tek geçiş)
  const byTrack = new Array(nTracks);
  for (let i = 0; i < nTracks; i++) byTrack[i] = [];
  for (const id in seq.clips) {
    const c = seq.clips[id];
    if (c.type !== 'video' || !c.enabled) continue;
    if (c.track >= nTracks) continue;
    // kaba filtre: geçiş payları en fazla klibin yarısı kadar dışarı taşar
    if (f < c.start - 600 || f >= c.start + c.duration + 600) continue;
    byTrack[c.track].push(c);
  }
  for (let t = 0; t < nTracks; t++) {
    const track = seq.tracks.video[t];
    if (onlyTrack != null ? t !== onlyTrack : track.hidden) continue;
    const covering = [];
    for (const c of byTrack[t]) {
      const sp = clipSpan(seq, c);
      if (f >= sp.from && f < sp.to) covering.push({ c, sp });
    }
    if (!covering.length) continue;
    covering.sort((a, b) => a.c.start - b.c.start);
    if (covering.length >= 2) {
      const A = covering[0], B = covering[covering.length - 1];
      const tr = B.sp.tin;
      const p = tr ? (f - tr.rs + 0.5) / tr.d : 0.5;
      layers.push({
        type: 'transition', track: t, trans: tr ? tr.type : 'crossDissolve', p,
        a: makeItem(project, seq, A.c, f), b: makeItem(project, seq, B.c, f),
      });
      continue;
    }
    const { c, sp } = covering[0];
    const item = makeItem(project, seq, c, f);
    if (c.kind === 'adjustment') {
      let fade = 1;
      if (sp.tin && !sp.tin.two && f < sp.tin.rs + sp.tin.d) fade = (f - sp.tin.rs + 0.5) / sp.tin.d;
      if (sp.tout && !sp.tout.two && f >= sp.tout.rs) fade = 1 - (f - sp.tout.rs + 0.5) / sp.tout.d;
      layers.push({ type: 'adjust', track: t, item, fade });
      continue;
    }
    if (sp.tin && !sp.tin.two && f < sp.tin.rs + sp.tin.d) {
      layers.push({ type: 'transition', track: t, trans: sp.tin.type, p: (f - sp.tin.rs + 0.5) / sp.tin.d, a: null, b: item });
    } else if (sp.tout && !sp.tout.two && f >= sp.tout.rs) {
      layers.push({ type: 'transition', track: t, trans: sp.tout.type, p: (f - sp.tout.rs + 0.5) / sp.tout.d, a: item, b: null });
    } else {
      layers.push({ type: 'clip', track: t, item });
    }
  }
  // altyazılar en üstte (yalnız en dış sekansta)
  if (depth === 0 && seq.captions && seq.captions.length && seq.captionsVisible !== false) {
    const cap = captionAt(seq, f);
    if (cap && cap.text) layers.push({ type: 'clip', track: nTracks, item: { clip: captionClip(seq, cap), media: null, local: f - cap.start, srcTime: 0, ownerSeq: seq, f } });
  }
  return layers;
}

// Belirli bir karede görünen tüm kaynak öğeleri (oynatma motorunun hazırlaması için)
export function itemsOfLayers(layers) {
  const out = [];
  for (const L of layers) {
    if (L.type === 'clip') out.push(L.item);
    else if (L.type === 'adjust') out.push(L.item);
    else {
      if (L.a) out.push(L.a);
      if (L.b) out.push(L.b);
    }
  }
  return out;
}

export function anySolo(seq) {
  return seq.tracks.audio.some((t) => t.solo);
}

export function trackAudible(seq, trackIndex, solo = anySolo(seq)) {
  const t = seq.tracks.audio[trackIndex];
  if (!t) return false;
  if (t.muted) return false;
  if (solo && !t.solo) return false;
  return true;
}

// Klip kazancı (geçişler + ses seviyesi keyframe'leri), f ondalıklı kare olabilir
export function clipAudioGain(clip, sp, f) {
  let g = dbToGain(evalParam(clip.props.volume, f - clip.start) ?? 0);
  if (sp.tin && f < sp.tin.rs + sp.tin.d) {
    const p = (f - sp.tin.rs) / sp.tin.d;
    g *= audioTransitionGains(sp.tin.type, p)[1];
  }
  if (sp.tout && f >= sp.tout.rs) {
    const p = (f - sp.tout.rs) / sp.tout.d;
    g *= audioTransitionGains(sp.tout.type, p)[0];
  }
  return g;
}

// Bir anda çalan ses klipleri ve kazanç/pan değerleri (nested sekansların sesi dahil)
export function audioStatesAt(project, seq, f, depth = 0, out = [], onlyTrack = null) {
  const solo = anySolo(seq);
  const master = dbToGain(seq.masterVolume || 0);
  for (const id in seq.clips) {
    const c = seq.clips[id];
    if (c.type !== 'audio' || !c.enabled || (c.kind !== 'media' && c.kind !== 'sequence')) continue;
    if (onlyTrack != null && c.track !== onlyTrack) continue;
    if (f < c.start - 600 || f >= c.start + c.duration + 600) continue;
    const sp = clipSpan(seq, c);
    if (f < sp.from || f >= sp.to) continue;
    const track = seq.tracks.audio[c.track];
    if (!track) continue;
    const audible = onlyTrack != null || trackAudible(seq, c.track, solo);
    const g = audible ? clipAudioGain(c, sp, f) * dbToGain(track.volume || 0) * master : 0;
    const pan = Math.max(-1, Math.min(1, ((evalParam(c.props.pan, f - c.start) || 0) + (track.pan || 0)) / 100));
    const rc = audioRemapClip(seq, c);
    const rate = clipRateAt(rc, f - c.start);
    const st = sourceTimeAt(rc, Math.floor(f), seq.fps) + ((f - Math.floor(f)) / seq.fps) * rate * (c.reverse ? -1 : 1);
    if (c.kind === 'sequence') {
      const nested = project.sequences[c.seqId];
      if (!nested || depth >= MAX_NEST) continue;
      const nDur = sequenceDuration(nested);
      const nf = Math.max(0, st * nested.fps);
      if (nf >= nDur) continue;
      const start = out.length;
      audioStatesAt(project, nested, nf, depth + 1, out, multicamAudioTrack(nested, c));
      for (let k = start; k < out.length; k++) {
        out[k].gain *= g;
        out[k].pan = Math.max(-1, Math.min(1, out[k].pan + pan));
        out[k].rateMul = (out[k].rateMul || 1) * rate;
      }
      continue;
    }
    const media = project.media[c.mediaId];
    out.push({ clip: c, media, sp, gain: g, pan, rateMul: 1, rate, srcTime: clampSrc(st, media) });
  }
  return out;
}
