// Temel Grafikler paneli: şablon galerisi + çok katmanlı grafik düzenleyici
import { store } from '../store.js';
import { app } from '../appContext.js';
import { t } from '../i18n.js';
import { el, rafThrottle, uid } from '../util.js';
import { TEMPLATES, makeTemplate, renderGraphic, newLayer, ANIMS, ANIM_LABELS } from '../graphics.js';
import * as E from '../editing.js';
import { FONTS, scrubNumber } from './effectControls.js';

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
    this.root.append(grid, blank);
    if (!store.seq) this.root.prepend(el('div', { class: 'empty-hint', text: t('Create a sequence first') }));
  }

  insertTemplate(id) {
    const s = store.seq;
    if (!s) return;
    const f = app.engine.currentFrame;
    const dur = Math.round(5 * s.fps);
    const g = id ? makeTemplate(id, s.width, s.height) : { layers: [newLayer('text', s.width, s.height)] };
    const name = id ? t(TEMPLATES.find((x) => x.id === id).name) : t('Graphic');
    let cid = null;
    store.commit('New Graphic', (p) => {
      const sq = p.sequences[p.activeSequenceId];
      const tr = E.freeVideoTrackAbove(sq, f, dur, 1);
      cid = E.placeSynthetic(sq, 'graphic', { start: f, duration: dur, track: tr, name, graphic: g }).id;
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
    const addL = (type, label) => {
      const b = el('button', { class: 'icon', text: label, title: t('Add Layer') });
      b.addEventListener('click', () => {
        const L = newLayer(type, s.width, s.height);
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
    tb.append(addL('text', 'T'), addL('rect', '▭'), addL('ellipse', '◯'), addL('line', '—'), el('span', { class: 'grow' }), up, dn, dup, del);
    this.root.appendChild(tb);
    // katman listesi (üstteki katman en üstte)
    const list = el('div', { style: { borderBottom: '1px solid #2a2a2a' } });
    for (const L of g.layers.slice().reverse()) {
      const eye = el('span', { text: L.hidden ? '◌' : '◉', style: { cursor: 'pointer', color: L.hidden ? '#666' : '#aaa', width: '16px' } });
      eye.addEventListener('click', (e) => { e.stopPropagation(); const id = L.id; this._upd('Toggle Layer', (gg) => { const x = gg.layers.find((y) => y.id === id); x.hidden = !x.hidden; }); });
      const icon = { text: 'T', rect: '▭', ellipse: '◯', line: '—' }[L.type];
      const row = el('div', { class: 'tree-row' + (L.id === this.selLayer ? ' sel' : '') }, eye, el('span', { text: icon, style: { width: '14px', color: '#888' } }),
        el('span', { text: L.type === 'text' ? (L.text || '').split('\n')[0].slice(0, 30) || L.name : t(L.name) }));
      row.addEventListener('click', () => { this.selLayer = L.id; this.render(); });
      list.appendChild(row);
    }
    this.root.appendChild(list);
    const L = g.layers.find((x) => x.id === this.selLayer);
    if (L) this._layerForm(L, s);
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
    if (L.type === 'text') {
      head(t('Text'));
      const ta = el('textarea', { style: { width: '100%', height: '54px' } });
      ta.value = L.text;
      ta.addEventListener('input', () => { this._editing = true; this._updLayer('Edit Text', (x) => { x.text = ta.value; }, true); });
      ta.addEventListener('blur', () => { this._editing = false; store.end(); this.render(); });
      ta.addEventListener('keydown', (e) => e.stopPropagation());
      form.appendChild(el('div', { style: { padding: '4px 10px' } }, ta));
      const font = el('input', { type: 'text', list: 'uli-fonts', style: { width: '140px' } });
      font.value = L.font;
      if (!document.getElementById('uli-fonts')) document.body.appendChild(el('datalist', { id: 'uli-fonts' }, ...FONTS.map((f) => el('option', { value: f }))));
      font.addEventListener('change', () => this._updLayer('Font', (x) => { x.font = font.value || 'Segoe UI'; }));
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
    if (L.type === 'rect') row(t('Corner Radius'), num('radius', { min: 0, max: 2000 }));
    row(t('Shadow'), chk('shadow'), color('shadowColor'), num('shadowBlur', { min: 0, max: 200 }), num('shadowDist', { min: -200, max: 200 }));
    head(t('Transform'));
    row(t('Position'), num('x', { decimals: 1 }), num('y', { decimals: 1 }));
    if (L.type !== 'text') row(t('Size'), num('w', { min: 1, decimals: 1 }), num('h', { min: 1, decimals: 1 }));
    row(t('Rotation'), num('rotation', { step: 0.5, decimals: 1, suffix: '°' }));
    row(t('Opacity'), num('opacity', { min: 0, max: 100, suffix: '%' }));
    // hızlı hizalama
    const al = (label, fn) => { const b = el('button', { class: 'icon', text: label }); b.addEventListener('click', () => this._updLayer('Align Layer', fn)); return b; };
    row(t('Align'), al('⇤', (x) => { x.x = x.type === 'text' && x.align === 'left' ? s.width * 0.08 : (x.w || 0) / 2 + s.width * 0.08; }),
      al('↔', (x) => { x.x = x.type === 'text' && x.align === 'left' ? s.width * 0.08 : s.width / 2; }),
      al('↕', (x) => { x.y = s.height / 2; }),
      al('⇥', (x) => { x.x = x.type === 'text' && x.align === 'right' ? s.width * 0.92 : s.width * 0.92 - (x.w || 0) / 2; }));
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
    this.root.appendChild(form);
  }
}
