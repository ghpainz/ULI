// Tüm komutlar, menüler ve klavye kısayolları
import { store } from './store.js';
import { app } from './appContext.js';
import { t, getLang, setLang } from './i18n.js';
import { el, uid, ipc, framesToTC, parseTC, clamp, nodePath, LABEL_COLORS, fpsToFraction } from './util.js';
import * as E from './editing.js';
import { createSequence, createEffect, SEQUENCE_PRESETS, sequenceDuration, clipsOnTrack, binChildren, mediaInUse, mediaInOut, sourceTimeAt } from './model.js';
import { EFFECTS, TRANSITIONS, effectDef } from './effectsDef.js';
import { evalParam } from './keyframes.js';
import { settings, saveSettings } from './settings.js';
import { modal, confirmDialog, promptDialog, alertDialog, toast, selectEl, numInput } from './ui/dialogs.js';
import { showPanel, resetLayout, refreshTabTitles } from './ui/layout.js';
import { importFiles, ALL_EXT, createProxy, deleteProxy, rt, mediaEvents } from './media.js';
import * as IO from './projectIO.js';
import { removeMask } from './masks.js';
import { sceneEditDetection } from './sceneDetect.js';
import { createMulticamDialog, toggleMulticam, switchAngle, isMulticamClip } from './multicam.js';
import { ensureCaptions, addCaption, parseSubtitles, toSRT, toVTT } from './captions.js';

const commands = new Map();
const shortcutMap = new Map();

function def(id, label, run, opts = {}) {
  commands.set(id, { id, label, run, shortcut: opts.shortcut || null, alt: opts.alt || [], enabled: opts.enabled || null, global: opts.global });
  for (const s of [opts.shortcut, ...(opts.alt || [])].filter(Boolean)) shortcutMap.set(normalizeShortcut(s), id);
}

function normalizeShortcut(s) {
  const parts = s.split('+').map((x) => x.trim());
  const key = parts.pop();
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return (mods.has('ctrl') ? 'Ctrl+' : '') + (mods.has('alt') ? 'Alt+' : '') + (mods.has('shift') ? 'Shift+' : '') + (key.length === 1 ? key.toUpperCase() : key);
}

const CODE_MAP = {
  Comma: ',', Period: '.', Semicolon: ';', Quote: "'", Equal: '=', Minus: '-', Backslash: '\\', Slash: '/', BracketLeft: '[', BracketRight: ']',
  NumpadAdd: '=', NumpadSubtract: '-', Space: 'Space', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  Delete: 'Del', Backspace: 'Backspace', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backquote: '`',
};

export function eventToShortcut(e) {
  let key = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad\d$/.test(e.code)) key = 'Num' + e.code.slice(6);
  else if (/^F\d+$/.test(e.code)) key = e.code;
  else if (CODE_MAP[e.code]) key = CODE_MAP[e.code];
  // klavye düzenine göre noktalama (ör. Türkçe Q)
  if (!/^Key|^Digit|^Numpad|^Arrow|^F\d/.test(e.code) && e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey) {
    const map = { '<': ',', '>': '.', ':': ';', '"': "'", '+': '=', '_': '-', '|': '\\', '?': '/' };
    key = map[e.key] || e.key;
    if (key === ' ') key = 'Space';
  }
  if (!key) return null;
  return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + key;
}

export function run(id, ...args) {
  const c = commands.get(id);
  if (!c) { console.warn('unknown command', id); return; }
  if (c.enabled && !c.enabled()) return;
  try {
    return c.run(...args);
  } catch (e) {
    console.error(e);
    toast(e.message, 'error');
  }
}

export function label(id) { const c = commands.get(id); return c ? t(c.label) : id; }
export function shortcutOf(id) { const c = commands.get(id); return c ? c.shortcut : null; }
export function isEnabled(id) { const c = commands.get(id); return c ? (!c.enabled || c.enabled()) : false; }
export function allCommands() { return [...commands.values()]; }

// ---- Yardımcılar ----
const seq = () => store.seq;
const hasSeq = () => !!store.seq;
const hasSel = () => store.ui.selection.size > 0;
const engine = () => app.engine;
const cur = () => engine().currentFrame;
const focusIsSource = () => store.ui.focusedPanel === 'source';

function commitSeq(label, fn) {
  return store.commit(label, (p) => fn(p.sequences[p.activeSequenceId], p));
}

export function openSequence(id) {
  const p = store.project;
  if (!p.sequences[id]) return;
  if (app.engine.playing) app.engine.pause();
  if (store.seq) store.seq.playhead = app.engine.currentFrame;
  if (!p.openSequenceIds.includes(id)) p.openSequenceIds.push(id);
  p.activeSequenceId = id;
  store.ui.selection.clear();
  store.ui.selectedGap = null;
  store.emit('change', { type: 'sequence' });
  app.engine.disposeAll();
  app.engine.setFrame(p.sequences[id].playhead || 0);
  showPanel('timeline');
}

export function closeSequence(id) {
  const p = store.project;
  p.openSequenceIds = p.openSequenceIds.filter((x) => x !== id);
  if (p.activeSequenceId === id) {
    p.activeSequenceId = p.openSequenceIds[p.openSequenceIds.length - 1] || null;
    app.engine.disposeAll();
    if (store.seq) app.engine.setFrame(store.seq.playhead || 0);
  }
  store.ui.selection.clear();
  store.emit('change', { type: 'sequence' });
  app.engine.requestRender();
}

function nextSeqName() {
  const n = Object.keys(store.project.sequences).length + 1;
  return 'Sequence ' + String(n).padStart(2, '0');
}

// Sekans ayarları diyaloğu
async function sequenceDialog(initial = {}, isNew = true) {
  const name = el('input', { type: 'text', style: { width: '260px' } });
  name.value = initial.name || nextSeqName();
  const presetSel = selectEl([{ value: 'custom', label: t('Custom') }, ...SEQUENCE_PRESETS.map((p) => ({ value: p.key, label: t(p.name) }))], initial.preset || (isNew ? settings.defaultPreset : 'custom'));
  const w = numInput(initial.width || 1920, { min: 16, max: 8192, width: 80 });
  const h = numInput(initial.height || 1080, { min: 16, max: 8192, width: 80 });
  const fpsSel = selectEl([23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120].map((f) => ({ value: f, label: f + ' fps' })), initial.fps || 30);
  const vt = numInput(initial.videoTracks ?? 3, { min: 1, max: 99, width: 60 });
  const at = numInput(initial.audioTracks ?? 3, { min: 1, max: 99, width: 60 });
  const applyPreset = () => {
    const p = SEQUENCE_PRESETS.find((x) => x.key === presetSel.value);
    if (p) { w.value = p.width; h.value = p.height; fpsSel.value = String(p.fps); }
  };
  presetSel.addEventListener('change', applyPreset);
  if (isNew && !initial.width) applyPreset();
  const mark = () => { presetSel.value = 'custom'; };
  w.addEventListener('input', mark); h.addEventListener('input', mark); fpsSel.addEventListener('change', mark);
  const grid = el('div', { class: 'form-grid' },
    el('label', { text: t('Sequence Name') }), name,
    el('label', { text: t('Preset') }), presetSel,
    el('label', { text: t('Frame Size') }), el('div', { class: 'inline' }, w, el('span', { text: '×' }), h),
    el('label', { text: t('Timebase') }), fpsSel,
    isNew ? el('label', { text: t('Video Tracks') }) : null, isNew ? vt : null,
    isNew ? el('label', { text: t('Audio Tracks') }) : null, isNew ? at : null,
  );
  const r = await modal({
    title: isNew ? t('New Sequence') : t('Sequence Settings'),
    body: grid,
    buttons: [
      { label: t('Cancel'), value: null },
      { label: t('OK'), primary: true, onClick: () => ({ name: name.value || nextSeqName(), width: Math.round(+w.value / 2) * 2, height: Math.round(+h.value / 2) * 2, fps: +fpsSel.value, videoTracks: +vt.value, audioTracks: +at.value, preset: presetSel.value }) },
    ],
  });
  if (r && r.preset !== 'custom' && isNew) { settings.defaultPreset = r.preset; saveSettings(); }
  return r;
}

export async function newSequence(opts = null) {
  const r = opts || (await sequenceDialog({}, true));
  if (!r) return null;
  const s = createSequence({ ...r, binId: store.ui.currentBin });
  store.commit('New Sequence', (p) => {
    p.sequences[s.id] = s;
  });
  openSequence(s.id);
  return s;
}

export function newSequenceFromMedia(m, then) {
  const s = createSequence({
    name: nodePath.basename(m.name, nodePath.extname(m.name)),
    width: m.width ? Math.round(m.width / 2) * 2 : 1920,
    height: m.height ? Math.round(m.height / 2) * 2 : 1080,
    fps: m.fps ? Math.round(m.fps * 1000) / 1000 : 30,
    binId: m.binId || 'root',
  });
  store.commit('New Sequence From Clip', (p) => { p.sequences[s.id] = s; });
  openSequence(s.id);
  if (then) then(s);
  return s;
}

