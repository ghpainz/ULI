// Otomatik dikey çevirme: soldan sağa yürüyen (çizim) kişi; 9:16 kopyada kadraj kişiyi takip etmeli
const R = await import('./js/reframe.js');
const K = await import('./js/keyframes.js');
const drawPerson = (g, W, H, cx) => {
  g.fillStyle = '#6aa9d8'; g.fillRect(0, 0, W, H);
  const k = H / 216;
  g.fillStyle = '#2a4a8a'; g.beginPath(); g.ellipse(cx, 230 * k, 95 * k, 80 * k, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e0ac69'; g.fillRect(cx - 15 * k, 120 * k, 30 * k, 30 * k);
  g.beginPath(); g.ellipse(cx, 95 * k, 42 * k, 52 * k, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3b2412'; g.beginPath(); g.ellipse(cx, 60 * k, 46 * k, 26 * k, 0, Math.PI, Math.PI * 2); g.fill();
  g.fillStyle = '#222'; g.beginPath(); g.arc(cx - 16 * k, 92 * k, 5 * k, 0, 7); g.arc(cx + 16 * k, 92 * k, 5 * k, 0, 7); g.fill();
  g.strokeStyle = '#8a3b2b'; g.lineWidth = 3 * k; g.beginPath(); g.arc(cx, 112 * k, 12 * k, 0.2, Math.PI - 0.2); g.stroke();
};
const dir = OUT + 'walk/';
fs.mkdirSync(dir, { recursive: true });
const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
for (let i = 0; i < 40; i++) {
  // ilk 1 sn solda durur, 2 sn yürür, son 1 sn sağda durur
  const u = Math.max(0, Math.min(1, (i / 10 - 1) / 2));
  drawPerson(c.getContext('2d'), 1280, 720, 1280 * (0.25 + 0.5 * u));
  fs.writeFileSync(dir + 'f' + String(i).padStart(3, '0') + '.png', Buffer.from(c.toDataURL('image/png').split(',')[1], 'base64'));
}
cp.spawnSync(ff.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-framerate', '10', '-i', dir + 'f%03d.png', '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', OUT + 'walk.mp4']);
await U.IO.newProject();
const [walk] = await U.importFiles([OUT + 'walk.mp4']);
await sleep(1000);
U.app.commands.newSequenceFromMedia(walk);
const [v] = place(walk, 0, { outS: 4 });
const origId = S().id;
const orig = JSON.stringify(S().clips);
const res = await R.autoReframe(origId, '9:16');
const s = U.store.project.sequences[res.sequenceId];
check('9:16 copy created (short side kept: 720×1280)', s && s.width === 720 && s.height === 1280, [s?.width, s?.height]);
check('original sequence unchanged', JSON.stringify(U.store.project.sequences[origId].clips) === orig);
const nc = Object.values(s.clips).find((x) => x.type === 'video');
const kf = nc.props.position.kf || [];
const posAt = (sec) => K.evalParam(nc.props.position, Math.round(sec * s.fps))[0];
const W = s.width;
check('frame follows the person: left at start, right at end', posAt(0.5) > W / 2 + 200 && posAt(3.7) < W / 2 - 200, { start: Math.round(posAt(0.5)), end: Math.round(posAt(3.7)), keyframes: kf.length });
check('smooth path (few keyframes, camera holds when person stands still)', kf.length >= 3 && kf.length <= 30 && Math.abs(posAt(0.2) - posAt(0.8)) < 15, kf.length);
// dışa aktarılan karede kişi ortada
U.app.commands.openSequence(s.id);
for (const sec of [0.5, 3.7]) {
  await U.exportFrame(s, Math.round(sec * s.fps), OUT + 'reframe_' + sec + '.png');
  const px = await pixels(OUT + 'reframe_' + sec + '.png', W, 1280);
  let sx = 0, n = 0;
  for (let y = 380; y < 700; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (px[i] > 190 && px[i + 1] > 140 && px[i + 2] < 130) { sx += x; n++; } }
  check(`person's face near the center of the 9:16 frame at ${sec}s`, n > 500 && Math.abs(sx / n - W / 2) < W * 0.15, { faceX: Math.round(sx / Math.max(1, n)), center: W / 2, n });
}
