// Temel akış: içe aktar → sekansa yerleştir → kes → geri al → kaydet/aç → dışa aktar
await U.IO.newProject();
const [cam] = await U.importFiles([MEDIA + 'camA.mp4']);
await sleep(1000);
check('import reads duration', cam && Math.abs(U.store.project.media[cam.id].duration - 10) < 0.2, U.store.project.media[cam.id]?.duration);
U.app.commands.newSequenceFromMedia(cam);
check('sequence matches media size', S().width === 320 && S().height === 180, [S().width, S().height]);
const ids = place(cam, 0, { v: 0, a: 0, outS: 6 });
const vid = ids[0];
check('clip placed (video + audio)', Object.keys(S().clips).length === 2, Object.keys(S().clips).length);
const d0 = S().clips[vid].duration;
U.store.commit('trim', (p) => { p.sequences[p.activeSequenceId].clips[vid].duration = 60; });
check('trim changes duration', S().clips[vid].duration === 60);
U.store.undo();
check('undo restores duration', S().clips[vid].duration === d0, S().clips[vid].duration);

const proj = OUT + 'core.ulip';
U.store.projectPath = proj;
check('save project', await U.IO.saveProject() && fs.existsSync(proj));
const loaded = U.IO.loadProjectFile(proj);
const ls = loaded.sequences[loaded.activeSequenceId];
check('reopened project keeps clips', Object.keys(ls.clips).length === 2 && Object.values(ls.clips).some((c) => c.duration === d0));

const mp4 = OUT + 'core.mp4';
try { fs.unlinkSync(mp4); } catch (e) { /* */ }
await U.exportSequence(S(), { format: 'mp4_h264', file: mp4, width: 320, height: 180, crf: 23, hw: false, preset: 'veryfast', audio: true, audioBitrate: 192, sampleRate: 48000, range: [0, 60] }, { signal: new AbortController().signal });
const pr = probe(mp4);
check('export H.264 with audio, 2 s', pr.video && pr.audio && Math.abs(pr.duration - 2) < 0.15, pr);
await U.exportFrame(S(), 30, OUT + 'core.png');
const px = await pixels(OUT + 'core.png');
check('exported frame shows the red clip', px[0] > 200 && px[1] < 60 && px[2] < 60, [px[0], px[1], px[2]]);
