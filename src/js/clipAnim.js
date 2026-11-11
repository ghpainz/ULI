// Klip animasyonları (CapCut tarzı): giriş, çıkış ve tüm klip boyunca süren kombo hareketler.
// clip.anim = { in: { type, dur (sn) }, out: { type, dur }, combo: { type, speed, amount } }
// Sonuç dönüşüme eklenir: kayma (dx, dy sekans px), ölçek, yatay ölçek (çevirme), döndürme (derece), opaklık, bulanıklık.

export const ANIM_IN = [
  ['fade', 'Fade In'], ['zoomIn', 'Grow'], ['zoomOut', 'Shrink'], ['pop', 'Pop Up'], ['bounce', 'Spring'],
  ['slideL', 'Slide Left'], ['slideR', 'Slide Right'], ['slideU', 'Slide Up'], ['slideD', 'Slide Down'], ['drop', 'Drop'],
  ['rotate', 'Rotate'], ['spin', 'Spin'], ['swing', 'Swing'], ['shake', 'Shake'], ['flip', 'Flip'], ['blur', 'Blur'],
];
export const ANIM_OUT = [
  ['fade', 'Fade Out'], ['zoomIn', 'Grow'], ['zoomOut', 'Shrink'], ['pop', 'Pop Up'], ['bounce', 'Spring'],
  ['slideL', 'Slide Left'], ['slideR', 'Slide Right'], ['slideU', 'Slide Up'], ['slideD', 'Slide Down'], ['drop', 'Fall'],
  ['rotate', 'Rotate'], ['spin', 'Spin'], ['swing', 'Swing'], ['shake', 'Shake'], ['flip', 'Flip'], ['blur', 'Blur'],
];
export const ANIM_COMBO = [
  ['zoomSlow', 'Slow Zoom In'], ['zoomOutSlow', 'Slow Zoom Out'], ['rock', 'Rock'], ['pulse', 'Pulse'], ['shake', 'Shake'],
  ['wobble', 'Wobble'], ['jump', 'Jump'], ['sway', 'Sway'], ['spin', 'Spin'], ['heartbeat', 'Heartbeat'],
];

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const bounceOut = (t) => {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};
const noise = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// Giriş biçimi; p: 0 (başlangıç) .. 1 (tam görünür). out=true ise kayma/dönüş yönleri çıkışa göre çevrilir.
function enter(o, type, p, W, H, out) {
  const e = easeOut(Math.max(0, Math.min(1, p)));
  const q = 1 - e;
  const dir = out ? -1 : 1;
  switch (type) {
    case 'fade': o.alpha *= e; break;
    case 'zoomIn': if (out) { o.s *= 1 + 0.5 * q; o.alpha *= Math.min(1, p * 2); } else { o.s *= 0.5 + 0.5 * e; o.alpha *= Math.min(1, p * 2); } break;
    case 'zoomOut': if (out) { o.s *= 0.5 + 0.5 * e; o.alpha *= Math.min(1, p * 2); } else { o.s *= 1 + 0.5 * q; o.alpha *= Math.min(1, p * 2); } break;
    case 'pop': o.s *= p < 0.6 ? 1.12 * (p / 0.6) : 1.12 - 0.12 * ((p - 0.6) / 0.4); o.alpha *= Math.min(1, p * 4); break;
    case 'bounce': o.s *= Math.max(0, easeBack(Math.max(0, p))); break;
    case 'slideL': o.dx += dir * q * W; break;
    case 'slideR': o.dx -= dir * q * W; break;
    case 'slideU': o.dy += dir * q * H; break;
    case 'slideD': o.dy -= dir * q * H; break;
    case 'drop': o.dy -= (1 - (out ? e : bounceOut(Math.max(0, p)))) * H * (out ? -1 : 1); break;
    case 'rotate': o.rot -= dir * q * 90; o.s *= 0.6 + 0.4 * e; o.alpha *= Math.min(1, p * 2); break;
    case 'spin': o.rot -= dir * q * 360; o.s *= e; break;
    case 'swing': o.rot += 25 * Math.exp(-5 * p) * Math.cos(p * 14) * (p < 1 ? 1 : 0); o.alpha *= Math.min(1, p * 3); break;
    case 'shake': o.dx += Math.sin(p * 40) * W * 0.03 * q; o.alpha *= Math.min(1, p * 3); break;
    case 'flip': o.sx *= Math.max(0.001, e); break;
    case 'blur': o.blur += q * Math.min(W, H) * 0.06; o.alpha *= Math.min(1, p * 1.5); break;
  }
}