// Efekt uygula
export function applyEffect(clipIds, type) {
  const def = effectDef(type);
  if (!def) return;
  const cat = def.category === 'audio' ? 'audio' : 'video';
  const targets = clipIds.map((id) => store.seq.clips[id]).filter((c) => c && c.type === cat && !(cat === 'audio' && c.kind === 'sequence'));
  if (!targets.length) {
    toast(t(cat === 'audio' ? 'Audio effects can only be applied to audio clips' : 'Video effects can only be applied to video clips'), 'error');
    return;
  }
  commitSeq('Apply Effect', (s) => {
    for (const id of targets.map((c) => c.id)) {
      const c = s.clips[id];
      if (!c) continue;
      c.effects.push(createEffect(type));
    }
  });
  store.select(clipIds.filter((id) => store.seq.clips[id]));
  showPanel('effectControls');
}

// Geçiş uygula
export function applyTransition(clipId, edge, type, duration = null) {
  const s0 = store.seq;
  const c0 = s0.clips[clipId];
  if (!c0) return;
  const tr = TRANSITIONS[type];
  if (!tr || (tr.category === 'audio') !== (c0.type === 'audio')) {
    toast(t(c0.type === 'audio' ? 'Audio transitions can only be applied to audio clips' : 'Video transitions can only be applied to video clips'), 'error');
    return;
  }
  const dflt = c0.type === 'audio' ? settings.audioTransitionFrames : settings.videoTransitionFrames;
  commitSeq('Apply Transition', (s) => {
    const c = s.clips[clipId];
    const list = clipsOnTrack(s, c.type, c.track);
    let d = duration || dflt;
    if (edge === 'start') {
      const prev = list.find((x) => x.start + x.duration === c.start);
      if (prev) {
        d = Math.min(d, 2 * Math.min(prev.duration, c.duration));
        c.transIn = { type, duration: Math.max(2, d) };
        prev.transOut = null;
      } else c.transIn = { type, duration: Math.max(1, Math.min(d, c.duration)) };
    } else {
      const next = list.find((x) => x.start === c.start + c.duration);
      if (next) {
        d = Math.min(d, 2 * Math.min(next.duration, c.duration));
        next.transIn = { type, duration: Math.max(2, d) };
        c.transOut = null;
      } else c.transOut = { type, duration: Math.max(1, Math.min(d, c.duration)) };
    }
  });
  // Aynı klibin jiletle kesilmiş iki parçası arasında (through edit) bazı geçişler görünmez:
  // her iki taraf da aynı kareleri gösterdiği için aynı görüntü kendisiyle karışır.
  const s = store.seq;
  const c = s.clips[clipId];
  const list = clipsOnTrack(s, c.type, c.track);
  const other = edge === 'start' ? list.find((x) => x.start + x.duration === c.start) : list.find((x) => x.start === c.start + c.duration);
  if (other && c.type === 'video' && INVISIBLE_ON_THROUGH_EDIT.has(type)) {
    const [A, B] = edge === 'start' ? [other, c] : [c, other];
    if (isThroughEdit(A, B, s.fps)) {
      toast(t('This cut joins two parts of the same clip, so this transition has no visible effect. Try Dip to Black/White, Push, Slide or Cross Zoom, or use it between different clips.'), 'info', 8000);
    }
  }
}

const INVISIBLE_ON_THROUGH_EDIT = new Set(['crossDissolve', 'additiveDissolve', 'filmDissolve', 'wipeRight', 'wipeLeft', 'wipeDown', 'wipeUp', 'barnDoors', 'irisRound', 'irisBox']);

// A'nın sonu ile B'nin başı aynı kaynağın kesintisiz devamı mı?
export function isThroughEdit(A, B, fps) {
  if (!A || !B || A.kind !== 'media' || B.kind !== 'media' || A.mediaId !== B.mediaId) return false;
  if (A.reverse || B.reverse || Math.abs(A.speed - B.speed) > 1e-6) return false;
  if (!(A.effects || []).every((e, i) => JSON.stringify(e.params) === JSON.stringify(B.effects?.[i]?.params))) return false;
  const aEnd = A.inPoint + (A.duration / fps) * A.speed;
  return Math.abs(aEnd - B.inPoint) < 0.5 / fps;
}

// Oynatma kafasına en yakın kesme noktasına varsayılan geçiş
function applyDefaultTransition(kind) {
  const s = seq();
  const f = cur();
  const type = kind === 'audio' ? settings.defaultAudioTransition : settings.defaultVideoTransition;
  const sel = store.selectedClips().filter((c) => c.type === kind);
  if (sel.length) {
    // seçili kliplerin her iki kenarına
    store.begin('Apply Default Transition');
    for (const c of sel) { applyTransition(c.id, 'start', type); applyTransition(c.id, 'end', type); }
    store.end();
    return;
  }
  const tracks = s.tracks[kind].map((tr, i) => ({ tr, i })).filter((x) => x.tr.targeted && !x.tr.locked);
  if (!tracks.length) { toast(t('No targeted track')); return; }
  let best = null;
  for (const { i } of tracks) {
    for (const c of clipsOnTrack(s, kind, i)) {
      for (const [edge, fr] of [['start', c.start], ['end', c.start + c.duration]]) {
        const d = Math.abs(fr - f);
        if (!best || d < best.d) best = { c, edge, d };
      }
    }
  }
  if (best) applyTransition(best.c.id, best.edge, type);
}

function currentEditPoints() {
  const s = seq();
  const pts = new Set([0]);
  for (const id in s.clips) {
    const c = s.clips[id];
    const tr = s.tracks[c.type][c.track];
    if (!tr) continue;
    pts.add(c.start);
    pts.add(c.start + c.duration);
  }
  return [...pts].sort((a, b) => a - b);
}

// Hız/Süre diyaloğu
async function speedDialog() {
  const clips = store.selectedClips().filter((c) => c.kind === 'sequence' || (c.kind === 'media' && c.mediaId && store.project.media[c.mediaId]?.type !== 'image'));
  if (!clips.length) return;
  const s = seq();
  const c0 = clips[0];
  const sp = numInput(Math.round(c0.speed * 10000) / 100, { min: 1, max: 10000, step: 1, width: 90 });
  const durIn = el('input', { type: 'text', style: { width: '120px', fontFamily: 'var(--mono)' } });
  durIn.value = framesToTC(c0.duration, s.fps);
  const rev = el('input', { type: 'checkbox' }); rev.checked = c0.reverse;
  const ripple = el('input', { type: 'checkbox' });
  const srcFrames = (c0.duration * c0.speed);
  sp.addEventListener('input', () => { durIn.value = framesToTC(Math.round(srcFrames / (+sp.value / 100)), s.fps); });
  durIn.addEventListener('change', () => { const f = parseTC(durIn.value, s.fps); if (f) sp.value = Math.round((srcFrames / f) * 10000) / 100; });
  const grid = el('div', { class: 'form-grid' },
    el('label', { text: t('Speed') + ' (%)' }), sp,
    el('label', { text: t('Duration') }), durIn,
    el('label', { text: t('Reverse Speed') }), rev,
    el('label', { text: t('Ripple Edit, Shifting Trailing Clips') }), ripple,
  );
  const r = await modal({ title: t('Clip Speed / Duration'), body: grid, buttons: [{ label: t('Cancel'), value: null }, { label: t('OK'), primary: true, onClick: () => ({ speed: +sp.value, reverse: rev.checked, ripple: ripple.checked }) }] });
  if (!r) return;
  commitSeq('Speed/Duration', (s2, p) => E.setSpeed(s2, p, clips.map((c) => c.id), r.speed, { reverse: r.reverse, ripple: r.ripple }));
}

async function editMarker(id) {
  const s = seq();
  const m = s.markers.find((x) => x.id === id);
  if (!m) return;
  const name = el('input', { type: 'text', style: { width: '280px' } }); name.value = m.name || '';
  const comment = el('textarea', { style: { width: '280px', height: '70px' } }); comment.value = m.comment || '';
  const durIn = el('input', { type: 'text', style: { width: '120px', fontFamily: 'var(--mono)' } }); durIn.value = framesToTC(m.duration || 0, s.fps);
  const colors = ['#4caf6a', '#e0533d', '#b06ab3', '#e3a42c', '#ffffff', '#2d8ceb', '#2aa8a0', '#d9708f'];
  let color = m.color || colors[0];
  const sw = el('div', { class: 'inline' }, ...colors.map((c) => {
    const d = el('div', { style: { width: '18px', height: '18px', background: c, borderRadius: '3px', cursor: 'pointer', outline: c === color ? '2px solid #fff' : 'none' } });
    d.addEventListener('click', () => { color = c; sw.querySelectorAll('div').forEach((x) => (x.style.outline = 'none')); d.style.outline = '2px solid #fff'; });
    return d;
  }));
  const grid = el('div', { class: 'form-grid' },
    el('label', { text: t('Name') }), name,
    el('label', { text: t('Duration') }), durIn,
    el('label', { text: t('Comments') }), comment,
    el('label', { text: t('Marker Color') }), sw,
  );
  const r = await modal({
    title: t('Marker') + ' @ ' + framesToTC(m.frame, s.fps), body: grid,
    buttons: [
      { label: t('Delete'), value: 'delete' },
      { label: t('Cancel'), value: null },
      { label: t('OK'), primary: true, value: 'ok' },
    ],
  });
  if (r === 'delete') commitSeq('Delete Marker', (s2) => { s2.markers = s2.markers.filter((x) => x.id !== id); });
  else if (r === 'ok') commitSeq('Edit Marker', (s2) => {
    const mm = s2.markers.find((x) => x.id === id);
    mm.name = name.value; mm.comment = comment.value; mm.color = color; mm.duration = Math.max(0, parseTC(durIn.value, s.fps) || 0);
  });
}

