// Warp Stabilizer matematiği (saf, DOM bağımsız).
// Benzerlik dönüşümü S = [a, b, tx, ty]:  p' = [a -b; b a] p + t   (koordinatlar: görüntü merkezine göre, y aşağı)

export const IDENT = [1, 0, 0, 0];

export function compose(M, N) {
  // (M ∘ N)(p) = M(N(p))
  const [a1, b1, x1, y1] = M, [a2, b2, x2, y2] = N;
  return [a1 * a2 - b1 * b2, a1 * b2 + b1 * a2, a1 * x2 - b1 * y2 + x1, b1 * x2 + a1 * y2 + y1];
}

export function invert(M) {
  const [a, b, x, y] = M;
  const d = a * a + b * b || 1e-12;
  const ia = a / d, ib = -b / d;
  return [ia, ib, -(ia * x - ib * y), -(ib * x + ia * y)];
}

export function apply(M, x, y) {
  return [M[0] * x - M[1] * y + M[2], M[1] * x + M[0] * y + M[3]];
}

function decompose(M) {
  return { s: Math.hypot(M[0], M[1]), r: Math.atan2(M[1], M[0]), x: M[2], y: M[3] };
}
function recompose(d) {
  return [d.s * Math.cos(d.r), d.s * Math.sin(d.r), d.x, d.y];
}

function gaussSmooth(arr, sigma) {
  if (sigma <= 0.01) return arr.slice();
  const n = arr.length, out = new Array(n);
  const R = Math.ceil(sigma * 3);
  const w = [];
  for (let k = -R; k <= R; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  for (let i = 0; i < n; i++) {
    let s = 0, ws = 0;
    for (let k = -R; k <= R; k++) {
      // uçlarda yansıtma: kenarlarda yolun kaymasını önler
      let j = i + k;
      if (j < 0) j = -j;
      if (j >= n) j = 2 * (n - 1) - j;
      j = Math.max(0, Math.min(n - 1, j));
      s += arr[j] * w[k + R];
      ws += w[k + R];
    }
    out[i] = s / ws;
  }
  return out;
}

// raw: kamera yolu C_t (kare 0 -> kare t), dizi. Döner: { residual: R_t (çıktı -> girdi), zoom }
// method: 0 = konum, ölçek, döndürme; 1 = yalnız konum. smoothness 0..100
export function solve(raw, W, H, { smoothness = 50, method = 0, crop = 0, extraScale = 100 } = {}) {
  const n = raw.length;
  if (!n) return { residual: [], zoom: 1 };
  const D = raw.map(decompose);
  // açıyı sürekli yap (atlamaları kaldır)
  for (let i = 1; i < n; i++) {
    while (D[i].r - D[i - 1].r > Math.PI) D[i].r -= 2 * Math.PI;
    while (D[i].r - D[i - 1].r < -Math.PI) D[i].r += 2 * Math.PI;
  }
  const sigma = (smoothness / 100) * 30 + 0.5;
  const sx = gaussSmooth(D.map((d) => d.x), sigma);
  const sy = gaussSmooth(D.map((d) => d.y), sigma);
  const sr = method === 1 ? D.map((d) => d.r) : gaussSmooth(D.map((d) => d.r), sigma);
  const ss = method === 1 ? D.map((d) => d.s) : gaussSmooth(D.map((d) => Math.log(d.s)), sigma).map(Math.exp);
  const residual = [];
  for (let i = 0; i < n; i++) {
    const S = recompose({ s: ss[i], r: sr[i], x: sx[i], y: sy[i] });
    residual.push(compose(raw[i], invert(S)));
  }
  // otomatik ölçek: çıktı köşeleri tüm karelerde girdi karesinin içinde kalsın
  let zoom = 1;
  if (crop === 0) {
    const inside = (z) => {
      for (const R of residual) {
        for (const [cx, cy] of [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]]) {
          const [x, y] = apply(R, cx / z, cy / z);
          if (Math.abs(x) > W / 2 + 0.5 || Math.abs(y) > H / 2 + 0.5) return false;
        }
      }
      return true;
    };
    let lo = 1, hi = 1.6;
    if (!inside(hi)) zoom = hi;
    else {
      for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (inside(mid)) hi = mid; else lo = mid; }
      zoom = hi;
    }
  }
  zoom *= extraScale / 100;
  return { residual, zoom };
}
