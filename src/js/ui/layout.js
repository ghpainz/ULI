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
    groups.set(name, this);
  }
  add(panel) {
    panel.group = this;
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
      const tab = el('div', { class: 'tab' + (this.active === p ? ' active' : ''), text: p.title() });
      tab.addEventListener('mousedown', () => this.activate(p.id));
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

export function resetLayout() {
  settings.layout = {};
  saveSettings();
  for (const id of ['row-top', 'group-left-top', 'group-left-bottom']) document.getElementById(id).style.flex = '';
  layoutEvents.emit('resize');
}
