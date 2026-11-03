// Kurgu işlemleri: tümü bir sekans nesnesini yerinde değiştirir (store.commit içinde çağrılır)
import { uid } from './util.js';
import { clipsOnTrack, createClip, clipEnd, createTrack, linkedClips, clipMedia, createSequence, sequenceDuration } from './model.js';
import { shiftKeyframes, scaleKeyframes } from './keyframes.js';

const EPS = 1e-4;

// ---- Temel kırpma yardımcıları ----

export function trimStart(c, delta, fps) {
  // delta > 0: soldan kısalt (başlangıç sağa kayar)
  c.start += delta;
  c.duration -= delta;
  if (!c.reverse) c.inPoint += (delta / fps) * c.speed;
  shiftKeyframes(c, delta);
}

export function trimEnd(c, delta, fps) {
  // delta > 0: sağdan kısalt
  c.duration -= delta;
  if (c.reverse) c.inPoint += (delta / fps) * c.speed;
}

// Klibin kaynak payları (kare): baştan ve sondan ne kadar uzatılabilir
export function headroom(c, media, fps) {
  if ((c.kind !== 'media' && c.kind !== 'sequence') || !media || media.type === 'image') return { start: Infinity, end: Infinity };
  const lo = media.subStart ?? 0, hi = media.subEnd ?? media.duration ?? 0; // alt klipler kendi aralığıyla sınırlı
  const before = Math.floor(((c.inPoint - lo) * fps) / c.speed + EPS);
  const after = Math.floor(((hi - c.inPoint) * fps) / c.speed - c.duration + EPS);
  return c.reverse ? { start: Math.max(0, after), end: Math.max(0, before) } : { start: Math.max(0, before), end: Math.max(0, after) };
}

export function splitClip(seq, c, frame, newLinkId = null) {
  if (frame <= c.start || frame >= c.start + c.duration) return null;
  const fps = seq.fps;
  const r = structuredClone(c);
  r.id = uid('clp');
  const leftDur = frame - c.start;
  const rightDur = c.duration - leftDur;
  r.start = frame;
  r.duration = rightDur;
  if (!c.reverse) {
    r.inPoint = c.inPoint + (leftDur / fps) * c.speed;
  } else {
    r.inPoint = c.inPoint;
    c.inPoint = c.inPoint + (rightDur / fps) * c.speed;
  }
  shiftKeyframes(r, leftDur);
  c.duration = leftDur;
  r.transIn = null;
  r.transOut = c.transOut;
  c.transOut = null;
  r.linkId = newLinkId;
  seq.clips[r.id] = r;
  return r;
}

// Bir izdeki [from,to) aralığını boşalt (overwrite davranışı)
export function clearRange(seq, type, track, from, to, skip = null) {
  if (to <= from) return;
  const fps = seq.fps;
  for (const c of clipsOnTrack(seq, type, track)) {
    if (skip && skip.has(c.id)) continue;
    const e = c.start + c.duration;
    if (e <= from || c.start >= to) continue;
    if (c.start >= from && e <= to) {
      delete seq.clips[c.id];
    } else if (c.start < from && e > to) {
      splitClip(seq, c, to, null);
      trimEnd(c, c.start + c.duration - from, fps);
    } else if (c.start < from) {
      trimEnd(c, e - from, fps);
    } else {
      trimStart(c, to - c.start, fps);
    }
  }
}

function trackLocked(seq, type, i) {
  const t = seq.tracks[type][i];
  return !t || t.locked;
}

function allTrackKeys(seq) {
  const out = [];
  seq.tracks.video.forEach((t, i) => out.push(['video', i]));
  seq.tracks.audio.forEach((t, i) => out.push(['audio', i]));
  return out;
}

