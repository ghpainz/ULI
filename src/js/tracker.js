// Maske takibi: klibin kaynağını FFmpeg ile gri, düşük çözünürlüklü kareler halinde çözer,
// maske bölgesindeki yamaları normalize çapraz korelasyon (NCC) ile kareden kareye izler
// ve maske yoluna her kare için keyframe yazar.
import { store } from './store.js';
import { app } from './appContext.js';
import { ff } from './ffmpeg.js';
import { childProcess, fpsToFraction, el, fmtSeconds } from './util.js';
import { sourceTimeAt } from './model.js';
import { evalParam } from './keyframes.js';
import { findMask } from './masks.js';
import * as MG from './maskGeom.js';
import { trackFrames } from './trackCore.js';
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
  if (clip.reverse || clip.speed < 0.01) { toast(t('Mask tracking is not available for reversed or frozen clips'), 'error'); return; }
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
