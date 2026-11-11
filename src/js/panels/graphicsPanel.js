// Temel Grafikler paneli: şablon galerisi + çok katmanlı grafik düzenleyici
import { store } from '../store.js';
import { app } from '../appContext.js';
import { t } from '../i18n.js';
import { el, rafThrottle, uid } from '../util.js';
import { TEMPLATES, makeTemplate, renderGraphic, newLayer, ANIMS, ANIM_LABELS, LOOPS, LOOP_LABELS, TEXT_STYLES, applyTextStyle, alignLayer } from '../graphics.js';
import * as E from '../editing.js';
import { scrubNumber } from './effectControls.js';
import { fontPicker } from '../ui/fontPicker.js';
import { EMOJI, SHAPES, BADGES, stickerLayers } from '../stickers.js';

// Hizalama düğmeleri (kareye göre)
export const ALIGN_BUTTONS = [
  ['left', 'Align Left', '<svg viewBox="0 0 16 16"><path d="M1 1h1.5v14H1z"/><path d="M4 4h8v3H4zM4 9h5v3H4z" opacity=".8"/></svg>'],
  ['hcenter', 'Align Horizontal Center', '<svg viewBox="0 0 16 16"><path d="M7.25 1h1.5v14h-1.5z"/><path d="M3 4h10v3H3zM5 9h6v3H5z" opacity=".8"/></svg>'],
  ['right', 'Align Right', '<svg viewBox="0 0 16 16"><path d="M13.5 1H15v14h-1.5z"/><path d="M4 4h8v3H4zM7 9h5v3H7z" opacity=".8"/></svg>'],
  ['top', 'Align Top', '<svg viewBox="0 0 16 16"><path d="M1 1h14v1.5H1z"/><path d="M4 4h3v8H4zM9 4h3v5H9z" opacity=".8"/></svg>'],
  ['vcenter', 'Align Vertical Center', '<svg viewBox="0 0 16 16"><path d="M1 7.25h14v1.5H1z"/><path d="M4 3h3v10H4zM9 5h3v6H9z" opacity=".8"/></svg>'],
  ['bottom', 'Align Bottom', '<svg viewBox="0 0 16 16"><path d="M1 13.5h14V15H1z"/><path d="M4 4h3v8H4zM9 7h3v5H9z" opacity=".8"/></svg>'],
];

export class GraphicsPanel {
  constructor() {
    this.id = 'graphics';
    this.tab = 'browse';
    this.selLayer = null;
    this._render = rafThrottle(() => this.render());
  }
  title() { return t('Essential Graphics'); }

  mount(body) {
    const tabs = el('div', { class: 'toolbar' });
    this.tBrowse = el('button', { text: t('Browse'), style: { padding: '1px 10px' } });
    this.tEdit = el('button', { text: t('Edit'), style: { padding: '1px 10px' } });
    this.tBrowse.addEventListener('click', () => { this.tab = 'browse'; this.render(); });
    this.tEdit.addEventListener('click', () => { this.tab = 'edit'; this.render(); });
    tabs.append(this.tBrowse, this.tEdit);
    this.root = el('div', { class: 'list-view', style: { padding: '0' } });
    body.append(tabs, this.root);
    store.on('change', (info) => { if (!(info && info.live) && !this._editing) this._render(); });
    store.on('selection', () => {
      const c = this._clip();
      if (c && this.tab === 'browse' && this._autoSwitch !== c.id) { this._autoSwitch = c.id; this.tab = 'edit'; }
      this._render();
    });
    app.graphics = this;
    this.render();
  }
  onShow() { this.render(); }

  _clip() {
    const sel = store.selectedClips().filter((c) => c.kind === 'graphic');
    return sel.length === 1 ? sel[0] : null;
  }