// Bir noktada tüm (kilitsiz) izlerde boşluk aç: ripple insert
export function insertGap(seq, at, len, opts = {}) {
  if (len <= 0) return;
  const tracks = opts.tracks || allTrackKeys(seq);
  const linkMap = new Map();
  for (const [type, i] of tracks) {
    if (trackLocked(seq, type, i)) continue;
    for (const c of clipsOnTrack(seq, type, i)) {
      if (opts.skip && opts.skip.has(c.id)) continue;
      if (c.start < at && c.start + c.duration > at) {
        let nl = null;
        if (c.linkId) {
          if (!linkMap.has(c.linkId)) linkMap.set(c.linkId, uid('lnk'));
          nl = linkMap.get(c.linkId);
        }
        splitClip(seq, c, at, nl);
      }
    }
  }
  for (const [type, i] of tracks) {
    if (trackLocked(seq, type, i)) continue;
    for (const c of clipsOnTrack(seq, type, i)) {
      if (opts.skip && opts.skip.has(c.id)) continue;
      if (c.start >= at) c.start += len;
    }
  }
}

// Bir izin [s,e) aralığında klip var mı (skip hariç)
function trackHasClipIn(seq, type, i, s, e, skip) {
  for (const c of clipsOnTrack(seq, type, i)) {
    if (skip && skip.has(c.id)) continue;
    if (c.start < e && c.start + c.duration > s) return true;
  }
  return false;
}

// [s,e) aralığını kapat: aralığı boş olan izlerde sonraki klipleri sola kaydır
export function closeGap(seq, s, e, opts = {}) {
  const len = e - s;
  if (len <= 0) return;
  for (const [type, i] of allTrackKeys(seq)) {
    if (trackLocked(seq, type, i)) continue;
    if (trackHasClipIn(seq, type, i, s, e, opts.skip)) continue;
    for (const c of clipsOnTrack(seq, type, i)) {
      if (opts.skip && opts.skip.has(c.id)) continue;
      if (c.start >= e) c.start -= len;
    }
  }
}

// Kesme noktası e'den sonraki klipleri d kadar kaydır (ripple). Noktayı kapsayan klip olan izler atlanır.
export function rippleShift(seq, at, d, skip) {
  if (!d) return;
  for (const [type, i] of allTrackKeys(seq)) {
    if (trackLocked(seq, type, i)) continue;
    let spanning = false;
    const list = clipsOnTrack(seq, type, i);
    for (const c of list) {
      if (skip && skip.has(c.id)) continue;
      if (c.start < at && c.start + c.duration > at) { spanning = true; break; }
    }
    if (spanning) continue;
    for (const c of list) {
      if (skip && skip.has(c.id)) continue;
      if (c.start >= at) c.start += d;
    }
  }
}

// Sola ripple kaydırma için izin verilen en büyük miktar (çakışma olmadan)
export function maxLeftShift(seq, at, skip) {
  let max = Infinity;
  for (const [type, i] of allTrackKeys(seq)) {
    if (trackLocked(seq, type, i)) continue;
    const list = clipsOnTrack(seq, type, i).filter((c) => !(skip && skip.has(c.id)));
    if (list.some((c) => c.start < at && c.start + c.duration > at)) continue;
    const after = list.filter((c) => c.start >= at);
    if (!after.length) continue;
    const first = after[0];
    const before = list.filter((c) => c.start + c.duration <= first.start && c.start < at);
    const prevEnd = before.length ? Math.max(...before.map((c) => c.start + c.duration)) : 0;
    max = Math.min(max, first.start - prevEnd);
  }
  return max;
}

export function deleteClips(seq, ids) {
  for (const id of ids) delete seq.clips[id];
}

// Seçili klipleri sil ve boşlukları kapat
export function rippleDelete(seq, ids) {
  const clips = ids.map((id) => seq.clips[id]).filter(Boolean);
  if (!clips.length) return;
  // birleşik aralıklar
  const ranges = clips.map((c) => [c.start, c.start + c.duration]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    if (merged.length && r[0] <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], r[1]);
    else merged.push([...r]);
  }
  deleteClips(seq, ids);
  for (let i = merged.length - 1; i >= 0; i--) closeGap(seq, merged[i][0], merged[i][1]);
}

