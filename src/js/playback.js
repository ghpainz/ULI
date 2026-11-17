// Program monitörü oynatma motoru: medya elemanlarını senkronlar, Web Audio ile sesi karıştırır,
// her karede compositor ile görüntüyü üretir.
import { store } from './store.js';
import { videoLayersAt, itemsOfLayers, audioStatesAt, clipSpan, flattenMediaItems } from './renderGraph.js';
import { AUDIO_EFFECTS, reverbTaps, humFreqs, audioFxFilters } from './effectsDef.js';
import { processedAudioUrl } from './media.js';
import { needsNoiseFloor, ensureNoiseFloor } from './audioTools.js';
import { dbToGain } from './util.js';
import { sequenceDuration, sourceTimeAt, clipRateAt } from './model.js';
import { multicamGridLayers } from './multicam.js';
import { renderAt } from './renderCache.js';
import { playbackUrl, rt, loadImage } from './media.js';
import { Emitter } from './util.js';

const MAX_HANDLES = 28;

export class PlaybackEngine extends Emitter {
  constructor(compositor) {
    super();
    this.comp = compositor;
    this.handles = new Map();
    this.frame = 0;
    this.playing = false;
    this.rate = 1;
    this.startFrame = 0;
    this.startTime = 0;
    this.endFrame = null;
    this.loopRange = null;
    this._renderQueued = false;
    this._raf = null;
    this.viewSize = { w: 640, h: 360 };
    this.displayRect = null;
    this.zoom = 'fit';
    this.lastMissing = 0;
    this.suspended = false;
    this._initAudio();
    this._loop = this._loop.bind(this);
  }

  _initAudio() {
    const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.splitter = ctx.createChannelSplitter(2);
    this.anL = ctx.createAnalyser();
    this.anR = ctx.createAnalyser();
    this.anL.fftSize = 1024;
    this.anR.fftSize = 1024;
    this.master.connect(this.splitter);
    this.splitter.connect(this.anL, 0);
    this.splitter.connect(this.anR, 1);
    this.master.connect(ctx.destination);
    this.trackBuses = [];
    this._meterBuf = new Float32Array(1024);
  }

  _bus(i) {
    while (this.trackBuses.length <= i) {
      const g = this.ctx.createGain();
      const an = this.ctx.createAnalyser();
      an.fftSize = 512;
      g.connect(this.master);
      g.connect(an);
      this.trackBuses.push({ g, an });
    }
    return this.trackBuses[i];
  }

  get seq() { return store.seq; }

  fps() { return this.seq ? this.seq.fps : 30; }

  setFrame(f, { render = true } = {}) {
    const seq = this.seq;
    if (!seq) return;
    f = Math.max(0, Math.round(f));
    this.previewFrame = null;
    this.frame = f;
    seq.playhead = f;
    if (this.playing) {
      this.startFrame = f;
      this.startTime = performance.now();
    }
    if (render) this.requestRender();
    this.emit('frame', f);
  }

  get currentFrame() { return Math.floor(this.frame); }

  // Kırpma önizlemesi: oynatma kafasını taşımadan monitörde başka bir kareyi göster (null = kapat)
  showPreviewFrame(f) {
    this.previewFrame = f == null ? null : Math.max(0, Math.round(f));
    this.requestRender();
  }

  play(rate = 1, opts = {}) {
    this.previewFrame = null;
    const seq = this.seq;
    if (!seq) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const dur = sequenceDuration(seq);
    if (!opts.range && rate > 0 && this.currentFrame >= dur - 1 && dur > 0) this.frame = 0;
    this.rate = rate;
    this.loopRange = opts.range || null;
    if (opts.range && (this.frame < opts.range[0] || this.frame >= opts.range[1])) this.frame = opts.range[0];
    this.startFrame = this.frame;
    this.startTime = performance.now();
    for (const h of this.handles.values()) h.pending = null;
    this.playing = true;
    this.emit('state', true);
    this._kick();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.rate = 1;
    this.frame = Math.floor(this.frame);
    if (this.seq) this.seq.playhead = this.frame;
    for (const h of this.handles.values()) {
      if (!h.el.paused) h.el.pause();
    }
    this.emit('state', false);
    this.emit('frame', this.frame);
    this.requestRender();
  }

