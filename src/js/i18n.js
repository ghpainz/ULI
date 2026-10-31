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
