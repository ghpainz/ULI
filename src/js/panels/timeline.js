// Zaman çizelgesi paneli
import { store } from '../store.js';
import { app } from '../appContext.js';
import { t } from '../i18n.js';
import { el, framesToTC, parseTC, clamp, rafThrottle, LABEL_COLORS, dbToGain, uid } from '../util.js';
import { clipsOnTrack, sequenceDuration, sourceTimeAt, createTrack, sequenceContains, remapActive, mediaInOut, audioRemapClip, clipRateAt } from '../model.js';
import * as E from '../editing.js';
import { evalParam, isAnimated, setParamAt, addKeyframe } from '../keyframes.js';
import { rt, getFilmstrip, mediaEvents, importFiles } from '../media.js';
import { PEAK_RATE } from '../ffmpeg.js';
import { clipSpan } from '../renderGraph.js';
import { TRANSITIONS } from '../effectsDef.js';
import { settings } from '../settings.js';
import { contextMenu, promptDialog, toast } from '../ui/dialogs.js';
import { ensureCaptions, captionAt, sortCaptions } from '../captions.js';
import { applyPreset, applyClipAnim } from '../presets.js';
import { rendersFor } from '../renderCache.js';
import { SPEED_CURVES, applySpeedCurve } from '../speedCurves.js';
import { uid as newId } from '../util.js';

const HEADER_W = 156;
const RULER_H = 34;
const SEP_H = 6;
const EDGE_PX = 7;

const ICONS = {
  lock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3.5" y="7" width="9" height="7" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>',
  eye: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
  eyeOff: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><path d="M2 2l12 12"/></svg>',
  snap: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 2v6a4 4 0 008 0V2"/><path d="M4 5h2M10 5h2"/></svg>',
  link: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 9a3 3 0 004 0l2-2a3 3 0 00-4-4l-1 1"/><path d="M9 7a3 3 0 00-4 0L3 9a3 3 0 004 4l1-1"/></svg>',
  marker: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2h8v8l-4 4-4-4z"/></svg>',
  wave: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 8h2M4 5v6M7 3v10M10 6v4M13 4v8M15 8h0"/></svg>',
};

function clipColor(c, project) {
  if (c.label && LABEL_COLORS[c.label]) return LABEL_COLORS[c.label];
  if (c.kind === 'text') return '#b06ab3';
  if (c.kind === 'color') return '#b07a3f';
  if (c.kind === 'adjustment') return '#8f8a4a';
  if (c.kind === 'graphic') return '#a65fb8';
  if (c.kind === 'sequence') return c.type === 'video' ? '#2f9c86' : '#3d8f5c';
  const m = c.mediaId ? project.media[c.mediaId] : null;
  if (m && m.type === 'image') return '#a05f9a';
  return c.type === 'video' ? '#7472c4' : '#3f9a63';
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) * k), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * k), 0, 255);
  const b = clamp(Math.round((n & 255) * k), 0, 255);
  return `rgb(${r},${g},${b})`;
}

// dB <-> rubber band konumu (0..1)
function dbToNorm(db) { return db <= -60 ? 0 : clamp((db + 60) / 75, 0, 1); }
function normToDb(n) { return n <= 0.001 ? -96 : n * 75 - 60; }

export class TimelinePanel {
  constructor() {
    this.id = 'timeline';
    this.ppf = 4; // piksel / kare
    this.scrollX = 0; // piksel
    this.scrollY = 0;
    this.drag = null;
    this.hover = null;
    this.snapLine = null;
    this.dropGhost = null;
    this.marquee = null;
    this._draw = rafThrottle(() => this.draw());
    this.zoomPerSeq = new Map();
  }

  title() { return t('Timeline'); }

  mount(body) {
    this.body = body;
    const root = el('div', { class: 'timeline' });
    this.seqTabs = el('div', { class: 'seq-tabs' });
    const top = el('div', { class: 'tl-top' });
    this.corner = el('div', { class: 'tl-corner', style: { width: HEADER_W + 'px' } });
    this.tcEl = el('div', { class: 'tc', title: t('Playhead position (click to type)') });
    this.btns = el('div', { class: 'tl-btns' });
    this.corner.append(this.tcEl, this.btns);
    this.rulerWrap = el('div', { class: 'tl-ruler' });
    this.rulerCanvas = el('canvas');
    this.rulerWrap.appendChild(this.rulerCanvas);
    top.append(this.corner, this.rulerWrap);
    const main = el('div', { class: 'tl-main' });
    this.headers = el('div', { class: 'tl-headers', style: { width: HEADER_W + 'px' } });
    this.headersInner = el('div', { class: 'tl-headers-inner' });
    this.headers.appendChild(this.headersInner);
    this.wrap = el('div', { class: 'tl-canvas-wrap', tabindex: '0' });
    this.canvas = el('canvas');
    this.wrap.appendChild(this.canvas);
    main.append(this.headers, this.wrap);
    const bottom = el('div', { class: 'tl-bottom' });
    bottom.appendChild(el('div', { style: { width: HEADER_W + 'px', flex: '0 0 auto' } }));
    this.hscroll = el('div', { class: 'tl-hscroll' });
    this.hthumb = el('div', { class: 'thumb' });
    this.hscroll.appendChild(this.hthumb);
    bottom.appendChild(this.hscroll);
    root.append(this.seqTabs, top, main, bottom);
    body.appendChild(root);
    this.emptyMsg = el('div', { class: 'empty-hint', style: { position: 'absolute', left: HEADER_W + 'px', right: '0', top: '40%', pointerEvents: 'none' }, text: t('Drag media here to create a sequence') });
    this.wrap.appendChild(this.emptyMsg);

    this._buildButtons();
    this._bindEvents();
    store.on('change', () => this.refresh());
    store.on('selection', () => this._draw());
    store.on('tool', () => this._updateCursor());
    store.on('project', () => { this.scrollX = 0; this.scrollY = 0; this.refresh(); });
    mediaEvents.on('peaks', () => this._draw());
    mediaEvents.on('filmstrip', () => this._draw());
    mediaEvents.on('update', () => this._draw());
    app.timeline = this;
  }

  _buildButtons() {
    const mk = (key, title, get, toggle) => {
      const s = el('span', { title, html: ICONS[key] });
      s.addEventListener('click', () => { toggle(); this._updateButtons(); this._draw(); });
      s._get = get;
      this.btns.appendChild(s);
      return s;
    };
    this.bSnap = mk('snap', t('Snap in Timeline (S)'), () => store.ui.snapping, () => { store.ui.snapping = !store.ui.snapping; });
    this.bLink = mk('link', t('Linked Selection'), () => store.ui.linkedSelection, () => { store.ui.linkedSelection = !store.ui.linkedSelection; });
    this.bMarker = mk('marker', t('Add Marker (M)'), () => false, () => app.commands.run('marker.add'));
    this.bWave = mk('wave', t('Show Audio Waveforms'), () => store.ui.showWaveforms, () => { store.ui.showWaveforms = !store.ui.showWaveforms; });
    this._updateButtons();
    this.tcEl.addEventListener('click', () => this._editTimecode());
  }

  _updateButtons() {
    for (const b of [this.bSnap, this.bLink, this.bMarker, this.bWave]) b.classList.toggle('on', !!b._get());
  }

