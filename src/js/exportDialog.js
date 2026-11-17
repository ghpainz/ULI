// Dışa Aktarma penceresi
import { store } from './store.js';
import { app } from './appContext.js';
import { t } from './i18n.js';
import { el, ipc, nodePath, framesToTC, fmtSeconds } from './util.js';
import { sequenceDuration } from './model.js';
import { FORMATS, exportSequence, exportFrame } from './exporter.js';
import { captionsInRange, toSRT } from './captions.js';
import { ff } from './ffmpeg.js';
import { settings, saveSettings } from './settings.js';
import { modal, alertDialog, toast, selectEl, numInput } from './ui/dialogs.js';
import { addToQueue } from './exportQueue.js';

const LAST_KEY = 'uli.exportOpts';

// Platform hazır ayarları: kısa kenar (px), kalite (crf) ya da hedef bit hızı (Mbps), önerilen en-boy oranı
export const PLATFORM_PRESETS = [
  { id: 'youtube1080', label: 'YouTube 1080p', short: 1080, crf: 18, abr: 320, ratio: [16, 9] },
  { id: 'youtube4k', label: 'YouTube 4K', short: 2160, crf: 18, abr: 320, ratio: [16, 9] },
  { id: 'tiktok', label: 'TikTok / Reels / Shorts', short: 1080, bitrate: 12, abr: 256, ratio: [9, 16] },
  { id: 'instagram', label: 'Instagram (feed)', short: 1080, bitrate: 10, abr: 256, ratio: [4, 5] },
  { id: 'whatsapp', label: 'WhatsApp / small file', short: 720, crf: 28, abr: 128 },
];

