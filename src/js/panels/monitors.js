// Program ve Kaynak monitörleri
import { store } from '../store.js';
import { app } from '../appContext.js';
import { t } from '../i18n.js';
import { el, framesToTC, parseTC, clamp, mediaUrl, rafThrottle } from '../util.js';
import { sequenceDuration, clipsOnTrack } from '../model.js';
import { evalParam, setParamAt, isAnimated, mapParamValues } from '../keyframes.js';
import { selectedMask, findMask } from '../masks.js';
import * as MG from '../maskGeom.js';
import { playbackUrl, rt, mediaEvents, mediaStatus, createProxy } from '../media.js';
import { videoLayersAt, itemsOfLayers } from '../renderGraph.js';
import { switchAngle } from '../multicam.js';
import { layerBounds, alignLayer } from '../graphics.js';
import { captionAt, captionBox, DEFAULT_CAPTION_STYLE } from '../captions.js';
import { renderTextCanvas } from '../text.js';
import * as E from '../editing.js';
import { settings, saveSettings } from '../settings.js';
import { contextMenu, toast } from '../ui/dialogs.js';

const I = {
  play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>',
  stepB: '<svg viewBox="0 0 16 16"><path d="M3 3h2v10H3zM13 3v10L6 8z"/></svg>',
  stepF: '<svg viewBox="0 0 16 16"><path d="M11 3h2v10h-2zM3 3v10l7-5z"/></svg>',
  markIn: '<svg viewBox="0 0 16 16"><path d="M5 2h6v2H7v8h4v2H5z"/></svg>',
  markOut: '<svg viewBox="0 0 16 16"><path d="M11 2H5v2h4v8H5v2h6z"/></svg>',
  goIn: '<svg viewBox="0 0 16 16"><path d="M2 3h2v10H2zM14 3v10L8 8zM9 3v10L3 8z" transform="translate(1 0)"/></svg>',
  goOut: '<svg viewBox="0 0 16 16"><path d="M12 3h2v10h-2zM2 3v10l6-5zM7 3v10l6-5z" transform="translate(-1 0)"/></svg>',
  lift: '<svg viewBox="0 0 16 16"><path d="M8 2l5 5H10v4H6V7H3zM3 13h10v1.5H3z"/></svg>',
  extract: '<svg viewBox="0 0 16 16"><path d="M8 2l5 5H10v4H6V7H3zM2 13h4v1.5H2zM10 13h4v1.5h-4z"/></svg>',
  insert: '<svg viewBox="0 0 16 16"><path d="M2 3h4v10H2zM10 3h4v10h-4zM8 4l2.5 4L8 12z" /></svg>',
  overwrite: '<svg viewBox="0 0 16 16"><path d="M2 3h12v10H2zm2 2v6h8V5z"/><path d="M8 5.5l2.5 2.5L8 10.5z"/></svg>',
  camera: '<svg viewBox="0 0 16 16"><path d="M2 5h3l1.5-2h3L11 5h3v8H2zm6 1.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"/></svg>',
  loop: '<svg viewBox="0 0 16 16"><path d="M4 5h7V3l3 3-3 3V7H5v2H3V6a1 1 0 011-1zM12 11H5v2l-3-3 3-3v2h6V7h2v3a1 1 0 01-1 1z"/></svg>',
  multicam: '<svg viewBox="0 0 16 16"><path d="M1 2h6v5H1zM9 2h6v5H9zM1 9h6v5H1zM9 9h6v5H9z" opacity=".85"/></svg>',
  compare: '<svg viewBox="0 0 16 16"><path d="M1 3h6v10H1zM9 3h6v10H9z" opacity=".5"/><path d="M7.25 1.5h1.5v13h-1.5z"/></svg>',
  safe: '<svg viewBox="0 0 16 16"><path d="M1 3h14v10H1zm1.5 1.5v7h11v-7zM4 6h8v4H4z" fill-rule="evenodd"/></svg>',
  proxy: '<svg viewBox="0 0 16 16"><path d="M2 2h8l4 4v8H2zm2 2v8h8V7H9V4z"/><path d="M5 9h6v1.5H5z"/></svg>',
  video: '<svg viewBox="0 0 16 16"><path d="M1 4h10v8H1zM12 7l3-2v6l-3-2z"/></svg>',
  audio: '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10L5 10H2zM11 5a4 4 0 010 6l-1-1a2.6 2.6 0 000-4z"/></svg>',
};

function iconBtn(svg, title, onClick) {
  const b = el('button', { class: 'icon', title, html: svg });
  b.addEventListener('click', onClick);
  return b;
}

function editableTC(elem, getFps, getFrame, setFrame) {
  elem.addEventListener('click', () => {
    const fps = getFps();
    if (!fps) return;
    const inp = el('input', { type: 'text', style: { width: '110px', fontFamily: 'var(--mono)', fontSize: '14px' } });
    inp.value = framesToTC(getFrame(), fps);
    elem.replaceWith(inp);
    inp.focus(); inp.select();
    let finished = false;
    const done = (apply) => {
      if (finished) return;
      finished = true;
      if (apply) { const f = parseTC(inp.value, fps, getFrame()); if (f != null) setFrame(f); }
      inp.replaceWith(elem);
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true));
  });
}

// Mini scrub çubuğu (in/out ve oynatma kafası)
class MiniBar {
  constructor(container, getState, onSeek) {
    this.wrap = el('div', { class: 'monitor-mini-tl' });
    this.cv = el('canvas');
    this.wrap.appendChild(this.cv);
    container.appendChild(this.wrap);
    this.getState = getState;
    const seek = (e) => {
      const r = this.wrap.getBoundingClientRect();
      const st = this.getState();
      if (!st || !st.total) return;
      onSeek(Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * (st.total - 1)));
    };
    this.wrap.addEventListener('mousedown', (e) => {
      seek(e);
      const mv = (ev) => seek(ev);
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
    });
  }
  draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
    if (!w) return;
    if (this.cv.width !== Math.round(w * dpr)) { this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr); }
    const ctx = this.cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const st = this.getState();
    if (!st || !st.total) return;
    const x = (f) => (f / Math.max(1, st.total - 1)) * w;
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, h / 2 - 1, w, 2);
    if (st.inF != null || st.outF != null) {
      ctx.fillStyle = 'rgba(45,140,235,0.45)';
      const a = x(st.inF ?? 0), b = x(st.outF ?? st.total);
      ctx.fillRect(a, 3, Math.max(2, b - a), h - 6);
    }
    if (st.markers) for (const m of st.markers) { ctx.fillStyle = m.color || '#4caf6a'; ctx.fillRect(x(m.frame) - 1, 2, 3, 6); }
    const px = x(st.frame);
    ctx.fillStyle = '#2d8ceb';
    ctx.beginPath(); ctx.moveTo(px - 5, 0); ctx.lineTo(px + 5, 0); ctx.lineTo(px, 8); ctx.closePath(); ctx.fill();
    ctx.fillRect(px - 0.5, 0, 1, h);
  }
}

// ===================== PROGRAM =====================
export class ProgramMonitor {
  constructor() {
    this.id = 'program';
    this.showSafe = false;
  }
  title() { return t('Program') + (store.seq ? ': ' + store.seq.name : ''); }

