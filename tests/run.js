// ULI uçtan uca test çalıştırıcısı.
// Kullanım: npm test                (tümü)
//           npm test -- effects     (adında "effects" geçen testler)
// Her test, uygulamayı ayrı ve geçici bir veri klasörüyle açar (kullanıcının ayarlarına dokunmaz),
// tests/e2e/_prelude.js + test dosyasını sayfada çalıştırır ve sonuçları toplar.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MEDIA = path.join(__dirname, '.media');
const E2E = path.join(__dirname, 'e2e');
const electron = require('electron');
const ffmpeg = require('ffmpeg-static');

// ---- test medyası (bir kez üretilir, tests/.media altında; depoya girmez)
function ff(args) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr);
}
function makeMedia() {
  fs.mkdirSync(MEDIA, { recursive: true });
  const m = (f) => path.join(MEDIA, f);
  const need = (f) => !fs.existsSync(m(f));
  // konuşmaya benzeyen, senkron için ayırt edici ses (düzensiz patlamalar)
  const speech = "0.5*sin(2*PI*(180+60*sin(2*PI*0.7*t))*t)*gt(sin(2*PI*1.9*t)+sin(2*PI*0.53*t+1)+sin(2*PI*3.1*t+2)\\,0.6)";
  if (need('speech.wav')) ff(['-f', 'lavfi', '-i', `aevalsrc='${speech}':s=48000:d=12`, '-ac', '2', m('speech.wav')]);
  if (need('scenes.mp4')) ff(['-f', 'lavfi', '-i', 'color=red:s=320x240:r=30:d=1.5', '-f', 'lavfi', '-i', 'testsrc=s=320x240:r=30:d=1.5', '-f', 'lavfi', '-i', 'color=blue:s=320x240:r=30:d=1.5', '-f', 'lavfi', '-i', 'smptebars=s=320x240:r=30:d=1.5', '-f', 'lavfi', '-i', 'sine=f=440:d=6', '-filter_complex', '[0][1][2][3]concat=n=4:v=1:a=0[v]', '-map', '[v]', '-map', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', m('scenes.mp4')]);
  if (need('camA.mp4')) ff(['-f', 'lavfi', '-i', 'color=red:s=320x180:r=30:d=10', '-i', m('speech.wav'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '10', m('camA.mp4')]);
  if (need('camB.mp4')) ff(['-f', 'lavfi', '-i', 'color=blue:s=320x180:r=30:d=8', '-ss', '1.5', '-i', m('speech.wav'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '8', m('camB.mp4')]);
  if (need('clicks120.wav')) ff(['-f', 'lavfi', '-i', "aevalsrc='0.8*sin(2*PI*900*t)*exp(-40*mod(t-0.13\\,0.5))*gte(mod(t-0.13\\,0.5)\\,0)+0.15*sin(2*PI*110*t)':s=44100:d=20", '-ac', '2', m('clicks120.wav')]);
  if (need('tone440.wav')) ff(['-f', 'lavfi', '-i', 'sine=f=440:d=4:sample_rate=48000', '-ac', '2', m('tone440.wav')]);
  if (need('rotating.mp4')) ff(['-f', 'lavfi', '-i', 'mandelbrot=s=1280x960:rate=30', '-vf', "rotate=a='t*0.4':ow=1280:oh=960,crop=640:480,format=yuv420p", '-t', '2', '-c:v', 'libx264', m('rotating.mp4')]);
}

function runOne(file) {
  return new Promise((resolve) => {
    const script = path.join(os.tmpdir(), 'uli_test_' + path.basename(file));
    fs.writeFileSync(script, fs.readFileSync(path.join(E2E, '_prelude.js'), 'utf8').replace('/*__TEST_BODY__*/', fs.readFileSync(file, 'utf8')));
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uli-test-'));
    // konuşma modeli (otomatik altyazı testleri): tests/.models içindekiler geçici veri klasörüne bağlanır (indirme yok)
    const MODELS = path.join(__dirname, '.models');
    if (fs.existsSync(MODELS)) {
      fs.mkdirSync(path.join(userData, 'models'), { recursive: true });
      for (const f of fs.readdirSync(MODELS)) {
        const dst = path.join(userData, 'models', f);
        try { fs.linkSync(path.join(MODELS, f), dst); } catch (e) { fs.copyFileSync(path.join(MODELS, f), dst); }
      }
    }
    const env = { ...process.env, ULI_TEST: script, ULI_TEST_USERDATA: userData, ULI_TEST_MEDIA: MEDIA };
    const p = spawn(electron, [ROOT], { env, windowsHide: true });
    let buf = '';
    const timer = setTimeout(() => p.kill(), 8 * 60 * 1000);
    p.stdout.on('data', (d) => { buf += d; });
    p.stderr.on('data', (d) => { buf += d; });
    p.on('close', () => {
      clearTimeout(timer);
      try { fs.rmSync(userData, { recursive: true, force: true }); fs.unlinkSync(script); } catch (e) { /* */ }
      const m = /\[TEST RESULT\] (.*)/.exec(buf);
      if (!m) { const e = /\[TEST ERROR\] (.*)/.exec(buf); return resolve({ checks: [{ name: 'test ran', ok: false, detail: e ? e[1] : 'no result (timeout or crash)' }] }); }
      try { resolve(JSON.parse(m[1])); } catch (e) { resolve({ checks: [{ name: 'result parse', ok: false, detail: m[1].slice(0, 300) }] }); }
    });
  });
}

(async () => {
  const filter = process.argv[2] || '';
  console.log('Preparing test media...');
  makeMedia();
  const files = fs.readdirSync(E2E).filter((f) => f.endsWith('.test.js') && f.includes(filter)).sort();
  let pass = 0, fail = 0;
  for (const f of files) {
    const t0 = Date.now();
    process.stdout.write(`\n▶ ${f}\n`);
    const r = await runOne(path.join(E2E, f));
    for (const c of r.checks || []) {
      if (c.ok) pass++; else fail++;
      console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.detail !== undefined ? '  — ' + (typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail)) : ''}`);
    }
    for (const e of r.errors || []) { fail++; console.log('  ✗ page error — ' + e); }
    console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
