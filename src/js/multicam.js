// Çok kameralı kurgu: kaynak sekans oluşturma (başlangıç / giriş noktası / ses senkronu),
// Program monitöründe açı ızgarası, açı değiştirme (durdurulmuşken klibi değiştirir, oynarken canlı keser).
import { store } from './store.js';
import { app } from './appContext.js';
import { t } from './i18n.js';
import { el } from './util.js';
import { createSequence, mediaRange, sequenceDuration, defaultVideoProps } from './model.js';
import * as E from './editing.js';
import { makeItem } from './renderGraph.js';
import { audioOffset } from './audioTools.js';
import { registerJob } from './ffmpeg.js';
import { modal, toast, selectEl } from './ui/dialogs.js';

export const isMulticamClip = (c) => !!(c && c.kind === 'sequence' && c.multicam);

// Oynatma kafasındaki en üst multicam video klibi
export function activeMulticamClip(seq, f) {
  if (!seq) return null;
  let best = null;
  for (const id in seq.clips) {
    const c = seq.clips[id];
    if (c.type !== 'video' || !c.enabled || !isMulticamClip(c)) continue;
    if (f < c.start || f >= c.start + c.duration) continue;
    if (seq.tracks.video[c.track]?.hidden) continue;
    if (!best || c.track > best.track) best = c;
  }
  return best && store.project.sequences[best.seqId]?.multicam ? best : null;
}

// ---- Kaynak sekans oluşturma ----
export async function createMulticamDialog(mediaIds) {
  const p = store.project;
  const medias = mediaIds.map((id) => p.media[id]).filter((m) => m && m.type !== 'image' && (m.hasVideo || m.hasAudio));
  const cams = medias.filter((m) => m.hasVideo);
  if (cams.length < 2) { toast(t('Select at least two video clips in the Project panel'), 'warn'); return null; }
  const first = cams[0];
  const nameIn = el('input', { type: 'text', style: { width: '260px' } });
  const defName = first.name.replace(/\.[^.]+$/, '') + ' ' + t('Multicam');
  nameIn.value = defName;
  const sync = selectEl([
    { value: 'audio', label: t('Audio') },
    { value: 'in', label: t('In Points') },
    { value: 'start', label: t('Clip Start') },
  ], cams.every((m) => m.hasAudio) ? 'audio' : 'start');
  const audioOpts = [{ value: 'follow', label: t('Switch audio with video') }];
  medias.forEach((m, i) => { if (m.hasAudio) audioOpts.push({ value: 'm' + i, label: (m.hasVideo ? t('Camera') + ' ' + (cams.indexOf(m) + 1) + ': ' : '') + m.name }); });
  const audioOnly = medias.findIndex((m) => !m.hasVideo && m.hasAudio);
  const firstAudio = medias.findIndex((m) => m.hasAudio);
  const audioSel = selectEl(audioOpts, audioOnly >= 0 ? 'm' + audioOnly : firstAudio >= 0 ? 'm' + firstAudio : 'follow');
  const editSeq = el('input', { type: 'checkbox' }); editSeq.checked = true;
  const row = (label, input) => el('div', { style: { display: 'grid', gridTemplateColumns: '130px 1fr', alignItems: 'center', gap: '8px', margin: '6px 0' } }, el('span', { text: label }), input);
  const body = el('div', {},
    row(t('Name'), nameIn),
    row(t('Synchronize Point'), sync),
    row(t('Audio'), audioSel),
    el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' } }, editSeq, el('span', { text: t('Create an edit sequence with the multicam clip') })),
    el('div', { text: t('{n} camera(s)', { n: cams.length }) + (medias.length > cams.length ? ' + ' + t('{n} audio file(s)', { n: medias.length - cams.length }) : ''), style: { color: 'var(--text-dim)', fontSize: '11px', marginTop: '8px' } }));
  const r = await modal({ title: t('Create Multi-Camera Source Sequence'), body, width: 480, buttons: [
    { label: t('Cancel'), value: null },
    { label: t('OK'), primary: true, onClick: () => ({ name: nameIn.value.trim() || defName, sync: sync.value, audio: audioSel.value, edit: editSeq.checked }) },
  ] });
  if (!r) return null;
  return createMulticam(medias, r);
}