function combo(o, c, t, D, W, H) {
  const sp = c.speed || 1, k = (c.amount ?? 100) / 100;
  const ph = t * sp * Math.PI * 2;
  const u = D > 0 ? Math.max(0, Math.min(1, t / D)) : 0;
  switch (c.type) {
    case 'zoomSlow': o.s *= 1 + 0.15 * k * u; break;
    case 'zoomOutSlow': o.s *= 1 + 0.15 * k * (1 - u); break;
    case 'rock': o.rot += 6 * k * Math.sin(ph); break;
    case 'pulse': o.s *= 1 + 0.05 * k * Math.sin(ph); break;
    case 'shake': { const n = Math.floor(t * 20 * sp); o.dx += (noise(n) - 0.5) * W * 0.02 * k; o.dy += (noise(n + 77) - 0.5) * H * 0.02 * k; break; }
    case 'wobble': o.rot += 4 * k * Math.sin(ph); o.s *= 1 + 0.04 * k * Math.sin(ph * 2); break;
    case 'jump': o.dy -= Math.abs(Math.sin(ph / 2)) * H * 0.05 * k; break;
    case 'sway': o.dx += Math.sin(ph) * W * 0.03 * k; break;
    case 'spin': o.rot += 90 * k * t * sp; break;
    case 'heartbeat': { const f = (t * sp) % 1; o.s *= 1 + 0.07 * k * (Math.exp(-Math.pow((f - 0.1) * 14, 2)) + 0.7 * Math.exp(-Math.pow((f - 0.32) * 14, 2))); break; }
  }
}

export function hasClipAnim(clip) {
  const a = clip && clip.anim;
  return !!(a && ((a.in && a.in.type) || (a.out && a.out.type) || (a.combo && a.combo.type)));
}

// local: klibin yerel karesi (ondalıklı olabilir)
export function clipAnimState(clip, local, fps, W, H) {
  const o = { dx: 0, dy: 0, s: 1, sx: 1, rot: 0, alpha: 1, blur: 0 };
  const a = clip.anim;
  if (!a) return o;
  const t = local / fps, D = clip.duration / fps;
  if (a.combo && a.combo.type) combo(o, a.combo, t, D, W, H);
  if (a.in && a.in.type) { const d = Math.max(0.05, a.in.dur || 0.5); if (t < d) enter(o, a.in.type, t / d, W, H, false); }
  if (a.out && a.out.type) { const d = Math.max(0.05, a.out.dur || 0.5); const r = D - t; if (r < d) enter(o, a.out.type, Math.max(0, r) / d, W, H, true); }
  return o;
}

// Önizleme küçük resmi: örnek görseli animasyonun t (0..1) anındaki haliyle 2D tuvale çiz
export function drawAnimThumb(canvas, sample, kind, type, t) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.fillStyle = '#15171c'; g.fillRect(0, 0, W, H);
  const fps = 30, D = 2;
  const clip = { duration: D * fps, anim: {} };
  let local;
  if (kind === 'in') { clip.anim.in = { type, dur: 1 }; local = Math.min(1, t * 1.25) * fps; }
  else if (kind === 'out') { clip.anim.out = { type, dur: 1 }; local = (1 + Math.min(1, t * 1.25)) * fps - 0.01; }
  else { clip.anim.combo = { type, speed: 1, amount: 100 }; local = t * D * fps; }
  const o = clipAnimState(clip, local, fps, W, H);
  g.save();
  g.globalAlpha = Math.max(0, Math.min(1, o.alpha));
  g.translate(W / 2 + o.dx, H / 2 + o.dy);
  g.rotate((o.rot * Math.PI) / 180);
  g.scale(o.s * 0.78 * o.sx, o.s * 0.78);
  if (o.blur > 0.3) g.filter = `blur(${(o.blur * 0.5).toFixed(1)}px)`;
  g.drawImage(sample, -W / 2, -H / 2, W, H);
  g.restore();
}
