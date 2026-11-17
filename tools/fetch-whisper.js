// whisper.cpp (konuşmayı yazıya çevirme motoru) Windows sürümünü indirir: sabit sürüm, SHA-256 doğrulaması,
// yalnız gereken dosyalar vendor/whisper/ klasörüne çıkarılır. `npm run dist` öncesi otomatik çalışır.
// Kullanım: node tools/fetch-whisper.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const VERSION = 'b5454';
const ZIP_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${VERSION}/whisper-bin-x64.zip`;
const SHA256 = '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb';
const KEEP = (f) => f === 'whisper-cli.exe' || f === 'whisper.dll' || /^ggml.*\.dll$/.test(f);
const OUT = path.join(__dirname, '..', 'vendor', 'whisper');

function download(url, file, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'uli-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), file, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' ' + url)); }
      const out = fs.createWriteStream(file);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  const stamp = path.join(OUT, 'VERSION');
  if (fs.existsSync(path.join(OUT, 'whisper-cli.exe')) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === VERSION) {
    console.log('whisper.cpp ' + VERSION + ' already present');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uli-whisper-'));
  try {
    const zip = path.join(tmp, 'whisper.zip');
    console.log("Downloading " + ZIP_URL);
    await download(ZIP_URL, zip);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
    if (hash !== SHA256) throw new Error('SHA-256 mismatch: ' + hash);
    // Windows'un kendi tar.exe'si zip açabilir
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    const ex = path.join(tmp, 'x');
    fs.mkdirSync(ex);
    execFileSync(tar, ['-xf', zip, '-C', ex]);
    const src = path.join(ex, 'Release');
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
    const files = fs.readdirSync(src).filter(KEEP);
    for (const f of files) fs.copyFileSync(path.join(src, f), path.join(OUT, f));
    fs.writeFileSync(stamp, VERSION + '\n');
    console.log('whisper.cpp ' + VERSION + ': ' + files.length + ' files -> vendor/whisper');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error('fetch-whisper failed:', e.message); process.exit(1); });
