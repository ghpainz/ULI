// Kalıcı kullanıcı tercihleri (userData/settings.json)
import { nodeFs, nodePath } from './util.js';

const DEFAULTS = {
  autosaveMinutes: 3,
  autosaveKeep: 20,
  stillDuration: 5,
  videoTransitionFrames: 30,
  audioTransitionFrames: 30,
  defaultVideoTransition: 'crossDissolve',
  defaultAudioTransition: 'constantPower',
  scaleToFrame: true,
  autoProxyHeavy: false,
  proxyHeight: 720,
  defaultPreset: '1080p30',
  playbackRes: 'auto',
  useProxies: true,
  recent: [],
  lastImportDir: null,
  lastExportDir: null,
  layout: {},
  showWaveforms: true,
  timelineThumbs: true,
  previewWhileScrub: true,
};

let file = null;
export const settings = { ...DEFAULTS };

export function loadSettings(userData) {
  file = nodePath.join(userData, 'settings.json');
  try {
    const j = JSON.parse(nodeFs.readFileSync(file, 'utf8'));
    Object.assign(settings, DEFAULTS, j);
  } catch (e) { /* ilk açılış */ }
  return settings;
}

let saveTimer = null;
export function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { nodeFs.writeFileSync(file, JSON.stringify(settings, null, 2)); } catch (e) { console.warn(e); }
  }, 300);
}

export function addRecent(p) {
  settings.recent = [p, ...settings.recent.filter((x) => x !== p)].slice(0, 12);
  saveSettings();
}