  mount(body) {
    const mon = el('div', { class: 'monitor' });
    this.view = el('div', { class: 'monitor-view' });
    this.canvas = el('canvas', { style: { left: '0', top: '0', width: '100%', height: '100%' } });
    this.view.appendChild(this.canvas);
    this.msg = el('div', { class: 'msg' });
    this.overlayMsg = el('div', { class: 'overlay-msg', style: { display: 'none' } });
    this.safe = el('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none' } });
    this.tbox = el('div', { class: 'transform-box', style: { display: 'none' } });
    this.maskSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.maskSvg.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none');
    const svgEl = () => { const g = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); g.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none'); return g; };
    this.guideSvg = svgEl(); // yapışma kılavuzları
    this.layerSvg = svgEl(); // seçili grafik katmanının kutusu
    this.view.append(this.msg, this.overlayMsg, this.safe, this.tbox, this.maskSvg, this.layerSvg, this.guideSvg);
    mon.appendChild(this.view);
    this.mini = new MiniBar(mon, () => {
      const s = store.seq;
      if (!s) return null;
      return { total: Math.max(sequenceDuration(s), 1), frame: app.engine.currentFrame, inF: s.inFrame, outF: s.outFrame, markers: s.markers };
    }, (f) => { if (app.engine.playing) app.engine.pause(); app.engine.setFrame(f); });
    const bar = el('div', { class: 'monitor-bar' });
    this.tc = el('div', { class: 'tc', title: t('Playhead position') });
    editableTC(this.tc, () => store.seq?.fps, () => app.engine.currentFrame, (f) => app.engine.setFrame(f));
    this.zoomSel = el('select', { title: t('Zoom Level') });
    for (const [v, l] of [['fit', t('Fit')], ['0.25', '25%'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.5', '150%'], ['2', '200%']]) this.zoomSel.appendChild(el('option', { value: v, text: l }));
    this.zoomSel.addEventListener('change', () => { app.engine.zoom = this.zoomSel.value === 'fit' ? 'fit' : +this.zoomSel.value; app.engine.requestRender(); });
    this.resSel = el('select', { title: t('Playback Resolution') });
    for (const [v, l] of [['auto', t('Auto')], ['full', t('Full')], ['half', '1/2'], ['quarter', '1/4']]) this.resSel.appendChild(el('option', { value: v, text: l }));
    this.resSel.value = store.ui.playbackRes;
    this.resSel.addEventListener('change', () => { store.ui.playbackRes = this.resSel.value; settings.playbackRes = this.resSel.value; saveSettings(); app.engine.requestRender(); });
    const C = (id) => () => app.commands.run(id);
    this.playBtn = iconBtn(I.play, t('Play/Stop') + ' (Space)', () => app.engine.toggle());
    this.loopBtn = iconBtn(I.loop, t('Loop Playback'), C('play.loop'));
    this.safeBtn = iconBtn(I.safe, t('Safe Margins'), () => { this.showSafe = !this.showSafe; this.updateButtons(); this.updateOverlay(); });
    this.proxyBtn = iconBtn(I.proxy, t('Toggle Proxies'), C('clip.toggleProxies'));
    this.compareBtn = iconBtn(I.compare, t('Before/After Comparison'), () => { store.ui.compare = !store.ui.compare; this.updateButtons(); app.engine.requestRender(); });
    this.cmpLabels = el('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none', display: 'none' } },
      el('div', { class: 'overlay-msg', style: { left: '12px', top: '10px', color: '#ddd' }, text: t('Before') }),
      el('div', { class: 'overlay-msg', style: { left: 'auto', right: '12px', top: '10px', color: '#ddd' }, text: t('After') }));
    this.view.appendChild(this.cmpLabels);
    this.mcBtn = iconBtn(I.multicam, t('Multi-Camera View') + ' (Shift+0)', C('multicam.view'));
    this.mcLayer = el('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none' } });
    this.view.appendChild(this.mcLayer);
    const grow = el('div', { class: 'grow' },
      iconBtn(I.markIn, t('Mark In') + ' (I)', C('mark.in')),
      iconBtn(I.markOut, t('Mark Out') + ' (O)', C('mark.out')),
      iconBtn(I.goIn, t('Go to In') + ' (Shift+I)', C('mark.goIn')),
      iconBtn(I.stepB, t('Step Back') + ' (Left)', C('play.stepBack')),
      this.playBtn,
      iconBtn(I.stepF, t('Step Forward') + ' (Right)', C('play.stepFwd')),
      iconBtn(I.goOut, t('Go to Out') + ' (Shift+O)', C('mark.goOut')),
      iconBtn(I.lift, t('Lift') + ' (;)', C('sequence.lift')),
      iconBtn(I.extract, t('Extract') + " (')", C('sequence.extract')),
      iconBtn(I.camera, t('Export Frame') + ' (Ctrl+Shift+E)', C('file.exportFrame')),
      this.loopBtn, this.safeBtn, this.proxyBtn, this.compareBtn, this.mcBtn,
    );
    this.dur = el('div', { class: 'tc dur', title: t('Sequence duration') });
    bar.append(this.tc, this.zoomSel, grow, this.resSel, this.dur);
    mon.appendChild(bar);
    body.appendChild(mon);
    this._bindView();
    app.program = this;
    this.updateButtons();
  }

  initEngine(engine) {
    this.engine = engine;
    engine.on('frame', rafThrottle(() => this.updateTime()));
    engine.on('state', (p) => { this.playBtn.innerHTML = p ? I.pause : I.play; this.updateOverlay(); });
    engine.on('rendered', (r) => this._afterRender(r));
    store.on('change', () => { this.updateTime(); engine.requestRender(); this.group?.renderTabs(); });
    store.on('selection', () => this.updateOverlay());
    mediaEvents.on('update', () => engine.requestRender());
    mediaEvents.on('proxyReady', () => { engine.refreshHandles(); engine.requestRender(); });
    mediaEvents.on('imageReady', () => engine.requestRender());
  }

  updateButtons() {
    this.loopBtn?.classList.toggle('active', !!store.ui.loop);
    this.safeBtn?.classList.toggle('active', !!this.showSafe);
    this.proxyBtn?.classList.toggle('active', !!store.ui.useProxies);
    this.compareBtn?.classList.toggle('active', !!store.ui.compare);
    this.mcBtn?.classList.toggle('active', !!store.ui.multicamView);
    if (this.cmpLabels) this.cmpLabels.style.display = store.ui.compare ? 'block' : 'none';
  }

  onResize() {
    if (!this.engine) return;
    const r = this.view.getBoundingClientRect();
    this.engine.viewSize = { w: r.width, h: r.height };
    this.engine.requestRender();
    this.mini.draw();
  }
  onShow() { this.onResize(); }

  updateTime() {
    const s = store.seq;
    this.tc.textContent = s ? framesToTC(app.engine.currentFrame, s.fps) : '00:00:00:00';
    this.dur.textContent = s ? framesToTC(s.inFrame != null || s.outFrame != null ? (s.outFrame ?? sequenceDuration(s)) - (s.inFrame ?? 0) : sequenceDuration(s), s.fps) : '';
    this.mini.draw();
    app.timeline?.updatePlayhead();
  }

  _afterRender(r) {
    const s = store.seq;
    this.msg.textContent = s ? '' : t('No sequence');
    // eksik medya uyarısı
    if (s && r.missing) {
      const layers = videoLayersAt(store.project, s, r.frame);
      const items = itemsOfLayers(layers).filter((it) => it.media);
      let txt = '';
      for (const it of items) {
        const st = mediaStatus(it.media);
        if (st === 'offline') { txt = t('Media Offline') + ': ' + it.media.name; break; }
        if (st === 'proxy') { txt = t('Creating proxy...') + ' ' + Math.round((rt(it.media.id).proxyProgress || 0) * 100) + '%'; break; }
        if (st === 'unsupported') { txt = t('Unsupported format, proxy needed') + ': ' + it.media.name; break; }
      }
      this.overlayMsg.textContent = txt;
      this.overlayMsg.style.display = txt ? 'block' : 'none';
    } else this.overlayMsg.style.display = 'none';
    this.updateOverlay();
  }

  // Seçili klibin dönüşüm kutusu
  _selectedVideoClip() {
    const sel = store.selectedClips().filter((c) => c.type === 'video');
    if (sel.length !== 1) return null;
    const c = sel[0];
    const f = app.engine.currentFrame;
    if (f < c.start || f >= c.start + c.duration) return null;
    if (c.kind === 'adjustment') return null;
    return c;
  }

  _clipNative(c) {
    if (c.kind === 'text') {
      const tc = app.compositor.textCache.get(c.id);
      return tc ? [tc.canvas.width, tc.canvas.height] : [400, 100];
    }
    if (c.kind === 'color' || c.kind === 'graphic') return [store.seq.width, store.seq.height];
    if (c.kind === 'sequence') { const ns = store.project.sequences[c.seqId]; return ns ? [ns.width, ns.height] : [store.seq.width, store.seq.height]; }
    const m = store.project.media[c.mediaId];
    return m ? [m.width || store.seq.width, m.height || store.seq.height] : [store.seq.width, store.seq.height];
  }

  _clipCorners(c) {
    const f = app.engine.currentFrame - c.start;
    const [sw, sh] = this._clipNative(c);
    const P = c.props;
    const pos = evalParam(P.position, f) || [store.seq.width / 2, store.seq.height / 2];
    const anchor = evalParam(P.anchor, f) || [sw / 2, sh / 2];
    const sc = (evalParam(P.scale, f) ?? 100) / 100;
    const scw = P.uniformScale === false ? (evalParam(P.scaleWidth, f) ?? 100) / 100 : sc;
    const rot = ((evalParam(P.rotation, f) || 0) * Math.PI) / 180;
    const pts = [[0, 0], [sw, 0], [sw, sh], [0, sh]].map(([x, y]) => {
      const qx = (x - anchor[0]) * scw, qy = (y - anchor[1]) * sc;
      return [pos[0] + qx * Math.cos(rot) - qy * Math.sin(rot), pos[1] + qx * Math.sin(rot) + qy * Math.cos(rot)];
    });
    return { pts, pos, sc, scw, rot };
  }

  // Multicam ızgarası: açı etiketleri, etkin açı çerçevesi (oynarken kırmızı), tıklayınca açı değiştir
  _drawMulticam(r) {
    const g = app.engine?.multicam;
    this.mcLayer.innerHTML = '';
    if (!g || !r || !store.seq) return false;
    const s = store.seq;
    const k = r.w / s.width;
    const active = g.clip.multicam.angle;
    const live = app.engine.playing;
    g.cells.forEach((cell, i) => {
      const on = i === active;
      const box = el('div', { style: {
        position: 'absolute', left: r.x + cell.x * k + 'px', top: r.y + cell.y * k + 'px', width: cell.w * k + 'px', height: cell.h * k + 'px',
        boxSizing: 'border-box', border: on ? `3px solid ${live ? '#e04848' : '#e8c547'}` : '1px solid rgba(255,255,255,0.15)', pointerEvents: 'auto', cursor: 'pointer',
      } }, el('div', { text: `${i + 1}  ${g.nested.multicam.cameras[i]?.name || ''}`, style: {
        position: 'absolute', left: '4px', top: '3px', fontSize: '11px', padding: '1px 5px', borderRadius: '3px', background: 'rgba(0,0,0,0.6)', color: on ? '#ffe680' : '#ddd', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: 'calc(100% - 12px)',
      } }));
      box.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); switchAngle(i); });
      this.mcLayer.appendChild(box);
    });
    const pg = g.program;
    this.mcLayer.appendChild(el('div', { style: { position: 'absolute', left: r.x + pg.x * k + 'px', top: r.y + pg.y * k + 'px', width: pg.w * k + 'px', height: pg.h * k + 'px', boxSizing: 'border-box', border: '1px solid rgba(255,255,255,0.25)' } },
      el('div', { text: t('Program'), style: { position: 'absolute', left: '4px', top: '3px', fontSize: '11px', padding: '1px 5px', borderRadius: '3px', background: 'rgba(0,0,0,0.6)', color: '#ddd' } })));
    return true;
  }

  updateOverlay() {
    const s = store.seq;
    // güvenli kenarlar
    this.safe.innerHTML = '';
    const r = app.engine?.displayRect;
    if (s && r && this.showSafe) {
      for (const k of [0.9, 0.8]) {
        this.safe.appendChild(el('div', { class: 'safe-margins', style: { left: r.x + (r.w * (1 - k)) / 2 + 'px', top: r.y + (r.h * (1 - k)) / 2 + 'px', width: r.w * k + 'px', height: r.h * k + 'px' } }));
      }
    }
    if (this._drawMulticam(r)) { this.tbox.style.display = 'none'; return; }
    const maskShown = this._drawMaskOverlay();
    const c = s && !app.engine.playing && !maskShown ? this._selectedVideoClip() : null;
    if (r) this._drawLayerBox(c); else this._drawLayerBox(null);
    if (!c || !r) { this.tbox.style.display = 'none'; return; }
    const { pts } = this._clipCorners(c);
    const v = pts.map(([x, y]) => app.engine.seqToView(x, y));
    // döndürülmüş kutuyu SVG yerine 4 köşe + çerçeve ile çiz
    this.tbox.style.display = 'block';
    this.tbox.style.left = '0'; this.tbox.style.top = '0'; this.tbox.style.width = '0'; this.tbox.style.height = '0'; this.tbox.style.border = 'none';
    this.tbox.innerHTML = '';
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('style', `position:absolute;left:0;top:0;width:${this.view.clientWidth}px;height:${this.view.clientHeight}px;overflow:visible;pointer-events:none`);
    const poly = document.createElementNS(svgNS, 'polygon');
    poly.setAttribute('points', v.map((p) => p.join(',')).join(' '));
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', '#4ea3ff');
    poly.setAttribute('stroke-width', '1');
    svg.appendChild(poly);
    this.tbox.appendChild(svg);
    v.forEach((p, i) => {
      const hd = el('div', { class: 'h', style: { left: p[0] + 'px', top: p[1] + 'px', cursor: i % 2 ? 'nesw-resize' : 'nwse-resize' } });
      hd.dataset.corner = i;
      this.tbox.appendChild(hd);
    });
    const cen = app.engine.seqToView(...this._clipCorners(c).pos);
    const ch = el('div', { style: { position: 'absolute', left: cen[0] - 6 + 'px', top: cen[1] - 6 + 'px', width: '12px', height: '12px', border: '1px solid #4ea3ff', borderRadius: '50%', pointerEvents: 'none' } });
    this.tbox.appendChild(ch);
  }

  _bindView() {
    this.view.addEventListener('mousedown', (e) => this._onDown(e));
    this.view.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, [
        { label: t('Fit'), action: () => { this.zoomSel.value = 'fit'; this.zoomSel.dispatchEvent(new Event('change')); } },
        { label: t('Playback Resolution'), submenu: [['auto', t('Auto')], ['full', t('Full')], ['half', '1/2'], ['quarter', '1/4']].map(([v, l]) => ({ label: l, checked: store.ui.playbackRes === v, action: () => { this.resSel.value = v; this.resSel.dispatchEvent(new Event('change')); } })) },
        '-',
        { label: t('Safe Margins'), checked: this.showSafe, action: () => { this.showSafe = !this.showSafe; this.updateButtons(); this.updateOverlay(); } },
        { label: t('Loop Playback'), checked: store.ui.loop, action: () => app.commands.run('play.loop') },
        { label: t('Toggle Proxies'), checked: store.ui.useProxies, action: () => app.commands.run('clip.toggleProxies') },
        '-',
        { label: t('Export Frame...'), action: () => app.commands.run('file.exportFrame') },
      ]);
    });
    this.view.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (app.engine.playing) app.engine.pause();
      app.engine.setFrame(app.engine.currentFrame + (e.deltaY > 0 ? 1 : -1) * (e.shiftKey ? 5 : 1));
    }, { passive: false });
    // medya sürükle-bırak: programa bırakılınca overwrite
    this.view.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-uli-media')) { e.preventDefault(); this.view.classList.add('drop-highlight'); } });
    this.view.addEventListener('dragleave', () => this.view.classList.remove('drop-highlight'));
    this.view.addEventListener('drop', (e) => {
      this.view.classList.remove('drop-highlight');
      const ids = JSON.parse(e.dataTransfer.getData('application/x-uli-media') || '[]');
      if (!ids.length) return;
      e.preventDefault();
      store.ui.sourceMediaId = ids[0];
      app.source.openMedia(ids[0]);
      app.commands.run(e.ctrlKey ? 'clip.insert' : 'clip.overwrite');
    });
  }

  _onDown(e) {
    if (e.button !== 0) return;
    const s = store.seq;
    if (!s) return;
    const r = this.view.getBoundingClientRect();
    const vx = e.clientX - r.left, vy = e.clientY - r.top;
    const sp = app.engine.viewToSeq(vx, vy);
    if (!sp) return;
    if (store.ui.tool === 'type') { this.addText(sp); store.setTool('select'); return; }
    if (app.engine.playing) return;
    if (this._maskDown(e, vx, vy)) return;
    if (this._captionDown(e, sp, r)) return;
    let c = this._selectedVideoClip();
    const corner = e.target.dataset && e.target.dataset.corner != null ? +e.target.dataset.corner : null;
    // seçili değilse tıklanan noktadaki en üst klibi seç
    if (corner == null) {
      const hit = this._hitClip(sp);
      if (hit && (!c || hit.id !== c.id)) {
        store.select(store.ui.linkedSelection ? E.expandLinked(s, [hit.id]) : [hit.id]);
        c = hit;
      } else if (!hit && !c) { return; }
      if (c && !this._pointInClip(c, sp) && !hit) return;
    }
    if (!c) return;
    if (c.kind === 'graphic' && corner == null && this._layerDown(e, c, sp, r)) return;
    const f = app.engine.currentFrame - c.start;
    const startPos = evalParam(c.props.position, f) || [s.width / 2, s.height / 2];
    const box0 = this._bbox(this._clipCorners(c).pts);
    const startScale = evalParam(c.props.scale, f) ?? 100;
    const startScaleW = evalParam(c.props.scaleWidth, f) ?? 100;
    const { pos } = this._clipCorners(c);
    const d0 = Math.hypot(sp[0] - pos[0], sp[1] - pos[1]) || 1;
    const clipId = c.id;
    let begun = false;
    const mv = (ev) => {
      const p = app.engine.viewToSeq(ev.clientX - r.left, ev.clientY - r.top);
      if (!p) return;
      if (!begun) { store.begin(corner != null ? 'Scale' : 'Position'); begun = true; }
      store.live((pr) => {
        const cc = pr.sequences[pr.activeSequenceId].clips[clipId];
        if (!cc) return;
        if (corner != null) {
          const d = Math.hypot(p[0] - pos[0], p[1] - pos[1]);
          const k = d / d0;
          setParamAt(cc.props.scale, f, Math.max(0, Math.round(startScale * k * 10) / 10));
          if (cc.props.uniformScale === false) setParamAt(cc.props.scaleWidth, f, Math.max(0, Math.round(startScaleW * k * 10) / 10));
        } else {
          let nx = startPos[0] + (p[0] - sp[0]), ny = startPos[1] + (p[1] - sp[1]);
          if (ev.shiftKey) { if (Math.abs(p[0] - sp[0]) > Math.abs(p[1] - sp[1])) ny = startPos[1]; else nx = startPos[0]; }
          // kare ortasına / kenarlarına yapış (Ctrl basılıyken kapalı)
          const sn = ev.ctrlKey ? null : this._snap(box0, nx - startPos[0], ny - startPos[1], [0, 0, s.width, s.height]);
          if (sn) { nx += sn.dx; ny += sn.dy; }
          this._drawGuides(sn, (x, y) => [x, y]);
          setParamAt(cc.props.position, f, [Math.round(nx * 10) / 10, Math.round(ny * 10) / 10]);
        }
      });
      app.engine.requestRender();
    };
    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      this._drawGuides(null);
      if (begun) store.end();
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  }

  _bbox(pts) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }

  // Kutunun (dx, dy kadar taşınmış hali) kenar/merkezini karenin kenar/merkezine yapıştır. frame: [x0, y0, x1, y1]
  _snap(box, dx, dy, frame) {
    const r = app.engine?.displayRect, s = store.seq;
    if (!r || !s) return null;
    const thr = (8 * s.width) / r.w;
    const pick = (a0, a1, f0, f1) => {
      const ts = [f0, (f0 + f1) / 2, f1], cs = [a0, (a0 + a1) / 2, a1];
      let best = null;
      for (const tv of ts) for (const cv of cs) { const d = tv - cv; if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: tv }; }
      return best;
    };
    const bx = pick(box.x0 + dx, box.x1 + dx, frame[0], frame[2]);
    const by = pick(box.y0 + dy, box.y1 + dy, frame[1], frame[3]);
    if (!bx && !by) return null;
    return { dx: bx ? bx.d : 0, dy: by ? by.d : 0, gx: bx ? bx.at : null, gy: by ? by.at : null };
  }

  // Yapışma kılavuz çizgileri. toSeq: kılavuz koordinatını sekans koordinatına çevirir
  _drawGuides(sn, toSeq) {
    const g = this.guideSvg;
    while (g.firstChild) g.firstChild.remove();
    const s = store.seq;
    if (!sn || !s) return;
    const line = (x1, y1, x2, y2) => {
      const a = app.engine.seqToView(x1, y1), b = app.engine.seqToView(x2, y2);
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', a[0]); l.setAttribute('y1', a[1]); l.setAttribute('x2', b[0]); l.setAttribute('y2', b[1]);
      l.setAttribute('stroke', '#ff3df2'); l.setAttribute('stroke-width', '1'); l.setAttribute('stroke-dasharray', '5 3');
      g.appendChild(l);
    };
    if (sn.gx != null) { const [x] = toSeq(sn.gx, 0); line(x, 0, x, s.height); }
    if (sn.gy != null) { const [, y] = toSeq(0, sn.gy); line(0, y, s.width, y); }
  }

  // Grafik klibi: sekans noktası <-> grafik (katman) koordinatı (bağlantı noktası merkezde varsayılır, döndürme yok)
  _gfxMap(c) {
    const s = store.seq;
    const { pos, sc, scw } = this._clipCorners(c);
    return {
      toG: (x, y) => [(x - pos[0]) / (scw || 1) + s.width / 2, (y - pos[1]) / (sc || 1) + s.height / 2],
      toS: (x, y) => [pos[0] + (x - s.width / 2) * scw, pos[1] + (y - s.height / 2) * sc],
    };
  }

  // Program monitöründe grafik katmanını tıklayıp sürükleme (Temel Grafikler'deki gibi). Katmana denk gelmezse false
  _layerDown(e, c, sp, r) {
    const s = store.seq;
    const layers = c.graphic?.layers || [];
    const M = this._gfxMap(c);
    const [gx, gy] = M.toG(sp[0], sp[1]);
    const pad = (6 * s.width) / (app.engine.displayRect?.w || s.width);
    let hit = null;
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i];
      if (L.hidden) continue;
      const b = layerBounds(L);
      if (b.w >= s.width * 0.98 && b.h >= s.height * 0.98) continue; // tam kare arka planlar
      if (gx >= b.x - pad && gx <= b.x + b.w + pad && gy >= b.y - pad && gy <= b.y + b.h + pad) { hit = L; break; }
    }
    if (!hit) return false;
    const G = app.graphics;
    if (G) { G.selLayer = hit.id; G.tab = 'edit'; G.render(); }
    const layerId = hit.id, clipId = c.id;
    const b0 = layerBounds(hit);
    const box0 = { x0: b0.x, y0: b0.y, x1: b0.x + b0.w, y1: b0.y + b0.h };
    const x0 = hit.x, y0 = hit.y;
    let begun = false;
    const mv = (ev) => {
      const p = app.engine.viewToSeq(ev.clientX - r.left, ev.clientY - r.top);
      if (!p) return;
      const [px, py] = M.toG(p[0], p[1]);
      let dx = px - gx, dy = py - gy;
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const sn = ev.ctrlKey ? null : this._snap(box0, dx, dy, [0, 0, s.width, s.height]);
      if (sn) { dx += sn.dx; dy += sn.dy; }
      if (!begun) { store.begin('Move Layer'); begun = true; }
      store.live((pr) => {
        const L = pr.sequences[pr.activeSequenceId].clips[clipId]?.graphic?.layers.find((x) => x.id === layerId);
        if (L) { L.x = Math.round((x0 + dx) * 10) / 10; L.y = Math.round((y0 + dy) * 10) / 10; }
      });
      this._drawGuides(sn, M.toS);
      app.engine.requestRender();
    };
    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      this._drawGuides(null);
      if (begun) store.end();
      G?.render();
      this.updateOverlay();
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    return true;
  }

  // Altyazıyı Program monitöründe sürükle: konum sekansın tüm altyazılarına uygulanır (yatay % ve alttan %)
  _captionDown(e, sp, r) {
    const s = store.seq;
    if (!s || s.captionsVisible === false) return false;
    const f = app.engine.currentFrame;
    const cap = captionAt(s, f);
    if (!cap || !cap.text) return false;
    const measure = (txt) => { const cv = renderTextCanvas(txt); return { w: cv.width, h: cv.height }; };
    const box0 = captionBox(s, cap, f, measure);
    const pad = (8 * s.width) / (app.engine.displayRect?.w || s.width);
    if (sp[0] < box0.x0 - pad || sp[0] > box0.x1 + pad || sp[1] < box0.y0 - pad || sp[1] > box0.y1 + pad) return false;
    e.preventDefault();
    const cx0 = (box0.x0 + box0.x1) / 2, by0 = box0.y1;
    let begun = false;
    this._openCaptionStyle(cap.id);
    const mv = (ev) => {
      const p = app.engine.viewToSeq(ev.clientX - r.left, ev.clientY - r.top);
      if (!p) return;
      let dx = p[0] - sp[0], dy = p[1] - sp[1];
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const sn = ev.ctrlKey ? null : this._snap(box0, dx, dy, [0, 0, s.width, s.height]);
      if (sn) { dx += sn.dx; dy += sn.dy; }
      if (!begun) { store.begin('Move Captions'); begun = true; }
      const x = clamp(((cx0 + dx) / s.width) * 100, 0, 100);
      const margin = clamp((1 - (by0 + dy) / s.height) * 100, 0, 95);
      store.live((pr) => {
        const q = pr.sequences[pr.activeSequenceId];
        q.captionStyle = { ...DEFAULT_CAPTION_STYLE, ...(q.captionStyle || {}), x: Math.round(x * 10) / 10, margin: Math.round(margin * 10) / 10 };
      });
      this._drawGuides(sn, (gx, gy) => [gx, gy]);
      app.engine.requestRender();
    };
    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      this._drawGuides(null);
      if (begun) {
        store.end();
        settings.captionStyleDefault = { ...(store.seq.captionStyle || {}) };
        saveSettings();
      }
      app.captionsPanel?.render?.();
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    return true;
  }

  // Altyazıya tıklanınca Altyazılar panelini stil ayarları açık olarak göster
  _openCaptionStyle(capId) {
    try {
      app.commands.showPanel('captions');
      const P = app.captionsPanel;
      if (P) { P.showStyle = true; P.focusCaption = capId; P.render(); }
    } catch (e) { /* */ }
  }

  // Klibi kareye hizala (Efekt Kontrolleri'ndeki hizalama düğmeleri)
  alignClip(clipId, mode) {
    const s = store.seq;
    const c = s?.clips[clipId];
    if (!c) return;
    const f = clamp(app.engine.currentFrame - c.start, 0, c.duration - 1);
    const b = this._bbox(this._clipCorners(c).pts);
    const d = { left: [-b.x0, 0], hcenter: [s.width / 2 - (b.x0 + b.x1) / 2, 0], right: [s.width - b.x1, 0], top: [0, -b.y0], vcenter: [0, s.height / 2 - (b.y0 + b.y1) / 2], bottom: [0, s.height - b.y1] }[mode];
    if (!d) return;
    store.commit('Align', (pr) => {
      const cc = pr.sequences[pr.activeSequenceId].clips[clipId];
      const pos = evalParam(cc.props.position, f) || [s.width / 2, s.height / 2];
      setParamAt(cc.props.position, f, [Math.round((pos[0] + d[0]) * 10) / 10, Math.round((pos[1] + d[1]) * 10) / 10]);
    });
    app.engine.requestRender();
  }

  // Seçili grafik katmanının kesikli kutusu
  _drawLayerBox(c) {
    const g = this.layerSvg;
    while (g.firstChild) g.firstChild.remove();
    if (!c || c.kind !== 'graphic' || !app.graphics?.selLayer) return;
    const L = c.graphic?.layers.find((x) => x.id === app.graphics.selLayer);
    if (!L || L.hidden) return;
    const M = this._gfxMap(c);
    const b = layerBounds(L);
    const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => app.engine.seqToView(...M.toS(x, y)));
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
    poly.setAttribute('fill', 'none'); poly.setAttribute('stroke', '#e8c547'); poly.setAttribute('stroke-width', '1'); poly.setAttribute('stroke-dasharray', '4 3');
    g.appendChild(poly);
  }

  // ---- Maskeler ----
  // Kaynak (klip) koordinatı <-> sekans koordinatı dönüşümü
  _xf(c, f) {
    if (c.kind === 'adjustment') return { toSeq: (x, y) => [x, y], toSrc: (x, y) => [x, y] };
    const [sw, sh] = this._clipNative(c);
    const P = c.props;
    const pos = evalParam(P.position, f) || [store.seq.width / 2, store.seq.height / 2];
    const anchor = evalParam(P.anchor, f) || [sw / 2, sh / 2];
    const sc = (evalParam(P.scale, f) ?? 100) / 100 || 1e-6;
    const scw = (P.uniformScale === false ? (evalParam(P.scaleWidth, f) ?? 100) / 100 : sc) || 1e-6;
    const rot = ((evalParam(P.rotation, f) || 0) * Math.PI) / 180;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    return {
      toSeq: (x, y) => { const qx = (x - anchor[0]) * scw, qy = (y - anchor[1]) * sc; return [pos[0] + qx * cos - qy * sin, pos[1] + qx * sin + qy * cos]; },
      toSrc: (X, Y) => { const dx = X - pos[0], dy = Y - pos[1]; const qx = dx * cos + dy * sin, qy = -dx * sin + dy * cos; return [anchor[0] + qx / scw, anchor[1] + qy / sc]; },
    };
  }

  _activeMask() {
    const sel = selectedMask();
    if (!sel || app.engine.playing) return null;
    const f = app.engine.currentFrame;
    const c = sel.clip;
    if (f < c.start || f >= c.start + c.duration) return null;
    const local = f - c.start;
    const xf = this._xf(c, local);
    const type = sel.mask.type;
    const path = evalParam(sel.mask.path, local) || [];
    const view = (x, y) => app.engine.seqToView(...xf.toSeq(x, y));
    const outline = MG.flatten(type, path, 24).map(([x, y]) => view(x, y));
    const handles = [];
    if (type === 'ellipse' && path.length >= 4) {
      const [x, y, w, h] = path;
      handles.push({ kind: 'e', id: 'l', p: view(x, y + h / 2) }, { kind: 'e', id: 'r', p: view(x + w, y + h / 2) }, { kind: 'e', id: 't', p: view(x + w / 2, y) }, { kind: 'e', id: 'b', p: view(x + w / 2, y + h) });
    } else {
      MG.vertices(type, path).forEach((v, i) => {
        const vp = view(v.x, v.y);
        if (type === 'bezier') {
          if (v.ix || v.iy) handles.push({ kind: 'in', idx: i, p: view(v.x + v.ix, v.y + v.iy), base: vp });
          if (v.ox || v.oy) handles.push({ kind: 'out', idx: i, p: view(v.x + v.ox, v.y + v.oy), base: vp });
        }
        handles.push({ kind: 'v', idx: i, p: vp });
      });
    }
    const pen = !!(store.ui.maskPen && store.ui.maskPen.maskId === sel.mask.id);
    return { ...sel, type, local, xf, path, outline, handles, pen, verts: MG.vertices(type, path) };
  }

  _drawMaskOverlay() {
    const svg = this.maskSvg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const m = app.engine?.displayRect ? this._activeMask() : null;
    if (!m) return false;
    const NS = 'http://www.w3.org/2000/svg';
    const mk = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); svg.appendChild(n); return n; };
    if (m.outline.length >= 2) {
      mk(m.pen ? 'polyline' : 'polygon', { points: m.outline.map((p) => p.join(',')).join(' '), fill: 'rgba(255,200,40,0.06)', stroke: '#ffcc33', 'stroke-width': '1.5' });
    }
    for (const h of m.handles) {
      if (h.kind === 'in' || h.kind === 'out') {
        mk('line', { x1: h.base[0], y1: h.base[1], x2: h.p[0], y2: h.p[1], stroke: 'rgba(255,204,51,0.7)', 'stroke-width': '1' });
        mk('circle', { cx: h.p[0], cy: h.p[1], r: 3.5, fill: '#1a1a1a', stroke: '#ffcc33', 'stroke-width': '1.3' });
      }
    }
    for (const h of m.handles) {
      if (h.kind !== 'v' && h.kind !== 'e') continue;
      const first = m.pen && h.kind === 'v' && h.idx === 0 && m.verts.length >= 3;
      mk('rect', { x: h.p[0] - 4, y: h.p[1] - 4, width: 8, height: 8, fill: first ? '#ffcc33' : '#1a1a1a', stroke: '#ffcc33', 'stroke-width': '1.5' });
    }
    return true;
  }

  _maskDown(e, vx, vy) {
    const m = this._activeMask();
    if (!m) return false;
    const rect = this.view.getBoundingClientRect();
    const toSrc = (cx, cy) => { const sp = app.engine.viewToSeq(cx, cy); return sp ? m.xf.toSrc(sp[0], sp[1]) : null; };
    const src = toSrc(vx, vy);
    const clipId = m.clip.id, owner = m.owner, maskId = m.mask.id, local = m.local;
    const r1 = (v) => Math.round(v * 10) / 10;
    const withMask = (pr, fn) => { const mm = findMask(pr.sequences[pr.activeSequenceId].clips[clipId], owner, maskId); if (mm) fn(mm); };
    const st = m.type === 'bezier' ? 6 : 2;
    // sürükleme yardımcı: fn(curSrc, ev) -> yeni path; label: geri alma adı
    const drag = (label, fn, onClick) => {
      let begun = false;
      const mv = (ev) => {
        const cur = toSrc(ev.clientX - rect.left, ev.clientY - rect.top);
        if (!cur) return;
        if (!begun) {
          if (Math.hypot(ev.clientX - rect.left - vx, ev.clientY - rect.top - vy) < 2) return;
          store.begin(label);
          begun = true;
        }
        store.live((pr) => withMask(pr, (mm) => { const next = fn(cur, ev, mm); if (next) setParamAt(mm.path, local, next.map(r1)); }));
        app.engine.requestRender();
      };
      const up = () => {
        window.removeEventListener('mousemove', mv);
        window.removeEventListener('mouseup', up);
        if (begun) store.end();
        else if (onClick) onClick();
      };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
    };

    // kalem: tıkla = köşe, tıkla-sürükle = eğri noktası; ilk noktaya tıkla = kapat
    if (m.pen) {
      if (m.verts.length >= 3) {
        const p0 = m.handles.find((h) => h.kind === 'v' && h.idx === 0).p;
        if (Math.hypot(p0[0] - vx, p0[1] - vy) <= 8) {
          store.ui.maskPen = null;
          store.emit('selection');
          app.engine.requestRender();
          this.updateOverlay();
          return true;
        }
      }
      store.begin('Add Mask Point');
      store.live((pr) => withMask(pr, (mm) => mapParamValues(mm.path, (v) => [...(v || []), r1(src[0]), r1(src[1]), ...(mm.type === 'bezier' ? [0, 0, 0, 0] : [])])));
      app.engine.requestRender();
      const idx = m.verts.length;
      const mv = (ev) => {
        const cur = toSrc(ev.clientX - rect.left, ev.clientY - rect.top);
        if (!cur || m.type !== 'bezier') return;
        store.live((pr) => withMask(pr, (mm) => {
          const p = [...evalParam(mm.path, local)];
          const dx = cur[0] - src[0], dy = cur[1] - src[1];
          p[idx * 6 + 2] = r1(-dx); p[idx * 6 + 3] = r1(-dy); p[idx * 6 + 4] = r1(dx); p[idx * 6 + 5] = r1(dy);
          setParamAt(mm.path, local, p);
        }));
        app.engine.requestRender();
      };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); store.end(); };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
      return true;
    }

    const near = (h) => Math.hypot(h.p[0] - vx, h.p[1] - vy) <= 7;
    const hit = m.handles.filter((h) => h.kind === 'in' || h.kind === 'out').find(near) || m.handles.find((h) => (h.kind === 'v' || h.kind === 'e') && near(h));

    // teğet tutamağı
    if (hit && (hit.kind === 'in' || hit.kind === 'out')) {
      const i = hit.idx;
      drag('Mask Path', (cur, ev, mm) => {
        const p = [...evalParam(mm.path, local)];
        const dx = cur[0] - p[i * 6], dy = cur[1] - p[i * 6 + 1];
        const a = hit.kind === 'out' ? 4 : 2, b = hit.kind === 'out' ? 2 : 4;
        p[i * 6 + a] = dx; p[i * 6 + a + 1] = dy;
        if (!ev.altKey) {
          // yumuşak nokta: karşı tutamak aynı doğrultuda, kendi uzunluğunu korur
          const L = Math.hypot(p[i * 6 + b], p[i * 6 + b + 1]) || Math.hypot(dx, dy);
          const d = Math.hypot(dx, dy) || 1;
          p[i * 6 + b] = (-dx / d) * L; p[i * 6 + b + 1] = (-dy / d) * L;
        }
        return p;
      });
      return true;
    }
    if (hit && hit.kind === 'v') {
      const i = hit.idx;
      // Ctrl+tık: noktayı sil
      if (e.ctrlKey) {
        if (m.verts.length > 3) store.commit('Delete Mask Point', (pr) => withMask(pr, (mm) => { const s2 = mm.type === 'bezier' ? 6 : 2; mapParamValues(mm.path, (v) => v.filter((_, j) => Math.floor(j / s2) !== i)); }));
        return true;
      }
      // Alt: tutamak çek (çokgen ise bezier'e çevir); Alt+tık: köşe noktasına döndür
      if (e.altKey) {
        let converted = false;
        drag('Mask Path', (cur, ev, mm) => {
          if (mm.type !== 'bezier') { mapParamValues(mm.path, MG.toBezier); mm.type = 'bezier'; converted = true; }
          const p = [...evalParam(mm.path, local)];
          const dx = cur[0] - p[i * 6], dy = cur[1] - p[i * 6 + 1];
          p[i * 6 + 4] = dx; p[i * 6 + 5] = dy; p[i * 6 + 2] = -dx; p[i * 6 + 3] = -dy;
          return p;
        }, () => {
          if (m.type !== 'bezier') return;
          store.commit('Corner Point', (pr) => withMask(pr, (mm) => { const p = [...evalParam(mm.path, local)]; p[i * 6 + 2] = p[i * 6 + 3] = p[i * 6 + 4] = p[i * 6 + 5] = 0; setParamAt(mm.path, local, p); }));
          app.engine.requestRender();
        });
        return true;
      }
      const start = [...m.path];
      drag('Mask Path', (cur) => {
        const p = [...start];
        p[i * st] = start[i * st] + cur[0] - src[0];
        p[i * st + 1] = start[i * st + 1] + cur[1] - src[1];
        return p;
      });
      return true;
    }
    if (hit && hit.kind === 'e') {
      const start = [...m.path];
      drag('Mask Path', (cur, ev) => {
        const dx = cur[0] - src[0], dy = cur[1] - src[1];
        const [x, y, w, h] = start;
        const next = [...start];
        if (hit.id === 'l') { next[0] = x + dx; next[2] = w - dx; }
        if (hit.id === 'r') next[2] = w + dx;
        if (hit.id === 't') { next[1] = y + dy; next[3] = h - dy; }
        if (hit.id === 'b') next[3] = h + dy;
        if (ev.shiftKey) {
          const k = hit.id === 'l' || hit.id === 'r' ? next[2] / (w || 1) : next[3] / (h || 1);
          next[2] = w * k; next[3] = h * k; next[0] = x + (w - next[2]) / 2; next[1] = y + (h - next[3]) / 2;
        }
        return next;
      });
      return true;
    }
    // Ctrl+tık kenar: nokta ekle
    if (e.ctrlKey && m.type !== 'ellipse' && m.verts.length >= 2) {
      const pts = m.handles.filter((h) => h.kind === 'v').map((h) => h.p);
      let best = -1, bd = 12;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const tt = clamp(((vx - a[0]) * (b[0] - a[0]) + (vy - a[1]) * (b[1] - a[1])) / (L * L), 0, 1);
        const d = Math.hypot(a[0] + (b[0] - a[0]) * tt - vx, a[1] + (b[1] - a[1]) * tt - vy);
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) {
        store.commit('Add Mask Point', (pr) => withMask(pr, (mm) => {
          const s2 = mm.type === 'bezier' ? 6 : 2;
          const n = Math.floor((evalParam(mm.path, local) || []).length / s2);
          const a = best, b = (best + 1) % n;
          mapParamValues(mm.path, (v) => {
            const out = [...v];
            const ins = [r1((v[a * s2] + v[b * s2]) / 2), r1((v[a * s2 + 1] + v[b * s2 + 1]) / 2)];
            if (s2 === 6) ins.push(0, 0, 0, 0);
            out.splice((best + 1) * s2, 0, ...ins);
            return out;
          });
          const cur = [...evalParam(mm.path, local)];
          cur[(best + 1) * s2] = r1(src[0]);
          cur[(best + 1) * s2 + 1] = r1(src[1]);
          setParamAt(mm.path, local, cur);
        }));
        return true;
      }
    }
    const inside = MG.pointInPolygon(MG.flatten(m.type, m.path, 12), src[0], src[1]);
    if (!inside) {
      // maskenin dışı: maske seçimini kaldır, normal davranışa dön
      store.ui.selectedMask = null;
      store.emit('selection');
      return false;
    }
    const start = [...m.path];
    drag('Mask Path', (cur) => {
      const dx = cur[0] - src[0], dy = cur[1] - src[1];
      if (m.type === 'ellipse') return [start[0] + dx, start[1] + dy, start[2], start[3]];
      return start.map((v, j) => ((j % st) === 0 ? v + dx : (j % st) === 1 ? v + dy : v));
    });
    return true;
  }

  _pointInClip(c, p) {
    const { pts } = this._clipCorners(c);
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  _hitClip(p) {
    const s = store.seq;
    const layers = videoLayersAt(store.project, s, app.engine.currentFrame);
    const items = itemsOfLayers(layers).reverse();
    for (const it of items) {
      if (it.clip.kind === 'adjustment' || String(it.clip.id).startsWith('cap_')) continue;
      if (s.tracks.video[it.clip.track]?.locked) continue;
      if (this._pointInClip(it.clip, p)) return s.clips[it.clip.id];
    }
    return null;
  }

  // Metin / renk / ayar katmanı ekleme
  addText(at = null) {
    const s = store.seq;
    if (!s) return;
    const f = app.engine.currentFrame;
    const dur = Math.round(5 * s.fps);
    let id = null;
    store.commit('New Title', (p) => {
      const sq = p.sequences[p.activeSequenceId];
      const tr = E.freeVideoTrackAbove(sq, f, dur, 1);
      const c = E.placeSynthetic(sq, 'text', { start: f, duration: dur, track: tr, name: t('Title'), text: { text: t('New Text') } });
      if (at) c.props.position.v = [Math.round(at[0]), Math.round(at[1])];
      id = c.id;
    });
    store.select([id]);
    app.commands.showPanel('effectControls');
  }

  addColorMatte() {
    const s = store.seq;
    if (!s) return;
    const inp = el('input', { type: 'color', value: '#000000' });
    inp.addEventListener('change', () => {
      const f = app.engine.currentFrame;
      const dur = Math.round(5 * s.fps);
      let id;
      store.commit('New Color Matte', (p) => {
        const sq = p.sequences[p.activeSequenceId];
        const tr = E.freeVideoTrackAbove(sq, f, dur, 0);
        id = E.placeSynthetic(sq, 'color', { start: f, duration: dur, track: tr, name: t('Color Matte'), color: inp.value }).id;
      });
      store.select([id]);
    });
    inp.click();
  }

  addAdjustment() {
    const s = store.seq;
    if (!s) return;
    const f = app.engine.currentFrame;
    const dur = Math.round(5 * s.fps);
    let id;
    store.commit('New Adjustment Layer', (p) => {
      const sq = p.sequences[p.activeSequenceId];
      const tr = E.freeVideoTrackAbove(sq, f, dur, 1);
      id = E.placeSynthetic(sq, 'adjustment', { start: f, duration: dur, track: tr, name: t('Adjustment Layer') }).id;
    });
    store.select([id]);
    toast(t('Drag effects (e.g. Lumetri Color) onto the adjustment layer'));
  }
}