async function addTracksDialog() {
  const v = numInput(1, { min: 0, max: 20, width: 60 });
  const a = numInput(0, { min: 0, max: 20, width: 60 });
  const r = await modal({ title: t('Add Tracks'), body: el('div', { class: 'form-grid' }, el('label', { text: t('Video Tracks') }), v, el('label', { text: t('Audio Tracks') }), a), buttons: [{ label: t('Cancel'), value: null }, { label: t('OK'), primary: true, onClick: () => ({ v: +v.value, a: +a.value }) }] });
  if (!r) return;
  commitSeq('Add Tracks', (s) => {
    E.ensureTracks(s, 'video', s.tracks.video.length + r.v);
    E.ensureTracks(s, 'audio', s.tracks.audio.length + r.a);
  });
}

async function transitionDurationDialog() {
  const st = store.ui.selectedTransition;
  if (!st) return;
  const s = seq();
  const c = s.clips[st.clipId];
  const tr = st.which === 'in' ? c.transIn : c.transOut;
  if (!tr) return;
  const durIn = el('input', { type: 'text', style: { width: '120px', fontFamily: 'var(--mono)' } });
  durIn.value = framesToTC(tr.duration, s.fps);
  const typeSel = selectEl(Object.entries(TRANSITIONS).filter(([, d]) => (d.category === 'audio') === (c.type === 'audio')).map(([k, d]) => ({ value: k, label: t(d.name) })), tr.type);
  const r = await modal({ title: t('Transition'), body: el('div', { class: 'form-grid' }, el('label', { text: t('Type') }), typeSel, el('label', { text: t('Duration') }), durIn), buttons: [{ label: t('Cancel'), value: null }, { label: t('OK'), primary: true, onClick: () => ({ d: parseTC(durIn.value, s.fps), type: typeSel.value }) }] });
  if (!r || !r.d) return;
  commitSeq('Transition Duration', (s2) => {
    const cc = s2.clips[st.clipId];
    const t2 = st.which === 'in' ? cc.transIn : cc.transOut;
    t2.duration = Math.max(1, r.d);
    t2.type = r.type;
  });
}

async function pasteAttributesDialog() {
  const cb = app.clipboard;
  if (!cb || !cb.clips.length) { toast(t('Copy a clip first')); return; }
  const src = cb.clips[0];
  const mk = (k, lbl) => { const i = el('input', { type: 'checkbox' }); i.checked = true; return [k, i, lbl]; };
  const opts = [mk('motion', t('Motion')), mk('opacity', t('Opacity')), mk('effects', t('Effects')), mk('volume', t('Volume'))];
  const r = await modal({ title: t('Paste Attributes'), body: el('div', { class: 'form-grid' }, ...opts.flatMap(([, i, l]) => [el('label', { text: l }), i])), buttons: [{ label: t('Cancel'), value: null }, { label: t('OK'), primary: true, onClick: () => Object.fromEntries(opts.map(([k, i]) => [k, i.checked])) }] });
  if (!r) return;
  const ids = [...store.ui.selection];
  commitSeq('Paste Attributes', (s) => {
    for (const c of cb.clips) E.pasteAttributes(s, c, ids.filter((id) => s.clips[id]?.type === c.type), r);
  });
}

async function preferencesDialog() {
  const lang = selectEl([{ value: 'tr', label: 'Türkçe' }, { value: 'en', label: 'English' }], getLang());
  const auto = numInput(settings.autosaveMinutes, { min: 1, max: 60, width: 60 });
  const keep = numInput(settings.autosaveKeep, { min: 1, max: 200, width: 60 });
  const still = numInput(settings.stillDuration, { min: 0.1, max: 600, step: 0.1, width: 70 });
  const vtr = numInput(settings.videoTransitionFrames, { min: 1, max: 600, width: 70 });
  const atr = numInput(settings.audioTransitionFrames, { min: 1, max: 600, width: 70 });
  const scale = el('input', { type: 'checkbox' }); scale.checked = settings.scaleToFrame;
  const heavy = el('input', { type: 'checkbox' }); heavy.checked = settings.autoProxyHeavy;
  const ph = selectEl([{ value: 540, label: '540p' }, { value: 720, label: '720p' }, { value: 1080, label: '1080p' }], settings.proxyHeight);
  const thumbs = el('input', { type: 'checkbox' }); thumbs.checked = settings.timelineThumbs;
  const dvt = selectEl(Object.entries(TRANSITIONS).filter(([, d]) => d.category === 'video').map(([k, d]) => ({ value: k, label: t(d.name) })), settings.defaultVideoTransition);
  const dat = selectEl(Object.entries(TRANSITIONS).filter(([, d]) => d.category === 'audio').map(([k, d]) => ({ value: k, label: t(d.name) })), settings.defaultAudioTransition);
  const grid = el('div', { class: 'form-grid' },
    el('div', { class: 'form-section', text: t('General') }),
    el('label', { text: t('Language') }), lang,
    el('label', { text: t('Still image default duration (s)') }), still,
    el('label', { text: t('Scale media to frame size') }), scale,
    el('label', { text: t('Show thumbnails in timeline') }), thumbs,
    el('div', { class: 'form-section', text: t('Transitions') }),
    el('label', { text: t('Default video transition') }), dvt,
    el('label', { text: t('Video transition duration (frames)') }), vtr,
    el('label', { text: t('Default audio transition') }), dat,
    el('label', { text: t('Audio transition duration (frames)') }), atr,
    el('div', { class: 'form-section', text: t('Auto Save') }),
    el('label', { text: t('Interval (minutes)') }), auto,
    el('label', { text: t('Maximum versions') }), keep,
    el('div', { class: 'form-section', text: t('Media') }),
    el('label', { text: t('Proxy resolution') }), ph,
    el('label', { text: t('Auto-create proxies for heavy media (4K+, ProRes)') }), heavy,
  );
  const r = await modal({ title: t('Preferences'), body: grid, width: 560, buttons: [{ label: t('Cancel'), value: null }, { label: t('OK'), primary: true, value: true }] });
  if (!r) return;
  Object.assign(settings, {
    autosaveMinutes: +auto.value, autosaveKeep: +keep.value, stillDuration: +still.value,
    videoTransitionFrames: +vtr.value, audioTransitionFrames: +atr.value, scaleToFrame: scale.checked,
    autoProxyHeavy: heavy.checked, proxyHeight: +ph.value, timelineThumbs: thumbs.checked,
    defaultVideoTransition: dvt.value, defaultAudioTransition: dat.value,
  });
  saveSettings();
  IO.scheduleAutosave();
  if (lang.value !== getLang()) {
    setLang(lang.value);
    app.relocalize();
  }
  app.timeline?.refresh();
}

function shortcutsDialog() {
  const rows = allCommands().filter((c) => c.shortcut).map((c) => el('tr', {}, el('td', { text: t(c.label) }), el('td', {}, el('span', { class: 'kbd', text: [c.shortcut, ...c.alt].join('  /  ') }))));
  const tbl = el('table', { class: 'shortcut-table' }, ...rows);
  modal({ title: t('Keyboard Shortcuts'), body: el('div', { style: { maxHeight: '70vh', overflow: 'auto' } }, tbl), buttons: [{ label: t('OK'), primary: true }], width: 560 });
}

function aboutDialog() {
  const p = app.paths;
  alertDialog(`ULI Premiere ${p.appVersion}\n\n${t('A Premiere Pro style video editor.')}\nElectron + WebGL2 + FFmpeg\n\nFFmpeg: ${p.ffmpeg}\n${t('Hardware encoding')} (NVENC): ${app.ffInfo?.nvenc ? t('Available') : t('Not available')}`, t('About'));
}

