// ULI Premiere - uygulama girişi
import { store } from './store.js';
import { app } from './appContext.js';
import { t, setLang, getLang } from './i18n.js';
import { el, ipc, nodePath, rafThrottle, gainToDb, clamp } from './util.js';
import { loadSettings, settings, saveSettings } from './settings.js';
import { initFF, jobs, jobList, ff } from './ffmpeg.js';
import { Compositor } from './compositor.js';
import { PlaybackEngine } from './playback.js';
import { PanelGroup, initSplitters, restoreTabs, refreshTabTitles, panels, layoutEvents } from './ui/layout.js';
import { dropdownMenu, closeMenus, isMenuOpen, alertDialog, toast, modal, confirmDialog } from './ui/dialogs.js';
import { initCommands, initKeyboard, menuStructure, run } from './commands.js';
import * as IO from './projectIO.js';
import * as E from './editing.js';
import { mediaEvents, importFiles } from './media.js';
import { TimelinePanel } from './panels/timeline.js';
import { ProgramMonitor, SourceMonitor } from './panels/monitors.js';
import { ProjectPanel } from './panels/project.js';
import { EffectControlsPanel } from './panels/effectControls.js';
import { EffectsPanel, LumetriPanel, AudioMixerPanel, MarkersPanel, HistoryPanel } from './panels/misc.js';
import { openExportDialog, exportFrameDialog } from './exportDialog.js';
import { ScopesPanel } from './panels/scopes.js';
import { CaptionsPanel } from './panels/captionsPanel.js';
import { GraphicsPanel } from './panels/graphicsPanel.js';
import { EssentialSoundPanel } from './panels/essentialSound.js';

const TOOL_ICONS = {
  select: '<path d="M4 2l9 6-4 1 2.5 5-2 1L7 10l-3 3z"/>',
  trackSelect: '<path d="M2 3v10M5 8h9M11 5l3 3-3 3"/>',
  ripple: '<path d="M3 2v12M6 8h7M10 5l3 3-3 3M3 8"/><path d="M6 3h3M6 13h3"/>',
  roll: '<path d="M8 2v12M3 8h3M10 8h3M5 6L3 8l2 2M11 6l2 2-2 2"/>',
  rateStretch: '<path d="M2 8h12M4 6L2 8l2 2M12 6l2 2-2 2M7 4v8M9 4v8"/>',
  razor: '<path d="M3 13l7-7M10 6l3-3 1 1-3 3zM4 9l3 3"/><circle cx="4" cy="12" r="1.3"/>',
  slip: '<path d="M2 4v8M14 4v8M5 8h6M7 6L5 8l2 2M9 6l2 2-2 2"/>',
  slide: '<path d="M5 4v8M11 4v8M2 8h3M11 8h3M3 6L1.5 8 3 10M13 6l1.5 2-1.5 2"/>',
  pen: '<path d="M3 13l2-6 6-5 3 3-5 6zM5 7l4 4"/><circle cx="7.5" cy="8.5" r="1"/>',
  hand: '<path d="M5 9V4a1 1 0 012 0v4M7 7V3a1 1 0 012 0v4M9 7V4a1 1 0 012 0v5M11 8V6a1 1 0 012 0v4a5 5 0 01-5 5H7a4 4 0 01-3-1.5L2 11a1 1 0 011.5-1.3L5 11"/>',
  zoom: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14M5 7h4M7 5v4"/>',
  type: '<path d="M3 3h10M8 3v10M6 13h4"/>',
};
const TOOLS = [
  ['select', 'Selection Tool', 'V'], ['trackSelect', 'Track Select Forward Tool', 'A'], ['ripple', 'Ripple Edit Tool', 'B'], ['roll', 'Rolling Edit Tool', 'N'],
  ['rateStretch', 'Rate Stretch Tool', 'R'], ['razor', 'Razor Tool', 'C'], ['slip', 'Slip Tool', 'Y'], ['slide', 'Slide Tool', 'U'],
  ['pen', 'Pen Tool', 'P'], ['hand', 'Hand Tool', 'H'], ['zoom', 'Zoom Tool', 'Z'], ['type', 'Type Tool', 'T'],
];

