// Ek video geçişleri (TRANSITION_HEADER: A(uv), B(uv), u_p, u_size, inside(uv))

const SHAPE = (sdf) => `float sdf(vec2 p){ ${sdf} }
void main(){
  vec2 p = (v_uv - 0.5) * vec2(u_size.x / u_size.y, 1.0);
  p.y = -p.y;
  float r = u_p * 1.6;
  float d = sdf(p / max(r, 0.0001));
  float m = 1.0 - smoothstep(-0.02, 0.02, d);
  o = mix(A(v_uv), B(v_uv), u_p >= 1.0 ? 1.0 : m);
}`;

export const EXTRA_TRANSITIONS = {
  smoothZoomIn: {
    name: 'Smooth Zoom In', group: 'Zoom', category: 'video',
    shader: `void main(){
  float e = u_p < 0.5 ? 4.0 * u_p * u_p * u_p : 1.0 - pow(-2.0 * u_p + 2.0, 3.0) / 2.0;
  vec2 c = vec2(0.5);
  vec4 acc = vec4(0.0);
  float blur = sin(u_p * 3.14159) * 0.12;
  for (int i = 0; i < 16; i++) {
    float k = float(i) / 15.0 * blur;
    vec2 ua = c + (v_uv - c) / (1.0 + e * 4.0 + k);
    vec2 ub = c + (v_uv - c) / (0.2 + e * 0.8 + k);
    acc += u_p < 0.5 ? A(ua) : B(ub);
  }
  o = acc / 16.0;
}`,
  },
  smoothZoomOut: {
    name: 'Smooth Zoom Out', group: 'Zoom', category: 'video',
    shader: `void main(){
  float e = u_p < 0.5 ? 4.0 * u_p * u_p * u_p : 1.0 - pow(-2.0 * u_p + 2.0, 3.0) / 2.0;
  vec2 c = vec2(0.5);
  vec4 acc = vec4(0.0);
  float blur = sin(u_p * 3.14159) * 0.12;
  for (int i = 0; i < 16; i++) {
    float k = float(i) / 15.0 * blur;
    vec2 ua = c + (v_uv - c) * (1.0 + e * 2.0 + k);
    vec2 ub = c + (v_uv - c) * (3.0 - e * 2.0 + k);
    vec4 col = u_p < 0.5 ? A(ua) : B(ub);
    acc += inside(u_p < 0.5 ? ua : ub) ? col : vec4(0.0, 0.0, 0.0, 1.0);
  }
  o = acc / 16.0;
}`,
  },
  flashWhite: {
    name: 'Flash', group: 'Dissolve', category: 'video',
    shader: `void main(){
  float f = exp(-pow((u_p - 0.5) * 7.0, 2.0));
  vec4 c = mix(A(v_uv), B(v_uv), step(0.5, u_p));
  o = vec4(mix(c.rgb, vec3(1.0), f), max(c.a, f));
}`,
  },
  lumaFade: {
    name: 'Luma Fade', group: 'Dissolve', category: 'video',
    shader: `void main(){
  vec4 a = A(v_uv), b = B(v_uv);
  float L = dot(b.rgb, vec3(0.2126, 0.7152, 0.0722));
  float m = smoothstep(L - 0.1, L + 0.1, u_p * 1.2 - 0.1);
  o = mix(a, b, m);
}`,
  },
  inkDissolve: {
    name: 'Ink Dissolve', group: 'Dissolve', category: 'video',
    shader: `float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
float fb(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * n(p); p *= 2.1; a *= 0.5; } return v; }
void main(){
  vec2 q = (v_uv - 0.5) * vec2(u_size.x / u_size.y, 1.0);
  float v = fb(v_uv * vec2(u_size.x / u_size.y, 1.0) * 4.0) * 0.6 + length(q) * 0.7;
  float t = u_p * 1.5 - 0.2;
  float m = smoothstep(t - 0.04, t + 0.04, v);
  float edge = smoothstep(0.05, 0.0, abs(v - t)) * (1.0 - u_p);
  o = mix(B(v_uv), A(v_uv), m) * (1.0 - edge * 0.85);
}`,
  },
  filmBurn: {
    name: 'Film Burn', group: 'Stylize', category: 'video',
    shader: `float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
void main(){
  float k = sin(u_p * 3.14159);
  vec2 p = v_uv * vec2(u_size.x / u_size.y, 1.0) * 2.5;
  float b = n(p + u_p * 3.0) * 0.6 + n(p * 2.3 - u_p * 2.0) * 0.4;
  float heat = smoothstep(1.0 - k * 1.1, 1.0, b + (1.0 - v_uv.x) * 0.35 * k);
  vec3 fire = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.95, 0.75), heat);
  vec4 c = mix(A(v_uv), B(v_uv), smoothstep(0.4, 0.6, u_p));
  o = vec4(mix(c.rgb, fire, heat) + fire * k * 0.25, max(c.a, heat));
}`,
  },
  heartWipe: { name: 'Heart Wipe', group: 'Iris', category: 'video', shader: SHAPE(`p.y += 0.25; p.x = abs(p.x); float a = atan(p.x, p.y) / 3.14159; float r = length(p); float h = abs(a); float d = (13.0*h - 22.0*h*h + 10.0*h*h*h) / (6.0 - 5.0*h); return r - d * 0.5;`) },
  starWipe: { name: 'Star Wipe', group: 'Iris', category: 'video', shader: SHAPE(`float a = atan(p.y, p.x); float r = length(p); float k = 0.5 + 0.5 * cos(a * 5.0 + 1.5708); return r - mix(0.25, 0.55, k);`) },
  diamondWipe: { name: 'Diamond Wipe', group: 'Iris', category: 'video', shader: SHAPE(`return abs(p.x) + abs(p.y) - 0.5;`) },
  clockWipe: {
    name: 'Clock Wipe', group: 'Wipe', category: 'video',
    shader: `void main(){
  vec2 d = v_uv - 0.5; d.x *= u_size.x / u_size.y;
  float a = atan(d.x, -d.y) / 6.2831853 + 0.5;
  a = fract(a + 0.5);
  float m = smoothstep(u_p - 0.003, u_p + 0.003, a);
  o = mix(B(v_uv), A(v_uv), m);
}`,
  },
  splitOpen: {
    name: 'Split', group: 'Wipe', category: 'video',
    shader: `void main(){
  float e = u_p * u_p * (3.0 - 2.0 * u_p);
  float half_ = e * 0.5;
  if (abs(v_uv.y - 0.5) < half_) { o = B(v_uv); return; }
  vec2 uv = v_uv; uv.y += v_uv.y < 0.5 ? half_ : -half_;
  o = A(uv);
}`,
  },
  randomSquares: {
    name: 'Random Blocks', group: 'Wipe', category: 'video',
    shader: `float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 cells = vec2(16.0, 9.0);
  float r = h(floor(v_uv * cells));
  float m = smoothstep(r - 0.1, r + 0.1, u_p * 1.2 - 0.1);
  o = mix(A(v_uv), B(v_uv), m);
}`,
  },
  pixelateTrans: {
    name: 'Pixelate', group: 'Stylize', category: 'video',
    shader: `void main(){
  float k = sin(u_p * 3.14159);
  float n = mix(1.0, 60.0, k * k);
  vec2 bs = n / u_size;
  vec2 uv = n > 1.5 ? (floor(v_uv / bs) + 0.5) * bs : v_uv;
  o = mix(A(uv), B(uv), smoothstep(0.4, 0.6, u_p));
}`,
  },
  rippleTrans: {
    name: 'Ripple Dissolve', group: 'Dissolve', category: 'video',
    shader: `void main(){
  float k = sin(u_p * 3.14159);
  vec2 d = v_uv - 0.5; d.x *= u_size.x / u_size.y;
  float r = length(d);
  vec2 off = (r > 0.0 ? d / r : vec2(0.0)) * sin(r * 60.0 - u_p * 30.0) * 0.02 * k;
  off.x /= u_size.x / u_size.y;
  o = mix(A(v_uv + off), B(v_uv + off), smoothstep(0.3, 0.7, u_p));
}`,
  },
  swirlTrans: {
    name: 'Swirl', group: 'Zoom', category: 'video',
    shader: `void main(){
  float k = sin(u_p * 3.14159);
  vec2 asp = vec2(u_size.x / u_size.y, 1.0);
  vec2 d = (v_uv - 0.5) * asp;
  float r = length(d);
  float a = k * 6.0 * max(0.0, 1.0 - r / 0.8);
  d = mat2(cos(a), -sin(a), sin(a), cos(a)) * d;
  vec2 uv = d / asp + 0.5;
  o = mix(A(uv), B(uv), smoothstep(0.35, 0.65, u_p));
}`,
  },
  cubeRotate: {
    name: 'Cube Spin', group: '3D', category: 'video',
    shader: `void main(){
  float e = u_p * u_p * (3.0 - 2.0 * u_p);
  float ang = e * 1.5707963;
  float x = v_uv.x;
  // A yüzü sola döner, B yüzü sağdan gelir (basit perspektif)
  float wA = cos(ang), wB = sin(ang);
  float split = wA;
  vec4 col;
  if (x < split) {
    float u = x / max(split, 0.0001);
    float persp = 1.0 + 0.25 * (1.0 - u) * sin(ang);
    vec2 uv = vec2(u, (v_uv.y - 0.5) * persp + 0.5);
    col = inside(uv) ? A(uv) * (0.6 + 0.4 * wA) : vec4(0.0, 0.0, 0.0, 1.0);
  } else {
    float u = (x - split) / max(wB, 0.0001);
    float persp = 1.0 + 0.25 * u * cos(ang);
    vec2 uv = vec2(u, (v_uv.y - 0.5) * persp + 0.5);
    col = inside(uv) ? B(uv) * (0.6 + 0.4 * wB) : vec4(0.0, 0.0, 0.0, 1.0);
  }
  o = col;
}`,
  },
  doorway: {
    name: 'Doorway', group: '3D', category: 'video',
    shader: `void main(){
  float e = u_p * u_p * (3.0 - 2.0 * u_p);
  vec2 cb = vec2(0.5);
  vec4 b = B(cb + (v_uv - cb) / (0.7 + 0.3 * e));
  float half_ = 0.5 * (1.0 - e);
  if (v_uv.x < half_) { vec2 uv = vec2(v_uv.x / max(half_, 1e-4) * 0.5, (v_uv.y - 0.5) * (1.0 + e * 0.3 * (1.0 - v_uv.x / max(half_, 1e-4))) + 0.5); o = inside(uv) ? A(uv) : b; return; }
  if (v_uv.x > 1.0 - half_) { float u = (v_uv.x - (1.0 - half_)) / max(half_, 1e-4); vec2 uv = vec2(0.5 + u * 0.5, (v_uv.y - 0.5) * (1.0 + e * 0.3 * u) + 0.5); o = inside(uv) ? A(uv) : b; return; }
  o = b;
}`,
  },
  slideUp: {
    name: 'Slide Up', group: 'Slide', category: 'video',
    shader: `void main(){ float e = u_p * u_p * (3.0 - 2.0 * u_p); o = v_uv.y > 1.0 - e ? B(vec2(v_uv.x, v_uv.y - (1.0 - e))) : A(v_uv); }`,
  },
  pushDown: {
    name: 'Push Down', group: 'Slide', category: 'video',
    shader: `void main(){ float e = u_p * u_p * (3.0 - 2.0 * u_p); o = v_uv.y < e ? B(vec2(v_uv.x, v_uv.y + 1.0 - e)) : A(vec2(v_uv.x, v_uv.y - e)); }`,
  },
  rgbSplitSlide: {
    name: 'RGB Split Slide', group: 'Slide', category: 'video',
    shader: `vec4 P(vec2 uv, float e){ float x = uv.x + e; return x < 1.0 ? A(vec2(x, uv.y)) : B(vec2(x - 1.0, uv.y)); }
void main(){
  float e = u_p < 0.5 ? 4.0 * u_p * u_p * u_p : 1.0 - pow(-2.0 * u_p + 2.0, 3.0) / 2.0;
  float sp = sin(u_p * 3.14159) * 0.04;
  vec4 r = P(v_uv + vec2(sp, 0.0), e), g = P(v_uv, e), b = P(v_uv - vec2(sp, 0.0), e);
  o = vec4(r.r, g.g, b.b, g.a);
}`,
  },
};
