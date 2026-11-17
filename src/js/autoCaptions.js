// "Otomatik Altyazı" penceresi: sekansın sesini yazıya çevirir ve altyazı izine (C1) zamanlanmış altyazılar ekler.
import { store } from './store.js';
import { app } from './appContext.js';
import { t } from './i18n.js';
import { el, uid, nodePath, nodeFs, childProcess } from './util.js';
import { ff } from './ffmpeg.js';
import { sequenceDuration } from './model.js';
import { exportSequence } from './exporter.js';
import { ensureCaptions, sortCaptions, CAPTION_PRESETS, DEFAULT_CAPTION_STYLE } from './captions.js';
import { modal, toast, selectEl } from './ui/dialogs.js';
import { MODELS, hasModel, downloadModel, transcribe, groupWords, engineAvailable } from './asr.js';

export const LANGS = [['auto', 'Detect automatically'], ['tr', 'Turkish'], ['en', 'English'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'], ['ar', 'Arabic'], ['ru', 'Russian']];

function hasAudio(seq) {
  return Object.values(seq.clips).some((c) => c.type === 'audio' && c.enabled !== false);
}

export async function autoCaptionsDialog() {
  const seq = store.seq;
  if (!seq) return null;
  if (!engineAvailable()) { toast(t('Speech recognition engine is missing. Please reinstall ULI.'), 'error'); return null; }
  if (!hasAudio(seq)) { toast(t('This sequence has no audio to transcribe'), 'warn'); return null; }
  const s = store.settings || {};
  const lang = selectEl(LANGS.map(([v, l]) => ({ value: v, label: t(l) })), s.asrLang || 'auto');
  let model = s.asrModel && MODELS.some((m) => m.id === s.asrModel) ? s.asrModel : 'fast';
  const modelBox = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } });
  const drawModels = () => {
    modelBox.innerHTML = '';
    for (const m of MODELS) {
      const have = hasModel(m.id);
      const b = el('button', { class: m.id === model ? 'primary' : '', style: { padding: '8px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '3px' } },
        el('b', { text: t(m.name) }),
        el('span', { text: t(m.desc), style: { fontSize: '11px', opacity: 0.85 } }),
        el('span', { text: have ? '✓ ' + t('Downloaded') : t('Downloads once: {n} MB', { n: Math.round(m.size / 1e6) }), style: { fontSize: '11px', opacity: 0.85 } }));
      b.addEventListener('click', () => { model = m.id; drawModels(); });
      modelBox.appendChild(b);
    }
  };
  drawModels();
  const vertical = seq.width < seq.height;
  const lineLen = selectEl([{ value: 'short', label: t('Short lines (social media)') }, { value: 'normal', label: t('Normal lines') }], vertical ? 'short' : 'normal');
  const style = selectEl([{ value: '', label: t('Keep current style') }, ...CAPTION_PRESETS.map((p) => ({ value: p.id, label: t(p.name) }))], vertical ? 'social' : '');
  const hasIO = seq.inFrame != null || seq.outFrame != null;
  const range = selectEl([{ value: 'all', label: t('Entire Sequence') }, ...(hasIO ? [{ value: 'io', label: t('Sequence In/Out') }] : [])], hasIO ? 'io' : 'all');
  const existing = (seq.captions || []).length;
  const mode = selectEl([{ value: 'replace', label: t('Replace captions in this range') }, { value: 'add', label: t('Keep them and add new ones') }], 'replace');
  const row = (label, c) => el('div', { style: { display: 'grid', gridTemplateColumns: '130px 1fr', alignItems: 'center', gap: '8px', margin: '7px 0' } }, el('span', { text: label }), c);
  const body = el('div', {},
    row(t('Language'), lang), row(t('Quality'), modelBox), row(t('Style'), style), row(t('Line Length'), lineLen), row(t('Range'), range),
    ...(existing ? [row(t('Existing Captions'), mode)] : []),
    el('div', { text: t('Speech is recognized on this computer; nothing is uploaded.'), style: { color: 'var(--text-dim)', fontSize: '11px', marginTop: '8px' } }));
  const r = await modal({ title: t('Auto Captions'), body, width: 560, buttons: [
    { label: t('Cancel'), value: null },
    { label: t('Create Captions'), primary: true, onClick: () => ({ lang: lang.value, model, style: style.value, lineLen: lineLen.value, range: range.value, mode: existing ? mode.value : 'add' }) },
  ] });
  if (!r) return null;
  store.settings.asrLang = r.lang; store.settings.asrModel = r.model;
  const dur = sequenceDuration(seq);
  const [f0, f1] = r.range === 'io' ? [seq.inFrame ?? 0, seq.outFrame ?? dur] : [0, dur];
  return runAutoCaptions(seq, { ...r, f0, f1 });
}

// İlerleme penceresiyle çalıştır (testler doğrudan da çağırabilir)
export async function runAutoCaptions(seq, { lang = 'auto', model = 'fast', style = '', lineLen = 'normal', f0, f1, mode = 'add', silent = false } = {}) {
  const ctrl = new AbortController();
  const bar = el('div', { class: 'progress' }, el('div'));
  const info = el('div', { class: 'muted', style: { marginTop: '6px' } });
  let closeFn = null;
  const set = (label, p) => { info.textContent = label + (p != null ? ' · ' + Math.round(p * 100) + '%' : ''); bar.firstChild.style.width = Math.round((p ?? 0) * 100) + '%'; };
  if (!silent) modal({ title: t('Auto Captions'), body: el('div', { style: { width: '400px' } }, bar, info), escape: false, onOpen: (c) => { closeFn = c; }, buttons: [{ label: t('Cancel'), onClick: () => { ctrl.abort(); return false; } }] });
  const dir = nodePath.join(app.paths.userData, 'cache', 'asr');
  nodeFs.mkdirSync(dir, { recursive: true });
  const raw = nodePath.join(dir, 'mix_' + uid('a') + '.wav');
  const wav = raw.replace(/\.wav$/, '_16k.wav');
  const t0 = performance.now();
  try {
    if (!hasModel(model)) {
      set(t('Downloading speech model (once)'), 0);
      await downloadModel(model, { signal: ctrl.signal, onProgress: (p) => set(t('Downloading speech model (once)'), p) });
    }
    set(t('Preparing audio'), 0);
    await exportSequence(seq, { format: 'wav', file: raw, audio: true, sampleRate: 16000, range: [f0, f1] }, { signal: ctrl.signal, onProgress: (p) => set(t('Preparing audio'), p) });
    await new Promise((res, rej) => {
      const p = childProcess.spawn(ff.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-i', raw, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], { windowsHide: true });
      p.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c))));
      p.on('error', rej);
    });
    set(t('Recognizing speech'), 0);
    const res = await transcribe(wav, { model, lang, signal: ctrl.signal, onProgress: (p) => set(t('Recognizing speech'), p) });
    const vertical = seq.width < seq.height;
    const lines = groupWords(res.words, lineLen === 'short' ? { maxChars: vertical ? 20 : 26, maxDur: 2.5 } : { maxChars: 42, maxDur: 4.5 });
    const fps = seq.fps;
    let added = 0;
    store.commit(t('Auto Captions'), (p) => {
      const sq = p.sequences[seq.id];
      ensureCaptions(sq);
      if (mode === 'replace') sq.captions = sq.captions.filter((c) => c.end <= f0 || c.start >= f1);
      const caps = lines.map((L) => ({
        id: uid('cap'),
        start: f0 + Math.round(L.t0 * fps),
        end: f0 + Math.round(L.t1 * fps),
        text: L.text,
        words: L.words.map((w) => ({ text: w.text, start: f0 + Math.round(w.t0 * fps), end: f0 + Math.round(w.t1 * fps) })),
      }));
      // okunabilirlik: en az ~0.6 sn ekranda kalsın, sonraki altyazıyla çakışmasın
      for (let i = 0; i < caps.length; i++) {
        const c = caps[i], next = caps[i + 1];
        c.end = Math.max(c.end + Math.round(fps * 0.15), c.start + Math.round(fps * 0.6));
        if (next) c.end = Math.min(c.end, next.start);
        if (c.end <= c.start) c.end = c.start + 1;
      }
      sq.captions.push(...caps);
      sortCaptions(sq);
      sq.captionsVisible = true;
      const pr = CAPTION_PRESETS.find((x) => x.id === style);
      if (pr) sq.captionStyle = { ...DEFAULT_CAPTION_STYLE, ...(sq.captionStyle || {}), ...pr.st };
      added = caps.length;
    });
    const secs = (performance.now() - t0) / 1000;
    if (!silent) {
      toast(added ? t('{n} captions created', { n: added }) + ' · ' + secs.toFixed(0) + ' s' : t('No speech was found'), added ? 'success' : 'warn', 5000);
      if (added) app.commands.showPanel('captions');
    }
    return { added, language: res.language, words: res.words.length, seconds: secs };
  } catch (e) {
    if (!(e.cancelled || e.message === 'cancelled' || ctrl.signal.aborted)) { if (!silent) toast(t('Auto captions failed') + ': ' + e.message, 'error', 8000); throw e; }
    return null;
  } finally {
    for (const f of [raw, wav]) { try { nodeFs.unlinkSync(f); } catch (e) { /* */ } }
    if (closeFn) closeFn();
  }
}