  _editTimecode() {
    const seq = store.seq;
    if (!seq) return;
    const inp = el('input', { type: 'text', style: { width: '120px', fontFamily: 'var(--mono)', fontSize: '15px' } });
    inp.value = framesToTC(app.engine.currentFrame, seq.fps);
    this.tcEl.replaceWith(inp);
    inp.focus();
    inp.select();
    const done = (apply) => {
      if (apply) {
        const f = parseTC(inp.value, seq.fps, app.engine.currentFrame);
        if (f != null) app.engine.setFrame(f);
      }
      inp.replaceWith(this.tcEl);
      this.updatePlayhead();
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    inp.addEventListener('blur', () => done(true));
  }

  // ---- Koordinatlar ----
  get fps() { return store.seq ? store.seq.fps : 30; }
  frameToX(f) { return f * this.ppf - this.scrollX; }
  xToFrame(x) { return (x + this.scrollX) / this.ppf; }

  computeRows() {
    const seq = store.seq;
    const rows = [];
    if (!seq) return { rows, total: 0, sepY: 0 };
    let y = 0;
    if (seq.captions) {
      rows.push({ type: 'caption', index: 0, y, h: 30, track: null });
      y += 30;
    }
    const vt = seq.tracks.video;
    for (let i = vt.length - 1; i >= 0; i--) {
      rows.push({ type: 'video', index: i, y, h: vt[i].height || 46, track: vt[i] });
      y += vt[i].height || 46;
    }
    const sepY = y;
    y += SEP_H;
    seq.tracks.audio.forEach((tr, i) => {
      rows.push({ type: 'audio', index: i, y, h: tr.height || 46, track: tr });
      y += tr.height || 46;
    });
    return { rows, total: y, sepY };
  }

  // Video izlerini alttan hizala: video bölümü üstte, ses altta
  get videoOffset() {
    const L = this.layout;
    if (!L) return 0;
    const H = this.wrap.clientHeight;
    // video izleri az ise ayırıcıyı panelin ortasına it
    const want = Math.round(H * 0.5) - L.sepY;
    return Math.max(0, want);
  }

  rowAtY(y) {
    const L = this.layout;
    if (!L) return null;
    const yy = y + this.scrollY - this.videoOffset;
    for (const r of L.rows) if (yy >= r.y && yy < r.y + r.h) return r;
    return null;
  }

  rowY(r) { return r.y - this.scrollY + this.videoOffset; }

  findRow(type, index) {
    return this.layout?.rows.find((r) => r.type === type && r.index === index) || null;
  }

  // ---- Yenileme ----
  refresh() {
    const seq = store.seq;
    this.emptyMsg.style.display = seq ? 'none' : 'block';
    if (seq && this._seqId !== seq.id) {
      if (this._seqId) this.zoomPerSeq.set(this._seqId, { ppf: this.ppf, scrollX: this.scrollX });
      const z = this.zoomPerSeq.get(seq.id);
      this._seqId = seq.id;
      if (z) { this.ppf = z.ppf; this.scrollX = z.scrollX; } else this.zoomToFit();
    }
    this._renderSeqTabs();
    this._renderHeaders();
    this._draw();
  }

  _renderSeqTabs() {
    const p = store.project;
    this.seqTabs.innerHTML = '';
    for (const id of p.openSequenceIds) {
      const s = p.sequences[id];
      if (!s) continue;
      const tab = el('div', { class: 'tab' + (id === p.activeSequenceId ? ' active' : '') }, s.name);
      const x = el('span', { class: 'close', text: '×' });
      x.addEventListener('mousedown', (e) => { e.stopPropagation(); app.commands.closeSequence(id); });
      tab.appendChild(x);
      tab.addEventListener('mousedown', () => app.commands.openSequence(id));
      this.seqTabs.appendChild(tab);
    }
  }

  _renderHeaders() {
    const seq = store.seq;
    this.layout = this.computeRows();
    this.headersInner.innerHTML = '';
    if (!seq) return;
    const off = this.videoOffset;
    this.headersInner.style.top = (off - this.scrollY) + 'px';
    for (const r of this.layout.rows) {
      if (r.type === 'caption') {
        const h = el('div', { class: 'track-header', style: { top: r.y + 'px', height: r.h + 'px', background: '#2c2a22' } });
        const vis = seq.captionsVisible !== false;
        const lab = el('div', { class: 'tgt on', text: 'C1', style: { background: '#8a7420', borderColor: '#8a7420' } });
        const eye = el('div', { class: 'tbtn eye' + (vis ? '' : ' on'), html: vis ? ICONS.eye : ICONS.eyeOff, title: t('Toggle Track Output') });
        eye.addEventListener('click', () => store.commit('Toggle Captions', () => { seq.captionsVisible = !vis; }));
        h.append(lab, eye, el('div', { class: 'tname', text: t('Captions') }));
        h.addEventListener('contextmenu', (e) => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [{ label: t('Add Caption'), action: () => app.commands.run('caption.add') }, { label: t('Import Captions (SRT/VTT)...'), action: () => app.commands.run('caption.import') }, { label: t('Export Captions (SRT)...'), action: () => app.commands.run('caption.export') }]); });
        this.headersInner.appendChild(h);
        continue;
      }
      const tr = r.track;
      const h = el('div', { class: 'track-header ' + r.type, style: { top: r.y + 'px', height: r.h + 'px' } });
      const label = (r.type === 'video' ? 'V' : 'A') + (r.index + 1);
      const tgt = el('div', { class: 'tgt' + (tr.targeted ? ' on' : ''), text: label, title: t('Toggle track targeting') });
      tgt.addEventListener('click', () => store.commit('Track Targeting', () => { tr.targeted = !tr.targeted; }));
      const lock = el('div', { class: 'tbtn lock' + (tr.locked ? ' on' : ''), html: ICONS.lock, title: t('Toggle Track Lock') });
      lock.addEventListener('click', () => store.commit('Lock Track', () => { tr.locked = !tr.locked; }));
      h.append(tgt, lock);
      if (r.type === 'video') {
        const eye = el('div', { class: 'tbtn eye' + (tr.hidden ? ' on' : ''), html: tr.hidden ? ICONS.eyeOff : ICONS.eye, title: t('Toggle Track Output') });
        eye.addEventListener('click', () => store.commit('Toggle Track Output', () => { tr.hidden = !tr.hidden; }));
        h.append(eye);
      } else {
        const m = el('div', { class: 'tbtn mute' + (tr.muted ? ' on' : ''), text: 'M', title: t('Mute Track') });
        m.addEventListener('click', () => store.commit('Mute Track', () => { tr.muted = !tr.muted; }));
        const s = el('div', { class: 'tbtn solo' + (tr.solo ? ' on' : ''), text: 'S', title: t('Solo Track') });
        s.addEventListener('click', () => store.commit('Solo Track', () => { tr.solo = !tr.solo; }));
        h.append(m, s);
      }
      const name = el('div', { class: 'tname', text: tr.name !== label ? tr.name : (r.type === 'video' ? t('Video') + ' ' + (r.index + 1) : t('Audio') + ' ' + (r.index + 1)) });
      name.addEventListener('dblclick', async () => {
        const v = await promptDialog(t('Track name'), tr.name);
        if (v != null) store.commit('Rename Track', () => { tr.name = v || label; });
      });
      h.appendChild(name);
      const rs = el('div', { class: 'tresize' });
      rs.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const y0 = e.clientY, h0 = tr.height || 46;
        const mv = (ev) => { tr.height = clamp(h0 + ev.clientY - y0, 24, 220); this.layout = this.computeRows(); this._renderHeaders(); this._draw(); };
        const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); store.markDirty(); };
        window.addEventListener('mousemove', mv);
        window.addEventListener('mouseup', up);
      });
      h.appendChild(rs);
      h.addEventListener('contextmenu', (e) => { e.preventDefault(); this._trackMenu(e, r); });
      h.addEventListener('dblclick', (e) => {
        if (e.target !== h) return;
        tr.height = (tr.height || 46) > 60 ? 46 : 110;
        this.refresh();
      });
      this.headersInner.appendChild(h);
    }
    this.headersInner.appendChild(el('div', { class: 'track-sep', style: { top: this.layout.sepY + 'px', height: SEP_H + 'px' } }));
  }

  _trackMenu(e, r) {
    const seq = store.seq;
    contextMenu(e.clientX, e.clientY, [
      { label: t('Add Track'), action: () => store.commit('Add Track', () => { const n = createTrack(r.type, seq.tracks[r.type].length); n.targeted = false; seq.tracks[r.type].splice(r.index + 1, 0, n); this._shiftTrackIndices(seq, r.type, r.index + 1, 1); this._renameTracks(seq); }) },
      { label: t('Add Tracks...'), action: () => app.commands.run('sequence.addTracks') },
      { label: t('Delete Track'), enabled: seq.tracks[r.type].length > 1, action: () => store.commit('Delete Track', () => {
        for (const id of Object.keys(seq.clips)) { const c = seq.clips[id]; if (c.type === r.type && c.track === r.index) delete seq.clips[id]; }
        seq.tracks[r.type].splice(r.index, 1);
        this._shiftTrackIndices(seq, r.type, r.index + 1, -1);
        this._renameTracks(seq);
      }) },
      { label: t('Delete Empty Tracks'), action: () => app.commands.run('sequence.deleteEmptyTracks') },
      '-',
      { label: t('Rename'), action: async () => { const v = await promptDialog(t('Track name'), r.track.name); if (v != null) store.commit('Rename Track', () => { r.track.name = v; }); } },
      { label: t('Expand Track'), action: () => { r.track.height = 110; this.refresh(); } },
      { label: t('Minimize Track'), action: () => { r.track.height = 28; this.refresh(); } },
    ]);
  }

  _shiftTrackIndices(seq, type, from, d) {
    for (const id in seq.clips) {
      const c = seq.clips[id];
      if (c.type === type && c.track >= from) c.track += d;
    }
  }

  _renameTracks(seq) {
    for (const type of ['video', 'audio']) seq.tracks[type].forEach((tr, i) => {
      if (/^[VA]\d+$/.test(tr.name)) tr.name = (type === 'video' ? 'V' : 'A') + (i + 1);
    });
  }

  onResize() { this.refresh(); }
  onShow() { this.refresh(); }

  // ---- Zoom / kaydırma ----
  zoomToFit() {
    const seq = store.seq;
    const w = Math.max(100, this.wrap.clientWidth - 40);
    const dur = seq ? Math.max(sequenceDuration(seq), seq.fps * 30) : 900;
    this.ppf = clamp(w / dur, 0.002, 60);
    this.scrollX = 0;
    this._draw();
  }

  zoomBy(k, anchorX = null) {
    // Premiere gibi: fare zaman çizelgesinin üstündeyse farenin olduğu yere, değilse oynatma kafasına göre yakınlaştır
    const ax = anchorX ?? (this.mouseX != null ? this.mouseX : clamp(this.frameToX(app.engine.currentFrame), 0, this.wrap.clientWidth));
    const f = this.xToFrame(ax);
    this.ppf = clamp(this.ppf * k, 0.002, 60);
    this.scrollX = Math.max(0, f * this.ppf - ax);
    this._draw();
  }

  ensurePlayheadVisible(f) {
    const x = this.frameToX(f);
    const w = this.wrap.clientWidth;
    if (x > w - 20) { this.scrollX = Math.max(0, f * this.ppf - 40); this._draw(); }
    else if (x < 0) { this.scrollX = Math.max(0, f * this.ppf - w * 0.2); this._draw(); }
  }

  updatePlayhead() {
    const seq = store.seq;
    this.tcEl.textContent = seq ? framesToTC(app.engine.currentFrame, seq.fps) : '00:00:00:00';
    if (app.engine.playing) this.ensurePlayheadVisible(app.engine.currentFrame);
    this._draw();
  }

  // ---- Çizim ----
  _sizeCanvas(cv, wrap) {
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = w + 'px';
      cv.style.height = h + 'px';
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  draw() {
    this.layout = this.computeRows();
    this.headersInner.style.top = (this.videoOffset - this.scrollY) + 'px';
    this._drawRuler();
    this._drawTracks();
    this._updateHScroll();
    this.tcEl.textContent = store.seq ? framesToTC(app.engine.currentFrame, store.seq.fps) : '00:00:00:00';
  }

  _tickStep() {
    const fps = this.fps;
    const minPx = 70;
    const candidates = [1, 2, 5, 10, Math.round(fps / 2), Math.round(fps), Math.round(fps) * 2, Math.round(fps) * 5, Math.round(fps) * 10, Math.round(fps) * 15, Math.round(fps) * 30, Math.round(fps) * 60, Math.round(fps) * 120, Math.round(fps) * 300, Math.round(fps) * 600, Math.round(fps) * 1800, Math.round(fps) * 3600];
    for (const c of candidates) if (c * this.ppf >= minPx) return c;
    return candidates[candidates.length - 1];
  }

  _drawRuler() {
    const { ctx, w, h } = this._sizeCanvas(this.rulerCanvas, this.rulerWrap);
    ctx.fillStyle = '#202020';
    ctx.fillRect(0, 0, w, h);
    const seq = store.seq;
    if (!seq) return;
    // in/out
    if (seq.inFrame != null || seq.outFrame != null) {
      const a = this.frameToX(seq.inFrame ?? 0), b = this.frameToX(seq.outFrame ?? sequenceDuration(seq));
      ctx.fillStyle = 'rgba(45,140,235,0.35)';
      ctx.fillRect(a, h - 10, b - a, 10);
    }
    // render çubuğu: yeşil = önizleme render'ı hazır, kırmızı = render eskidi
    for (const r of rendersFor(seq)) {
      const a = this.frameToX(r.f0), b = this.frameToX(r.f1);
      ctx.fillStyle = r.valid ? '#3fbf6a' : '#d9434a';
      ctx.fillRect(a, h - 3, Math.max(1, b - a), 3);
    }
    const step = this._tickStep();
    const sub = step >= 5 ? step / 5 : step;
    const f0 = Math.max(0, Math.floor(this.xToFrame(0) / step) * step);
    const f1 = this.xToFrame(w);
    ctx.strokeStyle = '#5a5a5a';
    ctx.fillStyle = '#9a9a9a';
    ctx.font = '10px Consolas, monospace';
    ctx.beginPath();
    for (let f = f0; f <= f1; f += step) {
      const x = Math.round(this.frameToX(f)) + 0.5;
      ctx.moveTo(x, h - 14); ctx.lineTo(x, h);
      ctx.fillText(framesToTC(f, seq.fps), x + 3, h - 18);
      if (sub !== step) for (let s = 1; s < 5; s++) {
        const xs = Math.round(this.frameToX(f + sub * s)) + 0.5;
        ctx.moveTo(xs, h - 5); ctx.lineTo(xs, h);
      }
    }
    ctx.stroke();
    // işaretçiler
    for (const m of seq.markers) {
      const x = this.frameToX(m.frame);
      if (x < -20 || x > w + 20) continue;
      ctx.fillStyle = m.color || '#4caf6a';
      if (m.duration > 0) {
        ctx.globalAlpha = 0.45;
        ctx.fillRect(x, 2, m.duration * this.ppf, 10);
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.moveTo(x - 5, 2); ctx.lineTo(x + 5, 2); ctx.lineTo(x + 5, 9); ctx.lineTo(x, 14); ctx.lineTo(x - 5, 9);
      ctx.closePath();
      ctx.fill();
    }
    // oynatma kafası
    const px = Math.round(this.frameToX(app.engine.currentFrame)) + 0.5;
    ctx.fillStyle = '#2d8ceb';
    ctx.beginPath();
    ctx.moveTo(px - 6, h - 14); ctx.lineTo(px + 6, h - 14); ctx.lineTo(px + 6, h - 6); ctx.lineTo(px, h); ctx.lineTo(px - 6, h - 6);
    ctx.closePath();
    ctx.fill();
  }

  _drawTracks() {
    const { ctx, w, h } = this._sizeCanvas(this.canvas, this.wrap);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);
    const seq = store.seq;
    if (!seq) return;
    const project = store.project;
    const L = this.layout;
    // iz arka planları
    for (const r of L.rows) {
      const y = this.rowY(r);
      if (y > h || y + r.h < 0) continue;
      ctx.fillStyle = r.type === 'video' ? '#1f1f24' : r.type === 'caption' ? '#22211b' : '#1e2222';
      ctx.fillRect(0, y, w, r.h - 1);
      ctx.fillStyle = '#141414';
      ctx.fillRect(0, y + r.h - 1, w, 1);
      if (r.track && r.track.locked) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        for (let x = -r.h; x < w; x += 18) { ctx.moveTo(x, y + r.h); ctx.lineTo(x + r.h, y); }
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.fillStyle = '#0e0e0e';
    ctx.fillRect(0, L.sepY - this.scrollY + this.videoOffset, w, SEP_H);
    // in/out gölgesi
    if (seq.inFrame != null || seq.outFrame != null) {
      const a = this.frameToX(seq.inFrame ?? 0), b = this.frameToX(seq.outFrame ?? sequenceDuration(seq));
      ctx.fillStyle = 'rgba(45,140,235,0.07)';
      ctx.fillRect(a, 0, b - a, h);
    }
    // seçili boşluk
    const gap = store.ui.selectedGap;
    if (gap) {
      const r = this.findRow(gap.type, gap.track);
      if (r) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(this.frameToX(gap.start), this.rowY(r) + 1, (gap.end - gap.start) * this.ppf, r.h - 3);
      }
    }
    // klipler
    const f0 = this.xToFrame(0), f1 = this.xToFrame(w);
    for (const id in seq.clips) {
      const c = seq.clips[id];
      if (c.start + c.duration < f0 - 2 || c.start > f1 + 2) continue;
      const r = this.findRow(c.type, c.track);
      if (!r) continue;
      const y = this.rowY(r);
      if (y > h || y + r.h < 0) continue;
      this._drawClip(ctx, c, r, y, project, seq);
    }
    // altyazılar
    const crow = L.rows.find((r) => r.type === 'caption');
    if (crow && seq.captions) {
      const y = this.rowY(crow);
      for (const cap of seq.captions) {
        if (cap.end < f0 || cap.start > f1) continue;
        const x0 = this.frameToX(cap.start), x1 = this.frameToX(cap.end);
        const sel = store.ui.selectedCaption === cap.id;
        ctx.globalAlpha = seq.captionsVisible === false ? 0.45 : 1;
        ctx.fillStyle = sel ? '#e6c040' : '#a88a26';
        ctx.fillRect(x0, y + 3, Math.max(1, x1 - x0), crow.h - 6);
        ctx.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,0.6)';
        ctx.strokeRect(x0 + 0.5, y + 3.5, Math.max(1, x1 - x0) - 1, crow.h - 7);
        if (x1 - x0 > 14) {
          ctx.save();
          ctx.beginPath(); ctx.rect(x0, y, x1 - x0, crow.h); ctx.clip();
          ctx.fillStyle = '#1a1600';
          ctx.font = '11px "Segoe UI", sans-serif';
          ctx.textBaseline = 'middle';
          ctx.fillText((cap.text || '').replace(/\n/g, ' / '), Math.max(x0, 0) + 4, y + crow.h / 2);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      }
    }
    // bırakma hayaleti
    if (this.dropGhost) {
      for (const g of this.dropGhost) {
        const r = this.findRow(g.type, g.track);
        const y = r ? this.rowY(r) : g.type === 'video' ? this.rowY(L.rows[0]) - 46 : 0;
        const hh = r ? r.h : 46;
        ctx.fillStyle = 'rgba(45,140,235,0.35)';
        ctx.strokeStyle = '#5aa9ff';
        ctx.lineWidth = 1;
        ctx.fillRect(this.frameToX(g.start), y + 1, g.duration * this.ppf, hh - 3);
        ctx.strokeRect(this.frameToX(g.start) + 0.5, y + 1.5, g.duration * this.ppf - 1, hh - 4);
      }
    }
    // marquee
    if (this.marquee) {
      const m = this.marquee;
      ctx.fillStyle = 'rgba(90,169,255,0.12)';
      ctx.strokeStyle = 'rgba(90,169,255,0.8)';
      ctx.fillRect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
      ctx.strokeRect(Math.min(m.x0, m.x1) + 0.5, Math.min(m.y0, m.y1) + 0.5, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
    }
    // işaretçi çizgileri
    for (const m of seq.markers) {
      const x = Math.round(this.frameToX(m.frame)) + 0.5;
      if (x < 0 || x > w) continue;
      ctx.strokeStyle = 'rgba(76,175,106,0.35)';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    // snap çizgisi
    if (this.snapLine != null) {
      const x = Math.round(this.frameToX(this.snapLine)) + 0.5;
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.setLineDash([]);
    }
    // jilet önizleme çizgisi
    if (store.ui.tool === 'razor' && this.hover && this.hover.frame != null) {
      const x = Math.round(this.frameToX(this.hover.frame)) + 0.5;
      ctx.strokeStyle = '#ff5050';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    // oynatma kafası
    const px = Math.round(this.frameToX(app.engine.currentFrame)) + 0.5;
    ctx.strokeStyle = '#2d8ceb';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
  }

  _drawClip(ctx, c, r, y, project, seq) {
    const x0 = this.frameToX(c.start);
    const x1 = this.frameToX(c.start + c.duration);
    const cw = Math.max(1, x1 - x0);
    const top = y + 1, ch = r.h - 3;
    const sel = store.ui.selection.has(c.id);
    const base = clipColor(c, project);
    const media = c.mediaId ? project.media[c.mediaId] : null;
    const offline = media && rt(media.id).offline;
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.max(-2, x0), top, Math.min(cw, this.canvas.width) + 2, ch);
    ctx.clip();
    ctx.globalAlpha = c.enabled ? 1 : 0.4;
    ctx.fillStyle = offline ? '#7a2a2a' : shade(base, sel ? 1.15 : 0.78);
    ctx.fillRect(x0, top, cw, ch);
    // başlık şeridi
    const headH = Math.min(15, ch);
    ctx.fillStyle = offline ? '#a03a3a' : shade(base, sel ? 1.35 : 1.0);
    ctx.fillRect(x0, top, cw, headH);
    // film şeridi
    if (c.type === 'video' && media && media.hasVideo && ch > 34 && settings.timelineThumbs && cw > 20) {
      if (media.type === 'image') {
        const r2 = rt(media.id);
        if (r2.image && r2.imageReady) {
          const th = ch - headH;
          const tw = Math.min(cw, th * (media.width / media.height || 1.77));
          try { ctx.drawImage(r2.image, x0, top + headH, tw, th); } catch (e) { /* */ }
        }
      } else {
        const fs = getFilmstrip(media.id);
        if (fs) {
          const th = ch - headH;
          const tw = th * (fs.frameW / fs.frameH);
          const visL = Math.max(x0, 0), visR = Math.min(x1, this.canvas.width);
          const startSlot = Math.floor((visL - x0) / tw);
          for (let sx = x0 + startSlot * tw; sx < visR; sx += tw) {
            const fr = c.start + (sx - x0) / this.ppf;
            const st = sourceTimeAt(c, Math.floor(fr), seq.fps);
            const idx = clamp(Math.floor((st / (fs.duration || 1)) * fs.count), 0, fs.count - 1);
            ctx.globalAlpha = (c.enabled ? 1 : 0.4) * 0.85;
            ctx.drawImage(fs.img, idx * fs.frameW, 0, fs.frameW, fs.frameH, sx, top + headH, tw, th);
          }
          ctx.globalAlpha = c.enabled ? 1 : 0.4;
        }
      }
    }
    // dalga formu
    if (c.type === 'audio' && media && store.ui.showWaveforms && ch > 18) {
      const pk = rt(media.id).peaks;
      if (pk) {
        const wy = top + headH, wh = ch - headH;
        const mid = wy + wh / 2;
        ctx.fillStyle = shade(base, sel ? 1.6 : 1.45);
        const visL = Math.max(Math.floor(x0), 0), visR = Math.min(Math.ceil(x1), Math.ceil(this.canvas.width));
        const animated = isAnimated(c.props.volume);
        const staticGain = dbToGain(c.props.volume.v ?? 0);
        const rc = audioRemapClip(seq, c);
        for (let x = visL; x < visR; x++) {
          const fa = c.start + (x - x0) / this.ppf;
          const fb = fa + 1 / this.ppf;
          const ta = sourceTimeAt(rc, Math.floor(fa), seq.fps) + ((fa % 1) / seq.fps) * clipRateAt(rc, fa - c.start);
          const tb = sourceTimeAt(rc, Math.floor(fb), seq.fps) + ((fb % 1) / seq.fps) * clipRateAt(rc, fb - c.start);
          let i0 = Math.floor(Math.min(ta, tb) * PEAK_RATE), i1 = Math.ceil(Math.max(ta, tb) * PEAK_RATE);
          if (i1 <= i0) i1 = i0 + 1;
          let p = 0;
          for (let i = i0; i < i1 && i < pk.length; i++) if (pk[i] > p) p = pk[i];
          const g = animated ? dbToGain(evalParam(c.props.volume, fa - c.start)) : staticGain;
          const v = Math.min(1, (p / 255) * Math.sqrt(g)) * (wh / 2 - 1);
          if (v > 0.3) ctx.fillRect(x, mid - v, 1, v * 2);
        }
      }
    }
    // ad
    if (cw > 18) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      let name = c.name;
      if (remapActive(c) || (c.type === 'audio' && remapActive(audioRemapClip(seq, c)))) name += '  [TR]';
      else if (c.speed !== 1 || c.reverse) name += `  [${c.reverse ? '-' : ''}${Math.round(c.speed * 100)}%]`;
      if (offline) name = '⚠ ' + name;
      const tx = Math.max(x0, 0) + 4;
      let fxw = 0;
      if (c.effects && c.effects.length) {
        ctx.fillStyle = '#e8c547';
        ctx.fillRect(tx, top + 3, 13, 9);
        ctx.fillStyle = '#222';
        ctx.font = 'bold 8px sans-serif';
        ctx.fillText('fx', tx + 2, top + 8);
        fxw = 17;
        ctx.font = '11px "Segoe UI", sans-serif';
        ctx.fillStyle = '#ffffff';
      }
      ctx.fillText(name, tx + fxw, top + headH / 2 + 0.5);
    }
    // rubber band (opaklık / ses seviyesi)
    const showBand = c.type === 'audio' ? ch >= 36 : ch >= 70;
    if (showBand && cw > 6) this._drawBand(ctx, c, x0, x1, top + headH, ch - headH);
    // klip animasyonu göstergesi: giriş/çıkış süresi kadar açık renkli kama
    if (c.anim && cw > 8) {
      const wA = (d) => Math.min(cw / 2, d * seq.fps * this.ppf);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      if (c.anim.in?.type) { const w = wA(c.anim.in.dur || 0.5); ctx.beginPath(); ctx.moveTo(x0, top + ch); ctx.lineTo(x0 + w, top + ch); ctx.lineTo(x0, top + headH); ctx.closePath(); ctx.fill(); }
      if (c.anim.out?.type) { const w = wA(c.anim.out.dur || 0.5); ctx.beginPath(); ctx.moveTo(x1, top + ch); ctx.lineTo(x1 - w, top + ch); ctx.lineTo(x1, top + headH); ctx.closePath(); ctx.fill(); }
      if (c.anim.combo?.type && cw > 40) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '10px sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText('∞', x1 - 12, top + headH / 2); }
    }
    // klip (kaynak medya) işaretçileri
    if (media?.markers?.length && cw > 8) {
      const sp = Math.abs(c.speed) || 1;
      const srcEnd = c.inPoint + (c.duration / seq.fps) * sp;
      for (const mk of media.markers) {
        if (mk.t < c.inPoint - 1e-6 || mk.t >= srcEnd) continue;
        const f = c.start + ((c.reverse ? srcEnd - mk.t : mk.t - c.inPoint) * seq.fps) / sp;
        const mx = this.frameToX(f);
        ctx.fillStyle = mk.color || '#e3a42c';
        ctx.beginPath(); ctx.moveTo(mx - 4, top + headH); ctx.lineTo(mx + 4, top + headH); ctx.lineTo(mx, top + headH + 6); ctx.closePath(); ctx.fill();
        ctx.fillRect(mx - 0.5, top + headH, 1, ch - headH);
      }
    }
    ctx.restore();
    // kenarlık
    ctx.strokeStyle = sel ? '#ffffff' : 'rgba(0,0,0,0.6)';
    ctx.lineWidth = sel ? 1.5 : 1;
    ctx.strokeRect(x0 + 0.5, top + 0.5, cw - 1, ch - 1);
    // geçişler
    this._drawTransitions(ctx, c, seq, top, ch);
  }

  _bandParam(c) {
    return c.type === 'audio' ? c.props.volume : c.props.opacity;
  }
  _bandNorm(c, v) {
    return c.type === 'audio' ? dbToNorm(v) : clamp(v / 100, 0, 1);
  }
  _bandValue(c, n) {
    return c.type === 'audio' ? normToDb(n) : clamp(n * 100, 0, 100);
  }

  _drawBand(ctx, c, x0, x1, by, bh) {
    const p = this._bandParam(c);
    if (!p) return;
    const yOf = (v) => by + 2 + (1 - this._bandNorm(c, v)) * (bh - 4);
    ctx.strokeStyle = '#f2d05a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (!isAnimated(p)) {
      const y = Math.round(yOf(p.v)) + 0.5;
      ctx.moveTo(x0, y); ctx.lineTo(x1, y);
      ctx.stroke();
      return;
    }
    const k = p.kf;
    ctx.moveTo(x0, yOf(k[0].v));
    const steps = Math.max(2, Math.min(400, Math.round(x1 - x0) / 3));
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const f = (x - x0) / this.ppf;
      ctx.lineTo(x, yOf(evalParam(p, f)));
    }
    ctx.stroke();
    for (const kf of k) {
      const x = x0 + kf.f * this.ppf;
      if (x < x0 - 1 || x > x1 + 1) continue;
      const y = yOf(kf.v);
      const selected = store.ui.selectedKeyframes.some((s) => s.clipId === c.id && s.f === kf.f && s.band);
      ctx.fillStyle = selected ? '#ffffff' : '#f2d05a';
      ctx.beginPath();
      ctx.moveTo(x, y - 4); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 4); ctx.lineTo(x - 4, y);
      ctx.closePath();
      ctx.fill();
    }
  }

  _drawTransitions(ctx, c, seq, top, ch) {
    const sp = clipSpan(seq, c);
    const drawBox = (tr, which) => {
      const a = this.frameToX(tr.rs), b = this.frameToX(tr.rs + tr.d);
      const hh = Math.min(16, ch * 0.45);
      const sel = store.ui.selectedTransition && store.ui.selectedTransition.clipId === c.id && store.ui.selectedTransition.which === which;
      const g = ctx.createLinearGradient(a, 0, b, 0);
      g.addColorStop(0, sel ? 'rgba(120,190,255,0.95)' : 'rgba(150,150,210,0.9)');
      g.addColorStop(1, sel ? 'rgba(60,140,240,0.95)' : 'rgba(90,90,170,0.9)');
      ctx.fillStyle = g;
      ctx.fillRect(a, top + 1, b - a, hh);
      ctx.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,0.6)';
      ctx.strokeRect(a + 0.5, top + 1.5, b - a - 1, hh - 1);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.moveTo(a, top + hh); ctx.lineTo(b, top + 1); ctx.stroke();
      if (b - a > 40) {
        ctx.fillStyle = '#fff';
        ctx.font = '10px "Segoe UI", sans-serif';
        ctx.textBaseline = 'middle';
        ctx.save();
        ctx.beginPath(); ctx.rect(a, top, b - a, hh + 2); ctx.clip();
        ctx.fillText(t(TRANSITIONS[tr.type]?.name || tr.type), a + 3, top + hh / 2 + 1);
        ctx.restore();
      }
    };
    if (c.transIn && sp.tin) drawBox(sp.tin, 'in');
    if (c.transOut && sp.tout && !sp.tout.two) drawBox(sp.tout, 'out');
  }

  _updateHScroll() {
    const seq = store.seq;
    const W = this.hscroll.clientWidth;
    const view = this.wrap.clientWidth;
    const total = Math.max((seq ? sequenceDuration(seq) : 0) * this.ppf + view * 0.5, this.scrollX + view, 1);
    const tw = Math.max(30, (view / total) * W);
    const tx = (this.scrollX / total) * W;
    this.hthumb.style.width = tw + 'px';
    this.hthumb.style.left = Math.min(W - tw, tx) + 'px';
    this._scrollTotal = total;
  }

  _updateCursor() {
    const map = { select: 'default', trackSelect: 'e-resize', ripple: 'col-resize', roll: 'col-resize', rateStretch: 'ew-resize', razor: 'crosshair', slip: 'ew-resize', slide: 'ew-resize', pen: 'crosshair', hand: 'grab', zoom: 'zoom-in', type: 'text' };
    this.wrap.style.cursor = map[store.ui.tool] || 'default';
    this._draw();
  }

  // ---- İsabet testi ----
  hitTest(x, y) {
    const seq = store.seq;
    if (!seq) return null;
    const r = this.rowAtY(y);
    const frame = this.xToFrame(x);
    if (!r) return { row: null, frame };
    const ry = this.rowY(r);
    const list = clipsOnTrack(seq, r.type, r.index);
    let clip = null;
    for (const c of list) {
      const a = this.frameToX(c.start), b = this.frameToX(c.start + c.duration);
      if (x >= a - 1 && x < b + 1) { clip = c; break; }
    }
    // kesme noktası yakınında bitişik klipler
    let edge = null, other = null;
    for (const c of list) {
      const a = this.frameToX(c.start), b = this.frameToX(c.start + c.duration);
      const wpx = b - a;
      const zone = Math.min(EDGE_PX, wpx / 3);
      if (Math.abs(x - a) <= zone && x >= a - zone) {
        if (!edge || Math.abs(x - a) < edge.dist) edge = { clip: c, edge: 'start', dist: Math.abs(x - a) };
      }
      if (Math.abs(x - b) <= zone) {
        if (!edge || Math.abs(x - b) < edge.dist) edge = { clip: c, edge: 'end', dist: Math.abs(x - b) };
      }
    }
    if (edge) {
      if (edge.edge === 'start') other = list.find((c) => c.start + c.duration === edge.clip.start) || null;
      else other = list.find((c) => c.start === edge.clip.start + edge.clip.duration) || null;
    }
    // geçiş kutusu
    let trans = null;
    const headH = Math.min(16, (r.h - 3) * 0.45);
    if (y - ry < headH + 2) {
      for (const c of list) {
        const sp = clipSpan(seq, c);
        const test = (tr, which) => {
          if (!tr) return;
          const a = this.frameToX(tr.rs), b = this.frameToX(tr.rs + tr.d);
          if (x >= a && x <= b) {
            let tEdge = null;
            if (Math.abs(x - a) < 5) tEdge = 'left';
            else if (Math.abs(x - b) < 5) tEdge = 'right';
            trans = { clip: c, which, tr, edge: tEdge };
          }
        };
        if (c.transIn) test(sp.tin, 'in');
        if (c.transOut && sp.tout && !sp.tout.two) test(sp.tout, 'out');
      }
    }
    // rubber band keyframe
    let band = null;
    if (clip) {
      const ch = r.h - 3;
      const hh = Math.min(15, ch);
      const showBand = clip.type === 'audio' ? ch >= 36 : ch >= 70;
      if (showBand) {
        const by = ry + 1 + hh, bh = ch - hh;
        const p = this._bandParam(clip);
        const yOf = (v) => by + 2 + (1 - this._bandNorm(clip, v)) * (bh - 4);
        const x0 = this.frameToX(clip.start);
        if (isAnimated(p)) {
          for (const kf of p.kf) {
            const kx = x0 + kf.f * this.ppf, ky = yOf(kf.v);
            if (Math.abs(kx - x) <= 5 && Math.abs(ky - y) <= 5) { band = { kf, by, bh }; break; }
          }
        }
        if (!band) {
          const ly = yOf(evalParam(p, frame - clip.start));
          if (Math.abs(ly - y) <= 4) band = { line: true, by, bh };
        }
      }
    }
    return { row: r, frame, clip, edge, other, trans, band, rowY: ry };
  }

  // ---- Olaylar ----
  _bindEvents() {
    const wrap = this.wrap;
    wrap.addEventListener('mousedown', (e) => this._onDown(e));
    const trackMouse = (e) => { const r = this.wrap.getBoundingClientRect(); this.mouseX = clamp(e.clientX - r.left, 0, r.width); };
    wrap.addEventListener('mousemove', (e) => { trackMouse(e); if (!this.drag) this._onHover(e); });
    wrap.addEventListener('mouseleave', () => { this.hover = null; this.mouseX = null; this._draw(); });
    this.rulerWrap.addEventListener('mousemove', trackMouse);
    this.rulerWrap.addEventListener('mouseleave', () => { this.mouseX = null; });
    wrap.addEventListener('dblclick', (e) => this._onDblClick(e));
    wrap.addEventListener('contextmenu', (e) => this._onContext(e));
    wrap.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    this.rulerWrap.addEventListener('mousedown', (e) => this._onRulerDown(e));
    this.rulerWrap.addEventListener('dblclick', (e) => this._onRulerDbl(e));
    this.rulerWrap.addEventListener('contextmenu', (e) => this._onRulerContext(e));
    this.rulerWrap.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    this.headers.addEventListener('wheel', (e) => { e.preventDefault(); this._scrollV(e.deltaY); }, { passive: false });
    // yatay kaydırma çubuğu
    this.hthumb.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const r = this.hthumb.getBoundingClientRect();
      const W = this.hscroll.clientWidth;
      const mode = e.clientX - r.left < 8 ? 'l' : r.right - e.clientX < 8 ? 'r' : 'm';
      const x0 = e.clientX, s0 = this.scrollX, ppf0 = this.ppf, total0 = this._scrollTotal, view = this.wrap.clientWidth;
      const mv = (ev) => {
        const dx = ev.clientX - x0;
        if (mode === 'm') this.scrollX = Math.max(0, s0 + (dx / W) * total0);
        else {
          const tw0 = r.width;
          const tw = Math.max(20, mode === 'r' ? tw0 + dx : tw0 - dx);
          const k = tw0 / tw;
          const fCenter = mode === 'r' ? s0 / ppf0 : (s0 + view) / ppf0;
          this.ppf = clamp(ppf0 * k, 0.002, 60);
          this.scrollX = mode === 'r' ? fCenter * this.ppf : Math.max(0, fCenter * this.ppf - view);
        }
        this._draw();
      };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
    });
    // sürükle-bırak
    wrap.addEventListener('dragover', (e) => this._onDragOver(e));
    wrap.addEventListener('dragleave', () => { this.dropGhost = null; this._draw(); });
    wrap.addEventListener('drop', (e) => this._onDrop(e));
  }

  _scrollV(dy) {
    const L = this.layout;
    if (!L) return;
    const maxY = Math.max(0, L.total + this.videoOffset - this.wrap.clientHeight + 40);
    this.scrollY = clamp(this.scrollY + dy, 0, maxY);
    this._renderHeaders();
    this._draw();
  }

  _onWheel(e) {
    e.preventDefault();
    if (e.altKey || e.ctrlKey) {
      const r = this.wrap.getBoundingClientRect();
      this.zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left);
      return;
    }
    if (e.shiftKey) { this._scrollV(e.deltaY); return; }
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    this.scrollX = Math.max(0, this.scrollX + d);
    this._draw();
  }

  _local(e) {
    const r = this.wrap.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _onHover(e) {
    const { x, y } = this._local(e);
    const h = this.hitTest(x, y);
    this.hover = h;
    if (!h) return;
    const tool = store.ui.tool;
    let cursor = this.wrap.style.cursor;
    const base = { select: 'default', trackSelect: 'e-resize', razor: 'crosshair', slip: 'ew-resize', slide: 'ew-resize', pen: 'crosshair', hand: 'grab', zoom: e.altKey ? 'zoom-out' : 'zoom-in' }[tool] || 'default';
    cursor = base;
    if (['select', 'ripple', 'roll', 'rateStretch'].includes(tool)) {
      if (h.trans && h.trans.edge) cursor = 'ew-resize';
      else if (h.band && (h.band.kf || (h.band.line && tool === 'select'))) cursor = h.band.kf ? 'pointer' : 'ns-resize';
      else if (h.edge) {
        if (tool === 'roll' || (tool === 'select' && e.ctrlKey && e.shiftKey)) cursor = 'col-resize';
        else if (tool === 'ripple' || (tool === 'select' && e.ctrlKey)) cursor = h.edge.edge === 'start' ? 'w-resize' : 'e-resize';
        else if (tool === 'rateStretch') cursor = 'ew-resize';
        else cursor = h.edge.edge === 'start' ? 'w-resize' : 'e-resize';
      } else cursor = tool === 'select' ? 'default' : (tool === 'ripple' || tool === 'roll' || tool === 'rateStretch' ? 'not-allowed' : 'default');
    }
    if (tool === 'pen' && h.band) cursor = 'pointer';
    this.wrap.style.cursor = cursor;
    if (tool === 'razor') {
      let f = Math.round(h.frame);
      if (store.ui.snapping) {
        const sn = E.nearestSnap(E.snapPoints(store.seq, null, [app.engine.currentFrame]), f, 8 / this.ppf);
        if (sn != null) f = sn;
      }
      this.hover.frame = f;
      this._draw();
    }
  }

  _snap(f, exclude, extra = []) {
    if (!store.ui.snapping) { this.snapLine = null; return f; }
    if (!this._snapCache) this._snapCache = E.snapPoints(store.seq, exclude, [app.engine.currentFrame, ...extra]);
    const s = E.nearestSnap(this._snapCache, f, 10 / this.ppf);
    this.snapLine = s;
    return s != null ? s : f;
  }

  _selectClick(c, e) {
    const seq = store.seq;
    let ids = [c.id];
    if (store.ui.linkedSelection && !e.altKey) ids = E.expandLinked(seq, ids);
    store.ui.selectedTransition = null;
    if (e.shiftKey || e.ctrlKey && !e.altKey && false) store.toggleSelect(ids);
    else if (!store.ui.selection.has(c.id)) store.select(ids);
  }

  _onDown(e) {
    if (e.button === 1) { this._startHand(e); return; }
    if (e.button !== 0) return;
    const seq = store.seq;
    if (!seq) return;
    this.wrap.focus();
    const { x, y } = this._local(e);
    const h = this.hitTest(x, y);
    const tool = store.ui.tool;
    this._snapCache = null;
    store.ui.selectedKeyframes = [];
    if (tool === 'hand') { this._startHand(e); return; }
    if (tool === 'zoom') { this.zoomBy(e.altKey ? 1 / 1.6 : 1.6, x); return; }
    if (!h.row) {
      if (!e.shiftKey) store.clearSelection();
      this._startMarquee(x, y, e);
      return;
    }
    if (h.row.type === 'caption') { this._captionDown(e, x, h); return; }
    store.ui.selectedCaption = null;
    const track = h.row.track;
    if (tool === 'razor') {
      if (!h.clip) return;
      const f = this.hover?.frame ?? Math.round(h.frame);
      store.commit('Razor', () => {
        if (e.shiftKey) E.razorAt(seq, f);
        else {
          let clips = [h.clip];
          if (store.ui.linkedSelection && !e.altKey) clips = E.expandLinked(seq, [h.clip.id]).map((id) => seq.clips[id]);
          E.razorAt(seq, f, clips);
        }
      });
      return;
    }
    if (tool === 'trackSelect') {
      const f = Math.round(h.frame);
      const ids = Object.values(seq.clips)
        .filter((c) => c.start + c.duration > f && !seq.tracks[c.type][c.track]?.locked)
        .filter((c) => !e.shiftKey || (c.type === h.row.type && c.track === h.row.index))
        .map((c) => c.id);
      store.select(ids);
      if (ids.length) this._startMove(e, x, y, h, ids);
      return;
    }
    // geçiş
    if (h.trans && ['select', 'ripple', 'roll', 'rateStretch'].includes(tool)) {
      store.clearSelection();
      store.ui.selectedTransition = { clipId: h.trans.clip.id, which: h.trans.which };
      store.emit('selection');
      if (h.trans.edge) this._startTransitionResize(e, x, h);
      return;
    }
    store.ui.selectedTransition = null;
    // rubber band
    if (h.clip && h.band && (tool === 'select' || tool === 'pen') && !track.locked) {
      if (h.band.kf) { this._startBandKeyframe(e, h); return; }
      if (tool === 'pen' || e.ctrlKey) {
        const f = Math.round(h.frame - h.clip.start);
        store.commit('Add Keyframe', () => {
          const p = this._bandParam(seq.clips[h.clip.id]);
          const n = clamp(1 - (y - h.band.by - 2) / (h.band.bh - 4), 0, 1);
          addKeyframe(p, f);
          setParamAt(p, f, this._bandValue(h.clip, n));
        });
        return;
      }
      if (!isAnimated(this._bandParam(h.clip)) && tool === 'select') { this._startBandLine(e, h); return; }
    }
    if (tool === 'pen') return;
    // kenar işlemleri
    if (h.edge && !track.locked && ['select', 'ripple', 'roll', 'rateStretch'].includes(tool)) {
      let mode = 'trim';
      if (tool === 'ripple' || (tool === 'select' && e.ctrlKey && !e.shiftKey)) mode = 'ripple';
      if (tool === 'roll' || (tool === 'select' && e.ctrlKey && e.shiftKey)) mode = 'roll';
      if (tool === 'rateStretch') mode = 'stretch';
      this._startTrim(e, x, h, mode);
      return;
    }
    if (h.clip) {
      if (track.locked) return;
      if (tool === 'slip' || tool === 'slide') {
        let ids = [h.clip.id];
        if (store.ui.linkedSelection) ids = E.expandLinked(seq, ids);
        store.select(ids);
        this._startSlipSlide(e, x, ids, tool);
        return;
      }
      if (e.shiftKey) {
        let ids = [h.clip.id];
        if (store.ui.linkedSelection && !e.altKey) ids = E.expandLinked(seq, ids);
        store.toggleSelect(ids);
        return;
      }
      if (!store.ui.selection.has(h.clip.id)) {
        let ids = [h.clip.id];
        if (store.ui.linkedSelection && !e.altKey) ids = E.expandLinked(seq, ids);
        store.select(ids);
      } else if (e.altKey) {
        // alt-tık: yalnızca bu klip (bağlantıyı yoksay)
        store.select([h.clip.id]);
      }
      this._startMove(e, x, y, h, [...store.ui.selection]);
      return;
    }
    // boşluk
    const gap = E.gapAt(seq, h.row.type, h.row.index, Math.floor(h.frame));
    store.clearSelection();
    if (gap) {
      store.ui.selectedGap = gap;
      store.emit('selection');
      return;
    }
    this._startMarquee(x, y, e);
  }

  _startHand(e) {
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY, s0 = this.scrollX, sy0 = this.scrollY;
    this.wrap.style.cursor = 'grabbing';
    const mv = (ev) => {
      this.scrollX = Math.max(0, s0 - (ev.clientX - x0));
      const L = this.layout;
      const maxY = Math.max(0, L.total + this.videoOffset - this.wrap.clientHeight + 40);
      this.scrollY = clamp(sy0 - (ev.clientY - y0), 0, maxY);
      this._renderHeaders();
      this._draw();
    };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); this._updateCursor(); };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  }

  _startMarquee(x, y, e) {
    this.marquee = { x0: x, y0: y, x1: x, y1: y };
    const additive = e.shiftKey;
    const before = new Set(store.ui.selection);
    const mv = (ev) => {
      const p = this._local(ev);
      this.marquee.x1 = p.x;
      this.marquee.y1 = p.y;
      const seq = store.seq;
      const fa = this.xToFrame(Math.min(this.marquee.x0, p.x)), fb = this.xToFrame(Math.max(this.marquee.x0, p.x));
      const ya = Math.min(this.marquee.y0, p.y), yb = Math.max(this.marquee.y0, p.y);
      const ids = [];
      for (const id in seq.clips) {
        const c = seq.clips[id];
        const r = this.findRow(c.type, c.track);
        if (!r || r.track.locked) continue;
        const ry = this.rowY(r);
        if (ry + r.h < ya || ry > yb) continue;
        if (c.start + c.duration < fa || c.start > fb) continue;
        ids.push(id);
      }
      const all = store.ui.linkedSelection ? E.expandLinked(seq, ids) : ids;
      store.select(additive ? [...before, ...all] : all);
      this._draw();
    };
    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      this.marquee = null;
      this._draw();
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  }

  // Genel "base'den yeniden uygula" sürükleme altyapısı
  _liveDrag(label, e, apply, opts = {}) {
    const seq = store.seq;
    const seqId = seq.id;
    const base = structuredClone(seq);
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    let begun = false;
    const mv = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      if (!moved) { moved = true; }
      if (!begun) { store.begin(label); begun = true; }
      store.live((p) => {
        const s = structuredClone(base);
        apply(s, ev, dx, dy);
        p.sequences[seqId] = s;
      });
      this._draw();
    };
    const up = (ev) => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('keydown', key, true);
      this.snapLine = null;
      this._snapCache = null;
      if (begun) store.end();
      else if (opts.onClick) opts.onClick(ev);
      if (opts.onEnd) opts.onEnd(moved);
      this._draw();
    };
    const key = (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        window.removeEventListener('mousemove', mv);
        window.removeEventListener('mouseup', up);
        window.removeEventListener('keydown', key, true);
        if (begun) store.cancel();
        this.snapLine = null;
        this._draw();
      }
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    window.addEventListener('keydown', key, true);
  }

  _startMove(e, x, y, h, ids) {
    const seq = store.seq;
    ids = ids.filter((id) => seq.clips[id] && !seq.tracks[seq.clips[id].type][seq.clips[id].track]?.locked);
    if (!ids.length) return;
    const exclude = new Set(ids);
    const clips0 = ids.map((id) => seq.clips[id]);
    const gStart = Math.min(...clips0.map((c) => c.start));
    const gEnd = Math.max(...clips0.map((c) => c.start + c.duration));
    const row0 = h.row;
    const clickedClip = h.clip;
    this._liveDrag(e.altKey ? 'Duplicate' : 'Move', e, (s, ev, dx) => {
      let df = Math.round(dx / this.ppf);
      // snap: grubun başı veya sonu
      if (store.ui.snapping) {
        this._snapCache = this._snapCache || E.snapPoints(s, exclude, [app.engine.currentFrame]);
        const thr = 10 / this.ppf;
        const a = E.nearestSnap(this._snapCache, gStart + df, thr);
        const b = E.nearestSnap(this._snapCache, gEnd + df, thr);
        if (a != null && (b == null || Math.abs(a - gStart - df) <= Math.abs(b - gEnd - df))) { df = a - gStart; this.snapLine = a; }
        else if (b != null) { df = b - gEnd; this.snapLine = b; }
        else this.snapLine = null;
      }
      // iz değişimi
      const p = this._local(ev);
      const r = this.rowAtY(p.y);
      const dTrack = { video: 0, audio: 0 };
      if (r && r.type === row0.type) {
        dTrack[row0.type] = r.index - row0.index;
        // bağlı diğer tür için de aynı yönde kaydır (Premiere davranışı: yalnızca tıklanan tür)
      }
      // izin sınırları
      for (const type of ['video', 'audio']) {
        const sel = clips0.filter((c) => c.type === type);
        if (!sel.length) continue;
        const minT = Math.min(...sel.map((c) => c.track)), maxT = Math.max(...sel.map((c) => c.track));
        dTrack[type] = clamp(dTrack[type], -minT, s.tracks[type].length - 1 - maxT);
        for (const c of sel) {
          if (s.tracks[type][c.track + dTrack[type]]?.locked) dTrack[type] = 0;
        }
      }
      if (ev.altKey) {
        const newIds = E.duplicateClips(s, ids, df, dTrack);
        this._pendingSelect = newIds;
      } else {
        this._pendingSelect = null;
        E.moveClips(s, ids, df, dTrack, ev.ctrlKey ? 'insert' : 'overwrite');
      }
    }, {
      onEnd: (moved) => {
        if (moved && this._pendingSelect && this._pendingSelect.length) store.select(this._pendingSelect);
        this._pendingSelect = null;
      },
      onClick: () => {
        // sürüklenmeden tıklandıysa yalnızca bu klibi seç
        if (clickedClip && store.ui.selection.size > 1 && !e.shiftKey) {
          let one = [clickedClip.id];
          if (store.ui.linkedSelection && !e.altKey) one = E.expandLinked(store.seq, one);
          store.select(one);
        }
      },
    });
  }

  _startTrim(e, x, h, mode) {
    const seq = store.seq;
    const project = store.project;
    const c = h.clip;
    const edge = h.edge.edge;
    let ids = [c.id];
    if (store.ui.linkedSelection && !e.altKey) {
      ids = E.expandLinked(seq, ids).filter((id) => {
        const l = seq.clips[id];
        // aynı kenar konumunda olan bağlı klipler
        return edge === 'start' ? l.start === c.start : l.start + l.duration === c.start + c.duration;
      });
    }
    if (mode === 'roll') {
      // roll: kesme noktasındaki çiftler
      const pairs = [];
      for (const id of ids) {
        const a0 = seq.clips[id];
        const list = clipsOnTrack(seq, a0.type, a0.track);
        let A, B;
        if (edge === 'end') { A = a0; B = list.find((x2) => x2.start === a0.start + a0.duration); }
        else { B = a0; A = list.find((x2) => x2.start + x2.duration === a0.start); }
        if (A && B) pairs.push([A.id, B.id]);
      }
      if (!pairs.length) { mode = 'trim'; }
      else {
        const editF = edge === 'end' ? c.start + c.duration : c.start;
        this._liveDrag('Roll Edit', e, (s, ev, dx) => {
          let d = Math.round(dx / this.ppf);
          const target = this._snap(editF + d, new Set(pairs.flat()));
          d = target - editF;
          E.rollEdit(s, project, pairs.map(([a, b]) => [s.clips[a], s.clips[b]]), d);
          this._showTrimPreview(s, pairs[0][0], 'end');
        }, { onEnd: () => this._endTrimPreview() });
        return;
      }
    }
    const editF = edge === 'end' ? c.start + c.duration : c.start;
    const label = mode === 'ripple' ? 'Ripple Trim' : mode === 'stretch' ? 'Rate Stretch' : 'Trim';
    store.select(E.expandLinked(seq, [c.id]).filter((id) => store.ui.linkedSelection || id === c.id));
    this._liveDrag(label, e, (s, ev, dx) => {
      let d = Math.round(dx / this.ppf);
      const target = this._snap(editF + d, new Set(ids));
      d = target - editF;
      if (mode === 'ripple') E.rippleTrim(s, project, ids, edge, edge === 'start' ? d : d);
      else if (mode === 'stretch') E.rateStretch(s, project, ids, edge, edge === 'end' ? d : -d);
      else E.normalTrim(s, project, ids, edge, d);
      this._showTrimPreview(s, c.id, edge);
    }, { onEnd: () => this._endTrimPreview() });
  }

  // Kırparken program monitöründe kenar karesini göster
  _showTrimPreview(s, clipId, edge) {
    const c = s.clips[clipId];
    if (!c) return;
    const f = edge === 'end' ? c.start + c.duration - 1 : c.start;
    // oynatma kafası yerinde kalır; monitör yalnız kırpılan kenarın karesini gösterir
    app.engine.showPreviewFrame(f);
  }
  _endTrimPreview() {
    app.engine.showPreviewFrame(null);
  }

  _startSlipSlide(e, x, ids, tool) {
    const project = store.project;
    const seq = store.seq;
    const c = seq.clips[ids[0]];
    this._liveDrag(tool === 'slip' ? 'Slip' : 'Slide', e, (s, ev, dx) => {
      const d = Math.round(dx / this.ppf);
      if (tool === 'slip') {
        E.slipEdit(s, project, ids, d);
        const cc = s.clips[c.id];
        app.engine.showPreviewFrame(cc.start);
      } else {
        E.slideEdit(s, project, ids, d);
      }
    }, { onEnd: () => this._endTrimPreview() });
  }

  _startTransitionResize(e, x, h) {
    const seq = store.seq;
    const clipId = h.trans.clip.id;
    const which = h.trans.which;
    const tr0 = h.trans.tr;
    const side = h.trans.edge;
    this._liveDrag('Transition Duration', e, (s, ev, dx) => {
      const c = s.clips[clipId];
      const tr = which === 'in' ? c.transIn : c.transOut;
      if (!tr) return;
      const df = Math.round(dx / this.ppf);
      const centered = tr0.two && (tr.align || 'center') === 'center';
      let d = tr0.d + (side === 'right' ? df : -df) * (centered ? 2 : 1);
      const maxD = centered ? 2 * Math.min(c.duration, 600) : c.duration;
      tr.duration = clamp(d, 2, maxD);
    });
  }

  _startBandKeyframe(e, h) {
    const seq = store.seq;
    const clipId = h.clip.id;
    const kf0 = { ...h.band.kf };
    const { by, bh } = h.band;
    store.ui.selectedKeyframes = [{ clipId, f: kf0.f, band: true }];
    this._liveDrag('Move Keyframe', e, (s, ev, dx) => {
      const c = s.clips[clipId];
      const p = this._bandParam(c);
      const k = p.kf.find((x) => x.f === kf0.f);
      if (!k) return;
      const pt = this._local(ev);
      let nf = kf0.f + (ev.shiftKey ? 0 : Math.round(dx / this.ppf));
      nf = clamp(nf, 0, c.duration - 1);
      if (p.kf.some((x) => x !== k && x.f === nf)) nf = k.f;
      k.f = nf;
      const n = clamp(1 - (pt.y - by - 2) / (bh - 4), 0, 1);
      k.v = this._bandValue(c, n);
      p.kf.sort((a, b) => a.f - b.f);
      store.ui.selectedKeyframes = [{ clipId, f: nf, band: true }];
    });
  }

  _startBandLine(e, h) {
    const clipId = h.clip.id;
    const { by, bh } = h.band;
    store.select([clipId]);
    this._liveDrag('Adjust Level', e, (s, ev) => {
      const c = s.clips[clipId];
      const p = this._bandParam(c);
      const pt = this._local(ev);
      const n = clamp(1 - (pt.y - by - 2) / (bh - 4), 0, 1);
      p.v = this._bandValue(c, n);
      if (c.type === 'audio') p.v = Math.round(p.v * 10) / 10;
      else p.v = Math.round(p.v);
    });
  }

  _captionHit(x) {
    const seq = store.seq;
    const f = this.xToFrame(x);
    let cap = null, edge = null;
    for (const c of seq.captions || []) {
      const a = this.frameToX(c.start), b = this.frameToX(c.end);
      const zone = Math.min(EDGE_PX, (b - a) / 3);
      if (Math.abs(x - a) <= zone) { cap = c; edge = 'start'; break; }
      if (Math.abs(x - b) <= zone) { cap = c; edge = 'end'; break; }
      if (f >= c.start && f < c.end) cap = c;
    }
    return { cap, edge, f };
  }

  _captionDown(e, x, h) {
    const seq = store.seq;
    const { cap, edge } = this._captionHit(x);
    store.ui.selection.clear();
    if (!cap) { store.ui.selectedCaption = null; store.emit('selection'); app.engine.setFrame(Math.round(h.frame)); return; }
    if (store.ui.tool === 'razor') {
      const f = Math.round(h.frame);
      if (f <= cap.start || f >= cap.end) return;
      store.commit('Split Caption', (p) => {
        const s2 = p.sequences[p.activeSequenceId];
        const c = s2.captions.find((x2) => x2.id === cap.id);
        s2.captions.push({ id: newId('cap'), start: f, end: c.end, text: c.text });
        c.end = f;
        sortCaptions(s2);
      });
      return;
    }
    store.ui.selectedCaption = cap.id;
    store.emit('selection');
    const id = cap.id;
    const others = (seq.captions || []).filter((c) => c.id !== id);
    const prevEnd = Math.max(0, ...others.filter((c) => c.end <= cap.start).map((c) => c.end));
    const nextStart = Math.min(Infinity, ...others.filter((c) => c.start >= cap.end).map((c) => c.start));
    const s0 = cap.start, e0 = cap.end;
    this._liveDrag(edge ? 'Trim Caption' : 'Move Caption', e, (s2, ev, dx) => {
      const c = s2.captions.find((x2) => x2.id === id);
      let d = Math.round(dx / this.ppf);
      if (edge === 'start') {
        const tgt = this._snap(s0 + d, null);
        c.start = clamp(tgt, prevEnd, e0 - 1);
      } else if (edge === 'end') {
        const tgt = this._snap(e0 + d, null);
        c.end = clamp(tgt, s0 + 1, nextStart);
      } else {
        const len = e0 - s0;
        let ns = this._snap(s0 + d, null);
        ns = clamp(ns, prevEnd, nextStart - len);
        c.start = ns; c.end = ns + len;
      }
    }, { onClick: () => app.engine.setFrame(Math.round(h.frame)) });
  }

  async _editCaption(id) {
    const seq = store.seq;
    const cap = (seq.captions || []).find((c) => c.id === id);
    if (!cap) return;
    const v = await promptDialog(t('Caption text'), cap.text, { multiline: true });
    if (v == null) return;
    store.commit('Edit Caption', (p) => { const c = p.sequences[p.activeSequenceId].captions.find((x2) => x2.id === id); if (c) c.text = v; });
  }

  _onDblClick(e) {
    const { x, y } = this._local(e);
    const h = this.hitTest(x, y);
    if (h && h.row && h.row.type === 'caption') {
      const { cap } = this._captionHit(x);
      if (cap) this._editCaption(cap.id);
      else app.commands.run('caption.add');
      return;
    }
    if (!h || !h.clip) return;
    if (h.trans) { app.commands.run('transition.duration'); return; }
    const c = h.clip;
    if (c.kind === 'sequence') {
      app.commands.openSequence(c.seqId);
      return;
    }
    if (c.kind === 'media' && c.mediaId) {
      app.source?.openMedia(c.mediaId, { clipId: c.id });
    } else if (c.kind === 'text') {
      store.select([c.id]);
      app.commands.showPanel('effectControls');
    }
  }

  _onContext(e) {
    e.preventDefault();
    const { x, y } = this._local(e);
    const h = this.hitTest(x, y);
    const seq = store.seq;
    if (!seq || !h) return;
    const C = app.commands;
    if (h.row && h.row.type === 'caption') {
      const { cap } = this._captionHit(x);
      if (cap) { store.ui.selectedCaption = cap.id; store.emit('selection'); }
      contextMenu(e.clientX, e.clientY, [
        { label: t('Edit Caption Text...'), enabled: !!cap, action: () => this._editCaption(cap.id) },
        { label: t('Delete'), enabled: !!cap, action: () => C.run('edit.delete') },
        '-',
        { label: t('Add Caption'), action: () => { app.engine.setFrame(Math.round(h.frame)); C.run('caption.add'); } },
        { label: t('Import Captions (SRT/VTT)...'), action: () => C.run('caption.import') },
        { label: t('Export Captions (SRT)...'), action: () => C.run('caption.export') },
      ]);
      return;
    }
    if (h.band && h.band.kf && h.clip) {
      const clipId = h.clip.id, f = h.band.kf.f;
      const setE = (eName) => store.commit('Keyframe Interpolation', () => { const k = this._bandParam(seq.clips[clipId]).kf.find((k2) => k2.f === f); if (k) k.e = eName; });
      contextMenu(e.clientX, e.clientY, [
        { label: t('Linear'), action: () => setE('linear') },
        { label: t('Hold'), action: () => setE('hold') },
        { label: t('Ease In'), action: () => setE('easeIn') },
        { label: t('Ease Out'), action: () => setE('easeOut') },
        { label: t('Ease In/Out'), action: () => setE('ease') },
        '-',
        { label: t('Delete'), action: () => store.commit('Delete Keyframe', () => { const p = this._bandParam(seq.clips[clipId]); p.kf = p.kf.filter((k) => k.f !== f); if (!p.kf.length) p.kf = null; }) },
      ]);
      return;
    }
    if (h.trans) {
      store.ui.selectedTransition = { clipId: h.trans.clip.id, which: h.trans.which };
      store.emit('selection');
      contextMenu(e.clientX, e.clientY, [
        { label: t('Set Transition Duration...'), action: () => C.run('transition.duration') },
        { label: t('Clear'), action: () => C.run('edit.delete') },
      ]);
      return;
    }
    if (h.clip) {
      if (!store.ui.selection.has(h.clip.id)) {
        let ids = [h.clip.id];
        if (store.ui.linkedSelection) ids = E.expandLinked(seq, ids);
        store.select(ids);
      }
      const c = h.clip;
      const labels = Object.keys(LABEL_COLORS).map((k) => ({ label: t(k[0].toUpperCase() + k.slice(1)), action: () => store.commit('Label', () => { for (const cl of store.selectedClips()) cl.label = k; }) }));
      contextMenu(e.clientX, e.clientY, [
        { label: t('Cut'), shortcut: 'Ctrl+X', action: () => C.run('edit.cut') },
        { label: t('Copy'), shortcut: 'Ctrl+C', action: () => C.run('edit.copy') },
        { label: t('Paste Attributes...'), shortcut: 'Ctrl+Alt+V', action: () => C.run('edit.pasteAttributes') },
        { label: t('Remove Effects...'), action: () => C.run('clip.removeEffects') },
        '-',
        { label: t('Clear'), shortcut: 'Del', action: () => C.run('edit.delete') },
        { label: t('Ripple Delete'), shortcut: 'Shift+Del', action: () => C.run('edit.rippleDelete') },
        '-',
        { label: t('Enable'), checked: c.enabled, shortcut: 'Shift+E', action: () => C.run('clip.enable') },
        { label: c.linkId ? t('Unlink') : t('Link'), shortcut: 'Ctrl+L', action: () => C.run('clip.link') },
        { label: t('Delete Audio (Keep Video)'), enabled: !!c.linkId, action: () => C.run('clip.keepVideo') },
        { label: t('Delete Video (Keep Audio)'), enabled: !!c.linkId, action: () => C.run('clip.keepAudio') },
        '-',
        { label: t('Speed/Duration...'), shortcut: 'Ctrl+R', action: () => C.run('clip.speed') },
        { label: t('Speed Curve'), enabled: c.type === 'video' && !!c.props.timeRemap, submenu: [...SPEED_CURVES.map(([k, n]) => ({ label: t(n), action: () => applySpeedCurve([...store.ui.selection].filter((id) => store.seq.clips[id]?.type === 'video'), k) })), '-', { label: t('Normal (reset)'), action: () => applySpeedCurve([c.id], 'none') }] },
        { label: t('Nest...'), action: () => C.run('clip.nest') },
        { label: t('Make Subclip...'), shortcut: 'Ctrl+U', action: () => C.run('clip.makeSubclip') },
        { label: t('Scene Edit Detection...'), action: () => C.run('clip.sceneDetect') },
        { label: t('Split Screen...'), enabled: c.type === 'video', action: () => C.run('clip.splitScreen') },
        { label: t('Detect Beats'), enabled: c.type === 'audio', action: () => C.run('audio.detectBeats') },
        { label: t('Auto Cut to Beat...'), enabled: c.type === 'video', action: () => C.run('sequence.cutToBeat') },
        { label: t('Open Nested Sequence'), enabled: c.kind === 'sequence', action: () => app.commands.openSequence(c.seqId) },
        { label: t('Scale to Frame Size'), enabled: c.type === 'video', action: () => C.run('clip.scaleToFrame') },
        { label: t('Set to Frame Size'), enabled: c.type === 'video', action: () => C.run('clip.setToFrame') },
        { label: t('Add Frame Hold'), enabled: c.type === 'video' && c.kind === 'media', action: () => C.run('clip.frameHold') },
        '-',
        { label: t('Label'), submenu: labels },
        { label: t('Rename...'), action: () => C.run('clip.rename') },
        { label: t('Reveal in Project'), enabled: !!c.mediaId, action: () => C.run('clip.revealInProject') },
        { label: t('Reveal in Explorer'), enabled: !!c.mediaId, action: () => C.run('clip.revealInExplorer') },
        { label: t('Replace With Clip From Source Monitor'), enabled: !!store.ui.sourceMediaId, action: () => C.run('clip.replaceFromSource') },
      ]);
      return;
    }
    const gap = h.row ? E.gapAt(seq, h.row.type, h.row.index, Math.floor(h.frame)) : null;
    if (gap) {
      store.clearSelection();
      store.ui.selectedGap = gap;
      store.emit('selection');
      contextMenu(e.clientX, e.clientY, [{ label: t('Ripple Delete'), action: () => C.run('edit.rippleDelete') }]);
      return;
    }
    contextMenu(e.clientX, e.clientY, [
      { label: t('Paste'), shortcut: 'Ctrl+V', enabled: !!app.clipboard, action: () => C.run('edit.paste') },
      { label: t('Paste Insert'), shortcut: 'Ctrl+Shift+V', enabled: !!app.clipboard, action: () => C.run('edit.pasteInsert') },
      '-',
      { label: t('Add Tracks...'), action: () => C.run('sequence.addTracks') },
    ]);
  }

  // ---- Cetvel ----
  _onRulerDown(e) {
    if (e.button !== 0) return;
    const seq = store.seq;
    if (!seq) return;
    const r = this.rulerWrap.getBoundingClientRect();
    // işaretçi tıklandı mı
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (y < 16) {
      const m = seq.markers.find((mk) => Math.abs(this.frameToX(mk.frame) - x) < 6);
      if (m) { this._dragMarker(e, m); return; }
    }
    const wasPlaying = app.engine.playing;
    if (wasPlaying) app.engine.pause();
    const pts = E.snapPoints(seq, null, []);
    const set = (ev) => {
      let f = Math.max(0, Math.round(this.xToFrame(ev.clientX - r.left)));
      if (ev.shiftKey || (store.ui.snapping && ev.ctrlKey)) {
        const s = E.nearestSnap(pts, f, 10 / this.ppf);
        if (s != null) f = s;
      }
      app.engine.setFrame(f);
      this._draw();
    };
    set(e);
    const mv = (ev) => set(ev);
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  }

  _dragMarker(e, m) {
    const seq = store.seq;
    const id = m.id;
    this._liveDrag('Move Marker', e, (s, ev, dx) => {
      const mk = s.markers.find((x) => x.id === id);
      const orig = seq.markers.find((x) => x.id === id) || m;
      if (mk) mk.frame = Math.max(0, Math.round(orig.frame + dx / this.ppf));
    }, { onClick: () => app.engine.setFrame(m.frame) });
  }

  _onRulerDbl(e) {
    const seq = store.seq;
    if (!seq) return;
    const r = this.rulerWrap.getBoundingClientRect();
    const x = e.clientX - r.left;
    const m = seq.markers.find((mk) => Math.abs(this.frameToX(mk.frame) - x) < 6);
    if (m) app.commands.editMarker(m.id);
  }

  _onRulerContext(e) {
    e.preventDefault();
    const C = app.commands;
    contextMenu(e.clientX, e.clientY, [
      { label: t('Add Marker'), shortcut: 'M', action: () => C.run('marker.add') },
      { label: t('Clear Selected Marker'), action: () => C.run('marker.clearCurrent') },
      { label: t('Clear All Markers'), action: () => C.run('marker.clearAll') },
      '-',
      { label: t('Mark In'), shortcut: 'I', action: () => C.run('mark.in') },
      { label: t('Mark Out'), shortcut: 'O', action: () => C.run('mark.out') },
      { label: t('Clear In and Out'), shortcut: 'Ctrl+Shift+X', action: () => C.run('mark.clear') },
    ]);
  }

  // ---- Sürükle-bırak ----
  _parseDrag(e) {
    const types = e.dataTransfer.types;
    if (types.includes('application/x-uli-media') || types.includes('application/x-uli-seqs')) return 'media';
    if (types.includes('application/x-uli-effect')) return 'effect';
    if (types.includes('Files')) return 'files';
    return null;
  }

  _dropTarget(x, y) {
    const seq = store.seq;
    const r = this.rowAtY(y);
    let vTrack = 0, aTrack = 0;
    if (r) {
      if (r.type === 'caption') { vTrack = seq ? seq.tracks.video.length : 0; aTrack = 0; }
      else if (r.type === 'video') { vTrack = r.index; aTrack = Math.min(r.index, seq ? seq.tracks.audio.length : 0); }
      else { aTrack = r.index; vTrack = Math.min(r.index, seq ? seq.tracks.video.length - 1 : 0); }
    } else if (seq && this.layout && y + this.scrollY - this.videoOffset < 0) {
      vTrack = seq.tracks.video.length; // yeni iz
    }
    return { vTrack, aTrack, frame: Math.max(0, Math.round(this.xToFrame(x))) };
  }

  _onDragOver(e) {
    const kind = this._parseDrag(e);
    if (!kind) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const { x, y } = this._local(e);
    const seq = store.seq;
    if (kind === 'media' && seq) {
      const ids = app.dragMedia || [];
      const seqIds = (app.dragSeqs || []).filter((id) => store.project.sequences[id] && !sequenceContains(store.project, id, seq.id));
      const tg = this._dropTarget(x, y);
      let f = tg.frame;
      const ghost = [];
      let total = 0;
      const durs = ids.map((id) => {
        const m = store.project.media[id];
        if (!m) return 0;
        const { inSec: inS, outSec: outS } = mediaInOut(m);
        return m.type === 'image' ? Math.round((settings.stillDuration || 5) * seq.fps) : Math.max(1, Math.round((outS - inS) * seq.fps));
      });
      for (const sid of seqIds) {
        const ns = store.project.sequences[sid];
        durs.push(Math.max(1, Math.round((sequenceDuration(ns) / ns.fps) * seq.fps)));
      }
      total = durs.reduce((a, b) => a + b, 0);
      if (store.ui.snapping) {
        const pts = E.snapPoints(seq, null, [app.engine.currentFrame]);
        const thr = 10 / this.ppf;
        const a = E.nearestSnap(pts, f, thr), b = E.nearestSnap(pts, f + total, thr);
        if (a != null) { f = a; this.snapLine = a; } else if (b != null) { f = b - total; this.snapLine = b; } else this.snapLine = null;
      }
      let at = f;
      ids.forEach((id, i) => {
        const m = store.project.media[id];
        if (!m) return;
        const dt = app.dragTracks;
        if (m.hasVideo && (!dt || dt.video)) ghost.push({ type: 'video', track: tg.vTrack, start: at, duration: durs[i] });
        if (m.hasAudio && m.type !== 'image' && (!dt || dt.audio)) ghost.push({ type: 'audio', track: tg.aTrack, start: at, duration: durs[i] });
        at += durs[i];
      });
      seqIds.forEach((sid, j) => {
        const d = durs[ids.length + j];
        ghost.push({ type: 'video', track: tg.vTrack, start: at, duration: d });
        if (store.project.sequences[sid].tracks.audio.length) ghost.push({ type: 'audio', track: tg.aTrack, start: at, duration: d });
        at += d;
      });
      this.dropGhost = ghost;
      this._dropFrame = f;
      this._draw();
    }
  }

  async _onDrop(e) {
    e.preventDefault();
    const kind = this._parseDrag(e);
    const { x, y } = this._local(e);
    this.dropGhost = null;
    this.snapLine = null;
    const insert = e.ctrlKey;
    if (kind === 'files') {
      const paths = [...e.dataTransfer.files].map((f) => window.require('electron').webUtils ? window.require('electron').webUtils.getPathForFile(f) : f.path).filter(Boolean);
      const media = await importFiles(paths);
      if (media.length) this._placeMediaList(media.map((m) => m.id), x, y, insert, null);
      return;
    }
    if (kind === 'media') {
      const ids = JSON.parse(e.dataTransfer.getData('application/x-uli-media') || '[]');
      const seqIds = JSON.parse(e.dataTransfer.getData('application/x-uli-seqs') || '[]');
      this._placeMediaList(ids, x, y, insert, this._dropFrame, seqIds);
      return;
    }
    if (kind === 'effect') {
      const data = JSON.parse(e.dataTransfer.getData('application/x-uli-effect') || '{}');
      const h = this.hitTest(x, y);
      if (!h || !h.clip) return;
      if (data.kind === 'effect') {
        app.commands.applyEffect([h.clip.id], data.type);
      } else if (data.kind === 'preset') {
        applyPreset([h.clip.id], data.type);
      } else if (data.kind === 'anim') {
        applyClipAnim([h.clip.id], data.type);
      } else if (data.kind === 'transition') {
        const c = h.clip;
        const mid = c.start + c.duration / 2;
        const edge = h.frame < mid ? 'start' : 'end';
        app.commands.applyTransition(c.id, edge, data.type);
      }
    }
  }

  _placeMediaList(ids, x, y, insert, frame, seqIds = []) {
    const seqBefore = store.seq;
    const project = store.project;
    const medias = ids.map((id) => project.media[id]).filter(Boolean);
    if (!seqBefore && !medias.length && seqIds.length) {
      app.commands.openSequence(seqIds[0]);
      return;
    }
    const nests = seqBefore ? seqIds.filter((id) => project.sequences[id] && !sequenceContains(project, id, seqBefore.id)) : [];
    if (seqIds.length && nests.length < seqIds.length) toast(t('A sequence cannot be nested inside itself'), 'error');
    if (!medias.length && !nests.length) return;
    if (!seqBefore) {
      // ilk klipten sekans oluştur
      app.commands.newSequenceFromMedia(medias[0], () => this._placeMediaList(ids, x, y, insert, 0));
      return;
    }
    const tg = this._dropTarget(x, y);
    let at = frame != null ? frame : tg.frame;
    const placed = [];
    const dt = app.dragTracks;
    app.dragTracks = null;
    store.commit(insert ? 'Insert' : 'Overwrite', (p) => {
      const seq = p.sequences[p.activeSequenceId];
      for (const m of medias) {
        const ids2 = E.placeMedia(p, seq, m, {
          start: at, vTrack: !dt || dt.video ? tg.vTrack : null, aTrack: !dt || dt.audio ? tg.aTrack : null, mode: insert ? 'insert' : 'overwrite',
          ...mediaInOut(m), settings,
        });
        placed.push(...ids2);
        const c = seq.clips[ids2[0]];
        if (c) at = c.start + c.duration;
      }
      for (const sid of nests) {
        const ids2 = E.placeSequence(p, seq, p.sequences[sid], { start: at, vTrack: tg.vTrack, aTrack: tg.aTrack, mode: insert ? 'insert' : 'overwrite' });
        placed.push(...ids2);
        const c = seq.clips[ids2[0]];
        if (c) at = c.start + c.duration;
      }
    });
    store.select(placed);
  }
}
