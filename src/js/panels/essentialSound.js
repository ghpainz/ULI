// Essential Sound paneli: ses türüne göre hazır onarım/netlik/ses yüksekliği araçları
import { store } from '../store.js';
import { app } from '../appContext.js';
import { t } from '../i18n.js';
import { el, rafThrottle } from '../util.js';
import { evalParam } from '../keyframes.js';
import { autoMatchLoudness, duckMusic, setClipFx, syncByAudio, toggleRecording, isRecording } from '../audioTools.js';
import { toast } from '../ui/dialogs.js';

const TYPES = [['dialogue', 'Dialogue'], ['music', 'Music'], ['sfx', 'SFX'], ['ambience', 'Ambience']];
const TARGETS = { dialogue: -16, music: -20, sfx: -18, ambience: -26 };

export class EssentialSoundPanel {
  constructor() { this.id = 'essentialSound'; this._render = rafThrottle(() => this.render()); }
  title() { return t('Essential Sound'); }
  mount(body) {
    this.root = el('div', { class: 'lumetri es-panel' });
    body.appendChild(this.root);
    store.on('change', (info) => { if (!(info && info.live) && !this._dragging) this._render(); });
    store.on('selection', () => this._render());
    this.render();
  }
  onShow() { this.render(); }

  _clips() { return store.selectedClips().filter((c) => c.type === 'audio' && c.kind === 'media'); }

  _fx(c, type, tag) { return c.effects.find((e) => e.type === type && e.tag === tag); }

  _section(title, build) {
    const s = el('div', { class: 'lum-section' });
    s.append(el('div', { class: 'lum-title' }, el('span', { text: title })));
    const b = el('div', { class: 'lum-body' });
    s.appendChild(b);
    this.root.appendChild(s);
    build(b);
  }

  // onay kutusu + kaydırıcı ile bir efekti aç/kapat ve ayarla
  _fxSlider(b, clips, label, type, tag, key, { min, max, step = 1, def, extra = {}, suffix = '' }) {
    const fx = this._fx(clips[0], type, tag);
    const on = el('input', { type: 'checkbox' });
    on.checked = !!fx;
    const range = el('input', { type: 'range', min, max, step });
    range.value = fx ? fx.params[key]?.v ?? def : def;
    range.disabled = !fx;
    const num = el('span', { class: 'num', text: range.value + suffix });
    const ids = clips.map((c) => c.id);
    on.addEventListener('change', () => setClipFx(ids, type, tag, on.checked ? { ...extra, [key]: +range.value } : null));
    range.addEventListener('input', () => { num.textContent = range.value + suffix; });
    range.addEventListener('change', () => setClipFx(ids, type, tag, { ...extra, [key]: +range.value }));
    b.appendChild(el('div', { class: 'lum-slider' }, el('label', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, on, t(label)), range, num));
  }

