// Panel grupları (sekmeli) ve yeniden boyutlandırma ayırıcıları
import { el, Emitter } from '../util.js';
import { settings, saveSettings } from '../settings.js';
import { store } from '../store.js';

export const layoutEvents = new Emitter();
export const panels = new Map();
const groups = new Map();

export class PanelGroup {
  constructor(container, name) {
    this.container = container;
    this.name = name;
    this.panels = [];
    this.active = null;
    this.tabs = el('div', { class: 'tabs' });
    container.appendChild(this.tabs);
    container.addEventListener('mousedown', () => this.focus(), true);
    // başka gruptan sürüklenen paneli bu gruba al (sekme çubuğuna ya da panelin üstüne bırak)
    const isPanelDrag = (e) => e.dataTransfer.types.includes('application/x-uli-panel');
    container.addEventListener('dragover', (e) => { if (isPanelDrag(e)) { e.preventDefault(); container.classList.add('dock-target'); } });
    container.addEventListener('dragleave', (e) => { if (!container.contains(e.relatedTarget)) container.classList.remove('dock-target'); });
    container.addEventListener('drop', (e) => {
      container.classList.remove('dock-target');
      if (!isPanelDrag(e)) return;
      e.preventDefault();
      movePanel(e.dataTransfer.getData('application/x-uli-panel'), this.name);
    });
    groups.set(name, this);
  }
  add(panel) {
    panel.group = this;
    panel.homeGroup = this.name;
    panel.body = el('div', { class: 'panel-body', 'data-panel': panel.id });
    this.container.appendChild(panel.body);
    this.panels.push(panel);
    panels.set(panel.id, panel);
    panel.mount(panel.body);
    const ro = new ResizeObserver(() => { if (panel.onResize && this.active === panel) panel.onResize(); });
    ro.observe(panel.body);
    this.renderTabs();
    if (!this.active) this.activate(panel.id);
  }
  renderTabs() {
    this.tabs.innerHTML = '';
    for (const p of this.panels) {
      const tab = el('div', { class: 'tab' + (this.active === p ? ' active' : ''), text: p.title(), draggable: 'true' });
      tab.addEventListener('mousedown', () => this.activate(p.id));
      tab.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-uli-panel', p.id); e.dataTransfer.effectAllowed = 'move'; });
      this.tabs.appendChild(tab);
    }
  }
  activate(id) {
    const p = this.panels.find((x) => x.id === id);
    if (!p) return;
    if (this.active) this.active.body.classList.remove('active');
    this.active = p;
    p.body.classList.add('active');
    this.renderTabs();
    if (p.onShow) p.onShow();
    if (p.onResize) requestAnimationFrame(() => p.onResize());
    settings.layout['tab_' + this.name] = id;
    saveSettings();
  }
  focus() {
    document.querySelectorAll('.panel-group.focused').forEach((x) => x.classList.remove('focused'));
    this.container.classList.add('focused');
    if (this.active) {
      store.ui.focusedPanel = this.active.id;
      layoutEvents.emit('focus', this.active.id);
    }
  }
}

export function showPanel(id) {
  const p = panels.get(id);
  if (p && p.group) {
    p.group.activate(id);
    p.group.focus();
  }
}

export function isPanelVisible(id) {
  const p = panels.get(id);
  return !!(p && p.group && p.group.active === p);
}

export function refreshTabTitles() {
  for (const g of groups.values()) g.renderTabs();
}

export function restoreTabs() {
  for (const [name, g] of groups) {
    const id = settings.layout['tab_' + name];
    if (id && g.panels.find((p) => p.id === id)) g.activate(id);
  }
}