  render() {
    if (!this.root) return;
    this.tBrowse.classList.toggle('primary', this.tab === 'browse');
    this.tEdit.classList.toggle('primary', this.tab === 'edit');
    const scroll = this.root.scrollTop;
    this.root.innerHTML = '';
    if (this.tab === 'browse') this._browse(); else this._edit();
    this.root.scrollTop = scroll;
  }

  // ---- Gözat ----
  _browse() {
    const grid = el('div', { class: 'grid-view' });
    for (const tp of TEMPLATES) {
      const cv = el('canvas', { width: 320, height: 180, style: { width: '100%', height: '84px', display: 'block', background: '#2a3442' } });
      const g = makeTemplate(tp.id, 320, 180);
      renderGraphic(cv, g, 60, 150, 320, 180);
      const card = el('div', { class: 'grid-item', title: t('Double-click or drag to add') }, cv, el('div', { class: 'gname', text: t(tp.name) }));
      card.addEventListener('dblclick', () => this.insertTemplate(tp.id));
      const add = el('button', { text: t('Add'), style: { margin: '0 6px 6px', padding: '0 8px' } });
      add.addEventListener('click', () => this.insertTemplate(tp.id));
      card.appendChild(add);
      grid.appendChild(card);
    }
    const blank = el('button', { text: t('New Blank Graphic'), style: { margin: '8px' } });
    blank.addEventListener('click', () => this.insertTemplate(null));
    // yazı stilleri: seçili metin katmanına uygular ya da bu stilde yeni bir yazı ekler
    const sgrid = el('div', { class: 'grid-view' });
    for (const st of TEXT_STYLES) {
      const cv = el('canvas', { width: 320, height: 120, style: { width: '100%', height: '60px', display: 'block', background: '#1d2330' } });
      const L = applyTextStyle(newLayer('text', 320, 120, { text: 'Abc', x: 160, y: 60, size: 64, animIn: { type: 'none', dur: 1 }, animOut: { type: 'none', dur: 1 } }), st.id);
      if (L.curve) L.text = 'Yazı';
      renderGraphic(cv, { layers: [L] }, 30, 150, 320, 120);
      const card = el('div', { class: 'grid-item', title: t('Click: apply to the selected text layer, or add a new text in this style') }, cv, el('div', { class: 'gname', text: t(st.name) }));
      card.addEventListener('click', () => this.applyStyle(st.id));
      sgrid.appendChild(card);
    }
    this.root.append(grid, blank, el('div', { class: 'ec-section-title', style: { marginTop: '6px' } }, el('span', { class: 'title', text: t('Text Styles') })), sgrid);
    this._stickers();
    if (!store.seq) this.root.prepend(el('div', { class: 'empty-hint', text: t('Create a sequence first') }));
  }

