// Ek video efektleri: hareket, retro, ışık, çarpıtma ve stil efektleri (GLSL ES 3.0)
// Hepsi tek geçişli; FX_HEADER yardımcılarını (samp, fbm, vn, hash2, rot2, asp2, screen3, u_local) kullanır.

const N = (key, label, min, max, def, extra = {}) => ({ key, label, min, max, default: def, ...extra });
const C = (key, label, def) => ({ key, label, type: 'color', default: def });
const B = (key, label, def) => ({ key, label, type: 'bool', default: def, animatable: false });
const S = (key, label, options, def = 0) => ({ key, label, type: 'select', options, default: def, animatable: false });

export const EXTRA_EFFECTS = {
  // ---------------- Hareket ----------------
  cameraShake: {
    name: 'Camera Shake', group: 'Motion', category: 'video',
    params: [N('shakeAmount', 'Amount', 0, 200, 20), N('shakeSpeed', 'Speed', 0.1, 30, 8, { step: 0.1 }), N('shakeRot', 'Rotation', 0, 20, 1, { step: 0.1 }), N('shakeZoom', 'Zoom', 100, 160, 108), N('shakeSeed', 'Random Seed', 0, 100, 1, { animatable: false })],
    shader: `uniform float u_shakeAmount, u_shakeSpeed, u_shakeRot, u_shakeZoom, u_shakeSeed;
void main(){
  float t = u_local * u_shakeSpeed + u_shakeSeed * 13.7;
  vec2 off = vec2(fbm(vec2(t, 1.3)) - 0.5, fbm(vec2(4.1, t)) - 0.5) * 2.0 * u_shakeAmount * u_srcScale;
  float r = radians((fbm(vec2(t * 0.7, 8.2)) - 0.5) * 2.0 * u_shakeRot);
  vec2 p = (v_uv - 0.5) * u_size / (u_shakeZoom / 100.0);
  p = rot2(r) * p - off;
  o = samp(p / u_size + 0.5);
}`,
  },
  zoomPunch: {
    name: 'Zoom Punch', group: 'Motion', category: 'video',
    params: [N('punchInterval', 'Interval (sec)', 0.1, 10, 1, { step: 0.05 }), N('punchAmount', 'Amount', 0, 100, 15), N('punchDecay', 'Decay', 1, 40, 8), N('punchBlur', 'Motion Blur', 0, 100, 40), N('punchOffset', 'Offset (sec)', 0, 10, 0, { step: 0.05 })],
    shader: `uniform float u_punchInterval, u_punchAmount, u_punchDecay, u_punchBlur, u_punchOffset;
void main(){
  float ph = mod(max(0.0, u_local - u_punchOffset), max(0.05, u_punchInterval));
  float s = 1.0 + u_punchAmount / 100.0 * exp(-u_punchDecay * ph);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 12; i++) {
    float si = s * (1.0 + float(i) / 11.0 * (s - 1.0) * u_punchBlur / 100.0);
    acc += samp((v_uv - 0.5) / si + 0.5);
  }
  o = acc / 12.0;
}`,
  },
  kenBurns: {
    name: 'Ken Burns', group: 'Motion', category: 'video',
    params: [N('kbStart', 'Start Zoom', 100, 300, 100), N('kbEnd', 'End Zoom', 100, 300, 125), N('kbDur', 'Duration (sec)', 0.5, 60, 5, { step: 0.1 }), N('kbPanX', 'Pan Horizontal', -100, 100, 30), N('kbPanY', 'Pan Vertical', -100, 100, 0), B('kbEase', 'Ease In/Out', true)],
    shader: `uniform float u_kbStart, u_kbEnd, u_kbDur, u_kbPanX, u_kbPanY, u_kbEase;
void main(){
  float p = clamp(u_local / max(0.1, u_kbDur), 0.0, 1.0);
  if (u_kbEase > 0.5) p = p * p * (3.0 - 2.0 * p);
  float s = mix(u_kbStart, u_kbEnd, p) / 100.0;
  vec2 pan = vec2(u_kbPanX, -u_kbPanY) / 100.0 * (2.0 * p - 1.0) * (1.0 - 1.0 / s) * 0.5;
  o = samp((v_uv - 0.5) / s + 0.5 + pan);
}`,
  },
  radialBlur: {
    name: 'Radial Blur', group: 'Blur & Sharpen', category: 'video',
    params: [S('rbType', 'Type', ['Zoom', 'Spin']), N('rbAmount', 'Amount', 0, 100, 20), N('rbX', 'Center X', 0, 100, 50), N('rbY', 'Center Y', 0, 100, 50)],
    shader: `uniform float u_rbType, u_rbAmount, u_rbX, u_rbY;
void main(){
  vec2 c = vec2(u_rbX, 100.0 - u_rbY) / 100.0;
  vec2 A = asp2();
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 32; i++) {
    float k = float(i) / 31.0 - 0.5;
    vec2 uv;
    if (u_rbType < 0.5) uv = c + (v_uv - c) * (1.0 - k * u_rbAmount / 100.0 * 0.5);
    else uv = c + (rot2(k * u_rbAmount / 100.0 * 0.6) * ((v_uv - c) * A)) / A;
    acc += samp(uv);
  }
  o = acc / 32.0;
}`,
  },
  echo: {
    name: 'Echo / Trails', group: 'Motion', category: 'video', echo: true,
    params: [N('echoCount', 'Number of Echoes', 1, 8, 4, { step: 1, animatable: false }), N('echoDelay', 'Echo Time (frames)', 1, 6, 2, { step: 1, animatable: false }),
      N('echoDecay', 'Decay', 0, 100, 60), S('echoMode', 'Echo Operator', ['Behind', 'Add', 'In Front'])],
    // gerçek iş compositor._echo içinde: klibin önceki karelerini saklayıp birleştirir
    shader: `void main(){ o = texture(u_tex, v_uv); }`,
  },
  // ---------------- Retro ----------------
  vhs: {
    name: 'VHS', group: 'Retro', category: 'video',
    params: [N('vhsAmount', 'Amount', 0, 100, 70), N('vhsNoise', 'Noise', 0, 100, 40), N('vhsScan', 'Scanlines', 0, 100, 40), N('vhsBleed', 'Color Bleed', 0, 100, 50), N('vhsJitter', 'Tracking Jitter', 0, 100, 30)],
    shader: `uniform float u_vhsAmount, u_vhsNoise, u_vhsScan, u_vhsBleed, u_vhsJitter;
void main(){
  vec4 s = texture(u_tex, v_uv);
  float t = u_time;
  vec2 uv = v_uv;
  float line = floor(uv.y * u_size.y / max(1.0, 2.0 * u_srcScale));
  float fr = floor(t * 30.0);
  uv.x += (hash(vec2(line, fr)) - 0.5) * 0.004 * u_vhsJitter / 100.0;
  float bandY = 1.2 - fract(t * 0.11) * 1.4;
  float band = exp(-pow((uv.y - bandY) * 30.0, 2.0));
  uv.x += band * 0.03 * u_vhsJitter / 100.0 * (hash(vec2(line, fr + 3.0)) - 0.3);
  float b = 0.006 * u_vhsBleed / 100.0;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float k = float(i) / 4.0;
    col.r += unp(samp(uv + vec2(b * (1.0 + k), 0.0))).r;
    col.g += unp(samp(uv + vec2(b * 0.3 * k, 0.0))).g;
    col.b += unp(samp(uv - vec2(b * (1.0 + k), 0.0))).b;
  }
  col /= 5.0;
  col = mix(vec3(luma(col)), col, 0.85) * vec3(1.04, 1.0, 0.94);
  float sl = 0.5 + 0.5 * sin(v_uv.y * u_size.y * 3.14159 / max(1.0, 1.5 * u_srcScale));
  col *= 1.0 - u_vhsScan / 100.0 * 0.3 * sl;
  float n = hash(v_uv * u_size + fr * 7.31) - 0.5;
  col += n * (u_vhsNoise / 100.0 * 0.22 + band * 0.5 * u_vhsNoise / 100.0);
  col = mix(unp(s), clamp(col, 0.0, 1.0), u_vhsAmount / 100.0);
  float a = max(s.a, samp(uv).a);
  o = vec4(col * a, a);
}`,
  },
  oldFilm: {
    name: 'Old Film', group: 'Retro', category: 'video',
    params: [N('ofSepia', 'Sepia', 0, 100, 70), N('ofScratches', 'Scratches', 0, 100, 50), N('ofDust', 'Dust', 0, 100, 40), N('ofFlicker', 'Flicker', 0, 100, 40), N('ofVignette', 'Vignette', 0, 100, 50), N('ofJitter', 'Gate Weave', 0, 100, 20)],
    shader: `uniform float u_ofSepia, u_ofScratches, u_ofDust, u_ofFlicker, u_ofVignette, u_ofJitter;
void main(){
  float fr = floor(u_time * 24.0);
  vec2 uv = v_uv + vec2(0.0, (hash(vec2(fr, 1.0)) - 0.5) * 0.006 * u_ofJitter / 100.0);
  vec4 s = samp(uv);
  vec3 c = unp(s);
  float L = luma(c);
  c = mix(c, vec3(L) * vec3(1.07, 0.92, 0.72), u_ofSepia / 100.0);
  c *= 1.0 + (hash(vec2(fr, 7.0)) - 0.5) * 0.3 * u_ofFlicker / 100.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    if (hash(vec2(fr, fk + 10.0)) < u_ofScratches / 100.0) {
      float x0 = hash(vec2(fr, fk));
      float d = abs(v_uv.x - x0) * u_size.x / max(0.5, u_srcScale);
      c = mix(c, c * (hash(vec2(fk, fr)) > 0.5 ? 1.35 : 0.55), exp(-d * d * 0.3) * 0.8);
    }
  }
  vec2 A = asp2();
  vec2 g = v_uv * A * 30.0;
  vec2 id = floor(g);
  float h = hash(id + fr * 1.37);
  if (h > 1.0 - u_ofDust / 100.0 * 0.06) {
    vec2 ctr = id + hash2(id + fr);
    float dd = length(g - ctr);
    c *= mix(1.0, 0.15, smoothstep(0.12, 0.02, dd));
  }
  vec2 q = (v_uv - 0.5) * A;
  c *= 1.0 - u_ofVignette / 100.0 * smoothstep(0.3, 0.95, length(q));
  o = vec4(clamp(c, 0.0, 1.0) * s.a, s.a);
}`,
  },
  glitchFx: {
    name: 'Digital Glitch', group: 'Retro', category: 'video',
    params: [N('glAmount', 'Amount', 0, 100, 50), N('glSpeed', 'Speed', 1, 30, 10), N('glBlock', 'Block Size', 0, 100, 50), N('glSplit', 'RGB Split', 0, 100, 50)],
    shader: `uniform float u_glAmount, u_glSpeed, u_glBlock, u_glSplit;
void main(){
  float k = u_glAmount / 100.0;
  float t = floor(u_time * u_glSpeed);
  float burst = step(0.45, hash(vec2(t, 3.0))) * k + k * 0.25;
  vec2 uv = v_uv;
  float rows = mix(40.0, 6.0, u_glBlock / 100.0);
  float row = floor(uv.y * rows);
  uv.x += (hash(vec2(row, t)) - 0.5) * 0.18 * burst * step(1.0 - burst * 0.7, hash(vec2(row * 3.1, t + 5.0)));
  vec2 cell = floor(v_uv * vec2(16.0, 9.0) * mix(2.0, 0.6, u_glBlock / 100.0));
  bool hit = hash(cell + t * 1.7) > 1.0 - burst * 0.12;
  if (hit) uv += (hash2(cell + t) - 0.5) * 0.06;
  float sp = 0.012 * u_glSplit / 100.0 * burst * (0.5 + hash(vec2(t, 9.0)));
  vec4 r = samp(uv + vec2(sp, 0.0)), g = samp(uv), b = samp(uv - vec2(sp, 0.0));
  vec4 res = vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
  if (hit && hash(cell * 2.3 + t) > 0.6) res.rgb = res.gbr; // bozuk blok: renk kanalları kayar (siyah alanlar beyaza dönmez)
  o = res;
}`,
  },
  crt: {
    name: 'CRT Screen', group: 'Retro', category: 'video',
    params: [N('crtCurve', 'Curvature', 0, 100, 30), N('crtScan', 'Scanlines', 0, 100, 50), N('crtMask', 'RGB Mask', 0, 100, 30), N('crtVig', 'Vignette', 0, 100, 40)],
    shader: `uniform float u_crtCurve, u_crtScan, u_crtMask, u_crtVig;
void main(){
  vec2 c = v_uv * 2.0 - 1.0;
  c *= 1.0 + dot(c.yx, c.yx) * u_crtCurve / 100.0 * 0.22;
  vec2 uv = c * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec4 s = texture(u_tex, uv);
  vec3 col = unp(s);
  col *= 1.0 - u_crtScan / 100.0 * 0.4 * (0.5 + 0.5 * cos(uv.y * u_size.y / max(1.0, 1.5 * u_srcScale) * 3.14159));
  float px = mod(floor(v_uv.x * u_size.x / max(1.0, u_srcScale)), 3.0);
  vec3 m = px < 1.0 ? vec3(1.0, 0.7, 0.7) : px < 2.0 ? vec3(0.7, 1.0, 0.7) : vec3(0.7, 0.7, 1.0);
  col *= mix(vec3(1.0), m * 1.25, u_crtMask / 100.0);
  col *= 1.0 - u_crtVig / 100.0 * smoothstep(0.6, 1.5, length(c));
  o = vec4(clamp(col, 0.0, 1.0) * s.a, s.a);
}`,
  },
  strobe: {
    name: 'Strobe Light', group: 'Retro', category: 'video',
    params: [S('stMode', 'Mode', ['Flash Color', 'Invert', 'Black']), N('stFreq', 'Frequency (Hz)', 0.5, 30, 4, { step: 0.1 }), N('stDuty', 'Duration', 1, 100, 30), C('stColor', 'Color', '#ffffff'), N('stAmount', 'Amount', 0, 100, 100)],
    shader: `uniform float u_stMode, u_stFreq, u_stDuty, u_stAmount; uniform vec3 u_stColor;
void main(){
  vec4 s = texture(u_tex, v_uv);
  vec3 c = unp(s);
  float on = step(fract(u_local * u_stFreq), u_stDuty / 100.0) * u_stAmount / 100.0;
  vec3 e = u_stMode < 0.5 ? u_stColor : u_stMode < 1.5 ? 1.0 - c : vec3(0.0);
  o = vec4(mix(c, e, on) * s.a, s.a);
}`,
  },
  // ---------------- Işık ----------------
  lensFlare: {
    name: 'Lens Flare', group: 'Light', category: 'video',
    params: [N('lfX', 'Position X', -20, 120, 25), N('lfY', 'Position Y', -20, 120, 25), N('lfIntensity', 'Intensity', 0, 300, 100), C('lfColor', 'Color', '#ffd59a'), B('lfGhosts', 'Ghosts', true)],
    shader: `uniform float u_lfX, u_lfY, u_lfIntensity, u_lfGhosts; uniform vec3 u_lfColor;
void main(){
  vec4 s = texture(u_tex, v_uv);
  vec2 A = asp2();
  vec2 L = vec2(u_lfX, 100.0 - u_lfY) / 100.0;
  vec2 d = (v_uv - L) * A;
  float r = length(d);
  float f = exp(-r * r * 300.0) * 1.6 + exp(-r * 9.0) * 0.45;
  f += pow(max(0.0, cos(atan(d.y, d.x) * 6.0)), 30.0) * exp(-r * 5.0) * 0.5;
  f += exp(-abs(d.y) * 140.0) * exp(-abs(d.x) * 1.8) * 0.6;
  vec3 fl = u_lfColor * f;
  if (u_lfGhosts > 0.5) {
    for (int k = 0; k < 5; k++) {
      float fk = float(k);
      vec2 pos = L + (vec2(0.5) - L) * (0.6 + fk * 0.42);
      float gr = length((v_uv - pos) * A);
      float sz = 0.03 + fk * 0.018;
      float gh = smoothstep(sz, sz * 0.7, gr) * 0.18 + exp(-gr * gr / (sz * sz) * 6.0) * 0.1;
      fl += hsv2rgb(vec3(0.08 + fk * 0.15, 0.6, 1.0)) * gh;
    }
  }
  fl *= u_lfIntensity / 100.0;
  vec3 c = screen3(unp(s) * s.a, fl);
  o = vec4(c, max(s.a, clamp(luma(fl), 0.0, 1.0)));
}`,
  },
  lightLeakFx: {
    name: 'Light Leaks', group: 'Light', category: 'video',
    params: [N('llIntensity', 'Intensity', 0, 200, 70), N('llSpeed', 'Speed', 0, 5, 1, { step: 0.05 }), C('llColor1', 'Color 1', '#ff8a30'), C('llColor2', 'Color 2', '#ff3a6a'), N('llScale', 'Scale', 20, 300, 100), N('llSeed', 'Random Seed', 0, 100, 3, { animatable: false })],
    shader: `uniform float u_llIntensity, u_llSpeed, u_llScale, u_llSeed; uniform vec3 u_llColor1, u_llColor2;
void main(){
  vec4 s = texture(u_tex, v_uv);
  vec2 p = v_uv * asp2() * 1.6 / (u_llScale / 100.0) + u_llSeed * 3.1;
  float t = u_local * u_llSpeed * 0.25;
  float n1 = fbm(p + vec2(t, -t * 0.6));
  float n2 = fbm(p * 1.3 + vec2(-t * 0.8, t) + 7.0);
  float edge = smoothstep(0.2, 1.0, max(1.0 - v_uv.x * 1.3, v_uv.x * 1.3 - 0.3));
  vec3 lk = u_llColor1 * smoothstep(0.45, 0.85, n1) + u_llColor2 * smoothstep(0.5, 0.9, n2);
  lk *= (0.4 + edge) * u_llIntensity / 100.0;
  vec3 c = screen3(unp(s) * s.a, clamp(lk, 0.0, 1.0));
  o = vec4(c, max(s.a, clamp(luma(lk), 0.0, 1.0)));
}`,
  },
  bokeh: {
    name: 'Bokeh Lights', group: 'Light', category: 'video',
    params: [N('bkCount', 'Count', 1, 60, 25, { animatable: false }), N('bkSize', 'Size', 5, 300, 60), N('bkIntensity', 'Intensity', 0, 200, 60), C('bkColor', 'Color', '#ffd9a0'), B('bkColorful', 'Colorful', false), N('bkSpeed', 'Speed', 0, 5, 1, { step: 0.05 })],
    shader: `uniform float u_bkCount, u_bkSize, u_bkIntensity, u_bkColorful, u_bkSpeed; uniform vec3 u_bkColor;
void main(){
  vec4 s = texture(u_tex, v_uv);
  vec2 A = asp2();
  vec3 acc = vec3(0.0);
  float t = u_local * u_bkSpeed;
  for (int i = 0; i < 60; i++) {
    float fi = float(i);
    if (fi >= u_bkCount) break;
    vec2 h = hash2(vec2(fi, 3.7));
    float h3 = hash(vec2(fi, 9.1));
    vec2 ctr = vec2(h.x + sin(t * 0.4 + fi) * 0.03, fract(h.y + t * 0.02 * (0.5 + h3)));
    float rad = u_bkSize * (0.5 + h3) * u_srcScale / u_size.y;
    float d = length((v_uv - ctr) * A);
    float disk = smoothstep(rad, rad * 0.85, d);
    float rim = smoothstep(rad * 0.7, rad * 0.95, d) * disk;
    vec3 col = u_bkColorful > 0.5 ? hsv2rgb(vec3(h.x, 0.55, 1.0)) : u_bkColor;
    acc += col * (disk * 0.25 + rim * 0.25) * (0.4 + 0.6 * h.y) * (0.75 + 0.25 * sin(t * 2.0 + fi * 1.3));
  }
  acc *= u_bkIntensity / 100.0;
  vec3 c = screen3(unp(s) * s.a, clamp(acc, 0.0, 1.0));
  o = vec4(c, max(s.a, clamp(luma(acc), 0.0, 1.0)));
}`,
  },
  lightRays: {
    name: 'Light Rays', group: 'Light', category: 'video',
    params: [N('lrX', 'Light X', -50, 150, 50), N('lrY', 'Light Y', -50, 150, 15), N('lrLength', 'Length', 0, 100, 50), N('lrIntensity', 'Intensity', 0, 300, 100), N('lrThreshold', 'Threshold', 0, 100, 55), C('lrColor', 'Color', '#fff2d6')],
    shader: `uniform float u_lrX, u_lrY, u_lrLength, u_lrIntensity, u_lrThreshold; uniform vec3 u_lrColor;
void main(){
  vec4 s = texture(u_tex, v_uv);
  vec2 L = vec2(u_lrX, 100.0 - u_lrY) / 100.0;
  vec3 acc = vec3(0.0);
  float decay = 1.0, wsum = 0.0;
  float thr = u_lrThreshold / 100.0;
  for (int i = 0; i < 48; i++) {
    vec2 uv = v_uv + (L - v_uv) * (float(i) / 48.0) * u_lrLength / 100.0;
    vec4 c = samp(uv);
    float b = max(0.0, luma(unp(c)) - thr) / max(0.01, 1.0 - thr) * c.a;
    acc += b * decay;
    wsum += decay;
    decay *= 0.96;
  }
  vec3 rays = acc / wsum * u_lrColor * u_lrIntensity / 100.0 * 1.5;
  vec3 c = screen3(unp(s) * s.a, clamp(rays, 0.0, 1.0));
  o = vec4(c, max(s.a, clamp(luma(rays), 0.0, 1.0)));
}`,
  },
  neonEdges: {
    name: 'Neon Edges', group: 'Light', category: 'video',
    params: [C('neColor', 'Color', '#00e5ff'), B('neRainbow', 'Rainbow', false), N('neWidth', 'Width', 0.5, 6, 1.5, { step: 0.1 }), N('neGlow', 'Glow', 0, 100, 60), N('neKeep', 'Original Brightness', 0, 100, 25)],
    shader: `uniform float u_neRainbow, u_neWidth, u_neGlow, u_neKeep; uniform vec3 u_neColor;
float E(vec2 uv, float w){
  vec2 px = w / u_size;
  float tl = luma(unp(samp(uv + px * vec2(-1, -1)))), tr = luma(unp(samp(uv + px * vec2(1, -1))));
  float bl = luma(unp(samp(uv + px * vec2(-1, 1)))), br = luma(unp(samp(uv + px * vec2(1, 1))));
  float gx = (tr + br) - (tl + bl), gy = (bl + br) - (tl + tr);
  return clamp(length(vec2(gx, gy)) * 2.0, 0.0, 1.0);
}
void main(){
  vec4 s = texture(u_tex, v_uv);
  float w = u_neWidth * u_srcScale;
  float e = E(v_uv, w);
  float g = 0.0;
  for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398; g += E(v_uv + vec2(cos(a), sin(a)) * w * 4.0 / u_size, w); }
  g /= 8.0;
  vec3 col = u_neRainbow > 0.5 ? hsv2rgb(vec3(fract(v_uv.x + v_uv.y * 0.5 + u_local * 0.2), 0.9, 1.0)) : u_neColor;
  vec3 c = unp(s) * u_neKeep / 100.0 + col * (e * 1.6 + g * u_neGlow / 100.0 * 1.4);
  o = vec4(clamp(c, 0.0, 1.0) * s.a, s.a);
}`,
  },
  vignetteFx: {
    name: 'Vignette', group: 'Light', category: 'video',
    params: [N('vgAmount', 'Amount', 0, 100, 50), N('vgSize', 'Size', 0, 100, 50), N('vgRound', 'Roundness', 0, 100, 60), N('vgFeather', 'Feather', 1, 100, 50), C('vgColor', 'Color', '#000000')],
    shader: `uniform float u_vgAmount, u_vgSize, u_vgRound, u_vgFeather; uniform vec3 u_vgColor;
void main(){
  vec4 s = texture(u_tex, v_uv);
  vec2 q = (v_uv - 0.5) * mix(vec2(1.0), asp2(), u_vgRound / 100.0) * 2.0;
  float r0 = mix(0.3, 1.3, u_vgSize / 100.0);
  float v = smoothstep(r0, r0 + u_vgFeather / 100.0 * 1.2 + 0.01, length(q)) * u_vgAmount / 100.0;
  o = vec4(mix(unp(s), u_vgColor, v) * s.a, s.a);
}`,
  },
  // ---------------- Çarpıtma ----------------
  bulge: {
    name: 'Bulge / Fisheye', group: 'Distort', category: 'video',
    params: [N('bgAmount', 'Amount', -100, 100, 50), N('bgRadius', 'Radius', 1, 150, 60), N('bgX', 'Center X', 0, 100, 50), N('bgY', 'Center Y', 0, 100, 50)],
    shader: `uniform float u_bgAmount, u_bgRadius, u_bgX, u_bgY;
void main(){
  vec2 A = asp2();
  vec2 c = vec2(u_bgX, 100.0 - u_bgY) / 100.0;
  vec2 d = (v_uv - c) * A;
  float r = length(d);
  float R = u_bgRadius / 100.0 * 0.5;
  if (r < R && r > 0.0) {
    float k = r / R;
    float a = u_bgAmount / 100.0;
    float nk = a >= 0.0 ? mix(k, k * k * (3.0 - 2.0 * k) * k, a) : mix(k, sqrt(k), -a);
    d *= nk / k;
  }
  o = samp(c + d / A);
}`,
  },
  twirl: {
    name: 'Twirl', group: 'Distort', category: 'video',
    params: [N('twAngle', 'Angle', -720, 720, 180), N('twRadius', 'Radius', 1, 150, 60), N('twX', 'Center X', 0, 100, 50), N('twY', 'Center Y', 0, 100, 50)],
    shader: `uniform float u_twAngle, u_twRadius, u_twX, u_twY;
void main(){
  vec2 A = asp2();
  vec2 c = vec2(u_twX, 100.0 - u_twY) / 100.0;
  vec2 d = (v_uv - c) * A;
  float R = u_twRadius / 100.0 * 0.5;
  float r = length(d);
  if (r < R) { float f = 1.0 - r / R; d = rot2(radians(u_twAngle) * f * f) * d; }
  o = samp(c + d / A);
}`,
  },
  kaleidoscope: {
    name: 'Kaleidoscope', group: 'Distort', category: 'video',
    params: [N('ksSegments', 'Segments', 2, 16, 6, { step: 1 }), N('ksAngle', 'Rotation', -360, 360, 0), N('ksZoom', 'Zoom', 20, 400, 100), N('ksX', 'Center X', 0, 100, 50), N('ksY', 'Center Y', 0, 100, 50)],
    shader: `uniform float u_ksSegments, u_ksAngle, u_ksZoom, u_ksX, u_ksY;
void main(){
  vec2 A = asp2();
  vec2 c = vec2(u_ksX, 100.0 - u_ksY) / 100.0;
  vec2 d = (v_uv - c) * A;
  float r = length(d) / (u_ksZoom / 100.0);
  float seg = 6.2831853 / max(2.0, floor(u_ksSegments));
  float a = atan(d.y, d.x) - radians(u_ksAngle);
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  vec2 uv = c + vec2(cos(a), sin(a)) * r / A;
  uv = 1.0 - abs(1.0 - mod(uv, 2.0));
  o = texture(u_tex, uv);
}`,
  },
  motionTile: {
    name: 'Mirror Tiles', group: 'Distort', category: 'video',
    params: [N('mtX', 'Tiles Horizontal', 1, 12, 3, { step: 1 }), N('mtY', 'Tiles Vertical', 1, 12, 3, { step: 1 }), B('mtMirror', 'Mirror Edges', true), N('mtShiftX', 'Scroll X', -100, 100, 0), N('mtShiftY', 'Scroll Y', -100, 100, 0)],
    shader: `uniform float u_mtX, u_mtY, u_mtMirror, u_mtShiftX, u_mtShiftY;
void main(){
  vec2 uv = (v_uv - 0.5) * vec2(floor(u_mtX), floor(u_mtY)) + 0.5 + vec2(u_mtShiftX, u_mtShiftY) / 100.0 * u_local;
  uv = u_mtMirror > 0.5 ? 1.0 - abs(1.0 - mod(uv, 2.0)) : fract(uv);
  o = texture(u_tex, uv);
}`,
  },
  turbulentDisplace: {
    name: 'Turbulent Displace', group: 'Distort', category: 'video',
    params: [N('tdAmount', 'Amount', 0, 200, 30), N('tdSize', 'Size', 5, 1000, 100), N('tdSpeed', 'Evolution Speed', 0, 10, 1, { step: 0.05 })],
    pad: (p) => (p.tdAmount || 0) + 1,
    shader: `uniform float u_tdAmount, u_tdSize, u_tdSpeed;
void main(){
  vec2 p = v_uv * u_size / max(1.0, u_tdSize * u_srcScale);
  float t = u_local * u_tdSpeed * 0.5;
  vec2 d = vec2(fbm(p + vec2(t, 0.0)), fbm(p + vec2(5.2, 1.3) - vec2(0.0, t))) - 0.5;
  o = samp(v_uv + d * 2.0 * u_tdAmount * u_srcScale / u_size);
}`,
  },
  ripple: {
    name: 'Ripple', group: 'Distort', category: 'video',
    params: [N('rpAmp', 'Amplitude', 0, 100, 8), N('rpWave', 'Wavelength', 4, 500, 50), N('rpSpeed', 'Speed', -20, 20, 3), N('rpX', 'Center X', 0, 100, 50), N('rpY', 'Center Y', 0, 100, 50), N('rpRadius', 'Radius', 1, 200, 100)],
    shader: `uniform float u_rpAmp, u_rpWave, u_rpSpeed, u_rpX, u_rpY, u_rpRadius;
void main(){
  vec2 c = vec2(u_rpX, 100.0 - u_rpY) / 100.0 * u_size;
  vec2 p = v_uv * u_size;
  vec2 d = p - c;
  float r = length(d);
  float fall = 1.0 - smoothstep(0.0, u_rpRadius / 100.0 * max(u_size.x, u_size.y), r);
  float w = sin(r / max(1.0, u_rpWave * u_srcScale) * 6.2831853 - u_local * u_rpSpeed * 6.2831853);
  vec2 dir = r > 0.0 ? d / r : vec2(0.0);
  o = samp((p + dir * w * u_rpAmp * u_srcScale * fall) / u_size);
}`,
  },
  // ---------------- Stil ----------------
  duotone: {
    name: 'Duotone', group: 'Stylize', category: 'video',
    params: [C('dtShadow', 'Shadow Color', '#1b0b4f'), C('dtHighlight', 'Highlight Color', '#ffcf4a'), N('dtContrast', 'Contrast', -100, 100, 0), N('dtMix', 'Amount', 0, 100, 100)],
    shader: `uniform vec3 u_dtShadow, u_dtHighlight; uniform float u_dtContrast, u_dtMix;
void main(){
  vec4 s = texture(u_tex, v_uv);
  vec3 c = unp(s);
  float L = clamp((luma(c) - 0.5) * (1.0 + u_dtContrast / 100.0) + 0.5, 0.0, 1.0);
  o = vec4(mix(c, mix(u_dtShadow, u_dtHighlight, L), u_dtMix / 100.0) * s.a, s.a);
}`,
  },
  cartoon: {
    name: 'Cartoon', group: 'Stylize', category: 'video',
    params: [N('ctLevels', 'Color Levels', 2, 16, 6, { step: 1 }), N('ctEdges', 'Edge Strength', 0, 100, 60), N('ctWidth', 'Edge Width', 0.5, 5, 1.2, { step: 0.1 }), N('ctSat', 'Saturation', 0, 200, 130)],
    shader: `uniform float u_ctLevels, u_ctEdges, u_ctWidth, u_ctSat;
float Lm(vec2 uv){ return luma(unp(texture(u_tex, uv))); }
void main(){
  vec4 s = texture(u_tex, v_uv);
  vec2 px = u_ctWidth * u_srcScale / u_size;
  vec3 c = vec3(0.0);
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) c += unp(texture(u_tex, v_uv + vec2(i, j) * px));
  c /= 9.0;
  vec3 hsv = rgb2hsv(c);
  hsv.y = clamp(hsv.y * u_ctSat / 100.0, 0.0, 1.0);
  float lv = floor(u_ctLevels);
  hsv.z = floor(hsv.z * lv + 0.5) / lv;
  c = hsv2rgb(hsv);
  float gx = Lm(v_uv + vec2(px.x, 0.0)) - Lm(v_uv - vec2(px.x, 0.0));
  float gy = Lm(v_uv + vec2(0.0, px.y)) - Lm(v_uv - vec2(0.0, px.y));
  float e = smoothstep(0.08, 0.3, length(vec2(gx, gy))) * u_ctEdges / 100.0;
  o = vec4(c * (1.0 - e) * s.a, s.a);
}`,
  },
  halftone: {
    name: 'Halftone', group: 'Stylize', category: 'video',
    params: [S('htMode', 'Mode', ['Black & White', 'Color']), N('htSize', 'Dot Size', 2, 60, 8), N('htAngle', 'Angle', -90, 90, 45)],
    shader: `uniform float u_htMode, u_htSize, u_htAngle;
void main(){
  vec4 s = texture(u_tex, v_uv);
  float sz = max(1.0, u_htSize * u_srcScale);
  mat2 R = rot2(radians(u_htAngle));
  vec2 p = R * (v_uv * u_size);
  vec2 cell = (floor(p / sz) + 0.5) * sz;
  vec2 cuv = (transpose(R) * cell) / u_size;
  vec4 cs = texture(u_tex, clamp(cuv, 0.0, 1.0));
  vec3 cc = unp(cs);
  float d = length(p - cell);
  vec3 res;
  if (u_htMode < 0.5) {
    float r = sqrt(1.0 - luma(cc)) * sz * 0.72;
    res = vec3(1.0 - smoothstep(r - 1.0, r + 1.0, d));
    res = 1.0 - res;
  } else {
    float r = sqrt(luma(cc)) * sz * 0.75;
    res = cc / max(0.2, luma(cc)) * 0.6 * (1.0 - smoothstep(r - 1.0, r + 1.0, d));
  }
  o = vec4(clamp(res, 0.0, 1.0) * s.a, s.a);
}`,
  },
  emboss: {
    name: 'Emboss', group: 'Stylize', category: 'video',
    params: [N('ebStrength', 'Strength', 0, 400, 100), N('ebAngle', 'Direction', -360, 360, 135), N('ebBlend', 'Blend With Original', 0, 100, 0)],
    shader: `uniform float u_ebStrength, u_ebAngle, u_ebBlend;
void main(){
  vec4 s = texture(u_tex, v_uv);
  float a = radians(u_ebAngle);
  vec2 d = vec2(cos(a), sin(a)) * u_srcScale / u_size * 1.5;
  float e = luma(unp(texture(u_tex, v_uv + d))) - luma(unp(texture(u_tex, v_uv - d)));
  vec3 g = vec3(0.5 + e * u_ebStrength / 100.0 * 2.0);
  o = vec4(clamp(mix(g, unp(s), u_ebBlend / 100.0), 0.0, 1.0) * s.a, s.a);
}`,
  },
  sketch: {
    name: 'Pencil Sketch', group: 'Stylize', category: 'video',
    params: [N('skStrength', 'Strength', 0, 300, 120), B('skColor', 'Keep Color', false), N('skPaper', 'Paper Texture', 0, 100, 30)],
    shader: `uniform float u_skStrength, u_skColor, u_skPaper;
float Lm(vec2 uv){ return luma(unp(texture(u_tex, uv))); }
void main(){
  vec4 s = texture(u_tex, v_uv);
  vec2 px = u_srcScale / u_size;
  float gx = -Lm(v_uv + px * vec2(-1, -1)) - 2.0 * Lm(v_uv + px * vec2(-1, 0)) - Lm(v_uv + px * vec2(-1, 1)) + Lm(v_uv + px * vec2(1, -1)) + 2.0 * Lm(v_uv + px * vec2(1, 0)) + Lm(v_uv + px * vec2(1, 1));
  float gy = -Lm(v_uv + px * vec2(-1, -1)) - 2.0 * Lm(v_uv + px * vec2(0, -1)) - Lm(v_uv + px * vec2(1, -1)) + Lm(v_uv + px * vec2(-1, 1)) + 2.0 * Lm(v_uv + px * vec2(0, 1)) + Lm(v_uv + px * vec2(1, 1));
  float e = clamp(length(vec2(gx, gy)) * u_skStrength / 100.0, 0.0, 1.0);
  float paper = 1.0 - (vn(v_uv * u_size / (3.0 * u_srcScale)) - 0.5) * u_skPaper / 100.0 * 0.15;
  vec3 c = vec3(1.0 - e) * paper;
  if (u_skColor > 0.5) c *= mix(vec3(1.0), unp(s) / max(0.3, luma(unp(s))), 0.6);
  o = vec4(clamp(c, 0.0, 1.0) * s.a, s.a);
}`,
  },
  colorMap: {
    name: 'Color Map', group: 'Stylize', category: 'video',
    params: [S('cmMode', 'Style', ['Thermal', 'Night Vision', 'X-Ray', 'Infrared', 'Sepia Tone', 'Cyberpunk']), N('cmMix', 'Amount', 0, 100, 100)],
    shader: `uniform float u_cmMode, u_cmMix;
vec3 thermal(float t){ return clamp(vec3(smoothstep(0.3, 0.7, t), smoothstep(0.55, 0.95, t) + 0.6 * smoothstep(0.0, 0.3, t) * (1.0 - smoothstep(0.3, 0.6, t)), smoothstep(0.0, 0.25, t) * (1.0 - smoothstep(0.35, 0.6, t)) + smoothstep(0.85, 1.0, t)), 0.0, 1.0); }
void main(){
  vec4 s = texture(u_tex, v_uv);
  vec3 c = unp(s);
  float L = luma(c);
  int m = int(u_cmMode + 0.5);
  vec3 r;
  if (m == 0) r = thermal(L);
  else if (m == 1) r = vec3(0.1, 1.0, 0.2) * (L * 1.4 + (hash(v_uv * u_size + floor(u_time * 24.0)) - 0.5) * 0.12) * (1.0 - 0.6 * length(v_uv - 0.5));
  else if (m == 2) r = vec3(0.8, 0.92, 1.0) * pow(1.0 - L, 1.6);
  else if (m == 3) r = vec3(clamp(c.g * 1.6, 0.0, 1.0), c.r * 0.6, c.b * 0.9) + vec3(0.25, 0.0, 0.1) * c.g;
  else if (m == 4) r = vec3(L) * vec3(1.1, 0.88, 0.66);
  else r = mix(vec3(0.05, 0.0, 0.25), vec3(1.0, 0.15, 0.75), smoothstep(0.1, 0.6, L)) + vec3(0.0, 0.9, 1.0) * smoothstep(0.65, 1.0, L);
  o = vec4(mix(c, clamp(r, 0.0, 1.0), u_cmMix / 100.0) * s.a, s.a);
}`,
  },
  // ---------------- Yapay zekâ ----------------
  bgRemove: {
    name: 'Background Removal', group: 'AI', category: 'video', segment: true,
    params: [
      S('bgMode', 'Background', ['Transparent (shows track below)', 'Blur', 'Color'], 0),
      C('bgColor', 'Color', '#1f6f43'),
      N('bgBlur', 'Blur Amount', 2, 150, 45),
      N('bgEdge', 'Edge Softness', 0, 100, 30),
      N('bgShift', 'Shrink / Grow Edge', -50, 50, 0),
      B('bgInvert', 'Remove the Person Instead', false),
    ],
    shader: `uniform sampler2D u_segMask; uniform float u_hasSeg;
uniform float u_bgMode, u_bgBlur, u_bgEdge, u_bgShift, u_bgInvert; uniform vec3 u_bgColor;
void main(){
  vec4 c = texture(u_tex, v_uv);
  if (u_hasSeg < 0.5) { o = c; return; }
  float m = texture(u_segMask, vec2(v_uv.x, 1.0 - v_uv.y)).r;
  float th = 0.5 - u_bgShift / 100.0, w = max(0.01, u_bgEdge / 200.0);
  float a = smoothstep(th - w, th + w, m);
  if (u_bgInvert > 0.5) a = 1.0 - a;
  vec4 bg = vec4(0.0);
  if (u_bgMode > 1.5) bg = vec4(u_bgColor, 1.0);
  else if (u_bgMode > 0.5) {
    vec4 acc = vec4(0.0);
    float r = u_bgBlur * u_srcScale;
    for (int i = 0; i < 40; i++) {
      float fi = float(i);
      float rr = sqrt((fi + 0.5) / 40.0) * r, an = fi * 2.39996;
      acc += texture(u_tex, clamp(v_uv + vec2(cos(an), sin(an)) * rr / u_size, 0.0, 1.0));
    }
    bg = acc / 40.0;
  }
  o = c * a + bg * (1.0 - a);
}`,
  },
  letterbox: {
    name: 'Cinematic Bars', group: 'Transform', category: 'video',
    params: [S('lbAspect', 'Aspect Ratio', ['2.39:1', '2.35:1', '2:1', '1.85:1', '4:3', '1:1', '4:5', '9:16']), C('lbColor', 'Color', '#000000'), N('lbOpacity', 'Opacity', 0, 100, 100)],
    shader: `uniform float u_lbAspect, u_lbOpacity; uniform vec3 u_lbColor;
void main(){
  vec4 s = texture(u_tex, v_uv);
  int m = int(u_lbAspect + 0.5);
  float ar = m == 0 ? 2.39 : m == 1 ? 2.35 : m == 2 ? 2.0 : m == 3 ? 1.85 : m == 4 ? 1.3333 : m == 5 ? 1.0 : m == 6 ? 0.8 : 0.5625;
  float cur = u_size.x / u_size.y;
  float bar;
  if (ar > cur) { float h = cur / ar; bar = step(0.5 * h, abs(v_uv.y - 0.5)); }
  else { float w = ar / cur; bar = step(0.5 * w, abs(v_uv.x - 0.5)); }
  float k = bar * u_lbOpacity / 100.0;
  o = mix(s, vec4(u_lbColor, 1.0), k);
}`,
  },
};

export const EXTRA_GROUPS = ['Motion', 'Retro', 'Light'];
