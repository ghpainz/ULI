// Efektler, Lumetri, Ses Mikseri, İşaretçiler, Geçmiş panelleri
import { store } from '../store.js';
import { app } from '../appContext.js';
import { t } from '../i18n.js';
import { el, clamp, framesToTC, rafThrottle, ipc, nodePath, dbToGain, gainToDb } from '../util.js';
import { EFFECTS, EFFECT_GROUPS, effectGroups, TRANSITIONS, AUDIO_EFFECTS, AUDIO_EFFECT_GROUPS } from '../effectsDef.js';
import { evalParam, setParamAt } from '../keyframes.js';
import { createEffect } from '../model.js';
import { settings, saveSettings } from '../settings.js';
import { contextMenu, toast } from '../ui/dialogs.js';
import { DEFAULT_CURVES, monotoneSpline, periodicSpline } from '../curves.js';
import { applyClipAnim, PRESETS, PRESET_GROUPS, presetById, applyPreset, userPresets, deleteUserPreset, favorites, isFavorite, toggleFavorite } from '../presets.js';
import { drawThumb, THUMB_W, THUMB_H, sampleCanvas } from '../fxPreview.js';
import { ANIM_IN, ANIM_OUT, ANIM_COMBO, drawAnimThumb } from '../clipAnim.js';

