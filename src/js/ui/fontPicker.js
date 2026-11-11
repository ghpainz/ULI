// Yazı tipi seçici: bilgisayarda yüklü tüm yazı tiplerini (Windows kayıt defteri) listeler,
// her birini kendi görünümüyle gösterir; arama ve son kullanılanlar.
import { el, childProcess } from '../util.js';
import { t } from '../i18n.js';

const FALLBACK = ['Segoe UI', 'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact', 'Ink Free', 'Lucida Console', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Sitka Text', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
const STYLE_RE = /\s+(Bold Italic|Bold Oblique|Italic|Oblique|Bold|Regular)$/i;

// Kayıt defteri girdisi ("Arial Bold Italic (TrueType)") -> aile adları
export function familiesFromRegistry(text) {
  const out = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s{2,}(.+?)\s{2,}REG_(?:SZ|EXPAND_SZ)\s/.exec(line);
    if (!m) continue;
    const name = m[1].replace(/\s*\((TrueType|OpenType|All res)\)\s*$/i, '').trim();
    if (!name || /^\d/.test(name) || /\.(fon|fnt|ttf|ttc|otf)$/i.test(name) || /[\/:]/.test(name)) continue;
    for (let part of name.split(/\s*&\s*/)) {
      part = part.replace(STYLE_RE, '').replace(STYLE_RE, '').trim();
      if (/Fluent Icons|MDL2 Assets|^Marlett$|HoloLens|Sans Serif Collection|Segoe UI Historic/i.test(part)) continue; // sistem simge fontları
      if (part && !/^(Small Fonts|MS Sans Serif|MS Serif|Modern|Roman|Script|Courier|System|Terminal|Fixedsys)$/i.test(part)) out.add(part);
    }
  }
  return [...out];
}

let cache = null;
export function systemFonts() {
  if (cache) return cache;
  const run = (args) => new Promise((resolve) => {
    try {
      childProcess.execFile('reg', args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout));
    } catch (e) { resolve(''); }
  });
  cache = Promise.all([
    run(['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts']),
    run(['query', 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', '/s']),
  ]).then(([a, b]) => {
    const fams = new Set([...familiesFromRegistry(a), ...familiesFromRegistry(b)]);
    if (fams.size < 5) FALLBACK.forEach((f) => fams.add(f));
    return [...fams].sort((x, y) => x.localeCompare(y, 'tr'));
  });
  return cache;
}

// arama: Türkçe büyük/küçük harf farkı (I/ı/İ/i) gözetmeden
const norm = (x) => x.toLocaleLowerCase('tr').replace(/ı/g, 'i');

const RECENT_KEY = 'uli.recentFonts';
function recent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } }
function pushRecent(f) { try { localStorage.setItem(RECENT_KEY, JSON.stringify([f, ...recent().filter((x) => x !== f)].slice(0, 6))); } catch (e) { /* */ } }

let openPop = null;
function closePop() { if (openPop) { openPop.remove(); openPop = null; document.removeEventListener('mousedown', outside, true); } }
function outside(e) { if (openPop && !openPop.contains(e.target)) closePop(); }

// value: geçerli yazı tipi, onPick(font): seçim yapılınca
export function fontPicker(value, onPick, { width = 150 } = {}) {
  const btn = el('button', { class: 'font-picker', title: t('Font'), style: { width: width + 'px', fontFamily: `"${value}", "Segoe UI", sans-serif` } },
    el('span', { class: 'fp-name', text: value || 'Segoe UI' }), el('span', { class: 'fp-caret', text: '▾' }));
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (openPop) { closePop(); return; }
    const fonts = await systemFonts();
    const r = btn.getBoundingClientRect();
    const pop = el('div', { class: 'fp-pop' });
    const search = el('input', { type: 'text', placeholder: t('Search fonts') + ` (${fonts.length})` });
    const list = el('div', { class: 'fp-list' });
    pop.append(search, list);
    const pick = (f) => { pushRecent(f); closePop(); btn.style.fontFamily = `"${f}", "Segoe UI", sans-serif`; btn.firstChild.textContent = f; onPick(f); };
    const row = (f, cls = '') => {
      const it = el('div', { class: 'fp-item' + cls + (f === value ? ' sel' : ''), title: f },
        el('span', { class: 'fp-sample', text: f, style: { fontFamily: `"${f}", "Segoe UI", sans-serif` } }));
      it.addEventListener('mousedown', (ev) => { ev.preventDefault(); pick(f); });
      return it;
    };
    const render = () => {
      const q = norm(search.value.trim());
      list.innerHTML = '';
      const rec = q ? [] : recent().filter((f) => fonts.includes(f));
      if (rec.length) {
        list.appendChild(el('div', { class: 'fp-head', text: t('Recent') }));
        for (const f of rec) list.appendChild(row(f));
        list.appendChild(el('div', { class: 'fp-head', text: t('All Fonts') }));
      }
      const hits = fonts.filter((f) => !q || norm(f).includes(q));
      for (const f of hits) list.appendChild(row(f));
      if (!hits.length) list.appendChild(el('div', { class: 'fp-head', text: t('No fonts found') }));
    };
    search.addEventListener('input', render);
    search.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') closePop();
      if (ev.key === 'Enter') { const first = list.querySelector('.fp-item'); if (first) pick(first.title); }
    });
    render();
    document.body.appendChild(pop);
    const h = Math.min(380, window.innerHeight - 20);
    const top = r.bottom + h + 4 < window.innerHeight ? r.bottom + 2 : Math.max(8, r.top - h - 2);
    Object.assign(pop.style, { left: Math.min(r.left, window.innerWidth - 270) + 'px', top: top + 'px', height: h + 'px' });
    openPop = pop;
    document.addEventListener('mousedown', outside, true);
    search.focus();
    const sel = list.querySelector('.fp-item.sel');
    if (sel) sel.scrollIntoView({ block: 'center' });
  });
  return btn;
}
