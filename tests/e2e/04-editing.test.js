// Kurgu araçları: sahne algılama, hız eğrisi, çok kamera senkronu
const SD = await import('./js/sceneDetect.js');
const cuts = await SD.detectScenes(MEDIA + 'scenes.mp4', 0, 6, 0.3);
check('scene detection finds the 3 cuts', cuts.length === 3 && [1.5, 3, 4.5].every((t, i) => Math.abs(cuts[i] - t) < 0.1), cuts);

await U.IO.newProject();
const [camA, camB, scn] = await U.importFiles([MEDIA + 'camA.mp4', MEDIA + 'camB.mp4', MEDIA + 'scenes.mp4']);
await sleep(1200);
U.app.commands.newSequenceFromMedia(scn);
const vid = place(scn, 0, { outS: 6 })[0];
const SC = await import('./js/speedCurves.js');
const before = S().clips[vid].duration;
SC.applySpeedCurve([vid], 'hero');
check('speed curve (Hero) adds time-remap keyframes', (S().clips[vid].props.timeRemap.kf || []).length >= 5, S().clips[vid].props.timeRemap.kf?.length);
U.store.undo();
U.store.commit('sp', (p) => { U.E.setSpeed(p.sequences[p.activeSequenceId], p, [vid], 50, {}); });
check('50% speed doubles duration', Math.abs(S().clips[vid].duration - before * 2) <= 1, [before, S().clips[vid].duration]);

const MC = await import('./js/multicam.js');
const srcId = await MC.createMulticam([U.store.project.media[camA.id], U.store.project.media[camB.id]], { name: 'MC', sync: 'audio', audio: 'follow', edit: false });
const src = U.store.project.sequences[srcId];
check('multicam source sequence created', !!src);
const vstarts = src ? Object.values(src.clips).filter((c) => c.type === 'video').map((c) => c.start) : [];
const gap = vstarts.length === 2 ? Math.abs(vstarts[0] - vstarts[1]) : -1;
check('audio sync offset ≈ 1.5 s (45 frames)', Math.abs(gap - 45) <= 3, vstarts);
