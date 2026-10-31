// Proje kaydetme / açma / otomatik kaydetme
import { store } from './store.js';
import { app } from './appContext.js';
import { nodeFs, nodePath, ipc, ensureDir } from './util.js';
import { createProject, normalizeProject } from './model.js';
import { settings, addRecent } from './settings.js';
import { prepareAllMedia, clearRuntime } from './media.js';
import { t } from './i18n.js';
import { confirmDialog, alertDialog, toast } from './ui/dialogs.js';

export const PROJECT_EXT = 'ulip';
let autosaveDir = null;
let autosaveTimer = null;

export function initProjectIO(paths) {
  autosaveDir = ensureDir(nodePath.join(paths.userData, 'autosave'));
  scheduleAutosave();
}

export function getAutosaveDir() { return autosaveDir; }

function serialize() {
  const p = store.project;
  // oynatma kafası konumunu yaz
  if (store.seq && app.engine) store.seq.playhead = app.engine.currentFrame;
  return JSON.stringify(p);
}

function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  nodeFs.writeFileSync(tmp, data);
  // önceki sürümü yedekle
  try { if (nodeFs.existsSync(file)) nodeFs.copyFileSync(file, file + '.bak'); } catch (e) { /* */ }
  nodeFs.renameSync(tmp, file);
}

export async function saveProject(saveAs = false) {
  let file = store.projectPath;
  if (!file || saveAs) {
    const r = await ipc.invoke('dialog:save', {
      title: t('Save Project'),
      defaultPath: file || nodePath.join(app.paths.documents, (store.project.name || 'Untitled') + '.' + PROJECT_EXT),
      filters: [{ name: 'ULI Premiere Project', extensions: [PROJECT_EXT] }],
    });
    if (r.canceled || !r.filePath) return false;
    file = r.filePath;
  }
  try {
    store.project.name = nodePath.basename(file, '.' + PROJECT_EXT);
    writeAtomic(file, serialize());
    store.projectPath = file;
    store.markClean();
    addRecent(file);
    updateTitle();
    toast(t('Project saved'));
    return true;
  } catch (e) {
    alertDialog(t('Could not save project') + '\n' + e.message);
    return false;
  }
}

export async function saveCopy() {
  const r = await ipc.invoke('dialog:save', {
    title: t('Save a Copy'),
    defaultPath: nodePath.join(app.paths.documents, (store.project.name || 'Untitled') + ' copy.' + PROJECT_EXT),
    filters: [{ name: 'ULI Premiere Project', extensions: [PROJECT_EXT] }],
  });
  if (r.canceled || !r.filePath) return;
  nodeFs.writeFileSync(r.filePath, serialize());
  toast(t('Copy saved'));
}

export async function confirmDiscard() {
  if (!store.dirty) return true;
  const r = await confirmDialog(t('Save changes to the current project?'), { ok: t('Save'), cancel: t('Cancel'), extra: t("Don't Save") });
  if (r === true) return await saveProject();
  if (r === 'extra') return true;
  return false;
}

export function loadProjectFile(file) {
  const text = nodeFs.readFileSync(file, 'utf8');
  const p = JSON.parse(text);
  if (p.app !== 'ULIPremiere') throw new Error(t('Not a ULI Premiere project'));
  return normalizeProject(p);
}

export async function openProject(file = null) {
  if (!(await confirmDiscard())) return false;
  if (!file) {
    const r = await ipc.invoke('dialog:open', {
      title: t('Open Project'),
      properties: ['openFile'],
      filters: [{ name: 'ULI Premiere Project', extensions: [PROJECT_EXT] }],
    });
    if (r.canceled || !r.filePaths.length) return false;
    file = r.filePaths[0];
  }
  try {
    const p = loadProjectFile(file);
    app.engine?.disposeAll();
    clearRuntime();
    store.setProject(p, file);
    addRecent(file);
    prepareAllMedia();
    updateTitle();
    if (store.seq) app.engine.setFrame(store.seq.playhead || 0);
    return true;
  } catch (e) {
    alertDialog(t('Could not open project') + '\n' + e.message);
    return false;
  }
}

export async function newProject() {
  if (!(await confirmDiscard())) return false;
  app.engine?.disposeAll();
  clearRuntime();
  store.setProject(createProject(t('Untitled')), null);
  updateTitle();
  return true;
}

export function updateTitle() {
  const name = store.projectPath ? nodePath.basename(store.projectPath) : t('Untitled');
  ipc.invoke('win:title', (store.dirty ? '● ' : '') + name + ' — ULI Premiere');
}

// ---- Otomatik kaydetme ----
export function scheduleAutosave() {
  clearInterval(autosaveTimer);
  const mins = Math.max(1, settings.autosaveMinutes || 3);
  autosaveTimer = setInterval(() => autosave(), mins * 60 * 1000);
}

export function autosave() {
  if (!store.dirty || app.exporting) return;
  const p = store.project;
  if (!Object.keys(p.media).length && !Object.keys(p.sequences).length) return;
  try {
    const base = (store.projectPath ? nodePath.basename(store.projectPath, '.' + PROJECT_EXT) : 'Untitled').replace(/[^\w\-. ğüşıöçĞÜŞİÖÇ]/g, '_');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = nodePath.join(autosaveDir, `${base}-${stamp}.${PROJECT_EXT}`);
    const data = JSON.parse(serialize());
    data.autosaveOf = store.projectPath;
    nodeFs.writeFileSync(file, JSON.stringify(data));
    // eskileri temizle
    const files = nodeFs.readdirSync(autosaveDir).filter((f) => f.endsWith('.' + PROJECT_EXT)).map((f) => ({ f, t: nodeFs.statSync(nodePath.join(autosaveDir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const x of files.slice(settings.autosaveKeep || 20)) {
      try { nodeFs.unlinkSync(nodePath.join(autosaveDir, x.f)); } catch (e) { /* */ }
    }
    // açık projeyi de güncelle (kayıtlı ise), kullanıcı kaydetmediyse dosyayı ezmeyelim
    document.getElementById('status-text').textContent = t('Autosaved') + ' ' + new Date().toLocaleTimeString();
  } catch (e) {
    console.warn('autosave failed', e);
  }
}

export function listAutosaves() {
  try {
    return nodeFs.readdirSync(autosaveDir).filter((f) => f.endsWith('.' + PROJECT_EXT))
      .map((f) => ({ file: nodePath.join(autosaveDir, f), name: f, time: nodeFs.statSync(nodePath.join(autosaveDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
  } catch (e) {
    return [];
  }
}

// Otomatik kaydı aç: kaydedilmemiş proje gibi davran
export async function openAutosave(file) {
  if (!(await confirmDiscard())) return;
  try {
    const p = loadProjectFile(file);
    const orig = p.autosaveOf || null;
    delete p.autosaveOf;
    app.engine?.disposeAll();
    clearRuntime();
    store.setProject(p, orig);
    store.markDirty();
    prepareAllMedia();
    updateTitle();
  } catch (e) {
    alertDialog(t('Could not open project') + '\n' + e.message);
  }
}
