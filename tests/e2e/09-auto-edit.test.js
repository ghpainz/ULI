// Şablonla otomatik kurgu: 5 şablon, dikey biçim, 120 BPM müzik — kesmeler vuruşta, geçişler, başlık, müzik
const A = await import('./js/autoEdit.js');
const G = await import('./js/graphics.js');
await U.IO.newProject();
const media = await U.importFiles([MEDIA + 'camA.mp4', MEDIA + 'scenes.mp4', MEDIA + 'rotating.mp4', MEDIA + 'clicks120.wav']);
await sleep(1200);
const [camA, scn, rot, music] = media;
const beatPhase = 0.13, period = 0.5; // test şarkısı: 0.13 sn'den başlayarak her 0.5 sn'de vuruş
for (const tp of A.AUTO_TEMPLATES) {
  const r = await A.buildAutoEdit({ mediaIds: [camA.id, scn.id, rot.id], musicId: music.id, templateId: tp.id, aspect: '9:16', length: '12', title: 'YAZ 2026 TATİLİ', subtitle: 'Antalya' });
  const s = U.store.project.sequences[r.sequenceId];
  const clips = Object.values(s.clips);
  const v1 = clips.filter((c) => c.type === 'video' && c.track === 0).sort((a, b) => a.start - b.start);
  const cuts = v1.slice(1).map((c) => c.start / s.fps);
  const offBeat = cuts.filter((t) => { const d = ((t - beatPhase) % period + period) % period; return Math.min(d, period - d) > 1.5 / s.fps; });
  const gaps = v1.slice(1).filter((c, i) => c.start !== v1[i].start + v1[i].duration).length;
  const mus = clips.find((c) => c.type === 'audio' && c.mediaId === music.id);
  const title = clips.find((c) => c.kind === 'graphic' && c.name === U.store.project && false) || clips.filter((c) => c.kind === 'graphic').sort((a, b) => a.start - b.start)[0];
  const tl = title && title.graphic.layers.filter((L) => L.type === 'text');
  const fits = tl && tl.every((L) => { const b = G.layerBounds(L); return b.x >= 0 && b.x + b.w <= s.width; });
  const trans = v1.filter((c) => c.transIn).length;
  check(`${tp.id}: 1080×1920 sequence, beat ${r.bpm} BPM`, s.width === 1080 && s.height === 1920 && r.beatSynced && Math.abs(r.bpm - 120) < 4, { size: [s.width, s.height], bpm: r.bpm });
  check(`${tp.id}: ${v1.length} clips, all cuts on beats, no gaps`, v1.length >= 4 && offBeat.length === 0 && gaps === 0, { cuts: cuts.map((x) => +x.toFixed(2)).slice(0, 8), offBeat, gaps });
  check(`${tp.id}: transitions, music and title`, trans > 0 && mus && mus.duration === v1[v1.length - 1].start + v1[v1.length - 1].duration && tl && tl[0].text === 'YAZ 2026 TATİLİ' && fits, { trans, music: mus?.duration, title: tl?.map((L) => L.text), fits });
  U.app.commands.openSequence(s.id);
  const f = Math.round(s.fps * 6);
  await U.exportFrame(s, f, OUT + 'auto_' + tp.id + '.png');
  const px = await pixels(OUT + 'auto_' + tp.id + '.png', 27, 48);
  let lum = 0; for (let i = 0; i < px.length; i += 4) lum += px[i] + px[i + 1] + px[i + 2];
  check(`${tp.id}: exported frame is not empty`, lum / (px.length / 4) / 3 > 15, +(lum / (px.length / 4) / 3).toFixed(1));
}
// müziksiz: kliplerin kendi sesi kalır, düzenli aralık
const r2 = await A.buildAutoEdit({ mediaIds: [camA.id, scn.id], musicId: null, templateId: 'vlog', aspect: '16:9', length: '8', title: '' });
const s2 = U.store.project.sequences[r2.sequenceId];
const c2 = Object.values(s2.clips);
check('no music: clips keep their own audio, no title', c2.some((c) => c.type === 'audio' && c.mediaId === camA.id) && !c2.some((c) => c.kind === 'graphic') && s2.width === 1920, { cuts: r2.cuts });
// tek geri al ile tamamen kaybolur
const n = Object.keys(U.store.project.sequences).length;
U.store.undo();
check('one undo removes the whole edit', Object.keys(U.store.project.sequences).length === n - 1);
// pencere: proje panelinden aç, şablon seç, oluştur
U.store.ui.selectedProjectItems = new Set([camA.id, scn.id, music.id]);
const pr = U.app.commands.run('sequence.autoEdit');
for (let i = 0; i < 40 && !document.querySelector('.modal'); i++) await sleep(50);
const m = document.querySelector('.modal');
const cards = m ? [...m.querySelectorAll('button[data-id]')].filter((b) => A.AUTO_TEMPLATES.some((x) => x.id === b.dataset.id)) : [];
check('dialog shows 5 template cards and 4 formats', cards.length === 5 && m.querySelectorAll('button[data-id*=":"]').length === 4, cards.length);
cards.find((b) => b.dataset.id === 'cinematic')?.click();
[...m.querySelectorAll('button[data-id*=":"]')].find((b) => b.dataset.id === '1:1')?.click();
await ipc.invoke('test:shot', OUT + 'auto_dialog.png');
m.querySelector('.modal-buttons .primary').click();
const res = await pr;
const s3 = res && U.store.project.sequences[res.sequenceId];
check('dialog builds a 1:1 cinematic edit (dissolves, no bars on square) and opens it', s3 && s3.width === s3.height && U.store.seq === s3 && Object.values(s3.clips).some((c) => ['filmDissolve', 'crossDissolve'].includes(c.transIn?.type)) && !Object.values(s3.clips).some((c) => c.kind === 'adjustment'), res);
// dışa aktarma: TikTok hazır ayarı dikey sekansta 1080×1920, yüksek bit hızı
U.app.commands.openSequence(s3.id);
U.store.commit('v', (p) => { const q = p.sequences[s3.id]; q.width = 1080; q.height = 1920; });
const ep = U.app.openExport();
for (let i = 0; i < 40 && !document.querySelector('.modal'); i++) await sleep(50);
const em = document.querySelector('.modal');
const sel = [...em.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'tiktok'));
sel.value = 'tiktok'; sel.dispatchEvent(new Event('change'));
const nums = [...em.querySelectorAll('input')].filter((x) => x.type === 'number' || /^\d+$/.test(x.value)).map((x) => x.value);
check('export preset TikTok sets 1080×1920 MP4', nums.includes('1080') && nums.includes('1920'), nums.slice(0, 6));
[...em.querySelectorAll('.modal-buttons button')].find((b) => !b.classList.contains('primary') && /İptal|Cancel/.test(b.textContent)).click();
await ep;
// zaman çizelgesinde seçili kliplerden (sağ tık menüsü yolu)
const Aa = await import('./js/autoEdit.js');
U.app.commands.newSequenceFromMedia(camA);
const t1 = place(camA, 0, { a: 0, outS: 3 }), t2 = place(scn, 90, { a: 0, outS: 3 });
U.store.select([t1[0], t2[0]]); U.store.ui.focusedPanel = 'timeline';
const tsel = Aa.selectionMediaIds();
check('timeline selection feeds the template dialog', tsel.length === 2 && tsel.includes(camA.id) && tsel.includes(scn.id), tsel);
