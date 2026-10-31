// Maske geometrisi. path düz dizi:
//  ellipse: [x, y, w, h]
//  polygon: [x0, y0, x1, y1, ...]
//  bezier : [x, y, inX, inY, outX, outY, ...]  (tutamaklar köşeye göre göreli)

export const STRIDE = { polygon: 2, bezier: 6 };

export function vertices(type, path) {
  const out = [];
  if (!path) return out;
  if (type === 'bezier') {
    for (let i = 0; i + 5 < path.length; i += 6) out.push({ x: path[i], y: path[i + 1], ix: path[i + 2], iy: path[i + 3], ox: path[i + 4], oy: path[i + 5] });
  } else if (type === 'polygon') {
    for (let i = 0; i + 1 < path.length; i += 2) out.push({ x: path[i], y: path[i + 1], ix: 0, iy: 0, ox: 0, oy: 0 });
  }
  return out;
}

export function vertexCount(type, path) {
  if (type === 'ellipse') return 0;
  return Math.floor((path || []).length / STRIDE[type]);
}

export function toBezier(path) {
  const out = [];
  for (let i = 0; i + 1 < path.length; i += 2) out.push(path[i], path[i + 1], 0, 0, 0, 0);
  return out;
}

function cubic(a, b, c, d, t) {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

// Kapalı yolu çokgene düzleştir (kaynak koordinatları). steps: eğri başına örnek
export function flatten(type, path, steps = 16) {
  const pts = [];
  if (!path) return pts;
  if (type === 'ellipse') {
    if (path.length < 4) return pts;
    const [x, y, w, h] = path;
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      pts.push([x + w / 2 + (Math.cos(a) * w) / 2, y + h / 2 + (Math.sin(a) * h) / 2]);
    }
    return pts;
  }
  const v = vertices(type, path);
  if (type === 'polygon' || v.every((p) => !p.ix && !p.iy && !p.ox && !p.oy)) return v.map((p) => [p.x, p.y]);
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    const straight = !a.ox && !a.oy && !b.ix && !b.iy;
    const n = straight ? 1 : steps;
    for (let s = 0; s < n; s++) {
      const t = s / n;
      pts.push([cubic(a.x, a.x + a.ox, b.x + b.ix, b.x, t), cubic(a.y, a.y + a.oy, b.y + b.iy, b.y, t)]);
    }
  }
  return pts;
}

// Canvas Path2D (k: kaynak -> canvas ölçeği). Geçersizse null
export function buildPath2D(type, path, k) {
  const p2d = new Path2D();
  if (type === 'ellipse') {
    if (!path || path.length < 4) return null;
    const [x, y, w, h] = path;
    p2d.ellipse((x + w / 2) * k, (y + h / 2) * k, Math.max(0.5, Math.abs(w / 2) * k), Math.max(0.5, Math.abs(h / 2) * k), 0, 0, Math.PI * 2);
    return p2d;
  }
  const v = vertices(type, path);
  if (v.length < 3) return null;
  p2d.moveTo(v[0].x * k, v[0].y * k);
  for (let i = 1; i <= v.length; i++) {
    const a = v[i - 1], b = v[i % v.length];
    if (type === 'bezier' && (a.ox || a.oy || b.ix || b.iy)) {
      p2d.bezierCurveTo((a.x + a.ox) * k, (a.y + a.oy) * k, (b.x + b.ix) * k, (b.y + b.iy) * k, b.x * k, b.y * k);
    } else p2d.lineTo(b.x * k, b.y * k);
  }
  p2d.closePath();
  return p2d;
}

export function pointInPolygon(pts, x, y) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

export function bbox(type, path) {
  const pts = flatten(type, path, 8);
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Benzerlik dönüşümü (s, rot, tx, ty) uygula: p' = s*R*p + t
export function transformPath(type, path, T) {
  const c = Math.cos(T.rot) * T.s, s = Math.sin(T.rot) * T.s;
  const pt = (x, y) => [c * x - s * y + T.tx, s * x + c * y + T.ty];
  const vec = (x, y) => [c * x - s * y, s * x + c * y];
  const r = (v) => Math.round(v * 10) / 10;
  if (type === 'ellipse') {
    // elips döndürülemez: merkezi taşı, boyutu ölçekle
    const [x, y, w, h] = path;
    const [cx, cy] = pt(x + w / 2, y + h / 2);
    const nw = w * T.s, nh = h * T.s;
    return [r(cx - nw / 2), r(cy - nh / 2), r(nw), r(nh)];
  }
  const out = [];
  const st = STRIDE[type];
  for (let i = 0; i + st - 1 < path.length; i += st) {
    const [x, y] = pt(path[i], path[i + 1]);
    out.push(r(x), r(y));
    if (type === 'bezier') {
      const [ix, iy] = vec(path[i + 2], path[i + 3]);
      const [ox, oy] = vec(path[i + 4], path[i + 5]);
      out.push(r(ix), r(iy), r(ox), r(oy));
    }
  }
  return out;
}
