// Otomatik dikey çevirme (auto reframe): sekansın 9:16 / 1:1 / 4:5 kopyasını oluşturur, her video klipte
// yüzü (yoksa kişiyi) takip ederek kadrajı yumuşak bir "sanal kamera" ile kaydırır. Orijinal sekans değişmez.
import { store } from './store.js';
import { app } from './appContext.js';
import { t } from './i18n.js';
import { el, uid, childProcess } from './util.js';
import { ff } from './ffmpeg.js';
import { clipMedia } from './model.js';
import { modal, toast, selectEl } from './ui/dialogs.js';
import { ensureFaceDetector, detectFaces, ensureSegmenter, personMask } from './vision.js';

export const REFRAME_RATIOS = [['9:16', 9, 16, 'TikTok / Reels / Shorts'], ['1:1', 1, 1, 'Instagram'], ['4:5', 4, 5, 'Instagram']];
const even = (v) => Math.max(2, Math.round(v / 2) * 2);

// Kaynaktan küçük kareler (RGBA, en fazla 320 px genişlik) — sn başına `rate` kare
function readFrames(path, t0, dur, w, h, rate, onFrame) {
  return new Promise((resolve, reject) => {
    const sw = 320, sh = even((320 * h) / w);
    const p = childProcess.spawn(ff.ffmpeg, ['-hide_banner', '-v', 'error', '-ss', t0.toFixed(3), '-t', dur.toFixed(3), '-i', path, '-an', '-vf', `fps=${rate},scale=${sw}:${sh}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { windowsHide: true });
    const size = sw * sh * 4;
    let buf = Buffer.alloc(0), i = 0;
    p.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= size) {
        const img = new ImageData(new Uint8ClampedArray(buf.buffer.slice(buf.byteOffset, buf.byteOffset + size)), sw, sh);
        onFrame(img, i++ / rate);
        buf = buf.subarray(size);
      }
    });
    p.on('error', reject);
    p.on('close', () => resolve({ sw, sh }));
  });
}

// Bir klip için kişinin yatay merkezi (0..1) zaman içinde: [{ t (kaynak sn, girişe göre), x }]
export async function trackSubject(media, inSec, dur, { rate = 4 } = {}) {
  await ensureFaceDetector();
  let segOk = true;
  try { await ensureSegmenter(0); } catch (e) { segOk = false; }
  const samples = [];
  await readFrames(media.path, inSec, dur, media.width || 1920, media.height || 1080, rate, (img, tt) => {
    const faces = detectFaces(img).filter((f) => f.score > 0.5);
    let x = null;
    if (faces.length) {
      // en büyük yüz (konuşan kişi genellikle en yakındır)
      const f = faces.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
      x = (f.x + f.w / 2) / img.width;
    } else if (segOk) {
      const m = personMask(0, img);
      if (m) {
        let sx = 0, s = 0;
        for (let y = 0; y < img.height; y++) for (let xx = 0; xx < img.width; xx++) { const v = m[y * img.width + xx]; if (v > 0.5) { sx += xx * v; s += v; } }
        if (s > img.width * img.height * 0.02) x = sx / s / img.width;
      }
    }
    samples.push({ t: tt, x });
  });
  return samples;
}

// Sanal kamera: eksik örnekleri doldur, ortanca filtre, ölü bölge + yumuşak takip, gereksiz anahtar kareleri at
export function cameraPath(samples, { deadZone = 0.06, follow = 0.5 } = {}) {
  if (!samples.length) return [];
  const xs = samples.map((s) => s.x);
  let last = xs.find((x) => x != null) ?? 0.5;
  for (let i = 0; i < xs.length; i++) { if (xs[i] == null) xs[i] = last; else last = xs[i]; }
  const med = xs.map((_, i) => { const w = xs.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b); return w[w.length >> 1]; });
  const out = [];
  // histerezis: kişi ölü bölgeden çıkınca kamera harekete geçer ve kişiyi tam ortalayana kadar takip eder,
  // sonra durur (küçük kıpırdanmalarda kamera sabit kalır)
  let cam = med[0], moving = false;
  for (let i = 0; i < med.length; i++) {
    const d = med[i] - cam;
    if (!moving && Math.abs(d) > deadZone) moving = true;
    if (moving) {
      cam += d * follow;
      if (Math.abs(med[i] - cam) < 0.01) { cam = med[i]; moving = false; }
    }
    out.push({ t: samples[i].t, x: cam });
  }
  // aynı yerde duran ardışık noktaları ve doğrusal ara noktaları kaldır
  const simp = [out[0]];
  for (let i = 1; i < out.length - 1; i++) {
    const a = simp[simp.length - 1], b = out[i], c = out[i + 1];
    const lin = a.x + ((c.x - a.x) * (b.t - a.t)) / Math.max(1e-6, c.t - a.t);
    if (Math.abs(b.x - lin) > 0.004) simp.push(b);
  }
  if (out.length > 1) simp.push(out[out.length - 1]);
  return simp;
}

// Sekansın oranlı bir kopyasını oluştur ve video kliplerini kişiyi takip edecek şekilde kadrajla
export async function autoReframe(seqId, ratio = '9:16', { onProgress } = {}) {
  const p = store.project;
  const src = p.sequences[seqId];
  const rr = REFRAME_RATIOS.find((x) => x[0] === ratio) || REFRAME_RATIOS[0];
  const short = Math.min(src.width, src.height);
  const [W, H] = rr[1] >= rr[2] ? [even((short * rr[1]) / rr[2]), even(short)] : [even(short), even((short * rr[2]) / rr[1])];
  const dx = (W - src.width) / 2, dy = (H - src.height) / 2;
  // her klip için takip (kopyalamadan önce; uzun iş)
  const vids = Object.values(src.clips).filter((c) => c.type === 'video' && c.kind === 'media' && !c.reverse);
  const paths = new Map();
  let done = 0;
  for (const c of vids) {
    const m = clipMedia(p, c);
    if (!m || !m.path || m.type === 'image' || !m.width) { done++; continue; }
    const sp = c.speed || 1;
    const dur = (c.duration / src.fps) * sp;
    const samples = await trackSubject(m, c.inPoint, dur);
    paths.set(c.id, cameraPath(samples));
    onProgress && onProgress(++done / vids.length);
  }
  const newId = uid('seq');
  store.commit(t('Auto Reframe'), (pr) => {
    const s0 = pr.sequences[seqId];
    const s = structuredClone(s0);
    s.id = newId;
    s.name = s0.name + ' ' + ratio;
    s.width = W; s.height = H;
    s.createdAt = Date.now();
    const idMap = new Map();
    const clips = {};
    for (const c of Object.values(s.clips)) {
      const oldId = c.id;
      const nid = uid('clp');
      idMap.set(c.id, nid);
      c.id = nid;
      clips[nid] = c;
      if (c.type !== 'video') continue;
      if (c.kind === 'graphic') { for (const L of c.graphic?.layers || []) { L.x += dx; L.y += dy; } }
      const pos = c.props.position;
      const shift = (v) => (Array.isArray(v) ? [v[0] + dx, v[1] + dy] : v);
      if (pos) { pos.v = shift(pos.v); if (pos.kf) for (const k of pos.kf) k.v = shift(k.v); }
      const m = clipMedia(pr, c);
      const path = paths.get(oldId);
      if ((c.kind === 'media' || c.kind === 'sequence') && m && m.width && m.height) {
        // kareyi kapla (cover); kadrajı kişiye göre kaydır
        const k = Math.max(W / m.width, H / m.height);
        c.props.scale = { v: Math.round(k * 1000) / 10, kf: null };
        const Ws = m.width * k;
        const posX = (x) => Math.max(W - Ws / 2, Math.min(Ws / 2, W / 2 + (0.5 - x) * Ws));
        if (path && path.length) {
          const sp = c.speed || 1;
          const kf = path.map((pt) => ({ f: Math.max(0, Math.round((pt.t / sp) * s.fps)), v: [Math.round(posX(pt.x) * 10) / 10, H / 2], e: 'linear' }))
            .filter((x, i, a) => i === 0 || x.f > a[i - 1].f);
          c.props.position = kf.length > 1 ? { v: kf[0].v, kf } : { v: kf[0].v, kf: null };
        } else c.props.position = { v: [W / 2, H / 2], kf: null };
        c.bgFill = null;
      }
    }
    s.clips = clips;
    pr.sequences[newId] = s;
  });
  return { sequenceId: newId, width: W, height: H, clips: vids.length };
}

export async function autoReframeDialog() {
  const seq = store.seq;
  if (!seq) return null;
  if (!Object.values(seq.clips).some((c) => c.type === 'video' && c.kind === 'media')) { toast(t('This sequence has no video clips'), 'warn'); return null; }
  const ratio = selectEl(REFRAME_RATIOS.map(([id, , , hint]) => ({ value: id, label: id + '  ·  ' + t(hint) })), '9:16');
  const body = el('div', {},
    el('div', { style: { display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: '8px' } }, el('span', { text: t('Format') }), ratio),
    el('div', { text: t('A new sequence is created; the frame follows the person\'s face (or body) in every clip. Your original sequence is not changed.'), style: { color: 'var(--text-dim)', fontSize: '11px', marginTop: '10px', lineHeight: '1.5' } }));
  const r = await modal({ title: t('Auto Reframe'), body, width: 480, buttons: [{ label: t('Cancel'), value: null }, { label: t('Reframe'), primary: true, onClick: () => ({ ratio: ratio.value }) }] });
  if (!r) return null;
  const bar = el('div', { class: 'progress' }, el('div'));
  const info = el('div', { class: 'muted', style: { marginTop: '6px' }, text: t('Finding the person in each clip...') });
  let closeFn = null;
  modal({ title: t('Auto Reframe'), body: el('div', { style: { width: '380px' } }, bar, info), escape: false, onOpen: (c) => { closeFn = c; }, buttons: [] });
  try {
    const res = await autoReframe(seq.id, r.ratio, { onProgress: (q) => { bar.firstChild.style.width = Math.round(q * 100) + '%'; } });
    app.commands.openSequence(res.sequenceId);
    toast(t('Reframed sequence created') + ': ' + res.width + '×' + res.height, 'success');
    return res;
  } catch (e) {
    console.error(e);
    toast(t('Auto reframe failed') + ': ' + e.message, 'error', 8000);
    return null;
  } finally { if (closeFn) closeFn(); }
}
