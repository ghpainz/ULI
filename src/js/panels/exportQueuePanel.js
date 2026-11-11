// Dışa Aktarma Kuyruğu paneli: bekleyen / çalışan / biten işler, ilerleme, iptal, yeniden dene, klasörü aç
import { app } from '../appContext.js';
import { t } from '../i18n.js';
import { el, ipc, nodePath, fmtSeconds, rafThrottle } from '../util.js';
import { jobs, queueEvents, cancelJob, removeJob, clearFinished, retryJob } from '../exportQueue.js';
import { FORMATS } from '../exporter.js';

const STATUS = { waiting: 'Waiting', running: 'Exporting', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };
const COLOR = { waiting: '#9a9a9a', running: '#2d8ceb', done: '#3fbf6a', failed: '#e5484d', cancelled: '#9a9a9a' };

export class ExportQueuePanel {
  constructor() { this.id = 'exportQueue'; this._render = rafThrottle(() => this.render()); }
  title() { const n = jobs.filter((j) => j.status === 'waiting' || j.status === 'running').length; return t('Export Queue') + (n ? ` (${n})` : ''); }
  mount(body) {
    this.root = el('div', { style: { overflowY: 'auto', height: '100%' } });
    body.appendChild(this.root);
    queueEvents.on('change', () => { this._render(); this.group?.renderTabs(); });
    queueEvents.on('progress', () => this._progress());
    this.render();
  }
  _progress() {
    for (const j of jobs) {
      const bar = this.root.querySelector(`[data-job="${j.id}"] .progress > div`);
      if (bar) bar.style.width = Math.round(j.progress * 100) + '%';
      const pct = this.root.querySelector(`[data-job="${j.id}"] .q-pct`);
      if (pct && j.status === 'running') pct.textContent = Math.round(j.progress * 100) + '%';
    }
  }
  render() {
    const R = this.root;
    R.innerHTML = '';
    const tb = el('div', { class: 'toolbar' });
    const add = el('button', { text: t('Add Current Sequence...'), title: t('Opens export settings; choose "Add to Queue"') });
    add.addEventListener('click', () => app.openExport());
    const clr = el('button', { text: t('Clear Finished') });
    clr.addEventListener('click', clearFinished);
    tb.append(add, el('span', { class: 'grow' }), clr);
    R.appendChild(tb);
    if (!jobs.length) {
      R.appendChild(el('div', { class: 'empty-hint', html: t('The queue is empty.') + '<br>' + t('In Export Settings (Ctrl+M) choose "Add to Queue" to export in the background while you keep editing.') }));
      return;
    }
    for (const j of jobs) {
      const btn = (text, title, fn) => { const b = el('button', { class: 'icon', text, title }); b.addEventListener('click', fn); return b; };
      const actions = [];
      if (j.status === 'running' || j.status === 'waiting') actions.push(btn('✕', t('Cancel'), () => cancelJob(j.id)));
      if (j.status === 'failed' || j.status === 'cancelled') actions.push(btn('↻', t('Retry'), () => retryJob(j.id)));
      if (j.status === 'done') actions.push(btn('▶', t('Open'), () => ipc.invoke('shell:open', j.file.includes('%05d') ? nodePath.dirname(j.file) : j.file)), btn('📁', t('Show in Explorer'), () => ipc.invoke('shell:reveal', j.file)));
      if (j.status !== 'running') actions.push(btn('🗑', t('Remove'), () => removeJob(j.id)));
      const info = j.status === 'done' && j.seconds != null ? fmtSeconds(j.seconds) : j.status === 'failed' ? (j.error || '').split('\n')[0] : '';
      R.appendChild(el('div', { 'data-job': j.id, style: { padding: '8px 10px', borderBottom: '1px solid #2a2a2a' } },
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          el('b', { text: j.name, style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }),
          el('span', { class: 'q-pct', text: j.status === 'running' ? Math.round(j.progress * 100) + '%' : t(STATUS[j.status]), style: { color: COLOR[j.status], fontSize: '11px' } }),
          ...actions),
        el('div', { text: `${FORMATS[j.format]?.label || j.format} · ${nodePath.basename(j.file)}`, title: j.file, style: { color: 'var(--text-dim)', fontSize: '11px', margin: '3px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }),
        el('div', { class: 'progress', style: { height: '4px' } }, el('div', { style: { width: Math.round(j.progress * 100) + '%', background: COLOR[j.status] } })),
        info ? el('div', { text: info, style: { fontSize: '11px', color: j.status === 'failed' ? COLOR.failed : 'var(--text-dim)', marginTop: '3px' } }) : null));
    }
  }
}