// ===================== EFEKTLER =====================
// Liste veya ızgara (canlı küçük resimli) görünüm; favoriler, hazır ayarlar (look/hareket) ve kullanıcı ön ayarları
export class EffectsPanel {
  constructor() {
    this.id = 'effects';
    this.open = new Set(JSON.parse(localStorage.getItem('uli.fxOpen') || '["fav","presets","vfx","vtr"]'));
    this.filter = '';
    this.view = localStorage.getItem('uli.fxView') || 'grid';
  }
  title() { return t('Effects'); }
  mount(body) {
    const tb = el('div', { class: 'toolbar' });
    this.search = el('input', { type: 'text', placeholder: t('Search effects'), style: { flex: '1' } });
    this.search.addEventListener('input', () => { this.filter = this.search.value.toLowerCase(); this.render(); });
    const vbtn = (mode, svg, tip) => {
      const b = el('button', { class: 'icon', title: tip, html: svg });
      b.addEventListener('click', () => { this.view = mode; localStorage.setItem('uli.fxView', mode); this.render(); });
      return b;
    };
    this.listBtn = vbtn('list', '<svg viewBox="0 0 16 16"><path d="M2 3h12v2H2zM2 7h12v2H2zM2 11h12v2H2z"/></svg>', t('List View'));
    this.gridBtn = vbtn('grid', '<svg viewBox="0 0 16 16"><path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z"/></svg>', t('Thumbnail View'));
    tb.append(this.search, this.listBtn, this.gridBtn);
    this.tree = el('div', { class: 'tree' });
    body.append(tb, this.tree);
    app.effectsPanel = this;
    this.io = new IntersectionObserver((ents) => {
      for (const en of ents) if (en.isIntersecting && !en.target._drawn) { en.target._drawn = true; en.target._paint(0.5); }
    }, { root: this.tree, rootMargin: '100px' });
    this.render();
  }
  _folder(key, label, children, icon = '📁') {
    const open = this.filter ? true : this.open.has(key);
    const f = el('div', { class: 'tree-folder' });
    const row = el('div', { class: 'tree-row' }, el('span', { class: 'caret', text: open ? '▾' : '▸' }), el('span', { text: icon }), el('span', { text: label }));
    row.addEventListener('click', () => { if (this.open.has(key)) this.open.delete(key); else this.open.add(key); localStorage.setItem('uli.fxOpen', JSON.stringify([...this.open])); this.render(); });
    const leaves = children.length && children.every((c) => c._leaf);
    const ch = el('div', { class: 'tree-children' + (open ? '' : ' collapsed') + (leaves && this.view === 'grid' ? ' fx-grid' : '') });
    if (open) for (const c of children) ch.appendChild(c);
    f.append(row, ch);
    return f;
  }
  _what(kind, type) {
    if (kind === 'preset') { const pr = presetById(type); return { kind: 'preset', effects: pr ? pr.effects : [] }; }
    return { kind, type };
  }
  _item(kind, type, name, cls, isDefault) {
    const fav = isFavorite(kind + ':' + type);
    const label = t(name) + (isDefault ? '  ★' : '');
    let r;
    if (this.view === 'grid' && cls !== 'afx') {
      const cv = el('canvas', { width: THUMB_W, height: THUMB_H, class: 'fx-thumb' });
      cv._what = this._what(kind, type);
      cv._paint = kind === 'anim' ? (ph) => drawAnimThumb(cv, sampleCanvas(), type.split(':')[0], type.split(':')[1], ph) : (ph) => drawThumb(cv, cv._what, ph);
      r = el('div', { class: 'fx-tile', draggable: 'true', title: label }, cv, el('div', { class: 'fx-tile-name', text: (fav ? '★ ' : '') + label }));
      r._thumb = cv;
      let raf = 0, t0 = 0;
      const period = kind === 'transition' || kind === 'anim' ? 1600 : 4000;
      const loop = (ts) => { if (!t0) t0 = ts; cv._paint(((ts - t0) / period) % 1); raf = requestAnimationFrame(loop); };
      r.addEventListener('mouseenter', () => { t0 = 0; raf = requestAnimationFrame(loop); });
      r.addEventListener('mouseleave', () => { cancelAnimationFrame(raf); cv._paint(kind === 'anim' && type.startsWith('out') ? 0 : 0.5); });
    } else {
      r = el('div', { class: 'tree-row', draggable: 'true', title: label }, el('span', { class: 'fx-icon ' + cls }), el('span', { text: (fav ? '★ ' : '') + label }));
    }
    r._leaf = true;
    r._label = name;
    r.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-uli-effect', JSON.stringify({ kind, type }));
      e.dataTransfer.effectAllowed = 'copy';
    });
    r.addEventListener('dblclick', () => this._apply(kind, type));
    r.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const items = [
        { label: t('Apply to Selected Clips'), action: () => this._apply(kind, type) },
        { label: isFavorite(kind + ':' + type) ? t('Remove from Favorites') : t('Add to Favorites'), action: () => { toggleFavorite(kind + ':' + type); this.render(); } },
      ];
      if (kind === 'transition') items.push({ label: t('Set Selected as Default Transition'), action: () => {
        if (TRANSITIONS[type].category === 'audio') settings.defaultAudioTransition = type; else settings.defaultVideoTransition = type;
        saveSettings(); this.render();
      } });
      if (kind === 'preset' && presetById(type)?.user) items.push('-', { label: t('Delete Preset'), action: () => { deleteUserPreset(type); this.render(); } });
      contextMenu(e.clientX, e.clientY, items);
    });
    return r;
  }
  _apply(kind, type) {
    const sel = store.selectedClips();
    if (!sel.length) { toast(t('Select a clip in the timeline first')); return; }
    if (kind === 'effect') app.commands.applyEffect(sel.map((c) => c.id), type);
    else if (kind === 'preset') applyPreset(sel.map((c) => c.id), type);
    else if (kind === 'anim') applyClipAnim(sel.map((c) => c.id), type);
    else {
      const cat = TRANSITIONS[type].category;
      store.begin('Apply Transition');
      for (const c of sel.filter((x) => (x.type === 'audio') === (cat === 'audio'))) {
        app.commands.applyTransition(c.id, 'start', type);
        app.commands.applyTransition(c.id, 'end', type);
      }
      store.end();
    }
  }
  _itemFor(key) {
    const i = key.indexOf(':');
    const kind = key.slice(0, i), type = key.slice(i + 1);
    if (kind === 'effect') { const d = EFFECTS[type] || AUDIO_EFFECTS[type]; return d ? this._item('effect', type, d.name, d.category === 'audio' ? 'afx' : 'vfx') : null; }
    if (kind === 'anim') { const [k, ty] = type.split(':'); const it = { in: ANIM_IN, out: ANIM_OUT, combo: ANIM_COMBO }[k]?.find((x) => x[0] === ty); return it ? this._item('anim', type, it[1], 'anim') : null; }
    if (kind === 'transition') { const d = TRANSITIONS[type]; return d ? this._item('transition', type, d.name, d.category === 'audio' ? 'afx' : 'trans') : null; }
    const pr = presetById(type);
    return pr ? this._item('preset', type, pr.name, 'preset') : null;
  }
  render() {
    this.tree.innerHTML = '';
    this.io?.disconnect();
    this.listBtn?.classList.toggle('active', this.view === 'list');
    this.gridBtn?.classList.toggle('active', this.view === 'grid');
    const match = (n) => !this.filter || t(n).toLowerCase().includes(this.filter) || n.toLowerCase().includes(this.filter);
    // favoriler
    const favs = favorites().map((k) => this._itemFor(k)).filter((it) => it && match(it._label));
    if (favs.length) this.tree.appendChild(this._folder('fav', t('Favorites'), favs, '★'));
    // hazır ayarlar
    const pre = [];
    for (const g of PRESET_GROUPS) {
      const items = Object.entries(PRESETS).filter(([, d]) => d.group === g && match(d.name)).map(([k, d]) => this._item('preset', k, d.name, 'preset'));
      if (items.length) pre.push(this._folder('pre:' + g, t(g), items));
    }
    const mine = userPresets().filter((d) => match(d.name)).map((d) => this._item('preset', d.id, d.name, 'preset'));
    if (mine.length) pre.push(this._folder('pre:mine', t('My Presets'), mine));
    if (pre.length) this.tree.appendChild(this._folder('presets', t('Presets'), pre, '✨'));
    // klip animasyonları
    const an = [];
    for (const [k, list, label] of [['in', ANIM_IN, 'In'], ['out', ANIM_OUT, 'Out'], ['combo', ANIM_COMBO, 'Combo']]) {
      const items = list.filter(([, n]) => match(n)).map(([ty, n]) => this._item('anim', k + ':' + ty, n, 'anim'));
      if (items.length) an.push(this._folder('anim:' + k, t(label), items));
    }
    if (an.length) this.tree.appendChild(this._folder('anims', t('Clip Animations'), an, '🎬'));
    // video efektleri
    const vfx = [];
    for (const g of effectGroups()) {
      const items = Object.entries(EFFECTS).filter(([, d]) => d.group === g && match(d.name)).map(([k, d]) => this._item('effect', k, d.name, 'vfx'));
      if (items.length) vfx.push(this._folder('vfx:' + g, t(g), items));
    }
    if (vfx.length) this.tree.appendChild(this._folder('vfx', t('Video Effects'), vfx));
    const groupsT = [...new Set(Object.values(TRANSITIONS).filter((d) => d.category === 'video').map((d) => d.group))];
    const vtr = [];
    for (const g of groupsT) {
      const items = Object.entries(TRANSITIONS).filter(([, d]) => d.category === 'video' && d.group === g && match(d.name)).map(([k, d]) => this._item('transition', k, d.name, 'trans', settings.defaultVideoTransition === k));
      if (items.length) vtr.push(this._folder('vtr:' + g, t(g), items));
    }
    if (vtr.length) this.tree.appendChild(this._folder('vtr', t('Video Transitions'), vtr));
    const afx = [];
    for (const g of AUDIO_EFFECT_GROUPS) {
      const items = Object.entries(AUDIO_EFFECTS).filter(([, d]) => d.group === g && match(d.name)).map(([k, d]) => this._item('effect', k, d.name, 'afx'));
      if (items.length) afx.push(this._folder('afx:' + g, t(g), items));
    }
    if (afx.length) this.tree.appendChild(this._folder('afx', t('Audio Effects'), afx));
    const atr = Object.entries(TRANSITIONS).filter(([, d]) => d.category === 'audio' && match(d.name)).map(([k, d]) => this._item('transition', k, d.name, 'afx', settings.defaultAudioTransition === k));
    if (atr.length) this.tree.appendChild(this._folder('atr', t('Audio Transitions'), [this._folder('atr:cf', t('Crossfade'), atr)]));
    // görünür küçük resimleri tembel çiz
    for (const cv of this.tree.querySelectorAll('canvas.fx-thumb')) this.io?.observe(cv);
  }
}

