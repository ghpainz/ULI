// Proje paneli
import { store } from '../store.js';
import { app } from '../appContext.js';
import { t } from '../i18n.js';
import { el, uid, framesToTC, fmtSeconds, ipc, nodePath, LABEL_COLORS, rafThrottle, secToTC } from '../util.js';
import { binChildren, mediaInUse, sequenceDuration, createSequence } from '../model.js';
import { rt, mediaEvents, importFiles, createProxy, deleteProxy, cancelProxy, relinkMedia, mediaStatus, ALL_EXT } from '../media.js';
import { jobs } from '../ffmpeg.js';
import { contextMenu, confirmDialog, promptDialog, alertDialog, modal, toast } from '../ui/dialogs.js';

export class ProjectPanel {
  constructor() {
    this.id = 'project';
    this.view = localStorage.getItem('uli.projView') || 'list';
    this.filter = '';
    this.sort = { key: 'name', dir: 1 };
    this.lastClicked = null;
    this._render = rafThrottle(() => this.render());
  }
  title() { return t('Project') + ': ' + (store.project.name || t('Untitled')); }

  mount(body) {
    const tb = el('div', { class: 'toolbar' });
    this.search = el('input', { type: 'text', placeholder: t('Search') });
    this.search.addEventListener('input', () => { this.filter = this.search.value.toLowerCase(); this.render(); });
    const listBtn = el('button', { class: 'icon', title: t('List View'), text: '☰' });
    const gridBtn = el('button', { class: 'icon', title: t('Icon View'), text: '▦' });
    listBtn.addEventListener('click', () => { this.view = 'list'; localStorage.setItem('uli.projView', 'list'); this.render(); });
    gridBtn.addEventListener('click', () => { this.view = 'grid'; localStorage.setItem('uli.projView', 'grid'); this.render(); });
    this.listBtn = listBtn; this.gridBtn = gridBtn;
    const newBtn = el('button', { class: 'icon', title: t('New Item'), text: '＋' });
    newBtn.addEventListener('click', (e) => {
      const r = newBtn.getBoundingClientRect();
      contextMenu(r.left, r.bottom, [
        { label: t('Sequence...'), action: () => app.commands.run('file.newSequence') },
        { label: t('Bin'), action: () => this.newBin() },
        '-',
        { label: t('Title (Text)'), enabled: !!store.seq, action: () => app.commands.run('file.newTitle') },
        { label: t('Color Matte...'), enabled: !!store.seq, action: () => app.commands.run('file.newColorMatte') },
        { label: t('Adjustment Layer'), enabled: !!store.seq, action: () => app.commands.run('file.newAdjustment') },
      ]);
    });
    const impBtn = el('button', { class: 'icon', title: t('Import...') + ' (Ctrl+I)', text: '⇩' });
    impBtn.addEventListener('click', () => app.commands.run('file.import'));
    const binBtn = el('button', { class: 'icon', title: t('New Bin'), text: '📁' });
    binBtn.addEventListener('click', () => this.newBin());
    const delBtn = el('button', { class: 'icon', title: t('Clear'), text: '🗑' });
    delBtn.addEventListener('click', () => this.deleteSelected());
    tb.append(this.search, listBtn, gridBtn, binBtn, newBtn, impBtn, delBtn);
    this.crumb = el('div', { class: 'breadcrumb' });
    this.content = el('div', { class: 'list-view' });
    body.append(tb, this.crumb, this.content);
    this.content.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); this.content.classList.add('drop-highlight'); }
    });
    this.content.addEventListener('dragleave', () => this.content.classList.remove('drop-highlight'));
    this.content.addEventListener('drop', async (e) => {
      this.content.classList.remove('drop-highlight');
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      const { webUtils } = window.require('electron');
      const paths = [...e.dataTransfer.files].map((f) => (webUtils ? webUtils.getPathForFile(f) : f.path)).filter(Boolean);
      const r = await importFiles(paths, store.ui.currentBin);
      if (r.length) toast(t('{n} item(s) imported', { n: r.length }));
    });
    this.content.addEventListener('mousedown', (e) => {
      if (e.target === this.content || e.target.classList.contains('grid-view')) { store.ui.selectedProjectItems.clear(); this.render(); }
    });
    this.content.addEventListener('contextmenu', (e) => {
      if (e.target !== this.content && !e.target.classList.contains('grid-view') && !e.target.classList.contains('empty-hint')) return;
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, [
        { label: t('New Sequence...'), action: () => app.commands.run('file.newSequence') },
        { label: t('New Bin'), action: () => this.newBin() },
        { label: t('Import...'), action: () => app.commands.run('file.import') },
      ]);
    });
    store.on('change', () => { this._render(); this.group?.renderTabs(); });
    store.on('project', () => this._render());
    mediaEvents.on('update', () => this._render());
    mediaEvents.on('proxyProgress', () => this._render());
    app.project = this;
    this.render();
  }

  newBin() {
    const id = uid('bin');
    store.commit('New Bin', (p) => { p.bins[id] = { id, name: t('Bin') + ' ' + Object.keys(p.bins).length, parent: store.ui.currentBin }; });
    store.ui.selectedProjectItems = new Set(['bin:' + id]);
    this.render();
    this.rename('bin:' + id);
  }

  selectedMediaIds() {
    return [...store.ui.selectedProjectItems].filter((k) => k.startsWith('media:')).map((k) => k.slice(6));
  }

  selectAll() {
    const { bins, media, seqs } = this._items();
    store.ui.selectedProjectItems = new Set([...bins.map((b) => 'bin:' + b.id), ...media.map((m) => 'media:' + m.id), ...seqs.map((s) => 'seq:' + s.id)]);
    this.render();
  }

  reveal(mediaId) {
    const m = store.project.media[mediaId];
    if (!m) return;
    store.ui.currentBin = m.binId || 'root';
    store.ui.selectedProjectItems = new Set(['media:' + mediaId]);
    app.commands.showPanel('project');
    this.render();
  }

  _items() {
    const p = store.project;
    let { bins, media, seqs } = this.filter
      ? { bins: [], media: Object.values(p.media), seqs: Object.values(p.sequences) }
      : binChildren(p, store.ui.currentBin);
    if (this.filter) {
      media = media.filter((m) => m.name.toLowerCase().includes(this.filter));
      seqs = seqs.filter((s) => s.name.toLowerCase().includes(this.filter));
    }
    const k = this.sort.key, d = this.sort.dir;
    const cmp = (a, b) => {
      let va = a[k], vb = b[k];
      if (k === 'name') return d * String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
      va = va ?? 0; vb = vb ?? 0;
      return d * (va > vb ? 1 : va < vb ? -1 : 0);
    };
    bins.sort((a, b) => a.name.localeCompare(b.name));
    media.sort(cmp);
    seqs.sort(cmp);
    return { bins, media, seqs };
  }

  _crumbs() {
    const p = store.project;
    this.crumb.innerHTML = '';
    const chain = [];
    let b = p.bins[store.ui.currentBin];
    while (b) { chain.unshift(b); b = b.parent ? p.bins[b.parent] : null; }
    chain.forEach((bin, i) => {
      const s = el('span', { text: bin.id === 'root' ? (p.name || t('Untitled')) : bin.name });
      s.addEventListener('click', () => { store.ui.currentBin = bin.id; this.render(); });
      if (i) this.crumb.appendChild(document.createTextNode(' › '));
      this.crumb.appendChild(s);
    });
    this.crumb.addEventListener('dragover', (e) => e.preventDefault());
  }

  render() {
    if (!this.content) return;
    this.listBtn.classList.toggle('active', this.view === 'list');
    this.gridBtn.classList.toggle('active', this.view === 'grid');
    this._crumbs();
    const { bins, media, seqs } = this._items();
    const sel = store.ui.selectedProjectItems;
    this.content.innerHTML = '';
    this._order = [...bins.map((b) => 'bin:' + b.id), ...seqs.map((s) => 'seq:' + s.id), ...media.map((m) => 'media:' + m.id)];
    if (!bins.length && !media.length && !seqs.length) {
      this.content.appendChild(el('div', { class: 'empty-hint', html: t('Import media to start') + '<br><span class="kbd">Ctrl+I</span> ' + t('or drag files here') }));
      return;
    }
    if (this.view === 'grid') return this._renderGrid(bins, media, seqs, sel);
    const th = (key, label) => {
      const h = el('th', { text: label + (this.sort.key === key ? (this.sort.dir > 0 ? ' ▲' : ' ▼') : '') });
      h.addEventListener('click', () => { if (this.sort.key === key) this.sort.dir *= -1; else this.sort = { key, dir: 1 }; this.render(); });
      return h;
    };
    const tbl = el('table', { class: 'list-table' });
    tbl.appendChild(el('tr', {}, th('name', t('Name')), th('duration', t('Duration')), th('fps', t('Frame Rate')), th('width', t('Video Info')), th('channels', t('Audio Info')), th('vcodec', t('Codec')), el('th', { text: t('Status') })));
    for (const b of bins) {
      const tr = el('tr', { class: sel.has('bin:' + b.id) ? 'sel' : '' },
        el('td', {}, el('div', { class: 'name-cell' }, el('span', { text: '📁' }), el('span', { text: b.name }))),
        el('td', { text: '' }), el('td'), el('td'), el('td'), el('td'), el('td'));
      this._bindItem(tr, 'bin:' + b.id);
      tbl.appendChild(tr);
    }
    for (const s of seqs) {
      const tr = el('tr', { class: sel.has('seq:' + s.id) ? 'sel' : '' },
        el('td', {}, el('div', { class: 'name-cell' }, el('span', { class: 'badge', style: { background: '#2aa8a0' } }), el('span', { text: s.name }))),
        el('td', { text: framesToTC(sequenceDuration(s), s.fps) }),
        el('td', { text: s.fps + ' fps' }),
        el('td', { text: s.width + '×' + s.height }),
        el('td', { text: s.sampleRate + ' Hz' }),
        el('td', { text: t('Sequence') }), el('td'));
      this._bindItem(tr, 'seq:' + s.id);
      tbl.appendChild(tr);
    }
    for (const m of media) {
      const r = rt(m.id);
      const st = mediaStatus(m);
      const status = st === 'offline' ? t('Offline') : r.proxyJob ? t('Proxy') + ' ' + Math.round((r.proxyProgress || 0) * 100) + '%' : st === 'unsupported' ? t('Needs proxy') : m.proxyPath ? t('Proxy ready') : '';
      const thumb = r.thumb ? el('img', { class: 'thumb', src: r.thumb }) : el('span', { class: 'badge', style: { background: m.type === 'audio' ? '#3f9a63' : m.type === 'image' ? '#a05f9a' : '#7472c4' } });
      const tr = el('tr', { class: (sel.has('media:' + m.id) ? 'sel' : '') + (st === 'offline' ? ' offline' : '') },
        el('td', { title: m.path }, el('div', { class: 'name-cell' }, thumb, m.label ? el('span', { class: 'badge', style: { background: LABEL_COLORS[m.label] } }) : null, el('span', { text: m.name }))),
        el('td', { text: m.type === 'image' ? t('Still') : m.duration ? secToTC(m.duration, m.fps || 30) : '' }),
        el('td', { text: m.fps ? Math.round(m.fps * 1000) / 1000 + ' fps' : '' }),
        el('td', { text: m.hasVideo ? m.width + '×' + m.height : '' }),
        el('td', { text: m.hasAudio ? m.sampleRate + ' Hz ' + (m.channels === 1 ? t('Mono') : m.channels === 2 ? t('Stereo') : m.channels + 'ch') : '' }),
        el('td', { text: [m.vcodec, m.acodec].filter(Boolean).join(' / ') }),
        el('td', { text: status, style: { color: st === 'offline' || st === 'unsupported' ? 'var(--danger)' : r.proxyJob ? 'var(--warn)' : 'var(--ok)' } }));
      this._bindItem(tr, 'media:' + m.id);
      tbl.appendChild(tr);
    }
    this.content.appendChild(tbl);
  }

  _renderGrid(bins, media, seqs, sel) {
    const g = el('div', { class: 'grid-view' });
    const mk = (key, name, thumbStyle, icon, dur, badge) => {
      const it = el('div', { class: 'grid-item' + (sel.has(key) ? ' sel' : '') },
        el('div', { class: 'gthumb', style: thumbStyle }, icon ? el('span', { text: icon }) : null, dur ? el('span', { class: 'dur', text: dur }) : null, badge ? el('span', { class: 'prox', text: badge }) : null),
        el('div', { class: 'gname', text: name, title: name }));
      this._bindItem(it, key);
      g.appendChild(it);
    };
    for (const b of bins) mk('bin:' + b.id, b.name, {}, '📁');
    for (const s of seqs) mk('seq:' + s.id, s.name, { background: '#163a3a' }, '🎞', framesToTC(sequenceDuration(s), s.fps));
    for (const m of media) {
      const r = rt(m.id);
      const st = mediaStatus(m);
      const badge = st === 'offline' ? t('Offline') : r.proxyJob ? Math.round((r.proxyProgress || 0) * 100) + '%' : m.proxyPath ? 'P' : '';
      mk('media:' + m.id, m.name, r.thumb ? { backgroundImage: `url("${r.thumb}")` } : { background: m.type === 'audio' ? '#183a26' : '#222' }, r.thumb ? null : m.type === 'audio' ? '♪' : '▶', m.type === 'image' ? '' : fmtSeconds(m.duration), badge);
    }
    this.content.appendChild(g);
  }

  _bindItem(node, key) {
    node.draggable = true;
    node.addEventListener('mousedown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      const sel = store.ui.selectedProjectItems;
      if (e.button === 2 && sel.has(key)) return;
      if (e.ctrlKey) { if (sel.has(key)) sel.delete(key); else sel.add(key); }
      else if (e.shiftKey && this.lastClicked && this._order) {
        const a = this._order.indexOf(this.lastClicked), b = this._order.indexOf(key);
        if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) sel.add(this._order[i]);
      } else if (!sel.has(key)) { sel.clear(); sel.add(key); }
      this.lastClicked = key;
      this.render();
      if (key.startsWith('media:')) app.effectControls?.render();
    });
    node.addEventListener('dblclick', () => this.open(key));
    node.addEventListener('contextmenu', (e) => { e.preventDefault(); this._menu(e, key); });
    node.addEventListener('dragstart', (e) => {
      const sel = store.ui.selectedProjectItems;
      if (!sel.has(key)) { sel.clear(); sel.add(key); }
      const mediaIds = [...sel].filter((k) => k.startsWith('media:')).map((k) => k.slice(6));
      app.dragMedia = mediaIds;
      app.dragSeqs = [...sel].filter((k) => k.startsWith('seq:')).map((k) => k.slice(4));
      app.dragProjectItems = [...sel];
      e.dataTransfer.setData('application/x-uli-seqs', JSON.stringify(app.dragSeqs));
      e.dataTransfer.setData('application/x-uli-media', JSON.stringify(mediaIds));
      e.dataTransfer.setData('application/x-uli-items', JSON.stringify([...sel]));
      e.dataTransfer.effectAllowed = 'copyMove';
    });
    if (key.startsWith('bin:')) {
      node.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-uli-items')) { e.preventDefault(); node.classList.add('drop-highlight'); } });
      node.addEventListener('dragleave', () => node.classList.remove('drop-highlight'));
      node.addEventListener('drop', (e) => {
        node.classList.remove('drop-highlight');
        const items = JSON.parse(e.dataTransfer.getData('application/x-uli-items') || '[]');
        e.preventDefault();
        e.stopPropagation();
        this.moveToBin(items, key.slice(4));
      });
    }
  }

  moveToBin(items, binId) {
    store.commit('Move to Bin', (p) => {
      for (const k of items) {
        const [type, id] = k.split(':');
        if (type === 'media' && p.media[id]) p.media[id].binId = binId;
        if (type === 'seq' && p.sequences[id]) p.sequences[id].binId = binId;
        if (type === 'bin' && p.bins[id] && id !== binId) {
          // döngü engeli
          let b = p.bins[binId];
          let ok = true;
          while (b) { if (b.id === id) { ok = false; break; } b = b.parent ? p.bins[b.parent] : null; }
          if (ok) p.bins[id].parent = binId;
        }
      }
    });
  }

  open(key) {
    const [type, id] = key.split(':');
    if (type === 'bin') { store.ui.currentBin = id; store.ui.selectedProjectItems.clear(); this.render(); }
    else if (type === 'seq') app.commands.openSequence(id);
    else if (type === 'media') app.source.openMedia(id);
  }

  async rename(key) {
    const [type, id] = key.split(':');
    const p = store.project;
    const obj = type === 'bin' ? p.bins[id] : type === 'seq' ? p.sequences[id] : p.media[id];
    if (!obj) return;
    const v = await promptDialog(t('Name'), obj.name);
    if (!v) return;
    store.commit('Rename', (pr) => {
      const o = type === 'bin' ? pr.bins[id] : type === 'seq' ? pr.sequences[id] : pr.media[id];
      o.name = v;
    });
  }

  async deleteSelected() {
    const items = [...store.ui.selectedProjectItems];
    if (!items.length) return;
    const p = store.project;
    const used = items.filter((k) => k.startsWith('media:') && mediaInUse(p, k.slice(6)));
    if (used.length) {
      const ok = await confirmDialog(t('{n} item(s) are used in sequences. Clips using them will be removed too. Continue?', { n: used.length }));
      if (!ok) return;
    }
    const collect = (binId, out) => {
      for (const b of Object.values(p.bins)) if (b.parent === binId) { out.bins.push(b.id); collect(b.id, out); }
      for (const m of Object.values(p.media)) if ((m.binId || 'root') === binId) out.media.push(m.id);
      for (const s of Object.values(p.sequences)) if ((s.binId || 'root') === binId) out.seqs.push(s.id);
    };
    const del = { bins: [], media: [], seqs: [] };
    for (const k of items) {
      const [type, id] = k.split(':');
      if (type === 'bin') { del.bins.push(id); collect(id, del); }
      if (type === 'media') del.media.push(id);
      if (type === 'seq') del.seqs.push(id);
    }
    if (del.seqs.length && !used.length) {
      const ok = await confirmDialog(t('Delete {n} sequence(s)?', { n: del.seqs.length }));
      if (!ok) return;
    }
    store.commit('Clear', (pr) => {
      for (const id of del.media) {
        for (const sid in pr.sequences) {
          const s = pr.sequences[sid];
          for (const cid of Object.keys(s.clips)) if (s.clips[cid].mediaId === id) delete s.clips[cid];
        }
        delete pr.media[id];
      }
      for (const id of del.seqs) {
        delete pr.sequences[id];
        for (const sid in pr.sequences) {
          const s = pr.sequences[sid];
          for (const cid of Object.keys(s.clips)) if (s.clips[cid].seqId === id) delete s.clips[cid];
        }
        pr.openSequenceIds = pr.openSequenceIds.filter((x) => x !== id);
        if (pr.activeSequenceId === id) pr.activeSequenceId = pr.openSequenceIds[pr.openSequenceIds.length - 1] || null;
      }
      for (const id of del.bins) if (id !== 'root') delete pr.bins[id];
    });
    for (const id of del.media) cancelProxy(id);
    if (del.media.includes(store.ui.sourceMediaId)) { app.source.mediaId = null; app.source._show(); }
    store.ui.selectedProjectItems.clear();
    app.engine.refreshHandles();
  }

  async _menu(e, key) {
    const [type, id] = key.split(':');
    const p = store.project;
    const items = [];
    if (type === 'media') {
      const m = p.media[id];
      const r = rt(id);
      const labels = Object.keys(LABEL_COLORS).map((k) => ({ label: t(k[0].toUpperCase() + k.slice(1)), action: () => store.commit('Label', (pr) => { for (const mid of this.selectedMediaIds()) pr.media[mid].label = k; }) }));
      items.push(
        { label: t('Open in Source Monitor'), action: () => this.open(key) },
        { label: t('New Sequence From Clip'), enabled: m.hasVideo || m.hasAudio, action: () => app.commands.newSequenceFromMedia(m, (s) => {
          store.commit('Insert', (pr) => {
            const sq = pr.sequences[s.id];
            app.editing.placeMedia(pr, sq, m, { start: 0, vTrack: 0, aTrack: 0, mode: 'overwrite', inSec: m.inPoint ?? 0, outSec: m.outPoint ?? m.duration, settings: app.settings });
          });
        }) },
        '-',
        { label: t('Rename'), action: () => this.rename(key) },
        { label: t('Clear'), action: () => this.deleteSelected() },
        { label: t('Label'), submenu: labels },
        '-',
        { label: t('Proxy'), submenu: [
          { label: t('Create Proxies'), enabled: m.type !== 'image' && !r.proxyJob, action: () => { for (const mid of this.selectedMediaIds()) createProxy(mid); } },
          { label: t('Cancel Proxy'), enabled: !!r.proxyJob, action: () => cancelProxy(id) },
          { label: t('Delete Proxy'), enabled: !!m.proxyPath, action: () => { for (const mid of this.selectedMediaIds()) deleteProxy(mid); } },
        ] },
        { label: t('Link Media...'), action: () => this.relink(id) },
        { label: t('Reveal in Explorer'), action: () => ipc.invoke('shell:reveal', m.path) },
        { label: t('Properties...'), action: () => this.properties(id) },
      );
    } else if (type === 'seq') {
      items.push(
        { label: t('Open in Timeline'), action: () => app.commands.openSequence(id) },
        { label: t('Rename'), action: () => this.rename(key) },
        { label: t('Duplicate'), action: () => {
          store.commit('Duplicate Sequence', (pr) => {
            const s = structuredClone(pr.sequences[id]);
            s.id = uid('seq');
            s.name = s.name + ' ' + t('Copy');
            pr.sequences[s.id] = s;
          });
        } },
        { label: t('Clear'), action: () => this.deleteSelected() },
      );
    } else if (type === 'bin') {
      items.push(
        { label: t('Open'), action: () => this.open(key) },
        { label: t('Rename'), action: () => this.rename(key) },
        { label: t('Clear'), action: () => this.deleteSelected() },
      );
    }
    if (store.ui.currentBin !== 'root') items.push('-', { label: t('Move to Parent Bin'), action: () => this.moveToBin([...store.ui.selectedProjectItems], p.bins[store.ui.currentBin].parent || 'root') });
    contextMenu(e.clientX, e.clientY, items);
  }

  async relink(id) {
    const m = store.project.media[id];
    const r = await ipc.invoke('dialog:open', {
      title: t('Link Media') + ': ' + m.name,
      defaultPath: m.path,
      properties: ['openFile'],
      filters: [{ name: t('All Supported Media'), extensions: ALL_EXT.map((e) => e.slice(1)) }, { name: t('All Files'), extensions: ['*'] }],
    });
    if (r.canceled || !r.filePaths.length) return;
    try {
      await relinkMedia(id, r.filePaths[0]);
      // aynı klasördeki diğer çevrimdışı medyaları da dene
      const newDir = nodePath.dirname(r.filePaths[0]);
      const fs = window.require('fs');
      let n = 0;
      for (const mm of Object.values(store.project.media)) {
        if (mm.id === id || !rt(mm.id).offline) continue;
        const cand = nodePath.join(newDir, nodePath.basename(mm.path));
        if (fs.existsSync(cand)) { await relinkMedia(mm.id, cand); n++; }
      }
      toast(t('Media linked') + (n ? ' (+' + n + ')' : ''));
      app.engine.refreshHandles();
    } catch (e) {
      alertDialog(e.message);
    }
  }

  properties(id) {
    const m = store.project.media[id];
    const rows = [
      [t('Name'), m.name], [t('Path'), m.path], [t('Type'), m.type], [t('Duration'), m.duration ? fmtSeconds(m.duration) + ' (' + m.duration.toFixed(3) + 's)' : '-'],
      [t('Video Info'), m.hasVideo ? `${m.width}×${m.height}, ${m.fps ? m.fps.toFixed(3) + ' fps' : ''}, ${m.vcodec} ${m.pixFmt || ''}${m.rotation ? ', ' + m.rotation + '°' : ''}` : '-'],
      [t('Audio Info'), m.hasAudio ? `${m.acodec}, ${m.sampleRate} Hz, ${m.channels} ch` : '-'],
      [t('Bitrate'), m.bitrate ? Math.round(m.bitrate / 1000) + ' kbps' : '-'],
      [t('Size'), m.size ? (m.size / 1048576).toFixed(1) + ' MB' : '-'],
      [t('Proxy'), m.proxyPath || '-'],
    ];
    modal({ title: t('Properties'), body: el('table', { class: 'shortcut-table', style: { userSelect: 'text' } }, ...rows.map(([a, b]) => el('tr', {}, el('td', { text: a, style: { color: 'var(--text-dim)' } }), el('td', { text: b, style: { userSelect: 'text', wordBreak: 'break-all' } })))), buttons: [{ label: t('OK'), primary: true }], width: 620 });
  }
}