// Bir izdeki boşluğu bul (frame noktasında)
export function gapAt(seq, type, track, frame) {
  const list = clipsOnTrack(seq, type, track);
  let prevEnd = 0;
  for (const c of list) {
    if (frame >= c.start && frame < c.start + c.duration) return null;
    if (c.start > frame) return prevEnd < c.start ? { type, track, start: prevEnd, end: c.start } : null;
    prevEnd = Math.max(prevEnd, c.start + c.duration);
  }
  return null;
}

export function rippleDeleteGap(seq, gap) {
  closeGap(seq, gap.start, gap.end);
}

// Klipleri taşı. dTrack: {video, audio}. mode: 'overwrite' | 'insert'
export function moveClips(seq, ids, df, dTrack = { video: 0, audio: 0 }, mode = 'overwrite') {
  const moving = ids.map((id) => seq.clips[id]).filter(Boolean);
  if (!moving.length) return;
  const minStart = Math.min(...moving.map((c) => c.start));
  if (minStart + df < 0) df = -minStart;
  for (const c of moving) {
    const nt = c.track + (dTrack[c.type] || 0);
    if (nt < 0 || nt >= seq.tracks[c.type].length) return false;
  }
  for (const c of moving) delete seq.clips[c.id];
  for (const c of moving) {
    c.start += df;
    c.track += dTrack[c.type] || 0;
  }
  if (mode === 'insert') {
    const s = Math.min(...moving.map((c) => c.start));
    const e = Math.max(...moving.map((c) => c.start + c.duration));
    insertGap(seq, s, e - s);
  } else {
    for (const c of moving) clearRange(seq, c.type, c.track, c.start, c.start + c.duration);
  }
  for (const c of moving) seq.clips[c.id] = c;
  return true;
}

export function duplicateClips(seq, ids, df, dTrack = { video: 0, audio: 0 }) {
  const linkMap = new Map();
  const newIds = [];
  const clones = ids.map((id) => seq.clips[id]).filter(Boolean).map((c) => {
    const n = structuredClone(c);
    n.id = uid('clp');
    if (c.linkId) {
      if (!linkMap.has(c.linkId)) linkMap.set(c.linkId, uid('lnk'));
      n.linkId = linkMap.get(c.linkId);
    }
    n.start += df;
    n.track += dTrack[n.type] || 0;
    return n;
  });
  for (const n of clones) {
    if (n.track < 0 || n.track >= seq.tracks[n.type].length) return [];
  }
  for (const n of clones) clearRange(seq, n.type, n.track, n.start, n.start + n.duration);
  for (const n of clones) { seq.clips[n.id] = n; newIds.push(n.id); }
  return newIds;
}

// Razor: verilen kliplerde (veya tüm izlerde) frame noktasında kes
export function razorAt(seq, frame, clips = null, opts = {}) {
  const list = clips || Object.values(seq.clips).filter((c) => {
    const t = seq.tracks[c.type][c.track];
    if (!t || t.locked) return false;
    if (opts.targetedOnly && !t.targeted) return false;
    return true;
  });
  const linkMap = new Map();
  const created = [];
  for (const c of list) {
    if (frame <= c.start || frame >= c.start + c.duration) continue;
    let nl = null;
    if (c.linkId) {
      if (!linkMap.has(c.linkId)) linkMap.set(c.linkId, uid('lnk'));
      nl = linkMap.get(c.linkId);
    }
    const r = splitClip(seq, c, frame, nl);
    if (r) created.push(r);
  }
  return created;
}

// ---- Kırpma işlemleri ----
// Her biri bir "base" sekans kopyasından toplam delta ile yeniden uygulanır.

