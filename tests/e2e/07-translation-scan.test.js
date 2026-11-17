// Tüm paneller, menüler ve diyaloglar İngilizce açıldığında Türkçe yazı kalmamalı (efektlerin parametre adları dahil)
const I = await import('./js/i18n.js');
const { TR } = await import('./js/lang_tr.js');
const D = await import('./js/effectsDef.js');
const L = await import('./js/ui/layout.js');
const trVals = new Set(Object.values(TR));
await U.IO.newProject();
const [cam, tone] = await U.importFiles([MEDIA + 'camA.mp4', MEDIA + 'tone440.wav']);
await sleep(800);
U.app.commands.newSequenceFromMedia(cam);
const [v, a] = place(cam, 0, { a: 0 });
const ta = place(tone, 0, { v: null, a: 1, outS: 3 })[0];
U.store.commit('fx', (p) => {
  const s = p.sequences[p.activeSequenceId];
  for (const [k, d] of Object.entries(D.EFFECTS)) { try { const fx = U.createEffect(k); if (d.audio || d.kind === 'audio') s.clips[ta].effects.push(fx); else s.clips[v].effects.push(fx); } catch (e) { /* */ } }
});
const found = { tr: new Map(), en: new Map() };
const tech = /^(H\.26[45]|ProRes|LUT|RGB|YUV|HSL|NVENC|VP9|GIF|PNG|WAV|MP3|AAC|FLAC|SRT|VTT|BPM|LUFS|dB|fps|Hz|px|kHz|ULI|TR|EN|ms|CRF|Mono|Stereo|Lumetri.*|Ultra Key|Warp Stabilizer|Ken Burns|VHS|CRT|Glitch|Bokeh|Noir|Cyberpunk|OK)$/i;
const userish = (s) => /\.(mp4|wav|png|ulip)\b/i.test(s) || /^[\d\s:.,%+\-–x×/()°]+$/.test(s);
const scan = (lang) => {
  const add = (s, where) => {
    s = (s || '').trim(); if (!s || s.length < 2 || userish(s)) return;
    if (lang === 'tr') { if (/[A-Za-z]{3,}/.test(s) && !/[çğıöşüÇĞİÖŞÜ]/.test(s) && !trVals.has(s) && !tech.test(s) && /\b(the|of|and|to|a|in|on|for|with|is|[A-Z][a-z]+ [A-Z][a-z]+|[a-z]{4,})\b/.test(s)) found.tr.set(s, where); }
    else if (/[çğışÇĞİŞ]|[öü][a-z]/.test(s)) found.en.set(s, where);
  };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const p = w.currentNode.parentElement; if (!p || p.closest('textarea,[contenteditable="true"]') || !p.getClientRects().length) continue; add(w.currentNode.nodeValue, (p.closest('[class]')?.className || p.tagName).toString().slice(0, 30)); }
  for (const e of document.querySelectorAll('[title],[placeholder]')) { add(e.getAttribute('title'), 'title'); add(e.getAttribute('placeholder'), 'ph'); }
};
const tour = async (lang) => {
  I.setLang(lang); U.app.relocalize(); await sleep(300);
  for (const ws of ['editing', 'color', 'effects', 'audio', 'graphics']) { L.applyWorkspace(ws); await sleep(250); scan(lang); }
  for (const [sel, id] of [[[v], 'effectControls'], [[ta], 'effectControls'], [[ta], 'essentialSound'], [[v], 'lumetri']]) { U.store.select(sel); U.app.commands.showPanel(id); await sleep(400); scan(lang); }
  for (const id of ['project', 'effects', 'markers', 'history', 'captions', 'audioLibrary', 'exportQueue', 'scopes', 'graphics', 'audioMixer']) { try { U.app.commands.showPanel(id); } catch (e) { /* */ } await sleep(200); scan(lang); }
  const ep = U.app.effectsPanel; ep.view = 'list';
  for (const f of ['a', 'e', 'i', 'o', 'u']) { ep.filter = f; ep.render(); await sleep(150); scan(lang); }
  ep.filter = ''; ep.render();
  // menüler
  for (const top of [...document.querySelectorAll('#menubar .menu-top')]) {
    top.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await sleep(120); scan(lang);
    for (const row of [...document.querySelectorAll('.menu .menu-item, .menu > div')]) { row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); }
    await sleep(120); scan(lang);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await sleep(60);
  }
  // diyaloglar
  for (const cmd of ['edit.preferences', 'file.export', 'file.newSequence', 'edit.shortcuts']) {
    const pr = U.app.commands.run(cmd); await sleep(600); scan(lang);
    for (let i = 0; i < 5 && document.querySelector('.modal'); i++) { const b = [...document.querySelectorAll('.modal .modal-buttons button')].pop(); b ? b.click() : window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await sleep(150); }
    try { await Promise.race([pr, sleep(300)]); } catch (e) { /* */ }
  }
};
await tour('tr');
await tour('en');
I.setLang('tr');
check('English UI has no Turkish text (panels, menus, dialogs, all effects)', found.en.size === 0, [...found.en].map(([k, w]) => k + ' @' + w));
