// Sessizlikleri kaldır: duraklamalı konuşma videosu; müzik başka izde dokunulmadan kalmalı
const T = await import('./js/tts.js');
const SC = await import('./js/silenceCut.js');
const vs = await T.listVoices();
const tr = vs.find((v) => /tr/i.test(v.lang));
await T.synthesize('Birinci cümle burada.', tr.id, 0, OUT + 'sil_a.wav');
await T.synthesize('İkinci cümle de burada.', tr.id, 0, OUT + 'sil_b.wav');
// iki cümle arasına 2 sn sessizlik koy, kırmızı görüntüyle birleştir (konuşma videosu)
const vid = OUT + 'sil_talk.mp4';
const r0 = cp.spawnSync(ff.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-i', OUT + 'sil_a.wav', '-i', OUT + 'sil_b.wav', '-f', 'lavfi', '-i', 'color=red:s=320x180:r=30',
  '-filter_complex', '[0]apad=pad_dur=2[a0];[a0][1]concat=n=2:v=0:a=1[a]', '-map', '2:v', '-map', '[a]', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', vid]);
await U.IO.newProject();
const [talk, music] = await U.importFiles([vid, MEDIA + 'tone440.wav']);
await sleep(1000);
U.app.commands.newSequenceFromMedia(talk);
const fps = S().fps;
const [v, a] = place(talk, 0, { a: 0, outS: talk.duration });
const [m] = place(music, 0, { v: null, a: 1, outS: 4 });
const before = S().clips[v].duration;
const musicBefore = JSON.stringify(S().clips[m]);
const plan = await SC.planSilenceCuts(S(), [v], { sensitivity: 'normal', minSilence: 0.5, padding: 0.12 });
check('finds the 2 s pause between sentences', plan.cuts.some(([s, e]) => (e - s) / fps > 1.5 && (e - s) / fps < 2.3), plan.cuts.map(([s, e]) => [+(s / fps).toFixed(2), +(e / fps).toFixed(2)]));
const res = await SC.removeSilences([v], { sensitivity: 'normal', minSilence: 0.5, padding: 0.12 });
const vids = Object.values(S().clips).filter((c) => c.type === 'video').sort((x, y) => x.start - y.start);
const auds = Object.values(S().clips).filter((c) => c.type === 'audio' && c.mediaId === talk.id).sort((x, y) => x.start - y.start);
const total = vids.reduce((s, c) => s + c.duration, 0);
check(`removed ${res.cuts} pause(s), ${res.seconds.toFixed(1)} s shorter`, res.cuts >= 1 && Math.abs(before - total - res.seconds * fps) <= 1 && res.seconds > 1.5, { before, total });
check('no gaps left between pieces', vids.every((c, i) => i === 0 || c.start === vids[i - 1].start + vids[i - 1].duration), vids.map((c) => [c.start, c.duration]));
check('video and audio pieces stay aligned and linked', vids.length === auds.length && vids.every((c, i) => c.start === auds[i].start && c.duration === auds[i].duration && c.linkId && c.linkId === auds[i].linkId));
check('music on another track is untouched', JSON.stringify(S().clips[m]) === musicBefore);
// sonuç: kesimden sonra ikinci cümlenin kaynak noktası doğru (sessizliğin sonundan biraz önce)
const second = vids[1];
check('second sentence starts right after the cut', second && second.inPoint > 1.5, second && +second.inPoint.toFixed(2));
U.store.undo();
check('one undo restores the original clip', S().clips[v] && S().clips[v].duration === before && Object.values(S().clips).filter((c) => c.type === 'video').length === 1);