// ===================== LUMETRI =====================
function lumClip() {
  const sel = store.selectedClips().filter((c) => c.type === 'video');
  return sel.length === 1 ? sel[0] : null;
}

export class LumetriPanel {
  constructor() {
    this.id = 'lumetri';
    this.collapsed = new Set(JSON.parse(localStorage.getItem('uli.lumCollapsed') || '[]'));
    this._render = rafThrottle(() => this.render());
  }
  title() { return t('Lumetri Color'); }
  mount(body) {
    this.root = el('div', { class: 'lumetri' });
    body.appendChild(this.root);
    store.on('change', (info) => { if (!(info && info.live && this._dragging)) this._render(); });
    store.on('selection', () => this._render());
    app.engine.on('frame', () => { if (!app.engine.playing) this._updateValues(); });
    this.render();
  }
  onShow() { this.render(); }

  _fx(c) { return c ? c.effects.find((f) => f.type === 'lumetri') : null; }

  // Değeri yaz: lumetri yoksa oluştur
  _set(c, key, v, live) {
    const fn = (p) => {
      const cc = p.sequences[p.activeSequenceId].clips[c.id];
      let fx = cc.effects.find((f) => f.type === 'lumetri');
      if (!fx) { fx = createEffect('lumetri'); cc.effects.push(fx); }
      if (!fx.params[key]) {
        const pd = EFFECTS.lumetri.params.find((x) => x.key === key);
        fx.params[key] = { v: structuredClone(pd.default), kf: null, static: pd.animatable === false };
      }
      setParamAt(fx.params[key], clamp(app.engine.currentFrame - cc.start, 0, cc.duration - 1), v);
    };
    if (live) store.live(fn); else store.commit(t('Lumetri Color'), fn);
    app.engine.requestRender();
  }

  _val(c, key) {
    const fx = this._fx(c);
    const pd = EFFECTS.lumetri.params.find((p) => p.key === key);
    if (!fx) return structuredClone(pd.default);
    return evalParam(fx.params[key], clamp(app.engine.currentFrame - c.start, 0, c.duration - 1));
  }

  _section(key, title, build) {
    const s = el('div', { class: 'lum-section' + (this.collapsed.has(key) ? ' collapsed' : '') });
    const head = el('div', { class: 'lum-title' }, el('span', { text: this.collapsed.has(key) ? '▸' : '▾' }), el('span', { text: title }));
    head.addEventListener('click', () => { if (this.collapsed.has(key)) this.collapsed.delete(key); else this.collapsed.add(key); localStorage.setItem('uli.lumCollapsed', JSON.stringify([...this.collapsed])); this.render(); });
    const b = el('div', { class: 'lum-body' });
    s.append(head, b);
    this.root.appendChild(s);
    if (!this.collapsed.has(key)) build(b);
  }