function buildMenubar() {
  const bar = document.getElementById('menubar');
  bar.innerHTML = '';
  bar.appendChild(el('div', { class: 'brand', title: 'ULI Premiere' }, el('img', { src: 'img/logo.svg', alt: 'ULI' })));
  const menus = menuStructure();
  for (const m of menus) {
    const top = el('div', { class: 'menu-top', text: m.label });
    top.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (top.classList.contains('open')) { closeMenus(); return; }
      dropdownMenu(top, m.items());
    });
    top.addEventListener('mouseenter', () => {
      if (isMenuOpen() && !top.classList.contains('open') && document.querySelector('.menu-top.open')) dropdownMenu(top, m.items());
    });
    bar.appendChild(top);
  }
  bar.appendChild(el('div', { class: 'spacer' }));
  const lang = el('div', { class: 'menu-top', text: getLang() === 'tr' ? 'TR' : 'EN', title: t('Switch Language (TR/EN)') });
  lang.addEventListener('click', () => run('window.toggleLang'));
  bar.appendChild(el('div', { class: 'workspace-name', text: t('Editing') }));
  bar.appendChild(lang);
}

function buildTools() {
  const strip = document.getElementById('tools-strip');
  strip.innerHTML = '';
  for (const [id, name, key] of TOOLS) {
    const b = el('div', { class: 'tool-btn' + (store.ui.tool === id ? ' active' : ''), title: `${t(name)} (${key})`, html: `<svg viewBox="0 0 16 16">${TOOL_ICONS[id]}</svg>` });
    b.addEventListener('click', () => store.setTool(id));
    strip.appendChild(b);
  }
}

// Ana ses ölçeri
function initMasterMeter(engine) {
  const cv = document.getElementById('master-meter');
  const scale = document.querySelector('.meter-scale');
  scale.innerHTML = '';
  for (const db of [0, -6, -12, -18, -24, -30, -36, -42, -48, -54]) {
    scale.appendChild(el('div', { text: String(db), style: { position: 'absolute', top: ((-db) / 60) * 100 + '%', transform: 'translateY(-50%)', right: '0' } }));
  }
  let holdL = 0, holdR = 0, hold = 0;
  let lastL = 0, lastR = 0;
  const draw = (m) => {
    const h = cv.clientHeight, w = cv.clientWidth;
    if (cv.height !== h) { cv.height = h; cv.width = w; }
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);
    const norm = (v) => clamp((gainToDb(v) + 60) / 60, 0, 1);
    lastL = Math.max(norm(m.l), lastL - 0.03);
    lastR = Math.max(norm(m.r), lastR - 0.03);
    if (norm(m.l) >= holdL || hold-- <= 0) { holdL = norm(m.l); hold = 40; }
    holdR = Math.max(norm(m.r), holdR - 0.004);
    const g = ctx.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, '#2fae55'); g.addColorStop(0.8, '#d4c03a'); g.addColorStop(1, '#e0453d');
    ctx.fillStyle = g;
    const bw = (w - 3) / 2;
    ctx.fillRect(0, h - lastL * h, bw, lastL * h);
    ctx.fillRect(bw + 3, h - lastR * h, bw, lastR * h);
    ctx.fillStyle = '#ddd';
    ctx.fillRect(0, h - holdL * h, bw, 1);
    ctx.fillRect(bw + 3, h - holdR * h, bw, 1);
  };
  engine.on('meters', draw);
  draw({ l: 0, r: 0 });
}

function updateJobs() {
  const list = jobList();
  const elJ = document.getElementById('status-jobs');
  if (!list.length) { elJ.textContent = ''; return; }
  const first = list[0];
  elJ.textContent = `${t('Background')}: ${first.name}${first.progress ? ' ' + Math.round(first.progress * 100) + '%' : ''}${list.length > 1 ? ' (+' + (list.length - 1) + ')' : ''}`;
}

