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
    store.commit('Track Mask', (pr) => {
      const c = pr.sequences[pr.activeSequenceId].clips[clipId];
      const mm = findMask(c, owner, maskId);
      if (!mm) return false;
      const p = mm.path;
      if (!p.kf || !p.kf.length) p.kf = [{ f: l0, v: structuredClone(startPath), e: 'linear' }];
      const map = new Map(p.kf.map((k) => [k.f, k]));
      for (let i = 1; i < T.length; i++) {
        const f = dir === 'fwd' ? l0 + i : l0 - i;
        const v = MG.transformPath(mm.type, startPath, T[i]);
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
function estimateMotion(prev, cur, w, h) {
  const ci = integral(cur, w, h);
  const P = [], Q = [];
  const gx = 6, gy = 4, r = 10, R = 24;
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    const px = ((i + 0.5) / gx) * w, py = ((j + 0.5) / gy) * h;
    const m = matchPatch(prev, cur, ci, w, h, px, py, r, px, py, R);
    if (!m || m.score < 0.6) continue;
    P.push([px - w / 2, py - h / 2]);
    Q.push([m.x - w / 2, m.y - h / 2]);
  }
  if (P.length < 3) return null;
  let T = fitSimilarity(P, Q);
  // aykırıları (hareketli nesneler) at, yeniden uydur
  const keepP = [], keepQ = [];
  const c = Math.cos(T.rot) * T.s, s = Math.sin(T.rot) * T.s;
  for (let k = 0; k < P.length; k++) {
    const ex = c * P[k][0] - s * P[k][1] + T.tx - Q[k][0], ey = s * P[k][0] + c * P[k][1] + T.ty - Q[k][1];
    if (Math.hypot(ex, ey) < 1.5) { keepP.push(P[k]); keepQ.push(Q[k]); }
  }
  if (keepP.length >= 3) T = fitSimilarity(keepP, keepQ);
  return T;
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
    let C = IDENT.slice();
    for (let i = 1; i < dec.frames.length; i++) {
      if (ctrl.signal.aborted) throw Object.assign(new Error('cancelled'), { cancelled: true });
      const T = estimateMotion(dec.frames[i - 1], dec.frames[i], dec.w, dec.h);
      const M = T ? [T.s * Math.cos(T.rot), T.s * Math.sin(T.rot), T.tx * sc, T.ty * sc] : IDENT.slice();
      C = compose(M, C);
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
