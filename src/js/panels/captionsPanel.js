// Altyazılar paneli: liste, metin düzenleme, zamanlama, stil
import { store } from '../store.js';
import { app } from '../appContext.js';
import { t } from '../i18n.js';
import { el, framesToTC, parseTC, rafThrottle } from '../util.js';
import { DEFAULT_CAPTION_STYLE, captionAt } from '../captions.js';
import { fontPicker } from '../ui/fontPicker.js';

export class CaptionsPanel {
  constructor() {
    this.id = 'captions';
    this._render = rafThrottle(() => this.render());
    this.showStyle = false;
  }
  title() { return t('Captions'); }

  mount(body) {
    const tb = el('div', { class: 'toolbar' });
    const add = el('button', { class: 'icon', text: '＋', title: t('Add Caption') + ' (Ctrl+Alt+C)' });
    add.addEventListener('click', () => app.commands.run('caption.add'));
    const imp = el('button', { text: t('Import...'), style: { padding: '1px 8px' } });
    imp.addEventListener('click', () => app.commands.run('caption.import'));
    const exp = el('button', { text: t('Export SRT...'), style: { padding: '1px 8px' } });
    exp.addEventListener('click', () => app.commands.run('caption.export'));
    this.styleBtn = el('button', { text: t('Style'), style: { padding: '1px 8px' } });
    this.styleBtn.addEventListener('click', () => { this.showStyle = !this.showStyle; this.render(); });
    tb.append(add, imp, exp, el('span', { class: 'grow' }), this.styleBtn);
    this.styleBox = el('div', { style: { borderBottom: '1px solid #2a2a2a' } });
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
    const setSt = (k, v) => this._commit('Caption Style', (s) => { s.captionStyle = { ...DEFAULT_CAPTION_STYLE, ...(s.captionStyle || {}), [k]: v }; });
    const font = fontPicker(st.font, (f) => setSt('font', f), { width: 160 });
    const num = (k, min, max) => { const i = el('input', { type: 'number', min, max, style: { width: '60px' } }); i.value = st[k]; i.addEventListener('change', () => setSt(k, +i.value)); return i; };
    const col = (k) => { const i = el('input', { type: 'color', value: st[k] }); i.addEventListener('change', () => setSt(k, i.value)); return i; };
    const chk = (k) => { const i = el('input', { type: 'checkbox' }); i.checked = !!st[k]; i.addEventListener('change', () => setSt(k, i.checked)); return i; };
    const grid = el('div', { class: 'form-grid', style: { gridTemplateColumns: '110px 1fr', padding: '8px', gap: '6px 10px' } },
      el('label', { text: t('Font') }), el('div', { class: 'inline' }, font, chk('bold'), el('span', { text: 'B' }), chk('italic'), el('span', { text: 'I' })),
      el('label', { text: t('Size') }), num('size', 8, 300),
      el('label', { text: t('Fill') }), col('color'),
      el('label', { text: t('Stroke') }), el('div', { class: 'inline' }, col('outlineColor'), num('outline', 0, 30)),
      el('label', { text: t('Background') }), el('div', { class: 'inline' }, chk('bgEnabled'), col('bgColor'), num('bgOpacity', 0, 100), el('span', { text: '%' })),
      el('label', { text: t('Bottom Margin') }), el('div', { class: 'inline' }, num('margin', 0, 90), el('span', { text: '%' })),
    );
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
