// Dışa aktarma kuyruğu: işler sırayla arka planda çalışır, sen düzenlemeye devam edersin.
// Her iş eklendiği andaki proje ve sekansın kopyasıyla çalışır (sonraki düzenlemeler onu etkilemez).
import { store } from './store.js';
import { t } from './i18n.js';
import { Emitter, uid } from './util.js';
import { exportSequence } from './exporter.js';
import { registerJob } from './ffmpeg.js';
import { toast } from './ui/dialogs.js';

export const queueEvents = new Emitter();
export const jobs = [];
let running = null;

export function addToQueue(seq, opts) {
  const job = {
    id: uid('q'), name: seq.name, file: opts.file, format: opts.format,
    project: structuredClone(store.project), seq: structuredClone(seq), opts: structuredClone(opts),
    status: 'waiting', progress: 0, error: null, added: Date.now(), seconds: null,
  };
  jobs.push(job);
  queueEvents.emit('change');
  toast(t('Added to export queue') + ': ' + seq.name);
  pump();
  return job;
}

export function cancelJob(id) {
  const j = jobs.find((x) => x.id === id);
  if (!j) return;
  if (j.status === 'running') j.ctrl?.abort();
  else if (j.status === 'waiting') { j.status = 'cancelled'; queueEvents.emit('change'); }
}

export function removeJob(id) {
  const i = jobs.findIndex((x) => x.id === id && x.status !== 'running');
  if (i >= 0) { jobs.splice(i, 1); queueEvents.emit('change'); }
}

export function clearFinished() {
  for (let i = jobs.length - 1; i >= 0; i--) if (['done', 'failed', 'cancelled'].includes(jobs[i].status)) jobs.splice(i, 1);
  queueEvents.emit('change');
}

export function retryJob(id) {
  const j = jobs.find((x) => x.id === id);
  if (j && ['failed', 'cancelled'].includes(j.status)) { j.status = 'waiting'; j.progress = 0; j.error = null; queueEvents.emit('change'); pump(); }
}

export function queueBusy() { return !!running; }

async function pump() {
  if (running) return;
  const job = jobs.find((x) => x.status === 'waiting');
  if (!job) return;
  running = job;
  job.status = 'running';
  job.ctrl = new AbortController();
  const bg = registerJob(t('Export') + ': ' + job.name);
  queueEvents.emit('change');
  try {
    const res = await exportSequence(job.seq, { ...job.opts, project: job.project }, {
      signal: job.ctrl.signal,
      onProgress: (p) => { job.progress = p; bg.progress(p); queueEvents.emit('progress', job); },
    });
    job.status = 'done';
    job.progress = 1;
    job.seconds = res.seconds;
    toast(t('Export finished') + ': ' + job.name);
  } catch (e) {
    if (e.cancelled || e.message === 'cancelled' || job.ctrl.signal.aborted) {
      job.status = 'cancelled';
      try { window.require('fs').unlinkSync(job.file); } catch (er) { /* */ }
    } else { job.status = 'failed'; job.error = e.message; console.error(e); toast(t('Export failed') + ': ' + job.name, 'error'); }
  } finally {
    bg.done();
    job.ctrl = null;
    running = null;
    queueEvents.emit('change');
    pump();
  }
}