export function normalTrim(seq, project, ids, edge, delta) {
  const fps = seq.fps;
  const clips = ids.map((id) => seq.clips[id]).filter(Boolean);
  // sınırları hesapla
  let lo = -Infinity, hi = Infinity;
  const skip = new Set(ids);
  for (const c of clips) {
    const hr = headroom(c, clipMedia(project, c), fps);
    const list = clipsOnTrack(seq, c.type, c.track).filter((x) => !skip.has(x.id));
    if (edge === 'start') {
      // delta<0 uzatır
      const prevEnd = Math.max(0, ...list.filter((x) => x.start + x.duration <= c.start).map((x) => x.start + x.duration));
      lo = Math.max(lo, -hr.start, prevEnd - c.start);
      hi = Math.min(hi, c.duration - 1);
    } else {
      const nextStart = Math.min(Infinity, ...list.filter((x) => x.start >= c.start + c.duration).map((x) => x.start));
      lo = Math.max(lo, -(c.duration - 1));
      hi = Math.min(hi, hr.end, nextStart - (c.start + c.duration));
    }
  }
  const d = Math.max(lo, Math.min(hi, delta));
  for (const c of clips) {
    if (edge === 'start') trimStart(c, d, fps);
    else trimEnd(c, -d, fps);
  }
  return d;
}

export function rippleTrim(seq, project, ids, edge, delta) {
  const fps = seq.fps;
  const clips = ids.map((id) => seq.clips[id]).filter(Boolean);
  if (!clips.length) return 0;
  const skip = new Set(ids);
  let lo = -Infinity, hi = Infinity;
  for (const c of clips) {
    const hr = headroom(c, clipMedia(project, c), fps);
    if (edge === 'end') { lo = Math.max(lo, -(c.duration - 1)); hi = Math.min(hi, hr.end); }
    else { lo = Math.max(lo, -hr.start); hi = Math.min(hi, c.duration - 1); }
  }
  const editPoint = edge === 'end' ? Math.max(...clips.map((c) => c.start + c.duration)) : Math.max(...clips.map((c) => c.start + c.duration));
  // kısaltmada sonraki kliplerin sola kayabileceği miktar
  const room = maxLeftShift(seq, editPoint, skip);
  if (edge === 'end') lo = Math.max(lo, -room);
  else hi = Math.min(hi, room);
  const d = Math.max(lo, Math.min(hi, delta));
  if (edge === 'end') {
    for (const c of clips) trimEnd(c, -d, fps);
    rippleShift(seq, editPoint, d, skip);
  } else {
    // içerik kayar, başlangıç sabit
    for (const c of clips) {
      if (!c.reverse) c.inPoint += (d / fps) * c.speed;
      c.duration -= d;
      shiftKeyframes(c, d);
    }
    rippleShift(seq, editPoint, -d, skip);
  }
  return d;
}

// Kesme noktasını kaydır: a'nın sonu ve b'nin başı birlikte
export function rollEdit(seq, project, pairs, delta) {
  const fps = seq.fps;
  let lo = -Infinity, hi = Infinity;
  for (const [a, b] of pairs) {
    const ha = headroom(a, clipMedia(project, a), fps);
    const hb = headroom(b, clipMedia(project, b), fps);
    hi = Math.min(hi, ha.end, b.duration - 1);
    lo = Math.max(lo, -(a.duration - 1), -hb.start);
  }
  const d = Math.max(lo, Math.min(hi, delta));
  for (const [a, b] of pairs) {
    trimEnd(a, -d, fps);
    trimStart(b, d, fps);
  }
  return d;
}