  toggle() {
    if (this.playing) this.pause(); else this.play(1);
  }

  // J/K/L shuttle
  shuttle(dir) {
    if (dir === 0) { this.pause(); return; }
    const steps = [1, 2, 4, 8];
    if (!this.playing) { this.play(dir); return; }
    const cur = this.rate;
    if (Math.sign(cur) !== dir) { this.play(dir); return; }
    const i = steps.indexOf(Math.abs(cur));
    const next = steps[Math.min(steps.length - 1, i + 1)] * dir;
    this.play(next);
  }

  requestRender() {
    if (this._renderQueued) return;
    this._renderQueued = true;
    this._kick();
  }

  _kick() {
    if (this._raf == null) this._raf = requestAnimationFrame(this._loop);
  }

  _loop() {
    this._raf = null;
    if (this.suspended) return;
    const seq = this.seq;
    if (!seq) { this._renderQueued = false; this._clearView(); return; }
    if (this.playing) {
      const now = performance.now();
      let f = this.startFrame + ((now - this.startTime) / 1000) * seq.fps * this.rate;
      const dur = sequenceDuration(seq);
      const range = this.loopRange;
      const end = range ? range[1] : dur;
      if (this.rate > 0 && f >= end) {
        if (store.ui.loop || range) {
          const st = range ? range[0] : 0;
          if (store.ui.loop) { this.startFrame = st; this.startTime = now; f = st; }
          else { f = end - 1; this.frame = f; this.pause(); }
        } else {
          f = Math.max(0, end - 1);
          this.frame = f;
          this.pause();
        }
      } else if (this.rate < 0 && f <= 0) {
        f = 0;
        this.frame = 0;
        this.pause();
      }
      if (this.playing) {
        this.frame = f;
        seq.playhead = Math.floor(f);
        this.emit('frame', Math.floor(f));
      }
    }
    // oynatırken ekran yenilemesi (ör. 144 Hz) sekans karesinden hızlıysa: kare değişmediyse ve yeni video karesi yoksa çizme
    const fi = Math.floor(this.previewFrame ?? this.frame);
    if (this.playing && !this._renderQueued && fi === this._lastFi && !this._vfDirty) { this._kick(); return; }
    this._renderQueued = false;
    this._vfDirty = false;
    this._lastFi = fi;
    try {
      this._renderNow();
    } catch (e) {
      console.error('render error', e);
    }
    if (this.playing) this._kick();
  }