// ===================== SOURCE =====================
export class SourceMonitor {
  constructor() {
    this.id = 'source';
    this.mediaId = null;
    this.frame = 0;
    this.playing = false;
    this.rate = 1;
    this.useVideo = true;
    this.useAudio = true;
    this._revTimer = null;
  }
  title() {
    const m = this.mediaId ? store.project.media[this.mediaId] : null;
    return t('Source') + (m ? ': ' + m.name : '');
  }
  get media() { return this.mediaId ? store.project.media[this.mediaId] : null; }
  get fps() { return this.media?.fps || 30; }
  // alt klipte kaynak aralığı: [off, end] saniye
  get off() { return this.media?.subStart ?? 0; }
  get end() { const m = this.media; return m ? (m.subEnd ?? m.duration ?? 0) : 0; }
  get total() {
    const m = this.media;
    if (!m) return 0;
    if (m.type === 'image') return Math.round((settings.stillDuration || 5) * 30);
    return Math.max(1, Math.floor((this.end - this.off) * this.fps));
  }
  get currentFrame() { return this.frame; }

  mount(body) {
    const mon = el('div', { class: 'monitor' });
    this.view = el('div', { class: 'monitor-view' });
    this.video = el('video', { style: { left: '0', top: '0', width: '100%', height: '100%', objectFit: 'contain', display: 'none' } });
    this.video.preload = 'auto';
    this.img = el('img', { style: { left: '0', top: '0', width: '100%', height: '100%', objectFit: 'contain', display: 'none' } });
    this.audioArt = el('canvas', { style: { left: '0', top: '0', width: '100%', height: '100%', display: 'none' } });
    this.msg = el('div', { class: 'msg', text: t('Double-click a clip in the Project panel to open it here') });
    this.view.append(this.video, this.img, this.audioArt, this.msg);
    this.view.draggable = true;
    this.view.addEventListener('dragstart', (e) => {
      if (!this.mediaId) { e.preventDefault(); return; }
      this._startDrag(e, { video: this.useVideo, audio: this.useAudio });
    });
    this.view.addEventListener('wheel', (e) => { e.preventDefault(); this.pause(); this.setFrame(this.frame + (e.deltaY > 0 ? 1 : -1)); }, { passive: false });
    mon.appendChild(this.view);
    this.mini = new MiniBar(mon, () => {
      const m = this.media;
      if (!m) return null;
      const rel = (sec) => Math.round((sec - this.off) * this.fps);
      return { total: this.total, frame: this.frame, inF: m.inPoint != null ? rel(m.inPoint) : null, outF: m.outPoint != null ? rel(m.outPoint) : null, markers: (m.markers || []).map((mk) => ({ frame: rel(mk.t), color: mk.color })) };
    }, (f) => { this.pause(); this.setFrame(f); });
    const bar = el('div', { class: 'monitor-bar' });
    this.tc = el('div', { class: 'tc' });
    editableTC(this.tc, () => (this.media ? this.fps : null), () => this.frame, (f) => this.setFrame(f));
    this.playBtn = iconBtn(I.play, t('Play/Stop'), () => this.toggle());
    this.vBtn = iconBtn(I.video, t('Drag Video Only / toggle video'), () => { this.useVideo = !this.useVideo; if (!this.useVideo && !this.useAudio) this.useAudio = true; this._upd(); });
    this.aBtn = iconBtn(I.audio, t('Drag Audio Only / toggle audio'), () => { this.useAudio = !this.useAudio; if (!this.useVideo && !this.useAudio) this.useVideo = true; this._upd(); });
    // düğmelerden sürükleme: yalnız görüntü / yalnız ses
    for (const [b, tracks] of [[this.vBtn, { video: true, audio: false }], [this.aBtn, { video: false, audio: true }]]) {
      b.draggable = true;
      b.addEventListener('dragstart', (e) => { if (!this.mediaId) { e.preventDefault(); return; } this._startDrag(e, tracks); });
    }
    const grow = el('div', { class: 'grow' },
      iconBtn(I.markIn, t('Mark In') + ' (I)', () => this.markIn()),
      iconBtn(I.markOut, t('Mark Out') + ' (O)', () => this.markOut()),
      iconBtn(I.goIn, t('Go to In'), () => this.goIn()),
      iconBtn(I.stepB, t('Step Back'), () => { this.pause(); this.setFrame(this.frame - 1); }),
      this.playBtn,
      iconBtn(I.stepF, t('Step Forward'), () => { this.pause(); this.setFrame(this.frame + 1); }),
      iconBtn(I.goOut, t('Go to Out'), () => this.goOut()),
      iconBtn(I.insert, t('Insert') + ' (,)', () => app.commands.run('clip.insert')),
      iconBtn(I.overwrite, t('Overwrite') + ' (.)', () => app.commands.run('clip.overwrite')),
      this.vBtn, this.aBtn,
    );
    this.dur = el('div', { class: 'tc dur', title: t('In/Out duration') });
    bar.append(this.tc, grow, this.dur);
    mon.appendChild(bar);
    body.appendChild(mon);
    this.video.addEventListener('timeupdate', () => { if (this.playing) this._fromVideo(); });
    this.video.addEventListener('ended', () => this.pause());
    this.video.addEventListener('seeked', () => this.mini.draw());
    mediaEvents.on('proxyReady', (id) => { if (id === this.mediaId) this.openMedia(id, { time: this.off + this.frame / this.fps }); });
    store.on('project', () => { this.mediaId = null; this._show(); });
    app.source = this;
    this._upd();
  }

