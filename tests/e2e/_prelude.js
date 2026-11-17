// Her testin başına eklenir: uygulamanın açılmasını bekler, yardımcıları ve check() fonksiyonunu tanımlar.
// Test gövdesi async bir fonksiyon içinde çalışır; sonuç { checks, errors } olarak döner.
(async () => {
  const checks = [], errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.error?.stack || e.message).slice(0, 300)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason?.stack || e.reason).slice(0, 300)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); };
  const ipc = window.require('electron').ipcRenderer;
  const fs = window.require('fs');
  const path = window.require('path');
  const cp = window.require('child_process');
  const MEDIA = window.require('process').env.ULI_TEST_MEDIA.replace(/\\/g, '/') + '/';
  const OUT = window.require('os').tmpdir().replace(/\\/g, '/') + '/uli-test-out/';
  fs.mkdirSync(OUT, { recursive: true });
  for (let i = 0; i < 60 && !window.__uli; i++) await sleep(250);
  const U = window.__uli;
  document.querySelector('.welcome')?.remove();
  const { ff } = await import('./js/ffmpeg.js');
  const S = () => U.store.seq;
  // küçük yardımcılar
  const place = (media, start = 0, { v = 0, a = null, inS = 0, outS = 5 } = {}) => {
    let ids;
    U.store.commit('test place', (p) => { ids = U.E.placeMedia(p, p.sequences[p.activeSequenceId], p.media[media.id], { start, vTrack: v, aTrack: a, mode: 'overwrite', inSec: inS, outSec: outS, settings: U.settings }); });
    return ids;
  };
  const clearSeq = () => U.store.commit('test clear', (p) => { const s = p.sequences[p.activeSequenceId]; s.clips = {}; s.markers = []; });
  const pixels = async (file, W = 64, H = 36) => {
    const im = new Image(); im.src = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64'); await im.decode();
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(im, 0, 0, W, H);
    return g.getImageData(0, 0, W, H).data;
  };
  const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (a.length / 4) / 3; };
  const probe = (file) => { const r = cp.spawnSync(ff.ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' }); const d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(r.stderr); return { duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0, video: /Video:/.test(r.stderr), audio: /Audio:/.test(r.stderr) }; };
  const volume = (file) => { const r = cp.spawnSync(ff.ffmpeg, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }); const m = /max_volume:\s*(-?[\d.]+)/.exec(r.stderr); return m ? +m[1] : null; };
  try {
    /*__TEST_BODY__*/
  } catch (e) {
    check('test completed without exception', false, String(e.stack || e).slice(0, 400));
  }
  return { checks, errors: errors.slice(0, 10) };
})();
