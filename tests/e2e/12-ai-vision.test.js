// Yapay zekâ: arka plan silme (kişi maskesi) — çizimle üretilmiş bir "kişi" videosu; gerçek kişi görüntüsü kullanılmaz
const V = await import('./js/vision.js');
const drawPerson = (g, W, H, dx = 0) => {
  const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#6aa9d8'); gr.addColorStop(1, '#2f6b3a'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const k = H / 216, cx = W / 2 + dx;
  g.fillStyle = '#2a4a8a'; g.beginPath(); g.ellipse(cx, 230 * k, 95 * k, 80 * k, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e0ac69'; g.fillRect(cx - 15 * k, 120 * k, 30 * k, 30 * k);
  g.beginPath(); g.ellipse(cx, 95 * k, 42 * k, 52 * k, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3b2412'; g.beginPath(); g.ellipse(cx, 60 * k, 46 * k, 26 * k, 0, Math.PI, Math.PI * 2); g.fill();
  g.fillStyle = '#222'; g.beginPath(); g.arc(cx - 16 * k, 92 * k, 5 * k, 0, 7); g.arc(cx + 16 * k, 92 * k, 5 * k, 0, 7); g.fill();
  g.strokeStyle = '#8a3b2b'; g.lineWidth = 3 * k; g.beginPath(); g.arc(cx, 112 * k, 12 * k, 0.2, Math.PI - 0.2); g.stroke();
};
const c = document.createElement('canvas'); c.width = 640; c.height = 360; drawPerson(c.getContext('2d'), 640, 360);
fs.writeFileSync(OUT + 'person.png', Buffer.from(c.toDataURL('image/png').split(',')[1], 'base64'));
cp.spawnSync(ff.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-loop', '1', '-i', OUT + 'person.png', '-t', '2', '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', OUT + 'person.mp4']);
await U.IO.newProject();
const [person, red] = await U.importFiles([OUT + 'person.mp4', MEDIA + 'camA.mp4']);
await sleep(1000);
U.app.commands.newSequenceFromMedia(person);
const [bg] = place(red, 0, { v: 0, outS: 2 });
const [p] = place(person, 0, { v: 1, outS: 2 });
U.store.commit('fill', (pr) => { const q = pr.sequences[pr.activeSequenceId]; q.clips[bg].props.scale.v = 200; });
U.store.commit('fx', (pr) => { pr.sequences[pr.activeSequenceId].clips[p].effects.push(U.createEffect('bgRemove')); });
const t0 = performance.now();
await U.exportFrame(S(), 30, OUT + 'bgrm.png');
const ms = Math.round(performance.now() - t0);
const px = await pixels(OUT + 'bgrm.png', 64, 36);
const at = (x, y) => { const i = (y * 64 + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
const corner = at(4, 4), face = at(32, 18); // yanak (göz hizasının altı)
check('background removed: track below (red) shows in the corner', corner[0] > 180 && corner[1] < 70 && corner[2] < 70, { corner, ms });
// yüz bölgesinde (elips) cilt rengi kalan piksel oranı — tam çözünürlükte
const full = await pixels(OUT + 'bgrm.png', 640, 360);
let inside = 0, skin = 0;
for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) {
  const ex = (x - 320) / 70, ey = (y - 158) / 87;
  if (ex * ex + ey * ey > 0.8) continue;
  inside++;
  const i = (y * 640 + x) * 4;
  if (full[i] > 170 && full[i + 1] > 110 && full[i + 2] < 150) skin++;
}
// not: çizgi film "kişi" modelin eğitildiği gerçek fotoğraflar kadar iyi tanınmaz; yalnız kişinin korunduğunu (silinmediğini) doğrular
check('person kept: face area mostly stays (drawn test figure)', skin / inside > 0.4, +(skin / inside).toFixed(2));
// renk modu
U.store.commit('m', (pr) => { const fx = pr.sequences[pr.activeSequenceId].clips[p].effects[0]; fx.params.bgMode.v = 2; fx.params.bgColor.v = '#00ff00'; });
await U.exportFrame(S(), 30, OUT + 'bgrm_color.png');
const px2 = await pixels(OUT + 'bgrm_color.png', 64, 36);
const c2 = [px2[(4 * 64 + 4) * 4], px2[(4 * 64 + 4) * 4 + 1], px2[(4 * 64 + 4) * 4 + 2]];
check('color mode fills background with the chosen color', c2[1] > 200 && c2[0] < 60 && c2[2] < 60, c2);
// video dışa aktarma (her karede maske)
const mp4 = OUT + 'bgrm.mp4';
const t1 = performance.now();
await U.exportSequence(S(), { format: 'mp4_h264', file: mp4, width: 640, height: 360, crf: 23, hw: false, preset: 'veryfast', audio: false, sampleRate: 48000, range: [0, 60] }, { signal: new AbortController().signal });
const pr = probe(mp4);
check('2 s export with background removal', pr.video && Math.abs(pr.duration - 2) < 0.15, { ...pr, secs: +((performance.now() - t1) / 1000).toFixed(1) });
// yüz algılama
await V.ensureFaceDetector();
const faces = V.detectFaces(c);
check('face detector finds the face', faces.length >= 1 && Math.abs(faces[0].x + faces[0].w / 2 - 320) < 40, faces);
// Efektler panelinde görünüyor mu (Türkçe aramayla) ve hiçbir video efekti panelden kaybolmuş olmasın
U.app.commands.showPanel('effects'); await sleep(200);
const ep = U.app.effectsPanel;
ep.view = 'list'; ep.filter = 'arka'; ep.render(); await sleep(200);
check('Effects panel search "arka" finds Background Removal', /Arka Plan Silme|Background Removal/.test(ep.tree.innerText), ep.tree.innerText.slice(0, 120));
ep.filter = ''; ep.render(); await sleep(100);
const D = await import('./js/effectsDef.js');
const groups = D.effectGroups();
const orphans = Object.entries(D.EFFECTS).filter(([, d]) => d.category !== 'audio' && !groups.includes(d.group)).map(([k]) => k);
check('every video effect belongs to a group shown in the panel', orphans.length === 0, orphans);
