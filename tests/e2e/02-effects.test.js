// Tüm efekt / geçiş shader'ları derleniyor mu, hazır ayarlar ve efektler görüntüyü değiştiriyor mu
const FX = await import('./js/fxPreview.js');
const bad = FX.compileAll();
check('all effect and transition shaders compile', bad.length === 0, bad.slice(0, 10).join(', '));
const P = await import('./js/presets.js');
check('preset library loaded', Object.keys(P.PRESETS).length >= 40, Object.keys(P.PRESETS).length);

await U.IO.newProject();
const [scn] = await U.importFiles([MEDIA + 'scenes.mp4']);
await sleep(1000);
U.app.commands.newSequenceFromMedia(scn);
const vid = place(scn, 0, { inS: 1.5, outS: 3 })[0];
await U.exportFrame(S(), 15, OUT + 'fx_off.png');
const a = await pixels(OUT + 'fx_off.png');
U.store.commit('fx', (p) => { p.sequences[p.activeSequenceId].clips[vid].effects.push(U.createEffect('gaussianBlur')); p.sequences[p.activeSequenceId].clips[vid].effects[0].params.blurriness.v = 40; });
await U.exportFrame(S(), 15, OUT + 'fx_blur.png');
const b = await pixels(OUT + 'fx_blur.png');
check('gaussian blur changes the exported frame', diff(a, b) > 2, +diff(a, b).toFixed(2));
U.store.commit('clr', (p) => { p.sequences[p.activeSequenceId].clips[vid].effects = []; });
const pid = Object.keys(P.PRESETS).find((k) => P.PRESETS[k].group === 'Black & White') || Object.keys(P.PRESETS)[0];
P.applyPreset([vid], pid);
check('preset adds effects', S().clips[vid].effects.length > 0, pid);
await U.exportFrame(S(), 15, OUT + 'fx_preset.png');
const c = await pixels(OUT + 'fx_preset.png');
check('preset changes the exported frame', diff(a, c) > 2, +diff(a, c).toFixed(2));
