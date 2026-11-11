// Çıkartma kütüphanesi: emojiler, vektör şekiller (SVG yolu, 24×24) ve hareketli rozetler.
// Her çıkartma oynatma kafasına ayrı bir grafik klibi olarak eklenir.
import { newLayer } from './graphics.js';

export const EMOJI = {
  Faces: '😀 😂 🤣 😍 🥰 😎 🤩 🥳 😭 😱 😡 🤯 😴 🤔 🙄 😬 🤫 🫡 😇 🤡 💀 👻 🤖 👽',
  Hands: '👍 👎 👏 🙌 🙏 💪 👉 👈 👆 👇 ✌️ 🤞 🤟 👌 🫶 👋 ✋ 🤝',
  Hearts: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💖 💯 ✨ ⭐ 🌟 💥 💫 🔥',
  Objects: '🎉 🎊 🎁 🏆 🥇 🎯 🎮 🎧 🎵 🎬 📸 💻 📱 💡 💰 💎 🚀 ⏰ 📌 🔔 ✅ ❌ ⚠️ ❓ ❗',
  Nature: '☀️ 🌙 ⚡ 🌈 ☁️ ❄️ 🌊 🌸 🌹 🍀 🍕 🍔 ☕ 🍿 🐶 🐱 🦁 🦋',
};

// 24×24 görünüm kutusunda SVG yolları
export const SHAPES = [
  { id: 'arrowR', name: 'Arrow', d: 'M2 10h13V5l7 7-7 7v-5H2z' },
  { id: 'arrowCurve', name: 'Curved Arrow', d: 'M3 19c0-8 5-12 12-12V3l7 6-7 6v-4c-5 0-9 2-12 8z' },
  { id: 'heart', name: 'Heart', d: 'M12 21s-8-5.3-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.7-8 11-8 11z' },
  { id: 'star', name: 'Star', d: 'M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7L12 17.3 5.7 21.2l1.7-7L2 9.5l7.1-.6z' },
  { id: 'burst', name: 'Burst', d: burstPath(12, 11.5, 7) },
  { id: 'bubble', name: 'Speech Bubble', d: 'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z' },
  { id: 'check', name: 'Check', d: 'M12 1a11 11 0 1 0 0 22a11 11 0 1 0 0-22zM10 16.6l-5-5 1.6-1.6 3.4 3.4 7.4-7.4L19 7.6z', evenodd: true },
  { id: 'cross', name: 'Cross', d: 'M12 1a11 11 0 1 0 0 22a11 11 0 1 0 0-22zM16.6 8.8L13.4 12l3.2 3.2-1.4 1.4-3.2-3.2-3.2 3.2-1.4-1.4 3.2-3.2-3.2-3.2 1.4-1.4 3.2 3.2 3.2-3.2z', evenodd: true },
  { id: 'play', name: 'Play Button', d: 'M12 1a11 11 0 1 0 0 22a11 11 0 1 0 0-22zM9.5 7v10l8-5z', evenodd: true },
  { id: 'pin', name: 'Location Pin', d: 'M12 1a8 8 0 0 0-8 8c0 6 8 14 8 14s8-8 8-14a8 8 0 0 0-8-8zm0 4.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 0 1 0-7z', evenodd: true },
  { id: 'bolt', name: 'Lightning', d: 'M14 1L3 14h8l-2 9 12-14h-8z' },
  { id: 'sparkle', name: 'Sparkle', d: 'M12 1l2.2 8.8L23 12l-8.8 2.2L12 23l-2.2-8.8L1 12l8.8-2.2z' },
  { id: 'bell', name: 'Bell', d: 'M12 23a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 23zm7-6.5V11a7 7 0 0 0-5.5-6.8V3a1.5 1.5 0 0 0-3 0v1.2A7 7 0 0 0 5 11v5.5L3 18.5V19h18v-.5z' },
  { id: 'crown', name: 'Crown', d: 'M2 7l5.5 4.5L12 4l4.5 7.5L22 7l-2.5 11h-15zM4.5 19.5h15V22h-15z' },
  { id: 'ring', name: 'Circle Highlight', d: 'M12 1a11 11 0 1 0 0 22a11 11 0 1 0 0-22zm0 2.2a8.8 8.8 0 1 1 0 17.6a8.8 8.8 0 0 1 0-17.6z', evenodd: true },
  { id: 'cursor', name: 'Cursor', d: 'M4 2l15 10.5-6.5 1.2 3.8 7.3-2.8 1.5-3.8-7.3L5 20z' },
];

