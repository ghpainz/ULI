// MediaPipe yapay zekâ modelleri (arka plan silme, yüz takibi): sabit sürüm adresleri, SHA-256 doğrulaması.
// vendor/mediapipe-models/ klasörüne indirilir; `npm run dist` öncesi otomatik çalışır. Lisans: Apache-2.0.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const BASE = 'https://storage.googleapis.com/mediapipe-models/';
const MODELS = [
  ['image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite', '191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b'],
  ['face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite', '3698b18f063835bc609069ef052228fbe86d9c9a6dc8dcb7c7c2d69aed2b181b'],
];
const OUT = path.join(__dirname, '..', 'vendor', 'mediapipe-models');

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'uli-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' ' + url)); }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [rel, hash] of MODELS) {
    const file = path.join(OUT, path.basename(rel));
    if (fs.existsSync(file) && sha(fs.readFileSync(file)) === hash) continue;
    console.log('Downloading ' + path.basename(rel));
    const buf = await get(BASE + rel);
    if (sha(buf) !== hash) throw new Error('SHA-256 mismatch: ' + path.basename(rel));
    fs.writeFileSync(file, buf);
  }
  console.log('MediaPipe models ready (' + MODELS.length + ')');
})().catch((e) => { console.error('fetch-mediapipe-models failed:', e.message); process.exit(1); });