export function rateStretch(seq, project, ids, edge, delta) {
  const fps = seq.fps;
  const clips = ids.map((id) => seq.clips[id]).filter(Boolean);
  const skip = new Set(ids);
  let lo = -Infinity, hi = Infinity;
  for (const c of clips) {
    const list = clipsOnTrack(seq, c.type, c.track).filter((x) => !skip.has(x.id));
    lo = Math.max(lo, -(c.duration - 1));
    if (edge === 'end') {
      const nextStart = Math.min(Infinity, ...list.filter((x) => x.start >= c.start + c.duration).map((x) => x.start));
      hi = Math.min(hi, nextStart - (c.start + c.duration));
    } else {
      const prevEnd = Math.max(0, ...list.filter((x) => x.start + x.duration <= c.start).map((x) => x.start + x.duration));
      hi = Math.min(hi, c.start - prevEnd);
    }
    // hız sınırı (%1 - %10000)
    hi = Math.min(hi, c.duration * c.speed * 100 - c.duration);
    lo = Math.max(lo, Math.ceil((c.duration * c.speed) / 100) - c.duration);
  }
  const d = Math.max(lo, Math.min(hi, delta));
  for (const c of clips) {
    const oldDur = c.duration;
    const newDur = oldDur + d;
    c.speed = (c.speed * oldDur) / newDur;
    scaleKeyframes(c, newDur / oldDur);
    c.duration = newDur;
    if (edge === 'start') c.start -= d;
  }
  return d;
}

export function slipEdit(seq, project, ids, delta) {
  const fps = seq.fps;
  const clips = ids.map((id) => seq.clips[id]).filter(Boolean);
  let lo = -Infinity, hi = Infinity;
  for (const c of clips) {
    const hr = headroom(c, clipMedia(project, c), fps);
    // sağa sürükleme içeriği sağa kaydırır => inPoint azalır
    hi = Math.min(hi, c.reverse ? hr.end : hr.start);
    lo = Math.max(lo, -(c.reverse ? hr.start : hr.end));
  }
  const d = Math.max(lo, Math.min(hi, delta));
  for (const c of clips) c.inPoint -= (d / fps) * c.speed * (c.reverse ? -1 : 1);
  return d;
}

export function slideEdit(seq, project, ids, delta) {
  const fps = seq.fps;
  const clips = ids.map((id) => seq.clips[id]).filter(Boolean);
  const skip = new Set(ids);
  let lo = -Infinity, hi = Infinity;
  const plans = [];
  for (const c of clips) {
    const list = clipsOnTrack(seq, c.type, c.track).filter((x) => !skip.has(x.id));
    const prev = list.find((x) => x.start + x.duration === c.start) || null;
    const next = list.find((x) => x.start === c.start + c.duration) || null;
    if (prev) {
      const hp = headroom(prev, clipMedia(project, prev), fps);
      hi = Math.min(hi, hp.end);
      lo = Math.max(lo, -(prev.duration - 1));
    } else {
      const prevEnd = Math.max(0, ...list.filter((x) => x.start + x.duration <= c.start).map((x) => x.start + x.duration));
      lo = Math.max(lo, prevEnd - c.start);
    }
    if (next) {
      const hn = headroom(next, clipMedia(project, next), fps);
      hi = Math.min(hi, next.duration - 1);
      lo = Math.max(lo, -hn.start);
    } else {
      const nextStart = Math.min(Infinity, ...list.filter((x) => x.start >= c.start + c.duration).map((x) => x.start));
      hi = Math.min(hi, nextStart - (c.start + c.duration));
    }
    plans.push({ c, prev, next });
  }
  const d = Math.max(lo, Math.min(hi, delta));
  for (const { c, prev, next } of plans) {
    if (prev) trimEnd(prev, -d, fps);
    if (next) trimStart(next, d, fps);
    c.start += d;
  }
  return d;
}

// ---- Medya yerleştirme ----

export function ensureTracks(seq, type, count) {
  while (seq.tracks[type].length < count) {
    const tr = createTrack(type, seq.tracks[type].length);
    tr.targeted = false;
    seq.tracks[type].push(tr);
  }
}

export function fitScale(seq, w, h) {
  if (!w || !h) return 100;
  return Math.min(seq.width / w, seq.height / h) * 100;
}