  _check(parent, c, key) {
    const pd = EFFECTS.lumetri.params.find((p) => p.key === key);
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!this._val(c, key);
    cb.addEventListener('change', () => this._set(c, key, cb.checked, false));
    parent.appendChild(el('label', { class: 'lum-row', style: { gap: '6px' } }, cb, t(pd.label)));
    this.updaters.push(() => { const cc = this._liveClip(); if (cc) cb.checked = !!this._val(cc, key); });
  }

  // Seçili ton aralığını gösteren şerit
  _hueStrip(parent, c) {
    const cv = el('canvas', { width: 360, height: 14, style: { width: '100%', height: '14px', borderRadius: '2px', display: 'block', margin: '4px 0 6px' } });
    const draw = () => {
      const cc = this._liveClip() || c;
      const hue = this._val(cc, 'hslHue'), range = this._val(cc, 'hslHueRange');
      const ctx = cv.getContext('2d');
      for (let x = 0; x < 360; x++) {
        let d = Math.abs(x - hue); d = Math.min(d, 360 - d);
        const on = d <= range / 2;
        ctx.fillStyle = `hsl(${x},${on ? 85 : 30}%,${on ? 50 : 22}%)`;
        ctx.fillRect(x, 0, 1, 14);
      }
      ctx.fillStyle = '#fff';
      ctx.fillRect(Math.round(hue) - 1, 0, 2, 14);
    };
    parent.appendChild(cv);
    this.updaters.push(draw);
    draw();
    return draw;
  }

  _slider(parent, c, key) {
    const pd = EFFECTS.lumetri.params.find((p) => p.key === key);
    const step = pd.step || 1;
    const range = el('input', { type: 'range', min: pd.min, max: pd.max, step });
    const num = el('span', { class: 'num' });
    const v = this._val(c, key);
    range.value = v;
    num.textContent = (+v).toFixed(step < 1 ? 2 : 0);
    range.addEventListener('input', () => {
      if (!this._dragging) { this._dragging = true; store.begin(t(pd.label)); }
      num.textContent = (+range.value).toFixed(step < 1 ? 2 : 0);
      this._set(c, key, +range.value, true);
    });
    range.addEventListener('change', () => { this._dragging = false; store.end(); });
    range.addEventListener('dblclick', () => { range.value = pd.default; this._set(c, key, pd.default, false); });
    const lab = el('label', { text: t(pd.label), title: t('Double-click to reset') });
    lab.addEventListener('dblclick', () => this._set(c, key, pd.default, false));
    parent.appendChild(el('div', { class: 'lum-slider' }, lab, range, num));
    this.updaters.push(() => { const cc = this._liveClip(); if (!cc) return; const vv = this._val(cc, key); range.value = vv; num.textContent = (+vv).toFixed(step < 1 ? 2 : 0); });
  }

