// Efekt Kontrolleri paneli
import { store } from '../store.js';
import { app } from '../appContext.js';
import { t } from '../i18n.js';
import { el, clamp, framesToTC, parseTC, rafThrottle, ipc, nodePath, uid } from '../util.js';
import { EFFECTS, TRANSITIONS, BLEND_MODES, effectDef } from '../effectsDef.js';
import { evalParam, setParamAt, toggleAnimation, isAnimated, addKeyframe, removeKeyframeAt, keyframeAt, prevKeyframe, nextKeyframe } from '../keyframes.js';
import { defaultVideoProps, defaultAudioProps, createEffect } from '../model.js';
import { contextMenu, toast, promptDialog } from '../ui/dialogs.js';
import { saveUserPreset, applyPreset, applyClipAnim } from '../presets.js';
import { fontPicker } from '../ui/fontPicker.js';
import { ANIM_IN, ANIM_OUT, ANIM_COMBO } from '../clipAnim.js';
import { SPEED_CURVES, applySpeedCurve } from '../speedCurves.js';
import { ALIGN_BUTTONS } from './graphicsPanel.js';
import { maskList, findMask, addMask, removeMask, addShapeMask } from '../masks.js';
import * as MG from '../maskGeom.js';
import { trackMask, analyzeStabilize } from '../tracker.js';

const STOPWATCH = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="9" r="5.5"/><path d="M8 9V6M6.5 2h3M12.5 4.5l1-1"/></svg>';
export const FONTS = ['Segoe UI', 'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact', 'Ink Free', 'Lucida Console', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Sitka Text', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];

// Param yolu: 'props.position' | 'fx.<id>.<key>'
export function getParam(clip, path) {
  if (!clip) return null;
  const parts = path.split('.');
  if (parts[0] === 'props') return clip.props[parts[1]];
  if (parts[0] === 'mask') {
    const m = findMask(clip, parts[1], parts[2]);
    return m ? m[parts[3]] : null;
  }
  if (parts[0] === 'fx') {
    const fx = clip.effects.find((x) => x.id === parts[1]);
    return fx ? fx.params[parts[2]] : null;
  }
  return null;
}

function curClip() {
  const sel = store.selectedClips();
  return sel.length ? sel.find((c) => c.type === 'video') || sel[0] : null;
}

function localFrame(c) {
  return clamp(app.engine.currentFrame - c.start, 0, c.duration - 1);
}

// Sürüklenebilir sayı
export function scrubNumber(value, { step = 1, min = -Infinity, max = Infinity, decimals = 1, suffix = '', onStart, onChange, onEnd, onCommit, fmt }) {
  const s = el('span', { class: 'scrub' });
  const show = (v) => { s.textContent = fmt ? fmt(v) : (Math.round(v * Math.pow(10, decimals)) / Math.pow(10, decimals)).toFixed(decimals).replace(/\.0+$/, (m) => (decimals ? m : '')) + suffix; };
  let cur = value;
  show(cur);
  s.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const v0 = cur;
    let moved = false;
    const mv = (ev) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 2) return;
      if (!moved) { moved = true; onStart && onStart(); document.body.style.cursor = 'ew-resize'; }
      const k = ev.shiftKey ? 10 : ev.ctrlKey ? 0.1 : 1;
      cur = clamp(v0 + dx * step * k, min, max);
      show(cur);
      onChange && onChange(cur);
    };
    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      if (moved) { onEnd && onEnd(cur); return; }
      // tıklama: yazarak düzenle
      const inp = el('input', { type: 'text', class: 'scrub-input' });
      inp.value = String(Math.round(cur * 1000) / 1000);
      s.replaceWith(inp);
      inp.focus(); inp.select();
      let done = false;
      const fin = (ok) => {
        if (done) return;
        done = true;
        if (ok) {
          let v = parseFloat(inp.value.replace(',', '.'));
          if (!isNaN(v)) { v = clamp(v, min, max); cur = v; show(v); onCommit && onCommit(v); }
        }
        inp.replaceWith(s);
      };
      inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') fin(true); if (ev.key === 'Escape') fin(false); });
      inp.addEventListener('blur', () => fin(true));
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  });
  s.set = (v) => { cur = v; show(v); };
  return s;
}

export class EffectControlsPanel {
  constructor() {
    this.id = 'effectControls';
    this.collapsed = new Set(JSON.parse(localStorage.getItem('uli.ecCollapsed') || '[]'));
    this.rows = [];
    this._render = rafThrottle(() => this.render());
    this._drawKf = rafThrottle(() => this.drawKf());
    this._lastKey = null;
  }
  title() { return t('Effect Controls'); }

  mount(body) {
    const ec = el('div', { class: 'ec' });
    this.props = el('div', { class: 'ec-props' });
    this.kf = el('div', { class: 'ec-kf' });
    this.kfCanvas = el('canvas');
    this.kf.appendChild(this.kfCanvas);
    ec.append(this.props, this.kf);
    body.appendChild(ec);
    this.props.addEventListener('scroll', () => this._drawKf());
    this.kf.addEventListener('mousedown', (e) => this._kfDown(e));
    this.kf.addEventListener('contextmenu', (e) => this._kfContext(e));
    this.kf.addEventListener('wheel', (e) => { this.props.scrollTop += e.deltaY; }, { passive: true });
    body.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-uli-effect')) e.preventDefault(); });
    body.addEventListener('drop', (e) => {
      const d = JSON.parse(e.dataTransfer.getData('application/x-uli-effect') || '{}');
      const c = curClip();
      if (!c) return;
      if (d.kind === 'effect') app.commands.applyEffect([c.id], d.type);
      else if (d.kind === 'preset') applyPreset([c.id], d.type);
      else if (d.kind === 'anim') applyClipAnim([c.id], d.type);
    });
    store.on('change', (info) => { if (!info || !info.live || !this._dragging) this._render(); else this._drawKf(); });
    store.on('selection', () => this._render());
    app.engine.on('frame', () => { this._updateValues(); this._drawKf(); });
    app.effectControls = this;
    this.render();
  }

  onResize() { this._drawKf(); }
  onShow() { this.render(); }

  _saveCollapsed() { localStorage.setItem('uli.ecCollapsed', JSON.stringify([...this.collapsed])); }

