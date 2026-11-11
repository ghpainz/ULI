// Keyframe değerlendirme. Param: { v, kf: [{f, v, e}] | null }  (f: klibe göre kare)
// e: 'linear' | 'hold' | 'ease' | 'easeIn' | 'easeOut' | 'bezier'
// bezier (sayısal değerler, eğri editörü): a.ho = [x (0..1, segmentin oranı), y (değer farkı)] çıkış tutamağı,
// b.hi = [x (0..1), y (değer farkı)] giriş tutamağı. Varsayılan düz (yumuşak) tutamaklar.

function ease(e, t) {
  switch (e) {
    case 'hold': return 0;
    case 'ease': return t * t * (3 - 2 * t);
    case 'easeIn': return t * t;
    case 'easeOut': return 1 - (1 - t) * (1 - t);
    default: return t;
  }
}

function mix(a, b, t) {
  if (Array.isArray(a)) return a.map((x, i) => x + ((b[i] ?? x) - x) * t);
  if (typeof a === 'number') return a + (b - a) * t;
  return t < 1 ? a : b;
}

export const BEZ_DEFAULT = [1 / 3, 0];
const cub = (p0, p1, p2, p3, t) => { const u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3; };
// a -> b bezier segmentinde f karesindeki değer (x(t) = f çözülür)
export function bezierValue(a, b, f) {
  const span = b.f - a.f || 1;
  const ho = a.ho || BEZ_DEFAULT, hi = b.hi || BEZ_DEFAULT;
  const x1 = a.f + Math.max(0, Math.min(1, ho[0])) * span, x2 = b.f - Math.max(0, Math.min(1, hi[0])) * span;
  let lo = 0, hiT = 1, t = (f - a.f) / span;
  for (let i = 0; i < 40; i++) {
    const x = cub(a.f, x1, x2, b.f, t);
    if (Math.abs(x - f) < 1e-5) break;
    if (x < f) lo = t; else hiT = t;
    t = (lo + hiT) / 2;
  }
  return cub(a.v, a.v + ho[1], b.v + hi[1], b.v, t);
}

export function evalParam(p, f) {
  if (!p) return undefined;
  if (!p.kf || p.kf.length === 0) return p.v;
  const k = p.kf;
  if (f <= k[0].f) return k[0].v;
  if (f >= k[k.length - 1].f) return k[k.length - 1].v;
  // ikili arama
  let lo = 0, hi = k.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (k[mid].f <= f) lo = mid; else hi = mid;
  }
  const a = k[lo], b = k[hi];
  const span = b.f - a.f;
  const t = span > 0 ? (f - a.f) / span : 1;
  if (a.e === 'bezier') {
    if (typeof a.v === 'number' && typeof b.v === 'number') return bezierValue(a, b, f);
    return mix(a.v, b.v, ease('ease', t));
  }
  return mix(a.v, b.v, ease(a.e || 'linear', t));
}

export function isAnimated(p) {
  return !!(p && p.kf && p.kf.length);
}

// Bir karede değeri ayarla: animasyonluysa keyframe ekle/güncelle, değilse sabit değeri değiştir
export function setParamAt(p, f, v) {
  if (!isAnimated(p)) {
    p.v = v;
    return;
  }
  f = Math.round(f);
  const k = p.kf;
  const existing = k.find((x) => x.f === f);
  if (existing) existing.v = v;
  else {
    k.push({ f, v, e: 'linear' });
    k.sort((a, b) => a.f - b.f);
  }
}

export function toggleAnimation(p, f) {
  if (isAnimated(p)) {
    p.v = evalParam(p, f);
    p.kf = null;
  } else {
    p.kf = [{ f: Math.round(f), v: structuredClone(p.v), e: 'linear' }];
  }
}

export function addKeyframe(p, f) {
  const v = evalParam(p, f);
  if (!p.kf) p.kf = [];
  f = Math.round(f);
  const ex = p.kf.find((x) => x.f === f);
  if (ex) ex.v = structuredClone(v);
  else p.kf.push({ f, v: structuredClone(v), e: 'linear' });
  p.kf.sort((a, b) => a.f - b.f);
}

export function removeKeyframeAt(p, f) {
  if (!p.kf) return;
  const removed = p.kf.find((x) => x.f === Math.round(f));
  p.kf = p.kf.filter((x) => x.f !== Math.round(f));
  if (p.kf.length === 0) {
    if (removed) p.v = structuredClone(removed.v);
    p.kf = null;
  }
}

export function keyframeAt(p, f) {
  if (!p || !p.kf) return null;
  return p.kf.find((x) => x.f === Math.round(f)) || null;
}

export function prevKeyframe(p, f) {
  if (!p || !p.kf) return null;
  let r = null;
  for (const k of p.kf) if (k.f < Math.round(f)) r = k;
  return r;
}

export function nextKeyframe(p, f) {
  if (!p || !p.kf) return null;
  for (const k of p.kf) if (k.f > Math.round(f)) return k;
  return null;
}

// Klip kırpıldığında keyframe'leri kaydır (sol kenar kırpma)
export function shiftKeyframes(clip, delta) {
  if (!delta) return;
  for (const p of allParams(clip)) if (p.kf) for (const k of p.kf) k.f -= delta;
}

function maskParams(masks, out) {
  for (const m of masks || []) for (const key of ['path', 'feather', 'opacity', 'expansion']) if (m[key]) out.push(m[key]);
}

export function allParams(clip) {
  const out = [];
  for (const key in clip.props) if (clip.props[key] && typeof clip.props[key] === 'object' && 'v' in clip.props[key]) out.push(clip.props[key]);
  for (const fx of clip.effects || []) {
    for (const key in fx.params) out.push(fx.params[key]);
    maskParams(fx.masks, out);
  }
  maskParams(clip.masks, out);
  return out;
}

// Sabit değere ve tüm keyframe değerlerine aynı dönüşümü uygula (ör. maske yoluna nokta ekleme)
export function mapParamValues(p, fn) {
  if (p.v != null) p.v = fn(p.v);
  if (p.kf) for (const k of p.kf) k.v = fn(k.v);
}

// Hızlı değişimde keyframe zamanlarını ölçekle
export function scaleKeyframes(clip, ratio) {
  for (const p of allParams(clip)) if (p.kf) for (const k of p.kf) k.f = Math.round(k.f * ratio);
}
