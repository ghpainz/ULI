// Maske takibi: klibin kaynağını FFmpeg ile gri, düşük çözünürlüklü kareler halinde çözer,
// maske bölgesindeki yamaları normalize çapraz korelasyon (NCC) ile kareden kareye izler
// ve maske yoluna her kare için keyframe yazar.
import { store } from './store.js';
import { app } from './appContext.js';
import { ff } from './ffmpeg.js';
import { childProcess, fpsToFraction, el, fmtSeconds } from './util.js';
import { sourceTimeAt, remapActive } from './model.js';
import { evalParam } from './keyframes.js';
import { findMask } from './masks.js';
import * as MG from './maskGeom.js';
import { trackFrames, integral, matchPatch, fitSimilarity } from './trackCore.js';
import { compose, IDENT } from './stabilize.js';
import { uid } from './util.js';
import { t } from './i18n.js';
import { modal, toast } from './ui/dialogs.js';

const TRACK_W = 512; // analiz genişliği (px)
const MAX_FRAMES = 3000;

function even(n) { return Math.max(2, Math.round(n / 2) * 2); }

// Zaman çizelgesi yerel kareleri [L0, L1] için gri kareler
function decodeGray(clip, media, seq, L0, L1, signal, onFrame) {
  const tw = Math.min(TRACK_W, even(media.width));
  const th = even((media.height * tw) / media.width);
  const s0 = Math.max(0, sourceTimeAt(clip, clip.start + L0, seq.fps));
  const count = L1 - L0 + 1;
  const vf = `setpts=(PTS-STARTPTS)/${clip.speed},fps=${fpsToFraction(seq.fps)},scale=${tw}:${th}:flags=area,format=gray`;
  const args = ['-hide_banner', '-v', 'error', '-ss', s0.toFixed(6), '-i', media.path, '-an', '-sn', '-vf', vf, '-frames:v', String(count), '-f', 'rawvideo', '-pix_fmt', 'gray', '-'];
  return new Promise((resolve, reject) => {
    const p = childProcess.spawn(ff.ffmpeg, args, { windowsHide: true });
    const size = tw * th;
    const frames = [];
    let cur = new Uint8Array(size), off = 0, err = '';
    p.stdout.on('data', (chunk) => {
      let i = 0;
      while (i < chunk.length) {
        const n = Math.min(size - off, chunk.length - i);
        cur.set(chunk.subarray(i, i + n), off);
        off += n; i += n;
        if (off === size) { frames.push(cur); onFrame && onFrame(frames.length / count); cur = new Uint8Array(size); off = 0; }
      }
    });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (signal.aborted) { reject(Object.assign(new Error('cancelled'), { cancelled: true })); return; }
      if (code !== 0 && !frames.length) { reject(new Error(err.slice(-400) || 'ffmpeg ' + code)); return; }
      // eksik son kareleri tekrarla
      while (frames.length && frames.length < count) frames.push(frames[frames.length - 1]);
      resolve({ frames, w: tw, h: th, scale: tw / media.width });
    });
    signal.addEventListener('abort', () => { try { p.kill('SIGKILL'); } catch (e) { /* */ } });
  });
}

