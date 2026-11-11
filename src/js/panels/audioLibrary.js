// Ses Kütüphanesi paneli: sentezlenmiş ses efektleri (dinle / ekle) ve metinden sese (Windows sesleri)
import { store } from '../store.js';
import { app } from '../appContext.js';
import { t } from '../i18n.js';
import { el, nodePath, ensureDir, hashString } from '../util.js';
import { SFX, SFX_GROUPS, sfxFile, previewSfx } from '../sfx.js';
import { listVoices, synthesize } from '../tts.js';
import { importFiles } from '../media.js';
import { ff } from '../ffmpeg.js';
import { clipsOnTrack } from '../model.js';
import * as E from '../editing.js';
import { toast } from '../ui/dialogs.js';

// Dosyayı projeye al (aynı yol varsa yeniden kullan) ve oynatma kafasında boş bir ses izine koy
export async function addAudioFileAtPlayhead(file, label) {
  if (!store.seq) { toast(t('Create a sequence first'), 'warn'); return null; }
  let m = Object.values(store.project.media).find((x) => x.path && nodePath.resolve(x.path) === nodePath.resolve(file));
  if (!m) { const r = await importFiles([file]); m = r && r[0]; }
  if (!m) return null;
  for (let i = 0; i < 40 && !m.duration; i++) await new Promise((r) => setTimeout(r, 50));
  const f = app.engine.currentFrame;
  let ids = [];
  store.commit(label || 'Add Audio', (p) => {
    const s = p.sequences[p.activeSequenceId];
    const dur = Math.max(1, Math.round((m.duration || 1) * s.fps));
    let tr = s.tracks.audio.findIndex((_, i) => !clipsOnTrack(s, 'audio', i).some((c) => c.start < f + dur && c.start + c.duration > f));
    if (tr < 0) { tr = s.tracks.audio.length; E.ensureTracks(s, 'audio', tr + 1); }
    ids = E.placeMedia(p, s, p.media[m.id], { start: f, vTrack: null, aTrack: tr, mode: 'overwrite', inSec: 0, outSec: m.duration, settings: app.settings });
  });
  store.select(ids);
  return ids[0];
}

