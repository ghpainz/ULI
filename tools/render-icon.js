// src/img/logo.svg dosyasından uygulama simgelerini üretir: build/icon.png (1024) ve build/icon.ico (16-256)
// Kullanım: npx electron tools/render-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SVG = fs.readFileSync(path.join(ROOT, 'src', 'img', 'logo.svg'), 'utf8');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

// PNG girişli ICO dosyası (Windows Vista+ destekler)
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const sizes = [1024, 512, ...ICO_SIZES];
  const svg64 = Buffer.from(SVG).toString('base64');
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,${svg64}';
      await img.decode();
      await document.fonts.ready;
      const out = {};
      for (const s of ${JSON.stringify(sizes)}) {
        const c = document.createElement('canvas');
        c.width = s; c.height = s;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, s, s);
        out[s] = c.toDataURL('image/png').split(',')[1];
      }
      return out;
    })()
  `);
  const png = (s) => Buffer.from(result[s], 'base64');
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), png(1024));
  fs.writeFileSync(path.join(ROOT, 'src', 'img', 'logo-256.png'), png(256));
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), buildIco(ICO_SIZES.map((s) => ({ size: s, data: png(s) }))));
  console.log('icons written: build/icon.png, build/icon.ico, src/img/logo-256.png');
  app.quit();
});
