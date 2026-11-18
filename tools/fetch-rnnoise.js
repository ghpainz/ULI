// RNNoise konuşma gürültü modeli ("Konuşmayı Netleştir" efekti, FFmpeg arnndn): sabit sürüm, SHA-256 doğrulaması.
// Kaynak: https://github.com/GregorR/rnnoise-models (yazarına göre telif kapsamında değil). vendor/rnnoise/ klasörüne iner.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const URL_ = 'https://raw.githubusercontent.com/GregorR/rnnoise-models/3eee541a283fd3b8f81b85b1748e3b9ccbefa04d/leavened-quisling-2018-08-31/lq.rnnn';
const FALLBACK = 'https://raw.githubusercontent.com/GregorR/rnnoise-models/master/leavened-quisling-2018-08-31/lq.rnnn';
const SHA256 = '1957528b752799fddf06270bc5469af7cf54c3badc358544ae2abed730943ff9';
const OUT = path.join(__dirname, '..', 'vendor', 'rnnoise', 'lq.rnnn');

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'uli-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) { res.resume(); return resolve(get(new URL(res.headers.location, url).toString(), redirects + 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve(Buffer.concat(c))); res.on('error', reject);
    }).on('error', reject);
  });
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

(async () => {
  if (fs.existsSync(OUT) && sha(fs.readFileSync(OUT)) === SHA256) { console.log('RNNoise model ready'); return; }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  let buf;
  try { buf = await get(URL_); } catch (e) { buf = await get(FALLBACK); }
  if (sha(buf) !== SHA256) throw new Error('SHA-256 mismatch');
  fs.writeFileSync(OUT, buf);
  console.log('RNNoise model downloaded');
})().catch((e) => { console.error('fetch-rnnoise failed:', e.message); process.exit(1); });