  _startDrag(e, tracks) {
    app.dragMedia = [this.mediaId];
    app.dragSeqs = [];
    app.dragTracks = tracks;
    e.dataTransfer.setData('application/x-uli-media', JSON.stringify([this.mediaId]));
    e.dataTransfer.effectAllowed = 'copy';
  }

  onResize() { this.mini.draw(); this._drawAudioArt(); }

  _upd() {
    this.vBtn.classList.toggle('active', this.useVideo);
    this.aBtn.classList.toggle('active', this.useAudio);
    const m = this.media;
    this.tc.textContent = m ? framesToTC(this.frame, this.fps) : '00:00:00:00';
    if (m) {
      const r = this.getRange();
      this.dur.textContent = framesToTC(Math.round((r.outSec - r.inSec) * this.fps), this.fps);
    } else this.dur.textContent = '';
    this.mini.draw();
  }

  _show() {
    const m = this.media;
    this.video.style.display = 'none';
    this.img.style.display = 'none';
    this.audioArt.style.display = 'none';
    this.msg.style.display = 'none';
    if (!m) { this.msg.style.display = 'block'; this.msg.textContent = t('Double-click a clip in the Project panel to open it here'); this.video.removeAttribute('src'); this._upd(); this.group?.renderTabs(); return; }
    if (m.type === 'image') {
      this.img.src = mediaUrl(m.path);
      this.img.style.display = 'block';
    } else {
      const url = playbackUrl(m, m.hasVideo ? 'video' : 'audio');
      if (!url) {
        this.msg.style.display = 'block';
        const st = mediaStatus(m);
        this.msg.textContent = st === 'offline' ? t('Media Offline') : st === 'proxy' ? t('Creating proxy...') : t('Unsupported format, proxy needed');
        this.video.removeAttribute('src');
      } else {
        if (this.video.dataset.url !== url) { this.video.src = url; this.video.dataset.url = url; }
        if (m.hasVideo) this.video.style.display = 'block';
        else { this.audioArt.style.display = 'block'; this._drawAudioArt(); }
      }
    }
    this.group?.renderTabs();
    this._upd();
  }

