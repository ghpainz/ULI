// Altyazılar paneli: liste, metin düzenleme, zamanlama, stil
import { store } from '../store.js';
import { app } from '../appContext.js';
import { t } from '../i18n.js';
import { el, framesToTC, parseTC, rafThrottle } from '../util.js';
import { DEFAULT_CAPTION_STYLE, CAPTION_PRESETS, captionAt } from '../captions.js';
import { selectEl } from '../ui/dialogs.js';
import { settings, saveSettings } from '../settings.js';
import { fontPicker } from '../ui/fontPicker.js';

export class CaptionsPanel {
  constructor() {
    this.id = 'captions';
    this._render = rafThrottle(() => this.render());
    this.showStyle = false;
  }
  title() { return t('Captions'); }

  mount(body) {
    app.captionsPanel = this;
    const tb = el('div', { class: 'toolbar' });
    const add = el('button', { class: 'icon', text: '＋', title: t('Add Caption') + ' (Ctrl+Alt+C)' });
    add.addEventListener('click', () => app.commands.run('caption.add'));
    const imp = el('button', { text: t('Import...'), style: { padding: '1px 8px' } });
    imp.addEventListener('click', () => app.commands.run('caption.import'));
    const exp = el('button', { text: t('Export SRT...'), style: { padding: '1px 8px' } });
    exp.addEventListener('click', () => app.commands.run('caption.export'));
    this.showStyle = true;
    this.styleBtn = el('button', { text: '🎨 ' + t('Style'), title: t('Caption appearance: font, size, colors, position'), style: { padding: '1px 8px' } });
    this.styleBtn.addEventListener('click', () => { this.showStyle = !this.showStyle; this.render(); });
    const auto = el('button', { text: '✨ ' + t('Auto Captions'), style: { padding: '1px 8px' }, title: t('Auto Captions...') });
    auto.addEventListener('click', () => app.commands.run('caption.auto'));
    tb.append(add, auto, imp, exp, el('span', { class: 'grow' }), this.styleBtn);
    this.styleBox = el('div', { style: { borderBottom: '1px solid #2a2a2a', maxHeight: '62%', overflowY: 'auto', flexShrink: 0 } });
    this.list = el('div', { class: 'list-view' });
    body.append(tb, this.styleBox, this.list);
    store.on('change', (info) => { if (!(info && info.live) && !this._editing) this._render(); });
    store.on('selection', () => this._highlight());
    app.engine.on('frame', rafThrottle(() => this._highlight()));
    this.render();
  }
  onShow() { this.render(); }

  _commit(label, fn) {
    store.commit(label, (p) => fn(p.sequences[p.activeSequenceId]));
  }

  _renderStyle(seq) {
    this.styleBox.innerHTML = '';
    if (!this.showStyle || !seq) return;
    const st = { ...DEFAULT_CAPTION_STYLE, ...(seq.captionStyle || {}) };
    // her değişiklik bu sekansa uygulanır ve yeni projeler için varsayılan olarak hatırlanır
    const setMany = (o) => {
      this._commit('Caption Style', (s) => { s.captionStyle = { ...DEFAULT_CAPTION_STYLE, ...(s.captionStyle || {}), ...o }; });
      settings.captionStyleDefault = { ...(store.seq?.captionStyle || {}) };
      saveSettings();
    };
    const setSt = (k, v) => setMany({ [k]: v });
    const font = fontPicker(st.font, (f) => setSt('font', f), { width: 170 });
    const num = (k, min, max, w = 56) => { const i = el('input', { type: 'number', min, max, style: { width: w + 'px' } }); i.value = st[k]; i.addEventListener('change', () => setSt(k, +i.value)); return i; };
    const col = (k) => { const i = el('input', { type: 'color', value: st[k], title: t('Pick a color') }); i.addEventListener('change', () => setSt(k, i.value)); return i; };
    const chk = (k) => { const i = el('input', { type: 'checkbox' }); i.checked = !!st[k]; i.addEventListener('change', () => setSt(k, i.checked)); return i; };
    const slider = (k, min, max) => { const r = el('input', { type: 'range', min, max, step: 1, style: { width: '120px' } }); r.value = st[k]; r.addEventListener('change', () => setSt(k, +r.value)); return r; };
    const btn = (label, fn, title) => { const b = el('button', { text: label, title: title || label, style: { padding: '1px 8px' } }); b.addEventListener('click', fn); return b; };
    const anim = selectEl([['none', 'None'], ['karaoke', 'Highlight spoken word'], ['box', 'Spoken word in a box'], ['single', 'One word at a time']].map(([v, l]) => ({ value: v, label: t(l) })), st.anim || 'none', (v) => setSt('anim', v));
    const SW = ['#ffd60a', '#ff9f0a', '#ff2d55', '#bf5af2', '#0a84ff', '#34c759', '#ffffff'];
    const swatches = el('div', { class: 'inline', style: { gap: '4px' } }, ...SW.map((c) => {
      const b = el('button', { title: c, style: { width: '18px', height: '18px', padding: 0, background: c, border: st.hlColor.toLowerCase() === c ? '2px solid #fff' : '1px solid #555', borderRadius: '3px' } });
      b.addEventListener('click', () => setSt('hlColor', c));
      return b;
    }), col('hlColor'));
    const sec = (text) => el('div', { class: 'form-section', text, style: { gridColumn: '1 / -1', marginTop: '4px' } });
    const grid = el('div', { class: 'form-grid', style: { gridTemplateColumns: '110px 1fr', padding: '6px 8px 8px', gap: '6px 10px' } },
      sec(t('Text')),
      el('label', { text: t('Font') }), el('div', { class: 'inline' }, font, chk('bold'), el('b', { text: 'B' }), chk('italic'), el('i', { text: 'I' })),
      el('label', { text: t('Size') }), el('div', { class: 'inline' }, slider('size', 16, 200), num('size', 8, 300)),
      el('label', { text: t('Text Color') }), col('color'),
      el('label', { text: t('Outline') }), el('div', { class: 'inline' }, col('outlineColor'), num('outline', 0, 30), el('span', { text: 'px', class: 'muted' })),
      el('label', { text: t('Background') }), el('div', { class: 'inline' }, chk('bgEnabled'), col('bgColor'), num('bgOpacity', 0, 100), el('span', { text: '%', class: 'muted' })),
      sec(t('Position')),
      el('label', { text: t('Quick Place') }), el('div', { class: 'inline', style: { gap: '4px' } },
        btn(t('Top'), () => setMany({ margin: 82 })), btn(t('Middle'), () => setMany({ margin: 45 })), btn(t('Bottom'), () => setMany({ margin: 7 })), btn(t('Center horizontally'), () => setMany({ x: 50 }))),
      el('label', { text: t('Horizontal') }), el('div', { class: 'inline' }, num('x', 0, 100), el('span', { text: '%', class: 'muted' })),
      el('label', { text: t('From Bottom') }), el('div', { class: 'inline' }, num('margin', 0, 95), el('span', { text: '%', class: 'muted' })),
      el('div', { text: t('Tip: drag a caption on the Program monitor to move it.'), style: { gridColumn: '1 / -1', color: 'var(--text-dim)', fontSize: '11px' } }),
      sec(t('Word Highlight')),
      el('label', { text: t('Animation') }), anim,
      el('label', { text: t('Word Highlight Color') }), swatches,
    );
    const presetRow = el('div', { class: 'inline', style: { padding: '8px 8px 0', gap: '6px', flexWrap: 'wrap' } }, el('span', { text: t('Presets') + ':', class: 'muted' }),
      ...CAPTION_PRESETS.map((pr) => btn(t(pr.name), () => setMany(pr.st))));
    this.styleBox.appendChild(presetRow);
    this.styleBox.appendChild(grid);
  }