function burstPath(n, r1, r2) {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const a = (i * Math.PI) / n - Math.PI / 2, r = i % 2 ? r2 : r1;
    d += (i ? 'L' : 'M') + (12 + Math.cos(a) * r).toFixed(2) + ' ' + (12 + Math.sin(a) * r).toFixed(2);
  }
  return d + 'z';
}

export const SHAPE_COLORS = { arrowR: '#ff3b30', arrowCurve: '#ff3b30', heart: '#ff2d55', star: '#ffcc00', burst: '#ffd60a', bubble: '#ffffff', check: '#34c759', cross: '#ff3b30', play: '#ff0000', pin: '#ff3b30', bolt: '#ffd60a', sparkle: '#ffe680', bell: '#ffcc00', crown: '#ffc700', ring: '#ff3b30', cursor: '#ffffff' };

export const BADGES = [
  { id: 'new', name: 'NEW Badge' }, { id: 'sale', name: 'SALE Burst' }, { id: 'wow', name: 'WOW!' }, { id: 'boom', name: 'BOOM!' },
  { id: 'likeSub', name: 'Like & Subscribe' }, { id: 'pointArrow', name: 'Pointing Arrow' }, { id: 'highlight', name: 'Highlight Circle' },
  { id: 'tapHere', name: 'Tap Here' }, { id: 'location', name: 'Location Tag' }, { id: 'question', name: 'Question Bubble' },
];