  _wheel(parent, c, key, lumKey, label) {
    const size = 104;
    const cv = el('canvas', { width: size, height: size, style: { width: size + 'px', height: size + 'px' } });
    const draw = () => {
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, size, size);
      const r = size / 2 - 3;
      for (let a = 0; a < 360; a += 2) {
        ctx.beginPath();
        ctx.moveTo(size / 2, size / 2);
        ctx.arc(size / 2, size / 2, r, ((a - 1) * Math.PI) / 180, ((a + 2) * Math.PI) / 180);
        ctx.closePath();
        ctx.fillStyle = `hsl(${-a},70%,50%)`;
        ctx.fill();
      }
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, r);
      g.addColorStop(0, 'rgba(60,60,60,1)');
      g.addColorStop(1, 'rgba(60,60,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2); ctx.fill();
      const v = this._val(this._liveClip() || c, key) || [0, 0];
      const px = size / 2 + v[0] * r, py = size / 2 - v[1] * r;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath(); ctx.moveTo(size / 2 - 6, size / 2); ctx.lineTo(size / 2 + 6, size / 2); ctx.moveTo(size / 2, size / 2 - 6); ctx.lineTo(size / 2, size / 2 + 6); ctx.stroke();
    };
    draw();
    const setFrom = (e, live) => {
      const r = cv.getBoundingClientRect();
      const rad = size / 2 - 3;
      let x = (e.clientX - r.left - size / 2) / rad, y = -(e.clientY - r.top - size / 2) / rad;
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      this._set(c, key, [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000], live);
      draw();
    };
    cv.addEventListener('mousedown', (e) => {
      this._dragging = true;
      store.begin(t(label));
      setFrom(e, true);
      const mv = (ev) => setFrom(ev, true);
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); this._dragging = false; store.end(); };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
    });
    cv.addEventListener('dblclick', () => { this._set(c, key, [0, 0], false); draw(); });
    const pd = EFFECTS.lumetri.params.find((p) => p.key === lumKey);
    const lum = el('input', { type: 'range', min: pd.min, max: pd.max, step: 1 });
    lum.value = this._val(c, lumKey);
    lum.addEventListener('input', () => { if (!this._dragging) { this._dragging = true; store.begin(t(label)); } this._set(c, lumKey, +lum.value, true); });
    lum.addEventListener('change', () => { this._dragging = false; store.end(); });
    lum.addEventListener('dblclick', () => this._set(c, lumKey, 0, false));
    parent.appendChild(el('div', { class: 'wheel' }, cv, lum, el('span', { class: 'wl', text: t(label) })));
    this.updaters.push(() => { draw(); const cc = this._liveClip(); if (cc) lum.value = this._val(cc, lumKey); });
  }

  // Eğri düzenleyici: tıkla = nokta ekle/sürükle, çift tık = noktayı sil
  _curvesEditor(parent, c) {
    const CH = [['m', t('Master')], ['r', t('Red')], ['g', t('Green')], ['b', t('Blue')], ['hs', t('Hue vs Sat')]];
    if (!this._curveCh) this._curveCh = 'm';
    const tabs = el('div', { class: 'lum-row', style: { gap: '4px' } });
    const size = 232;
    const dpr = window.devicePixelRatio || 1;
    const cv = el('canvas', { width: size * dpr, height: size * dpr, style: { width: size + 'px', height: size + 'px', cursor: 'crosshair', background: '#141414', borderRadius: '3px' } });
    const reset = el('button', { text: t('Reset'), style: { padding: '1px 8px', marginLeft: 'auto' } });
    const get = () => ({ ...DEFAULT_CURVES, ...(structuredClone(this._val(this._liveClip() || c, 'curves')) || {}) });
    const colors = { m: '#e8e8e8', r: '#ff5555', g: '#55e055', b: '#5c8cff', hs: '#e8c547' };
    const draw = () => {
      const v = get();
      const ch = this._curveCh;
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      if (ch === 'hs') {
        for (let x = 0; x < size; x++) { ctx.fillStyle = `hsl(${(x / size) * 360},60%,35%)`; ctx.fillRect(x, size - 10, 1, 10); }
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo((i * size) / 4, 0); ctx.lineTo((i * size) / 4, size); ctx.moveTo(0, (i * size) / 4); ctx.lineTo(size, (i * size) / 4); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      if (ch === 'hs') { ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); } else { ctx.moveTo(0, size); ctx.lineTo(size, 0); }
      ctx.stroke();
      // diğer kanalları soluk göster
      const curveOf = (k) => (k === 'hs' ? periodicSpline(v.hs) : monotoneSpline(v[k]));
      const plot = (k, alpha) => {
        const f = curveOf(k);
        ctx.strokeStyle = colors[k];
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let x = 0; x <= size; x++) {
          const y = k === 'hs' ? Math.max(0, Math.min(2, f(x / size))) / 2 : Math.max(0, Math.min(1, f(x / size)));
          const py = size - y * size;
          if (x === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      if (ch !== 'hs') for (const k of ['r', 'g', 'b', 'm']) if (k !== ch) plot(k, 0.25);
      plot(ch, 1);
      const pts = v[ch] || [];
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const x = pts[i] * size, y = size - (ch === 'hs' ? pts[i + 1] / 2 : pts[i + 1]) * size;
        ctx.fillStyle = '#111'; ctx.strokeStyle = colors[ch];
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    };
    const setCh = (k) => { this._curveCh = k; [...tabs.children].forEach((b) => b.classList && b.classList.toggle('active', b.dataset.ch === k)); draw(); };
    for (const [k, l] of CH) {
      const b = el('button', { class: 'icon' + (this._curveCh === k ? ' active' : ''), text: l, style: { color: colors[k] } });
      b.dataset.ch = k;
      b.addEventListener('click', () => setCh(k));
      tabs.appendChild(b);
    }
    tabs.appendChild(reset);
    reset.addEventListener('click', () => {
      const v = get();
      v[this._curveCh] = structuredClone(DEFAULT_CURVES[this._curveCh]);
      this._set(c, 'curves', v, false);
      draw();
    });
    const toNorm = (e) => {
      const r = cv.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      let y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
      if (this._curveCh === 'hs') y *= 2;
      return [x, y];
    };
    const nearest = (v, x, y) => {
      const pts = v[this._curveCh] || [];
      const ys = this._curveCh === 'hs' ? 0.5 : 1;
      let best = -1, bd = 0.04;
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const d = Math.hypot(pts[i] - x, (pts[i + 1] - y) * ys);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    };
    cv.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const ch = this._curveCh;
      const v = get();
      let pts = [...(v[ch] || [])];
      let [x, y] = toNorm(e);
      let idx = nearest(v, x, y);
      if (idx < 0) { pts.push(x, y); idx = pts.length - 2; }
      this._dragging = true;
      store.begin(t('Curves'));
      const apply = () => {
        // noktaları x'e göre sırala; sürüklenen noktanın indeksini takip et
        const pairs = [];
        for (let i = 0; i + 1 < pts.length; i += 2) pairs.push([pts[i], pts[i + 1], i === idx]);
        pairs.sort((a, b) => a[0] - b[0]);
        pts = pairs.flatMap((p) => [p[0], p[1]]);
        idx = pairs.findIndex((p) => p[2]) * 2;
        const nv = get();
        nv[ch] = pts.map((n) => Math.round(n * 1000) / 1000);
        this._set(c, 'curves', nv, true);
        draw();
      };
      apply();
      const mv = (ev) => {
        [x, y] = toNorm(ev);
        // RGB eğrilerinde uç noktalar yalnızca dikey hareket eder
        const isEnd = ch !== 'hs' && (idx === 0 || idx === pts.length - 2);
        if (!isEnd) pts[idx] = x;
        pts[idx + 1] = y;
        apply();
      };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); this._dragging = false; store.end(); };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
    });
    cv.addEventListener('dblclick', (e) => {
      const ch = this._curveCh;
      const v = get();
      const [x, y] = toNorm(e);
      const idx = nearest(v, x, y);
      const pts = [...(v[ch] || [])];
      if (idx < 0) return;
      if (ch !== 'hs' && (idx === 0 || idx === pts.length - 2)) return;
      pts.splice(idx, 2);
      v[ch] = pts;
      this._set(c, 'curves', v, false);
      draw();
    });
    parent.append(tabs, el('div', { style: { display: 'flex', justifyContent: 'center', padding: '4px 0' } }, cv),
      el('div', { class: 'muted', style: { fontSize: '10px', textAlign: 'center' }, text: t('Click to add a point, drag to adjust, double-click to remove') }));
    this.updaters.push(draw);
    draw();
  }

  _liveClip() { const s = store.seq; return s && this._clipId ? s.clips[this._clipId] : null; }
  _updateValues() { for (const u of this.updaters || []) { try { u(); } catch (e) { /* */ } } }

  render() {
    if (!this.root) return;
    const scroll = this.root.scrollTop;
    this.root.innerHTML = '';
    this.updaters = [];
    const c = store.seq ? lumClip() : null;
    this._clipId = c ? c.id : null;
    if (!c) { this.root.appendChild(el('div', { class: 'empty-hint', text: t('Select one video clip in the timeline to color correct it') })); return; }
    const fx = this._fx(c);
    const head = el('div', { class: 'toolbar' }, el('span', { class: 'grow', text: c.name, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }));
    if (fx) {
      const en = el('input', { type: 'checkbox' });
      en.checked = fx.enabled;
      en.title = t('Toggle effect on/off');
      en.addEventListener('change', () => store.commit('Toggle Effect', (p) => { p.sequences[p.activeSequenceId].clips[c.id].effects.find((f) => f.id === fx.id).enabled = en.checked; }));
      const reset = el('button', { text: t('Reset'), style: { padding: '1px 8px' } });
      reset.addEventListener('click', () => store.commit('Reset Lumetri', (p) => { const cc = p.sequences[p.activeSequenceId].clips[c.id]; const i = cc.effects.findIndex((f) => f.id === fx.id); const n = createEffect('lumetri'); n.id = fx.id; cc.effects[i] = n; }));
      head.append(el('label', {}, en, ' fx'), reset);
    }
    this.root.appendChild(head);
    this._section('basic', t('Basic Correction'), (b) => {
      b.appendChild(el('div', { class: 'muted', style: { margin: '2px 0 4px' }, text: t('White Balance') }));
      for (const k of ['temperature', 'tint']) this._slider(b, c, k);
      b.appendChild(el('div', { class: 'muted', style: { margin: '6px 0 4px' }, text: t('Tone') }));
      for (const k of ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks']) this._slider(b, c, k);
      b.appendChild(el('div', { style: { height: '4px' } }));
      this._slider(b, c, 'saturation');
    });
    this._section('creative', t('Creative'), (b) => {
      const lut = this._val(c, 'lut');
      const lutName = el('span', { class: 'muted', text: lut ? nodePath.basename(lut) : t('None'), style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } });
      const br = el('button', { text: t('Browse...'), style: { padding: '1px 8px' } });
      br.addEventListener('click', async () => {
        const r = await ipc.invoke('dialog:open', { title: t('Choose LUT'), properties: ['openFile'], filters: [{ name: 'Cube LUT', extensions: ['cube'] }], defaultPath: settings.lastLutDir || undefined });
        if (!r.canceled && r.filePaths.length) {
          settings.lastLutDir = nodePath.dirname(r.filePaths[0]);
          settings.recentLuts = [r.filePaths[0], ...(settings.recentLuts || []).filter((x) => x !== r.filePaths[0])].slice(0, 10);
          saveSettings();
          this._set(c, 'lut', r.filePaths[0], false);
        }
      });
      const clr = el('button', { text: '×', style: { padding: '1px 6px' }, title: t('Clear') });
      clr.addEventListener('click', () => this._set(c, 'lut', '', false));
      b.appendChild(el('div', { class: 'lum-row' }, el('label', { text: t('Look (LUT)') }), lutName, br, clr));
      if ((settings.recentLuts || []).length) {
        const sel = el('select', { style: { flex: 1 } }, el('option', { value: '', text: t('Recent LUTs...') }), ...settings.recentLuts.map((p) => el('option', { value: p, text: nodePath.basename(p) })));
        sel.addEventListener('change', () => { if (sel.value) this._set(c, 'lut', sel.value, false); });
        b.appendChild(el('div', { class: 'lum-row' }, el('label'), sel));
      }
      for (const k of ['lutIntensity', 'faded', 'sharpen', 'vibrance']) this._slider(b, c, k);
    });
    this._section('curves', t('Curves'), (b) => this._curvesEditor(b, c));
    this._section('hsl', t('HSL Secondary'), (b) => {
      this._check(b, c, 'hslEnable');
      this._check(b, c, 'hslShowMask');
      b.appendChild(el('div', { class: 'muted', style: { margin: '6px 0 0' }, text: t('Key') }));
      const redraw = this._hueStrip(b, c);
      for (const k of ['hslHue', 'hslHueRange', 'hslSatMin', 'hslLumMin', 'hslLumMax', 'hslSoft']) this._slider(b, c, k);
      b.querySelectorAll('input[type=range]').forEach((r) => r.addEventListener('input', redraw));
      b.appendChild(el('div', { class: 'muted', style: { margin: '6px 0 4px' }, text: t('Correction') }));
      for (const k of ['hslHueShift', 'hslSat', 'hslExposure', 'hslContrast', 'hslTemp', 'hslTint']) this._slider(b, c, k);
    });
    this._section('wheels', t('Color Wheels'), (b) => {
      const w = el('div', { class: 'wheels' });
      this._wheel(w, c, 'wShadows', 'wShadowsL', 'Shadows');
      this._wheel(w, c, 'wMids', 'wMidsL', 'Midtones');
      this._wheel(w, c, 'wHighs', 'wHighsL', 'Highlights');
      b.appendChild(w);
    });
    this._section('vignette', t('Vignette'), (b) => {
      for (const k of ['vigAmount', 'vigMidpoint', 'vigRoundness', 'vigFeather']) this._slider(b, c, k);
    });
    this.root.scrollTop = scroll;
  }
}