  _drawAudioArt() {
    const m = this.media;
    if (!m || m.hasVideo) return;
    const cv = this.audioArt;
    const w = this.view.clientWidth, h = this.view.clientHeight;
    if (!w) return;
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0d1410';
    ctx.fillRect(0, 0, w, h);
    const pk = rt(m.id).peaks;
    if (!pk) return;
    ctx.fillStyle = '#3f9a63';
    const n = pk.length;
    for (let x = 0; x < w; x++) {
      const i0 = Math.floor((x / w) * n), i1 = Math.floor(((x + 1) / w) * n);
      let p = 0;
      for (let i = i0; i <= i1 && i < n; i++) if (pk[i] > p) p = pk[i];
      const v = (p / 255) * h * 0.45;
      ctx.fillRect(x, h / 2 - v, 1, v * 2);
    }
  }

  openMedia(id, opts = {}) {
    const m = store.project.media[id];
    if (!m) return;
    this.pause();
    this.mediaId = id;
    store.ui.sourceMediaId = id;
    this._show();
    let t0 = opts.time;
    if (t0 == null) t0 = m.inPoint ?? this.off;
    this.setFrame(Math.round((t0 - this.off) * this.fps));
    app.commands.showPanel('source');
  }

  setFrame(f) {
    const m = this.media;
    if (!m) return;
    this.frame = clamp(Math.round(f), 0, Math.max(0, this.total - 1));
    if (m.type !== 'image' && this.video.src) {
      const tt = this.off + (this.frame + 0.5) / this.fps;
      try { this.video.currentTime = tt; } catch (e) { /* */ }
    }
    this._upd();
  }