// Çıkartmanın katmanları (W×H sekans boyutu); kind: 'emoji' | 'shape' | 'badge'
export function stickerLayers(kind, id, W, H) {
  const k = H / 1080;
  const cx = W * 0.5, cy = H * 0.5;
  const pop = { type: 'pop', dur: 12 }, fade = { type: 'fade', dur: 8 };
  const svg = (o) => newLayer('svg', W, H, { animIn: pop, animOut: fade, ...o });
  const txt = (o) => newLayer('text', W, H, { font: 'Arial Black', bold: true, animIn: pop, animOut: fade, ...o });
  if (kind === 'emoji') return [newLayer('text', W, H, { name: 'Emoji', text: id, font: 'Segoe UI Emoji', bold: false, size: Math.round(220 * k), x: cx, y: cy, animIn: pop, animOut: fade, loop: { type: 'pulse', speed: 1.2, amount: 60 } })];
  if (kind === 'shape') {
    const sh = SHAPES.find((x) => x.id === id) || SHAPES[0];
    return [svg({ name: sh.name, path: sh.d, evenodd: !!sh.evenodd, x: cx, y: cy, w: Math.round(240 * k), h: Math.round(240 * k), fill: SHAPE_COLORS[sh.id] || '#ffffff', shadow: true, shadowBlur: 12, shadowDist: 4 })];
  }
  const S = (sid) => SHAPES.find((x) => x.id === sid).d;
  switch (id) {
    case 'new': return [
      newLayer('rect', W, H, { name: 'Badge', x: cx, y: cy, w: 300 * k, h: 120 * k, radius: 22 * k, fill: '#ff2d55', shadow: true, animIn: pop, animOut: fade, loop: { type: 'pulse', speed: 1.5, amount: 60 } }),
      txt({ name: 'Text', text: 'YENİ', x: cx, y: cy, size: 80 * k, fill: '#ffffff', loop: { type: 'pulse', speed: 1.5, amount: 60 } }),
    ];
    case 'sale': return [
      svg({ name: 'Burst', path: S('burst'), x: cx, y: cy, w: 380 * k, h: 380 * k, fill: '#ffd60a', stroke: '#111111', strokeWidth: 6 * k, loop: { type: 'swing', speed: 1, amount: 40 } }),
      txt({ name: 'Text', text: '%50\nİNDİRİM', x: cx, y: cy, size: 70 * k, fill: '#e3001b', lineHeight: 1, loop: { type: 'swing', speed: 1, amount: 40 } }),
    ];
    case 'wow': case 'boom': return [
      svg({ name: 'Burst', path: S('burst'), x: cx, y: cy, w: 460 * k, h: 400 * k, fill: id === 'wow' ? '#ffd60a' : '#ff6a00', stroke: '#111111', strokeWidth: 8 * k, loop: { type: 'shake', speed: 1, amount: 50 } }),
      txt({ name: 'Text', text: id === 'wow' ? 'WOW!' : 'BOOM!', x: cx, y: cy, size: 120 * k, fill: '#ffffff', strokeWidth: 8 * k, stroke: '#111111', italic: true, loop: { type: 'shake', speed: 1, amount: 50 } }),
    ];
    case 'likeSub': return [
      newLayer('rect', W, H, { name: 'Pill', x: cx, y: cy, w: 760 * k, h: 130 * k, radius: 65 * k, fill: '#ffffff', shadow: true, animIn: { type: 'slideUp', dur: 14 }, animOut: fade }),
      newLayer('text', W, H, { name: 'Icon', text: '👍', font: 'Segoe UI Emoji', bold: false, x: cx - 300 * k, y: cy, size: 80 * k, animIn: pop, animOut: fade, delay: 8, loop: { type: 'swing', speed: 1.5, amount: 100 } }),
      txt({ name: 'Text', text: 'BEĞEN & ABONE OL', x: cx + 40 * k, y: cy, size: 60 * k, fill: '#111111', animIn: { type: 'charRise', dur: 16 }, delay: 6 }),
    ];
    case 'pointArrow': return [svg({ name: 'Arrow', path: S('arrowR'), x: cx, y: cy, w: 300 * k, h: 300 * k, fill: '#ff3b30', stroke: '#ffffff', strokeWidth: 4 * k, shadow: true, loop: { type: 'float', speed: 2, amount: 120 } })];
    case 'highlight': return [svg({ name: 'Circle', path: S('ring'), x: cx, y: cy, w: 360 * k, h: 360 * k, fill: '#ff3b30', loop: { type: 'pulse', speed: 1.5, amount: 100 } })];
    case 'tapHere': return [
      newLayer('text', W, H, { name: 'Hand', text: '👆', font: 'Segoe UI Emoji', bold: false, x: cx, y: cy + 40 * k, size: 180 * k, animIn: pop, animOut: fade, loop: { type: 'float', speed: 2, amount: 150 } }),
      txt({ name: 'Text', text: 'TIKLA', x: cx, y: cy - 130 * k, size: 70 * k, fill: '#ffffff', strokeWidth: 6 * k, stroke: '#111111', loop: { type: 'pulse', speed: 2, amount: 80 } }),
    ];
    case 'location': return [
      newLayer('rect', W, H, { name: 'Pill', x: cx + 30 * k, y: cy, w: 470 * k, h: 110 * k, radius: 55 * k, fill: '#111111', fillOpacity: 85, animIn: { type: 'wipe', dur: 14 }, animOut: fade }),
      svg({ name: 'Pin', path: S('pin'), x: cx - 160 * k, y: cy, w: 80 * k, h: 80 * k, fill: '#ff3b30', loop: { type: 'float', speed: 1, amount: 60 } }),
      txt({ name: 'Text', text: 'İstanbul', font: 'Segoe UI', x: cx + 60 * k, y: cy, size: 58 * k, fill: '#ffffff', animIn: { type: 'charFade', dur: 14 }, delay: 6 }),
    ];
    case 'question': return [
      svg({ name: 'Bubble', path: S('bubble'), x: cx, y: cy, w: 380 * k, h: 320 * k, fill: '#ffffff', shadow: true, loop: { type: 'float', speed: 1, amount: 60 } }),
      txt({ name: 'Text', text: '???', x: cx, y: cy - 25 * k, size: 110 * k, fill: '#2d8ceb', loop: { type: 'float', speed: 1, amount: 60 } }),
    ];
  }
  return [];
}
