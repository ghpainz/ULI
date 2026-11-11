// Ses efekti kütüphanesi: her ses OfflineAudioContext ile sentezlenir (dosya gerekmez),
// önbellek klasörüne WAV olarak yazılır ve projeye medya olarak eklenir.
import { nodeFs, nodePath, ensureDir } from './util.js';
import { ff } from './ffmpeg.js';

const SR = 48000;

// [id, ad, grup, süre (sn)]
export const SFX = [
  ['whoosh', 'Whoosh', 'Transitions', 0.9], ['swoosh', 'Swoosh (short)', 'Transitions', 0.45], ['riser', 'Riser', 'Transitions', 3], ['downlifter', 'Downlifter', 'Transitions', 2],
  ['impact', 'Boom / Impact', 'Impacts', 2.2], ['subdrop', 'Sub Drop', 'Impacts', 2], ['kick', 'Kick', 'Impacts', 0.5], ['clap', 'Clap', 'Impacts', 0.4],
  ['pop', 'Pop', 'UI', 0.2], ['click', 'Click', 'UI', 0.08], ['ding', 'Ding', 'UI', 1.6], ['notify', 'Notification', 'UI', 1.0],
  ['success', 'Success Chime', 'UI', 1.4], ['error', 'Error Buzz', 'UI', 0.55], ['coin', 'Coin', 'UI', 0.5], ['laser', 'Laser', 'UI', 0.5],
  ['glitch', 'Glitch', 'Texture', 0.7], ['static', 'Static', 'Texture', 1.2], ['shutter', 'Camera Shutter', 'Texture', 0.4], ['typing', 'Keyboard Typing', 'Texture', 2.2],
  ['heartbeat', 'Heartbeat', 'Texture', 1.7], ['ticktock', 'Clock Tick-Tock', 'Texture', 2.1],
];
export const SFX_GROUPS = ['Transitions', 'Impacts', 'UI', 'Texture'];

function noiseBuffer(ctx, dur) {
  const b = ctx.createBuffer(1, Math.ceil(dur * ctx.sampleRate), ctx.sampleRate);
  const d = b.getChannelData(0);
  let seed = 1234567;
  for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; }
  return b;
}

