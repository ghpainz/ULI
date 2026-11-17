// Dil değiştirince (TR→EN) ekranda Türkçe kalan sabit yazı olmamalı
const I = await import('./js/i18n.js');
const { TR } = await import('./js/lang_tr.js');
const trVals = new Map(Object.entries(TR).map(([k, v]) => [v, k]));
await U.IO.newProject();
const [cam] = await U.importFiles([MEDIA + 'camA.mp4']);
await sleep(800);
U.app.commands.newSequenceFromMedia(cam);
place(cam, 0, { a: 0 });
I.setLang('tr'); U.app.relocalize(); await sleep(300);
const L = await import('./js/ui/layout.js');
const collect = () => {
  const found = new Map();
  const add = (s, where) => { s = (s || '').trim(); if (s && trVals.has(s) && trVals.get(s) !== s) found.set(s, where); };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; const p = n.parentElement; add(n.nodeValue, (p.closest('[class]')?.className || p.tagName) + ''); }
  for (const e of document.querySelectorAll('[title],[placeholder]')) { add(e.getAttribute('title'), 'title:' + e.className); add(e.getAttribute('placeholder'), 'ph:' + e.className); }
  return found;
};
const all = new Map();
for (const ws of ['editing', 'color', 'effects', 'audio', 'graphics']) {
  L.applyWorkspace(ws); await sleep(300);
  I.setLang('en'); U.app.relocalize(); await sleep(400);
  for (const [k, v] of collect()) all.set(k, ws + ' ' + v);
  I.setLang('tr'); U.app.relocalize(); await sleep(200);
}
for (const id of ['source', 'effectControls', 'lumetri', 'scopes', 'graphics', 'audioMixer', 'essentialSound', 'project', 'effects', 'markers', 'history', 'captions', 'audioLibrary', 'exportQueue']) {
  try { U.app.commands.showPanel(id); } catch (e) { /* */ }
  await sleep(150);
  I.setLang('en'); U.app.relocalize(); await sleep(300);
  for (const [k, v] of collect()) all.set(k, id + ' ' + v);
  I.setLang('tr'); U.app.relocalize(); await sleep(150);
}
all.delete('Pan'); // 'Pan' iki dilde aynı kelime
check('no UI text stays Turkish after switching to English', all.size === 0, [...all].map(([k, v]) => k + ' @ ' + v.slice(0, 50)));
