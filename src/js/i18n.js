// Basit çeviri sistemi: İngilizce metin anahtar, Türkçe karşılığı sözlükte
import { TR } from './lang_tr.js';

let lang = 'tr';
try { lang = localStorage.getItem('uli.lang') || 'tr'; } catch (e) { /* */ }

export function getLang() { return lang; }

export function setLang(l) {
  lang = l === 'en' ? 'en' : 'tr';
  try { localStorage.setItem('uli.lang', lang); } catch (e) { /* */ }
  document.documentElement.lang = lang;
}

export function t(key, vars) {
  let s = lang === 'tr' && TR[key] != null ? TR[key] : key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

// Dil değişince panellerin bir kez kurulan sabit yazılarını (etiket, ipucu, arama kutusu, seçenek) yeniden çevirir.
// Yalnız ekrandaki metni değiştirir; proje verisine dokunmaz. Kullanıcı içeriği (yazı kutuları, düzenlenebilir alanlar) atlanır.
let reverseTR = null;
export function retranslateDom(root, from, to) {
  if (from === to) return 0;
  if (!reverseTR) { reverseTR = new Map(); for (const [k, v] of Object.entries(TR)) if (!reverseTR.has(v)) reverseTR.set(v, k); }
  const conv = (s) => {
    if (!s) return null;
    const m = /^(\s*)(.*?)(\s*)$/s.exec(s);
    const core = m[2];
    const one = (x) => {
      if (from === 'tr' && to === 'en') { const k = reverseTR.get(x); return k != null && k !== x ? k : null; }
      if (from === 'en' && to === 'tr') { const v = TR[x]; return v != null && v !== x ? v : null; }
      return null;
    };
    let out = one(core);
    // "Giriş İşaretle (I)" gibi sonuna kısayol eklenmiş ipuçları
    if (out == null) { const s = /^(.+?)(\s\([^()]+\))$/.exec(core); if (s) { const o = one(s[1]); if (o != null) out = o + s[2]; } }
    // "✨ Otomatik Altyazı" gibi başında simge olan yazılar
    if (out == null) { const s = /^([^\p{L}\p{N}]+\s)(.+)$/u.exec(core); if (s) { const o = one(s[2]); if (o != null) out = s[1] + o; } }
    return out == null ? null : m[1] + out + m[3];
  };
  const skip = (e) => !e || e.closest('textarea, [contenteditable="true"], [data-no-i18n]');
  let n = 0;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const node = w.currentNode;
    if (skip(node.parentElement)) continue;
    const r = conv(node.nodeValue);
    if (r != null) { node.nodeValue = r; n++; }
  }
  for (const e of root.querySelectorAll('[title], [placeholder], [aria-label]')) {
    if (skip(e)) continue;
    for (const a of ['title', 'placeholder', 'aria-label']) {
      const r = conv(e.getAttribute(a));
      if (r != null) { e.setAttribute(a, r); n++; }
    }
  }
  return n;
}