export async function openExportDialog() {
  const seq = store.seq;
  if (!seq) return;
  if (app.engine.playing) app.engine.pause();
  const last = JSON.parse(localStorage.getItem(LAST_KEY) || '{}');
  const dur = sequenceDuration(seq);
  if (dur <= 0) { alertDialog(t('The sequence is empty.')); return; }
  const fmtSel = selectEl(Object.entries(FORMATS).map(([k, f]) => ({ value: k, label: t(f.label) })), last.format || 'mp4_h264');
  const fileIn = el('input', { type: 'text', style: { width: '330px' } });
  const dir = settings.lastExportDir || app.paths.videos;
  const baseName = seq.name.replace(/[\\/:*?"<>|]/g, '_');
  const setExt = () => {
    const f = FORMATS[fmtSel.value];
    let p = fileIn.value || nodePath.join(dir, baseName + '.' + f.ext);
    p = p.replace(/\.[^.\\/]+$/, '') + '.' + f.ext;
    fileIn.value = p;
  };
  fileIn.value = nodePath.join(dir, baseName + '.' + FORMATS[fmtSel.value].ext);
  const browse = el('button', { text: t('Browse...') });
  browse.addEventListener('click', async () => {
    const f = FORMATS[fmtSel.value];
    const r = await ipc.invoke('dialog:save', { title: t('Export Media'), defaultPath: fileIn.value, filters: [{ name: t(f.label), extensions: [f.ext] }] });
    if (!r.canceled && r.filePath) fileIn.value = r.filePath;
  });
  const match = el('input', { type: 'checkbox' });
  match.checked = last.match !== false;
  const wIn = numInput(seq.width, { min: 16, max: 8192, width: 80 });
  const hIn = numInput(seq.height, { min: 16, max: 8192, width: 80 });
  const updMatch = () => {
    wIn.disabled = hIn.disabled = match.checked;
    if (match.checked) { wIn.value = seq.width; hIn.value = seq.height; }
  };
  match.addEventListener('change', updMatch);
  if (!match.checked && last.width) { wIn.value = last.width; hIn.value = last.height; }
  updMatch();
  // en-boy oranını koru
  wIn.addEventListener('input', () => { hIn.value = Math.round((+wIn.value * seq.height) / seq.width / 2) * 2; });
  const quality = selectEl([
    { value: 16, label: t('Highest') }, { value: 19, label: t('High') }, { value: 23, label: t('Medium') }, { value: 28, label: t('Low (small file)') },
  ], last.crf ?? 19);
  const brMode = el('input', { type: 'checkbox' });
  brMode.checked = !!last.bitrateMode;
  const brIn = numInput(last.bitrate || 20, { min: 1, max: 400, width: 70 });
  const hw = el('input', { type: 'checkbox' });
  hw.checked = ff.nvenc && last.hw !== false;
  hw.disabled = !ff.nvenc;
  const preset = selectEl(['ultrafast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower'].map((p) => ({ value: p, label: p })), last.preset || 'medium');
  const prores = selectEl([{ value: 0, label: 'ProRes 422 Proxy' }, { value: 1, label: 'ProRes 422 LT' }, { value: 2, label: 'ProRes 422' }, { value: 3, label: 'ProRes 422 HQ' }, { value: 4, label: 'ProRes 4444' }], last.proresProfile ?? 3);
  const gifFps = numInput(last.gifFps || 15, { min: 1, max: 60, width: 60 });
  const audioCb = el('input', { type: 'checkbox' });
  audioCb.checked = last.audio !== false;
  const sr = selectEl([{ value: 48000, label: '48000 Hz' }, { value: 44100, label: '44100 Hz' }], last.sampleRate || 48000);
  const abr = selectEl([128, 192, 256, 320].map((v) => ({ value: v, label: v + ' kbps' })), last.audioBitrate || 320);
  const bits = selectEl([{ value: 16, label: '16 bit' }, { value: 24, label: '24 bit' }], last.audioBits || 16);
  const hasCaps = !!(seq.captions && seq.captions.length);
  const burn = el('input', { type: 'checkbox' });
  burn.checked = seq.captionsVisible !== false;
  const srtCb = el('input', { type: 'checkbox' });
  srtCb.checked = !!last.sidecarSrt;
  const hasIO = seq.inFrame != null || seq.outFrame != null;
  const range = selectEl([{ value: 'all', label: t('Entire Sequence') }, ...(hasIO ? [{ value: 'io', label: t('Sequence In/Out') }] : [])], hasIO ? 'io' : 'all');
  const summary = el('div', { class: 'muted', style: { marginTop: '10px', lineHeight: '1.6' } });
  const presetSel = selectEl([{ value: '', label: t('Custom') }, ...PLATFORM_PRESETS.map((x) => ({ value: x.id, label: t(x.label) }))], '');
  const presetHint = el('span', { class: 'muted', style: { fontSize: '11px' } });
  presetSel.addEventListener('change', () => {
    const pr = PLATFORM_PRESETS.find((x) => x.id === presetSel.value);
    presetHint.textContent = '';
    if (!pr) return;
    fmtSel.value = 'mp4_h264';
    setExt();
    // sekansın en-boy oranı korunur; kısa kenar platformun önerdiği boyuta getirilir
    const land = seq.width >= seq.height;
    const S = pr.short;
    const even = (v) => Math.max(2, Math.round(v / 2) * 2);
    match.checked = false;
    updMatch();
    wIn.value = land ? even((S * seq.width) / seq.height) : S;
    hIn.value = land ? S : even((S * seq.height) / seq.width);
    if (pr.bitrate) { brMode.checked = true; brIn.value = pr.bitrate; } else { brMode.checked = false; quality.value = pr.crf; }
    abr.value = pr.abr;
    audioCb.checked = true;
    if (pr.ratio && Math.abs(seq.width / seq.height - pr.ratio[0] / pr.ratio[1]) > 0.02) {
      presetHint.textContent = t('Tip: this platform prefers {r}. Change it with Sequence > Canvas / Aspect Ratio.', { r: pr.ratio[0] + ':' + pr.ratio[1] });
    }
    vis();
  });
  const rows = {};
  const row = (key, label, ...inputs) => {
    const l = el('label', { text: label });
    const v = el('div', { class: 'inline' }, ...inputs);
    rows[key] = [l, v];
    return [l, v];
  };
  const grid = el('div', { class: 'form-grid', style: { gridTemplateColumns: '170px 1fr' } },
    el('div', { class: 'form-section', text: t('Export Settings') }),
    ...row('platform', t('Preset'), presetSel, presetHint),
    ...row('format', t('Format'), fmtSel),
    ...row('file', t('Output Name'), fileIn, browse),
    ...row('range', t('Range'), range),
    el('div', { class: 'form-section', text: t('Video'), 'data-sec': 'video' }),
    ...row('size', t('Frame Size'), match, el('span', { text: t('Match Source') }), wIn, el('span', { text: '×' }), hIn),
    ...row('quality', t('Quality'), quality),
    ...row('bitrate', t('Target Bitrate'), brMode, brIn, el('span', { text: 'Mbps' })),
    ...row('hw', t('Hardware Encoding (NVENC)'), hw, el('span', { class: 'muted', text: ff.nvenc ? t('Available') : t('Not available') })),
    ...row('preset', t('Encoder Preset'), preset),
    ...row('prores', t('ProRes Profile'), prores),
    ...row('gif', t('GIF Frame Rate'), gifFps),
    el('div', { class: 'form-section', text: t('Audio'), 'data-sec': 'audio' }),
    ...row('audio', t('Export Audio'), audioCb),
    ...row('sr', t('Sample Rate'), sr),
    ...row('abr', t('Audio Bitrate'), abr),
    ...row('bits', t('Sample Size'), bits),
    el('div', { class: 'form-section', text: t('Captions'), 'data-sec': 'captions' }),
    ...row('burn', t('Burn Captions Into Video'), burn),
    ...row('srt', t('Create Sidecar SRT File'), srtCb),
  );
  const body = el('div', {}, grid, summary);
  const vis = () => {
    const k = fmtSel.value;
    const f = FORMATS[k];
    const show = (key, on) => rows[key].forEach((x) => { x.style.display = on ? '' : 'none'; });
    grid.querySelector('[data-sec="video"]').style.display = f.video ? '' : 'none';
    grid.querySelector('[data-sec="audio"]').style.display = f.audio ? '' : 'none';
    show('size', f.video);
    show('quality', ['mp4_h264', 'mp4_hevc', 'webm_vp9'].includes(k));
    show('bitrate', ['mp4_h264', 'mp4_hevc', 'webm_vp9'].includes(k));
    show('hw', ['mp4_h264', 'mp4_hevc'].includes(k));
    show('preset', ['mp4_h264', 'mp4_hevc'].includes(k) && !hw.checked);
    show('prores', k === 'mov_prores');
    show('gif', k === 'gif');
    show('audio', f.audio && f.video);
    show('sr', f.audio);
    show('abr', ['mp4_h264', 'mp4_hevc', 'webm_vp9', 'mp3', 'm4a'].includes(k));
    show('bits', k === 'wav');
    grid.querySelector('[data-sec="captions"]').style.display = hasCaps && f.video ? '' : 'none';
    show('burn', hasCaps && f.video);
    show('srt', hasCaps);
    quality.disabled = brMode.checked;
    const [a, b] = range.value === 'io' ? [seq.inFrame ?? 0, seq.outFrame ?? dur] : [0, dur];
    summary.innerHTML = `${t('Duration')}: <b>${framesToTC(b - a, seq.fps)}</b> (${b - a} ${t('frames')}) · ${seq.width}×${seq.height} @ ${seq.fps} fps`;
  };
  fmtSel.addEventListener('change', () => { setExt(); vis(); });
  hw.addEventListener('change', vis);
  brMode.addEventListener('change', vis);
  range.addEventListener('change', vis);
  vis();
  const opts = await modal({
    title: t('Export Settings'),
    body,
    width: 620,
    buttons: [
      { label: t('Cancel'), value: null },
      { label: t('Add to Queue'), onClick: () => ({ ...collect(), queue: true }) },
      { label: t('Export'), primary: true, onClick: () => collect() },
    ],
  });
  function collect() {
        const f = FORMATS[fmtSel.value];
        const [a, b] = range.value === 'io' ? [seq.inFrame ?? 0, seq.outFrame ?? dur] : [0, dur];
        return {
          format: fmtSel.value, file: fileIn.value, width: +wIn.value, height: +hIn.value, match: match.checked,
          crf: +quality.value, bitrateMode: brMode.checked, bitrate: +brIn.value, hw: hw.checked && ff.nvenc, preset: preset.value,
          proresProfile: +prores.value, gifFps: +gifFps.value, audio: f.audio && (audioCb.checked || !f.video), sampleRate: +sr.value,
          audioBitrate: +abr.value, audioBits: +bits.value, range: [a, b],
          burnCaptions: hasCaps ? burn.checked : undefined, sidecarSrt: hasCaps && srtCb.checked,
        };
  }
  if (!opts) return;
  localStorage.setItem(LAST_KEY, JSON.stringify(opts));
  settings.lastExportDir = nodePath.dirname(opts.file);
  saveSettings();
  const fs = window.require('fs');
  if (fs.existsSync(opts.file) && opts.format !== 'png_seq') {
    const r = await modal({ title: t('Export Media'), body: el('div', { text: t('File already exists. Overwrite?') + '\n' + opts.file, style: { whiteSpace: 'pre-wrap' } }), buttons: [{ label: t('Cancel'), value: false }, { label: t('Overwrite'), primary: true, value: true }] });
    if (!r) return;
  }
  if (opts.queue) {
    delete opts.queue;
    if (opts.sidecarSrt) {
      const s2 = { ...seq, captions: captionsInRange(seq, opts.range[0], opts.range[1]) };
      window.require('fs').writeFileSync(opts.file.replace(/\.[^.\\/]+$/, '') + '.srt', toSRT(s2, opts.range[0]), 'utf8');
    }
    addToQueue(seq, opts);
    app.commands.showPanel('exportQueue');
    return;
  }
  await runExport(seq, opts);
}

async function runExport(seq, opts) {
  const ctrl = new AbortController();
  const bar = el('div', { class: 'progress' }, el('div'));
  const status = el('div', { style: { marginBottom: '8px' }, text: t('Preparing...') });
  const info = el('div', { class: 'muted', style: { marginTop: '8px', fontFamily: 'var(--mono)' } });
  const body = el('div', { style: { width: '460px' } }, el('div', { style: { marginBottom: '6px', wordBreak: 'break-all' }, text: opts.file }), status, bar, info);
  app.exporting = true;
  app.engine.suspended = true;
  let closeFn = null;
  const dlg = modal({
    title: t('Exporting'),
    body,
    escape: false,
    onOpen: (close) => { closeFn = close; },
    buttons: [{ label: t('Cancel'), onClick: () => { ctrl.abort(); status.textContent = t('Cancelling...'); return false; } }],
  });
  const started = performance.now();
  try {
    if (opts.sidecarSrt) {
      const s2 = { ...seq, captions: captionsInRange(seq, opts.range[0], opts.range[1]) };
      window.require('fs').writeFileSync(opts.file.replace(/\.[^.\\/]+$/, '') + '.srt', toSRT(s2, opts.range[0]), 'utf8');
    }
    const res = await exportSequence(seq, opts, {
      signal: ctrl.signal,
      onStatus: (s) => { status.textContent = s; },
      onProgress: (p, eta, done, total) => {
        bar.firstChild.style.width = Math.round(p * 100) + '%';
        const el2 = (performance.now() - started) / 1000;
        info.textContent = `${Math.round(p * 100)}%` + (done ? `  ·  ${done}/${total} ${t('frames')}` : '') + `  ·  ${t('Elapsed')} ${fmtSeconds(el2)}` + (eta != null ? `  ·  ${t('Remaining')} ${fmtSeconds(eta)}` : '') + (done && el2 > 0 ? `  ·  ${(done / el2).toFixed(1)} fps` : '');
      },
    });
    if (closeFn) { closeFn(); closeFn = null; }
    app.exporting = false;
    app.engine.suspended = false;
    app.engine.requestRender();
    const r = await modal({
      title: t('Export Complete'),
      body: el('div', { style: { whiteSpace: 'pre-wrap' }, text: res.file + '\n\n' + t('Time') + ': ' + fmtSeconds(res.seconds) }),
      buttons: [{ label: t('Show in Explorer'), value: 'reveal' }, { label: t('Open'), value: 'open' }, { label: t('OK'), primary: true, value: 'ok' }],
    });
    if (r === 'reveal') ipc.invoke('shell:reveal', res.file.includes('%05d') ? nodePath.dirname(res.file) : res.file);
    if (r === 'open') ipc.invoke('shell:open', res.file.includes('%05d') ? nodePath.dirname(res.file) : res.file);
  } catch (e) {
    if (closeFn) { closeFn(); closeFn = null; }
    app.exporting = false;
    app.engine.suspended = false;
    app.engine.requestRender();
    if (e.cancelled || e.message === 'cancelled') {
      toast(t('Export cancelled'));
      try { window.require('fs').unlinkSync(opts.file); } catch (er) { /* */ }
    } else {
      console.error(e);
      alertDialog(t('Export failed') + '\n\n' + e.message);
    }
  } finally {
    app.exporting = false;
    app.engine.suspended = false;
    if (closeFn) closeFn();
  }
  await dlg;
}

export async function exportFrameDialog() {
  const seq = store.seq;
  if (!seq) return;
  if (app.engine.playing) app.engine.pause();
  const f = app.engine.currentFrame;
  const name = seq.name.replace(/[\\/:*?"<>|]/g, '_') + '_' + framesToTC(f, seq.fps).replace(/:/g, '-');
  const r = await ipc.invoke('dialog:save', {
    title: t('Export Frame'),
    defaultPath: nodePath.join(settings.lastExportDir || app.paths.videos, name + '.png'),
    filters: [{ name: 'PNG', extensions: ['png'] }, { name: 'JPEG', extensions: ['jpg'] }],
  });
  if (r.canceled || !r.filePath) return;
  try {
    app.engine.suspended = true;
    toast(t('Exporting frame...'));
    await exportFrame(seq, f, r.filePath);
    toast(t('Frame exported') + ': ' + nodePath.basename(r.filePath));
  } catch (e) {
    alertDialog(t('Export failed') + '\n\n' + e.message);
  } finally {
    app.engine.suspended = false;
    app.engine.requestRender();
  }
}
