// Konuşmayı Netleştir: gürültülü konuşma (Windows sesi + gürültü) → efekt → dışa aktarma; sessizlikte gürültü düşmeli, konuşma korunmalı
const T = await import('./js/tts.js');
const D = await import('./js/effectsDef.js');
check('speech noise model is available', !!U.app.paths.rnnoise, U.app.paths.rnnoise);
const vs = await T.listVoices();
const tr = vs.find((v) => /tr/i.test(v.lang));
await T.synthesize('Merhaba, bu bir ses testi. Arkada rüzgâr ve uğultu var. Konuşma net duyulmalı.', tr.id, 0, OUT + 've_clean_raw.wav');
const ffr = (args) => cp.spawnSync(ff.ffmpeg, ['-hide_banner', '-v', 'error', '-y', ...args]);
ffr(['-i', OUT + 've_clean_raw.wav', '-ar', '48000', '-ac', '1', OUT + 've_clean.wav']);
ffr(['-i', OUT + 've_clean.wav', '-f', 'lavfi', '-i', 'anoisesrc=c=pink:r=48000:a=0.06:d=30', '-f', 'lavfi', '-i', 'anoisesrc=c=brown:r=48000:a=0.25:d=30', '-f', 'lavfi', '-i', 'sine=f=50:r=48000:d=30',
  '-filter_complex', '[2]lowpass=f=300[w];[3]volume=0.05[h];[0][1][w][h]amix=inputs=4:duration=first:normalize=0[a]', '-map', '[a]', '-ac', '1', '-ar', '48000', OUT + 've_noisy.wav']);
await U.IO.newProject();
const [cam, noisy] = await U.importFiles([MEDIA + 'camA.mp4', OUT + 've_noisy.wav']);
await sleep(900);
U.app.commands.newSequenceFromMedia(cam);
const [a] = place(noisy, 0, { v: null, a: 0, outS: noisy.duration });
const dur = Math.round(noisy.duration * S().fps);
const exp = async (file) => { await U.exportSequence(S(), { format: 'wav', file, audio: true, sampleRate: 48000, range: [0, dur] }, { signal: new AbortController().signal }); };
await exp(OUT + 've_before.wav');
U.store.commit('fx', (p) => { p.sequences[p.activeSequenceId].clips[a].effects.push(U.createEffect('voiceEnhance')); });
const filters = D.audioFxFilters(S().clips[a].effects, 'offline');
check('filter chain uses the neural model', filters.some((f) => f.startsWith('arnndn=m=')), filters.join(','));
await exp(OUT + 've_after.wav');
// ölçüm: temiz kayıttaki sessiz / konuşmalı 20 ms pencereler
const rd = (f) => { const b = fs.readFileSync(f); let o = 12; while (o < b.length - 8) { const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4); if (id === 'data') { const ch = b.readUInt16LE(22) || 1; const n = Math.floor(Math.min(sz, b.length - o - 8) / 2 / ch); const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = b.readInt16LE(o + 8 + i * 2 * ch) / 32768; return x; } o += 8 + sz + (sz & 1); } };
const c = rd(OUT + 've_clean.wav'), b0 = rd(OUT + 've_before.wav'), b1 = rd(OUT + 've_after.wav');
const F = 960, P = [], Sp = [];
const rms = (x, i) => { let s = 0; for (let j = i; j < i + F; j++) s += (x[j] || 0) ** 2; return 10 * Math.log10(s / F + 1e-12); };
for (let i = 0; i + F < c.length; i += F) { const r = rms(c, i); if (r < -55) P.push(i); else if (r > -30) Sp.push(i); }
const avg = (x, idx) => { let s = 0; for (const i of idx) { let e = 0; for (let j = i; j < i + F; j++) e += (x[j] || 0) ** 2; s += e / F; } return 10 * Math.log10(s / idx.length); };
const nBefore = avg(b0, P), nAfter = avg(b1, P), sBefore = avg(b0, Sp), sAfter = avg(b1, Sp);
check('noise in pauses drops by more than 15 dB', nBefore - nAfter > 15, { before: +nBefore.toFixed(1), after: +nAfter.toFixed(1), pauseFrames: P.length });
check('speech level is kept (within 4 dB)', Math.abs(sAfter - sBefore) < 4, { before: +sBefore.toFixed(1), after: +sAfter.toFixed(1) });