export function initSplitters() {
  const L = settings.layout;
  const apply = () => {
    if (L.rowTop) document.getElementById('row-top').style.flex = `0 0 ${L.rowTop}px`;
    if (L.topLeft) document.getElementById('group-left-top').style.flex = `0 0 ${L.topLeft}px`;
    if (L.bottomLeft) document.getElementById('group-left-bottom').style.flex = `0 0 ${L.bottomLeft}px`;
  };
  apply();
  document.querySelectorAll('.splitter').forEach((sp) => {
    sp.addEventListener('mousedown', (e) => {
      e.preventDefault();
      sp.classList.add('dragging');
      const key = sp.dataset.split;
      const target = key === 'rows' ? document.getElementById('row-top') : sp.previousElementSibling;
      const r0 = target.getBoundingClientRect();
      const x0 = e.clientX, y0 = e.clientY;
      const move = (ev) => {
        if (key === 'rows') {
          const ws = document.getElementById('workspace').getBoundingClientRect();
          const h = Math.max(140, Math.min(ws.height - 180, r0.height + ev.clientY - y0));
          target.style.flex = `0 0 ${h}px`;
          L.rowTop = h;
        } else {
          const w = Math.max(160, Math.min(window.innerWidth - 400, r0.width + ev.clientX - x0));
          target.style.flex = `0 0 ${w}px`;
          L[key] = w;
        }
        layoutEvents.emit('resize');
      };
      const up = () => {
        sp.classList.remove('dragging');
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        saveSettings();
        layoutEvents.emit('resize');
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    sp.addEventListener('dblclick', () => {
      const key = sp.dataset.split;
      delete L[key === 'rows' ? 'rowTop' : key];
      const target = key === 'rows' ? document.getElementById('row-top') : sp.previousElementSibling;
      target.style.flex = '';
      saveSettings();
      layoutEvents.emit('resize');
    });
  });
}

// ---- Panel taşıma ve çalışma alanları
export function movePanel(id, groupName, { save = true, activate = true } = {}) {
  const p = panels.get(id), to = groups.get(groupName);
  if (!p || !to || p.group === to) return false;
  const from = p.group;
  if (from.panels.length <= 1) return false; // grup boş kalmasın
  from.panels = from.panels.filter((x) => x !== p);
  p.body.classList.remove('active');
  to.container.appendChild(p.body);
  p.group = to;
  to.panels.push(p);
  if (from.active === p) { from.active = null; from.activate(from.panels[0].id); } else from.renderTabs();
  if (activate) to.activate(id); else to.renderTabs();
  if (save) {
    settings.layout.place = { ...(settings.layout.place || {}) };
    if (groupName === p.homeGroup) delete settings.layout.place[id]; else settings.layout.place[id] = groupName;
    saveSettings();
  }
  layoutEvents.emit('resize');
  return true;
}

export function restorePlacement() {
  for (const [id, g] of Object.entries(settings.layout.place || {})) movePanel(id, g, { save: false, activate: false });
}

// Hazır çalışma alanları: hangi panel hangi grupta, hangi sekme önde, üst satır yüksekliği (pencere oranı)
export const WORKSPACES = {
  editing: { name: 'Editing', place: {}, tabs: { leftTop: 'source', leftBottom: 'project' } },
  color: { name: 'Color', place: { scopes: 'leftBottom' }, tabs: { leftTop: 'lumetri', leftBottom: 'scopes' }, rowTop: 0.62 },
  effects: { name: 'Effects', place: {}, tabs: { leftTop: 'effectControls', leftBottom: 'effects' } },
  audio: { name: 'Audio', place: { audioMixer: 'leftBottom' }, tabs: { leftTop: 'essentialSound', leftBottom: 'audioMixer' }, rowTop: 0.5 },
  graphics: { name: 'Graphics', place: {}, tabs: { leftTop: 'graphics', leftBottom: 'effects' } },
};

export function currentWorkspace() { return settings.layout.workspace || 'editing'; }

export function applyWorkspace(id) {
  const ws = WORKSPACES[id] || (settings.workspaces || {})[id];
  if (!ws) return;
  // önce her paneli evine, sonra çalışma alanının yerleşimine
  for (const p of panels.values()) if (p.group.name !== p.homeGroup) movePanel(p.id, p.homeGroup, { save: false, activate: false });
  for (const [pid, g] of Object.entries(ws.place || {})) movePanel(pid, g, { save: false, activate: false });
  for (const [g, pid] of Object.entries(ws.tabs || {})) { const gr = groups.get(g); if (gr && gr.panels.find((x) => x.id === pid)) gr.activate(pid); }
  const row = document.getElementById('row-top');
  if (ws.rowTop) { const h = Math.round(document.getElementById('workspace').getBoundingClientRect().height * ws.rowTop); row.style.flex = `0 0 ${h}px`; settings.layout.rowTop = h; }
  else { row.style.flex = ''; delete settings.layout.rowTop; }
  settings.layout.place = { ...(ws.place || {}) };
  settings.layout.workspace = id;
  saveSettings();
  layoutEvents.emit('workspace', id);
  layoutEvents.emit('resize');
}

// Şu anki yerleşimi kullanıcı çalışma alanı olarak kaydet
export function saveWorkspaceAs(name) {
  const id = 'user_' + Date.now().toString(36);
  const tabs = {};
  for (const [g, gr] of groups) if (gr.active) tabs[g] = gr.active.id;
  const wsH = document.getElementById('workspace').getBoundingClientRect().height;
  const rowH = document.getElementById('row-top').getBoundingClientRect().height;
  settings.workspaces = { ...(settings.workspaces || {}), [id]: { name, place: { ...(settings.layout.place || {}) }, tabs, rowTop: settings.layout.rowTop ? rowH / wsH : null, user: true } };
  settings.layout.workspace = id;
  saveSettings();
  layoutEvents.emit('workspace', id);
  return id;
}

export function deleteWorkspace(id) {
  const w = { ...(settings.workspaces || {}) };
  delete w[id];
  settings.workspaces = w;
  if (settings.layout.workspace === id) settings.layout.workspace = 'editing';
  saveSettings();
  layoutEvents.emit('workspace', currentWorkspace());
}

export function allWorkspaces() {
  return [...Object.entries(WORKSPACES), ...Object.entries(settings.workspaces || {})];
}

export function resetLayout() {
  const ws = currentWorkspace();
  for (const p of panels.values()) if (p.group.name !== p.homeGroup) movePanel(p.id, p.homeGroup, { save: false, activate: false });
  settings.layout = {};
  saveSettings();
  if (ws !== 'editing') { applyWorkspace(ws); return; }
  for (const id of ['row-top', 'group-left-top', 'group-left-bottom']) document.getElementById(id).style.flex = '';
  layoutEvents.emit('resize');
}
