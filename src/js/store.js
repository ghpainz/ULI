// Uygulama durumu + geri al / yinele
import { Emitter } from './util.js';
import { createProject } from './model.js';

const MAX_UNDO = 300;

class Store extends Emitter {
  constructor() {
    super();
    this.project = createProject();
    this.projectPath = null;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this._txn = null;
    // UI durumu (geri alınmaz)
    this.ui = {
      selection: new Set(), // clip id
      selectedGap: null, // {type, track, start, end}
      tool: 'select',
      snapping: true,
      linkedSelection: true,
      focusedPanel: 'timeline',
      selectedProjectItems: new Set(),
      currentBin: 'root',
      sourceMediaId: null,
      useProxies: true,
      playbackRes: 'auto',
      loop: false,
      showWaveforms: true,
      selectedKeyframes: [], // [{clipId, path, f}]
      selectedTransition: null, // {clipId, which: 'in'|'out'}
      selectedMask: null, // {clipId, owner, maskId}
      maskPen: null, // kalemle çizilen maske
    };
  }

  get seq() {
    const id = this.project.activeSequenceId;
    return id ? this.project.sequences[id] : null;
  }

  setProject(project, path = null) {
    this.project = project;
    this.projectPath = path;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.ui.selection.clear();
    this.ui.selectedGap = null;
    this.ui.selectedProjectItems.clear();
    this.ui.currentBin = 'root';
    this.ui.sourceMediaId = null;
    this.emit('project');
    this.emit('change', { type: 'project' });
  }

  // Tek adımlı değişiklik
  commit(label, fn, info = {}) {
    if (this._txn) {
      fn(this.project);
      this._txn.changed = true;
      this.emit('change', { label, ...info, live: true });
      return;
    }
    const before = structuredClone(this.project);
    let res;
    try {
      res = fn(this.project);
    } catch (e) {
      this.project = before;
      throw e;
    }
    if (res === false) {
      this.project = before;
      return false;
    }
    this._push({ label, state: before });
    this.emit('change', { label, ...info });
    return res;
  }

  // Sürükleme gibi sürekli işlemler için
  begin(label) {
    if (this._txn) this.end();
    this._txn = { label, state: structuredClone(this.project), changed: false };
  }
  live(fn, info = {}) {
    if (!this._txn) return this.commit('Edit', fn, info);
    fn(this.project);
    this._txn.changed = true;
    this.emit('change', { live: true, ...info });
  }
  end() {
    const t = this._txn;
    this._txn = null;
    if (t && t.changed) {
      this._push({ label: t.label, state: t.state });
      this.emit('change', { label: t.label, final: true });
    }
  }
  cancel() {
    const t = this._txn;
    this._txn = null;
    if (t && t.changed) {
      this.project = t.state;
      this.emit('change', { label: 'cancel' });
    }
  }

  _push(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack.length = 0;
    this.markDirty();
  }

  markDirty() {
    if (!this.dirty) {
      this.dirty = true;
      this.emit('dirty', true);
    }
  }
  markClean() {
    this.dirty = false;
    this.emit('dirty', false);
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  undoLabel() { return this.undoStack.length ? this.undoStack[this.undoStack.length - 1].label : null; }
  redoLabel() { return this.redoStack.length ? this.redoStack[this.redoStack.length - 1].label : null; }

  undo() {
    if (this._txn) this.end();
    const e = this.undoStack.pop();
    if (!e) return;
    this.redoStack.push({ label: e.label, state: this.project });
    this.project = e.state;
    this._afterRestore();
    this.emit('change', { label: 'undo:' + e.label, undo: true });
    return e.label;
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    this.undoStack.push({ label: e.label, state: this.project });
    this.project = e.state;
    this._afterRestore();
    this.emit('change', { label: 'redo:' + e.label, redo: true });
    return e.label;
  }

  // Geçmiş panelinden belirli bir adıma git
  jumpTo(index) {
    // index: undoStack içindeki konum; undoStack.length => mevcut durum
    while (this.undoStack.length > index) this.undo();
  }

  _afterRestore() {
    const seq = this.seq;
    if (seq) {
      for (const id of [...this.ui.selection]) if (!seq.clips[id]) this.ui.selection.delete(id);
    } else this.ui.selection.clear();
    this.ui.selectedGap = null;
    this.markDirty();
  }

  select(ids, additive = false) {
    if (!additive) this.ui.selection.clear();
    for (const id of ids) this.ui.selection.add(id);
    this.ui.selectedGap = null;
    this._dropMaskSel();
    this.emit('selection');
  }
  _dropMaskSel() {
    const sm = this.ui.selectedMask;
    if (sm && !this.ui.selection.has(sm.clipId)) { this.ui.selectedMask = null; this.ui.maskPen = null; }
  }
  toggleSelect(ids) {
    for (const id of ids) {
      if (this.ui.selection.has(id)) this.ui.selection.delete(id);
      else this.ui.selection.add(id);
    }
    this.emit('selection');
  }
  clearSelection() {
    if (this.ui.selection.size === 0 && !this.ui.selectedGap) return;
    this.ui.selection.clear();
    this.ui.selectedGap = null;
    this._dropMaskSel();
    this.emit('selection');
  }
  selectedClips() {
    const seq = this.seq;
    if (!seq) return [];
    return [...this.ui.selection].map((id) => seq.clips[id]).filter(Boolean);
  }

  setTool(t) {
    this.ui.tool = t;
    this.emit('tool', t);
  }
}

export const store = new Store();