  _clearView() {
    this.comp.result = null;
    const gl = this.comp.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.comp.canvas.width, this.comp.canvas.height);
    gl.clearColor(0.04, 0.04, 0.04, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  renderScale() {
    const seq = this.seq;
    const r = store.ui.playbackRes;
    if (r === 'full') return 1;
    if (r === 'half') return 0.5;
    if (r === 'quarter') return 0.25;
    // auto: ekran boyutuna göre
    const dpr = window.devicePixelRatio || 1;
    const k = Math.min(1, Math.max((this.viewSize.w * dpr) / seq.width, (this.viewSize.h * dpr) / seq.height));
    return Math.max(0.2, k);
  }

  _renderNow() {
    const seq = this.seq;
    const project = store.project;
    const f = Math.floor(this.previewFrame ?? this.frame);
    let layers = videoLayersAt(project, seq, f);
    // önizleme render'ı: bu aralık önceden işlendiyse tek katman olarak o dosyayı göster
    const rc = !store.ui.compare && !store.ui.multicamView && !store.ui.ignoreRenders ? renderAt(seq, f) : null;
    if (rc) layers = [{ type: 'clip', track: 0, item: { clip: rc.clip, media: rc.media, local: f - rc.clip.start, srcTime: (f - rc.clip.start) / rc.r.fps, ownerSeq: seq, f } }];
    // multicam görünümü: açı ızgarası + program
    this.multicam = null;
    if (store.ui.multicamView) {
      const g = multicamGridLayers(project, seq, f);
      if (g) { layers = g.layers; this.multicam = g; }
    }
    const items = flattenMediaItems(project, itemsOfLayers(layers));
    const used = new Set();
    const realtime = this.playing && this.rate > 0 && this.rate <= 4;
    // video
    for (const it of items) {
      if (it.clip.kind !== 'media' || !it.media) continue;
      if (it.media.type === 'image') { loadImage(it.media.id); continue; }
      const h = this._handle(it.clip, it.media, 'video');
      if (!h) continue;
      used.add(h.key);
      h.last = performance.now();
      if (realtime && !it.clip.reverse) this._syncPlaying(h, it.srcTime, clipRateAt(it.clip, it.local) * (it.rateMul || 1) * this.rate);
      else this._seekTo(h, it.srcTime + 0.5 / (it.media.fps || 30));
    }
    // ileriye hazırlık: yakında başlayacak klipler
    if (this.playing && this.rate > 0) {
      const ahead = Math.round(seq.fps * 1.5);
      for (const id in seq.clips) {
        const c = seq.clips[id];
        if (!c.enabled || c.kind !== 'media') continue;
        const sp = clipSpan(seq, c);
        if (sp.from > f && sp.from <= f + ahead) {
          const m = project.media[c.mediaId];
          if (!m || m.type === 'image') continue;
          const kind = c.type === 'video' ? 'video' : 'audio';
          const h = this._handle(c, m, kind);
          if (!h) continue;
          used.add(h.key);
          h.last = performance.now();
          const st = sourceTimeAt(c, sp.from, seq.fps);
          if (!h.el.paused) h.el.pause();
          if (Math.abs(h.el.currentTime - st) > 0.1 && !h.seeking) this._seekTo(h, Math.max(0, st));
        }
      }
    }
    // ses
    const states = audioStatesAt(project, seq, this.frame);
    for (const s of states) {
      if (!s.media) continue;
      const h = this._handle(s.clip, s.media, 'audio');
      if (!h) continue;
      used.add(h.key);
      h.last = performance.now();
      const bus = this._bus(s.clip.track);
      if (h.busIndex !== s.clip.track) {
        try { h.pan.disconnect(); } catch (e) { /* */ }
        h.pan.connect(bus.g);
        h.busIndex = s.clip.track;
      }
      this._applyFx(h, s.clip);
      const tgain = realtime ? s.gain : 0;
      h.gain.gain.setTargetAtTime(tgain, this.ctx.currentTime, 0.012);
      h.pan.pan.setTargetAtTime(s.pan, this.ctx.currentTime, 0.02);
      if (realtime && !s.clip.reverse) this._syncPlaying(h, s.srcTime, (s.rate ?? s.clip.speed) * (s.rateMul || 1) * this.rate, 0.12);
      else if (!h.el.paused) h.el.pause();
    }
    // kullanılmayanları durdur
    for (const h of this.handles.values()) {
      if (!used.has(h.key)) {
        if (!h.el.paused) h.el.pause();
        if (h.gain) h.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
      }
    }
    this._gc(used);
    const ropts = { scale: this.renderScale(), time: f / seq.fps, project };
    const compare = !!store.ui.compare;
    if (compare) {
      // önce: efektler kapalı
      this.comp.bypassFx = true;
      this.comp.renderFrame(seq, layers, (it) => this._source(it), ropts);
      this.comp.bypassFx = false;
      this.comp.captureCompare();
    }
    const res = this.comp.renderFrame(seq, layers, (it) => this._source(it), ropts);
    this.lastMissing = res ? res.missing : 0;
    const dpr = window.devicePixelRatio || 1;
    const vw = Math.max(2, Math.round(this.viewSize.w * dpr)), vh = Math.max(2, Math.round(this.viewSize.h * dpr));
    const rect = this.comp.present(vw, vh, this.zoom === 'fit' ? 'fit' : this.zoom * dpr, compare);
    if (rect) this.displayRect = { x: rect.x / dpr, y: rect.y / dpr, w: rect.w / dpr, h: rect.h / dpr };
    this._meters();
    this.emit('rendered', { frame: f, missing: this.lastMissing });
    // bekleyen seek'ler bittiğinde tekrar çiz
  }

  _source(it) {
    const m = it.media;
    if (!m) return null;
    if (m.type === 'image') {
      const r = rt(m.id);
      if (!r.image || !r.imageReady) return null;
      return { type: 'element', el: r.image, w: r.image.naturalWidth, h: r.image.naturalHeight, nativeW: m.width || r.image.naturalWidth, nativeH: m.height || r.image.naturalHeight, stable: true, version: 1, key: 'img:' + m.id };
    }
    const h = this.handles.get(it.clip.id + ':video');
    if (!h || h.el.readyState < 2 || !h.el.videoWidth) return h && h.lastOk ? h.lastOk : null;
    // Oynatırken her karede yükle; duraklatılmışken yalnızca yeni kare geldiğinde (seeked)
    if (this.playing && !h.el.paused && !h.rvfc) h.ver = (h.ver || 0) + 1;
    const src = {
      type: 'element', el: h.el, w: h.el.videoWidth, h: h.el.videoHeight,
      nativeW: m.width || h.el.videoWidth, nativeH: m.height || h.el.videoHeight,
      key: it.clip.id, stable: true, version: h.ver || 0,
    };
    h.lastOk = src;
    return src;
  }

  _handle(clip, media, kind) {
    const key = clip.id + ':' + kind;
    let url = playbackUrl(media, kind);
    // çevrimdışı ses efektleri (gürültü azaltma vb.): işlenmiş dosya hazırsa onu çal
    if (kind === 'audio' && url) {
      if (needsNoiseFloor(clip)) ensureNoiseFloor(clip.id).then(() => this.requestRender());
      const off = audioFxFilters(clip.effects, 'offline');
      if (off.length) url = processedAudioUrl(media, off, () => this.refreshHandles()) || url;
    }
    let h = this.handles.get(key);
    if (h && h.url !== url) { this._dispose(h); h = null; }
    if (!url) return null;
    if (h) return h;
    const el = document.createElement(kind === 'video' ? 'video' : 'audio');
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.playsInline = true;
    el.disableRemotePlayback = true;
    if (kind === 'video') el.muted = true;
    el.preservesPitch = true;
    h = { key, el, kind, url, seeking: false, pending: null, last: performance.now(), clipId: clip.id };
    h.ver = 0;
    el.addEventListener('seeked', () => {
      h.seeking = false;
      h.ver++;
      if (h.pending != null) {
        const p = h.pending;
        h.pending = null;
        this._seekTo(h, p);
      } else this.requestRender();
    });
    el.addEventListener('loadeddata', () => { h.ver++; this.requestRender(); });
    // oynatırken yalnız gerçekten yeni bir video karesi geldiğinde dokuyu güncelle ve yeniden çiz
    if (kind === 'video' && el.requestVideoFrameCallback) {
      h.rvfc = true;
      const onFrame = () => {
        if (this.handles.get(key) !== h) return;
        h.ver++;
        this._vfDirty = true;
        el.requestVideoFrameCallback(onFrame);
      };
      el.requestVideoFrameCallback(onFrame);
    }
    el.addEventListener('error', () => { h.error = true; });
    if (kind === 'audio') {
      try {
        h.srcNode = this.ctx.createMediaElementSource(el);
        h.gain = this.ctx.createGain();
        h.gain.gain.value = 0;
        h.pan = this.ctx.createStereoPanner();
        h.srcNode.connect(h.gain);
        h.gain.connect(h.pan);
        h.busIndex = -1;
      } catch (e) {
        console.warn('audio graph', e);
      }
    }
    el.src = url;
    this.handles.set(key, h);
    return h;
  }

  // Ses efektleri: srcNode -> [efekt düğümleri] -> gain -> pan. Ayarlar değişince zinciri yeniden kur.
  _applyFx(h, clip) {
    if (!h.srcNode) return;
    const fx = (clip.effects || []).filter((e) => e.enabled && AUDIO_EFFECTS[e.type] && !AUDIO_EFFECTS[e.type].offline);
    const sig = JSON.stringify(fx.map((e) => [e.type, Object.entries(e.params).map(([k, p]) => [k, p.v])]));
    if (sig === h.fxSig) return;
    h.fxSig = sig;
    try { h.srcNode.disconnect(); } catch (e) { /* */ }
    for (const n of h.fxNodes || []) { try { n.disconnect(); } catch (e) { /* */ } }
    h.fxNodes = [];
    let cur = h.srcNode;
    const ctx = this.ctx;
    const keep = (n) => { h.fxNodes.push(n); return n; };
    const val = (e, k) => {
      const p = e.params[k];
      return p ? Number(p.v) : AUDIO_EFFECTS[e.type].params.find((x) => x.key === k).default;
    };
    for (const e of fx) {
      switch (e.type) {
        case 'gain': {
          const g = keep(ctx.createGain()); g.gain.value = dbToGain(val(e, 'gainDb'));
          cur.connect(g); cur = g; break;
        }
        case 'compressor': {
          const c = keep(ctx.createDynamicsCompressor());
          c.threshold.value = val(e, 'threshold'); c.ratio.value = val(e, 'ratio'); c.knee.value = 2;
          c.attack.value = val(e, 'attack') / 1000; c.release.value = val(e, 'release') / 1000;
          const mk = keep(ctx.createGain()); mk.gain.value = dbToGain(val(e, 'makeup'));
          cur.connect(c); c.connect(mk); cur = mk; break;
        }
        case 'eq': {
          const lo = keep(ctx.createBiquadFilter()); lo.type = 'lowshelf'; lo.frequency.value = val(e, 'lowFreq'); lo.gain.value = val(e, 'lowGain');
          const mid = keep(ctx.createBiquadFilter()); mid.type = 'peaking'; mid.frequency.value = val(e, 'midFreq'); mid.Q.value = val(e, 'midQ'); mid.gain.value = val(e, 'midGain');
          const hi = keep(ctx.createBiquadFilter()); hi.type = 'highshelf'; hi.frequency.value = val(e, 'highFreq'); hi.gain.value = val(e, 'highGain');
          cur.connect(lo); lo.connect(mid); mid.connect(hi); cur = hi; break;
        }
        case 'highpass':
        case 'lowpass': {
          const b = keep(ctx.createBiquadFilter()); b.type = e.type; b.frequency.value = val(e, 'freq'); b.Q.value = -3.0103; // Butterworth (Q dB cinsinden)
          cur.connect(b); cur = b; break;
        }
        case 'delay': {
          const out = keep(ctx.createGain());
          const d = keep(ctx.createDelay(2.5)); d.delayTime.value = val(e, 'delayMs') / 1000;
          const fb = keep(ctx.createGain()); fb.gain.value = val(e, 'feedback') / 100;
          const wet = keep(ctx.createGain()); wet.gain.value = val(e, 'mix') / 100;
          cur.connect(out); cur.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(out);
          cur = out; break;
        }
        case 'reverb': {
          const out = keep(ctx.createGain());
          cur.connect(out);
          for (const [ms, g] of reverbTaps(val(e, 'roomSize'), val(e, 'decay'), val(e, 'mix'))) {
            const d = keep(ctx.createDelay(2)); d.delayTime.value = ms / 1000;
            const gn = keep(ctx.createGain()); gn.gain.value = g;
            cur.connect(d); d.connect(gn); gn.connect(out);
          }
          cur = out; break;
        }
        case 'dehum': {
          for (const f of humFreqs(e)) {
            const b = keep(ctx.createBiquadFilter()); b.type = 'notch'; b.frequency.value = f; b.Q.value = 30;
            cur.connect(b); cur = b;
          }
          break;
        }
        case 'channel': {
          const up = keep(ctx.createGain()); up.channelCount = 2; up.channelCountMode = 'explicit'; up.channelInterpretation = 'speakers';
          const sp = keep(ctx.createChannelSplitter(2));
          const mg = keep(ctx.createChannelMerger(2));
          cur.connect(up); up.connect(sp);
          const m = val(e, 'mode');
          if (m === 0) { sp.connect(mg, 1, 0); sp.connect(mg, 1, 1); }
          else if (m === 1) { sp.connect(mg, 0, 0); sp.connect(mg, 0, 1); }
          else if (m === 2) { sp.connect(mg, 1, 0); sp.connect(mg, 0, 1); }
          else {
            const a = keep(ctx.createGain()); a.gain.value = 0.5;
            const b = keep(ctx.createGain()); b.gain.value = 0.5;
            sp.connect(a, 0); sp.connect(b, 1);
            a.connect(mg, 0, 0); a.connect(mg, 0, 1); b.connect(mg, 0, 0); b.connect(mg, 0, 1);
          }
          cur = mg; break;
        }
      }
    }
    cur.connect(h.gain);
  }

  _dispose(h) {
    try { h.el.pause(); } catch (e) { /* */ }
    try { h.srcNode && h.srcNode.disconnect(); h.gain && h.gain.disconnect(); h.pan && h.pan.disconnect(); for (const n of h.fxNodes || []) n.disconnect(); } catch (e) { /* */ }
    h.el.removeAttribute('src');
    try { h.el.load(); } catch (e) { /* */ }
    this.handles.delete(h.key);
    if (h.kind === 'video') this.comp.releaseKey(h.clipId);
  }

  _gc(used) {
    const now = performance.now();
    if (this.handles.size <= MAX_HANDLES) {
      for (const h of [...this.handles.values()]) if (!used.has(h.key) && now - h.last > 15000) this._dispose(h);
      return;
    }
    const list = [...this.handles.values()].filter((h) => !used.has(h.key)).sort((a, b) => a.last - b.last);
    while (this.handles.size > MAX_HANDLES && list.length) this._dispose(list.shift());
  }

  disposeAll() {
    for (const h of [...this.handles.values()]) this._dispose(h);
  }

  // Klip silindiğinde veya proxy değiştiğinde
  refreshHandles() {
    const seq = this.seq;
    for (const h of [...this.handles.values()]) {
      if (!seq || !seq.clips[h.clipId]) this._dispose(h);
    }
    this.requestRender();
  }

  _syncPlaying(h, t, rate, tol = 0.2) {
    const el = h.el;
    if (rate < 0.0625) { if (!el.paused) el.pause(); return; } // dondurulmuş kare (hız rampası %0)
    const r = Math.min(16, rate);
    if (Math.abs(el.playbackRate - r) > 1e-3) el.playbackRate = r;
    if (el.paused) {
      if (!h.seeking && Math.abs(el.currentTime - t) > 0.04) { h.seeking = true; el.currentTime = t; }
      const p = el.play();
      if (p) p.catch(() => { /* */ });
      return;
    }
    const drift = el.currentTime - t;
    if (Math.abs(drift) > tol && !h.seeking) {
      h.seeking = true;
      el.currentTime = t + 0.03 * r;
    }
  }

  _seekTo(h, t) {
    const el = h.el;
    if (!el.paused) el.pause();
    if (!isFinite(t)) return;
    if (h.seeking) { h.pending = t; return; }
    if (Math.abs(el.currentTime - t) < 0.002 && el.readyState >= 2) return;
    h.seeking = true;
    try { el.currentTime = t; } catch (e) { h.seeking = false; }
  }

  _meters() {
    const buf = this._meterBuf;
    const peak = (an) => {
      const n = an.fftSize;
      const b = n === buf.length ? buf : new Float32Array(n);
      an.getFloatTimeDomainData(b);
      let p = 0;
      for (let i = 0; i < n; i++) { const v = Math.abs(b[i]); if (v > p) p = v; }
      return p;
    };
    const l = this.playing ? peak(this.anL) : 0;
    const r = this.playing ? peak(this.anR) : 0;
    const tracks = this.trackBuses.map((b) => (this.playing ? peak(b.an) : 0));
    this.emit('meters', { l, r, tracks });
  }

  // Ekran koordinatı -> sekans koordinatı
  viewToSeq(x, y) {
    const seq = this.seq;
    const r = this.displayRect;
    if (!seq || !r) return null;
    return [((x - r.x) / r.w) * seq.width, ((y - r.y) / r.h) * seq.height];
  }
  seqToView(x, y) {
    const seq = this.seq;
    const r = this.displayRect;
    if (!seq || !r) return null;
    return [r.x + (x / seq.width) * r.w, r.y + (y / seq.height) * r.h];
  }
}
