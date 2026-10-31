// Maske takibinin saf hesaplama çekirdeği (DOM/Node bağımlılığı yok, test edilebilir)
import * as MG from './maskGeom.js';

const tr = (s) => s;

export function integral(img, w, h) {
  const W = w + 1;
  const S = new Float64Array(W * (h + 1)), S2 = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0, rs2 = 0;
    for (let x = 0; x < w; x++) {
      const v = img[y * w + x];
      rs += v; rs2 += v * v;
      S[(y + 1) * W + x + 1] = S[y * W + x + 1] + rs;
      S2[(y + 1) * W + x + 1] = S2[y * W + x + 1] + rs2;
    }
  }
  return { S, S2, W };
}

function boxSum(I, A, x0, y0, x1, y1) {
  const W = I.W;
  return A[y1 * W + x1] - A[y0 * W + x1] - A[y1 * W + x0] + A[y0 * W + x0];
}

// Şablonu (prev, merkez cx,cy, yarıçap r) cur içinde (px,py) civarında ±R ara. Döner {x, y, score}
export function matchPatch(prev, cur, curInt, w, h, cx, cy, r, px, py, R) {
  const tx = Math.round(cx), ty = Math.round(cy);
  if (tx - r < 0 || ty - r < 0 || tx + r >= w || ty + r >= h) return null;
  const n = (2 * r + 1) * (2 * r + 1);
  const T = new Float32Array(n);
  let sum = 0, sum2 = 0, k = 0;
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const v = prev[(ty + y) * w + tx + x]; T[k++] = v; sum += v; sum2 += v * v; }
  const mT = sum / n;
  const sT = Math.sqrt(Math.max(1e-6, sum2 / n - mT * mT));
  if (sT < 2) return null; // dokusuz bölge
  const score = (ix, iy) => {
    if (ix - r < 0 || iy - r < 0 || ix + r >= w || iy + r >= h) return -2;
    const sI = boxSum(curInt, curInt.S, ix - r, iy - r, ix + r + 1, iy + r + 1);
    const sI2 = boxSum(curInt, curInt.S2, ix - r, iy - r, ix + r + 1, iy + r + 1);
    const mI = sI / n;
    const vI = Math.sqrt(Math.max(1e-6, sI2 / n - mI * mI));
    let st = 0, kk = 0;
    for (let y = -r; y <= r; y++) {
      const row = (iy + y) * w + ix;
      for (let x = -r; x <= r; x++) st += T[kk++] * cur[row + x];
    }
    return (st / n - mT * mI) / (sT * vI);
  };
  const bx0 = Math.round(px), by0 = Math.round(py);
  let best = -3, bx = bx0, by = by0;
  // kaba arama (adım 2) + ince arama
  for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) {
    const s = score(bx0 + dx, by0 + dy);
    if (s > best) { best = s; bx = bx0 + dx; by = by0 + dy; }
  }
  const cx2 = bx, cy2 = by;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const s = score(cx2 + dx, cy2 + dy);
    if (s > best) { best = s; bx = cx2 + dx; by = cy2 + dy; }
  }
  // alt piksel: parabol
  const sx0 = score(bx - 1, by), sx1 = score(bx + 1, by), sy0 = score(bx, by - 1), sy1 = score(bx, by + 1);
  const ox = sx0 > -2 && sx1 > -2 ? (sx0 - sx1) / (2 * (sx0 - 2 * best + sx1) || 1) : 0;
  const oy = sy0 > -2 && sy1 > -2 ? (sy0 - sy1) / (2 * (sy0 - 2 * best + sy1) || 1) : 0;
  // şablon yuvarlanmış merkezden alındı: kesirli kısmı geri ekle (yoksa her karede kayma birikir)
  return { x: bx + Math.max(-0.5, Math.min(0.5, ox)) + (cx - tx), y: by + Math.max(-0.5, Math.min(0.5, oy)) + (cy - ty), score: best };
}