  render() {
    if (!this.props) return;
    const scroll = this.props.scrollTop;
    this.props.innerHTML = '';
    this.rows = [];
    this.valueUpdaters = [];
    const seq = store.seq;
    const st = store.ui.selectedTransition;
    if (seq && st && seq.clips[st.clipId]) { this._renderTransition(seq, st); this._drawKf(); return; }
    const c = seq ? curClip() : null;
    if (!c) {
      this.props.appendChild(el('div', { class: 'ec-head', text: seq ? t('(no clip selected)') : t('No sequence') }));
      this._clip = null;
      this._drawKf();
      return;
    }
    this._clip = c.id;
    this.props.appendChild(el('div', { class: 'ec-head', text: (seq.name + ' * ' + c.name) }));
    if (c.type === 'video') {
      this._section('motion', t('Motion'), () => this._resetProps(c, ['position', 'scale', 'scaleWidth', 'rotation', 'anchor']), () => {
        this._paramRow(c, 'props.position', t('Position'), { type: 'point', step: 1, decimals: 1 });
        this._paramRow(c, 'props.scale', t('Scale'), { step: 0.5, min: 0, max: 10000, decimals: 1 });
        this._paramRow(c, 'props.scaleWidth', t('Scale Width'), { step: 0.5, min: 0, max: 10000, decimals: 1, disabled: c.props.uniformScale !== false });
        const uni = el('input', { type: 'checkbox' });
        uni.checked = c.props.uniformScale !== false;
        uni.addEventListener('change', () => store.commit('Uniform Scale', (p) => { const cc = p.sequences[p.activeSequenceId].clips[c.id]; cc.props.uniformScale = uni.checked; }));
        this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname' }), el('label', { class: 'pval' }, uni, t('Uniform Scale'))));
        this._paramRow(c, 'props.rotation', t('Rotation'), { step: 0.5, decimals: 1, suffix: '°' });
        this._paramRow(c, 'props.anchor', t('Anchor Point'), { type: 'point', step: 1, decimals: 1 });
        // kareye hizala
        const alb = ALIGN_BUTTONS.map(([m, tip, svg]) => { const b = el('button', { class: 'icon', title: t(tip), html: svg, style: { padding: '0 3px' } }); b.addEventListener('click', () => app.program?.alignClip(c.id, m)); return b; });
        this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Align') }), el('div', { class: 'pval' }, ...alb)));
        // tuval arka planı (klip kareyi kaplamadığında)
        if (c.kind === 'media' || c.kind === 'sequence') {
          const bf = c.bgFill || { mode: 'none' };
          const setBg = (fn) => store.commit('Background', (p) => { const cc = p.sequences[p.activeSequenceId].clips[c.id]; cc.bgFill = { mode: 'none', color: '#000000', blur: 40, dim: 20, ...(cc.bgFill || {}) }; fn(cc.bgFill); if (cc.bgFill.mode === 'none') cc.bgFill = null; });
          const mode = el('select');
          for (const [v, l] of [['none', 'None'], ['blur', 'Blurred copy'], ['color', 'Color']]) mode.appendChild(el('option', { value: v, text: t(l) }));
          mode.value = bf.mode || 'none';
          mode.addEventListener('change', () => setBg((b) => { b.mode = mode.value; }));
          const col = el('input', { type: 'color', value: bf.color || '#000000', style: { display: bf.mode === 'color' ? '' : 'none' } });
          col.addEventListener('change', () => setBg((b) => { b.color = col.value; }));
          const blur = scrubNumber(bf.blur ?? 40, { step: 1, min: 0, max: 200, decimals: 0, onCommit: (v) => setBg((b) => { b.blur = v; }) });
          if (bf.mode !== 'blur') blur.style.display = 'none';
          this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Background') }), el('div', { class: 'pval', style: { display: 'flex', gap: '6px', alignItems: 'center' } }, mode, col, blur)));
        }
        this._motionBlurRow(c);
      });
      this._section('opacity', t('Opacity'), () => this._resetProps(c, ['opacity']), () => {
        this._paramRow(c, 'props.opacity', t('Opacity'), { step: 0.5, min: 0, max: 100, decimals: 1, suffix: ' %' });
        const bm = el('select');
        for (const m of BLEND_MODES) bm.appendChild(el('option', { value: m, text: t(m[0].toUpperCase() + m.slice(1).replace(/([A-Z])/g, ' $1')) }));
        bm.value = c.props.blendMode || 'normal';
        bm.addEventListener('change', () => store.commit('Blend Mode', (p) => { p.sequences[p.activeSequenceId].clips[c.id].props.blendMode = bm.value; }));
        this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Blend Mode') }), el('div', { class: 'pval' }, bm)));
        this._masksBlock(c, 'clip');
      });
      if (c.kind === 'media' || c.kind === 'sequence') {
        this._section('time', t('Time Remapping'), null, () => {
          const b = el('button', { text: t('Speed/Duration...'), style: { padding: '1px 8px' } });
          b.addEventListener('click', () => app.commands.run('clip.speed'));
          this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Clip Speed') }), el('div', { class: 'pval' }, el('span', { text: (c.reverse ? '-' : '') + Math.round(c.speed * 10000) / 100 + ' %' }), b)));
          if (c.props.timeRemap && !c.reverse) {
            const cs = el('select', { style: { maxWidth: '150px' } });
            cs.appendChild(el('option', { value: '', text: '—' }));
            for (const [k, n] of SPEED_CURVES) cs.appendChild(el('option', { value: k, text: t(n) }));
            cs.appendChild(el('option', { value: 'none', text: t('Normal (reset)') }));
            cs.addEventListener('change', () => { if (cs.value) applySpeedCurve([c.id], cs.value); });
            this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Speed Curve') }), el('div', { class: 'pval' }, cs)));
            this._paramRow(c, 'props.timeRemap', t('Speed'), { step: 1, min: 0, max: 1000, decimals: 1, suffix: ' %' });
            this.props.appendChild(el('div', { class: 'ec-row', style: { color: 'var(--text-dim)', fontSize: '10px', paddingLeft: '32px' }, text: t('Turn on the stopwatch and add keyframes for speed ramps. Ease In/Out keyframes make smooth ramps.') }));
          }
        });
      }
      if (c.kind !== 'adjustment') this._section('anim', t('Animation'), () => store.commit('Reset Animation', (p) => { delete p.sequences[p.activeSequenceId].clips[c.id].anim; }), () => this._animRows(c));
      if (c.kind === 'text') this._textSection(c);
      if (c.kind === 'graphic') {
        const b = el('button', { text: t('Edit in Essential Graphics'), style: { margin: '6px 10px' } });
        b.addEventListener('click', () => app.commands.showPanel('graphics'));
        this.props.appendChild(b);
      }
      if (c.kind === 'color') {
        this._section('color', t('Color Matte'), null, () => {
          const ci = el('input', { type: 'color', value: c.color || '#000000' });
          ci.addEventListener('input', () => { store.begin('Matte Color'); store.live((p) => { p.sequences[p.activeSequenceId].clips[c.id].color = ci.value; }); });
          ci.addEventListener('change', () => store.end());
          this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Color') }), el('div', { class: 'pval' }, ci)));
        });
      }
      c.effects.forEach((fx, i) => this._effectSection(c, fx, i));
      if (!c.effects.length) this.props.appendChild(el('div', { class: 'empty-hint', style: { padding: '14px' }, text: t('Drag effects here from the Effects panel') }));
    } else {
      this._section('volume', t('Volume'), () => this._resetProps(c, ['volume']), () => {
        this._paramRow(c, 'props.volume', t('Level'), { step: 0.1, min: -96, max: 15, decimals: 1, suffix: ' dB' });
      });
      this._section('panner', t('Panner'), () => this._resetProps(c, ['pan']), () => {
        this._paramRow(c, 'props.pan', t('Balance'), { step: 0.5, min: -100, max: 100, decimals: 1 });
      });
      c.effects.forEach((fx, i) => this._effectSection(c, fx, i));
      if (!c.effects.length && c.kind === 'media') this.props.appendChild(el('div', { class: 'empty-hint', style: { padding: '14px' }, text: t('Drag audio effects here from the Effects panel') }));
    }
    this.props.scrollTop = scroll;
    this._drawKf();
  }