export class AudioLibraryPanel {
  constructor() { this.id = 'audioLibrary'; this.filter = ''; }
  title() { return t('Audio Library'); }
  mount(body) {
    this.root = el('div', { class: 'audio-lib', style: { overflowY: 'auto', height: '100%' } });
    body.appendChild(this.root);
    app.audioLibrary = this;
    this.render();
  }
  render() {
    const R = this.root;
    R.innerHTML = '';
    // ---- metinden sese
    R.appendChild(el('div', { class: 'ec-section-title' }, el('span', { class: 'title', text: t('Text to Speech') })));
    const ta = el('textarea', { placeholder: t('Type the text to be spoken...'), style: { width: '100%', height: '64px', boxSizing: 'border-box' } });
    ta.value = this.ttsText || '';
    ta.addEventListener('input', () => { this.ttsText = ta.value; });
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    const voice = el('select', { style: { flex: '1', minWidth: '0' } }, el('option', { value: '', text: t('Loading voices...') }));
    listVoices().then((vs) => {
      voice.innerHTML = '';
      if (!vs.length) voice.appendChild(el('option', { value: '', text: t('No voices found') }));
      for (const v of vs) voice.appendChild(el('option', { value: v.id, text: `${v.name} (${v.lang})` }));
      const tr = vs.find((v) => /^tr/i.test(v.lang));
      voice.value = this.ttsVoice && vs.some((v) => v.id === this.ttsVoice) ? this.ttsVoice : (tr || vs[0])?.id || '';
    });
    voice.addEventListener('change', () => { this.ttsVoice = voice.value; });
    const rate = el('input', { type: 'range', min: '0.5', max: '2', step: '0.05', value: String(this.ttsRate || 1), style: { width: '90px' } });
    const rateLbl = el('span', { text: (this.ttsRate || 1).toFixed(2) + '×', style: { width: '40px', fontFamily: 'var(--mono)', fontSize: '11px' } });
    rate.addEventListener('input', () => { this.ttsRate = +rate.value; rateLbl.textContent = (+rate.value).toFixed(2) + '×'; });
    const fromSel = el('button', { text: t('Use Selected Text'), title: t('Take the text from the selected title / graphic / caption') });
    fromSel.addEventListener('click', () => {
      const c = store.selectedClips()[0];
      let txt = '';
      if (c?.kind === 'text') txt = c.text?.text || '';
      else if (c?.kind === 'graphic') txt = (c.graphic?.layers || []).filter((L) => L.type === 'text').map((L) => L.text).join('\n');
      if (!txt && store.ui.selectedCaption) txt = store.seq?.captions?.find((x) => x.id === store.ui.selectedCaption)?.text || '';
      if (txt) { ta.value = txt; this.ttsText = txt; } else toast(t('Select a text, graphic or caption first'), 'warn');
    });
    const gen = el('button', { class: 'primary', text: t('Generate & Add') });
    gen.addEventListener('click', async () => {
      const text = ta.value.trim();
      if (!text) { toast(t('Type some text first'), 'warn'); return; }
      if (!voice.value) { toast(t('No voices found'), 'error'); return; }
      gen.disabled = true; gen.textContent = t('Generating...');
      try {
        const dir = store.projectPath ? ensureDir(nodePath.join(nodePath.dirname(store.projectPath), 'ULI Voiceover')) : ensureDir(nodePath.join(ff.cacheDir, 'tts'));
        const base = text.slice(0, 24).replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') || 'tts';
        const out = nodePath.join(dir, `${base}_${hashString(text + voice.value + rate.value).slice(0, 6)}.wav`);
        await synthesize(text, voice.value, +rate.value, out);
        await addAudioFileAtPlayhead(out, 'Text to Speech');
        toast(t('Voiceover added'));
      } catch (e) {
        toast(t('Text to speech failed') + ': ' + e.message, 'error', 6000);
      } finally { gen.disabled = false; gen.textContent = t('Generate & Add'); }
    });
    R.append(el('div', { style: { padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: '6px' } },
      ta,
      el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, el('span', { text: t('Voice'), style: { width: '44px' } }), voice),
      el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, el('span', { text: t('Speed'), style: { width: '44px' } }), rate, rateLbl),
      el('div', { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end' } }, fromSel, gen)));
    // ---- ses efektleri
    R.appendChild(el('div', { class: 'ec-section-title', style: { marginTop: '6px' } }, el('span', { class: 'title', text: t('Sound Effects') })));
    const search = el('input', { type: 'text', placeholder: t('Search sounds'), style: { margin: '4px 10px', width: 'calc(100% - 20px)', boxSizing: 'border-box' } });
    search.value = this.filter;
    search.addEventListener('input', () => { this.filter = search.value; this._list(list); });
    search.addEventListener('keydown', (e) => e.stopPropagation());
    const list = el('div');
    R.append(search, list);
    this._list(list);
  }
  _list(list) {
    list.innerHTML = '';
    const q = this.filter.trim().toLocaleLowerCase('tr');
    for (const g of SFX_GROUPS) {
      const items = SFX.filter((x) => x[2] === g && (!q || t(x[1]).toLocaleLowerCase('tr').includes(q) || x[1].toLowerCase().includes(q)));
      if (!items.length) continue;
      list.appendChild(el('div', { text: t(g), style: { padding: '6px 10px 2px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' } }));
      for (const [id, name, , dur] of items) {
        const play = el('button', { class: 'icon', title: t('Preview'), html: '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M4 2l10 6-10 6z"/></svg>' });
        play.addEventListener('click', (e) => { e.stopPropagation(); previewSfx(id); });
        const add = el('button', { class: 'icon', title: t('Add at the playhead'), text: '+' });
        const doAdd = async () => { try { await addAudioFileAtPlayhead(await sfxFile(id), 'Add Sound Effect'); } catch (er) { toast(er.message, 'error'); } };
        add.addEventListener('click', (e) => { e.stopPropagation(); doAdd(); });
        const row = el('div', { class: 'tree-row', title: t('Double-click to add at the playhead') }, play, el('span', { text: t(name), style: { flex: '1' } }), el('span', { text: dur.toFixed(1) + 's', style: { color: 'var(--text-dim)', fontSize: '11px', fontFamily: 'var(--mono)' } }), add);
        row.addEventListener('dblclick', doAdd);
        list.appendChild(row);
      }
    }
  }
}
