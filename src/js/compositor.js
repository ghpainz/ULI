// WebGL2 compositor: klipleri, efektleri, geçişleri ve harmanlama modlarını işler.
// Önizleme ve dışa aktarma aynı sınıfı kullanır (WYSIWYG).
import { FX_HEADER, EFFECTS, TRANSITIONS, TRANSITION_HEADER, BLEND_MODES } from './effectsDef.js';
import { evalParam } from './keyframes.js';
import { renderTextCanvas, textKey } from './text.js';
import { hexToRgb, nodeFs } from './util.js';
import { videoLayersAt } from './renderGraph.js';
import { buildPath2D } from './maskGeom.js';

const VS = `#version 300 es
in vec2 a_pos;
uniform mat3 u_mat;
out vec2 v_uv;
void main(){ v_uv=a_pos; vec3 p=u_mat*vec3(a_pos,1.0); gl_Position=vec4(p.xy,0.0,1.0); }`;

const FS_COPY = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform float u_opacity;
void main(){ o = texture(u_tex, v_uv) * u_opacity; }`;

const FS_PRESENT = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex;
void main(){ vec4 c = texture(u_tex, v_uv); o = vec4(c.rgb, 1.0); }`;

const FS_MIX = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_dst; uniform sampler2D u_src; uniform float u_amt;
void main(){ o = mix(texture(u_dst, v_uv), texture(u_src, v_uv), u_amt); }`;

const FS_BLEND = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_dst; uniform sampler2D u_src; uniform int u_mode;
vec3 unp(vec4 c){ return c.a > 0.00001 ? c.rgb / c.a : vec3(0.0); }
float lum(vec3 c){ return dot(c, vec3(0.3,0.59,0.11)); }
vec3 softl(vec3 b, vec3 s){
  vec3 d = mix(sqrt(b), ((16.0*b-12.0)*b+4.0)*b, step(b, vec3(0.25)));
  return mix(b - (1.0-2.0*s)*b*(1.0-b), b + (2.0*s-1.0)*(d-b), step(vec3(0.5), s));
}
vec3 hardl(vec3 b, vec3 s){ return mix(b*2.0*s, 1.0-(1.0-b)*(1.0-(2.0*s-1.0)), step(vec3(0.5), s)); }
vec3 bf(vec3 b, vec3 s, int m){
  if(m==1) return b*s;
  if(m==2) return b+s-b*s;
  if(m==3) return hardl(s,b);
  if(m==4) return min(b+s, vec3(1.0));
  if(m==5) return min(b,s);
  if(m==6) return max(b,s);
  if(m==7) return abs(b-s);
  if(m==8) return softl(b,s);
  if(m==9) return hardl(b,s);
  if(m==10) return mix(min(vec3(1.0), b/max(vec3(0.0001),1.0-s)), vec3(1.0), step(vec3(0.9999), s));
  if(m==11) return mix(1.0-min(vec3(1.0),(1.0-b)/max(vec3(0.0001),s)), vec3(0.0), step(s, vec3(0.0001)));
  if(m==12) return max(b-s, vec3(0.0));
  return s;
}
void main(){
  vec4 d = texture(u_dst, v_uv); vec4 s = texture(u_src, v_uv);
  if(u_mode==0){ o = s + d*(1.0-s.a); return; }
  vec3 cb = unp(d), cs = unp(s);
  vec3 B = clamp(bf(cb, cs, u_mode), 0.0, 1.0);
  vec3 rgb = s.a*(1.0-d.a)*cs + s.a*d.a*B + (1.0-s.a)*d.a*cb;
  o = vec4(rgb, s.a + d.a*(1.0-s.a));
}`;

const FS_MASKMUL = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform sampler2D u_mask;
void main(){ o = texture(u_tex, v_uv) * texture(u_mask, v_uv).a; }`;

const FS_MASKMIX = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_a; uniform sampler2D u_b; uniform sampler2D u_mask;
void main(){ o = mix(texture(u_a, v_uv), texture(u_b, v_uv), texture(u_mask, v_uv).a); }`;