  _loudness(b, clips, type) {
    const sel = el('select');
    for (const v of [-23, -20, -18, -16, -14]) sel.appendChild(el('option', { value: v, text: v + ' LUFS' }));
    sel.value = clips[0].loudness?.target ?? TARGETS[type] ?? -16;
    const btn = el('button', { text: t('Auto-Match'), style: { padding: '1px 10px' } });
    const info = el('span', { class: 'muted', text: clips[0].loudness ? t('Measured') + ': ' + clips[0].loudness.lufs.toFixed(1) + ' LUFS' : '' });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      info.textContent = t('Measuring...');
      try {
        const r = await autoMatchLoudness(clips.map((c) => c.id), +sel.value);
        const ok = r.filter((x) => x.lufs != null);
        info.textContent = ok.length ? t('Measured') + ': ' + ok.map((x) => x.lufs.toFixed(1)).join(', ') + ' LUFS' : t('Silent');
      } finally { btn.disabled = false; }
    });
    b.appendChild(el('div', { class: 'lum-row' }, el('label', { text: t('Target') }), sel, btn));
    b.appendChild(el('div', { class: 'lum-row' }, el('label'), info));
    // klip seviyesi
    const lvl = el('input', { type: 'range', min: -40, max: 15, step: 0.5 });
    lvl.value = evalParam(clips[0].props.volume, 0) ?? 0;
    const num = el('span', { class: 'num', text: (+lvl.value).toFixed(1) + ' dB' });
    lvl.addEventListener('input', () => {
      num.textContent = (+lvl.value).toFixed(1) + ' dB';
      if (!this._dragging) { this._dragging = true; store.begin(t('Clip Volume')); }
      store.live((p) => { for (const c of clips) { const cc = p.sequences[p.activeSequenceId].clips[c.id]; if (cc) cc.props.volume = { v: +lvl.value, kf: null }; } });
    });
    lvl.addEventListener('change', () => { this._dragging = false; store.end(); });
    b.appendChild(el('div', { class: 'lum-slider' }, el('label', { text: t('Clip Volume') }), lvl, num));
  }

  render() {
    if (!this.root) return;
    const scroll = this.root.scrollTop;
    this.root.innerHTML = '';
    const tools = el('div', { class: 'toolbar' });
    const recBtn = el('button', { text: isRecording() ? '■ ' + t('Stop Recording') : '● ' + t('Record Voiceover'), style: { padding: '1px 10px', color: isRecording() ? '#fff' : '#ff6b5e' } });
    recBtn.addEventListener('click', async () => { await toggleRecording(); setTimeout(() => this.render(), 300); });
    tools.append(recBtn);
    this.root.appendChild(tools);
    const clips = this._clips();
    if (!clips.length) {
      this.root.appendChild(el('div', { class: 'empty-hint', text: t('Select audio clips in the timeline to assign an audio type.') }));
      return;
    }
    const type = clips.every((c) => c.soundType === clips[0].soundType) ? clips[0].soundType : null;
    const typeRow = el('div', { class: 'toolbar', style: { flexWrap: 'wrap' } });
    for (const [k, l] of TYPES) {
      const b = el('button', { class: type === k ? 'primary' : '', text: t(l), style: { padding: '2px 10px' } });
      b.addEventListener('click', () => store.commit('Audio Type', (p) => { for (const c of clips) { const cc = p.sequences[p.activeSequenceId].clips[c.id]; if (cc) cc.soundType = k; } }));
      typeRow.appendChild(b);
    }
    if (type) {
      const clr = el('button', { class: 'icon', text: '×', title: t('Clear Audio Type') });
      clr.addEventListener('click', () => store.commit('Audio Type', (p) => { for (const c of clips) { const cc = p.sequences[p.activeSequenceId].clips[c.id]; if (cc) delete cc.soundType; } }));
      typeRow.appendChild(clr);
    }
    this.root.appendChild(typeRow);
    if (clips.length > 1) {
      const sync = el('button', { text: t('Synchronize by Audio'), style: { margin: '4px 8px' } });
      sync.addEventListener('click', () => syncByAudio(clips.map((c) => c.id)));
      this.root.appendChild(sync);
    }
    if (!type) {
      this.root.appendChild(el('div', { class: 'empty-hint', text: t('Choose an audio type to see its tools.') }));
      return;
    }
    this._section(t('Loudness'), (b) => this._loudness(b, clips, type));
    if (type === 'dialogue') {
      this._section(t('Repair'), (b) => {
        this._fxSlider(b, clips, 'Reduce Noise', 'denoise', 'es', 'nrAmount', { min: 0, max: 100, def: 40, suffix: '%' });
        this._fxSlider(b, clips, 'Reduce Rumble', 'highpass', 'es', 'freq', { min: 40, max: 200, def: 80, suffix: ' Hz' });
        this._fxSlider(b, clips, 'DeHum', 'dehum', 'es', 'harmonics', { min: 1, max: 6, def: 3, extra: { humFreq: 0 } });
        this._fxSlider(b, clips, 'DeEss', 'deesser', 'es', 'essIntensity', { min: 0, max: 100, def: 50, suffix: '%' });
      });
      this._section(t('Clarity'), (b) => {
        this._fxSlider(b, clips, 'Enhance Speech', 'eq', 'es', 'midGain', { min: 0, max: 10, step: 0.5, def: 4, suffix: ' dB', extra: { lowGain: -3, lowFreq: 150, midFreq: 3000, midQ: 0.8, highGain: 2, highFreq: 8000 } });
        this._fxSlider(b, clips, 'Dynamics', 'compressor', 'es', 'ratio', { min: 1, max: 10, step: 0.5, def: 3, extra: { threshold: -24, attack: 8, release: 120, makeup: 4 } });
      });
      this._section(t('Creative'), (b) => {
        this._fxSlider(b, clips, 'Reverb', 'reverb', 'es', 'mix', { min: 0, max: 100, def: 20, suffix: '%', extra: { roomSize: 45, decay: 50 } });
      });
    }
    if (type === 'music') {
      this._section(t('Ducking'), (b) => {
        const amt = el('input', { type: 'range', min: -30, max: -3, step: 1, value: -12 });
        const amtN = el('span', { class: 'num', text: '-12 dB' });
        amt.addEventListener('input', () => { amtN.textContent = amt.value + ' dB'; });
        const fade = el('input', { type: 'range', min: 2, max: 60, step: 1, value: 12 });
        const fadeN = el('span', { class: 'num', text: '12 ' + t('frames') });
        fade.addEventListener('input', () => { fadeN.textContent = fade.value + ' ' + t('frames'); });
        b.append(
          el('div', { class: 'muted', style: { marginBottom: '6px' }, text: t('Lowers the music under clips marked as Dialogue.') }),
          el('div', { class: 'lum-slider' }, el('label', { text: t('Duck Amount') }), amt, amtN),
          el('div', { class: 'lum-slider' }, el('label', { text: t('Fade Duration') }), fade, fadeN),
        );
        const gen = el('button', { text: t('Generate Keyframes'), style: { marginTop: '6px' } });
        gen.addEventListener('click', () => {
          const n = duckMusic(clips.map((c) => c.id), { amount: +amt.value, fade: +fade.value });
          if (n) toast(t('{n} ducking region(s) created', { n }));
        });
        b.appendChild(gen);
      });
    }
    if (type === 'sfx' || type === 'ambience') {
      this._section(t('Creative'), (b) => {
        this._fxSlider(b, clips, 'Reverb', 'reverb', 'es', 'mix', { min: 0, max: 100, def: 20, suffix: '%', extra: { roomSize: 60, decay: 55 } });
      });
    }
    this.root.scrollTop = scroll;
  }
}
