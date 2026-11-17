// Otomatik altyazı: Windows Türkçe sesiyle bilinen bir metin okutulur, altyazıya çevrilir ve kontrol edilir.
// Konuşma modeli tests/.models içinde yoksa (indirme yapılmaz) test atlanır.
const A = await import('./js/asr.js');
const AC = await import('./js/autoCaptions.js');
const T = await import('./js/tts.js');
check('speech engine is available', A.engineAvailable(), U.app?.paths?.whisper);
if (!A.hasModel('fast')) {
  check('SKIPPED: speech model not in tests/.models (run once with the model to enable)', true);
} else {
  const vs = await T.listVoices();
  const tr = vs.find((v) => /tr/i.test(v.lang));
  const wav = OUT + 'cap_tr.wav';
  await T.synthesize('Merhaba arkadaşlar, bugün Antalya sahilinde güzel bir gün geçiriyoruz. Deniz çok sıcak ve hava harika. Akşam yemeğinde balık yiyeceğiz.', tr.id, 0, wav);
  await U.IO.newProject();
  const [cam, sp] = await U.importFiles([MEDIA + 'camA.mp4', wav]);
  await sleep(1000);
  U.app.commands.newSequenceFromMedia(cam);
  place(cam, 0, { outS: 10 });
  const offset = 45; // konuşma 1.5 sn'den başlıyor
  place(sp, offset, { v: null, a: 1, outS: sp.duration || 20 });
  const seq = S();
  const r = await AC.runAutoCaptions(seq, { lang: 'auto', model: 'fast', prompt: 'Antalya, Kaleiçi', lineLen: 'normal', f0: 0, f1: offset + Math.round((sp.duration || 20) * seq.fps), silent: true });
  const caps = S().captions || [];
  const text = caps.map((c) => c.text).join(' ');
  check('Turkish detected automatically', r && r.language === 'tr', r && r.language);
  check(`${caps.length} captions with the spoken words`, caps.length >= 3 && /Antalya/.test(text) && /balık/i.test(text) && /Deniz/.test(text), text);
  check('first caption starts when speech starts (±0.5 s)', caps[0] && Math.abs(caps[0].start - offset) <= seq.fps * 0.5, caps[0] && caps[0].start);
  check('captions do not overlap and have word timings', caps.every((c, i) => c.end > c.start && (!caps[i + 1] || c.end <= caps[i + 1].start) && c.words?.length && c.words[0].start >= c.start - 2), caps.map((c) => [c.start, c.end, c.words?.length]));
  check('line length kept short', caps.every((c) => c.text.length <= 48), caps.map((c) => c.text.length));
  // kelime kelime vurgu: "Sosyal" stilinde konuşulan kelime sarı; sonraki kelimeye geçince vurgu da kayar
  const CP = await import('./js/captions.js');
  U.store.commit('st', (p) => { const q = p.sequences[p.activeSequenceId]; q.captionStyle = { ...CP.DEFAULT_CAPTION_STYLE, ...CP.CAPTION_PRESETS.find((x) => x.id === 'social').st }; });
  const cap = S().captions.find((c) => c.words.length >= 3);
  const yellowAt = async (f, name) => {
    await U.exportFrame(S(), f, OUT + name);
    const d = await pixels(OUT + name, 320, 180);
    let n = 0, sx = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 170 && d[i + 2] < 90) { n++; sx += (i / 4) % 320; }
    return { n, x: n ? sx / n : -1 };
  };
  const w0 = await yellowAt(cap.words[0].start + 1, 'cap_w0.png');
  const w2 = await yellowAt(cap.words[2].start + 1, 'cap_w2.png');
  check('spoken word is highlighted and the highlight moves with speech', w0.n > 20 && w2.n > 20 && w2.x > w0.x + 10, { first: w0, third: w2 });
  // kullanıcı bir kelimeyi düzeltirse vurgu çalışmaya devam eder (kelimeler yeniden hizalanır)
  U.store.commit('ed', (p) => { const q = p.sequences[p.activeSequenceId]; const c = q.captions.find((x) => x.id === cap.id); c.text = c.text.replace(cap.words[1].text, 'Kaleiçi'); });
  const e0 = await yellowAt(cap.words[0].start + 1, 'cap_e0.png');
  const e2 = await yellowAt(cap.words[2].start + 1, 'cap_e2.png');
  check('after fixing a word, highlight still follows speech', e0.n > 20 && e2.n > 20 && e2.x > e0.x + 10, { first: e0, third: e2 });
  U.store.commit('ed2', (p) => { const q = p.sequences[p.activeSequenceId]; q.captions.find((c) => c.id === cap.id).text = 'tamamen farklı yepyeni bir metin'; });
  const e3 = await yellowAt(cap.start + 1, 'cap_e3.png');
  check('fully rewritten text still highlights (spread over the caption)', e3.n > 20, e3);
  U.store.undo(); U.store.undo(); U.store.undo();
  // tek geri al
  U.store.undo();
  check('one undo removes the auto captions', !(S().captions || []).length);
}