// ===================== SES MİKSERİ =====================
const FADER_MAX = 1000;
function faderToDb(v) { return v <= 0 ? -96 : (v / FADER_MAX) * 66 - 60; }
function dbToFader(db) { return db <= -60 ? 0 : clamp(((db + 60) / 66) * FADER_MAX, 0, FADER_MAX); }

export class AudioMixerPanel {
  constructor() { this.id = 'audioMixer'; this.meters = []; this.peaks = []; }
  title() { return t('Audio Track Mixer'); }
  mount(body) {
    this.root = el('div', { class: 'mixer' });
    body.appendChild(this.root);
    store.on('change', (info) => { if (!(info && info.live)) this.render(); });
    app.engine.on('meters', (m) => this._drawMeters(m));
    this.render();
  }
  onShow() { this.render(); }
  _strip(name, getDb, setDb, getPan, setPan, extra, meterIndex) {
    const s = el('div', { class: 'strip' + (meterIndex === 'master' ? ' master' : '') });
    s.appendChild(el('div', { class: 'sname', text: name, title: name }));
    if (setPan) {
      const pan = el('input', { type: 'range', min: -100, max: 100, step: 1, class: 'pan', title: t('Pan') });
      pan.value = getPan();
      let b = false;
      pan.addEventListener('input', () => { if (!b) { b = true; store.begin(t('Pan')); } setPan(+pan.value, true); });
      pan.addEventListener('change', () => { b = false; store.end(); });
      pan.addEventListener('dblclick', () => setPan(0, false));
      s.appendChild(pan);
    } else s.appendChild(el('div', { style: { height: '16px' } }));
    if (extra) s.appendChild(extra);
    const fw = el('div', { class: 'fader-wrap' });
    const fader = el('input', { type: 'range', min: 0, max: FADER_MAX, step: 1, class: 'fader' });
    fader.value = dbToFader(getDb());
    const db = el('div', { class: 'db' });
    const showDb = () => { const d = faderToDb(+fader.value); db.textContent = d <= -96 ? '-∞' : (d > 0 ? '+' : '') + d.toFixed(1); };
    showDb();
    let began = false;
    fader.addEventListener('input', () => { showDb(); if (!began) { began = true; store.begin(t('Track Volume')); } setDb(Math.round(faderToDb(+fader.value) * 10) / 10, true); });
    fader.addEventListener('change', () => { began = false; store.end(); });
    fader.addEventListener('dblclick', () => { fader.value = dbToFader(0); showDb(); setDb(0, false); });
    const meter = el('canvas', { width: 14, height: 200 });
    this.meters.push({ cv: meter, index: meterIndex });
    fw.append(fader, meter);
    s.append(fw, db);
    return s;
  }
  render() {
    if (!this.root) return;
    this.root.innerHTML = '';
    this.meters = [];
    const seq = store.seq;
    if (!seq) { this.root.appendChild(el('div', { class: 'empty-hint', text: t('No sequence') })); return; }
    const commitTrack = (i, fn, live) => {
      const f = (p) => fn(p.sequences[p.activeSequenceId].tracks.audio[i]);
      if (live) store.live(f); else store.commit(t('Track Volume'), f);
    };
    seq.tracks.audio.forEach((tr, i) => {
      const btns = el('div', { class: 'btns' });
      const m = el('button', { class: 'm' + (tr.muted ? ' on' : ''), text: 'M', title: t('Mute Track') });
      m.addEventListener('click', () => store.commit('Mute Track', (p) => { const x = p.sequences[p.activeSequenceId].tracks.audio[i]; x.muted = !x.muted; }));
      const so = el('button', { class: 's' + (tr.solo ? ' on' : ''), text: 'S', title: t('Solo Track') });
      so.addEventListener('click', () => store.commit('Solo Track', (p) => { const x = p.sequences[p.activeSequenceId].tracks.audio[i]; x.solo = !x.solo; }));
      btns.append(m, so);
      this.root.appendChild(this._strip(tr.name || 'A' + (i + 1),
        () => tr.volume || 0, (v, live) => commitTrack(i, (x) => { x.volume = v; }, live),
        () => tr.pan || 0, (v, live) => commitTrack(i, (x) => { x.pan = v; }, live), btns, i));
    });
    this.root.appendChild(this._strip(t('Master'),
      () => seq.masterVolume || 0,
      (v, live) => { const f = (p) => { p.sequences[p.activeSequenceId].masterVolume = v; }; if (live) store.live(f); else store.commit(t('Master Volume'), f); },
      null, null, null, 'master'));
  }
  _drawMeters(m) {
    if (!this.root || !this.root.isConnected || !this.group || this.group.active !== this) return;
    for (const mt of this.meters) {
      const cv = mt.cv;
      const h = cv.clientHeight || 100;
      if (cv.height !== h) cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, cv.width, h);
      const draw = (v, x, w) => {
        const db = gainToDb(v);
        const n = clamp((db + 60) / 60, 0, 1);
        const g = ctx.createLinearGradient(0, h, 0, 0);
        g.addColorStop(0, '#2fae55'); g.addColorStop(0.75, '#d4c03a'); g.addColorStop(1, '#e0453d');
        ctx.fillStyle = g;
        ctx.fillRect(x, h - n * h, w, n * h);
      };
      if (mt.index === 'master') { draw(m.l, 0, 6); draw(m.r, 8, 6); }
      else draw(m.tracks[mt.index] || 0, 2, 10);
    }
  }
}