  // Klip animasyonları: giriş / çıkış (süre sn) ve kombo (hız, miktar)
  _animRows(c) {
    const A = c.anim || {};
    const set = (label, fn, live = false) => {
      const f = (p) => { const cc = p.sequences[p.activeSequenceId].clips[c.id]; if (!cc) return; cc.anim = structuredClone(cc.anim || {}); fn(cc.anim); };
      if (live) { if (!store._txn) store.begin(label); store.live(f); } else store.commit(label, f);
      app.engine.requestRender();
    };
    const num = (val, o, fn) => scrubNumber(val, { step: o.step, min: o.min, max: o.max, decimals: o.dec, suffix: o.suffix || '',
      onStart: () => { this._dragging = true; store.begin(t('Animation')); },
      onChange: (v) => set('Animation', (a) => fn(a, v), true),
      onEnd: () => { this._dragging = false; store.end(); },
      onCommit: (v) => set('Animation', (a) => fn(a, v)) });
    const sel = (list, cur, onPick) => {
      const s2 = el('select', { style: { maxWidth: '130px' } });
      s2.appendChild(el('option', { value: '', text: t('None') }));
      for (const [k, label] of list) s2.appendChild(el('option', { value: k, text: t(label) }));
      s2.value = cur || '';
      s2.addEventListener('change', () => onPick(s2.value));
      return s2;
    };
    const row = (label, ...ctl) => this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: label }), el('div', { class: 'pval', style: { display: 'flex', gap: '6px', alignItems: 'center' } }, ...ctl)));
    const maxD = Math.max(0.1, c.duration / (store.seq?.fps || 30));
    row(t('In'), sel(ANIM_IN, A.in?.type, (v) => set('Animation', (a) => { a.in = v ? { dur: a.in?.dur || 0.5, type: v } : null; })),
      num(A.in?.dur ?? 0.5, { step: 0.05, min: 0.1, max: maxD, dec: 2, suffix: ' s' }, (a, v) => { a.in = { type: a.in?.type || 'fade', dur: v }; }));
    row(t('Out'), sel(ANIM_OUT, A.out?.type, (v) => set('Animation', (a) => { a.out = v ? { dur: a.out?.dur || 0.5, type: v } : null; })),
      num(A.out?.dur ?? 0.5, { step: 0.05, min: 0.1, max: maxD, dec: 2, suffix: ' s' }, (a, v) => { a.out = { type: a.out?.type || 'fade', dur: v }; }));
    row(t('Combo'), sel(ANIM_COMBO, A.combo?.type, (v) => set('Animation', (a) => { a.combo = v ? { speed: a.combo?.speed || 1, amount: a.combo?.amount ?? 100, type: v } : null; })),
      num(A.combo?.speed ?? 1, { step: 0.05, min: 0.05, max: 10, dec: 2, suffix: ' Hz' }, (a, v) => { a.combo = { type: a.combo?.type || 'rock', amount: a.combo?.amount ?? 100, speed: v }; }),
      num(A.combo?.amount ?? 100, { step: 1, min: 0, max: 400, dec: 0, suffix: '%' }, (a, v) => { a.combo = { type: a.combo?.type || 'rock', speed: a.combo?.speed || 1, amount: v }; }));
  }

  // Hareket bulanıklığı (animasyonlu dönüşümde deklanşör açısı)
  _motionBlurRow(c) {
    const mb = c.motionBlur || { enabled: false, shutter: 180, samples: 16 };
    const set = (label, fn) => store.commit(label, (p) => { const cc = p.sequences[p.activeSequenceId].clips[c.id]; cc.motionBlur = { enabled: false, shutter: 180, samples: 16, ...(cc.motionBlur || {}) }; fn(cc.motionBlur); });
    const on = el('input', { type: 'checkbox' });
    on.checked = !!mb.enabled;
    on.addEventListener('change', () => set('Motion Blur', (m) => { m.enabled = on.checked; }));
    const num = (v, min, max, label, key) => {
      const i = el('input', { type: 'number', min: String(min), max: String(max), step: '1', style: { width: '56px' } });
      i.value = v; i.disabled = !mb.enabled;
      i.addEventListener('change', () => set(label, (m) => { m[key] = clamp(+i.value || min, min, max); }));
      return i;
    };
    this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname' }), el('label', { class: 'pval', title: t('Blurs keyframed position, scale and rotation movement') }, on, t('Motion Blur'))));
    this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Shutter Angle') }), el('div', { class: 'pval' }, num(mb.shutter, 1, 360, 'Shutter Angle', 'shutter'), el('span', { text: '°' }))));
    this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Samples') }), el('div', { class: 'pval' }, num(mb.samples, 2, 64, 'Samples', 'samples'))));
  }

  async _savePreset(c, fxIds) {
    const list = c.effects.filter((x) => fxIds.includes(x.id) && EFFECTS[x.type]);
    if (!list.length) return;
    const name = await promptDialog(t('Preset name'), list.length === 1 ? t(EFFECTS[list[0].type].name) : t('My Preset'), { title: t('Save as Preset...') });
    if (!name) return;
    saveUserPreset(name, list);
    app.effectsPanel?.render();
    toast(t('Preset saved') + ': ' + name);
  }

  _section(key, title, onReset, build, extra = null) {
    const collapsed = this.collapsed.has(key);
    const head = el('div', { class: 'ec-section-title' });
    const caret = el('span', { class: 'caret', text: collapsed ? '▸' : '▾' });
    caret.addEventListener('click', () => { if (collapsed) this.collapsed.delete(key); else this.collapsed.add(key); this._saveCollapsed(); this.render(); });
    head.appendChild(caret);
    if (extra && extra.badge) head.appendChild(extra.badge);
    head.appendChild(el('span', { class: 'title', text: title }));
    if (extra && extra.buttons) for (const b of extra.buttons) head.appendChild(b);
    if (onReset) {
      const r = el('span', { class: 'reset', text: '↺', title: t('Reset') });
      r.addEventListener('click', onReset);
      head.appendChild(r);
    }
    if (extra && extra.onContext) head.addEventListener('contextmenu', extra.onContext);
    this.props.appendChild(head);
    if (!collapsed) build();
  }

  _resetProps(c, keys) {
    const seq = store.seq;
    const media = c.mediaId ? store.project.media[c.mediaId] : null;
    const d = c.type === 'video' ? defaultVideoProps(seq, media) : defaultAudioProps();
    store.commit('Reset', (p) => {
      const cc = p.sequences[p.activeSequenceId].clips[c.id];
      for (const k of keys) {
        cc.props[k] = structuredClone(d[k]);
        if (k === 'anchor' && c.kind !== 'media') cc.props.anchor.v = null;
      }
      if (keys.includes('scale')) cc.props.uniformScale = true;
    });
  }

  _paramRow(c, path, name, opts = {}) {
    const p = getParam(c, path);
    if (!p) return;
    const row = el('div', { class: 'ec-row' + (opts.disabled ? ' disabled' : ''), style: opts.disabled ? { opacity: 0.45 } : null });
    const anim = isAnimated(p);
    const sw = el('span', { class: 'sw' + (anim ? ' on' : ''), html: p.static ? '' : STOPWATCH, title: p.static ? '' : t('Toggle animation') });
    if (p.static) sw.style.pointerEvents = 'none';
    sw.addEventListener('click', () => {
      store.commit(anim ? 'Disable Animation' : 'Enable Animation', (pr) => {
        const cc = pr.sequences[pr.activeSequenceId].clips[c.id];
        const pp = getParam(cc, path);
        if (path === 'props.anchor' && pp.v == null) pp.v = this._defaultAnchor(cc);
        toggleAnimation(pp, localFrame(cc));
      });
    });
    row.appendChild(sw);
    row.appendChild(el('span', { class: 'pname', text: name, title: name }));
    const val = el('div', { class: 'pval' });
    const f = localFrame(c);
    let cur = evalParam(p, f);
    if (path === 'props.anchor' && cur == null) cur = this._defaultAnchor(c);
    const setVal = (v, label, live) => {
      const fn = (pr) => {
        const cc = pr.sequences[pr.activeSequenceId].clips[c.id];
        const pp = getParam(cc, path);
        setParamAt(pp, localFrame(cc), v);
      };
      if (live) store.live(fn); else store.commit(label, fn);
      app.engine.requestRender();
    };
    const label = t('Change') + ' ' + name;
    if (opts.type === 'point') {
      const vals = [...(cur || [0, 0])];
      const mk = (i) => scrubNumber(vals[i], {
        step: opts.step || 1, decimals: opts.decimals ?? 1,
        onStart: () => { this._dragging = true; store.begin(label); },
        onChange: (v) => { vals[i] = v; setVal([...vals], label, true); },
        onEnd: () => { this._dragging = false; store.end(); },
        onCommit: (v) => { vals[i] = v; setVal([...vals], label, false); },
      });
      const a = mk(0), b = mk(1);
      val.append(a, b);
      this.valueUpdaters.push(() => { const v = evalParam(getParam(this._liveClip(), path), localFrame(this._liveClip())) || this._defaultAnchor(this._liveClip()); a.set(v[0]); b.set(v[1]); vals[0] = v[0]; vals[1] = v[1]; });
    } else if (opts.type === 'select') {
      const s = el('select');
      opts.options.forEach((o, i) => s.appendChild(el('option', { value: i, text: t(o) })));
      s.value = cur;
      s.addEventListener('change', () => setVal(+s.value, label, false));
      val.appendChild(s);
    } else if (opts.type === 'color') {
      const ci = el('input', { type: 'color', value: cur || '#000000' });
      ci.addEventListener('input', () => { if (!store._txn) store.begin(label); setVal(ci.value, label, true); });
      ci.addEventListener('change', () => store.end());
      val.appendChild(ci);
    } else if (opts.type === 'bool') {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = !!cur;
      cb.addEventListener('change', () => setVal(cb.checked, label, false));
      val.appendChild(cb);
    } else if (opts.type === 'stabdata') {
      const d = cur;
      const btn = el('button', { text: d ? t('Reanalyze') : t('Analyze'), style: { padding: '0 8px' } });
      btn.addEventListener('click', () => analyzeStabilize({ clipId: c.id, fxId: opts.fxId }));
      val.append(btn, el('span', { class: 'muted', text: d ? t('{n} frames analyzed', { n: d.raw.length }) : t('Not analyzed') }));
    } else if (opts.type === 'curves') {
      const lbl = el('span', { class: 'scrub', style: { cursor: 'pointer', borderBottom: 'none' }, text: t('Edit in Lumetri Color') });
      lbl.addEventListener('click', () => app.commands.showPanel('lumetri'));
      val.appendChild(lbl);
    } else if (opts.type === 'maskpath') {
      const n = Array.isArray(cur) ? (opts.ellipse ? 1 : Math.floor(cur.length / (opts.bezier ? 6 : 2))) : 0;
      const lbl = el('span', { class: 'scrub', style: { cursor: 'pointer', borderBottom: 'none' }, text: opts.ellipse ? t('Ellipse') : t('{n} points', { n }) });
      lbl.title = t('Edit in Program Monitor');
      lbl.addEventListener('click', () => opts.onSelect && opts.onSelect());
      val.appendChild(lbl);
    } else if (opts.type === 'lut') {
      const nameEl = el('span', { text: cur ? nodePath.basename(cur) : t('None'), style: { color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' } });
      const br = el('button', { text: t('Browse...'), style: { padding: '0 6px' } });
      br.addEventListener('click', async () => {
        const r = await ipc.invoke('dialog:open', { title: t('Choose LUT'), properties: ['openFile'], filters: [{ name: 'Cube LUT', extensions: ['cube'] }] });
        if (!r.canceled && r.filePaths.length) setVal(r.filePaths[0], label, false);
      });
      const clr = el('button', { text: '×', style: { padding: '0 6px' } });
      clr.addEventListener('click', () => setVal('', label, false));
      val.append(br, clr, nameEl);
    } else {
      const s = scrubNumber(cur ?? 0, {
        step: opts.step || 1, min: opts.min, max: opts.max, decimals: opts.decimals ?? 1, suffix: opts.suffix || '',
        onStart: () => { this._dragging = true; store.begin(label); },
        onChange: (v) => setVal(v, label, true),
        onEnd: () => { this._dragging = false; store.end(); },
        onCommit: (v) => setVal(v, label, false),
      });
      if (opts.disabled) s.style.pointerEvents = 'none';
      val.appendChild(s);
      this.valueUpdaters.push(() => { const cc = this._liveClip(); if (!cc) return; const pp = getParam(cc, path); if (pp) s.set(evalParam(pp, localFrame(cc)) ?? 0); });
    }
    row.appendChild(val);
    if (p.static !== true && opts.type !== 'lut') {
      const nav = el('span', { class: 'kfnav' });
      const prev = el('span', { text: '◀', title: t('Go to Previous Keyframe') });
      const add = el('span', { text: '◆', title: t('Add/Remove Keyframe'), class: keyframeAt(p, f) ? 'on' : '' });
      const next = el('span', { text: '▶', title: t('Go to Next Keyframe') });
      prev.addEventListener('click', () => { const k = prevKeyframe(p, localFrame(this._liveClip())); if (k) app.engine.setFrame(c.start + k.f); });
      next.addEventListener('click', () => { const k = nextKeyframe(p, localFrame(this._liveClip())); if (k) app.engine.setFrame(c.start + k.f); });
      add.addEventListener('click', () => {
        store.commit('Keyframe', (pr) => {
          const cc = pr.sequences[pr.activeSequenceId].clips[c.id];
          const pp = getParam(cc, path);
          const lf = localFrame(cc);
          if (path === 'props.anchor' && pp.v == null) pp.v = this._defaultAnchor(cc);
          if (keyframeAt(pp, lf)) removeKeyframeAt(pp, lf);
          else addKeyframe(pp, lf);
        });
      });
      if (anim) nav.append(prev, add, next);
      row.appendChild(nav);
      this.valueUpdaters.push(() => { const cc = this._liveClip(); if (!cc) return; const pp = getParam(cc, path); add.classList.toggle('on', !!keyframeAt(pp, localFrame(cc))); });
    }
    this.props.appendChild(row);
    if (p.static !== true) this.rows.push({ row, path });
    // eğri editörü: animasyonlu sayısal parametrelerde değer grafiği
    if (anim && typeof cur === 'number' && !opts.type) {
      const gb = el('span', { class: 'graph-btn' + (this.graphPath === path ? ' on' : ''), title: t('Show value graph (curve editor)'), html: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 13C5 13 5 3 9 3s4 6 6 6"/></svg>' });
      gb.addEventListener('click', (e) => { e.stopPropagation(); this.graphPath = this.graphPath === path ? null : path; this._render(); });
      row.appendChild(gb);
      if (this.graphPath === path) {
        const sp = el('div', { class: 'ec-graph-space' });
        this.props.appendChild(sp);
        this.rows.push({ row: sp, path, graph: true });
      }
    }
    return row;
  }

  _defaultAnchor(c) {
    if (!c) return [0, 0];
    if (c.kind === 'text') {
      const tc = app.compositor.textCache.get(c.id);
      return tc ? [tc.canvas.width / 2, tc.canvas.height / 2] : [0, 0];
    }
    if (c.kind === 'color' || c.kind === 'adjustment' || c.kind === 'graphic') return [store.seq.width / 2, store.seq.height / 2];
    if (c.kind === 'sequence') { const ns = store.project.sequences[c.seqId]; return ns ? [ns.width / 2, ns.height / 2] : [store.seq.width / 2, store.seq.height / 2]; }
    const m = store.project.media[c.mediaId];
    return [(m?.width || store.seq.width) / 2, (m?.height || store.seq.height) / 2];
  }

  _liveClip() {
    const s = store.seq;
    return s && this._clip ? s.clips[this._clip] : null;
  }

  _updateValues() {
    if (!this.valueUpdaters) return;
    if (!this._liveClip()) return;
    for (const u of this.valueUpdaters) { try { u(); } catch (e) { /* */ } }
  }

  // Maske düğmeleri ve maske listesi (owner: 'clip' veya efekt id)
  _masksBlock(c, owner) {
    const ICON = {
      ellipse: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="8" cy="8" rx="6" ry="4.5"/></svg>',
      polygon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10v8H3z"/></svg>',
      pen: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 13l2-6 6-5 3 3-5 6zM5 7l4 4"/></svg>',
    };
    const native = this._defaultAnchor(c).map((v) => v * 2);
    const btns = el('div', { class: 'pval' });
    for (const [type, title] of [['ellipse', t('Create ellipse mask')], ['polygon', t('Create 4-point polygon mask')], ['pen', t('Free draw mask (pen)')]]) {
      const b = el('button', { class: 'icon', html: ICON[type], title });
      b.addEventListener('click', () => {
        addMask(c.id, owner, type, native[0], native[1]);
        if (type === 'pen') toast(t('Click in the Program Monitor to add points. Click the first point to close the mask.'), 'info', 5000);
      });
      btns.appendChild(b);
    }
    const shapes = el('button', { class: 'icon', title: t('Mask Shapes'), html: '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 14s-5.5-3.4-5.5-7.2C2.5 4.6 4 3.3 5.6 3.3c1.1 0 1.9.6 2.4 1.4.5-.8 1.3-1.4 2.4-1.4 1.6 0 3.1 1.3 3.1 3.5C13.5 10.6 8 14 8 14z"/></svg>' });
    shapes.addEventListener('click', (e) => {
      const r = shapes.getBoundingClientRect();
      contextMenu(r.left, r.bottom, MG.MASK_SHAPES.map(([k, n]) => ({ label: t(n), action: () => addShapeMask(c.id, owner, k, native[0], native[1]) })));
    });
    btns.appendChild(shapes);
    this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Masks'), style: { color: 'var(--text-dim)' } }), btns));
    const list = maskList(c, owner) || [];
    list.forEach((m, i) => {
      const sm = store.ui.selectedMask;
      const sel = sm && sm.clipId === c.id && sm.maskId === m.id;
      const pre = `mask.${owner}.${m.id}`;
      const select = () => { store.ui.selectedMask = { clipId: c.id, owner, maskId: m.id }; store.emit('selection'); };
      const upd = (label, fn) => store.commit(label, (p) => { const mm = findMask(p.sequences[p.activeSequenceId].clips[c.id], owner, m.id); if (mm) fn(mm); });
      const head = el('div', { class: 'ec-row', style: { background: sel ? '#2a3f57' : '#232323', paddingLeft: '22px', cursor: 'pointer' } });
      const en = el('input', { type: 'checkbox', title: t('Toggle mask on/off') });
      en.checked = m.enabled !== false;
      en.addEventListener('click', (e) => e.stopPropagation());
      en.addEventListener('change', () => upd('Toggle Mask', (mm) => { mm.enabled = en.checked; }));
      const name = el('span', { class: 'pname', text: t('Mask') + ' (' + (i + 1) + ')', style: { flex: '0 0 auto', color: sel ? '#fff' : 'var(--text)' } });
      const mode = el('select', { title: t('Mask Mode') });
      for (const [v, l] of [['add', 'Add'], ['subtract', 'Subtract'], ['intersect', 'Intersect']]) mode.appendChild(el('option', { value: v, text: t(l) }));
      mode.value = m.mode || 'add';
      mode.addEventListener('click', (e) => e.stopPropagation());
      mode.addEventListener('change', () => upd('Mask Mode', (mm) => { mm.mode = mode.value; }));
      const inv = el('input', { type: 'checkbox' });
      inv.checked = !!m.inverted;
      inv.addEventListener('click', (e) => e.stopPropagation());
      inv.addEventListener('change', () => upd('Invert Mask', (mm) => { mm.inverted = inv.checked; }));
      const del = el('span', { class: 'del', text: '×', title: t('Delete Mask'), style: { cursor: 'pointer', color: 'var(--text-dim)', padding: '0 4px' } });
      del.addEventListener('click', (e) => { e.stopPropagation(); removeMask(c.id, owner, m.id); });
      head.append(en, name, el('div', { class: 'pval' }, mode, el('label', { style: { display: 'flex', alignItems: 'center', gap: '3px' } }, inv, t('Inverted'))), del);
      head.addEventListener('click', select);
      this.props.appendChild(head);
      const pathRow = this._paramRow(c, pre + '.path', t('Mask Path'), { type: 'maskpath', ellipse: m.type === 'ellipse', bezier: m.type === 'bezier', onSelect: select });
      if (pathRow && c.kind === 'media') {
        const pv = pathRow.querySelector('.pval');
        const meth = el('select', { title: t('Tracking Method'), style: { maxWidth: '96px' } });
        for (const [v, l] of [['psr', 'Position, Scale & Rotation'], ['position', 'Position']]) meth.appendChild(el('option', { value: v, text: t(l) }));
        meth.value = localStorage.getItem('uli.trackMethod') || 'psr';
        meth.addEventListener('change', () => localStorage.setItem('uli.trackMethod', meth.value));
        meth.addEventListener('click', (e) => e.stopPropagation());
        const tb = (txt, title, dir, single) => {
          const b = el('button', { class: 'icon', text: txt, title, style: { padding: '0 3px', fontSize: '10px' } });
          b.addEventListener('click', (e) => { e.stopPropagation(); select(); trackMask({ clipId: c.id, owner, maskId: m.id, method: meth.value, dir, single }); });
          return b;
        };
        pv.append(
          tb('◀|', t('Track selected mask backward 1 frame'), 'back', true),
          tb('◀◀', t('Track selected mask backward'), 'back', false),
          tb('▶▶', t('Track selected mask forward'), 'fwd', false),
          tb('|▶', t('Track selected mask forward 1 frame'), 'fwd', true),
          meth,
        );
      }
      this._paramRow(c, pre + '.feather', t('Mask Feather'), { step: 0.5, min: 0, max: 1000, decimals: 1 });
      this._paramRow(c, pre + '.opacity', t('Mask Opacity'), { step: 0.5, min: 0, max: 100, decimals: 1, suffix: ' %' });
      this._paramRow(c, pre + '.expansion', t('Mask Expansion'), { step: 0.5, min: -1000, max: 1000, decimals: 1 });
    });
  }

  _effectSection(c, fx, index) {
    const def = effectDef(fx.type);
    if (!def) return;
    const key = 'fx:' + fx.id;
    const badge = el('span', { class: 'fxbadge' + (fx.enabled ? '' : ' off'), text: 'fx', title: t('Toggle effect on/off') });
    badge.addEventListener('click', () => store.commit('Toggle Effect', (p) => { const f = p.sequences[p.activeSequenceId].clips[c.id].effects.find((x) => x.id === fx.id); f.enabled = !f.enabled; }));
    const del = el('span', { class: 'del', text: '×', title: t('Delete Effect') });
    del.addEventListener('click', () => store.commit('Delete Effect', (p) => { const cc = p.sequences[p.activeSequenceId].clips[c.id]; cc.effects = cc.effects.filter((x) => x.id !== fx.id); }));
    const up = el('span', { class: 'del', text: '↑', title: t('Move Up') });
    up.addEventListener('click', () => this._moveFx(c, fx.id, -1));
    const dn = el('span', { class: 'del', text: '↓', title: t('Move Down') });
    dn.addEventListener('click', () => this._moveFx(c, fx.id, 1));
    this._section(key, t(def.name), () => store.commit('Reset Effect', (p) => {
      const cc = p.sequences[p.activeSequenceId].clips[c.id];
      const i = cc.effects.findIndex((x) => x.id === fx.id);
      const n = createEffect(fx.type);
      n.id = fx.id;
      cc.effects[i] = n;
    }), () => {
      let lastSection = null;
      for (const pd of def.params) {
        if (pd.section && pd.section !== lastSection) {
          lastSection = pd.section;
          this.props.appendChild(el('div', { class: 'ec-row', style: { color: 'var(--text-dim)', fontSize: '11px', paddingLeft: '30px' }, text: t(pd.section) }));
        }
        this._paramRow(c, `fx.${fx.id}.${pd.key}`, t(pd.label), {
          type: pd.type, fxId: fx.id, step: pd.step || ((pd.max ?? 100) - (pd.min ?? 0)) / 400, min: pd.min, max: pd.max, decimals: pd.step && pd.step >= 1 ? 0 : pd.step && pd.step < 0.1 ? 2 : 1, options: pd.options, suffix: pd.suffix,
        });
      }
      if (!def.params.length) this.props.appendChild(el('div', { class: 'ec-row', style: { color: 'var(--text-dim)' }, text: t('(no parameters)') }));
      if (def.category !== 'audio') this._masksBlock(c, fx.id);
    }, {
      badge, buttons: [up, dn, del],
      onContext: (e) => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [{ label: t('Duplicate'), action: () => store.commit('Duplicate Effect', (p) => { const cc = p.sequences[p.activeSequenceId].clips[c.id]; const i = cc.effects.findIndex((x) => x.id === fx.id); const n = structuredClone(cc.effects[i]); n.id = uid('fx'); cc.effects.splice(i + 1, 0, n); }) }, { label: t('Clear'), action: () => del.click() }, '-',
        { label: t('Save as Preset...'), enabled: def.category !== 'audio', action: () => this._savePreset(c, [fx.id]) },
        { label: t('Save All Effects as Preset...'), enabled: def.category !== 'audio', action: () => this._savePreset(c, c.effects.filter((x) => EFFECTS[x.type]).map((x) => x.id)) }]); },
    });
  }

  _moveFx(c, id, d) {
    store.commit('Reorder Effect', (p) => {
      const cc = p.sequences[p.activeSequenceId].clips[c.id];
      const i = cc.effects.findIndex((x) => x.id === id);
      const j = i + d;
      if (j < 0 || j >= cc.effects.length) return false;
      [cc.effects[i], cc.effects[j]] = [cc.effects[j], cc.effects[i]];
    });
  }

  _textSection(c) {
    this._section('text', t('Text'), null, () => {
      const T = c.text;
      const upd = (label, fn, live = false) => {
        const f = (p) => fn(p.sequences[p.activeSequenceId].clips[c.id].text);
        if (live) { if (!store._txn) store.begin(label); store.live(f); }
        else store.commit(label, f);
        app.engine.requestRender();
      };
      const ta = el('textarea');
      ta.value = T.text;
      ta.addEventListener('input', () => { this._dragging = true; upd('Edit Text', (x) => { x.text = ta.value; }, true); });
      ta.addEventListener('blur', () => { this._dragging = false; store.end(); });
      ta.addEventListener('keydown', (e) => e.stopPropagation());
      this.props.appendChild(el('div', { class: 'ec-row tall' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Source Text') }), ta));
      const font = fontPicker(T.font, (f) => upd('Font', (x) => { x.font = f; }), { width: 170 });
      this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Font') }), el('div', { class: 'pval' }, font)));
      const num = (label, key, opts) => {
        const s = scrubNumber(T[key], { ...opts, onStart: () => { this._dragging = true; store.begin(label); }, onChange: (v) => upd(label, (x) => { x[key] = v; }, true), onEnd: () => { this._dragging = false; store.end(); }, onCommit: (v) => upd(label, (x) => { x[key] = v; }) });
        this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: label }), el('div', { class: 'pval' }, s)));
      };
      num(t('Font Size'), 'size', { step: 0.5, min: 1, max: 1000, decimals: 0 });
      num(t('Tracking'), 'tracking', { step: 0.2, min: -50, max: 200, decimals: 1 });
      num(t('Line Spacing'), 'lineHeight', { step: 0.005, min: 0.5, max: 4, decimals: 2 });
      const styleRow = el('div', { class: 'pval' });
      const tog = (label, key) => {
        const b = el('button', { class: 'icon' + (T[key] ? ' active' : ''), text: label, style: { fontWeight: key === 'bold' ? 700 : 400, fontStyle: key === 'italic' ? 'italic' : 'normal' } });
        b.addEventListener('click', () => upd('Text Style', (x) => { x[key] = !x[key]; }));
        return b;
      };
      styleRow.append(tog('B', 'bold'), tog('I', 'italic'));
      for (const a of ['left', 'center', 'right']) {
        const b = el('button', { class: 'icon' + (T.align === a ? ' active' : ''), text: a === 'left' ? '⯇' : a === 'right' ? '⯈' : '≡' });
        b.title = t(a[0].toUpperCase() + a.slice(1));
        b.addEventListener('click', () => upd('Align', (x) => { x.align = a; }));
        styleRow.appendChild(b);
      }
      this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Style') }), styleRow));
      const color = (label, key) => {
        const ci = el('input', { type: 'color', value: T[key] || '#ffffff' });
        ci.addEventListener('input', () => { this._dragging = true; upd(label, (x) => { x[key] = ci.value; }, true); });
        ci.addEventListener('change', () => { this._dragging = false; store.end(); });
        return ci;
      };
      const chk = (label, key) => {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = !!T[key];
        cb.addEventListener('change', () => upd(label, (x) => { x[key] = cb.checked; }));
        return cb;
      };
      this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Fill') }), el('div', { class: 'pval' }, color(t('Fill'), 'color'))));
      const strokeW = scrubNumber(T.strokeWidth, { step: 0.2, min: 0, max: 100, decimals: 1, onStart: () => { this._dragging = true; store.begin('Stroke'); }, onChange: (v) => upd('Stroke', (x) => { x.strokeWidth = v; }, true), onEnd: () => { this._dragging = false; store.end(); }, onCommit: (v) => upd('Stroke', (x) => { x.strokeWidth = v; }) });
      this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Stroke') }), el('div', { class: 'pval' }, color(t('Stroke'), 'strokeColor'), strokeW)));
      const sb = scrubNumber(T.shadowBlur, { step: 0.5, min: 0, max: 200, decimals: 0, onStart: () => { this._dragging = true; store.begin('Shadow'); }, onChange: (v) => upd('Shadow', (x) => { x.shadowBlur = v; }, true), onEnd: () => { this._dragging = false; store.end(); }, onCommit: (v) => upd('Shadow', (x) => { x.shadowBlur = v; }) });
      const sd = scrubNumber(T.shadowDist, { step: 0.5, min: -200, max: 200, decimals: 0, onStart: () => { this._dragging = true; store.begin('Shadow'); }, onChange: (v) => upd('Shadow', (x) => { x.shadowDist = v; }, true), onEnd: () => { this._dragging = false; store.end(); }, onCommit: (v) => upd('Shadow', (x) => { x.shadowDist = v; }) });
      this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Shadow') }), el('div', { class: 'pval' }, chk(t('Shadow'), 'shadow'), color(t('Shadow'), 'shadowColor'), sb, sd)));
      const bo = scrubNumber(T.bgOpacity, { step: 0.5, min: 0, max: 100, decimals: 0, suffix: '%', onStart: () => { this._dragging = true; store.begin('Background'); }, onChange: (v) => upd('Background', (x) => { x.bgOpacity = v; }, true), onEnd: () => { this._dragging = false; store.end(); }, onCommit: (v) => upd('Background', (x) => { x.bgOpacity = v; }) });
      const bp = scrubNumber(T.bgPadding, { step: 0.5, min: 0, max: 300, decimals: 0, onStart: () => { this._dragging = true; store.begin('Background'); }, onChange: (v) => upd('Background', (x) => { x.bgPadding = v; }, true), onEnd: () => { this._dragging = false; store.end(); }, onCommit: (v) => upd('Background', (x) => { x.bgPadding = v; }) });
      this.props.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Background') }), el('div', { class: 'pval' }, chk(t('Background'), 'bgEnabled'), color(t('Background'), 'bgColor'), bo, bp)));
    });
  }

  _renderTransition(seq, st) {
    const c = seq.clips[st.clipId];
    const tr = st.which === 'in' ? c.transIn : c.transOut;
    if (!tr) return;
    this.props.appendChild(el('div', { class: 'ec-head', text: t('Transition') + ': ' + t(TRANSITIONS[tr.type]?.name || tr.type) }));
    const typeSel = el('select');
    for (const [k, d] of Object.entries(TRANSITIONS)) if ((d.category === 'audio') === (c.type === 'audio')) typeSel.appendChild(el('option', { value: k, text: t(d.name) }));
    typeSel.value = tr.type;
    typeSel.addEventListener('change', () => store.commit('Transition Type', (p) => { const cc = p.sequences[p.activeSequenceId].clips[c.id]; (st.which === 'in' ? cc.transIn : cc.transOut).type = typeSel.value; }));
    const dur = el('input', { type: 'text', style: { width: '110px', fontFamily: 'var(--mono)' } });
    dur.value = framesToTC(tr.duration, seq.fps);
    dur.addEventListener('change', () => {
      const f = parseTC(dur.value, seq.fps);
      if (f) store.commit('Transition Duration', (p) => { const cc = p.sequences[p.activeSequenceId].clips[c.id]; (st.which === 'in' ? cc.transIn : cc.transOut).duration = Math.max(1, f); });
    });
    dur.addEventListener('keydown', (e) => e.stopPropagation());
    const del = el('button', { text: t('Clear') });
    del.addEventListener('click', () => app.commands.run('edit.delete'));
    this.props.append(
      el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Type') }), el('div', { class: 'pval' }, typeSel)),
      el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Duration') }), el('div', { class: 'pval' }, dur)),
      st.which === 'in' ? el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname', text: t('Alignment') }), el('div', { class: 'pval' }, (() => {
        const sel = el('select');
        for (const [v, l] of [['center', 'Center at Cut'], ['start', 'Start at Cut'], ['end', 'End at Cut']]) sel.appendChild(el('option', { value: v, text: t(l) }));
        sel.value = tr.align || 'center';
        sel.addEventListener('change', () => store.commit('Transition Alignment', (p) => { p.sequences[p.activeSequenceId].clips[c.id].transIn.align = sel.value; }));
        return sel;
      })())) : el('span'),
      el('div', { class: 'ec-row' }, el('span', { class: 'sw' }), el('span', { class: 'pname' }), el('div', { class: 'pval' }, del)),
    );
  }

  // ---- Keyframe alanı ----
  drawKf() {
    if (!this.kf) return;
    const dpr = window.devicePixelRatio || 1;
    const w = this.kf.clientWidth, h = this.kf.clientHeight;
    if (!w || !h) return;
    const cv = this.kfCanvas;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(0, 0, w, h);
    const c = this._liveClip();
    const seq = store.seq;
    ctx.fillStyle = '#252525';
    ctx.fillRect(0, 0, w, 24);
    if (!c || !seq) return;
    const pad = 8;
    const W = w - pad * 2;
    const xOf = (f) => pad + (f / Math.max(1, c.duration - 1)) * W;
    // üst cetvel
    ctx.fillStyle = '#8a8a8a';
    ctx.font = '10px Consolas, monospace';
    ctx.fillText(framesToTC(c.start, seq.fps), pad, 15);
    const endTxt = framesToTC(c.start + c.duration, seq.fps);
    ctx.fillText(endTxt, w - pad - ctx.measureText(endTxt).width, 15);
    // klip aralığı çubuğu
    ctx.fillStyle = 'rgba(116,114,196,0.25)';
    ctx.fillRect(pad, 20, W, 4);
    const top = this.props.getBoundingClientRect().top;
    const sel = store.ui.selectedKeyframes;
    this.graphGeo = null;
    for (const r of this.rows) {
      const rr = r.row.getBoundingClientRect();
      if (r.graph) { this._drawGraph(ctx, c, r, rr.top - top, rr.height, w, h, pad, W, xOf); continue; }
      const y = rr.top - top + rr.height / 2;
      if (y < 24 || y > h) continue;
      const p = getParam(c, r.path);
      if (!p) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(0, y - rr.height / 2, w, rr.height - 1);
      if (!isAnimated(p)) continue;
      ctx.strokeStyle = 'rgba(240,192,64,0.25)';
      ctx.beginPath(); ctx.moveTo(xOf(p.kf[0].f), y); ctx.lineTo(xOf(p.kf[p.kf.length - 1].f), y); ctx.stroke();
      for (const k of p.kf) {
        const x = xOf(k.f);
        const isSel = sel.some((s) => s.clipId === c.id && s.path === r.path && s.f === k.f);
        ctx.fillStyle = isSel ? '#ffffff' : '#f0c040';
        ctx.beginPath();
        if (k.e === 'hold') { ctx.rect(x - 4, y - 4, 8, 8); }
        else if (k.e && k.e !== 'linear') { ctx.arc(x, y, 4.5, 0, Math.PI * 2); }
        else { ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); }
        ctx.fill();
      }
      r.y = y;
    }
    // oynatma kafası
    const lf = app.engine.currentFrame - c.start;
    if (lf >= 0 && lf < c.duration) {
      const x = Math.round(xOf(lf)) + 0.5;
      ctx.strokeStyle = '#2d8ceb';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.fillStyle = '#2d8ceb';
      ctx.beginPath(); ctx.moveTo(x - 5, 14); ctx.lineTo(x + 5, 14); ctx.lineTo(x, 22); ctx.closePath(); ctx.fill();
    }
  }

  // Değer grafiği: eğri, keyframe kareleri ve bezier tutamakları
  _drawGraph(ctx, c, r, y0, gh, w, h, pad, W, xOf) {
    if (y0 + gh < 24 || y0 > h || gh < 20) return;
    const p = getParam(c, r.path);
    if (!isAnimated(p)) return;
    const k = p.kf;
    const top = y0 + 8, bot = y0 + gh - 8;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, Math.max(24, y0), w, gh); ctx.clip();
    ctx.fillStyle = '#141414'; ctx.fillRect(0, y0, w, gh);
    // değer aralığı (eğri + tutamaklar)
    const n = Math.max(2, Math.round(W));
    const samples = [];
    for (let i = 0; i <= n; i++) { const f = (i / n) * (c.duration - 1); samples.push([pad + (i / n) * W, evalParam(p, f)]); }
    let lo = Infinity, hi = -Infinity;
    for (const [, v] of samples) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let i = 0; i < k.length; i++) {
      if (k[i].ho) { lo = Math.min(lo, k[i].v + k[i].ho[1]); hi = Math.max(hi, k[i].v + k[i].ho[1]); }
      if (k[i].hi) { lo = Math.min(lo, k[i].v + k[i].hi[1]); hi = Math.max(hi, k[i].v + k[i].hi[1]); }
    }
    if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
    const m = (hi - lo) * 0.08; lo -= m; hi += m;
    const yOf = (v) => bot - ((v - lo) / (hi - lo)) * (bot - top);
    const vOf = (yy) => lo + ((bot - yy) / (bot - top)) * (hi - lo);
    // ızgara ve etiketler
    ctx.strokeStyle = '#262626'; ctx.lineWidth = 1;
    ctx.fillStyle = '#6a6a6a'; ctx.font = '10px Consolas, monospace';
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4, yy = Math.round(yOf(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(pad, yy); ctx.lineTo(w - pad, yy); ctx.stroke();
      ctx.fillText((Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)), pad + 2, yy - 2);
    }
    // eğri
    ctx.strokeStyle = '#f0c040'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    samples.forEach(([x, v], i) => { const yy = yOf(v); if (i) ctx.lineTo(x, yy); else ctx.moveTo(x, yy); });
    ctx.stroke();
    // tutamaklar ve keyframe'ler
    const items = [];
    const sel = store.ui.selectedKeyframes;
    for (let i = 0; i < k.length; i++) {
      const a = k[i], x = xOf(a.f), yy = yOf(a.v);
      const hnd = (type, hx, hv) => {
        const px = xOf(hx), py = yOf(hv);
        ctx.strokeStyle = '#8fb4ff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(px, py); ctx.stroke();
        ctx.fillStyle = '#8fb4ff'; ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill();
        items.push({ type, idx: i, x: px, y: py });
      };
      if (i < k.length - 1 && a.e === 'bezier') { const ho = a.ho || [1 / 3, 0]; hnd('ho', a.f + ho[0] * (k[i + 1].f - a.f), a.v + ho[1]); }
      if (i > 0 && k[i - 1].e === 'bezier') { const hi2 = a.hi || [1 / 3, 0]; hnd('hi', a.f - hi2[0] * (a.f - k[i - 1].f), a.v + hi2[1]); }
      const isSel = sel.some((s) => s.clipId === c.id && s.path === r.path && s.f === a.f);
      ctx.fillStyle = isSel ? '#ffffff' : '#f0c040';
      ctx.fillRect(x - 4, yy - 4, 8, 8);
      items.push({ type: 'kf', idx: i, x, y: yy });
    }
    ctx.restore();
    this.graphGeo = { path: r.path, c, y0, gh, top, bot, xOf, yOf, vOf, pad, W, items };
  }

  // Grafikte tıklama: keyframe (zaman + değer) ya da tutamak sürükleme. İşlendiyse true
  _graphDown(e) {
    const G = this.graphGeo;
    if (!G) return false;
    const r = this.kf.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (y < G.y0 || y > G.y0 + G.gh) return false;
    const it = G.items.filter((q) => Math.hypot(q.x - x, q.y - y) <= 7).sort((a, b) => (a.type === 'kf') - (b.type === 'kf'))[0];
    const c = G.c, path = G.path;
    if (!it) {
      const f = clamp(Math.round(((x - G.pad) / G.W) * (c.duration - 1)), 0, c.duration - 1);
      app.engine.setFrame(c.start + f);
      return true;
    }
    const p0 = getParam(c, path);
    const k0 = p0.kf[it.idx];
    if (it.type === 'kf') store.ui.selectedKeyframes = [{ clipId: c.id, path, f: k0.f }];
    const fOf = (xx) => ((xx - G.pad) / G.W) * (c.duration - 1);
    let begun = false;
    const x0 = e.clientX, y0 = e.clientY;
    const mv = (ev) => {
      if (!begun && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      if (!begun) { store.begin(it.type === 'kf' ? 'Move Keyframe' : 'Bezier Handle'); begun = true; this._dragging = true; }
      const lx = ev.clientX - r.left, ly = ev.clientY - r.top;
      store.live((pr) => {
        const cc = pr.sequences[pr.activeSequenceId].clips[c.id];
        const p = getParam(cc, path);
        const K = p.kf;
        const i = it.idx;
        const a = K[i];
        if (!a) return;
        if (it.type === 'kf') {
          const prev = K[i - 1], next = K[i + 1];
          let nf = Math.round(fOf(lx));
          nf = clamp(nf, prev ? prev.f + 1 : 0, next ? next.f - 1 : c.duration - 1);
          if (ev.shiftKey) nf = a.f; // Shift: yalnız değer
          a.f = nf;
          a.v = Math.round(G.vOf(ly) * 100) / 100;
          store.ui.selectedKeyframes = [{ clipId: c.id, path, f: nf }];
        } else if (it.type === 'ho') {
          const b = K[i + 1];
          const span = b.f - a.f || 1;
          a.e = 'bezier';
          a.ho = [clamp((fOf(lx) - a.f) / span, 0, 1), G.vOf(ly) - a.v];
          // tutamaklar birlikte döner (Alt: bağımsız)
          if (!ev.altKey && i > 0 && K[i - 1].e === 'bezier') {
            const spanIn = a.f - K[i - 1].f || 1, hi0 = a.hi || [1 / 3, 0];
            const slope = a.ho[1] / Math.max(1e-6, a.ho[0] * span);
            a.hi = [hi0[0], -slope * hi0[0] * spanIn];
          }
        } else {
          const pv = K[i - 1];
          const span = a.f - pv.f || 1;
          pv.e = 'bezier';
          a.hi = [clamp((a.f - fOf(lx)) / span, 0, 1), G.vOf(ly) - a.v];
          if (!ev.altKey && i < K.length - 1 && a.e === 'bezier') {
            const spanOut = K[i + 1].f - a.f || 1, ho0 = a.ho || [1 / 3, 0];
            const slope = -a.hi[1] / Math.max(1e-6, a.hi[0] * span);
            a.ho = [ho0[0], slope * ho0[0] * spanOut];
          }
        }
      });
      app.engine.requestRender();
      this._drawKf();
    };
    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      this._dragging = false;
      if (begun) store.end();
      else if (it.type === 'kf') app.engine.setFrame(c.start + k0.f);
      this._drawKf();
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    return true;
  }

  _kfHit(e) {
    const c = this._liveClip();
    if (!c) return null;
    const r = this.kf.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const pad = 8, W = r.width - pad * 2;
    const xOf = (f) => pad + (f / Math.max(1, c.duration - 1)) * W;
    const fOf = (xx) => clamp(Math.round(((xx - pad) / W) * (c.duration - 1)), 0, c.duration - 1);
    for (const row of this.rows) {
      if (row.y == null || Math.abs(row.y - y) > 8) continue;
      const p = getParam(c, row.path);
      if (!isAnimated(p)) continue;
      for (const k of p.kf) if (Math.abs(xOf(k.f) - x) <= 6) return { c, path: row.path, k, fOf, x, y };
    }
    return { c, fOf, x, y };
  }

  _kfDown(e) {
    if (e.button !== 0) return;
    if (this._graphDown(e)) return;
    const h = this._kfHit(e);
    if (!h) return;
    const c = h.c;
    if (!h.k) {
      store.ui.selectedKeyframes = [];
      const set = (ev) => {
        const r = this.kf.getBoundingClientRect();
        app.engine.setFrame(c.start + h.fOf(ev.clientX - r.left));
      };
      set(e);
      const mv = (ev) => set(ev);
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
      this._drawKf();
      return;
    }
    const path = h.path;
    const f0 = h.k.f;
    store.ui.selectedKeyframes = [{ clipId: c.id, path, f: f0 }];
    this._drawKf();
    const x0 = e.clientX;
    let begun = false;
    const r = this.kf.getBoundingClientRect();
    const mv = (ev) => {
      if (!begun && Math.abs(ev.clientX - x0) < 3) return;
      if (!begun) { store.begin('Move Keyframe'); begun = true; this._dragging = true; }
      const nf = h.fOf(ev.clientX - r.left);
      store.live((pr) => {
        const cc = pr.sequences[pr.activeSequenceId].clips[c.id];
        const p = getParam(cc, path);
        const cur = store.ui.selectedKeyframes[0].f;
        const k = p.kf.find((x) => x.f === cur);
        if (!k || p.kf.some((x) => x !== k && x.f === nf)) return;
        k.f = nf;
        p.kf.sort((a, b) => a.f - b.f);
        store.ui.selectedKeyframes = [{ clipId: c.id, path, f: nf }];
      });
      this._drawKf();
    };
    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      this._dragging = false;
      if (begun) store.end();
      else app.engine.setFrame(c.start + f0);
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  }

  _kfContext(e) {
    e.preventDefault();
    const h = this._kfHit(e);
    if (!h || !h.k) return;
    const { c, path } = h;
    const f = h.k.f;
    const setE = (en) => store.commit('Keyframe Interpolation', (pr) => { const p = getParam(pr.sequences[pr.activeSequenceId].clips[c.id], path); const k = p.kf.find((x) => x.f === f); if (k) k.e = en; });
    contextMenu(e.clientX, e.clientY, [
      { label: t('Linear'), checked: (h.k.e || 'linear') === 'linear', action: () => setE('linear') },
      { label: t('Hold'), checked: h.k.e === 'hold', action: () => setE('hold') },
      { label: t('Ease In'), checked: h.k.e === 'easeIn', action: () => setE('easeIn') },
      { label: t('Ease Out'), checked: h.k.e === 'easeOut', action: () => setE('easeOut') },
      { label: t('Ease In/Out'), checked: h.k.e === 'ease', action: () => setE('ease') },
      { label: t('Bezier (curve editor)'), checked: h.k.e === 'bezier', action: () => { setE('bezier'); this.graphPath = path; this._render(); } },
      '-',
      { label: t('Delete'), action: () => store.commit('Delete Keyframe', (pr) => { const p = getParam(pr.sequences[pr.activeSequenceId].clips[c.id], path); removeKeyframeAt(p, f); }) },
    ]);
  }

  deleteSelectedKeyframes() {
    const sk = store.ui.selectedKeyframes.filter((k) => k.path);
    if (!sk.length) return false;
    store.commit('Delete Keyframe', (pr) => {
      const s = pr.sequences[pr.activeSequenceId];
      for (const k of sk) {
        const p = getParam(s.clips[k.clipId], k.path);
        if (p) removeKeyframeAt(p, k.f);
      }
    });
    store.ui.selectedKeyframes = [];
    return true;
  }
}