export async function createMulticam(medias, { name, sync = 'start', audio = 'follow', edit = true } = {}) {
  const p = store.project;
  const cams = medias.filter((m) => m.hasVideo);
  const fps = cams[0].fps ? Math.round(cams[0].fps * 1000) / 1000 : 30;
  // her dosyanın kaynak sekanstaki başlangıcı (sn): kaynak zamanı t, sekansta start + (t - lo)
  const offs = new Array(medias.length).fill(0);
  if (sync === 'in') {
    medias.forEach((m, i) => { offs[i] = -((m.inPoint ?? mediaRange(m).lo) - mediaRange(m).lo); });
  } else if (sync === 'audio') {
    const ref = medias.find((m) => m.hasAudio);
    const job = registerJob(t('Synchronizing'));
    try {
      for (let i = 0; i < medias.length; i++) {
        const m = medias[i];
        if (m === ref || !m.hasAudio) continue;
        const off = await audioOffset(ref, m);
        job.progress((i + 1) / medias.length);
        if (off == null) toast(t('Could not find a match for') + ': ' + m.name, 'warn');
        else offs[i] = off;
      }
    } finally { job.done(); }
  }
  const minOff = Math.min(...offs);
  const nAudio = medias.filter((m) => m.hasAudio).length;
  const src = createSequence({
    name, binId: cams[0].binId || 'root', fps,
    width: cams[0].width ? Math.round(cams[0].width / 2) * 2 : 1920,
    height: cams[0].height ? Math.round(cams[0].height / 2) * 2 : 1080,
    videoTracks: cams.length, audioTracks: Math.max(1, nAudio),
  });
  const cameras = [];
  const settings = { ...app.settings, scaleToFrame: true };
  let aIdx = 0, audioTrack = 0;
  store.commit('Create Multi-Camera Source Sequence', (pr) => {
    pr.sequences[src.id] = src;
    const s = pr.sequences[src.id];
    medias.forEach((m, i) => {
      const { lo, hi } = mediaRange(m);
      const vTrack = m.hasVideo ? cameras.length : null;
      const aTrack = m.hasAudio ? aIdx++ : null;
      E.placeMedia(pr, s, m, { start: Math.round((offs[i] - minOff) * fps), vTrack, aTrack, mode: 'overwrite', inSec: lo, outSec: hi, settings });
      if (m.hasVideo) cameras.push({ name: m.name.replace(/\.[^.]+$/, ''), vTrack, aTrack: aTrack ?? -1 });
      if (audio === 'm' + i) audioTrack = aTrack;
    });
    s.tracks.video.forEach((tr, i) => { if (cameras[i]) tr.name = cameras[i].name; });
    s.multicam = { cameras, audioMode: audio === 'follow' ? 'follow' : 'fixed', audioTrack };
  });
  if (!edit) { toast(t('Multi-camera source sequence created')); return src.id; }
  const ed = createSequence({ name: name + ' ' + t('Edit'), binId: src.binId, fps, width: src.width, height: src.height, videoTracks: 3, audioTracks: 3 });
  store.commit('New Multicam Edit Sequence', (pr) => {
    pr.sequences[ed.id] = ed;
    const s = pr.sequences[ed.id];
    const ids = E.placeSequence(pr, s, pr.sequences[src.id], { start: 0, vTrack: 0, aTrack: 0, mode: 'overwrite' });
    for (const id of ids) setAngle(pr.sequences[src.id], s.clips[id], 0);
  });
  app.commands.openSequence(ed.id);
  store.ui.multicamView = true;
  app.program?.updateButtons();
  app.engine?.requestRender();
  toast(t('Multi-camera source sequence created'));
  return src.id;
}

function setAngle(nested, c, angle) {
  c.multicam = { angle };
  if (c.type === 'video') c.name = `[MC${angle + 1}] ${nested.multicam.cameras[angle]?.name || nested.name}`;
}

// Seçili sekans klibinde multicam aç/kapat (kaynak sekansta multicam yoksa her video izi bir kamera olur)
export function toggleMulticam() {
  const seq = store.seq;
  const sel = store.selectedClips().filter((c) => c.kind === 'sequence');
  if (!sel.length) { toast(t('Select a nested sequence clip'), 'warn'); return; }
  const on = !sel.every((c) => c.multicam);
  store.commit(on ? 'Enable Multi-Camera' : 'Disable Multi-Camera', (pr) => {
    const s = pr.sequences[seq.id];
    for (const c0 of sel) {
      const c = s.clips[c0.id];
      const nested = pr.sequences[c.seqId];
      if (!c || !nested) continue;
      if (!on) { delete c.multicam; if (c.type === 'video') c.name = nested.name; continue; }
      if (!nested.multicam) {
        nested.multicam = {
          cameras: nested.tracks.video.map((tr, i) => ({ name: /^V\d+$/.test(tr.name || '') ? t('Camera') + ' ' + (i + 1) : tr.name, vTrack: i, aTrack: i < nested.tracks.audio.length ? i : -1 })),
          audioMode: 'fixed', audioTrack: 0,
        };
      }
      setAngle(nested, c, 0);
    }
  });
}