// En küçük kareler benzerlik dönüşümü: P -> Q
export function fitSimilarity(P, Q) {
  const n = P.length;
  let pcx = 0, pcy = 0, qcx = 0, qcy = 0;
  for (let i = 0; i < n; i++) { pcx += P[i][0]; pcy += P[i][1]; qcx += Q[i][0]; qcy += Q[i][1]; }
  pcx /= n; pcy /= n; qcx /= n; qcy /= n;
  let a = 0, b = 0, d = 0;
  for (let i = 0; i < n; i++) {
    const px = P[i][0] - pcx, py = P[i][1] - pcy, qx = Q[i][0] - qcx, qy = Q[i][1] - qcy;
    a += px * qx + py * qy;
    b += px * qy - py * qx;
    d += px * px + py * py;
  }
  if (d < 1e-9) return { s: 1, rot: 0, tx: qcx - pcx, ty: qcy - pcy };
  a /= d; b /= d;
  const s = Math.hypot(a, b), rot = Math.atan2(b, a);
  const c = Math.cos(rot) * s, sn = Math.sin(rot) * s;
  return { s, rot, tx: qcx - (c * pcx - sn * pcy), ty: qcy - (sn * pcx + c * pcy) };
}

// frames: işleme sırasındaki kareler. Döner: her kare için dönüşüm (başlangıç karesine göre, tam çözünürlük koordinatları) ya da null (kayıp)
export async function trackFrames(frames, w, h, scale, startPath, type, method, onStep) {
  const bb = MG.bbox(type, startPath);
  if (!bb || bb.w < 2 || bb.h < 2) throw new Error(tr('Mask is too small to track'));
  const cx = (bb.x + bb.w / 2) * scale, cy = (bb.y + bb.h / 2) * scale;
  const bw = bb.w * scale, bh = bb.h * scale;
  let pts, r;
  if (method === 'position') {
    pts = [[cx, cy]];
    r = Math.round(Math.max(6, Math.min(40, Math.min(bw, bh) * 0.35)));
  } else {
    const ox = bw * 0.28, oy = bh * 0.28;
    pts = [[cx, cy], [cx - ox, cy - oy], [cx + ox, cy - oy], [cx + ox, cy + oy], [cx - ox, cy + oy]];
    r = Math.round(Math.max(5, Math.min(24, Math.min(bw, bh) * 0.16)));
  }
  const init = pts.map((p) => [...p]);
  let curPts = pts.map((p) => [...p]);
  let vel = pts.map(() => [0, 0]);
  let alive = pts.map(() => true);
  const R = Math.round(Math.max(12, Math.min(48, r * 1.5)));
  const results = [{ s: 1, rot: 0, tx: 0, ty: 0 }];
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1], cur = frames[i];
    const ci = integral(cur, w, h);
    const next = [];
    for (let k = 0; k < curPts.length; k++) {
      if (!alive[k]) { next.push(null); continue; }
      const [x, y] = curPts[k];
      const m = matchPatch(prev, cur, ci, w, h, x, y, r, x + vel[k][0], y + vel[k][1], R);
      if (!m || m.score < 0.55) { alive[k] = false; next.push(null); continue; }
      vel[k] = [m.x - x, m.y - y];
      next.push([m.x, m.y]);
    }
    const P = [], Q = [];
    next.forEach((q, k) => { if (q) { P.push(init[k]); Q.push(q); curPts[k] = q; } });
    if (!P.length) break; // takip kaybedildi
    let T;
    if (method === 'position' || P.length < 3) {
      // yalnızca öteleme: geçerli yamaların ortalama kayması
      let dx = 0, dy = 0;
      for (let k = 0; k < P.length; k++) { dx += Q[k][0] - P[k][0]; dy += Q[k][1] - P[k][1]; }
      T = { s: 1, rot: 0, tx: dx / P.length, ty: dy / P.length };
    } else {
      T = fitSimilarity(P, Q);
      // aykırı yamaları ele: büyük artık değerliyi kapat
      const c = Math.cos(T.rot) * T.s, sn = Math.sin(T.rot) * T.s;
      next.forEach((q, k) => {
        if (!q) return;
        const ex = c * init[k][0] - sn * init[k][1] + T.tx - q[0], ey = sn * init[k][0] + c * init[k][1] + T.ty - q[1];
        if (Math.hypot(ex, ey) > Math.max(3, r * 0.6)) alive[k] = false;
      });
    }
    // analiz -> tam çözünürlük (öteleme ölçeklenir; s ve rot aynı kalır)
    results.push({ s: T.s, rot: T.rot, tx: T.tx / scale, ty: T.ty / scale });
    if (onStep && onStep(i / (frames.length - 1)) === false) break;
    if (i % 4 === 0) await new Promise((res) => setTimeout(res, 0));
  }
  return results;
}