// media'yı sekansa yerleştir. Döner: yeni klip id listesi
export function placeMedia(project, seq, media, opts) {
  const fps = seq.fps;
  const settings = opts.settings || {};
  let inSec = opts.inSec ?? 0;
  let outSec = opts.outSec ?? media.duration ?? 0;
  let dur;
  if (media.type === 'image') dur = Math.round((settings.stillDuration || 5) * fps);
  else dur = Math.max(1, Math.round((outSec - inSec) * fps));
  if (opts.duration) dur = opts.duration;
  const start = Math.max(0, Math.round(opts.start || 0));
  const wantV = media.hasVideo && opts.vTrack != null;
  const wantA = media.hasAudio && opts.aTrack != null && media.type !== 'image';
  if (wantV) ensureTracks(seq, 'video', opts.vTrack + 1);
  if (wantA) ensureTracks(seq, 'audio', opts.aTrack + 1);
  const linkId = wantV && wantA ? uid('lnk') : null;
  if (opts.mode === 'insert') {
    insertGap(seq, start, dur);
  } else {
    if (wantV) clearRange(seq, 'video', opts.vTrack, start, start + dur);
    if (wantA) clearRange(seq, 'audio', opts.aTrack, start, start + dur);
  }
  const ids = [];
  if (wantV) {
    const c = createClip(seq, { kind: 'media', mediaId: media.id, type: 'video', track: opts.vTrack, start, duration: dur, inPoint: inSec, linkId, name: media.name, media, label: media.label });
    if (settings.scaleToFrame && media.width && media.height && (media.width !== seq.width || media.height !== seq.height)) {
      c.props.scale.v = fitScale(seq, media.width, media.height);
    }
    seq.clips[c.id] = c;
    ids.push(c.id);
  }
  if (wantA) {
    const c = createClip(seq, { kind: 'media', mediaId: media.id, type: 'audio', track: opts.aTrack, start, duration: dur, inPoint: inSec, linkId, name: media.name, label: media.label });
    seq.clips[c.id] = c;
    ids.push(c.id);
  }
  return ids;
}

// Sentetik klip (metin, renk, ayar katmanı)
export function placeSynthetic(seq, kind, opts) {
  const dur = opts.duration;
  ensureTracks(seq, 'video', opts.track + 1);
  clearRange(seq, 'video', opts.track, opts.start, opts.start + dur);
  const c = createClip(seq, { kind, type: 'video', track: opts.track, start: opts.start, duration: dur, name: opts.name, text: opts.text, color: opts.color, graphic: opts.graphic });
  if (kind === 'text' || kind === 'color' || kind === 'adjustment' || kind === 'graphic') {
    c.props.anchor.v = null; // çizimde kaynağın merkezi kullanılır
  }
  seq.clips[c.id] = c;
  return c;
}

// İz için boş bir yer bul (frame..frame+dur), yoksa yeni iz
export function freeVideoTrackAbove(seq, from, dur, minTrack = 0) {
  for (let i = minTrack; i < seq.tracks.video.length; i++) {
    if (seq.tracks.video[i].locked) continue;
    const busy = clipsOnTrack(seq, 'video', i).some((c) => c.start < from + dur && c.start + c.duration > from);
    if (!busy) return i;
  }
  return seq.tracks.video.length;
}

// ---- Pano ----

export function copyClips(seq, ids) {
  const clips = ids.map((id) => seq.clips[id]).filter(Boolean);
  if (!clips.length) return null;
  const minStart = Math.min(...clips.map((c) => c.start));
  return { clips: clips.map((c) => ({ ...structuredClone(c), start: c.start - minStart })), fps: seq.fps };
}

export function pasteClips(seq, clip, at, mode = 'overwrite') {
  if (!clip) return [];
  const linkMap = new Map();
  const items = clip.clips.map((c) => {
    const n = structuredClone(c);
    n.id = uid('clp');
    if (c.linkId) {
      if (!linkMap.has(c.linkId)) linkMap.set(c.linkId, uid('lnk'));
      n.linkId = linkMap.get(c.linkId);
    }
    n.start = at + c.start;
    return n;
  });
  for (const n of items) ensureTracks(seq, n.type, n.track + 1);
  if (mode === 'insert') {
    const e = Math.max(...items.map((n) => n.start + n.duration));
    insertGap(seq, at, e - at);
  } else {
    for (const n of items) clearRange(seq, n.type, n.track, n.start, n.start + n.duration);
  }
  for (const n of items) seq.clips[n.id] = n;
  return items.map((n) => n.id);
}