// Açı değiştir: oynarken oynatma kafasında keser, durdurulmuşken klibin açısını değiştirir
export function switchAngle(angle) {
  const seq = store.seq;
  const engine = app.engine;
  if (!seq || !engine) return;
  const f = Math.floor(engine.currentFrame);
  const playing = engine.playing;
  let targets = [];
  if (!playing) targets = store.selectedClips().filter((c) => c.type === 'video' && isMulticamClip(c));
  if (!targets.length) { const c = activeMulticamClip(seq, f); if (c) targets = [c]; }
  if (!targets.length) return;
  const nested = store.project.sequences[targets[0].seqId];
  if (!nested?.multicam || angle >= nested.multicam.cameras.length) return;
  if (targets.every((c) => c.multicam.angle === angle)) return;
  const follow = nested.multicam.audioMode === 'follow';
  store.commit(playing ? 'Multi-Camera Cut' : 'Switch Angle', (pr) => {
    const s = pr.sequences[seq.id];
    for (const c0 of targets) {
      const c = s.clips[c0.id];
      if (!c) continue;
      let group = (c.linkId ? Object.values(s.clips).filter((x) => x.linkId === c.linkId) : [c]).filter((x) => isMulticamClip(x));
      if (playing && f > c.start + 1 && f < c.start + c.duration - 1) group = E.razorAt(s, f, group);
      for (const g of group) if (g.type === 'video' || follow) setAngle(pr.sequences[g.seqId], g, angle);
    }
  });
}

// ---- Açı ızgarası (Program monitörü) ----
// Sol yarı: açılar; sağ yarı: program çıktısı. Hücreler sekans koordinatlarında.
export function multicamGrid(seq, nested) {
  const n = nested.multicam.cameras.length;
  const W = seq.width / 2, H = seq.height;
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const s = Math.min(W / cols / nested.width, H / rows / nested.height);
    if (!best || s > best.s + 1e-9) best = { cols, rows, s };
  }
  const { cols, rows, s } = best;
  const cw = nested.width * s, ch = nested.height * s;
  const ox = (W - cols * cw) / 2, oy = (H - rows * ch) / 2;
  const cells = [];
  for (let i = 0; i < n; i++) {
    const cx = i % cols, cy = Math.floor(i / cols);
    cells.push({ x: ox + cx * cw, y: oy + cy * ch, w: cw, h: ch, scale: s * 0.97 });
  }
  const ps = Math.min(W / seq.width, H / seq.height);
  const program = { x: W + (W - seq.width * ps) / 2, y: (H - seq.height * ps) / 2, w: seq.width * ps, h: seq.height * ps, scale: ps };
  return { cells, program };
}

const P = (v) => ({ v, kf: null });
function placed(c, id, x, y, scale, w, h) {
  return {
    ...c, id, effects: [], masks: [], transIn: null, transOut: null,
    props: { ...c.props, position: P([x, y]), scale: P(scale * 100), scaleWidth: P(100), uniformScale: true, rotation: P(0), anchor: P([w / 2, h / 2]), opacity: P(100), blendMode: 'normal', timeRemap: P(100) },
  };
}

// Izgara katmanları (görünürde multicam klibi yoksa null)
export function multicamGridLayers(project, seq, f) {
  const c = activeMulticamClip(seq, f);
  if (!c) return null;
  const nested = project.sequences[c.seqId];
  const { cells, program } = multicamGrid(seq, nested);
  const layers = [];
  cells.forEach((cell, k) => {
    const sc = placed({ ...c, multicam: { angle: k } }, c.id + '_mc' + k, cell.x + cell.w / 2, cell.y + cell.h / 2, cell.scale, nested.width, nested.height);
    sc.props.timeRemap = c.props.timeRemap || P(100);
    layers.push({ type: 'clip', track: k, item: makeItem(project, seq, sc, f) });
  });
  // program çıktısı: sekansın kendisi, iç içe çizilir
  const pc = placed({ id: 'mc_program', kind: 'sequence', seqId: seq.id, type: 'video', track: 0, start: 0, duration: sequenceDuration(seq) + 1, inPoint: 0, speed: 1, reverse: false, enabled: true, props: defaultVideoProps(seq, seq) },
    'mc_program', program.x + program.w / 2, program.y + program.h / 2, program.scale, seq.width, seq.height);
  const pit = makeItem(project, seq, pc, f);
  pit.nestedFrame = f;
  layers.push({ type: 'clip', track: cells.length, item: pit });
  return { layers, cells, program, clip: c, nested };
}