// Sesin grafını kur. ctx: OfflineAudioContext, out: hedef düğüm
function build(id, ctx, out, dur) {
  const t0 = 0.005;
  const env = (node, pts) => { const g = ctx.createGain(); g.gain.setValueAtTime(0, 0); for (const [t, v, exp] of pts) { if (exp) g.gain.exponentialRampToValueAtTime(Math.max(1e-4, v), t); else g.gain.linearRampToValueAtTime(v, t); } node.connect(g); return g; };
  const osc = (type, f0, f1, t1, start = 0, stop = dur) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, start); if (f1) o.frequency.exponentialRampToValueAtTime(f1, start + t1); o.start(start); o.stop(stop); return o; };
  const noise = (start = 0, stop = dur) => { const s = ctx.createBufferSource(); s.buffer = noiseBuffer(ctx, dur); s.start(start); s.stop(stop); return s; };
  const filt = (node, type, f, q = 1, f1, t1) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.setValueAtTime(f, 0); b.Q.value = q; if (f1) b.frequency.exponentialRampToValueAtTime(f1, t1); node.connect(b); return b; };
  const hit = (start, f, dec, type = 'sine', vol = 1, f1) => { const o = osc(type, f, f1, dec, start, start + dec + 0.05); const g = ctx.createGain(); g.gain.setValueAtTime(0, 0); g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(vol, start + 0.004); g.gain.exponentialRampToValueAtTime(1e-4, start + dec); o.connect(g); g.connect(out); };
  const nburst = (start, dec, f, q, vol = 1, type = 'bandpass') => { const n = noise(start, start + dec + 0.05); const b = filt(n, type, f, q); const g = ctx.createGain(); g.gain.setValueAtTime(0, 0); g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(vol, start + 0.002); g.gain.exponentialRampToValueAtTime(1e-4, start + dec); b.connect(g); g.connect(out); };
  switch (id) {
    case 'whoosh': case 'swoosh': {
      const n = noise();
      const b = filt(n, 'bandpass', 250, 1.2, 3500, dur * 0.55);
      b.frequency.exponentialRampToValueAtTime(500, dur);
      const g = env(b, [[t0, 0], [dur * 0.55, 1.6], [dur, 0.001, true]]);
      const p = ctx.createStereoPanner(); p.pan.setValueAtTime(-0.9, 0); p.pan.linearRampToValueAtTime(0.9, dur);
      g.connect(p); p.connect(out); break;
    }
    case 'riser': case 'downlifter': {
      const up = id === 'riser';
      const n = noise(); const b = filt(n, 'bandpass', up ? 200 : 6000, 2, up ? 7000 : 150, dur * 0.98);
      const s = osc('sawtooth', up ? 90 : 900, up ? 900 : 70, dur * 0.98);
      const sg = ctx.createGain(); sg.gain.value = 0.18; s.connect(sg);
      const m = ctx.createGain(); b.connect(m); sg.connect(m);
      env(m, up ? [[t0, 0], [dur * 0.97, 1.2], [dur, 0]] : [[t0, 1.2], [dur, 0.001, true]]).connect(out); break;
    }
    case 'impact': { hit(0, 70, 1.8, 'sine', 1.2, 32); nburst(0, 0.6, 400, 0.7, 0.9, 'lowpass'); hit(0, 140, 0.25, 'triangle', 0.5, 60); break; }
    case 'subdrop': hit(0, 90, 1.9, 'sine', 1.2, 28); break;
    case 'kick': hit(0, 160, 0.45, 'sine', 1.2, 45); nburst(0, 0.02, 3000, 1, 0.3); break;
    case 'clap': for (const t of [0, 0.012, 0.024]) nburst(t, t ? 0.03 : 0.3, 1200, 0.8, 0.9); break;
    case 'pop': hit(0, 700, 0.12, 'sine', 1, 140); break;
    case 'click': nburst(0, 0.03, 3500, 1.5, 1); break;
    case 'ding': hit(0, 1318.5, 1.5, 'sine', 0.8); hit(0, 2637, 0.8, 'sine', 0.25); hit(0, 3951, 0.4, 'sine', 0.1); break;
    case 'notify': hit(0, 880, 0.5, 'sine', 0.7); hit(0, 1760, 0.3, 'sine', 0.15); hit(0.13, 1318.5, 0.85, 'sine', 0.7); hit(0.13, 2637, 0.4, 'sine', 0.15); break;
    case 'success': [1046.5, 1318.5, 1568, 2093].forEach((f, i) => { hit(i * 0.09, f, 1.2 - i * 0.15, 'triangle', 0.45); hit(i * 0.09, f * 2, 0.4, 'sine', 0.1); }); break;
    case 'error': hit(0, 130, 0.2, 'square', 0.35); hit(0.25, 110, 0.28, 'square', 0.35); break;
    case 'coin': hit(0, 987.8, 0.09, 'square', 0.3); hit(0.08, 1318.5, 0.4, 'square', 0.3); break;
    case 'laser': hit(0, 1800, 0.45, 'square', 0.35, 180); break;
    case 'glitch': {
      let t = 0, k = 1;
      while (t < dur - 0.05) {
        const len = 0.02 + ((k * 37) % 7) * 0.012;
        if (k % 3) hit(t, 200 + ((k * 131) % 1800), len, k % 2 ? 'square' : 'sawtooth', 0.3);
        else nburst(t, len, 2500, 0.5, 0.6);
        t += len + ((k * 17) % 5) * 0.01; k++;
      }
      break;
    }
    case 'static': { const n = noise(); const b = filt(n, 'bandpass', 3000, 0.4); env(b, [[0.03, 0.5], [dur - 0.1, 0.5], [dur, 0]]).connect(out); for (let i = 0; i < 14; i++) nburst((i * 0.083) % (dur - 0.05), 0.01, 5000, 1, 0.8); break; }
    case 'shutter': nburst(0, 0.06, 2500, 1, 1); nburst(0.11, 0.08, 1800, 1, 0.8); break;
    case 'typing': { let t = 0.02, k = 0; while (t < dur - 0.1) { nburst(t, 0.035, 2200 + ((k * 431) % 1600), 2, 0.7); hit(t, 300 + ((k * 97) % 200), 0.03, 'triangle', 0.2); t += 0.07 + ((k * 53) % 9) * 0.012; k++; } break; }
    case 'heartbeat': for (const b of [0, 0.85]) { hit(b, 65, 0.22, 'sine', 1.1, 40); hit(b + 0.24, 58, 0.25, 'sine', 0.8, 38); } break;
    case 'ticktock': [0, 0.5, 1, 1.5].forEach((t, i) => { hit(t, i % 2 ? 950 : 1250, 0.06, 'sine', 0.8); nburst(t, 0.02, i % 2 ? 1800 : 2600, 3, 0.5); }); break;
  }
}

function toWav(buf) {
  const ch = buf.numberOfChannels, n = buf.length;
  const data = Buffer.alloc(44 + n * ch * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * ch * 2, 4); data.write('WAVE', 8); data.write('fmt ', 12);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(ch, 22); data.writeUInt32LE(buf.sampleRate, 24);
  data.writeUInt32LE(buf.sampleRate * ch * 2, 28); data.writeUInt16LE(ch * 2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(n * ch * 2, 40);
  const chans = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let peak = 0; for (const d of chans) for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  const k = peak > 0.89 ? 0.89 / peak : 1;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(chans[c][i] * k * 32767))), 44 + (i * ch + c) * 2);
  return data;
}

export async function renderSfx(id) {
  const it = SFX.find((x) => x[0] === id);
  if (!it) throw new Error('unknown sfx ' + id);
  const dur = it[3];
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
  const master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  build(id, ctx, master, dur);
  return ctx.startRendering();
}

// WAV dosyası yolu (yoksa üretilir)
export async function sfxFile(id) {
  const dir = ensureDir(nodePath.join(ff.cacheDir, 'sfx'));
  const file = nodePath.join(dir, 'uli_sfx_' + id + '.wav');
  if (!nodeFs.existsSync(file)) nodeFs.writeFileSync(file, toWav(await renderSfx(id)));
  return file;
}

// Önizleme çalma
let previewCtx = null, previewSrc = null;
export async function previewSfx(id) {
  const buf = await renderSfx(id);
  if (!previewCtx) previewCtx = new AudioContext();
  try { previewSrc?.stop(); } catch (e) { /* */ }
  previewSrc = previewCtx.createBufferSource();
  previewSrc.buffer = buf;
  previewSrc.connect(previewCtx.destination);
  previewSrc.start();
}
