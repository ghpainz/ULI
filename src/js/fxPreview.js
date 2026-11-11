// Efekt tarayıcısı küçük resimleri: örnek bir görsel üzerinde efekt / geçiş / ön ayar shader'larını çizer.
// Tek bir WebGL2 bağlamı paylaşılır; sonuç 2D tuvallere kopyalanır.
import { EFFECTS, TRANSITIONS, FX_HEADER, TRANSITION_HEADER } from './effectsDef.js';

export const THUMB_W = 160, THUMB_H = 90;

const VS = `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

let ctx = null;

// Örnek sahne: gün batımı, dağlar, güneş, ön planda figür ve renkli objeler
function drawSample(c, night = false) {
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  const sky = g.createLinearGradient(0, 0, 0, H * 0.7);
  if (night) { sky.addColorStop(0, '#0b1640'); sky.addColorStop(1, '#3a2a6e'); }
  else { sky.addColorStop(0, '#2b6cd4'); sky.addColorStop(0.55, '#f2a65a'); sky.addColorStop(1, '#ffd98a'); }
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  g.fillStyle = night ? '#f4f1d0' : '#fff4c0';
  g.beginPath(); g.arc(W * 0.7, H * 0.42, H * 0.13, 0, Math.PI * 2); g.fill();
  const hill = (y, col, amp, ph) => {
    g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) g.lineTo(x, y + Math.sin(x / W * 6 + ph) * amp + Math.sin(x / W * 17 + ph * 2) * amp * 0.3);
    g.lineTo(W, H); g.fill();
  };
  hill(H * 0.58, night ? '#2a2550' : '#7a5aa0', H * 0.06, 1);
  hill(H * 0.7, night ? '#1a2238' : '#2f6d4a', H * 0.05, 3);
  hill(H * 0.84, night ? '#0e1424' : '#1f4a30', H * 0.03, 5);
  // figür
  g.fillStyle = '#141414';
  g.beginPath(); g.arc(W * 0.3, H * 0.6, H * 0.055, 0, Math.PI * 2); g.fill();
  g.fillRect(W * 0.285, H * 0.65, W * 0.03, H * 0.2);
  // renkli balonlar
  for (const [x, y, col] of [[0.12, 0.3, '#e8423f'], [0.2, 0.22, '#f2c230'], [0.88, 0.25, '#38b6e8']]) {
    g.fillStyle = col; g.beginPath(); g.ellipse(W * x, H * y, H * 0.05, H * 0.065, 0, 0, Math.PI * 2); g.fill();
  }
  // ince detay (keskinlik/kenar efektleri için)
  g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1;
  for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(W * 0.5 + i * 5, H * 0.9); g.lineTo(W * 0.5 + i * 5, H * 0.98); g.stroke(); }
}

// 2D örnek görsel (klip animasyonu küçük resimleri için)
let sample2d = null;
export function sampleCanvas() {
  if (!sample2d) { sample2d = document.createElement('canvas'); sample2d.width = THUMB_W * 2; sample2d.height = THUMB_H * 2; drawSample(sample2d); }
  return sample2d;
}

function init() {
  if (ctx) return ctx;
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_W; canvas.height = THUMB_H;
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
  if (!gl) return null;
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const tex = (src) => {
    const tx = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tx;
  };
  const s1 = document.createElement('canvas'); s1.width = THUMB_W * 2; s1.height = THUMB_H * 2; drawSample(s1);
  const s2 = document.createElement('canvas'); s2.width = THUMB_W * 2; s2.height = THUMB_H * 2; drawSample(s2, true);
  const fbo = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, THUMB_W, THUMB_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { f, t };
  };
  const dummy3d = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D, dummy3d);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  const dummy2d = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, dummy2d);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  ctx = { canvas, gl, buf, sampleA: tex(s1), sampleB: tex(s2), targets: [fbo(), fbo()], progs: new Map(), dummy3d, dummy2d, failed: new Set() };
  return ctx;
}

function program(key, fs) {
  const { gl, progs, failed } = ctx;
  if (progs.has(key)) return progs.get(key);
  if (failed.has(key)) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  try {
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a_pos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = new Map();
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u.set(info.name, gl.getUniformLocation(p, info.name)); }
    const r = { p, u };
    progs.set(key, r);
    return r;
  } catch (e) {
    console.warn('fxPreview', key, e.message);
    failed.add(key);
    return null;
  }
}

const hexRgb = (h) => { const n = parseInt(String(h || '#000000').slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

function draw(prog, target) {
  const { gl, buf } = ctx;
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.f : null);
  gl.viewport(0, 0, THUMB_W, THUMB_H);
  gl.useProgram(prog.p);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.BLEND);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function setFxUniforms(prog, def, params, time) {
  const { gl } = ctx;
  const U = (n) => prog.u.get(n);
  const f1 = (n, v) => { const l = U(n); if (l) gl.uniform1f(l, v); };
  f1('u_time', time); f1('u_local', time); f1('u_srcScale', THUMB_W / 640);
  const ls = U('u_size'); if (ls) gl.uniform2f(ls, THUMB_W, THUMB_H);
  // diğer örnekleyiciler: ayrı birimlerde boş dokular
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, ctx.dummy3d); if (U('u_lutTex')) gl.uniform1i(U('u_lutTex'), 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, ctx.dummy2d); if (U('u_curveTex')) gl.uniform1i(U('u_curveTex'), 2);
  gl.activeTexture(gl.TEXTURE0);
  if (U('u_tex')) gl.uniform1i(U('u_tex'), 0);
  for (const pd of def.params) {
    const v = params && pd.key in params ? (params[pd.key] && typeof params[pd.key] === 'object' && 'v' in params[pd.key] ? params[pd.key].v : params[pd.key]) : pd.default;
    const n = 'u_' + pd.key;
    const l = U(n);
    if (!l) continue;
    if (pd.type === 'color') { const [r, g, b] = hexRgb(v); gl.uniform3f(l, r, g, b); }
    else if (pd.type === 'bool') gl.uniform1f(l, v ? 1 : 0);
    else if (pd.type === 'point') gl.uniform2f(l, v?.[0] || 0, v?.[1] || 0);
    else if (pd.type === 'lut' || pd.type === 'curves' || pd.type === 'stabdata') continue;
    else gl.uniform1f(l, Number(v) || 0);
  }
  if (def.passes) { const ld = U('u_dir'); if (ld) gl.uniform2f(ld, 1, 0); }
}

// effects: [{ type, params }] — boşsa yalnız örnek görsel
function renderChain(effects, time) {
  const { gl } = ctx;
  let src = ctx.sampleA;
  let ti = 0;
  const copy = program('copy', FX_HEADER + 'void main(){ o = texture(u_tex, v_uv); }');
  const list = effects.filter((e) => EFFECTS[e.type] && !EFFECTS[e.type].stab);
  if (!list.length) list.push(null);
  list.forEach((e, i) => {
    const last = i === list.length - 1;
    const def = e ? EFFECTS[e.type] : null;
    const prog = def ? program('fx:' + e.type, FX_HEADER + def.shader) : copy;
    if (!prog) return;
    gl.useProgram(prog.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    if (def) setFxUniforms(prog, def, e.params, time);
    else { gl.uniform1i(prog.u.get('u_tex'), 0); }
    const tgt = last ? null : ctx.targets[ti];
    draw(prog, tgt);
    if (!last) { src = tgt.t; ti = 1 - ti; }
  });
}

function renderTransition(type, p) {
  const { gl } = ctx;
  const def = TRANSITIONS[type];
  const prog = def && program('tr:' + type, TRANSITION_HEADER + def.shader);
  if (!prog) return false;
  gl.useProgram(prog.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ctx.sampleA);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ctx.sampleB);
  gl.activeTexture(gl.TEXTURE0);
  if (prog.u.get('u_a')) gl.uniform1i(prog.u.get('u_a'), 0);
  if (prog.u.get('u_b')) gl.uniform1i(prog.u.get('u_b'), 1);
  if (prog.u.get('u_p')) gl.uniform1f(prog.u.get('u_p'), p);
  if (prog.u.get('u_size')) gl.uniform2f(prog.u.get('u_size'), THUMB_W, THUMB_H);
  draw(prog, null);
  return true;
}

// Bir küçük resim tuvaline çiz. what: { kind: 'effect'|'transition'|'preset', type?, effects? }, t: 0..1 animasyon fazı
export function drawThumb(canvas, what, t = 0.5) {
  if (!init()) return false;
  const g2 = canvas.getContext('2d');
  if (what.kind === 'transition') {
    if (!renderTransition(what.type, t)) return false;
  } else {
    const effects = what.kind === 'effect' ? [{ type: what.type, params: null }] : what.effects;
    renderChain(effects, t * 4);
  }
  g2.clearRect(0, 0, canvas.width, canvas.height);
  g2.drawImage(ctx.canvas, 0, 0, canvas.width, canvas.height);
  return true;
}

// Tüm shader'ları derlemeyi dener; başarısız olanların listesi (test için)
export function compileAll() {
  if (!init()) return ['no webgl2'];
  const bad = [];
  for (const [k, d] of Object.entries(EFFECTS)) if (d.shader && !program('fx:' + k, FX_HEADER + d.shader)) bad.push('fx:' + k);
  for (const [k, d] of Object.entries(TRANSITIONS)) if (d.shader && !program('tr:' + k, TRANSITION_HEADER + d.shader)) bad.push('tr:' + k);
  return bad;
}