// Paste Attributes: efektleri ve hareket parametrelerini kopyala
export function pasteAttributes(seq, srcClip, ids, opts = { motion: true, opacity: true, effects: true, volume: true }) {
  for (const id of ids) {
    const c = seq.clips[id];
    if (!c || c.id === srcClip.id) continue;
    if (c.type !== srcClip.type) continue;
    if (c.type === 'video') {
      if (opts.motion) for (const k of ['position', 'scale', 'scaleWidth', 'rotation']) c.props[k] = structuredClone(srcClip.props[k]);
      if (opts.motion) c.props.uniformScale = srcClip.props.uniformScale;
      if (opts.opacity) { c.props.opacity = structuredClone(srcClip.props.opacity); c.props.blendMode = srcClip.props.blendMode; c.masks = structuredClone(srcClip.masks || []); }
      if (opts.effects) c.effects = [...c.effects, ...structuredClone(srcClip.effects).map((fx) => ({ ...fx, id: uid('fx') }))];
    } else if (opts.volume) {
      c.props.volume = structuredClone(srcClip.props.volume);
      c.props.pan = structuredClone(srcClip.props.pan);
    }
  }
}

// Lift / Extract (in-out aralığı, hedef izler)
export function liftRange(seq, inF, outF, extract = false) {
  const tracks = allTrackKeys(seq).filter(([type, i]) => seq.tracks[type][i].targeted && !seq.tracks[type][i].locked);
  const useTracks = tracks.length ? tracks : allTrackKeys(seq).filter(([type, i]) => !seq.tracks[type][i].locked);
  for (const [type, i] of useTracks) clearRange(seq, type, i, inF, outF);
  if (extract) closeGap(seq, inF, outF);
}

export function setLinked(seq, ids, link) {
  if (link) {
    const l = uid('lnk');
    for (const id of ids) if (seq.clips[id]) seq.clips[id].linkId = l;
  } else {
    for (const id of ids) if (seq.clips[id]) seq.clips[id].linkId = null;
  }
}

export function expandLinked(seq, ids) {
  const out = new Set();
  for (const id of ids) {
    const c = seq.clips[id];
    if (!c) continue;
    for (const l of linkedClips(seq, c)) out.add(l.id);
  }
  return [...out];
}

// Hız/Süre
export function setSpeed(seq, project, ids, speedPct, opts = {}) {
  const fps = seq.fps;
  for (const id of ids) {
    const c = seq.clips[id];
    if (!c || (c.kind !== 'media' && c.kind !== 'sequence')) continue;
    const oldDur = c.duration;
    const srcDur = (c.duration / fps) * c.speed;
    const newSpeed = Math.max(0.01, speedPct / 100);
    let newDur = Math.max(1, Math.round((srcDur / newSpeed) * fps));
    const oldEnd = c.start + c.duration;
    c.speed = newSpeed;
    c.reverse = !!opts.reverse;
    scaleKeyframes(c, newDur / oldDur);
    if (!opts.ripple) {
      // sonraki klibe taşmasın
      const nextStart = Math.min(Infinity, ...clipsOnTrack(seq, c.type, c.track).filter((x) => x.id !== c.id && x.start >= oldEnd).map((x) => x.start));
      if (c.start + newDur > nextStart) newDur = nextStart - c.start;
      c.duration = Math.max(1, newDur);
    } else {
      c.duration = newDur;
      rippleShift(seq, oldEnd, newDur - oldDur, new Set(ids));
    }
  }
}

