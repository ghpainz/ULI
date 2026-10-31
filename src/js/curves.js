// Lumetri eğrileri: monoton kübik (Fritsch–Carlson) eğri ve 256 girişli arama tablosu
// Eğri değeri: { m, r, g, b: [x0, y0, x1, y1, ...] (0..1), hs: [hue0, çarpan0, ...] (hue 0..1, çarpan 0..2) }

export const DEFAULT_CURVES = { m: [0, 0, 1, 1], r: [0, 0, 1, 1], g: [0, 0, 1, 1], b: [0, 0, 1, 1], hs: [] };

export function curvesActive(c) {
  if (!c) return false;
  const id = (a) => !a || (a.length === 4 && a[0] === 0 && a[1] === 0 && a[2] === 1 && a[3] === 1);
  return !(id(c.m) && id(c.r) && id(c.g) && id(c.b) && !(c.hs && c.hs.some((v, i) => i % 2 === 1 && Math.abs(v - 1) > 1e-4)));
}

function points(flat) {
  const p = [];
  for (let i = 0; i + 1 < (flat || []).length; i += 2) p.push([flat[i], flat[i + 1]]);
  p.sort((a, b) => a[0] - b[0]);
  return p;
}

// Monoton kübik interpolasyon fonksiyonu döndürür
export function monotoneSpline(flat) {
  const p = points(flat);
  if (p.length === 0) return (x) => x;
  if (p.length === 1) return () => p[0][1];
  const n = p.length;
  const dx = [], dy = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx.push(Math.max(1e-6, p[i + 1][0] - p[i][0])); dy.push((p[i + 1][1] - p[i][1]) / dx[i]); }
  m.push(dy[0]);
  for (let i = 1; i < n - 1; i++) m.push(dy[i - 1] * dy[i] <= 0 ? 0 : (dy[i - 1] + dy[i]) / 2);
  m.push(dy[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (dy[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / dy[i], b = m[i + 1] / dy[i];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * dy[i]; m[i + 1] = t * b * dy[i]; }
  }
  return (x) => {
    if (x <= p[0][0]) return p[0][1];
    if (x >= p[n - 1][0]) return p[n - 1][1];
    let i = 0;
    while (i < n - 2 && x > p[i + 1][0]) i++;
    const h = dx[i], t = (x - p[i][0]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}

// Periyodik (hue) eğri: noktalar 0..1 aralığında, uçlar sarılır
export function periodicSpline(flat) {
  const p = points(flat);
  if (!p.length) return () => 1;
  const ext = [...p.map(([x, y]) => [x - 1, y]), ...p, ...p.map(([x, y]) => [x + 1, y])];
  const f = monotoneSpline(ext.flat());
  return (x) => f(((x % 1) + 1) % 1);
}

// RGBA8 256x1: R,G,B = kanal∘ana eğri, A = hue'ya göre doygunluk çarpanı / 2
export function buildCurveLUT(c) {
  const cv = { ...DEFAULT_CURVES, ...(c || {}) };
  const fm = monotoneSpline(cv.m), fr = monotoneSpline(cv.r), fg = monotoneSpline(cv.g), fb = monotoneSpline(cv.b);
  const fh = periodicSpline(cv.hs);
  const out = new Uint8Array(256 * 4);
  const q = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    const mv = Math.max(0, Math.min(1, fm(x)));
    out[i * 4] = q(fr(mv));
    out[i * 4 + 1] = q(fg(mv));
    out[i * 4 + 2] = q(fb(mv));
    out[i * 4 + 3] = q(Math.max(0, Math.min(2, fh(x))) / 2);
  }
  return out;
}
