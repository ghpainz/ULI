// ULI Premiere - Electron ana süreç
const { app, BrowserWindow, protocol, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'uli',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true },
  },
]);

const SRC_DIR = path.join(__dirname, 'src');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function mimeFor(p) {
  return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

function fileResponse(filePath, request) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (e) {
    return new Response('Not found', { status: 404 });
  }
  const size = stat.size;
  const type = mimeFor(filePath);
  const range = request.headers.get('range');
  const baseHeaders = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = 0;
    let end = size - 1;
    if (m) {
      if (m[1] === '' && m[2] !== '') {
        start = Math.max(0, size - parseInt(m[2], 10));
      } else {
        if (m[1] !== '') start = parseInt(m[1], 10);
        if (m[2] !== '') end = Math.min(parseInt(m[2], 10), size - 1);
      }
    }
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` } });
    }
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: { ...baseHeaders, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  const stream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(stream), { status: 200, headers: { ...baseHeaders, 'Content-Length': String(size) } });
}

function registerProtocol() {
  protocol.handle('uli', (request) => {
    const url = new URL(request.url);
    if (url.host === 'media') {
      const p = decodeURIComponent(url.pathname.slice(1));
      return fileResponse(p, request);
    }
    if (url.host === 'app') {
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';
      const p = path.normalize(path.join(SRC_DIR, rel));
      if (!p.startsWith(SRC_DIR)) return new Response('Forbidden', { status: 403 });
      return fileResponse(p, request);
    }
    return new Response('Not found', { status: 404 });
  });
}

function binPath(mod) {
  // asar paketinde binary yolunu düzelt
  return mod.replace('app.asar', 'app.asar.unpacked');
}

let mainWindow = null;
let forceClose = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#1a1a1a',
    title: 'ULI Premiere',
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  mainWindow.loadURL('uli://app/index.html');
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on('close', (e) => {
    if (forceClose) return;
    e.preventDefault();
    mainWindow.webContents.send('app:request-close');
  });
  if (process.env.ULI_DEBUG) {
    mainWindow.webContents.on('console-message', (e) => {
      const lvl = e.level;
      if (lvl === 'warning' || lvl === 'error' || process.env.ULI_DEBUG === '2') console.log(`[renderer:${lvl}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
    });
  }
  // Uygulama dışı sayfaya gitmeyi engelle
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('uli://app/')) e.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('app:paths', () => {
  let ffmpeg = null;
  let ffprobe = null;
  try { ffmpeg = binPath(require('ffmpeg-static')); } catch (e) { /* yok */ }
  try { ffprobe = binPath(require('ffprobe-static').path); } catch (e) { /* yok */ }
  const userData = app.getPath('userData');
  return {
    ffmpeg,
    ffprobe,
    userData,
    documents: app.getPath('documents'),
    videos: app.getPath('videos'),
    temp: app.getPath('temp'),
    appVersion: app.getVersion(),
    argv: process.argv,
  };
});

ipcMain.handle('dialog:open', (e, opts) => dialog.showOpenDialog(mainWindow, opts));
ipcMain.handle('dialog:save', (e, opts) => dialog.showSaveDialog(mainWindow, opts));
ipcMain.handle('dialog:message', (e, opts) => dialog.showMessageBox(mainWindow, opts));
ipcMain.handle('shell:reveal', (e, p) => shell.showItemInFolder(p));
ipcMain.handle('shell:open', (e, p) => shell.openPath(p));
ipcMain.handle('win:title', (e, title) => { if (mainWindow) mainWindow.setTitle(title); });
ipcMain.handle('win:devtools', () => { if (mainWindow) mainWindow.webContents.toggleDevTools(); });
ipcMain.handle('win:fullscreen', () => { if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen()); });
ipcMain.handle('win:reload', () => { if (mainWindow) mainWindow.webContents.reloadIgnoringCache(); });
// Otomatik test desteği (ULI_TEST=<renderer betiği yolu>)
ipcMain.handle('test:shot', async (e, file) => {
  const img = await mainWindow.webContents.capturePage();
  fs.writeFileSync(file, img.toPNG());
  return file;
});
function runTestScript() {
  const file = process.env.ULI_TEST;
  if (!file) return;
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const code = fs.readFileSync(file, 'utf8');
        const res = await mainWindow.webContents.executeJavaScript(code, true);
        console.log('[TEST RESULT]', JSON.stringify(res));
      } catch (err) {
        console.log('[TEST ERROR]', err && (err.stack || err.message || err));
      }
      if (!process.env.ULI_TEST_KEEP) { forceClose = true; app.quit(); }
    }, 2500);
  });
}

ipcMain.handle('app:confirm-close', () => {
  forceClose = true;
  if (mainWindow) mainWindow.close();
});

// Tek örnek: ikinci kez açılırsa (ör. .ulip dosyasına çift tık) mevcut pencereye ilet
const gotLock = process.env.ULI_TEST ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const file = argv.find((a) => a.toLowerCase().endsWith('.ulip'));
    if (file) mainWindow.webContents.send('app:open-file', file);
  });
}

app.whenReady().then(() => {
  registerProtocol();
  createWindow();
  runTestScript();
});

app.on('window-all-closed', () => app.quit());
