// Otomatik altyazı: konuşmayı yazıya çevirme (whisper.cpp, tamamen bu bilgisayarda çalışır).
// Model ilk kullanımda Hugging Face'ten bir kez indirilir (SHA-256 ile doğrulanır) ve %APPDATA%\ULI\models içinde durur.
import { app } from './appContext.js';
import { t } from './i18n.js';
import { nodePath, nodeFs, childProcess } from './util.js';
import { registerJob, ff } from './ffmpeg.js';

export const MODELS = [
  {
    id: 'fast', name: 'Fast', desc: 'Good accuracy, about 5× faster than real time',
    file: 'ggml-small-q5_1.bin', size: 190085487, dtw: 'small',
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
  },
  {
    id: 'best', name: 'Best', desc: 'Most accurate (especially Turkish), slower',
    file: 'ggml-large-v3-turbo-q5_0.bin', size: 574041195, dtw: 'large.v3.turbo',
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
  },
];
const MODEL_URL = (file) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`;

const userData = () => app.paths.userData;
const modelsDir = () => { const d = nodePath.join(userData(), 'models'); nodeFs.mkdirSync(d, { recursive: true }); return d; };
const workDir = () => { const d = nodePath.join(userData(), 'cache', 'asr'); nodeFs.mkdirSync(d, { recursive: true }); return d; };

export function engineAvailable() { return !!(app.paths && app.paths.whisper && nodeFs.existsSync(app.paths.whisper)); }
export function modelById(id) { return MODELS.find((m) => m.id === id) || MODELS[0]; }
export function modelPath(id) { return nodePath.join(modelsDir(), modelById(id).file); }
export function hasModel(id) {
  try { return nodeFs.statSync(modelPath(id)).size === modelById(id).size; } catch (e) { return false; }
}

// ---- Model indirme (yönlendirmeleri izler, .part dosyasına yazar, SHA-256 doğrular) ----
export function downloadModel(id, { onProgress, signal } = {}) {
  const m = modelById(id);
  const https = window.require('https');
  const crypto = window.require('crypto');
  const dest = modelPath(id), part = dest + '.part';
  const job = registerJob(t('Downloading speech model') + ' (' + Math.round(m.size / 1e6) + ' MB)');
  return new Promise((resolve, reject) => {
    let req = null, out = null, finished = false;
    const fail = (e) => {
      if (finished) return; finished = true;
      try { req && req.destroy(); } catch (er) { /* */ }
      try { out && out.destroy(); } catch (er) { /* */ }
      try { nodeFs.unlinkSync(part); } catch (er) { /* */ }
      job.done(); reject(e);
    };
    if (signal) signal.addEventListener('abort', () => fail(Object.assign(new Error('cancelled'), { cancelled: true })), { once: true });
    const get = (url, hops) => {
      req = https.get(url, { headers: { 'User-Agent': 'ULI' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 6) {
          res.resume();
          return get(new URL(res.headers.location, url).toString(), hops + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return fail(new Error('HTTP ' + res.statusCode)); }
        const hash = crypto.createHash('sha256');
        let got = 0;
        out = nodeFs.createWriteStream(part);
        res.on('data', (d) => { hash.update(d); got += d.length; const p = got / m.size; job.progress(p); onProgress && onProgress(p, got); });
        res.on('error', fail);
        out.on('error', fail);
        res.pipe(out);
        out.on('finish', () => {
          if (finished) return;
          const h = hash.digest('hex');
          if (got !== m.size || h !== m.sha256) return fail(new Error(t('Downloaded file is damaged, please try again')));
          finished = true;
          out.close(() => {
            try { nodeFs.renameSync(part, dest); } catch (e) { job.done(); return reject(e); }
            job.done(); resolve(dest);
          });
        });
      });
      req.on('error', fail);
    };
    get(MODEL_URL(m.file), 0);
  });
}

// ---- Yazıya çevirme ----
// wavFile: 16 kHz mono WAV. lang: 'auto' | 'tr' | 'en' ...
// Döner: { language, words: [{ text, t0, t1, p }] } (saniye)
export function transcribe(wavFile, { model = 'fast', lang = 'auto', onProgress, signal } = {}) {
  if (!engineAvailable()) return Promise.reject(new Error(t('Speech recognition engine is missing. Please reinstall ULI.')));
  if (!hasModel(model)) return Promise.reject(new Error(t('Speech model is not downloaded')));
  // Türkçe karakterli klasör adlarında sorun olmasın diye: çalışma klasörü userData, yollar göreli
  const cwd = userData();
  const rel = (p) => nodePath.relative(cwd, p);
  const outBase = nodePath.join(workDir(), 'asr_' + Date.now());
  const threads = Math.max(1, Math.min(8, (window.require('os').cpus().length || 2) - 1));
  // -dtw: kelime zamanlaması için hizalama (flash attention kapalıyken çalışır)
  const args = ['-m', rel(modelPath(model)), '-f', rel(wavFile), '-l', lang, '-t', String(threads), '-ojf', '-of', rel(outBase), '-pp', '-sns', '-dtw', modelById(model).dtw, '-nfa'];
  return new Promise((resolve, reject) => {
    const p = childProcess.spawn(app.paths.whisper, args, { cwd, windowsHide: true });
    let err = '';
    const onData = (d) => {
      const s = d.toString();
      err = (err + s).slice(-4000);
      const re = /progress\s*=\s*(\d+)%/g;
      let m, last = null;
      while ((m = re.exec(s))) last = +m[1];
      if (last != null && onProgress) onProgress(last / 100);
    };
    p.stderr.on('data', onData);
    p.stdout.on('data', onData);
    if (signal) signal.addEventListener('abort', () => { try { p.kill(); } catch (e) { /* */ } }, { once: true });
    p.on('error', reject);
    p.on('close', (code) => {
      if (signal && signal.aborted) return reject(Object.assign(new Error('cancelled'), { cancelled: true }));
      const jf = outBase + '.json';
      if (code !== 0 || !nodeFs.existsSync(jf)) return reject(new Error('whisper: ' + (err.split('\n').filter(Boolean).slice(-3).join(' ') || 'exit ' + code)));
      try {
        const j = JSON.parse(nodeFs.readFileSync(jf, 'utf8'));
        try { nodeFs.unlinkSync(jf); } catch (e) { /* */ }
        silences(wavFile).then((sil) => resolve({ language: j.result?.language || lang, words: snapToSpeech(wordsFromJson(j), sil) }), reject);
      } catch (e) { reject(e); }
    });
  });
}

// Whisper'ın bilinen "sessizlikte uydurma" cümleleri (özellikle Türkçe altyazı sitelerinden öğrenilmiş)
const DTW_LEAD = 0.1;
const HALLUCINATIONS = [/altyaz[ıi]\s*m\.?\s*k\.?/i, /izledi[ğg]iniz i[çc]in te[şs]ekk[üu]r/i, /abone olmay[ıi] unutmay[ıi]n/i, /thanks? for watching/i, /subtitles? by/i, /amara\.org/i];

// Belirteçlerden kelimeler: boşlukla başlayan belirteç yeni kelime başlatır
export function wordsFromJson(j) {
  const words = [];
  for (const seg of j.transcription || []) {
    const segText = (seg.text || '').trim();
    if (!segText || HALLUCINATIONS.some((r) => r.test(segText))) continue;
    let cur = null;
    for (const tk of seg.tokens || []) {
      const tx = tk.text || '';
      if (/^\[_|^\[[A-Z_]+\]$|^<\|/.test(tx) || !tk.offsets) continue;
      // DTW zamanı varsa onu kullan (konuşmanın gerçek yerine çok daha yakın; hep biraz geç kalır)
      const hasDtw = tk.t_dtw != null && tk.t_dtw >= 0;
      const t0 = hasDtw ? Math.max(0, tk.t_dtw / 100 - DTW_LEAD) : tk.offsets.from / 1000;
      const t1 = hasDtw ? t0 + 0.1 : tk.offsets.to / 1000;
      if (!cur || /^\s/.test(tx)) {
        if (cur && cur.text.trim()) words.push(cur);
        cur = { text: tx.trim(), t0, t1, p: tk.p ?? 1, n: 1 };
      } else {
        cur.text += tx; cur.t1 = Math.max(cur.t1, t1); cur.p += tk.p ?? 1; cur.n++;
      }
    }
    if (cur && cur.text.trim()) words.push(cur);
  }
  for (const w of words) { w.p = w.p / w.n; delete w.n; }
  // kelime sonu: bir sonraki kelimenin başı (en fazla 0.8 sn)
  for (let i = 0; i < words.length; i++) {
    const w = words[i], nx = words[i + 1];
    w.t1 = nx ? Math.min(Math.max(w.t1, nx.t0), w.t0 + 0.8) : Math.max(w.t1, w.t0 + 0.4);
    if (w.t1 <= w.t0) w.t1 = w.t0 + 0.08;
  }
  // yalnız noktalama olan "kelimeleri" bir öncekine ekle
  const out = [];
  for (const w of words) {
    if (/^[.,!?;:…"')\]]+$/.test(w.text) && out.length) { out[out.length - 1].text += w.text; out[out.length - 1].t1 = Math.max(out[out.length - 1].t1, w.t1); } else out.push(w);
  }
  return out;
}

// Sessiz aralıklar [başla, bitir] (sn): eşik kaydın en yüksek seviyesine göre ayarlanır
export function silences(wavFile) {
  const run = (args) => new Promise((res) => {
    const p = childProcess.spawn(ff.ffmpeg, ['-hide_banner', '-nostats', '-i', wavFile, ...args, '-f', 'null', '-'], { windowsHide: true });
    let e = '';
    p.stderr.on('data', (d) => { e += d; });
    p.on('close', () => res(e));
    p.on('error', () => res(''));
  });
  return run(['-af', 'volumedetect']).then((v) => {
    const m = /max_volume:\s*(-?[\d.]+)/.exec(v);
    const thr = Math.max(-60, Math.min(-25, (m ? +m[1] : 0) - 32));
    return run(['-af', `silencedetect=n=${thr}dB:d=0.25`]);
  }).then((out) => {
    const res = [];
    let st = null;
    for (const line of out.split(/\r?\n/)) {
      let m = /silence_start:\s*(-?[\d.]+)/.exec(line);
      if (m) st = Math.max(0, +m[1]);
      m = /silence_end:\s*([\d.]+)/.exec(line);
      if (m && st != null) { res.push([st, +m[1]]); st = null; }
    }
    if (st != null) res.push([st, Infinity]);
    return res;
  });
}

// Kelime sınırlarını gerçek konuşmaya oturt: sessizliğin içinde başlayan kelime sessizlik bitince başlar,
// sessizliğin içinde biten kelime sessizlik başlarken biter
export function snapToSpeech(words, sil) {
  const inSil = (t) => sil.find(([a, b]) => t > a && t < b);
  for (const w of words) {
    const s = inSil(w.t0);
    if (s && s[1] - w.t0 < 1.2) w.t0 = s[1];
    // DTW gecikmesi: hemen öncesinde sessizlik bitiyorsa başlangıcı ona çek
    const before = sil.find(([, b]) => b <= w.t0 && w.t0 - b < 0.35);
    if (before) w.t0 = before[1];
    const e = inSil(w.t1);
    if (e && e[0] > w.t0) w.t1 = e[0];
    if (w.t1 <= w.t0) w.t1 = w.t0 + 0.12;
  }
  return words;
}

// Kelimeleri altyazı satırlarına böl: satır uzunluğu, süre, duraklama ve cümle sonu
export function groupWords(words, { maxChars = 38, maxDur = 4, gap = 0.7 } = {}) {
  const textLen = (ws) => ws.reduce((a, x) => a + x.text.length, 0) + Math.max(0, ws.length - 1);
  // 1) cümle / duraklama parçaları
  const chunks = [];
  let cur = [];
  for (const w of words) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      if (/[.!?…]$/.test(prev.text) || w.t0 - prev.t1 > gap) { chunks.push(cur); cur = []; }
    }
    cur.push(w);
  }
  if (cur.length) chunks.push(cur);
  // 2) uzun parçayı eşit uzunlukta satırlara böl (tek kelime yetim kalmasın); virgülde bölmeyi tercih et
  const lines = [];
  const split = (ws) => {
    const len = textLen(ws), dur = ws[ws.length - 1].t1 - ws[0].t0;
    if (ws.length < 2 || (len <= maxChars && dur <= maxDur)) { lines.push(ws); return; }
    const k = Math.max(2, Math.ceil(len / maxChars), Math.ceil(dur / maxDur));
    const target = len / k;
    let best = 1, bestScore = Infinity, acc = 0;
    for (let i = 1; i < ws.length; i++) {
      acc += ws[i - 1].text.length + 1;
      const score = Math.abs(acc - target) - (/[,;:]$/.test(ws[i - 1].text) ? target * 0.35 : 0);
      if (score < bestScore) { bestScore = score; best = i; }
    }
    split(ws.slice(0, best));
    split(ws.slice(best));
  };
  for (const c of chunks) split(c);
  // 3) tek kelimelik çok kısa satırı (cümle sonu değilse) komşusuna ekle, sığıyorsa
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (L.length !== 1 || L[0].text.length > 6) continue;
    const nx = lines[i + 1];
    if (nx && !/[.!?…]$/.test(L[0].text) && textLen(L) + 1 + textLen(nx) <= maxChars * 1.15 && nx[0].t0 - L[0].t1 <= gap) { lines[i + 1] = [...L, ...nx]; lines.splice(i, 1); i--; }
  }
  return lines.map((ws) => ({ text: ws.map((w) => w.text).join(' '), t0: ws[0].t0, t1: ws[ws.length - 1].t1, words: ws }));
}