async function importDialog() {
  const r = await ipc.invoke('dialog:open', {
    title: t('Import'),
    defaultPath: settings.lastImportDir || app.paths.videos,
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: t('All Supported Media'), extensions: ALL_EXT.map((e) => e.slice(1)) }, { name: t('All Files'), extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths.length) return;
  settings.lastImportDir = nodePath.dirname(r.filePaths[0]);
  saveSettings();
  const media = await importFiles(r.filePaths);
  if (media.length) toast(t('{n} item(s) imported', { n: media.length }));
}

async function importFolderDialog() {
  const r = await ipc.invoke('dialog:open', { title: t('Import Folder'), defaultPath: settings.lastImportDir || app.paths.videos, properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths.length) return;
  await importFiles(r.filePaths);
}

function deleteSelection(ripple) {
  const s = seq();
  if (!s) return;
  if (store.ui.selectedCaption && (s.captions || []).some((c) => c.id === store.ui.selectedCaption)) {
    const id = store.ui.selectedCaption;
    commitSeq('Delete Caption', (s2) => { s2.captions = s2.captions.filter((c) => c.id !== id); });
    store.ui.selectedCaption = null;
    return;
  }
  const sm = store.ui.selectedMask;
  if (sm && !ripple && ['effectControls', 'program'].includes(store.ui.focusedPanel)) {
    removeMask(sm.clipId, sm.owner, sm.maskId);
    return;
  }
  if (store.ui.selectedTransition) {
    const st = store.ui.selectedTransition;
    commitSeq('Clear Transition', (s2) => {
      const c = s2.clips[st.clipId];
      if (!c) return;
      if (st.which === 'in') c.transIn = null; else c.transOut = null;
    });
    store.ui.selectedTransition = null;
    return;
  }
  if (store.ui.selectedKeyframes.length && app.effectControls?.deleteSelectedKeyframes()) return;
  if (store.ui.selectedKeyframes.length) {
    const sk = store.ui.selectedKeyframes;
    commitSeq('Delete Keyframe', (s2) => {
      for (const k of sk) {
        const c = s2.clips[k.clipId];
        if (!c || !k.band) continue;
        const p = c.type === 'audio' ? c.props.volume : c.props.opacity;
        if (p.kf) { p.kf = p.kf.filter((x) => x.f !== k.f); if (!p.kf.length) { p.v = evalParam({ v: p.v, kf: null }, 0); p.kf = null; } }
      }
    });
    store.ui.selectedKeyframes = [];
    return;
  }
  if (store.ui.selectedGap && ripple !== false) {
    const g = store.ui.selectedGap;
    commitSeq('Ripple Delete', (s2) => E.rippleDeleteGap(s2, g));
    store.clearSelection();
    return;
  }
  const ids = [...store.ui.selection].filter((id) => s.clips[id]);
  if (!ids.length) return;
  commitSeq(ripple ? 'Ripple Delete' : 'Clear', (s2) => {
    if (ripple) E.rippleDelete(s2, ids);
    else E.deleteClips(s2, ids);
  });
  store.clearSelection();
  engine().refreshHandles();
}

// Kaynak monitöründen ekle / üzerine yaz
function sourceToTimeline(mode) {
  const mid = store.ui.sourceMediaId;
  const m = mid ? store.project.media[mid] : null;
  if (!m) { toast(t('Open a clip in the Source Monitor first')); return; }
  const go = (s) => {
    const vT = s.tracks.video.findIndex((tr) => tr.targeted);
    const aT = s.tracks.audio.findIndex((tr) => tr.targeted);
    const range = app.source.getRange();
    let at = s.inFrame != null && s.outFrame == null ? s.inFrame : cur();
    if (s.inFrame != null) at = s.inFrame;
    let placed = [];
    commitSeq(mode === 'insert' ? 'Insert' : 'Overwrite', (s2, p) => {
      placed = E.placeMedia(p, s2, m, {
        start: at, vTrack: app.source.useVideo && vT >= 0 ? vT : null, aTrack: app.source.useAudio && aT >= 0 ? aT : null,
        mode, inSec: range.inSec, outSec: range.outSec, settings,
      });
      s2.inFrame = null; s2.outFrame = null;
    });
    const c = store.seq.clips[placed[0]];
    if (c) engine().setFrame(c.start + c.duration);
  };
  if (!seq()) newSequenceFromMedia(m, go);
  else go(seq());
}

function moveSelectionBy(df, dt) {
  const s = seq();
  const ids = [...store.ui.selection].filter((id) => s.clips[id]);
  if (!ids.length) return;
  commitSeq('Nudge', (s2) => {
    const dTrack = { video: dt, audio: dt * -1 };
    const ok = E.moveClips(s2, ids, df, dTrack, 'overwrite');
    if (ok === false) return false;
  });
}

function rippleTrimToPlayhead(side) {
  // Q: önceki düzenleme noktasından oynatma kafasına kadar; W: oynatma kafasından sonrakine kadar
  const s = seq();
  const f = cur();
  const tracks = [];
  s.tracks.video.forEach((tr, i) => { if (tr.targeted && !tr.locked) tracks.push(['video', i]); });
  s.tracks.audio.forEach((tr, i) => { if (tr.targeted && !tr.locked) tracks.push(['audio', i]); });
  const clips = [];
  for (const [type, i] of (tracks.length ? tracks : [])) {
    const c = clipsOnTrack(s, type, i).find((x) => x.start < f && x.start + x.duration > f);
    if (c) clips.push(c);
  }
  if (!clips.length) return;
  const ids = E.expandLinked(s, clips.map((c) => c.id));
  commitSeq(side === 'prev' ? 'Ripple Trim Previous Edit to Playhead' : 'Ripple Trim Next Edit to Playhead', (s2, p) => {
    for (const id of ids) {
      const c = s2.clips[id];
      if (!c || !(c.start < f && c.start + c.duration > f)) continue;
    }
    const c0 = s2.clips[ids[0]];
    if (side === 'prev') {
      const d = f - c0.start;
      E.rippleTrim(s2, p, ids, 'start', d);
    } else {
      const d = f - (c0.start + c0.duration);
      E.rippleTrim(s2, p, ids, 'end', d);
    }
  });
  if (side === 'prev') engine().setFrame(clips[0].start);
}

function addEdit(all) {
  const s = seq();
  const f = cur();
  commitSeq(all ? 'Add Edit to All Tracks' : 'Add Edit', (s2) => {
    if (all) E.razorAt(s2, f);
    else {
      const sel = [...store.ui.selection].map((id) => s2.clips[id]).filter((c) => c && c.start < f && c.start + c.duration > f);
      if (sel.length) E.razorAt(s2, f, sel);
      else E.razorAt(s2, f, null, { targetedOnly: true });
    }
  });
}

function markClip() {
  const s = seq();
  const f = cur();
  const sel = store.selectedClips();
  let c = sel[0];
  if (!c) {
    for (let i = s.tracks.video.length - 1; i >= 0 && !c; i--) c = clipsOnTrack(s, 'video', i).find((x) => x.start <= f && x.start + x.duration > f);
    if (!c) for (let i = 0; i < s.tracks.audio.length && !c; i++) c = clipsOnTrack(s, 'audio', i).find((x) => x.start <= f && x.start + x.duration > f);
  }
  if (!c) return;
  commitSeq('Mark Clip', (s2) => { s2.inFrame = c.start; s2.outFrame = c.start + c.duration; });
}

// Alt klip: kaynak monitörü in/out, proje panelinde seçili medya ya da zaman çizelgesinde seçili klibin kaynak aralığından
export async function makeSubclip() {
  const p = store.project;
  let src = null, a = 0, b = 0;
  if (focusIsSource() && app.source?.media) {
    src = app.source.media;
    ({ inSec: a, outSec: b } = app.source.getRange());
  } else if (store.ui.focusedPanel === 'project') {
    src = p.media[app.project?.selectedMediaIds()[0]];
    if (src) ({ inSec: a, outSec: b } = mediaInOut(src));
  } else {
    const c = store.selectedClips().find((x) => x.kind === 'media' && p.media[x.mediaId]);
    if (c) {
      src = p.media[c.mediaId];
      const fps = seq().fps;
      const t0 = sourceTimeAt(c, c.start, fps), t1 = sourceTimeAt(c, c.start + c.duration - 1, fps);
      a = Math.min(t0, t1); b = Math.max(t0, t1) + (Math.abs(c.speed) || 1) / fps;
    }
  }
  if (!src || src.type === 'image') { toast(t('Select a video or audio clip, or set In/Out in the Source Monitor'), 'warn'); return; }
  const root = (src.parentId && p.media[src.parentId]) || src;
  a = Math.max(0, a); b = Math.min(root.duration || b, b);
  if (b - a < 1 / (root.fps || 30)) return;
  const base = src.name.replace(/\.[^.]+$/, '').replace(/\.Subclip(\.\d+)?$/, '');
  const n = Object.values(p.media).filter((m) => m.parentId === root.id).length + 1;
  const name = await promptDialog(t('Subclip name'), `${base}.Subclip${n > 1 ? '.' + n : ''}`, { title: t('Make Subclip') });
  if (!name) return;
  const id = uid('med');
  store.commit('Make Subclip', (pr) => {
    const r = pr.media[root.id];
    const m = structuredClone(r);
    Object.assign(m, {
      id, parentId: root.id, name, subStart: a, subEnd: b, inPoint: null, outPoint: null, binId: src.binId ?? r.binId ?? null,
      markers: (r.markers || []).filter((mk) => mk.t >= a && mk.t < b).map((mk) => ({ ...mk, id: uid('mk') })),
    });
    pr.media[id] = m;
  });
  mediaEvents.emit('update', id);
  toast(t('Subclip created') + ': ' + name);
  return id;
}

function frameHold() {
  const s = seq();
  const f = cur();
  const c = store.selectedClips().find((x) => x.type === 'video' && x.kind === 'media' && x.start <= f && x.start + x.duration > f);
  if (!c) { toast(t('Select a video clip under the playhead')); return; }
  commitSeq('Add Frame Hold', (s2) => {
    const cc = s2.clips[c.id];
    const r = E.splitClip(s2, cc, f, null);
    const target = r || cc;
    const src = target.inPoint + (target.reverse ? 0 : 0);
    target.speed = 0.0001;
    target.inPoint = src;
    target.reverse = false;
  });
}

// ---- Komut tanımları ----
export function initCommands() {
  app.commands = {
    run, openSequence, closeSequence, applyEffect, applyTransition, newSequenceFromMedia, editMarker,
    showPanel, label, shortcutOf, isEnabled, newSequence,
  };

  // Dosya
  def('file.new', 'New Project', () => IO.newProject(), { shortcut: 'Ctrl+Alt+N' });
  def('file.open', 'Open Project...', () => IO.openProject(), { shortcut: 'Ctrl+O' });
  def('file.save', 'Save', () => IO.saveProject(false), { shortcut: 'Ctrl+S' });
  def('file.saveAs', 'Save As...', () => IO.saveProject(true), { shortcut: 'Ctrl+Shift+S' });
  def('file.saveCopy', 'Save a Copy...', () => IO.saveCopy(), { shortcut: 'Ctrl+Alt+S' });
  def('file.import', 'Import...', () => importDialog(), { shortcut: 'Ctrl+I' });
  def('file.importFolder', 'Import Folder...', () => importFolderDialog());
  def('file.newSequence', 'New Sequence...', () => newSequence(), { shortcut: 'Ctrl+N' });
  def('file.newBin', 'New Bin', () => app.project?.newBin(), { shortcut: 'Ctrl+/' });
  def('file.newTitle', 'New Title (Text)', () => app.program?.addText(), { shortcut: 'Ctrl+T', enabled: hasSeq });
  def('file.newColorMatte', 'New Color Matte...', () => app.program?.addColorMatte(), { enabled: hasSeq });
  def('file.newAdjustment', 'New Adjustment Layer', () => app.program?.addAdjustment(), { enabled: hasSeq });
  def('file.export', 'Export Media...', () => app.openExport(), { shortcut: 'Ctrl+M', enabled: hasSeq });
  def('file.exportFrame', 'Export Frame...', () => app.exportFrame(), { shortcut: 'Ctrl+Shift+E', enabled: hasSeq });
  def('file.autosaves', 'Open Auto-Save...', () => app.showAutosaves());
  def('file.revealAutosave', 'Show Auto-Save Folder', () => ipc.invoke('shell:open', IO.getAutosaveDir()));
  def('file.exit', 'Exit', () => app.requestClose(), { shortcut: 'Ctrl+Q' });

  // Düzen
  def('edit.undo', 'Undo', () => { const l = store.undo(); if (l) toast(t('Undo') + ': ' + t(l)); engine().refreshHandles(); }, { shortcut: 'Ctrl+Z' });
  def('edit.redo', 'Redo', () => { const l = store.redo(); if (l) toast(t('Redo') + ': ' + t(l)); engine().refreshHandles(); }, { shortcut: 'Ctrl+Shift+Z', alt: ['Ctrl+Y'] });
  def('edit.cut', 'Cut', () => { run('edit.copy'); deleteSelection(false); }, { shortcut: 'Ctrl+X', enabled: hasSel });
  def('edit.copy', 'Copy', () => {
    const s = seq();
    if (!s) return;
    const ids = [...store.ui.selection];
    const cb = E.copyClips(s, ids);
    if (cb) { app.clipboard = cb; toast(t('{n} clip(s) copied', { n: cb.clips.length })); }
  }, { shortcut: 'Ctrl+C' });
  def('edit.paste', 'Paste', () => {
    if (!app.clipboard || !seq()) return;
    let ids = [];
    commitSeq('Paste', (s) => { ids = E.pasteClips(s, app.clipboard, cur(), 'overwrite'); });
    store.select(ids);
    const end = Math.max(...ids.map((id) => store.seq.clips[id].start + store.seq.clips[id].duration));
    engine().setFrame(end);
  }, { shortcut: 'Ctrl+V' });
  def('edit.pasteInsert', 'Paste Insert', () => {
    if (!app.clipboard || !seq()) return;
    let ids = [];
    commitSeq('Paste Insert', (s) => { ids = E.pasteClips(s, app.clipboard, cur(), 'insert'); });
    store.select(ids);
  }, { shortcut: 'Ctrl+Shift+V' });
  def('edit.pasteAttributes', 'Paste Attributes...', () => pasteAttributesDialog(), { shortcut: 'Ctrl+Alt+V', enabled: hasSel });
  def('edit.delete', 'Clear', () => {
    if (store.ui.focusedPanel === 'project') { app.project?.deleteSelected(); return; }
    deleteSelection(false);
  }, { shortcut: 'Del', alt: ['Backspace'] });
  def('edit.rippleDelete', 'Ripple Delete', () => deleteSelection(true), { shortcut: 'Shift+Del', alt: ['Shift+Backspace'] });
  def('edit.duplicate', 'Duplicate', () => {
    const s = seq();
    if (!s) return;
    const ids = [...store.ui.selection];
    if (!ids.length) return;
    const end = Math.max(...ids.map((id) => s.clips[id].start + s.clips[id].duration));
    const st = Math.min(...ids.map((id) => s.clips[id].start));
    let n = [];
    commitSeq('Duplicate', (s2) => { n = E.duplicateClips(s2, ids, end - st); });
    store.select(n);
  }, { shortcut: 'Ctrl+Shift+/', enabled: hasSel });
  def('edit.selectAll', 'Select All', () => {
    if (store.ui.focusedPanel === 'project') { app.project?.selectAll(); return; }
    const s = seq();
    if (s) store.select(Object.keys(s.clips).filter((id) => !s.tracks[s.clips[id].type][s.clips[id].track]?.locked));
  }, { shortcut: 'Ctrl+A' });
  def('edit.deselectAll', 'Deselect All', () => store.clearSelection(), { shortcut: 'Ctrl+Shift+A' });
  def('edit.preferences', 'Preferences...', () => preferencesDialog(), { shortcut: 'Ctrl+,' });
  def('edit.shortcuts', 'Keyboard Shortcuts...', () => shortcutsDialog(), { shortcut: 'Ctrl+Alt+K' });

  // Klip
  def('clip.speed', 'Speed/Duration...', () => speedDialog(), { shortcut: 'Ctrl+R', enabled: hasSel });
  def('clip.enable', 'Enable', () => commitSeq('Enable', (s) => { const v = !store.selectedClips().every((c) => c.enabled); for (const id of store.ui.selection) if (s.clips[id]) s.clips[id].enabled = v; }), { shortcut: 'Shift+E', enabled: hasSel });
  def('clip.link', 'Link / Unlink', () => {
    const sel = store.selectedClips();
    const allLinked = sel.length > 0 && sel.every((c) => c.linkId);
    commitSeq(allLinked ? 'Unlink' : 'Link', (s) => E.setLinked(s, sel.map((c) => c.id), !allLinked || sel.length > 1 && new Set(sel.map((c) => c.linkId)).size > 1));
  }, { shortcut: 'Ctrl+L', enabled: hasSel });
  def('clip.scaleToFrame', 'Scale to Frame Size', () => commitSeq('Scale to Frame Size', (s, p) => {
    for (const c of store.selectedClips()) {
      const m = p.media[c.mediaId];
      if (!m || c.type !== 'video') continue;
      const cc = s.clips[c.id];
      cc.props.scale = { v: E.fitScale(s, m.width, m.height), kf: null };
    }
  }), { enabled: hasSel });
  def('clip.setToFrame', 'Set to Frame Size', () => commitSeq('Set to Frame Size', (s, p) => {
    for (const c of store.selectedClips()) {
      const m = p.media[c.mediaId];
      if (!m || c.type !== 'video') continue;
      const cc = s.clips[c.id];
      const k = E.fitScale(s, m.width, m.height);
      cc.props.scale = { v: Math.round(k * 10) / 10, kf: null };
      cc.props.position = { v: [s.width / 2, s.height / 2], kf: null };
    }
  }), { enabled: hasSel });
  def('clip.frameHold', 'Add Frame Hold', () => frameHold(), { enabled: hasSel });
  def('clip.makeSubclip', 'Make Subclip...', () => makeSubclip(), { shortcut: 'Ctrl+U' });
  def('clip.sceneDetect', 'Scene Edit Detection...', () => sceneEditDetection(), { enabled: hasSel });
  // Çok kamera
  def('multicam.create', 'Create Multi-Camera Source Sequence...', () => createMulticamDialog(app.project?.selectedMediaIds() || []));
  def('multicam.enable', 'Enable Multi-Camera', () => toggleMulticam(), { enabled: () => store.selectedClips().some((c) => c.kind === 'sequence') });
  def('multicam.view', 'Multi-Camera View', () => { store.ui.multicamView = !store.ui.multicamView; app.program?.updateButtons(); engine()?.requestRender(); }, { shortcut: 'Shift+0' });
  for (let i = 1; i <= 9; i++) def('multicam.angle' + i, 'Switch to Camera ' + i, () => switchAngle(i - 1), { shortcut: String(i), enabled: () => !!store.ui.multicamView });
  def('clip.rename', 'Rename...', async () => {
    const c = store.selectedClips()[0];
    if (!c) return;
    const v = await promptDialog(t('Clip name'), c.name);
    if (v) commitSeq('Rename Clip', (s) => { s.clips[c.id].name = v; });
  }, { enabled: hasSel });
  def('clip.nest', 'Nest...', async () => {
    const s = seq();
    const ids = [...store.ui.selection].filter((id) => s.clips[id]);
    if (!ids.length) return;
    const n = Object.keys(store.project.sequences).length + 1;
    const name = await promptDialog(t('Nested Sequence Name'), t('Nested Sequence') + ' ' + String(n).padStart(2, '0'));
    if (!name) return;
    let placed = [];
    store.commit('Nest', (p) => {
      const r = E.nestClips(p, p.sequences[p.activeSequenceId], ids, name);
      if (!r) return false;
      r.nested.binId = store.ui.currentBin || 'root';
      placed = r.placed;
    });
    store.select(placed);
    engine().refreshHandles();
  }, { enabled: hasSel });
  def('clip.removeEffects', 'Remove Effects', () => commitSeq('Remove Effects', (s) => { for (const id of store.ui.selection) if (s.clips[id]) s.clips[id].effects = []; }), { enabled: hasSel });
  def('clip.revealInProject', 'Reveal in Project', () => { const c = store.selectedClips()[0]; if (c && c.mediaId) app.project?.reveal(c.mediaId); }, { enabled: hasSel });
  def('clip.revealInExplorer', 'Reveal in Explorer', () => { const c = store.selectedClips()[0]; const m = c && store.project.media[c.mediaId]; if (m) ipc.invoke('shell:reveal', m.path); }, { enabled: hasSel });
  def('clip.replaceFromSource', 'Replace With Clip From Source Monitor', () => {
    const c = store.selectedClips()[0];
    const mid = store.ui.sourceMediaId;
    if (!c || !mid) return;
    const range = app.source.getRange();
    commitSeq('Replace Clip', (s) => {
      for (const cl of E.expandLinked(s, [c.id]).map((id) => s.clips[id])) {
        cl.mediaId = mid;
        cl.inPoint = range.inSec;
        cl.name = store.project.media[mid].name;
      }
    });
    engine().refreshHandles();
  }, { enabled: hasSel });
  def('clip.insert', 'Insert', () => sourceToTimeline('insert'), { shortcut: ',' });
  def('clip.overwrite', 'Overwrite', () => sourceToTimeline('overwrite'), { shortcut: '.' });
  def('clip.nudgeLeft', 'Nudge Clip Left', () => moveSelectionBy(-1, 0), { shortcut: 'Alt+Left', enabled: hasSel });
  def('clip.nudgeRight', 'Nudge Clip Right', () => moveSelectionBy(1, 0), { shortcut: 'Alt+Right', enabled: hasSel });
  def('clip.nudgeLeft5', 'Nudge Clip Left 5 Frames', () => moveSelectionBy(-5, 0), { shortcut: 'Alt+Shift+Left', enabled: hasSel });
  def('clip.nudgeRight5', 'Nudge Clip Right 5 Frames', () => moveSelectionBy(5, 0), { shortcut: 'Alt+Shift+Right', enabled: hasSel });
  def('clip.nudgeUp', 'Nudge Clip Up', () => moveSelectionBy(0, 1), { shortcut: 'Alt+Up', enabled: hasSel });
  def('clip.nudgeDown', 'Nudge Clip Down', () => moveSelectionBy(0, -1), { shortcut: 'Alt+Down', enabled: hasSel });
  def('clip.createProxy', 'Create Proxies', () => { for (const id of app.project?.selectedMediaIds() || []) createProxy(id); });
  def('clip.toggleProxies', 'Toggle Proxies', () => { store.ui.useProxies = !store.ui.useProxies; settings.useProxies = store.ui.useProxies; saveSettings(); mediaEvents.emit('proxyReady'); engine().requestRender(); toast(store.ui.useProxies ? t('Proxies enabled') : t('Proxies disabled')); });

  // Sekans
  def('sequence.settings', 'Sequence Settings...', async () => {
    const s = seq();
    const r = await sequenceDialog({ ...s, preset: 'custom' }, false);
    if (!r) return;
    commitSeq('Sequence Settings', (s2) => {
      const oldFps = s2.fps;
      s2.name = r.name; s2.width = r.width; s2.height = r.height;
      if (Math.abs(oldFps - r.fps) > 1e-6) {
        // kare tabanlı konumları yeni fps'e dönüştür
        const k = r.fps / oldFps;
        for (const id in s2.clips) {
          const c = s2.clips[id];
          c.start = Math.round(c.start * k);
          c.duration = Math.max(1, Math.round(c.duration * k));
          if (c.transIn) c.transIn.duration = Math.max(1, Math.round(c.transIn.duration * k));
          if (c.transOut) c.transOut.duration = Math.max(1, Math.round(c.transOut.duration * k));
          for (const p of Object.values(c.props)) if (p && p.kf) for (const kf of p.kf) kf.f = Math.round(kf.f * k);
          for (const fx of c.effects) for (const p of Object.values(fx.params)) if (p.kf) for (const kf of p.kf) kf.f = Math.round(kf.f * k);
        }
        for (const m of s2.markers) { m.frame = Math.round(m.frame * k); m.duration = Math.round((m.duration || 0) * k); }
        if (s2.inFrame != null) s2.inFrame = Math.round(s2.inFrame * k);
        if (s2.outFrame != null) s2.outFrame = Math.round(s2.outFrame * k);
        s2.fps = r.fps;
      }
    });
  }, { enabled: hasSeq });
  def('sequence.addEdit', 'Add Edit', () => addEdit(false), { shortcut: 'Ctrl+K', enabled: hasSeq });
  def('sequence.addEditAll', 'Add Edit to All Tracks', () => addEdit(true), { shortcut: 'Ctrl+Shift+K', enabled: hasSeq });
  def('sequence.lift', 'Lift', () => { const s = seq(); if (s.inFrame == null && s.outFrame == null) return; commitSeq('Lift', (s2) => E.liftRange(s2, s2.inFrame ?? 0, s2.outFrame ?? sequenceDuration(s2), false)); }, { shortcut: ';', enabled: hasSeq });
  def('sequence.extract', 'Extract', () => { const s = seq(); if (s.inFrame == null && s.outFrame == null) return; const a = s.inFrame ?? 0; commitSeq('Extract', (s2) => { E.liftRange(s2, s2.inFrame ?? 0, s2.outFrame ?? sequenceDuration(s2), true); s2.inFrame = null; s2.outFrame = null; }); engine().setFrame(a); }, { shortcut: "'", enabled: hasSeq });
  def('sequence.videoTransition', 'Apply Video Transition', () => applyDefaultTransition('video'), { shortcut: 'Ctrl+D', enabled: hasSeq });
  def('sequence.audioTransition', 'Apply Audio Transition', () => applyDefaultTransition('audio'), { shortcut: 'Ctrl+Shift+D', enabled: hasSeq });
  def('sequence.zoomIn', 'Zoom In', () => app.timeline.zoomBy(1.5), { shortcut: '=' });
  def('sequence.zoomOut', 'Zoom Out', () => app.timeline.zoomBy(1 / 1.5), { shortcut: '-' });
  def('sequence.zoomFit', 'Zoom to Sequence', () => app.timeline.zoomToFit(), { shortcut: '\\' });
  def('sequence.snap', 'Snap in Timeline', () => { store.ui.snapping = !store.ui.snapping; app.timeline._updateButtons(); toast(store.ui.snapping ? t('Snapping on') : t('Snapping off')); }, { shortcut: 'S' });
  def('sequence.linkedSelection', 'Linked Selection', () => { store.ui.linkedSelection = !store.ui.linkedSelection; app.timeline._updateButtons(); });
  def('sequence.addTracks', 'Add Tracks...', () => addTracksDialog(), { enabled: hasSeq });
  def('sequence.deleteEmptyTracks', 'Delete Empty Tracks', () => commitSeq('Delete Empty Tracks', (s) => {
    for (const type of ['video', 'audio']) {
      for (let i = s.tracks[type].length - 1; i >= 1; i--) {
        if (clipsOnTrack(s, type, i).length) continue;
        s.tracks[type].splice(i, 1);
        for (const id in s.clips) { const c = s.clips[id]; if (c.type === type && c.track > i) c.track--; }
      }
    }
  }), { enabled: hasSeq });
  def('sequence.rippleTrimPrev', 'Ripple Trim Previous Edit to Playhead', () => rippleTrimToPlayhead('prev'), { shortcut: 'Q', enabled: hasSeq });
  def('sequence.rippleTrimNext', 'Ripple Trim Next Edit to Playhead', () => rippleTrimToPlayhead('next'), { shortcut: 'W', enabled: hasSeq });
  def('sequence.nextEdit', 'Go to Next Edit Point', () => { const f = cur(); const p = currentEditPoints().find((x) => x > f); if (p != null) engine().setFrame(p); }, { shortcut: 'Down', enabled: hasSeq });
  def('sequence.prevEdit', 'Go to Previous Edit Point', () => { const f = cur(); const p = currentEditPoints().filter((x) => x < f).pop(); if (p != null) engine().setFrame(p); }, { shortcut: 'Up', enabled: hasSeq });
  def('sequence.matchFrame', 'Match Frame', () => {
    const s = seq();
    const f = cur();
    let c = null;
    for (let i = s.tracks.video.length - 1; i >= 0 && !c; i--) c = clipsOnTrack(s, 'video', i).find((x) => x.enabled && x.kind === 'media' && x.start <= f && x.start + x.duration > f);
    if (!c) return;
    app.source.openMedia(c.mediaId, { time: c.inPoint + ((f - c.start) / s.fps) * c.speed });
  }, { shortcut: 'F', enabled: hasSeq });
  def('sequence.closeAllGaps', 'Close All Gaps', () => commitSeq('Close All Gaps', (s) => {
    for (let guard = 0; guard < 2000; guard++) {
      const dur = sequenceDuration(s);
      let found = null;
      for (const [type, list] of [['video', s.tracks.video], ['audio', s.tracks.audio]]) {
        list.forEach((tr, i) => {
          if (found || tr.locked) return;
          let prevEnd = 0;
          for (const c of clipsOnTrack(s, type, i)) {
            if (c.start > prevEnd && !found) { found = [prevEnd, c.start]; }
            prevEnd = Math.max(prevEnd, c.start + c.duration);
          }
        });
      }
      if (!found || found[1] > dur) break;
      const before = JSON.stringify(Object.values(s.clips).map((c) => c.start));
      E.closeGap(s, found[0], found[1]);
      if (JSON.stringify(Object.values(s.clips).map((c) => c.start)) === before) break;
    }
  }), { enabled: hasSeq });

  // İşaretler
  def('mark.in', 'Mark In', () => { if (focusIsSource()) return app.source.markIn(); commitSeq('Mark In', (s) => { s.inFrame = cur(); if (s.outFrame != null && s.outFrame <= s.inFrame) s.outFrame = null; }); }, { shortcut: 'I' });
  def('mark.out', 'Mark Out', () => { if (focusIsSource()) return app.source.markOut(); commitSeq('Mark Out', (s) => { s.outFrame = cur() + 1; if (s.inFrame != null && s.inFrame >= s.outFrame) s.inFrame = null; }); }, { shortcut: 'O' });
  def('mark.clip', 'Mark Clip', () => markClip(), { shortcut: 'X', enabled: hasSeq });
  def('mark.selection', 'Mark Selection', () => { const sel = store.selectedClips(); if (!sel.length) return; commitSeq('Mark Selection', (s) => { s.inFrame = Math.min(...sel.map((c) => c.start)); s.outFrame = Math.max(...sel.map((c) => c.start + c.duration)); }); }, { shortcut: '/', enabled: hasSeq });
  def('mark.clear', 'Clear In and Out', () => { if (focusIsSource()) return app.source.clearInOut(); commitSeq('Clear In and Out', (s) => { s.inFrame = null; s.outFrame = null; }); }, { shortcut: 'Ctrl+Shift+X' });
  def('mark.clearIn', 'Clear In', () => commitSeq('Clear In', (s) => { s.inFrame = null; }), { shortcut: 'Ctrl+Shift+I', enabled: hasSeq });
  def('mark.clearOut', 'Clear Out', () => commitSeq('Clear Out', (s) => { s.outFrame = null; }), { shortcut: 'Ctrl+Shift+O', enabled: hasSeq });
  def('mark.goIn', 'Go to In', () => { if (focusIsSource()) return app.source.goIn(); const s = seq(); if (s.inFrame != null) engine().setFrame(s.inFrame); }, { shortcut: 'Shift+I' });
  def('mark.goOut', 'Go to Out', () => { if (focusIsSource()) return app.source.goOut(); const s = seq(); if (s.outFrame != null) engine().setFrame(s.outFrame - 1); }, { shortcut: 'Shift+O' });

  // İşaretçiler
  def('marker.add', 'Add Marker', () => {
    if (focusIsSource()) return app.source.addMarker();
    const f = cur();
    const s = seq();
    if (!s) return;
    const ex = s.markers.find((m) => m.frame === f);
    if (ex) { editMarker(ex.id); return; }
    commitSeq('Add Marker', (s2) => { s2.markers.push({ id: uid('mk'), frame: f, name: '', comment: '', color: '#4caf6a', duration: 0 }); s2.markers.sort((a, b) => a.frame - b.frame); });
  }, { shortcut: 'M' });
  def('marker.next', 'Go to Next Marker', () => { if (focusIsSource()) return app.source.nextMarker(1); const s = seq(); const f = cur(); const m = s.markers.find((x) => x.frame > f); if (m) engine().setFrame(m.frame); }, { shortcut: 'Shift+M', enabled: hasSeq });
  def('marker.prev', 'Go to Previous Marker', () => { if (focusIsSource()) return app.source.nextMarker(-1); const s = seq(); const f = cur(); const m = s.markers.filter((x) => x.frame < f).pop(); if (m) engine().setFrame(m.frame); }, { shortcut: 'Ctrl+Shift+M', enabled: hasSeq });
  def('marker.clearCurrent', 'Clear Selected Marker', () => commitSeq('Clear Marker', (s) => { const f = cur(); s.markers = s.markers.filter((m) => m.frame !== f); }), { shortcut: 'Ctrl+Alt+M', enabled: hasSeq });
  def('marker.clearAll', 'Clear All Markers', () => focusIsSource() ? app.source.clearMarkers() : commitSeq('Clear All Markers', (s) => { s.markers = []; }), { shortcut: 'Ctrl+Alt+Shift+M', enabled: hasSeq });
  def('marker.edit', 'Edit Marker...', () => { const s = seq(); const m = s.markers.find((x) => x.frame === cur()); if (m) editMarker(m.id); }, { enabled: hasSeq });

  // Oynatma
  const target = () => (focusIsSource() ? app.source : engine());
  def('play.toggle', 'Play/Stop', () => target().toggle(), { shortcut: 'Space' });
  def('play.l', 'Shuttle Right', () => target().shuttle(1), { shortcut: 'L' });
  def('play.j', 'Shuttle Left', () => target().shuttle(-1), { shortcut: 'J' });
  def('play.k', 'Shuttle Stop', () => target().shuttle(0), { shortcut: 'K' });
  def('play.stepFwd', 'Step Forward', () => { const tg = target(); if (tg.playing) tg.pause(); tg.setFrame(tg.currentFrame + 1); }, { shortcut: 'Right' });
  def('play.stepBack', 'Step Back', () => { const tg = target(); if (tg.playing) tg.pause(); tg.setFrame(tg.currentFrame - 1); }, { shortcut: 'Left' });
  def('play.step5Fwd', 'Step Forward Five Frames', () => { const tg = target(); if (tg.playing) tg.pause(); tg.setFrame(tg.currentFrame + 5); }, { shortcut: 'Shift+Right' });
  def('play.step5Back', 'Step Back Five Frames', () => { const tg = target(); if (tg.playing) tg.pause(); tg.setFrame(tg.currentFrame - 5); }, { shortcut: 'Shift+Left' });
  def('play.home', 'Go to Start', () => { const tg = target(); if (tg.playing) tg.pause(); tg.setFrame(0); }, { shortcut: 'Home' });
  def('play.end', 'Go to End', () => { const tg = target(); if (tg.playing) tg.pause(); if (tg === engine()) tg.setFrame(Math.max(0, sequenceDuration(seq()) )); else tg.goEnd(); }, { shortcut: 'End' });
  def('play.inToOut', 'Play In to Out', () => { const s = seq(); if (!s) return; engine().play(1, { range: [s.inFrame ?? 0, s.outFrame ?? sequenceDuration(s)] }); }, { shortcut: 'Ctrl+Shift+Space' });
  def('play.loop', 'Loop Playback', () => { store.ui.loop = !store.ui.loop; app.program?.updateButtons(); toast(store.ui.loop ? t('Loop on') : t('Loop off')); }, { shortcut: 'Ctrl+Alt+L' });

  // Araçlar
  const tool = (id, name, key) => def('tool.' + id, name, () => store.setTool(id), { shortcut: key });
  tool('select', 'Selection Tool', 'V');
  tool('trackSelect', 'Track Select Forward Tool', 'A');
  tool('ripple', 'Ripple Edit Tool', 'B');
  tool('roll', 'Rolling Edit Tool', 'N');
  tool('rateStretch', 'Rate Stretch Tool', 'R');
  tool('razor', 'Razor Tool', 'C');
  tool('slip', 'Slip Tool', 'Y');
  tool('slide', 'Slide Tool', 'U');
  tool('pen', 'Pen Tool', 'P');
  tool('hand', 'Hand Tool', 'H');
  tool('zoom', 'Zoom Tool', 'Z');
  tool('type', 'Type Tool', 'T');

  // Pencere
  const win = (id, name, key) => def('window.' + id, name, () => showPanel(id), { shortcut: key });
  win('project', 'Project', 'Shift+1');
  win('source', 'Source Monitor', 'Shift+2');
  win('timeline', 'Timeline', 'Shift+3');
  win('program', 'Program Monitor', 'Shift+4');
  win('effectControls', 'Effect Controls', 'Shift+5');
  win('audioMixer', 'Audio Track Mixer', 'Shift+6');
  win('effects', 'Effects', 'Shift+7');
  win('lumetri', 'Lumetri Color', 'Shift+8');
  win('markers', 'Markers', 'Shift+9');
  win('history', 'History', 'Shift+0');
  def('window.scopes', 'Lumetri Scopes', () => showPanel('scopes'));
  def('window.captions', 'Captions', () => showPanel('captions'));
  def('window.graphics', 'Essential Graphics', () => showPanel('graphics'));
  def('window.essentialSound', 'Essential Sound', () => showPanel('essentialSound'));
  def('audio.record', 'Record Voiceover', async () => { const A = await import('./audioTools.js'); A.toggleRecording(); }, { shortcut: 'Ctrl+Alt+R', enabled: hasSeq });
  def('audio.sync', 'Synchronize by Audio', async () => { const A = await import('./audioTools.js'); A.syncByAudio(E.expandLinked(seq(), [...store.ui.selection]).filter((id) => seq().clips[id]?.type === 'audio')); }, { enabled: hasSel });
  def('caption.add', 'Add Caption', () => {
    let id = null;
    commitSeq('Add Caption', (s) => { id = addCaption(s, cur(), '').id; });
    store.ui.selectedCaption = id;
    store.emit('selection');
    showPanel('captions');
    // yeni altyazının metin kutusuna odaklan
    setTimeout(() => {
      const caps = (store.seq.captions || []).slice().sort((a, b) => a.start - b.start);
      const boxes = document.querySelectorAll('[data-panel="captions"] textarea');
      const box = boxes[caps.findIndex((c) => c.id === id)];
      if (box) box.focus();
    }, 80);
  }, { shortcut: 'Ctrl+Alt+C', enabled: hasSeq });
  def('caption.import', 'Import Captions (SRT/VTT)...', async () => {
    const r = await ipc.invoke('dialog:open', { title: t('Import Captions (SRT/VTT)...'), properties: ['openFile'], filters: [{ name: 'SRT / WebVTT', extensions: ['srt', 'vtt'] }] });
    if (r.canceled || !r.filePaths.length) return;
    const fs = window.require('fs');
    let text = fs.readFileSync(r.filePaths[0], 'utf8');
    const caps = parseSubtitles(text, seq().fps);
    if (!caps.length) { toast(t('No captions found in file'), 'error'); return; }
    commitSeq('Import Captions', (s) => {
      ensureCaptions(s);
      s.captions.push(...caps);
      s.captions.sort((a, b) => a.start - b.start);
    });
    showPanel('captions');
    toast(t('{n} captions imported', { n: caps.length }));
  }, { enabled: hasSeq });
  def('caption.export', 'Export Captions (SRT)...', async () => {
    const s = seq();
    if (!s.captions || !s.captions.length) { toast(t('No captions yet.')); return; }
    const r = await ipc.invoke('dialog:save', { title: t('Export Captions (SRT)...'), defaultPath: nodePath.join(settings.lastExportDir || app.paths.videos, s.name.replace(/[\\/:*?"<>|]/g, '_') + '.srt'), filters: [{ name: 'SubRip (SRT)', extensions: ['srt'] }, { name: 'WebVTT', extensions: ['vtt'] }] });
    if (r.canceled || !r.filePath) return;
    window.require('fs').writeFileSync(r.filePath, r.filePath.toLowerCase().endsWith('.vtt') ? toVTT(s) : toSRT(s), 'utf8');
    toast(t('Captions exported') + ': ' + nodePath.basename(r.filePath));
  }, { enabled: hasSeq });
  def('window.resetLayout', 'Reset Workspace Layout', () => resetLayout());
  def('window.fullscreen', 'Full Screen', () => ipc.invoke('win:fullscreen'), { shortcut: 'F11' });
  def('window.maximizeFrame', 'Maximize Panel', () => app.toggleMaximize(), { shortcut: '`' });
  def('window.devtools', 'Developer Tools', () => ipc.invoke('win:devtools'), { shortcut: 'F12' });
  def('window.reload', 'Reload Interface', async () => { if (await IO.confirmDiscard()) { store.markClean(); ipc.invoke('win:reload'); } }, { shortcut: 'Ctrl+F5' });
  def('window.toggleLang', 'Switch Language (TR/EN)', () => { setLang(getLang() === 'tr' ? 'en' : 'tr'); app.relocalize(); });

  // Yardım
  def('help.shortcuts', 'Keyboard Shortcuts', () => shortcutsDialog(), { shortcut: 'F1' });
  def('help.about', 'About ULI Premiere', () => aboutDialog());

  app.commandsReady = true;
  return { run, editMarker };
}

// Menü yapısı
export function menuStructure() {
  const item = (id, extra = {}) => ({ label: label(id), shortcut: shortcutOf(id), action: () => run(id), enabled: () => isEnabled(id), ...extra });
  const recentItems = () => {
    const list = settings.recent.filter(Boolean);
    if (!list.length) return [{ label: t('(none)'), enabled: false }];
    return list.map((f) => ({ label: f, action: () => IO.openProject(f) }));
  };
  return [
    { label: t('File'), items: () => [
      item('file.new'), item('file.open'), { label: t('Open Recent'), submenu: recentItems }, item('file.autosaves'), '-',
      item('file.save'), item('file.saveAs'), item('file.saveCopy'), '-',
      { label: t('New'), submenu: () => [item('file.newSequence'), item('file.newBin'), '-', item('file.newTitle'), item('file.newColorMatte'), item('file.newAdjustment')] },
      item('file.import'), item('file.importFolder'), '-',
      { label: t('Export'), submenu: () => [item('file.export'), item('file.exportFrame')] }, '-',
      item('file.revealAutosave'), item('file.exit'),
    ] },
    { label: t('Edit'), items: () => [
      { ...item('edit.undo'), label: t('Undo') + (store.undoLabel() ? ' ' + t(store.undoLabel()) : ''), enabled: () => store.canUndo() },
      { ...item('edit.redo'), label: t('Redo') + (store.redoLabel() ? ' ' + t(store.redoLabel()) : ''), enabled: () => store.canRedo() }, '-',
      item('edit.cut'), item('edit.copy'), item('edit.paste'), item('edit.pasteInsert'), item('edit.pasteAttributes'), '-',
      item('edit.delete'), item('edit.rippleDelete'), item('edit.duplicate'), '-',
      item('edit.selectAll'), item('edit.deselectAll'), '-',
      item('edit.shortcuts'), item('edit.preferences'),
    ] },
    { label: t('Clip'), items: () => [
      item('clip.speed'), item('clip.frameHold'), '-',
      item('clip.insert'), item('clip.overwrite'), item('clip.replaceFromSource'), '-',
      { ...item('clip.enable'), checked: () => store.selectedClips().length > 0 && store.selectedClips().every((c) => c.enabled) },
      { ...item('clip.link'), label: t('Link / Unlink') }, item('clip.rename'), item('clip.makeSubclip'), item('clip.nest'), item('clip.removeEffects'), '-',
      item('clip.sceneDetect'), '-',
      { label: t('Multi-Camera'), submenu: () => [
        { ...item('multicam.enable'), checked: () => store.selectedClips().some((c) => isMulticamClip(c)) },
        { ...item('multicam.view'), checked: () => !!store.ui.multicamView },
        '-', ...[1, 2, 3, 4].map((i) => item('multicam.angle' + i)),
      ] },
      item('multicam.create'), '-',
      item('clip.scaleToFrame'), item('clip.setToFrame'), '-',
      { label: t('Proxy'), submenu: () => [item('clip.createProxy'), { ...item('clip.toggleProxies'), checked: () => store.ui.useProxies }] },
    ] },
    { label: t('Sequence'), items: () => [
      item('sequence.settings'), '-',
      item('sequence.addEdit'), item('sequence.addEditAll'), '-',
      item('sequence.videoTransition'), item('sequence.audioTransition'), '-',
      item('sequence.lift'), item('sequence.extract'), item('sequence.rippleTrimPrev'), item('sequence.rippleTrimNext'), item('sequence.closeAllGaps'), '-',
      item('sequence.matchFrame'), item('sequence.zoomIn'), item('sequence.zoomOut'), item('sequence.zoomFit'), '-',
      { ...item('sequence.snap'), checked: () => store.ui.snapping }, { ...item('sequence.linkedSelection'), checked: () => store.ui.linkedSelection }, '-',
      item('sequence.addTracks'), item('sequence.deleteEmptyTracks'), '-',
      item('caption.add'), item('caption.import'), item('caption.export'), '-',
      item('audio.record'), item('audio.sync'),
    ] },
    { label: t('Markers'), items: () => [
      item('mark.in'), item('mark.out'), item('mark.clip'), item('mark.selection'), '-',
      item('mark.goIn'), item('mark.goOut'), '-',
      item('mark.clearIn'), item('mark.clearOut'), item('mark.clear'), '-',
      item('marker.add'), item('marker.next'), item('marker.prev'), item('marker.edit'), item('marker.clearCurrent'), item('marker.clearAll'),
    ] },
    { label: t('Window'), items: () => [
      item('window.project'), item('window.source'), item('window.program'), item('window.timeline'), item('window.effectControls'), item('window.effects'), item('window.lumetri'), item('window.scopes'), item('window.graphics'), item('window.essentialSound'), item('window.captions'), item('window.audioMixer'), item('window.markers'), item('window.history'), '-',
      item('window.maximizeFrame'), item('window.resetLayout'), item('window.fullscreen'), '-',
      item('window.toggleLang'), item('window.reload'), item('window.devtools'),
    ] },
    { label: t('Help'), items: () => [item('help.shortcuts'), item('help.about')] },
  ];
}

// Klavye
export function initKeyboard() {
  window.addEventListener('keydown', (e) => {
    const tg = e.target;
    const tag = tg && tg.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (tg && tg.isContentEditable)) {
      if (e.key === 'Escape') tg.blur();
      return;
    }
    if (app.exporting) return;
    const sc = eventToShortcut(e);
    if (!sc) return;
    // Alt+tuş: menü çubuğu kısayolu olmasın
    const id = shortcutMap.get(sc);
    if (id) {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat && !/^(play\.step|play\.step5|clip\.nudge|sequence\.(next|prev)Edit|sequence\.zoom)/.test(id)) return;
      run(id);
    } else if (e.key === 'Escape') {
      if (store.ui.maskPen) { store.ui.maskPen = null; store.emit('selection'); return; }
      store.clearSelection();
    } else if (e.key === 'Alt') {
      e.preventDefault();
    }
  }, true);
}