  // Çıkartmalar: kategori çipleri + ızgara (tıkla = oynatma kafasına ekle)
  _stickers() {
    const cats = [...Object.keys(EMOJI).map((k) => ['emoji:' + k, k]), ['shapes', 'Shapes'], ['badges', 'Badges']];
    if (!this.stickerCat) this.stickerCat = 'badges';
    const chips = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '4px 8px' } });
    for (const [id, label] of cats) {
      const b = el('button', { text: t(label), class: this.stickerCat === id ? 'primary' : '', style: { padding: '1px 8px', fontSize: '11px' } });
      b.addEventListener('click', () => { this.stickerCat = id; this.render(); });
      chips.appendChild(b);
    }
    const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: '6px', padding: '6px 8px 12px' } });
    const tile = (content, title, onAdd) => {
      const tl = el('div', { class: 'grid-item', title: title + ' — ' + t('Click to add at the playhead'), style: { height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: '#1d2330' } }, content);
      tl.addEventListener('click', onAdd);
      grid.appendChild(tl);
    };
    const thumb = (layers) => { const cv = el('canvas', { width: 128, height: 128, style: { width: '60px', height: '60px' } }); renderGraphic(cv, { layers }, 40, 150, 128, 128); return cv; };
    if (this.stickerCat.startsWith('emoji:')) {
      for (const e of EMOJI[this.stickerCat.slice(6)].split(' ').filter(Boolean)) tile(el('span', { text: e, style: { fontSize: '34px', fontFamily: '"Segoe UI Emoji", sans-serif' } }), e, () => this.insertSticker('emoji', e));
    } else if (this.stickerCat === 'shapes') {
      for (const sh of SHAPES) tile(thumb(stickerLayers('shape', sh.id, 128, 128).map((L) => ({ ...L, animIn: { type: 'none', dur: 1 }, loop: null }))), t(sh.name), () => this.insertSticker('shape', sh.id));
    } else {
      for (const b of BADGES) tile(thumb(stickerLayers('badge', b.id, 128 * 1.6, 128).map((L) => ({ ...L, x: L.x / 1.6, w: (L.w || 0) / 1.6, size: L.size ? L.size / 1.25 : L.size, animIn: { type: 'none', dur: 1 }, delay: 0, loop: null }))), t(b.name), () => this.insertSticker('badge', b.id));
    }
    this.root.append(el('div', { class: 'ec-section-title', style: { marginTop: '6px' } }, el('span', { class: 'title', text: t('Stickers') })), chips, grid);
  }

  insertSticker(kind, id) {
    const s = store.seq;
    if (!s) return;
    const f = app.engine.currentFrame;
    const dur = Math.round(3 * s.fps);
    const layers = stickerLayers(kind, id, s.width, s.height);
    let cid = null;
    store.commit('Add Sticker', (p) => {
      const sq = p.sequences[p.activeSequenceId];
      const tr = E.freeVideoTrackAbove(sq, f, dur, 1);
      cid = E.placeSynthetic(sq, 'graphic', { start: f, duration: dur, track: tr, name: kind === 'emoji' ? id : t((kind === 'shape' ? SHAPES : BADGES).find((x) => x.id === id)?.name || 'Sticker'), graphic: { layers } }).id;
    });
    store.select([cid]);
    this.tab = 'edit';
    this.selLayer = layers[layers.length - 1]?.id || null;
    this.render();
    app.program?.updateOverlay();
  }

  // seçili grafik klibindeki seçili metin katmanına stil uygula; yoksa bu stilde yeni yazı ekle
  applyStyle(styleId) {
    const c = this._clip();
    const L = c?.graphic?.layers.find((x) => x.id === this.selLayer);
    if (L && (L.type === 'text' || L.type === 'countdown')) {
      this._updLayer('Text Style', (x) => applyTextStyle(x, styleId));
      return;
    }
    const s = store.seq;
    if (!s) return;
    const lay = applyTextStyle(newLayer('text', s.width, s.height, { text: t(TEXT_STYLES.find((x) => x.id === styleId).name), size: Math.round(s.height * 0.14) }), styleId);
    this.insertTemplate(null, { layers: [lay] });
  }

  insertTemplate(id, graphic = null) {
    const s = store.seq;
    if (!s) return;
    const f = app.engine.currentFrame;
    const dur = Math.round(5 * s.fps);
    const g = graphic || (id ? makeTemplate(id, s.width, s.height) : { layers: [newLayer('text', s.width, s.height)] });
    const tpl = id ? TEMPLATES.find((x) => x.id === id) : null;
    const name = tpl ? t(tpl.name) : t('Graphic');
    let cid = null;
    store.commit('New Graphic', (p) => {
      const sq = p.sequences[p.activeSequenceId];
      const tr = E.freeVideoTrackAbove(sq, f, dur, 1);
      const gc = E.placeSynthetic(sq, 'graphic', { start: f, duration: dur, track: tr, name, graphic: g });
      if (tpl?.blend) gc.props.blendMode = tpl.blend; // ör. videolu yazı: alttaki video yalnız yazının içinde görünür
      cid = gc.id;
    });
    store.select([cid]);
    this.tab = 'edit';
    this.selLayer = null;
    this.render();
  }

  // ---- Düzenle ----
  _upd(label, fn, live = false) {
    const c = this._clip();
    if (!c) return;
    const f = (p) => { const cc = p.sequences[p.activeSequenceId].clips[c.id]; if (cc) fn(cc.graphic); };
    if (live) { if (!store._txn) store.begin(label); store.live(f); }
    else store.commit(label, f);
    app.engine.requestRender();
  }
  _updLayer(label, fn, live = false) {
    const id = this.selLayer;
    this._upd(label, (g) => { const L = g.layers.find((x) => x.id === id); if (L) fn(L); }, live);
  }

  _edit() {
    const c = this._clip();
    const s = store.seq;
    if (!c || !s) {
      this.root.appendChild(el('div', { class: 'empty-hint', html: t('Select a graphic clip in the timeline to edit it.') + '<br>' + t('Add one from the Browse tab.') }));
      return;
    }
    const g = c.graphic || { layers: [] };
    if (!g.layers.find((x) => x.id === this.selLayer)) this.selLayer = g.layers.length ? g.layers[g.layers.length - 1].id : null;
    // katman araç çubuğu
    const tb = el('div', { class: 'toolbar' });
    const addL = (type, label, extra = null, tip = t('Add Layer')) => {
      const b = el('button', { class: 'icon', text: label, title: tip });
      b.addEventListener('click', () => {
        const L = newLayer(type, s.width, s.height, extra || {});
        this._upd('Add Layer', (gg) => { gg.layers.push(L); });
        this.selLayer = L.id;
      });
      return b;
    };
    const mv = (d) => this._upd('Reorder Layer', (gg) => {
      const i = gg.layers.findIndex((x) => x.id === this.selLayer), j = i + d;
      if (i < 0 || j < 0 || j >= gg.layers.length) return;
      [gg.layers[i], gg.layers[j]] = [gg.layers[j], gg.layers[i]];
    });
    const up = el('button', { class: 'icon', text: '↑', title: t('Move Up') }); up.addEventListener('click', () => mv(1));
    const dn = el('button', { class: 'icon', text: '↓', title: t('Move Down') }); dn.addEventListener('click', () => mv(-1));
    const dup = el('button', { class: 'icon', text: '⧉', title: t('Duplicate') });
    dup.addEventListener('click', () => this._upd('Duplicate Layer', (gg) => {
      const i = gg.layers.findIndex((x) => x.id === this.selLayer);
      if (i < 0) return;
      const n = { ...structuredClone(gg.layers[i]), id: uid('lyr') };
      n.y += 40; gg.layers.splice(i + 1, 0, n); this.selLayer = n.id;
    }));
    const del = el('button', { class: 'icon', text: '🗑', title: t('Delete') });
    del.addEventListener('click', () => this._upd('Delete Layer', (gg) => { gg.layers = gg.layers.filter((x) => x.id !== this.selLayer); }));
    tb.append(addL('text', 'T'), addL('rect', '▭'), addL('ellipse', '◯'), addL('line', '—'),
      addL('text', '😀', { name: 'Emoji', text: '😀', font: 'Segoe UI Emoji', bold: false, size: Math.round(s.height * 0.18), animIn: { type: 'pop', dur: 14 } }, t('Emoji')),
      addL('progress', '▬', null, t('Progress Bar')), addL('countdown', '⏱', null, t('Countdown')),
      el('span', { class: 'grow' }), up, dn, dup, del);
    this.root.appendChild(tb);
    // katman listesi (üstteki katman en üstte)
    const list = el('div', { style: { borderBottom: '1px solid #2a2a2a' } });
    for (const L of g.layers.slice().reverse()) {
      const eye = el('span', { text: L.hidden ? '◌' : '◉', style: { cursor: 'pointer', color: L.hidden ? '#666' : '#aaa', width: '16px' } });
      eye.addEventListener('click', (e) => { e.stopPropagation(); const id = L.id; this._upd('Toggle Layer', (gg) => { const x = gg.layers.find((y) => y.id === id); x.hidden = !x.hidden; }); });
      const icon = { text: 'T', rect: '▭', ellipse: '◯', line: '—', progress: '▬', countdown: '⏱', svg: '★' }[L.type];
      const row = el('div', { class: 'tree-row' + (L.id === this.selLayer ? ' sel' : '') }, eye, el('span', { text: icon, style: { width: '14px', color: '#888' } }),
        el('span', { text: L.type === 'text' ? (L.text || '').split('\n')[0].slice(0, 30) || L.name : t(L.name) }));
      row.addEventListener('click', () => { this.selLayer = L.id; this.render(); app.program?.updateOverlay(); });
      list.appendChild(row);
    }
    this.root.appendChild(list);
    const L = g.layers.find((x) => x.id === this.selLayer);
    if (L) this._layerForm(L, s);
  }

  // Parlama, renk geçişi, ek konturlar, 3B derinlik, eğri
  _textFx(L, form, row, head, chk) {
    const sub = (obj, key, opts) => scrubNumber(L[obj]?.[key] ?? opts.def, {
      step: opts.step || 1, min: opts.min, max: opts.max, decimals: opts.dec || 0, suffix: opts.suffix || '',
      onStart: () => { this._editing = true; store.begin(t('Edit Graphic')); },
      onChange: (v) => this._updLayer('Edit Graphic', (x) => { x[obj] = { ...(opts.base || {}), ...(x[obj] || {}), [key]: v }; }, true),
      onEnd: () => { this._editing = false; store.end(); },
      onCommit: (v) => this._updLayer('Edit Graphic', (x) => { x[obj] = { ...(opts.base || {}), ...(x[obj] || {}), [key]: v }; }),
    });
    const subColor = (obj, key, def, base) => {
      const i = el('input', { type: 'color', value: L[obj]?.[key] || def });
      i.addEventListener('input', () => { this._editing = true; this._updLayer('Edit Graphic', (x) => { x[obj] = { ...base, ...(x[obj] || {}), [key]: i.value }; }, true); });
      i.addEventListener('change', () => { this._editing = false; store.end(); });
      return i;
    };
    const onOff = (obj, base) => {
      const i = el('input', { type: 'checkbox' });
      i.checked = !!L[obj]?.on;
      i.addEventListener('change', () => this._updLayer('Edit Graphic', (x) => { x[obj] = { ...base, ...(x[obj] || {}), on: i.checked }; }));
      return i;
    };
    const GLOW = { on: false, color: L.fill || '#ff1fd0', size: Math.round((L.size || 100) * 0.28), intensity: 200, core: 70 };
    const GRAD = { on: false, c1: '#ffffff', c2: '#ff8a00', c3: '', angle: 90 };
    const EXT = { on: false, depth: Math.round((L.size || 100) * 0.1), angle: 135, color: '#222222', shade: 40 };
    head(t('Text Effects'));
    row(t('Glow'), onOff('glow', GLOW), subColor('glow', 'color', GLOW.color, GLOW), sub('glow', 'size', { def: GLOW.size, min: 0, max: 400, base: GLOW }));
    row(t('Glow Intensity'), sub('glow', 'intensity', { def: 200, min: 0, max: 600, suffix: '%', base: GLOW }), el('span', { text: t('Core'), style: { margin: '0 4px', color: 'var(--text-dim)' } }), sub('glow', 'core', { def: 70, min: 0, max: 100, suffix: '%', base: GLOW }));
    row(t('Gradient'), onOff('gradient', GRAD), subColor('gradient', 'c1', GRAD.c1, GRAD), subColor('gradient', 'c2', GRAD.c2, GRAD), subColor('gradient', 'c3', L.gradient?.c3 || '#c81400', GRAD));
    const g3 = el('input', { type: 'checkbox' }); g3.checked = !!L.gradient?.c3;
    g3.addEventListener('change', () => this._updLayer('Edit Graphic', (x) => { x.gradient = { ...GRAD, ...(x.gradient || {}), c3: g3.checked ? (x.gradient?.c3 || '#c81400') : '' }; }));
    row(t('Gradient Angle'), sub('gradient', 'angle', { def: 90, min: -360, max: 360, suffix: '°', base: GRAD }), el('label', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, g3, t('3 Colors')));
    // ek konturlar
    const strokes = L.strokes || [];
    for (let i = 0; i < 2; i++) {
      const sx = strokes[i] || { color: i ? '#000000' : '#ffffff', width: 0 };
      const c = el('input', { type: 'color', value: sx.color });
      const setS = (fn, live) => this._updLayer('Edit Graphic', (x) => { const a = (x.strokes || []).slice(); while (a.length <= i) a.push({ color: '#000000', width: 0 }); fn(a[i]); x.strokes = a; }, live);
      c.addEventListener('input', () => { this._editing = true; setS((o) => { o.color = c.value; }, true); });
      c.addEventListener('change', () => { this._editing = false; store.end(); });
      const w = scrubNumber(sx.width, { step: 0.5, min: 0, max: 200, decimals: 1,
        onStart: () => { this._editing = true; store.begin(t('Edit Graphic')); },
        onChange: (v) => setS((o) => { o.width = v; }, true),
        onEnd: () => { this._editing = false; store.end(); },
        onCommit: (v) => setS((o) => { o.width = v; }) });
      row(t('Outer Stroke') + ' ' + (i + 1), c, w);
    }
    row(t('3D Depth'), onOff('extrude', EXT), subColor('extrude', 'color', EXT.color, EXT), sub('extrude', 'depth', { def: EXT.depth, min: 1, max: 200, base: EXT }));
    row(t('Depth Angle'), sub('extrude', 'angle', { def: 135, min: -360, max: 360, suffix: '°', base: EXT }), el('span', { text: t('Shading'), style: { margin: '0 4px', color: 'var(--text-dim)' } }), sub('extrude', 'shade', { def: 40, min: 0, max: 100, suffix: '%', base: EXT }));
    const curve = scrubNumber(L.curve || 0, { step: 1, min: -100, max: 100, decimals: 0,
      onStart: () => { this._editing = true; store.begin(t('Edit Graphic')); },
      onChange: (v) => this._updLayer('Edit Graphic', (x) => { x.curve = v; }, true),
      onEnd: () => { this._editing = false; store.end(); },
      onCommit: (v) => this._updLayer('Edit Graphic', (x) => { x.curve = v; }) });
    row(t('Curve'), curve);
    const styleSel = el('select');
    styleSel.appendChild(el('option', { value: '', text: '—' }));
    for (const st of TEXT_STYLES) styleSel.appendChild(el('option', { value: st.id, text: t(st.name) }));
    styleSel.value = L.styleId || '';
    styleSel.addEventListener('change', () => { if (styleSel.value) this._updLayer('Text Style', (x) => applyTextStyle(x, styleSel.value)); });
    row(t('Text Style'), styleSel);
  }

  _layerForm(L, s) {
    const form = el('div', { style: { padding: '6px 0' } });
    const row = (label, ...ctl) => form.appendChild(el('div', { class: 'ec-row' }, el('span', { class: 'pname', text: label }), el('div', { class: 'pval' }, ...ctl)));
    const head = (label) => form.appendChild(el('div', { class: 'ec-section-title' }, el('span', { class: 'title', text: label })));
    const num = (key, opts = {}) => scrubNumber(L[key] ?? 0, {
      step: opts.step || 1, min: opts.min ?? -100000, max: opts.max ?? 100000, decimals: opts.decimals ?? 0, suffix: opts.suffix || '',
      onStart: () => { this._editing = true; store.begin(t('Edit Graphic')); },
      onChange: (v) => this._updLayer('Edit Graphic', (x) => { x[key] = v; }, true),
      onEnd: () => { this._editing = false; store.end(); },
      onCommit: (v) => this._updLayer('Edit Graphic', (x) => { x[key] = v; }),
    });
    const color = (key) => {
      const i = el('input', { type: 'color', value: L[key] || '#ffffff' });
      i.addEventListener('input', () => { this._editing = true; this._updLayer('Edit Graphic', (x) => { x[key] = i.value; }, true); });
      i.addEventListener('change', () => { this._editing = false; store.end(); });
      return i;
    };
    const chk = (key) => {
      const i = el('input', { type: 'checkbox' });
      i.checked = !!L[key];
      i.addEventListener('change', () => this._updLayer('Edit Graphic', (x) => { x[key] = i.checked; }));
      return i;
    };
    if (L.type === 'countdown') {
      head(t('Countdown'));
      row(t('Count From (sec)'), num('countFrom', { min: 1, max: 36000 }));
      const fmt = el('select');
      for (const [v, l] of [['ss', '10'], ['mm:ss', '00:10']]) fmt.appendChild(el('option', { value: v, text: l }));
      fmt.value = L.countFormat || 'ss';
      fmt.addEventListener('change', () => this._updLayer('Countdown', (x) => { x.countFormat = fmt.value; }));
      row(t('Format'), fmt);
    }
    if (L.type === 'text' || L.type === 'countdown') {
      head(t('Text'));
      const ta = el('textarea', { style: { width: '100%', height: '54px' } });
      ta.value = L.text ?? '';
      if (L.type === 'countdown') ta.style.display = 'none';
      ta.addEventListener('input', () => { this._editing = true; this._updLayer('Edit Text', (x) => { x.text = ta.value; }, true); });
      ta.addEventListener('blur', () => { this._editing = false; store.end(); this.render(); });
      ta.addEventListener('keydown', (e) => e.stopPropagation());
      form.appendChild(el('div', { style: { padding: '4px 10px' } }, ta));
      const font = fontPicker(L.font, (f) => this._updLayer('Font', (x) => { x.font = f; }), { width: 170 });
      row(t('Font'), font);
      row(t('Font Size'), num('size', { min: 4, max: 1000 }));
      const align = el('select');
      for (const a of ['left', 'center', 'right']) align.appendChild(el('option', { value: a, text: t(a[0].toUpperCase() + a.slice(1)) }));
      align.value = L.align || 'center';
      align.addEventListener('change', () => this._updLayer('Align', (x) => { x.align = align.value; }));
      row(t('Style'), chk('bold'), el('b', { text: 'B' }), chk('italic'), el('i', { text: 'I' }), align);
      row(t('Tracking'), num('tracking', { step: 0.2, decimals: 1 }));
      row(t('Line Spacing'), num('lineHeight', { step: 0.01, decimals: 2, min: 0.5, max: 4 }));
    }
    head(t('Appearance'));
    row(t('Fill'), color('fill'), num('fillOpacity', { min: 0, max: 100, suffix: '%' }));
    row(t('Stroke'), color('stroke'), num('strokeWidth', { min: 0, max: 200, step: 0.5, decimals: 1 }));
    if (L.type === 'rect' || L.type === 'progress') row(t('Corner Radius'), num('radius', { min: 0, max: 2000 }));
    if (L.type === 'progress') row(t('Track Opacity'), num('trackOpacity', { min: 0, max: 100, suffix: '%' }));
    row(t('Shadow'), chk('shadow'), color('shadowColor'), num('shadowBlur', { min: 0, max: 200 }), num('shadowDist', { min: -200, max: 200 }));
    if (L.type === 'text' || L.type === 'countdown') this._textFx(L, form, row, head, chk);
    head(t('Transform'));
    row(t('Position'), num('x', { decimals: 1 }), num('y', { decimals: 1 }));
    if (L.type !== 'text' && L.type !== 'countdown') row(t('Size'), num('w', { min: 1, decimals: 1 }), num('h', { min: 1, decimals: 1 }));
    row(t('Rotation'), num('rotation', { step: 0.5, decimals: 1, suffix: '°' }));
    row(t('Opacity'), num('opacity', { min: 0, max: 100, suffix: '%' }));
    // hızlı hizalama
    const al = (svg, tip, mode) => { const b = el('button', { class: 'icon', title: tip, html: svg }); b.addEventListener('click', () => this._updLayer('Align Layer', (x) => alignLayer(x, mode, s.width, s.height))); return b; };
    row(t('Align'), ...ALIGN_BUTTONS.map(([m, tip, svg]) => al(svg, t(tip), m)));
    head(t('Animation'));
    const animSel = (key) => {
      const sel = el('select');
      for (const a of ANIMS) sel.appendChild(el('option', { value: a, text: t(ANIM_LABELS[a]) }));
      sel.value = L[key]?.type || 'none';
      sel.addEventListener('change', () => this._updLayer('Animation', (x) => { x[key] = { ...(x[key] || { dur: 15 }), type: sel.value }; }));
      const d = scrubNumber(L[key]?.dur ?? 15, {
        step: 1, min: 1, max: 600, decimals: 0, suffix: ' ' + t('frames'),
        onCommit: (v) => this._updLayer('Animation', (x) => { x[key] = { ...(x[key] || { type: 'fade' }), dur: Math.round(v) }; }),
        onStart: () => { this._editing = true; store.begin(t('Animation')); },
        onChange: (v) => this._updLayer('Animation', (x) => { x[key] = { ...(x[key] || { type: 'fade' }), dur: Math.round(v) }; }, true),
        onEnd: () => { this._editing = false; store.end(); },
      });
      return [sel, d];
    };
    row(t('In'), ...animSel('animIn'));
    row(t('Out'), ...animSel('animOut'));
    row(t('Delay'), num('delay', { min: 0, max: 10000, suffix: ' ' + t('frames') }));
    // sürekli animasyon
    const lp = L.loop || { type: 'none', speed: 1, amount: 100 };
    const lsel = el('select');
    for (const a of LOOPS) {
      if ((a === 'wave' || a === 'bounce' || a === 'rainbow') && L.type !== 'text' && L.type !== 'countdown') continue;
      lsel.appendChild(el('option', { value: a, text: t(LOOP_LABELS[a]) }));
    }
    lsel.value = lp.type || 'none';
    lsel.addEventListener('change', () => this._updLayer('Loop Animation', (x) => { x.loop = { speed: 1, amount: 100, ...(x.loop || {}), type: lsel.value }; }));
    const lnum = (key, o) => scrubNumber(lp[key] ?? o.def, {
      step: o.step, min: o.min, max: o.max, decimals: o.dec, suffix: o.suffix || '',
      onStart: () => { this._editing = true; store.begin(t('Loop Animation')); },
      onChange: (v) => this._updLayer('Loop Animation', (x) => { x.loop = { type: 'none', speed: 1, amount: 100, ...(x.loop || {}), [key]: v }; }, true),
      onEnd: () => { this._editing = false; store.end(); },
      onCommit: (v) => this._updLayer('Loop Animation', (x) => { x.loop = { type: 'none', speed: 1, amount: 100, ...(x.loop || {}), [key]: v }; }),
    });
    row(t('Loop'), lsel);
    row(t('Speed'), lnum('speed', { def: 1, step: 0.05, min: 0.05, max: 10, dec: 2, suffix: ' Hz' }), lnum('amount', { def: 100, step: 1, min: 0, max: 300, dec: 0, suffix: '%' }));
    this.root.appendChild(form);
  }
}