  render() {
    const seq = store.seq;
    this.styleBtn?.classList.toggle('active', this.showStyle);
    this._renderStyle(seq);
    this.list.innerHTML = '';
    if (!seq) { this.list.appendChild(el('div', { class: 'empty-hint', text: t('No sequence') })); return; }
    const caps = (seq.captions || []).slice().sort((a, b) => a.start - b.start);
    if (!caps.length) {
      this.list.appendChild(el('div', { class: 'empty-hint', html: t('No captions yet.') + '<br>' + t('Press + to add a caption at the playhead, or import an SRT file.') }));
      return;
    }
    this.rows = new Map();
    caps.forEach((c, i) => {
      const tcIn = el('input', { type: 'text', style: { width: '92px', fontFamily: 'var(--mono)', fontSize: '11px' } });
      tcIn.value = framesToTC(c.start, seq.fps);
      const tcOut = el('input', { type: 'text', style: { width: '92px', fontFamily: 'var(--mono)', fontSize: '11px' } });
      tcOut.value = framesToTC(c.end, seq.fps);
      const setTime = (k, inp) => {
        const f = parseTC(inp.value, seq.fps);
        if (f == null) { inp.value = framesToTC(c[k], seq.fps); return; }
        this._commit('Caption Timing', (s) => {
          const x = s.captions.find((y) => y.id === c.id);
          x[k] = Math.max(0, f);
          if (x.end <= x.start) x.end = x.start + 1;
          s.captions.sort((a, b) => a.start - b.start);
        });
      };
      for (const [k, inp] of [['start', tcIn], ['end', tcOut]]) {
        inp.addEventListener('change', () => setTime(k, inp));
        inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); });
      }
      const ta = el('textarea', { style: { width: '100%', height: '38px', resize: 'vertical', boxSizing: 'border-box' } });
      ta.value = c.text;
      ta.addEventListener('focus', () => { this._editing = true; app.engine.setFrame(c.start); store.ui.selectedCaption = c.id; this._highlight(); });
      ta.addEventListener('input', () => {
        if (!store._txn) store.begin('Edit Caption');
        store.live((p) => { const x = p.sequences[p.activeSequenceId].captions.find((y) => y.id === c.id); if (x) x.text = ta.value; });
        app.engine.requestRender();
      });
      ta.addEventListener('blur', () => { this._editing = false; store.end(); });
      ta.addEventListener('keydown', (e) => e.stopPropagation());
      const del = el('button', { class: 'icon', text: '×', title: t('Delete') });
      del.addEventListener('click', () => this._commit('Delete Caption', (s) => { s.captions = s.captions.filter((y) => y.id !== c.id); }));
      const go = el('span', { text: String(i + 1), style: { color: 'var(--text-dim)', cursor: 'pointer', minWidth: '20px' }, title: t('Go to caption') });
      go.addEventListener('click', () => app.engine.setFrame(c.start));
      const row = el('div', { style: { padding: '5px 8px', borderBottom: '1px solid #262626' } },
        el('div', { class: 'inline', style: { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '3px' } }, go, tcIn, el('span', { text: '→', class: 'muted' }), tcOut, el('span', { class: 'grow', style: { flex: 1 } }), del),
        ta);
      this.rows.set(c.id, row);
      this.list.appendChild(row);
    });
    this._highlight();
  }

  _highlight() {
    if (!this.rows) return;
    const seq = store.seq;
    if (!seq) return;
    const cur = captionAt(seq, app.engine.currentFrame);
    for (const [id, row] of this.rows) {
      const on = (cur && cur.id === id) || store.ui.selectedCaption === id;
      row.style.background = on ? '#2a3a4f' : '';
    }
  }
}