const FULL = new Float32Array([2, 0, 0, 0, 2, 0, -1, -1, 1]);

// Maske listesini (kaynak piksel koordinatları) w×h boyutlu canvas'a çizer. k = w / kaynakGenişliği
export function rasterizeMasks(canvas, layer, masks, local, w, h, k) {
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  if (layer.width !== w || layer.height !== h) { layer.width = w; layer.height = h; }
  const ctx = canvas.getContext('2d');
  const lctx = layer.getContext('2d');
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, w, h);
  let first = true;
  for (const m of masks) {
    const path = evalParam(m.path, local) || [];
    const p2d = buildPath2D(m.type, path, k);
    if (!p2d) continue;
    const feather = Math.max(0, evalParam(m.feather, local) || 0) * k;
    const opacity = Math.max(0, Math.min(100, evalParam(m.opacity, local) ?? 100)) / 100;
    const exp = (evalParam(m.expansion, local) || 0) * k;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, w, h);
    lctx.filter = feather > 0.3 ? `blur(${(feather / 2).toFixed(2)}px)` : 'none';
    lctx.fillStyle = '#fff';
    lctx.strokeStyle = '#fff';
    lctx.lineJoin = 'round';
    const pad = feather * 3 + 4;
    if (m.inverted) {
      lctx.fillRect(-pad, -pad, w + pad * 2, h + pad * 2);
      lctx.globalCompositeOperation = 'destination-out';
    }
    lctx.fill(p2d);
    if (exp > 0) { lctx.lineWidth = exp * 2; lctx.stroke(p2d); }
    if (exp < 0) {
      lctx.globalCompositeOperation = m.inverted ? 'source-over' : 'destination-out';
      lctx.lineWidth = -exp * 2;
      lctx.stroke(p2d);
    }
    lctx.filter = 'none';
    const mode = first && m.mode !== 'subtract' ? 'add' : m.mode;
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = mode === 'subtract' ? 'destination-out' : mode === 'intersect' ? 'destination-in' : 'source-over';
    if (first && m.mode === 'subtract') {
      // ilk maske çıkarma ise önce tüm alanı doldur
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = 'destination-out';
    }
    ctx.drawImage(layer, 0, 0);
    first = false;
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return !first;
}

export function parseCube(text) {
  let size = 0;
  const vals = [];
  let dmin = [0, 0, 0], dmax = [1, 1, 1];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const up = line.toUpperCase();
    if (up.startsWith('LUT_3D_SIZE')) { size = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (up.startsWith('DOMAIN_MIN')) { dmin = line.split(/\s+/).slice(1).map(Number); continue; }
    if (up.startsWith('DOMAIN_MAX')) { dmax = line.split(/\s+/).slice(1).map(Number); continue; }
    if (/^[A-Z_]/.test(up)) continue;
    const p = line.split(/\s+/).map(Number);
    if (p.length >= 3 && p.every((x) => !isNaN(x))) vals.push(p[0], p[1], p[2]);
  }
  if (!size || vals.length < size * size * size * 3) throw new Error('Invalid .cube LUT (only 3D LUTs are supported)');
  const data = new Float32Array(size * size * size * 4);
  for (let i = 0; i < size * size * size; i++) {
    data[i * 4] = (vals[i * 3] - dmin[0]) / (dmax[0] - dmin[0]);
    data[i * 4 + 1] = (vals[i * 3 + 1] - dmin[1]) / (dmax[1] - dmin[1]);
    data[i * 4 + 2] = (vals[i * 3 + 2] - dmin[2]) / (dmax[2] - dmin[2]);
    data[i * 4 + 3] = 1;
  }
  return { size, data };
}

