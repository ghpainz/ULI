// Modal pencereler, bağlam menüleri, bildirimler
import { el } from '../util.js';
import { t } from '../i18n.js';

const root = () => document.getElementById('overlay-root');
export let modalOpen = 0;

export function modal({ title, body, buttons = [], width, onClose, onOpen, escape = true, closeOnBackdrop = false }) {
  return new Promise((resolve) => {
    modalOpen++;
    const bd = el('div', { class: 'modal-backdrop' });
    const box = el('div', { class: 'modal', style: width ? { width: width + 'px' } : null });
    const close = (val) => {
      if (!bd.parentNode) return;
      bd.remove();
      modalOpen--;
      document.removeEventListener('keydown', onKey, true);
      if (onClose) onClose(val);
      resolve(val);
    };
    const btnRow = el('div', { class: 'modal-buttons' });
    let primaryBtn = null;
    for (const b of buttons) {
      const btn = el('button', { class: b.primary ? 'primary' : '', text: b.label });
      btn.addEventListener('click', async () => {
        if (b.onClick) {
          const r = await b.onClick(close);
          if (r === false) return;
          if (r !== undefined) { close(r); return; }
        }
        close(b.value !== undefined ? b.value : b.label);
      });
      if (b.primary) primaryBtn = btn;
      btnRow.appendChild(btn);
    }
    box.appendChild(el('div', { class: 'modal-title', text: title || '' }));
    const bodyEl = el('div', { class: 'modal-body' });
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body) bodyEl.appendChild(body);
    box.appendChild(bodyEl);
    if (buttons.length) box.appendChild(btnRow);
    bd.appendChild(box);
    if (closeOnBackdrop) bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(null); });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); if (escape) close(null); }
      else if (e.key === 'Enter' && primaryBtn && !(e.target && e.target.tagName === 'TEXTAREA')) {
        e.stopPropagation(); e.preventDefault(); primaryBtn.click();
      }
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    root().appendChild(bd);
    const first = box.querySelector('input,select,textarea');
    if (first) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 30);
    box._close = close;
    if (onOpen) onOpen(close);
  });
}

export function confirmDialog(message, { title = t('Confirm'), ok = t('OK'), cancel = t('Cancel'), extra } = {}) {
  const buttons = [];
  if (extra) buttons.push({ label: extra, value: 'extra' });
  buttons.push({ label: cancel, value: false });
  buttons.push({ label: ok, value: true, primary: true });
  return modal({ title, body: el('div', { style: { whiteSpace: 'pre-wrap', maxWidth: '520px' }, text: message }), buttons });
}

export function alertDialog(message, title = 'ULI Premiere') {
  return modal({ title, body: el('div', { style: { whiteSpace: 'pre-wrap', maxWidth: '560px', userSelect: 'text' }, text: message }), buttons: [{ label: t('OK'), primary: true, value: true }] });
}

export function promptDialog(label, value = '', { title = '', multiline = false } = {}) {
  const input = multiline ? el('textarea', { style: { width: '360px', height: '90px' } }) : el('input', { type: 'text', style: { width: '360px' } });
  input.value = value;
  const body = el('div', {}, el('div', { style: { marginBottom: '6px' }, text: label }), input);
  return modal({
    title: title || label,
    body,
    buttons: [
      { label: t('Cancel'), value: null },
      { label: t('OK'), primary: true, onClick: () => input.value },
    ],
  });
}

let toastTimer = null;
export function toast(msg, type = 'info', ms = 3200) {
  document.querySelectorAll('.toast').forEach((x) => x.remove());
  const d = el('div', { class: 'toast' + (type === 'error' ? ' error' : ''), text: msg });
  document.body.appendChild(d);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => d.remove(), ms);
  d.addEventListener('click', () => d.remove());
}

// ---- Menüler ----
let openMenu = null;

export function closeMenus() {
  if (openMenu) {
    openMenu.forEach((m) => m.remove());
    openMenu = null;
  }
  document.querySelectorAll('.menu-top.open').forEach((x) => x.classList.remove('open'));
}

function buildMenu(items, x, y, level = 0, stack = []) {
  const m = el('div', { class: level === 0 ? 'context-menu' : 'context-menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === '-' || it.sep) { m.appendChild(el('div', { class: 'menu-sep' })); continue; }
    const disabled = typeof it.enabled === 'function' ? !it.enabled() : it.enabled === false;
    const checked = typeof it.checked === 'function' ? it.checked() : it.checked;
    const row = el('div', { class: 'menu-item' + (disabled ? ' disabled' : '') + (it.submenu ? ' has-sub' : '') },
      el('span', { class: 'check', text: checked ? '✓' : '' }),
      el('span', { class: 'label', text: it.label }),
      it.shortcut ? el('span', { class: 'shortcut', text: it.shortcut }) : null);
    if (it.submenu) {
      row.addEventListener('mouseenter', () => {
        while (stack.length > level + 1) stack.pop().remove();
        const r = row.getBoundingClientRect();
        const subItems = typeof it.submenu === 'function' ? it.submenu() : it.submenu;
        const sub = buildMenu(subItems, r.right - 2, r.top - 4, level + 1, stack);
        stack.push(sub);
        openMenu = stack;
      });
    } else {
      row.addEventListener('mouseenter', () => { while (stack.length > level + 1) stack.pop().remove(); });
      row.addEventListener('mousedown', (e) => e.stopPropagation());
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (disabled) return;
        closeMenus();
        if (it.action) setTimeout(() => it.action(), 0);
      });
    }
    m.appendChild(row);
  }
  m.addEventListener('mousedown', (e) => e.stopPropagation());
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  let left = x, top = y;
  if (left + r.width > window.innerWidth - 4) left = Math.max(4, (level ? x - r.width - 200 : window.innerWidth - r.width - 4));
  if (top + r.height > window.innerHeight - 4) top = Math.max(4, window.innerHeight - r.height - 4);
  m.style.left = left + 'px';
  m.style.top = top + 'px';
  return m;
}

export function contextMenu(x, y, items) {
  closeMenus();
  const stack = [];
  const m = buildMenu(items, x, y, 0, stack);
  stack.unshift(m);
  openMenu = stack;
  return m;
}

export function dropdownMenu(anchor, items) {
  closeMenus();
  const r = anchor.getBoundingClientRect();
  const stack = [];
  const m = buildMenu(items, r.left, r.bottom, 0, stack);
  stack.unshift(m);
  openMenu = stack;
  anchor.classList.add('open');
  return m;
}

export function isMenuOpen() { return !!openMenu; }

document.addEventListener('mousedown', () => closeMenus());
window.addEventListener('blur', () => closeMenus());

// Form yardımcıları
export function formRow(label, input) {
  return [el('label', { text: label }), input];
}

export function selectEl(options, value, onChange) {
  const s = el('select');
  for (const o of options) {
    const opt = el('option', { value: o.value, text: o.label });
    if (String(o.value) === String(value)) opt.selected = true;
    s.appendChild(opt);
  }
  if (onChange) s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function numInput(value, { min, max, step = 1, width = 80 } = {}) {
  const i = el('input', { type: 'number', style: { width: width + 'px' } });
  i.value = value;
  if (min != null) i.min = min;
  if (max != null) i.max = max;
  i.step = step;
  return i;
}
