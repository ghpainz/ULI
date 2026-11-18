// Otomatik güncelleme: GitHub'daki son sürümü denetler; kullanıcı onaylarsa kurulum dosyasını indirir,
// boyut ve SHA-256 ile doğrular, kurulumu başlatıp uygulamayı kapatır. Kurulum eski sürümün üzerine yapılır.
import { app } from './appContext.js';
import { t } from './i18n.js';
import { el, nodePath, nodeFs, ipc } from './util.js';
import { settings, saveSettings } from './settings.js';
import { modal, toast } from './ui/dialogs.js';

export const REPO = 'ghpainz/ULI';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

// "v0.10.2" > "0.9.9"
export function compareVersions(a, b) {
  const p = (v) => String(v || '').replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const A = p(a), B = p(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const d = (A[i] || 0) - (B[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

// GitHub sürüm bilgisinden güncelleme: { version, notes, url, asset: { name, size, url, sha256 } } ya da null
export function pickUpdate(release, current) {
  if (!release || release.draft || release.prerelease || !release.tag_name) return null;
  if (compareVersions(release.tag_name, current) <= 0) return null;
  const asset = (release.assets || []).find((a) => /\.exe$/i.test(a.name) && /setup/i.test(a.name));
  if (!asset) return null;
  const sha = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '');
  return {
    version: release.tag_name.replace(/^v/i, ''),
    notes: String(release.body || '').slice(0, 4000),
    url: release.html_url,
    asset: { name: asset.name, size: asset.size, url: asset.browser_download_url, sha256: sha ? sha[1].toLowerCase() : null },
  };
}

// Sayfanın güvenlik politikası (CSP) dış bağlantıya izin vermez; GitHub'a Node'un https modülüyle bağlanılır
function nodeFetch(url, opts = {}) {
  const https = window.require('https');
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'ULI-updater', ...(opts.headers || {}) } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; if (body.length > 2e6) req.destroy(); });
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => JSON.parse(body) }));
      res.on('error', reject);
    });
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

