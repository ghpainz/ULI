// Ses: ses efekti sentezi, ritim algılama, ses dışa aktarımı
const SFX = await import('./js/sfx.js');
const ids = SFX.SFX.map((x) => x[0]);
let silent = [];
for (const id of ids) { const buf = await SFX.renderSfx(id); const d = buf.getChannelData(0); let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); if (m < 0.01) silent.push(id); }
check(`all ${ids.length} sound effects synthesize audible audio`, ids.length > 0 && silent.length === 0, silent.join(', '));
const B = await import('./js/beats.js');
const r = await B.detectBeats(MEDIA + 'clicks120.wav', 0, 20);
check('beat detection finds 120 BPM', Math.abs(r.bpm - 120) < 3, +r.bpm.toFixed(1));
const firstErr = r.beats.length ? Math.min(...r.beats.map((t) => Math.abs(((t - 0.13) % 0.5 + 0.5) % 0.5))) : 1;
check('beats line up with clicks', r.beats.length > 30 && firstErr < 0.05, { n: r.beats.length });

await U.IO.newProject();
const [tone] = await U.importFiles([MEDIA + 'tone440.wav']);
await sleep(800);
const [cam] = await U.importFiles([MEDIA + 'camA.mp4']);
await sleep(800);
U.app.commands.newSequenceFromMedia(cam);
const aid = place(tone, 0, { v: null, a: 0, outS: 3 })[0];
const wav = OUT + 'audio.wav';
const exp = async (file) => { try { fs.unlinkSync(file); } catch (e) { /* */ } await U.exportSequence(S(), { format: 'wav', file, audio: true, sampleRate: 48000, range: [0, 60] }, { signal: new AbortController().signal }); return volume(file); };
const v0 = await exp(wav);
check('audio export has signal', v0 != null && v0 > -30, v0);
U.store.commit('gain', (p) => { const c = p.sequences[p.activeSequenceId].clips[aid]; c.props.volume = { v: -12, kf: null }; });
const v1 = await exp(OUT + 'audio_quiet.wav');
check('clip volume -12 dB lowers the export', v1 != null && v0 - v1 > 8, { before: v0, after: v1 });
