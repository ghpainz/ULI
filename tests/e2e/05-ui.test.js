// Arayüz: proje panelinde çift tık kaynağa açar, kısayol düzenleme, çalışma alanları
await U.IO.newProject();
const [cam] = await U.importFiles([MEDIA + 'camA.mp4']);
await sleep(1200);
U.app.commands.run('window.project');
await sleep(500);
const node = [...document.querySelectorAll('[draggable="true"]')].find((x) => x.textContent.includes('camA.mp4') && x.getBoundingClientRect().width > 0);
check('media item shown in project panel', !!node);
if (node) {
  const r = node.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
  await ipc.invoke('test:input', [
    { type: 'mouseDown', x, y, button: 'left', clickCount: 1 }, { type: 'mouseUp', x, y, button: 'left', clickCount: 1 },
    { type: 'mouseDown', x, y, button: 'left', clickCount: 2 }, { type: 'mouseUp', x, y, button: 'left', clickCount: 2 },
  ]);
  await sleep(500);
  check('double-click opens media in Source monitor', U.store.ui.sourceMediaId === cam.id);
}
const C = await import('./js/commands.js');
C.setShortcut('marker.add', 'Ctrl+Shift+Y');
check('custom shortcut is used', C.commandForShortcut('Ctrl+Shift+Y') === 'marker.add');
C.resetShortcuts();
check('shortcuts reset', C.shortcutOf('marker.add') !== 'Ctrl+Shift+Y');
const L = await import('./js/ui/layout.js');
L.applyWorkspace('audio'); await sleep(200);
check('audio workspace shows mixer', L.panels.get('audioMixer').group.active.id === 'audioMixer');
L.applyWorkspace('editing');