// ===================== İŞARETÇİLER =====================
export class MarkersPanel {
  constructor() { this.id = 'markers'; }
  title() { return t('Markers'); }
  mount(body) {
    this.root = el('div', { class: 'list-view' });
    body.appendChild(this.root);
    store.on('change', () => { if (this.group?.active === this) this.render(); });
    this.render();
  }
  onShow() { this.render(); }
  render() {
    this.root.innerHTML = '';
    const seq = store.seq;
    if (!seq || !seq.markers.length) { this.root.appendChild(el('div', { class: 'empty-hint', text: t('No markers. Press M to add a marker at the playhead.') })); return; }
    const tbl = el('table', { class: 'list-table' }, el('tr', {}, el('th', { text: '' }), el('th', { text: t('Name') }), el('th', { text: t('In') }), el('th', { text: t('Duration') }), el('th', { text: t('Comments') })));
    for (const m of seq.markers) {
      const tr = el('tr', {}, el('td', {}, el('span', { class: 'badge', style: { background: m.color } })), el('td', { text: m.name || '—' }), el('td', { text: framesToTC(m.frame, seq.fps) }), el('td', { text: framesToTC(m.duration || 0, seq.fps) }), el('td', { text: m.comment || '' }));
      tr.addEventListener('click', () => app.engine.setFrame(m.frame));
      tr.addEventListener('dblclick', () => app.commands.editMarker(m.id));
      tbl.appendChild(tr);
    }
    this.root.appendChild(tbl);
  }
}

