// Önizleme render'ı (Premiere "Render In to Out"): bir aralığın son görüntüsü önceden dosyaya işlenir,
// oynatma o aralıkta katmanları tek tek birleştirmek yerine bu dosyayı gösterir (ağır efektler takılmaz).
// Aralığı etkileyen bir değişiklik olunca render geçersizleşir (zaman çizelgesinde kırmızı).
import { store } from './store.js';
import { t } from './i18n.js';
import { el, nodeFs, nodePath, ensureDir, hashString, uid, fmtSeconds } from './util.js';
import { ff } from './ffmpeg.js';
import { sequenceDuration, defaultVideoProps } from './model.js';
import { exportSequence } from './exporter.js';
import { modal, toast } from './ui/dialogs.js';

const dir = () => ensureDir(nodePath.join(ff.cacheDir, 'renders'));
const indexFile = () => nodePath.join(dir(), 'index.json');
let index = null; // { seqId: [{ f0, f1, file, sig, w, h, fps }] }
let validity = new Map(); // dosya -> geçerli mi (store değişince yeniden hesaplanır)
let version = 0, checkedVersion = -1;

function load() {
  if (index) return index;
  try { index = JSON.parse(nodeFs.readFileSync(indexFile(), 'utf8')); } catch (e) { index = {}; }
  return index;
}
function save() { try { nodeFs.writeFileSync(indexFile(), JSON.stringify(index)); } catch (e) { /* */ } }

store.on('change', () => { version++; });

// Aralığın görüntüsünü etkileyen her şeyin imzası (klipler, iç içe sekanslar, iz görünürlüğü, altyazılar, medya dosyaları)
export function rangeSignature(project, seq, f0, f1) {
  const clips = Object.values(seq.clips).filter((c) => c.type === 'video' && c.start < f1 + 60 && c.start + c.duration > f0 - 60).sort((a, b) => (a.id < b.id ? -1 : 1));
  const nested = new Set();
  const walk = (s, depth) => { for (const c of Object.values(s.clips)) if (c.kind === 'sequence' && !nested.has(c.seqId) && depth < 6) { nested.add(c.seqId); const n = project.sequences[c.seqId]; if (n) walk(n, depth + 1); } };
  for (const c of clips) if (c.kind === 'sequence' && project.sequences[c.seqId]) { nested.add(c.seqId); walk(project.sequences[c.seqId], 1); }
  const media = new Set(clips.map((c) => c.mediaId).filter(Boolean));
  for (const id of nested) for (const c of Object.values(project.sequences[id]?.clips || {})) if (c.mediaId) media.add(c.mediaId);
  const caps = (seq.captions || []).filter((c) => c.start < f1 && c.start + c.duration > f0);
  return hashString(JSON.stringify({
    w: seq.width, h: seq.height, fps: seq.fps, tracks: seq.tracks.video.map((tr) => !!tr.hidden), clips,
    nested: [...nested].sort().map((id) => project.sequences[id]), media: [...media].sort().map((id) => { const m = project.media[id]; return m ? [m.path, m.key, m.subStart, m.subEnd] : null; }),
    caps, capStyle: caps.length ? [seq.captionStyle, seq.captionsVisible] : null,
  }));
}

export function rendersFor(seq) {
  const all = load()[seq.id] || [];
  if (checkedVersion !== version) {
    checkedVersion = version;
    validity = new Map();
  }
  return all.map((r) => {
    if (!validity.has(r.file)) validity.set(r.file, nodeFs.existsSync(r.file) && rangeSignature(store.project, seq, r.f0, r.f1) === r.sig);
    return { ...r, valid: validity.get(r.file) };
  });
}

// Oynatma için: bu karede geçerli render varsa sentetik klip/medya döndürür
export function renderAt(seq, f) {
  if (!seq) return null;
  const r = rendersFor(seq).find((x) => x.valid && f >= x.f0 && f < x.f1);
  if (!r) return null;
  const media = { id: 'render:' + hashString(r.file), path: r.file, name: 'render', type: 'video', hasVideo: true, hasAudio: false, width: r.w, height: r.h, fps: r.fps, duration: (r.f1 - r.f0) / r.fps };
  const clip = { id: 'render_' + hashString(r.file), kind: 'media', type: 'video', track: 0, start: r.f0, duration: r.f1 - r.f0, inPoint: 0, speed: 1, reverse: false, enabled: true, effects: [], masks: [], props: defaultVideoProps(seq, { width: r.w, height: r.h }) };
  return { r, media, clip };
}

export function deleteRenders(seq) {
  const all = load()[seq.id] || [];
  for (const r of all) try { nodeFs.unlinkSync(r.file); } catch (e) { /* */ }
  delete index[seq.id];
  save();
  version++;
}

// Giriş-Çıkış aralığını (yoksa tüm sekansı) render et
export async function renderInOut(seq) {
  const dur = sequenceDuration(seq);
  if (!dur) { toast(t('The sequence is empty.'), 'warn'); return; }
  const f0 = seq.inFrame ?? 0, f1 = seq.outFrame ?? dur;
  if (f1 <= f0) return;
  const sig = rangeSignature(store.project, seq, f0, f1);
  const existing = rendersFor(seq).find((r) => r.valid && r.f0 <= f0 && r.f1 >= f1);
  if (existing) { toast(t('This range is already rendered')); return; }
  const file = nodePath.join(dir(), `${seq.id}_${f0}_${f1}_${uid('r')}.mp4`);
  const ctrl = new AbortController();
  const bar = el('div', { class: 'progress' }, el('div'));
  const info = el('div', { class: 'muted', style: { marginTop: '6px', fontFamily: 'var(--mono)' } });
  let closeFn = null;
  modal({ title: t('Rendering Preview'), body: el('div', { style: { width: '380px' } }, bar, info), escape: false, onOpen: (c) => { closeFn = c; }, buttons: [{ label: t('Cancel'), onClick: () => { ctrl.abort(); return false; } }] });
  const t0 = performance.now();
  try {
    await exportSequence(seq, { format: 'mp4_h264', file, width: seq.width, height: seq.height, crf: 15, preset: 'veryfast', hw: !!ff.nvenc, audio: false, sampleRate: 48000, range: [f0, f1] }, {
      signal: ctrl.signal,
      onProgress: (p, eta) => { bar.firstChild.style.width = Math.round(p * 100) + '%'; info.textContent = Math.round(p * 100) + '%' + (eta != null ? '  ·  ' + t('Remaining') + ' ' + fmtSeconds(eta) : ''); },
    });
    load();
    // bu aralıkla çakışan eski renderleri kaldır
    const keep = [];
    for (const r of index[seq.id] || []) { if (r.f0 < f1 && r.f1 > f0) { try { nodeFs.unlinkSync(r.file); } catch (e) { /* */ } } else keep.push(r); }
    keep.push({ f0, f1, file, sig, w: seq.width, h: seq.height, fps: seq.fps });
    index[seq.id] = keep;
    save();
    version++;
    toast(t('Preview rendered') + ' · ' + fmtSeconds((performance.now() - t0) / 1000));
  } catch (e) {
    try { nodeFs.unlinkSync(file); } catch (er) { /* */ }
    if (!(e.cancelled || e.message === 'cancelled' || ctrl.signal.aborted)) toast(t('Render failed') + ': ' + e.message, 'error');
  } finally { if (closeFn) closeFn(); }
}
