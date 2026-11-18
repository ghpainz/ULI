// Otomatik güncelleme: sürüm karşılaştırma, GitHub sürüm bilgisi, indirme + doğrulama, kurulumu başlatma (ağ kullanılmaz)
const Up = await import('./js/updater.js');
const crypto = window.require('crypto');
const http = window.require('http');
check('version comparison', Up.compareVersions('v0.10.0', '0.9.9') > 0 && Up.compareVersions('0.4.0', 'v0.4.0') === 0 && Up.compareVersions('0.3.9', '0.4.0') < 0);
// sahte kurulum dosyası ve yerel sunucu
const payload = crypto.randomBytes(300000);
const sha = crypto.createHash('sha256').update(payload).digest('hex');
const srv = http.createServer((req, res) => {
  if (req.url === '/redirect') { res.writeHead(302, { Location: '/file' }); return res.end(); }
  res.writeHead(200, { 'Content-Length': payload.length }); res.end(payload);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;
const release = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, body: '## ULI ' + tag + '\n- **New:** things', html_url: 'https://github.com/ghpainz/ULI/releases/tag/' + tag,
  assets: [{ name: 'ULI.Setup.' + tag.slice(1) + '.exe', size: payload.length, browser_download_url: base + '/redirect', digest: 'sha256:' + sha }], ...extra });
const cur = U.app.paths.appVersion;
check('newer release is offered', Up.pickUpdate(release('v99.0.0'), cur)?.version === '99.0.0');
check('same or older release is not offered', !Up.pickUpdate(release('v' + cur), cur) && !Up.pickUpdate(release('v0.0.1'), cur));
check('prerelease / missing installer is not offered', !Up.pickUpdate(release('v99.0.0', { prerelease: true }), cur) && !Up.pickUpdate(release('v99.0.0', { assets: [] }), cur));
const info = await Up.checkForUpdate({ fetchImpl: async () => ({ ok: true, json: async () => release('v99.0.0') }) });
check('checkForUpdate reads GitHub data', info && info.asset.sha256 === sha && info.asset.size === payload.length, info && info.version);
const file = await Up.downloadUpdate(info);
check('download follows redirect and verifies SHA-256', fs.readFileSync(file).equals(payload), file);
let bad = null;
try { await Up.downloadUpdate({ ...info, asset: { ...info.asset, sha256: '0'.repeat(64) } }); } catch (e) { bad = e.message; }
check('damaged download is rejected', !!bad, bad);
let insecure = null;
try { await Up.downloadUpdate({ ...info, asset: { ...info.asset, url: 'http://example.com/x.exe' } }); } catch (e) { insecure = e.message; }
check('non-https download is refused', insecure === 'insecure URL', insecure);
// pencere: "İndir ve Kur" → indirme → kurulumu başlatma isteği (gerçekte çalıştırılmaz)
let ran = null;
const realInvoke = ipc.invoke.bind(ipc);
ipc.invoke = (ch, ...a) => (ch === 'app:run-installer' ? (ran = a[0], Promise.resolve(true)) : realInvoke(ch, ...a));
await U.IO.newProject();
const pr = Up.updateDialog(info);
for (let i = 0; i < 40 && !document.querySelector('.modal'); i++) await sleep(50);
check('dialog shows version and notes', /99\.0\.0/.test(document.querySelector('.modal').innerText) && /New: things/.test(document.querySelector('.modal').innerText));
document.querySelector('.modal .modal-buttons .primary').click();
await pr;
ipc.invoke = realInvoke;
check('after download the installer is started', ran && fs.existsSync(ran) && /uli-update/.test(ran), ran);
srv.close();