// Arayüzden çağrılan ana fonksiyon. dir: 'fwd'|'back', single: tek kare
export async function trackMask({ clipId, owner, maskId, method = 'psr', dir = 'fwd', single = false }) {
  const seq = store.seq;
  const clip = seq?.clips[clipId];
  const media = clip?.mediaId ? store.project.media[clip.mediaId] : null;
  if (!clip || clip.kind !== 'media' || !media || media.type !== 'video' || !media.hasVideo) { toast(t('Mask tracking needs a video clip'), 'error'); return; }
  if (clip.reverse || clip.speed < 0.01 || remapActive(clip)) { toast(t('Mask tracking is not available for reversed or frozen clips'), 'error'); return; }
  const mask = findMask(clip, owner, maskId);
  if (!mask) return;
  if (app.engine.playing) app.engine.pause();
  const l0 = Math.max(0, Math.min(clip.duration - 1, app.engine.currentFrame - clip.start));
  let a, b;
  if (dir === 'fwd') { a = l0; b = single ? Math.min(clip.duration - 1, l0 + 1) : clip.duration - 1; }
  else { a = single ? Math.max(0, l0 - 1) : 0; b = l0; }
  if (b - a > MAX_FRAMES) { if (dir === 'fwd') b = a + MAX_FRAMES; else a = b - MAX_FRAMES; }
  if (b <= a) { toast(t('Nothing to track in this direction')); return; }
  const startPath = evalParam(mask.path, l0);
  const ctrl = new AbortController();
  const bar = el('div', { class: 'progress' }, el('div'));
  const status = el('div', { style: { marginBottom: '8px' }, text: t('Decoding frames...') });
  let closeFn = null;
  const shown = !single;
  if (shown) {
    modal({ title: t('Tracking Mask'), body: el('div', { style: { width: '380px' } }, status, bar), escape: false, onOpen: (c) => { closeFn = c; }, buttons: [{ label: t('Stop'), onClick: () => { ctrl.abort(); return false; } }] });
  }
  const setP = (p) => { bar.firstChild.style.width = Math.round(p * 100) + '%'; };
  const t0 = performance.now();
  try {
    const dec = await decodeGray(clip, media, seq, a, b, ctrl.signal, (p) => setP(p * 0.3));
    let frames = dec.frames;
    if (dir === 'back') frames = frames.slice().reverse();
    status.textContent = t('Tracking...');
    const T = await trackFrames(frames, dec.w, dec.h, dec.scale, startPath, mask.type, method, (p) => { setP(0.3 + 0.7 * p); return !ctrl.signal.aborted; });
    setP(1);
    // keyframe yaz
    const written = T.length;
    let converted = false;
    store.commit('Track Mask', (pr) => {
      const c = pr.sequences[pr.activeSequenceId].clips[clipId];
      const mm = findMask(c, owner, maskId);
      if (!mm) return false;
      const p = mm.path;
      let base = startPath;
      // elips dönemez: dönüşlü takipte maske eşdeğer bezier eğriye çevrilir
      if (mm.type === 'ellipse' && method !== 'position' && T.some((x) => x && Math.abs(x.rot) > 0.002)) {
        mm.type = 'bezier';
        if (p.kf) for (const k of p.kf) k.v = MG.ellipseToBezier(k.v);
        p.v = MG.ellipseToBezier(p.v);
        base = MG.ellipseToBezier(startPath);
        converted = true;
      }
      if (!p.kf || !p.kf.length) p.kf = [{ f: l0, v: structuredClone(base), e: 'linear' }];
      const map = new Map(p.kf.map((k) => [k.f, k]));
      for (let i = 1; i < T.length; i++) {
        const f = dir === 'fwd' ? l0 + i : l0 - i;
        const v = MG.transformPath(mm.type, base, T[i]);
        map.set(f, { f, v, e: 'linear' });
      }
      p.kf = [...map.values()].sort((x, y) => x.f - y.f);
    });
    const lastF = dir === 'fwd' ? l0 + written - 1 : l0 - written + 1;
    app.engine.setFrame(clip.start + lastF);
    const expected = b - a + 1;
    if (!single) {
      if (written < expected && !ctrl.signal.aborted) toast(t('Tracking lost after {n} frames. Adjust the mask and track again.', { n: written - 1 }), 'error', 5000);
      else toast(t('Mask tracked: {n} frames in {s}', { n: written - 1, s: fmtSeconds((performance.now() - t0) / 1000) }));
    } else if (written < 2) toast(t('Tracking lost after {n} frames. Adjust the mask and track again.', { n: 0 }), 'error');
  } catch (e) {
    if (!e.cancelled) toast(t('Mask tracking failed') + ': ' + e.message, 'error', 6000);
  } finally {
    if (closeFn) closeFn();
  }
}

// ---- Warp Stabilizer analizi ----
// Kareden kareye global hareketi (benzerlik) ölçer, kamera yolunu efektin stabData parametresine yazar.
const median = (a) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };

// ref -> cur benzerlik dönüşümü (ortalanmış küçük kare koordinatları). pred: önceki tahmin, arama merkezini belirler.
// Medyan tabanlı sağlam kestirim + iç noktalarla en küçük kareler (hareketli nesneler ve kötü eşleşmeler elenir).
function estimateMotion(ref, cur, w, h, pred = null) {
  const ci = integral(cur, w, h);
  const P = [], Q = [];
  const gx = 8, gy = 5, r = 10, R = pred ? 12 : 24;
  const [pa, pb, ptx, pty] = pred || [1, 0, 0, 0];
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    const px = ((i + 0.5) / gx) * w, py = ((j + 0.5) / gy) * h;
    const X = px - w / 2, Y = py - h / 2;
    const sx = pa * X - pb * Y + ptx + w / 2, sy = pb * X + pa * Y + pty + h / 2;
    const m = matchPatch(ref, cur, ci, w, h, px, py, r, sx, sy, R);
    if (!m || m.score < 0.7) continue;
    P.push([X, Y]);
    Q.push([m.x - w / 2, m.y - h / 2]);
  }
  if (P.length < 4) return null;
  const ratios = [], angs = [];
  const minD = Math.min(w, h) * 0.2;
  for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) {
    const dpx = P[b][0] - P[a][0], dpy = P[b][1] - P[a][1], dqx = Q[b][0] - Q[a][0], dqy = Q[b][1] - Q[a][1];
    const dp = Math.hypot(dpx, dpy);
    if (dp < minD) continue;
    ratios.push(Math.hypot(dqx, dqy) / dp);
    let d = Math.atan2(dqy, dqx) - Math.atan2(dpy, dpx);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    angs.push(d);
  }
  const s0 = ratios.length ? median(ratios) : 1, r0 = angs.length ? median(angs) : 0;
  const c0 = Math.cos(r0) * s0, n0 = Math.sin(r0) * s0;
  const tx0 = median(P.map((p, k) => Q[k][0] - (c0 * p[0] - n0 * p[1]))), ty0 = median(P.map((p, k) => Q[k][1] - (n0 * p[0] + c0 * p[1])));
  const iP = [], iQ = [];
  for (let k = 0; k < P.length; k++) {
    const ex = c0 * P[k][0] - n0 * P[k][1] + tx0 - Q[k][0], ey = n0 * P[k][0] + c0 * P[k][1] + ty0 - Q[k][1];
    if (Math.hypot(ex, ey) < 1.0) { iP.push(P[k]); iQ.push(Q[k]); }
  }
  const T = iP.length >= 4 ? fitSimilarity(iP, iQ) : { s: s0, rot: r0, tx: tx0, ty: ty0 };
  return { T, inliers: iP.length, total: P.length };
}