async function showWelcome() {
  const recent = settings.recent.filter(Boolean);
  const autos = IO.listAutosaves().slice(0, 5);
  return new Promise((resolve) => {
    const wrap = el('div', { class: 'welcome' });
    const close = () => { wrap.remove(); resolve(); };
    const mk = (label, fn, primary) => { const b = el('button', { class: primary ? 'primary' : '', text: label }); b.addEventListener('click', async () => { close(); await fn(); }); return b; };
    const left = el('div', { class: 'welcome-left' },
      el('div', { class: 'welcome-logo' }, el('img', { src: 'img/logo.svg', alt: '' }), el('h1', { text: 'ULI Premiere' })),
      mk(t('New Project'), async () => { await IO.newProject(); }, true),
      mk(t('Open Project...'), () => IO.openProject()),
      mk(t('Import Media...'), () => run('file.import')),
      el('div', { style: { flex: 1 } }),
      el('div', { style: { color: '#9ab', fontSize: '11px' }, text: 'v' + app.paths.appVersion + (ff.nvenc ? ' · NVENC' : '') }),
    );
    const right = el('div', { class: 'welcome-right' }, el('h3', { text: t('Recent') }));
    if (!recent.length) right.appendChild(el('div', { class: 'muted', text: t('No recent projects') }));
    for (const f of recent.slice(0, 8)) {
      const it = el('div', { class: 'recent-item' }, el('div', { text: nodePath.basename(f) }), el('div', { class: 'rp', text: f }));
      it.addEventListener('click', async () => { close(); await IO.openProject(f); });
      right.appendChild(it);
    }
    if (autos.length) {
      right.appendChild(el('h3', { text: t('Auto-Saves'), style: { marginTop: '18px' } }));
      for (const a of autos) {
        const it = el('div', { class: 'recent-item' }, el('div', { text: a.name }), el('div', { class: 'rp', text: new Date(a.time).toLocaleString() }));
        it.addEventListener('click', async () => { close(); await IO.openAutosave(a.file); });
        right.appendChild(it);
      }
    }
    wrap.appendChild(el('div', { class: 'welcome-box' }, left, right));
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    document.body.appendChild(wrap);
  });
}

async function showAutosaves() {
  const list = IO.listAutosaves();
  if (!list.length) { alertDialog(t('No auto-saves found.')); return; }
  const box = el('div', { style: { maxHeight: '60vh', overflow: 'auto', minWidth: '480px' } });
  let resolveFn;
  for (const a of list) {
    const it = el('div', { class: 'recent-item' }, el('div', { text: a.name }), el('div', { class: 'rp', text: new Date(a.time).toLocaleString() }));
    it.addEventListener('click', () => { resolveFn(a.file); });
    box.appendChild(it);
  }
  const file = await modal({ title: t('Open Auto-Save...'), body: box, onOpen: (close) => { resolveFn = close; }, buttons: [{ label: t('Cancel'), value: null }] });
  if (file) IO.openAutosave(file);
}

async function requestClose() {
  if (app.exporting) {
    const ok = await confirmDialog(t('An export is in progress. Quit anyway?'));
    if (!ok) return;
  }
  if (await IO.confirmDiscard()) {
    ipc.invoke('app:confirm-close');
  }
}

function toggleMaximize() {
  const g = document.querySelector('.panel-group.focused');
  if (!g) return;
  if (g.dataset.max) {
    delete g.dataset.max;
    g.style.position = ''; g.style.inset = ''; g.style.zIndex = '';
  } else {
    g.dataset.max = '1';
    g.style.position = 'absolute'; g.style.inset = '3px'; g.style.zIndex = '60';
  }
  layoutEvents.emit('resize');
  for (const p of panels.values()) if (p.onResize) p.onResize();
}

function relocalize() {
  document.documentElement.lang = getLang();
  buildMenubar();
  buildTools();
  refreshTabTitles();
  for (const p of panels.values()) {
    if (p.render) p.render();
    if (p.refresh) p.refresh();
  }
  app.timeline?.refresh();
  app.program?.updateTime();
}