export async function checkForUpdate({ fetchImpl = nodeFetch } = {}) {
  const r = await fetchImpl(API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return pickUpdate(await r.json(), app.paths.appVersion);
}

// İndir (yönlendirmeleri izler), boyut ve SHA-256 doğrula
export function downloadUpdate(info, { onProgress, signal } = {}) {
  const https = window.require('https');
  const crypto = window.require('crypto');
  const dir = nodePath.join(window.require('os').tmpdir(), 'uli-update');
  nodeFs.mkdirSync(dir, { recursive: true });
  const dest = nodePath.join(dir, info.asset.name.replace(/[^\w.-]/g, '_'));
  const part = dest + '.part';
  return new Promise((resolve, reject) => {
    let req = null, out = null, done = false;
    const fail = (e) => {
      if (done) return; done = true;
      try { req && req.destroy(); } catch (er) { /* */ }
      try { out && out.destroy(); } catch (er) { /* */ }
      try { nodeFs.unlinkSync(part); } catch (er) { /* */ }
      reject(e);
    };
    if (signal) signal.addEventListener('abort', () => fail(Object.assign(new Error('cancelled'), { cancelled: true })), { once: true });
    // yalnız https (testlerde yerel 127.0.0.1 sunucusuna http izinli)
    const modFor = (url) => (/^http:\/\/127\.0\.0\.1[:/]/.test(url) ? window.require('http') : https);
    const get = (url, hops) => {
      if (!/^https:\/\//.test(url) && !/^http:\/\/127\.0\.0\.1[:/]/.test(url)) return fail(new Error('insecure URL'));
      req = modFor(url).get(url, { headers: { 'User-Agent': 'ULI-updater', Accept: 'application/octet-stream' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 6) { res.resume(); return get(new URL(res.headers.location, url).toString(), hops + 1); }
        if (res.statusCode !== 200) { res.resume(); return fail(new Error('HTTP ' + res.statusCode)); }
        const hash = crypto.createHash('sha256');
        let got = 0;
        out = nodeFs.createWriteStream(part);
        res.on('data', (d) => { hash.update(d); got += d.length; onProgress && onProgress(got / info.asset.size); });
        res.on('error', fail);
        out.on('error', fail);
        res.pipe(out);
        out.on('finish', () => {
          if (done) return;
          const h = hash.digest('hex');
          if (got !== info.asset.size || (info.asset.sha256 && h !== info.asset.sha256)) return fail(new Error(t('Downloaded file is damaged, please try again')));
          done = true;
          out.close(() => { try { nodeFs.renameSync(part, dest); resolve(dest); } catch (e) { reject(e); } });
        });
      });
      req.on('error', fail);
    };
    get(info.asset.url, 0);
  });
}

// Sürüm notlarındaki basit Markdown'ı düz yazıya çevir
const plain = (md) => md.replace(/\r/g, '').replace(/^#+\s*/gm, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1').trim();

export async function updateDialog(info) {
  const notes = el('div', { text: plain(info.notes) || t('No release notes.'), style: { whiteSpace: 'pre-wrap', maxHeight: '260px', overflow: 'auto', background: 'var(--bg-2, #1b1b1b)', padding: '8px', borderRadius: '4px', fontSize: '12px' } });
  const body = el('div', {},
    el('div', { text: t('ULI {v} is available (you have {c}).', { v: info.version, c: app.paths.appVersion }), style: { marginBottom: '8px' } }),
    notes,
    el('div', { text: t('Download size: {n} MB. Your projects and settings are kept.', { n: Math.round(info.asset.size / 1e6) }), style: { color: 'var(--text-dim)', fontSize: '11px', marginTop: '8px' } }));
  const r = await modal({ title: t('Update Available'), body, width: 560, buttons: [
    { label: t('Skip This Version'), value: 'skip' },
    { label: t('Later'), value: null },
    { label: t('Download and Install'), primary: true, value: 'install' },
  ] });
  if (r === 'skip') { settings.skipVersion = info.version; saveSettings(); return null; }
  if (r !== 'install') return null;
  const ctrl = new AbortController();
  const bar = el('div', { class: 'progress' }, el('div'));
  const info2 = el('div', { class: 'muted', style: { marginTop: '6px' }, text: t('Downloading update...') });
  let closeFn = null;
  modal({ title: t('Update Available'), body: el('div', { style: { width: '380px' } }, bar, info2), escape: false, onOpen: (c) => { closeFn = c; }, buttons: [{ label: t('Cancel'), onClick: () => { ctrl.abort(); return false; } }] });
  let file;
  try {
    file = await downloadUpdate(info, { signal: ctrl.signal, onProgress: (p) => { bar.firstChild.style.width = Math.round(p * 100) + '%'; info2.textContent = t('Downloading update...') + ' ' + Math.round(p * 100) + '%'; } });
  } catch (e) {
    if (!e.cancelled) toast(t('Update download failed') + ': ' + e.message, 'error', 8000);
    return null;
  } finally { if (closeFn) closeFn(); }
  // kaydedilmemiş değişiklikler sorulur; sonra kurulum başlar ve ULI kapanır
  const IO = await import('./projectIO.js');
  if (!(await IO.confirmDiscard())) { toast(t('The update is downloaded; it will be offered again next time.')); return null; }
  await ipc.invoke('app:run-installer', file);
  return file;
}

// Her açılışta sessizce denetle (yeni sürüm yoksa hiçbir şey göstermez); elle denetlemede sonucu her zaman söyle
export async function checkForUpdatesCommand({ manual = false } = {}) {
  if (!manual) {
    if (settings.autoUpdateCheck === false || app.paths.testMode) return null;
  }
  let info = null;
  try {
    info = await checkForUpdate();
    settings.lastUpdateCheck = Date.now(); saveSettings();
  } catch (e) {
    if (manual) toast(t('Could not check for updates') + ': ' + e.message, 'warn', 6000);
    return null;
  }
  if (!info) { if (manual) toast(t('ULI is up to date ({v})', { v: app.paths.appVersion }), 'success'); return null; }
  if (!manual && settings.skipVersion === info.version) return null;
  return updateDialog(info);
}