export async function analyzeStabilize({ clipId, fxId }) {
  const seq = store.seq;
  const clip = seq?.clips[clipId];
  const media = clip?.mediaId ? store.project.media[clip.mediaId] : null;
  if (!clip || clip.kind !== 'media' || !media || media.type !== 'video') { toast(t('Warp Stabilizer needs a video clip'), 'error'); return; }
  if (clip.reverse || clip.speed < 0.01 || remapActive(clip)) { toast(t('Warp Stabilizer is not available for reversed, frozen or time-remapped clips'), 'error'); return; }
  if (app.engine.playing) app.engine.pause();
  const n = Math.min(clip.duration, MAX_FRAMES);
  const ctrl = new AbortController();
  const bar = el('div', { class: 'progress' }, el('div'));
  const status = el('div', { style: { marginBottom: '8px' }, text: t('Decoding frames...') });
  let closeFn = null;
  modal({ title: t('Warp Stabilizer'), body: el('div', { style: { width: '380px' } }, status, bar), escape: false, onOpen: (c) => { closeFn = c; }, buttons: [{ label: t('Cancel'), onClick: () => { ctrl.abort(); return false; } }] });
  const setP = (p) => { bar.firstChild.style.width = Math.round(p * 100) + '%'; };
  try {
    const dec = await decodeGray(clip, media, seq, 0, n - 1, ctrl.signal, (p) => setP(p * 0.35));
    status.textContent = t('Analyzing motion...');
    const sc = media.width / dec.w;
    const raw = [IDENT.slice()];
    // Hareket ardışık kareler yerine bir referans (çapa) kareye göre ölçülür; böylece küçük hatalar her karede birikmez.
    // Eşleşme zayıflayınca ya da 30 kare geçince çapa bir önceki kareye taşınır.
    let anchor = 0, Cref = IDENT.slice(), rel = null;
    const vec = (T) => [T.s * Math.cos(T.rot), T.s * Math.sin(T.rot), T.tx, T.ty];
    for (let i = 1; i < dec.frames.length; i++) {
      if (ctrl.signal.aborted) throw Object.assign(new Error('cancelled'), { cancelled: true });
      let r = estimateMotion(dec.frames[anchor], dec.frames[i], dec.w, dec.h, rel);
      const weak = !r || r.inliers < Math.max(8, r.total * 0.5) || i - anchor > 30;
      if (weak && anchor !== i - 1) {
        anchor = i - 1;
        Cref = raw[anchor].slice();
        rel = null;
        r = estimateMotion(dec.frames[anchor], dec.frames[i], dec.w, dec.h, null);
      }
      // eşleşme yoksa kamera bir önceki karedeki gibi kabul edilir
      const Md = r ? vec(r.T) : (rel || [1, 0, 0, 0]);
      rel = Md;
      const C = compose([Md[0], Md[1], Md[2] * sc, Md[3] * sc], Cref);
      raw.push(C.map((v) => Math.round(v * 1e5) / 1e5));
      if (i % 4 === 0) { setP(0.35 + 0.65 * (i / dec.frames.length)); await new Promise((r) => setTimeout(r, 0)); }
    }
    store.commit('Analyze Warp Stabilizer', (pr) => {
      const c = pr.sequences[pr.activeSequenceId].clips[clipId];
      const fx = c && c.effects.find((x) => x.id === fxId);
      if (!fx) return false;
      fx.params.stabData = { v: { id: uid('stab'), raw, W: media.width, H: media.height, inPoint: clip.inPoint, fps: seq.fps, speed: clip.speed }, kf: null, static: true };
    });
    app.engine.requestRender();
    toast(t('Stabilization analyzed: {n} frames', { n: raw.length }));
  } catch (e) {
    if (!e.cancelled) toast(t('Analysis failed') + ': ' + e.message, 'error', 6000);
  } finally {
    if (closeFn) closeFn();
  }
}