async function boot() {
  const paths = await ipc.invoke('app:paths');
  app.paths = paths;
  loadSettings(paths.userData);
  setLang(getLang());
  store.settings = settings;
  store.ui.useProxies = settings.useProxies !== false;
  store.ui.playbackRes = settings.playbackRes || 'auto';
  app.editing = E;
  app.settings = settings;
  if (!paths.ffmpeg || !paths.ffprobe) {
    alertDialog(t('FFmpeg could not be found. Please reinstall the application (npm install).'));
  }
  await initFF(paths);
  app.ffInfo = { nvenc: ff.nvenc };
  IO.initProjectIO(paths);
  initCommands();
  buildMenubar();
  buildTools();
  store.on('tool', buildTools);

  // Panel grupları
  const gLT = new PanelGroup(document.getElementById('group-left-top'), 'leftTop');
  const gRT = new PanelGroup(document.getElementById('group-right-top'), 'rightTop');
  const gLB = new PanelGroup(document.getElementById('group-left-bottom'), 'leftBottom');
  const gTL = new PanelGroup(document.getElementById('group-timeline'), 'timeline');

  const program = new ProgramMonitor();
  gRT.add(program);
  let comp;
  try {
    comp = new Compositor(program.canvas, { onError: (e) => console.error(e) });
  } catch (e) {
    alertDialog(t('WebGL2 is not available. GPU acceleration is required.') + '\n' + e.message);
    throw e;
  }
  app.compositor = comp;
  const engine = new PlaybackEngine(comp);
  app.engine = engine;
  program.initEngine(engine);

  gLT.add(new SourceMonitor());
  gLT.add(new EffectControlsPanel());
  gLT.add(new LumetriPanel());
  gLT.add(new ScopesPanel());
  gLT.add(new GraphicsPanel());
  gLT.add(new AudioMixerPanel());
  gLT.add(new EssentialSoundPanel());
  gLB.add(new ProjectPanel());
  gLB.add(new EffectsPanel());
  gLB.add(new MarkersPanel());
  gLB.add(new HistoryPanel());
  gLB.add(new CaptionsPanel());
  gTL.add(new TimelinePanel());
  initSplitters();
  restoreTabs();
  initKeyboard();
  initMasterMeter(engine);
  layoutEvents.on('resize', () => { for (const p of panels.values()) if (p.onResize && p.group?.active === p) p.onResize(); });
  window.addEventListener('resize', () => { for (const p of panels.values()) if (p.onResize) p.onResize(); });

  app.openExport = openExportDialog;
  app.exportFrame = exportFrameDialog;
  app.showAutosaves = showAutosaves;
  app.requestClose = requestClose;
  app.toggleMaximize = toggleMaximize;
  app.relocalize = relocalize;

  store.on('dirty', () => IO.updateTitle());
  store.on('project', () => { IO.updateTitle(); refreshTabTitles(); engine.requestRender(); });
  jobs.on('change', rafThrottle(updateJobs));
  mediaEvents.on('error', (msg) => alertDialog(msg, t('Import')));
  ipc.on('app:request-close', () => requestClose());
  ipc.on('app:open-file', (e, file) => IO.openProject(file));

  // pencereye bırakılan dosyalar
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!e.dataTransfer.files.length) return;
    const { webUtils } = window.require('electron');
    const pathsIn = [...e.dataTransfer.files].map((f) => (webUtils ? webUtils.getPathForFile(f) : f.path)).filter(Boolean);
    const proj = pathsIn.find((p) => p.toLowerCase().endsWith('.' + IO.PROJECT_EXT));
    if (proj) { IO.openProject(proj); return; }
    const r = await importFiles(pathsIn);
    if (r.length) toast(t('{n} item(s) imported', { n: r.length }));
  });
  window.addEventListener('error', (e) => { console.error(e.error || e.message); });
  window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); });
  // durum çubuğu
  const st = document.getElementById('status-text');
  store.on('change', rafThrottle((info) => {
    if (info && info.label && !info.live && !String(info.label).startsWith('undo:') && !String(info.label).startsWith('redo:')) st.textContent = t(info.label);
  }));
  store.on('tool', (tool) => { const tt = TOOLS.find((x) => x[0] === tool); if (tt) st.textContent = t(tt[1]); });

  IO.updateTitle();
  engine.requestRender();
  // hata ayıklama / otomatik test erişimi
  window.__uli = { store, app, run, E, IO, importFiles, settings, ...(await import('./media.js')), ...(await import('./exporter.js')), ...(await import('./model.js')) };
  // komut satırından proje
  const argProj = (paths.argv || []).find((a) => a.toLowerCase().endsWith('.' + IO.PROJECT_EXT));
  if (argProj) await IO.openProject(argProj);
  else await showWelcome();
}

boot().catch((e) => {
  console.error(e);
  document.body.appendChild(el('div', { style: { position: 'fixed', left: '20px', top: '40px', color: '#f66', whiteSpace: 'pre-wrap', zIndex: 9999 }, text: 'Startup error: ' + (e.stack || e.message) }));
});