export function snapPoints(seq, excludeIds, extra = []) {
  const pts = new Set([0, ...extra]);
  for (const id in seq.clips) {
    if (excludeIds && excludeIds.has(id)) continue;
    const c = seq.clips[id];
    pts.add(c.start);
    pts.add(c.start + c.duration);
  }
  for (const m of seq.markers) pts.add(m.frame);
  if (seq.inFrame != null) pts.add(seq.inFrame);
  if (seq.outFrame != null) pts.add(seq.outFrame);
  return [...pts].sort((a, b) => a - b);
}

export function nearestSnap(points, f, threshold) {
  let best = null, bd = threshold + 1;
  for (const p of points) {
    const d = Math.abs(p - f);
    if (d < bd) { bd = d; best = p; }
  }
  return bd <= threshold ? best : null;
}

export { clipEnd };

// ---- Nested sekanslar ----

// Bir sekansı başka bir sekansa klip olarak yerleştir
export function placeSequence(project, seq, nested, opts) {
  const fps = seq.fps;
  const nDur = sequenceDuration(nested);
  const dur = Math.max(1, Math.round((nDur / nested.fps) * fps));
  const start = Math.max(0, Math.round(opts.start || 0));
  const wantV = opts.vTrack != null;
  const wantA = opts.aTrack != null && nested.tracks.audio.length > 0;
  if (wantV) ensureTracks(seq, 'video', opts.vTrack + 1);
  if (wantA) ensureTracks(seq, 'audio', opts.aTrack + 1);
  const linkId = wantV && wantA ? uid('lnk') : null;
  if (opts.mode === 'insert') insertGap(seq, start, dur);
  else {
    if (wantV) clearRange(seq, 'video', opts.vTrack, start, start + dur);
    if (wantA) clearRange(seq, 'audio', opts.aTrack, start, start + dur);
  }
  const ids = [];
  const pseudo = { width: nested.width, height: nested.height };
  if (wantV) {
    const c = createClip(seq, { kind: 'sequence', seqId: nested.id, type: 'video', track: opts.vTrack, start, duration: dur, inPoint: 0, linkId, name: nested.name, media: pseudo });
    seq.clips[c.id] = c;
    ids.push(c.id);
  }
  if (wantA) {
    const c = createClip(seq, { kind: 'sequence', seqId: nested.id, type: 'audio', track: opts.aTrack, start, duration: dur, inPoint: 0, linkId, name: nested.name });
    seq.clips[c.id] = c;
    ids.push(c.id);
  }
  return ids;
}

// Seçili klipleri yeni bir sekansa taşı ve yerine tek bir nested klip koy (Premiere "Nest")
export function nestClips(project, seq, ids, name) {
  const clips = ids.map((id) => seq.clips[id]).filter(Boolean);
  if (!clips.length) return null;
  const minStart = Math.min(...clips.map((c) => c.start));
  const maxEnd = Math.max(...clips.map((c) => c.start + c.duration));
  const vTracks = clips.filter((c) => c.type === 'video').map((c) => c.track);
  const aTracks = clips.filter((c) => c.type === 'audio').map((c) => c.track);
  const nested = createSequence({
    name, width: seq.width, height: seq.height, fps: seq.fps, binId: 'root',
    videoTracks: Math.max(1, seq.tracks.video.length), audioTracks: Math.max(1, seq.tracks.audio.length),
  });
  for (const c of clips) {
    const n = structuredClone(c);
    n.start = c.start - minStart;
    nested.clips[n.id] = n;
    delete seq.clips[c.id];
  }
  project.sequences[nested.id] = nested;
  const placed = placeSequence(project, seq, nested, {
    start: minStart,
    vTrack: vTracks.length ? Math.min(...vTracks) : null,
    aTrack: aTracks.length ? Math.min(...aTracks) : null,
    mode: 'overwrite',
  });
  // nested klibin süresi seçili aralığa eşit olsun
  for (const id of placed) seq.clips[id].duration = Math.max(1, maxEnd - minStart);
  return { nested, placed };
}