// ===================== GEÇMİŞ =====================
export class HistoryPanel {
  constructor() { this.id = 'history'; this._render = rafThrottle(() => this.render()); }
  title() { return t('History'); }
  mount(body) {
    this.root = el('div', { class: 'list-view' });
    body.appendChild(this.root);
    store.on('change', (info) => { if (!(info && info.live) && this.group?.active === this) this._render(); });
    this.render();
  }
  onShow() { this.render(); }
  render() {
    this.root.innerHTML = '';
    const tbl = el('table', { class: 'list-table' });
    const u = store.undoStack, r = store.redoStack;
    const rowFor = (label, idx, current, future) => {
      const tr = el('tr', { class: current ? 'sel' : '', style: future ? { opacity: 0.45 } : null }, el('td', { text: t(label) }));
      tr.addEventListener('click', () => {
        if (future) { const n = r.length - idx; for (let i = 0; i < n; i++) store.redo(); }
        else store.jumpTo(idx);
        app.engine.refreshHandles();
      });
      return tr;
    };
    tbl.appendChild(rowFor(t('Open'), 0, u.length === 0, false));
    u.forEach((e, i) => tbl.appendChild(rowFor(e.label, i + 1, i === u.length - 1, false)));
    for (let i = r.length - 1; i >= 0; i--) tbl.appendChild(rowFor(r[i].label, i, false, true));
    this.root.appendChild(tbl);
    this.root.scrollTop = this.root.scrollHeight;
  }
}