export class Compositor {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true,
      preserveDrawingBuffer: !!opts.preserve, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 desteklenmiyor');
    this.gl = gl;
    this.programs = new Map();
    this.textures = new Map();
    this.luts = new Map();
    this.textCache = new Map();
    this.maskCache = new Map();
    this.targets = {};
    this.tempPool = [];
    this.frameCounter = 0;
    this.W = 0; this.H = 0; this.seqW = 1; this.seqH = 1; this.scale = 1;
    this.result = null;
    this.onError = opts.onError || ((e) => console.error(e));
    this._initGeometry();
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    this.solidTex = this._makeTex();
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this._reinit(); });
  }

  _reinit() {
    this.programs.clear(); this.textures.clear(); this.luts.clear(); this.textCache.clear(); this.maskCache.clear(); this._scopeT = null;
    this.targets = {}; this.tempPool = []; this.W = 0; this.H = 0; this._levels = null;
    this._initGeometry();
    this.solidTex = this._makeTex();
  }

  _initGeometry() {
    const gl = this.gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  _compile(key, fsSrc) {
    let p = this.programs.get(key);
    if (p) return p;
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        throw new Error('Shader derleme hatası (' + key + '): ' + log);
      }
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fsSrc));
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Shader bağlama hatası (' + key + '): ' + gl.getProgramInfoLog(prog));
    p = { prog, locs: new Map() };
    this.programs.set(key, p);
    return p;
  }

  _use(p) {
    this.gl.useProgram(p.prog);
    this._cur = p;
    return p;
  }

  _loc(name) {
    const p = this._cur;
    let l = p.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(p.prog, name);
      p.locs.set(name, l);
    }
    return l;
  }

  _u1f(n, v) { const l = this._loc(n); if (l) this.gl.uniform1f(l, v); }
  _u1i(n, v) { const l = this._loc(n); if (l) this.gl.uniform1i(l, v); }
  _u2f(n, a, b) { const l = this._loc(n); if (l) this.gl.uniform2f(l, a, b); }
  _u3f(n, a, b, c) { const l = this._loc(n); if (l) this.gl.uniform3f(l, a, b, c); }
  _mat(m) { const l = this._loc('u_mat'); if (l) this.gl.uniformMatrix3fv(l, false, m); }

  _makeTex() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _makeTarget(w, h) {
    const gl = this.gl;
    const tex = this._makeTex();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fb, tex, w, h };
  }

  _freeTarget(t) {
    const gl = this.gl;
    gl.deleteFramebuffer(t.fb);
    gl.deleteTexture(t.tex);
  }

  _getTemp(w, h) {
    for (const t of this.tempPool) if (!t.used && t.w === w && t.h === h) { t.used = true; t.last = this.frameCounter; return t; }
    const t = this._makeTarget(w, h);
    t.used = true;
    t.last = this.frameCounter;
    this.tempPool.push(t);
    return t;
  }
  _releaseTemp(t) { if (t) t.used = false; }

  _bindTarget(t) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
    if (t) gl.viewport(0, 0, t.w, t.h);
  }

  _clear(t) {
    const gl = this.gl;
    this._bindTarget(t);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  _draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  ensureSize(seq, scale) {
    const W = Math.max(2, Math.round(seq.width * scale));
    const H = Math.max(2, Math.round(seq.height * scale));
    this.seqW = seq.width; this.seqH = seq.height; this.scale = scale;
    if (W === this.W && H === this.H) return;
    for (const k in this.targets) this._freeTarget(this.targets[k]);
    this.targets = {};
    for (const k of ['acc0', 'acc1', 'layer', 'la', 'lb', 'lt']) this.targets[k] = this._makeTarget(W, H);
    this.W = W; this.H = H;
  }

  // Kaynağı dokuya yükle. src: {type:'element'|'pixels'|'canvas', el|data, w, h, version, stable}
  _uploadSource(key, src) {
    const gl = this.gl;
    let e = this.textures.get(key);
    if (!e) {
      e = { tex: this._makeTex(), version: -1, w: 0, h: 0, mips: false };
      this.textures.set(key, e);
    }
    e.last = this.frameCounter;
    if (src.stable && e.version === src.version && e.srcRef === (src.el || src.data)) return e;
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    try {
      if (src.type === 'pixels') {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        if (e.w === src.w && e.h === src.h && e.allocated) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, src.w, src.h, gl.RGBA, gl.UNSIGNED_BYTE, src.data);
        else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, src.w, src.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.data); e.allocated = true; }
      } else {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src.el);
        e.allocated = false;
      }
    } catch (err) {
      this.onError(err);
      return null;
    }
    e.w = src.w; e.h = src.h; e.version = src.version; e.srcRef = src.el || src.data;
    e.mips = false;
    return e;
  }

  _ensureMips(e, needed) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    if (needed) {
      if (!e.mips) { gl.generateMipmap(gl.TEXTURE_2D); e.mips = true; }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
  }

  _lut(path) {
    if (!path) return null;
    let l = this.luts.get(path);
    if (l !== undefined) return l;
    try {
      const { size, data } = parseCube(nodeFs.readFileSync(path, 'utf8'));
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_3D, tex);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, size, size, size, 0, gl.RGBA, gl.FLOAT, data);
      l = { tex, size };
    } catch (e) {
      this.onError(e);
      l = null;
    }
    this.luts.set(path, l);
    return l;
  }

  _textTexture(clip) {
    const key = textKey(clip.text);
    let c = this.textCache.get(clip.id);
    if (!c || c.key !== key) {
      const canvas = renderTextCanvas(clip.text);
      c = { key, canvas, version: (c?.version || 0) + 1 };
      this.textCache.set(clip.id, c);
    }
    const e = this._uploadSource('text:' + clip.id, { type: 'canvas', el: c.canvas, w: c.canvas.width, h: c.canvas.height, version: c.version, stable: true });
    return e ? { e, w: c.canvas.width, h: c.canvas.height } : null;
  }

  _solid(hex) {
    const gl = this.gl;
    const [r, g, b] = hexToRgb(hex);
    gl.bindTexture(gl.TEXTURE_2D, this.solidTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([r * 255, g * 255, b * 255, 255]));
    return this.solidTex;
  }

  _setEffectUniforms(fx, def, local) {
    const gl = this.gl;
    for (const pd of def.params) {
      const pv = fx.params[pd.key];
      const v = pv ? evalParam(pv, local) : pd.default;
      const name = 'u_' + pd.key;
      switch (pd.type) {
        case 'color': { const [r, g, b] = hexToRgb(v); this._u3f(name, r, g, b); break; }
        case 'bool': this._u1f(name, v ? 1 : 0); break;
        case 'select': this._u1f(name, Number(v) || 0); break;
        case 'point': this._u2f(name, v?.[0] || 0, v?.[1] || 0); break;
        case 'lut': {
          const lut = this._lut(v);
          this._u1f('u_hasLut', lut ? 1 : 0);
          this._u1f('u_lutSize', lut ? lut.size : 2);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_3D, lut ? lut.tex : null);
          this._u1i('u_lutTex', 1);
          gl.activeTexture(gl.TEXTURE0);
          break;
        }
        default: this._u1f(name, Number(v) || 0);
      }
    }
  }

  // Efekt zinciri: inputTex -> (geçici hedef). Sonuç {tex, temp} döner.
  _runEffects(effects, inputTex, w, h, srcScale, local, time, maskKey = '') {
    const gl = this.gl;
    let curTex = inputTex;
    let curTemp = null;
    for (const fx of effects) {
      const def = EFFECTS[fx.type];
      if (!def) continue;
      let prog;
      try { prog = this._compile('fx:' + fx.type, FX_HEADER + def.shader); } catch (e) { this.onError(e); continue; }
      const masks = (fx.masks || []).filter((mk) => mk.enabled !== false);
      const fxInTex = curTex;
      const keep = masks.length ? curTemp : null; // maske karışımı için efekt girdisini sakla
      const passes = def.passes || [null];
      for (const dir of passes) {
        const out = this._getTemp(w, h);
        this._bindTarget(out);
        gl.disable(gl.BLEND);
        this._use(prog);
        this._mat(FULL);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, curTex);
        this._u1i('u_tex', 0);
        this._u2f('u_size', w, h);
        this._u1f('u_time', time || 0);
        this._u1f('u_srcScale', srcScale);
        if (dir) this._u2f('u_dir', dir[0], dir[1]);
        this._setEffectUniforms(fx, def, local);
        this._draw();
        if (curTemp !== keep) this._releaseTemp(curTemp);
        curTemp = out;
        curTex = out.tex;
      }
      if (masks.length) {
        const mt = this._maskTex(maskKey + ':' + fx.id, masks, local, w, h, srcScale);
        if (mt) {
          const out = this._getTemp(w, h);
          this._bindTarget(out);
          gl.disable(gl.BLEND);
          this._use(this._compile('maskmix', FS_MASKMIX));
          this._mat(FULL);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fxInTex); this._u1i('u_a', 0);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, curTex); this._u1i('u_b', 1);
          gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, mt); this._u1i('u_mask', 2);
          gl.activeTexture(gl.TEXTURE0);
          this._draw();
          this._releaseTemp(curTemp);
          curTemp = out;
          curTex = out.tex;
        }
        if (keep && keep !== curTemp) this._releaseTemp(keep);
      }
    }
    return { tex: curTex, temp: curTemp };
  }

  // Maske dokusu (önbellekli; değerler değişince yeniden çizilir)
  _maskTex(key, masks, local, w, h, k) {
    let c = this.maskCache.get(key);
    if (!c) {
      c = { canvas: document.createElement('canvas'), layer: document.createElement('canvas'), sig: null, ver: 0, has: false };
      this.maskCache.set(key, c);
    }
    const sig = JSON.stringify([w, h, k, masks.map((mk) => [mk.type, mk.inverted, mk.mode, evalParam(mk.path, local), evalParam(mk.feather, local), evalParam(mk.opacity, local), evalParam(mk.expansion, local)])]);
    if (sig !== c.sig) {
      c.has = rasterizeMasks(c.canvas, c.layer, masks, local, w, h, k);
      c.sig = sig;
      c.ver++;
    }
    if (!c.has) return null;
    const e = this._uploadSource('mask:' + key, { type: 'canvas', el: c.canvas, w, h, version: c.ver, stable: true });
    return e ? e.tex : null;
  }

  _maskMul(srcTex, maskTex, w, h) {
    const gl = this.gl;
    const out = this._getTemp(w, h);
    this._bindTarget(out);
    gl.disable(gl.BLEND);
    this._use(this._compile('maskmul', FS_MASKMUL));
    this._mat(FULL);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex); this._u1i('u_tex', 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, maskTex); this._u1i('u_mask', 1);
    gl.activeTexture(gl.TEXTURE0);
    this._draw();
    return out;
  }

  // Scope'lar için sonucun küçük bir kopyasını oku (satırlar alttan üste)
  sampleResult(maxW = 360) {
    if (this.lost || !this.result) return null;
    const gl = this.gl;
    const w = Math.max(1, Math.min(maxW, this.W));
    const h = Math.max(1, Math.round((w * this.H) / this.W));
    if (!this._scopeT || this._scopeT.w !== w || this._scopeT.h !== h) {
      if (this._scopeT) this._freeTarget(this._scopeT);
      this._scopeT = this._makeTarget(w, h);
      this._scopeBuf = new Uint8Array(w * h * 4);
    }
    this._bindTarget(this._scopeT);
    gl.disable(gl.BLEND);
    this._use(this._compile('copy', FS_COPY));
    this._mat(FULL);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.result.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    this._u1i('u_tex', 0);
    this._u1f('u_opacity', 1);
    this._draw();
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this._scopeBuf);
    return { w, h, data: this._scopeBuf };
  }

  // Klibin dönüşüm matrisi (birim kare -> NDC)
  _transformMatrix(clip, local, sw, sh) {
    const P = clip.props || {};
    const pos = evalParam(P.position, local) || [this.seqW / 2, this.seqH / 2];
    const anchor = evalParam(P.anchor, local) || [sw / 2, sh / 2];
    const sc = (evalParam(P.scale, local) ?? 100) / 100;
    const scw = P.uniformScale === false ? (evalParam(P.scaleWidth, local) ?? 100) / 100 : sc;
    const rot = ((evalParam(P.rotation, local) || 0) * Math.PI) / 180;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const SW = this.seqW, SH = this.seqH;
    const f = (u, v) => {
      const qx = (u * sw - anchor[0]) * scw;
      const qy = ((1 - v) * sh - anchor[1]) * sc;
      const x = pos[0] + qx * cos - qy * sin;
      const y = pos[1] + qx * sin + qy * cos;
      return [(x / SW) * 2 - 1, 1 - (y / SH) * 2];
    };
    const p00 = f(0, 0), p10 = f(1, 0), p01 = f(0, 1);
    const effScale = Math.max(Math.abs(sc), Math.abs(scw)) * this.scale;
    return {
      m: new Float32Array([p10[0] - p00[0], p10[1] - p00[1], 0, p01[0] - p00[0], p01[1] - p00[1], 0, p00[0], p00[1], 1]),
      effScale,
    };
  }

  // Bir öğeyi (klip örneği) hedefe çiz. Başarılıysa true.
  _drawItem(item, target, getSource, time) {
    const gl = this.gl;
    const clip = item.clip;
    let tex = null, sw = 0, sh = 0, texW = 0, texH = 0, entry = null;
    if (clip.kind === 'sequence') {
      const r = item.nested ? this._renderNested(item.nested, item.nestedFrame, getSource, time) : null;
      if (!r) return false;
      tex = r.tex; sw = item.nested.width; sh = item.nested.height; texW = r.w; texH = r.h;
      this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    } else if (clip.kind === 'text') {
      const r = this._textTexture(clip);
      if (!r) return false;
      entry = r.e; tex = r.e.tex; sw = r.w; sh = r.h; texW = r.w; texH = r.h;
    } else if (clip.kind === 'color') {
      tex = this._solid(clip.color || '#000000');
      sw = this.seqW; sh = this.seqH; texW = 1; texH = 1;
    } else {
      const src = getSource(item);
      if (!src) return false;
      entry = this._uploadSource(src.key || clip.id, src);
      if (!entry) return false;
      tex = entry.tex;
      sw = src.nativeW || src.w; sh = src.nativeH || src.h;
      texW = src.w; texH = src.h;
    }
    const local = item.local;
    const opacity = Math.max(0, Math.min(1, (evalParam(clip.props.opacity, local) ?? 100) / 100));
    if (opacity <= 0) return true;
    const { m, effScale } = this._transformMatrix(clip, local, sw, sh);
    const effects = (clip.effects || []).filter((fx) => fx.enabled && EFFECTS[fx.type]);
    const masks = (clip.masks || []).filter((mk) => mk.enabled !== false);
    let useTex = tex;
    let temp = null;
    if (effects.length || masks.length) {
      let ws = Math.min(1, Math.max(0.05, effScale));
      let w = Math.max(2, Math.round(sw * ws)), h = Math.max(2, Math.round(sh * ws));
      const cap = 4096;
      if (w > cap || h > cap) { const k = cap / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      if (entry) this._ensureMips(entry, texW > w * 1.6);
      const r = effects.length ? this._runEffects(effects, tex, w, h, w / sw, local, time, clip.id) : { tex, temp: null };
      useTex = r.tex; temp = r.temp;
      if (masks.length) {
        // opaklık maskeleri: efektlerden sonra, dönüşümden önce
        const mt = this._maskTex(clip.id + ':opacity', masks, local, w, h, w / sw);
        if (mt) {
          const out = this._maskMul(useTex, mt, w, h);
          this._releaseTemp(temp);
          temp = out;
          useTex = out.tex;
        }
      }
      gl.bindTexture(gl.TEXTURE_2D, useTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    } else if (entry) {
      this._ensureMips(entry, sw * effScale < texW / 1.6 && texW > 64);
    }
    this._bindTarget(target);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this._use(this._compile('copy', FS_COPY));
    this._mat(m);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, useTex);
    this._u1i('u_tex', 0);
    this._u1f('u_opacity', opacity);
    this._draw();
    gl.disable(gl.BLEND);
    this._releaseTemp(temp);
    return true;
  }

  _blendInto(acc, other, layerTex, mode) {
    const gl = this.gl;
    this._bindTarget(other);
    gl.disable(gl.BLEND);
    this._use(this._compile('blend', FS_BLEND));
    this._mat(FULL);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, acc.tex); this._u1i('u_dst', 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, layerTex); this._u1i('u_src', 1);
    this._u1i('u_mode', Math.max(0, BLEND_MODES.indexOf(mode)));
    this._draw();
    gl.activeTexture(gl.TEXTURE0);
  }

  _overInto(target, tex) {
    const gl = this.gl;
    this._bindTarget(target);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this._use(this._compile('copy', FS_COPY));
    this._mat(FULL);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    this._u1i('u_tex', 0); this._u1f('u_opacity', 1);
    this._draw();
    gl.disable(gl.BLEND);
  }

  // Ana çizim. layers: renderGraph.videoLayersAt sonucu
  renderFrame(seq, layers, getSource, opts = {}) {
    if (this.lost) return;
    this.frameCounter++;
    this.ensureSize(seq, opts.scale || 1);
    this._project = opts.project || null;
    this._depth = 0;
    this._missing = 0;
    const acc = this._composite(layers, getSource, opts.time || 0, this.targets);
    this.result = acc;
    if (this.frameCounter % 120 === 0) this._prune();
    return { missing: this._missing };
  }

  // Derinliğe göre nested hedef setleri
  _levelTargets(depth, W, H) {
    if (!this._levels) this._levels = new Map();
    let T = this._levels.get(depth);
    if (T && (T.acc0.w !== W || T.acc0.h !== H)) {
      for (const k in T) this._freeTarget(T[k]);
      T = null;
    }
    if (!T) {
      T = {};
      for (const k of ['acc0', 'acc1', 'layer', 'la', 'lb', 'lt']) T[k] = this._makeTarget(W, H);
      this._levels.set(depth, T);
    }
    return T;
  }

  // Nested sekansın bir karesini çiz, sonuç dokusunu döndür
  _renderNested(nested, frame, getSource, time) {
    if (!this._project || this._depth >= 6) return null;
    const save = { seqW: this.seqW, seqH: this.seqH, W: this.W, H: this.H };
    const W = Math.max(2, Math.round(nested.width * this.scale)), H = Math.max(2, Math.round(nested.height * this.scale));
    this._depth++;
    const T = this._levelTargets(this._depth, W, H);
    this.seqW = nested.width; this.seqH = nested.height; this.W = W; this.H = H;
    let acc = null;
    try {
      const layers = videoLayersAt(this._project, nested, frame, this._depth);
      acc = this._composite(layers, getSource, time, T);
    } finally {
      Object.assign(this, save);
      this._depth--;
    }
    return acc ? { tex: acc.tex, w: W, h: H } : null;
  }

  _composite(layers, getSource, time, T) {
    const gl = this.gl;
    let acc = T.acc0, other = T.acc1;
    this._clear(acc);
    let missing = 0;
    for (const L of layers) {
      try {
        if (L.type === 'clip') {
          const mode = L.item.clip.props.blendMode || 'normal';
          if (mode === 'normal') {
            if (!this._drawItem(L.item, acc, getSource, time)) missing++;
          } else {
            this._clear(T.layer);
            if (!this._drawItem(L.item, T.layer, getSource, time)) { missing++; continue; }
            this._blendInto(acc, other, T.layer.tex, mode);
            [acc, other] = [other, acc];
          }
        } else if (L.type === 'transition') {
          this._clear(T.la);
          this._clear(T.lb);
          if (L.a && !this._drawItem(L.a, T.la, getSource, time)) missing++;
          if (L.b && !this._drawItem(L.b, T.lb, getSource, time)) missing++;
          const def = TRANSITIONS[L.trans] && TRANSITIONS[L.trans].shader ? TRANSITIONS[L.trans] : TRANSITIONS.crossDissolve;
          const key = TRANSITIONS[L.trans] && TRANSITIONS[L.trans].shader ? L.trans : 'crossDissolve';
          this._bindTarget(T.lt);
          gl.disable(gl.BLEND);
          this._use(this._compile('tr:' + key, TRANSITION_HEADER + def.shader));
          this._mat(FULL);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.la.tex); this._u1i('u_a', 0);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.lb.tex); this._u1i('u_b', 1);
          gl.activeTexture(gl.TEXTURE0);
          this._u1f('u_p', Math.max(0, Math.min(1, L.p)));
          this._u2f('u_size', this.W, this.H);
          this._draw();
          this._overInto(acc, T.lt.tex);
        } else if (L.type === 'adjust') {
          const clip = L.item.clip;
          const effects = (clip.effects || []).filter((fx) => fx.enabled && EFFECTS[fx.type]);
          if (!effects.length) continue;
          const opacity = Math.max(0, Math.min(1, (evalParam(clip.props.opacity, L.item.local) ?? 100) / 100)) * (L.fade ?? 1);
          const r = this._runEffects(effects, acc.tex, this.W, this.H, this.scale, L.item.local, time, clip.id);
          this._bindTarget(other);
          gl.disable(gl.BLEND);
          this._use(this._compile('mix', FS_MIX));
          this._mat(FULL);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, acc.tex); this._u1i('u_dst', 0);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, r.tex); this._u1i('u_src', 1);
          gl.activeTexture(gl.TEXTURE0);
          this._u1f('u_amt', opacity);
          this._draw();
          this._releaseTemp(r.temp);
          [acc, other] = [other, acc];
        }
      } catch (e) {
        this.onError(e);
      }
    }
    this._missing += missing;
    return acc;
  }

  // Sonucu canvas'a sığdırarak çiz (letterbox)
  present(viewW, viewH, zoom = 'fit') {
    if (this.lost || !this.result) return null;
    const gl = this.gl;
    if (this.canvas.width !== viewW || this.canvas.height !== viewH) {
      this.canvas.width = viewW;
      this.canvas.height = viewH;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, viewW, viewH);
    gl.clearColor(0.04, 0.04, 0.04, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const aspect = this.seqW / this.seqH;
    let w, h;
    if (zoom === 'fit') {
      w = viewW; h = w / aspect;
      if (h > viewH) { h = viewH; w = h * aspect; }
    } else {
      w = this.seqW * zoom; h = this.seqH * zoom;
    }
    const x = (viewW - w) / 2, y = (viewH - h) / 2;
    const sx = (w / viewW) * 2, sy = (h / viewH) * 2;
    const ox = (x / viewW) * 2 - 1, oy = 1 - ((y + h) / viewH) * 2;
    this._use(this._compile('present', FS_PRESENT));
    this._mat(new Float32Array([sx, 0, 0, 0, sy, 0, ox, oy, 1]));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.result.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    this._u1i('u_tex', 0);
    gl.disable(gl.BLEND);
    this._draw();
    return { x, y, w, h };
  }

  readPixels(buf) {
    const gl = this.gl;
    const out = buf && buf.length === this.W * this.H * 4 ? buf : new Uint8Array(this.W * this.H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.result.fb);
    gl.readPixels(0, 0, this.W, this.H, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }

  releaseKey(key) {
    const e = this.textures.get(key);
    if (e) { this.gl.deleteTexture(e.tex); this.textures.delete(key); }
  }

  _prune() {
    const gl = this.gl;
    for (const [k, e] of this.textures) {
      if (this.frameCounter - (e.last || 0) > 240) { gl.deleteTexture(e.tex); this.textures.delete(k); }
    }
    this.tempPool = this.tempPool.filter((t) => {
      if (!t.used && this.frameCounter - t.last > 240) { this._freeTarget(t); return false; }
      return true;
    });
    for (const [k] of this.textCache) if (!this.textures.has('text:' + k)) this.textCache.delete(k);
    for (const [k] of this.maskCache) if (!this.textures.has('mask:' + k)) this.maskCache.delete(k);
  }

  invalidateLut(path) {
    const l = this.luts.get(path);
    if (l) this.gl.deleteTexture(l.tex);
    this.luts.delete(path);
  }

  destroy() {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  }
}