  _fromVideo() {
    this.frame = Math.max(0, Math.floor((this.video.currentTime - this.off) * this.fps));
    if (this.playing && this.rate > 0 && this.media?.subEnd != null && this.video.currentTime >= this.end - 0.5 / this.fps) { this.pause(); return; }
    const m = this.media;
    if (m && m.outPoint != null && this.playing && this.rate > 0 && this.video.currentTime >= m.outPoint && this._playToOut) this.pause();
    this._upd();
  }

  play(rate = 1) {
    const m = this.media;
    if (!m || m.type === 'image' || !this.video.src) return;
    this.rate = rate;
    clearInterval(this._revTimer);
    this.playing = true;
    this.playBtn.innerHTML = I.pause;
    if (rate > 0) {
      if (this.frame >= this.total - 1) this.setFrame(0);
      this.video.playbackRate = rate;
      this.video.play().catch(() => { /* */ });
      const tick = () => { if (!this.playing) return; this._fromVideo(); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    } else {
      this.video.pause();
      // geri oynatma: her 40 ms'de hıza göre kare atla
      const step = Math.max(1, Math.round(Math.abs(rate) * this.fps * 0.04));
      this._revTimer = setInterval(() => {
        if (this.frame <= 0) { this.pause(); return; }
        this.setFrame(this.frame - step);
      }, 40);
    }
  }
  pause() {
    this.playing = false;
    clearInterval(this._revTimer);
    try { this.video.pause(); } catch (e) { /* */ }
    if (this.playBtn) this.playBtn.innerHTML = I.play;
    if (this.media && this.media.type !== 'image' && this.video.src) this.frame = clamp(Math.round((this.video.currentTime - this.off) * this.fps - 0.5), 0, Math.max(0, this.total - 1));
    this._upd();
  }
  toggle() { if (this.playing) this.pause(); else this.play(1); }
  shuttle(dir) {
    if (dir === 0) { this.pause(); return; }
    const steps = [1, 2, 4, 8];
    if (!this.playing || Math.sign(this.rate) !== dir) { this.play(dir); return; }
    const i = steps.indexOf(Math.abs(this.rate));
    this.play(steps[Math.min(3, i + 1)] * dir);
  }
  goEnd() { this.setFrame(this.total - 1); }

  markIn() {
    const m = this.media;
    if (!m) return;
    m.inPoint = this.off + this.frame / this.fps;
    if (m.outPoint != null && m.outPoint <= m.inPoint) m.outPoint = null;
    store.markDirty();
    this._upd();
  }
  markOut() {
    const m = this.media;
    if (!m) return;
    m.outPoint = this.off + (this.frame + 1) / this.fps;
    if (m.inPoint != null && m.inPoint >= m.outPoint) m.inPoint = null;
    store.markDirty();
    this._upd();
  }
  clearInOut() {
    const m = this.media;
    if (!m) return;
    m.inPoint = null; m.outPoint = null;
    store.markDirty();
    this._upd();
  }
  goIn() { const m = this.media; if (m) this.setFrame(Math.round(((m.inPoint ?? this.off) - this.off) * this.fps)); }
  goOut() { const m = this.media; if (m) this.setFrame(m.outPoint != null ? Math.round((m.outPoint - this.off) * this.fps) - 1 : this.total - 1); }

  // Kaynak medyaya işaretçi (klip işaretçisi): zaman çizelgesindeki kliplerde de görünür
  addMarker() {
    const m = this.media;
    if (!m) return;
    const tm = this.off + this.frame / this.fps;
    store.commit('Add Clip Marker', (p) => {
      const mm = p.media[m.id];
      if (!mm) return false;
      mm.markers = (mm.markers || []).filter((x) => Math.abs(x.t - tm) > 0.5 / this.fps);
      mm.markers.push({ id: 'mk_' + Date.now().toString(36), t: tm, name: '', color: '#e3a42c' });
      mm.markers.sort((a, b) => a.t - b.t);
    });
    this._upd();
  }
  clearMarkers() {
    const m = this.media;
    if (!m || !m.markers?.length) return;
    store.commit('Clear Clip Markers', (p) => { p.media[m.id].markers = []; });
    this._upd();
  }
  nextMarker(dir = 1) {
    const m = this.media;
    if (!m || !m.markers?.length) return;
    const cur = this.off + this.frame / this.fps;
    const list = dir > 0 ? m.markers.filter((x) => x.t > cur + 1e-4) : m.markers.filter((x) => x.t < cur - 1e-4).reverse();
    if (list[0]) { this.pause(); this.setFrame(Math.round((list[0].t - this.off) * this.fps)); }
  }

  getRange() {
    const m = this.media;
    if (!m) return { inSec: 0, outSec: 0 };
    const dur = m.type === 'image' ? (settings.stillDuration || 5) : m.duration || 0;
    return { inSec: m.inPoint ?? this.off, outSec: m.outPoint ?? (m.type === 'image' ? dur : this.end) };
  }
}
