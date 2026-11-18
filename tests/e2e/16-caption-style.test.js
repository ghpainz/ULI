// Altyazı görünümü: monitörde sürükleyerek konum, panelde hızlı yerleşim ve vurgu rengi, yeni projede hatırlama
const CP = await import('./js/captions.js');
const TX = await import('./js/text.js');
const ST = await import('./js/settings.js');
await U.IO.newProject();
const [cam] = await U.importFiles([MEDIA + 'camA.mp4']);
await sleep(800);
U.app.commands.newSequenceFromMedia(cam);
place(cam, 0, { outS: 6 });
U.store.commit('cap', (p) => { const s = p.sequences[p.activeSequenceId]; CP.ensureCaptions(s); const c = CP.addCaption(s, 0, 'MERHABA'); c.end = 150; s.captionStyle = { ...CP.DEFAULT_CAPTION_STYLE, size: 220, color: '#ffffff', bgEnabled: false, outline: 3 }; });
U.app.engine.setFrame(30); U.app.engine.requestRender(); await sleep(600);
// altyazının ekrandaki yeri → fareyle sola-yukarı sürükle
const s = S(), cap = s.captions[0];
const box = CP.captionBox(s, cap, 30, (txt) => { const cv = TX.renderTextCanvas(txt); return { w: cv.width, h: cv.height }; });
const vr = U.app.program.view.getBoundingClientRect();
const [ax, ay] = U.app.engine.seqToView((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
const [bx, by] = U.app.engine.seqToView(s.width * 0.25, s.height * 0.3);
const X0 = Math.round(vr.left + ax), Y0 = Math.round(vr.top + ay), X1 = Math.round(vr.left + bx), Y1 = Math.round(vr.top + by);
const evs = [{ type: 'mouseMove', x: X0, y: Y0 }, { type: 'mouseDown', x: X0, y: Y0, button: 'left', clickCount: 1 }];
for (let i = 1; i <= 12; i++) evs.push({ type: 'mouseMove', x: Math.round(X0 + (X1 - X0) * i / 12), y: Math.round(Y0 + (Y1 - Y0) * i / 12), button: 'left' });
evs.push({ type: 'mouseUp', x: X1, y: Y1, button: 'left', clickCount: 1 });
await ipc.invoke('test:input', evs);
await sleep(400);
const st = S().captionStyle;
check('dragging the caption on the Program monitor moves it', st.x < 40 && st.margin > 50, { x: st.x, margin: st.margin });
await U.exportFrame(S(), 30, OUT + 'capdrag.png');
const px = await pixels(OUT + 'capdrag.png', 320, 180);
let sx = 0, sy = 0, n = 0;
for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) { const i = (y * 320 + x) * 4; if (px[i] > 220 && px[i + 1] > 220 && px[i + 2] > 220) { sx += x; sy += y; n++; } }
check('exported frame shows the caption at the new place', n > 20 && sx / n < 140 && sy / n < 110, { cx: Math.round(sx / Math.max(1, n)), cy: Math.round(sy / Math.max(1, n)), n });
check('style panel opened when the caption was clicked', U.app.captionsPanel?.showStyle === true && /Word Highlight|Kelime Vurgusu/.test(U.app.captionsPanel.styleBox.textContent));
// panel: hızlı yerleşim ve vurgu rengi kutucuğu
const box2 = U.app.captionsPanel.styleBox;
[...box2.querySelectorAll('button')].find((b) => /^(Bottom|Alt)$/.test(b.textContent.trim()))?.click();
await sleep(150);
[...U.app.captionsPanel.styleBox.querySelectorAll('button')].find((b) => b.title === '#ff2d55')?.click();
await sleep(150);
check('quick place "Bottom" and pink highlight swatch work', S().captionStyle.margin === 7 && S().captionStyle.hlColor === '#ff2d55', { margin: S().captionStyle.margin, hl: S().captionStyle.hlColor });
// yeni sekans son seçilen stille başlar
check('style is remembered as default', ST.settings.captionStyleDefault && ST.settings.captionStyleDefault.hlColor === '#ff2d55');
U.app.commands.newSequenceFromMedia(cam);
U.store.commit('c2', (p) => { CP.ensureCaptions(p.sequences[p.activeSequenceId]); });
check('a new sequence starts with the remembered style', S().captionStyle.hlColor === '#ff2d55' && S().captionStyle.size === 220, S().captionStyle);
