// Video efektleri ve geçiş tanımları (GLSL ES 3.0 shader'ları ile)

export const FX_HEADER = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_tex;
uniform vec2 u_size;
uniform float u_time;
uniform float u_srcScale;
vec3 unp(vec4 c) { return c.a > 0.00001 ? c.rgb / c.a : vec3(0.0); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

const LUMETRI_SHADER = `
uniform float u_temperature, u_tint, u_exposure, u_contrast, u_highlights, u_shadows, u_whites, u_blacks;
uniform float u_saturation, u_vibrance, u_lutIntensity, u_faded, u_sharpen;
uniform float u_vigAmount, u_vigMidpoint, u_vigRoundness, u_vigFeather;
uniform vec2 u_wShadows, u_wMids, u_wHighs;
uniform float u_wShadowsL, u_wMidsL, u_wHighsL;
uniform float u_hasLut, u_lutSize;
uniform sampler3D u_lutTex;
uniform float u_hasCurves;
uniform sampler2D u_curveTex;
uniform float u_hslEnable, u_hslShowMask, u_hslHue, u_hslHueRange, u_hslSatMin, u_hslLumMin, u_hslLumMax, u_hslSoft;
uniform float u_hslTemp, u_hslTint, u_hslSat, u_hslExposure, u_hslHueShift, u_hslContrast;
vec3 wheelColor(vec2 w) {
  float len = clamp(length(w), 0.0, 1.0);
  if (len < 0.0001) return vec3(0.0);
  float ang = atan(w.y, w.x) / 6.2831853;
  vec3 hue = hsv2rgb(vec3(fract(ang), 1.0, 1.0));
  return (hue - vec3(luma(hue))) * len;
}
void main() {
  vec4 s = texture(u_tex, v_uv);
  float a = s.a;
  vec3 c = unp(s);
  if (u_sharpen > 0.0) {
    vec2 px = 1.0 / u_size;
    vec3 n = unp(texture(u_tex, v_uv + vec2(px.x, 0.0))) + unp(texture(u_tex, v_uv - vec2(px.x, 0.0)))
           + unp(texture(u_tex, v_uv + vec2(0.0, px.y))) + unp(texture(u_tex, v_uv - vec2(0.0, px.y)));
    c += (c - n * 0.25) * (u_sharpen / 100.0) * 2.0;
  }
  float t = u_temperature / 100.0;
  float ti = u_tint / 100.0;
  c *= vec3(1.0 + 0.25 * t, 1.0 - 0.25 * ti, 1.0 - 0.25 * t);
  c *= exp2(u_exposure);
  float L = luma(c);
  float ms = 1.0 - smoothstep(0.0, 0.55, L);
  float mh = smoothstep(0.45, 1.0, L);
  c += (u_shadows / 100.0) * 0.30 * ms;
  c += (u_highlights / 100.0) * 0.30 * mh;
  float bp = -u_blacks / 100.0 * 0.12;
  float wp = 1.0 - u_whites / 100.0 * 0.22;
  c = (c - bp) / max(0.05, (wp - bp));
  float k = u_contrast / 100.0;
  c = (c - 0.5) * (1.0 + (k > 0.0 ? k * 0.9 : k * 0.7)) + 0.5;
  L = clamp(luma(c), 0.0, 1.0);
  float wS = (1.0 - L) * (1.0 - L);
  float wH = L * L;
  float wM = clamp(1.0 - abs(2.0 * L - 1.0), 0.0, 1.0);
  c += wheelColor(u_wShadows) * 0.35 * wS + (u_wShadowsL / 100.0) * 0.3 * wS;
  c += wheelColor(u_wMids) * 0.35 * wM + (u_wMidsL / 100.0) * 0.3 * wM;
  c += wheelColor(u_wHighs) * 0.35 * wH + (u_wHighsL / 100.0) * 0.3 * wH;
  L = luma(c);
  c = mix(vec3(L), c, u_saturation / 100.0);
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float sat = clamp(mx - mn, 0.0, 1.0);
  c = mix(vec3(L), c, 1.0 + (u_vibrance / 100.0) * (1.0 - sat));
  c = mix(c, c * 0.82 + 0.12, u_faded / 100.0);
  if (u_hasLut > 0.5) {
    vec3 cc = clamp(c, 0.0, 1.0);
    vec3 lc = texture(u_lutTex, cc * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize).rgb;
    c = mix(c, lc, u_lutIntensity / 100.0);
  }
  if (u_hasCurves > 0.5) {
    vec3 cc = clamp(c, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0;
    c = vec3(texture(u_curveTex, vec2(cc.r, 0.5)).r, texture(u_curveTex, vec2(cc.g, 0.5)).g, texture(u_curveTex, vec2(cc.b, 0.5)).b);
    vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
    float sm = texture(u_curveTex, vec2(hsv.x * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).a * 2.0;
    c = mix(vec3(luma(c)), c, sm);
  }
  if (u_hslEnable > 0.5) {
    // HSL ikincil: renk aralığına göre anahtar, yalnız o bölgede düzeltme
    vec3 cl = clamp(c, 0.0, 1.0);
    vec3 hv = rgb2hsv(cl);
    float soft = max(0.001, u_hslSoft / 100.0);
    float dh = abs(hv.x * 360.0 - u_hslHue); dh = min(dh, 360.0 - dh);
    float kh = 1.0 - smoothstep(u_hslHueRange * 0.5, u_hslHueRange * 0.5 + 60.0 * soft + 0.5, dh);
    float ks = smoothstep(u_hslSatMin / 100.0 - 0.15 * soft, u_hslSatMin / 100.0 + 0.15 * soft + 0.001, hv.y);
    float Lk = luma(cl);
    float kl = smoothstep(u_hslLumMin / 100.0 - 0.1 * soft, u_hslLumMin / 100.0 + 0.1 * soft + 0.001, Lk)
             * (1.0 - smoothstep(u_hslLumMax / 100.0 - 0.1 * soft - 0.001, u_hslLumMax / 100.0 + 0.1 * soft, Lk));
    float key = kh * ks * kl;
    vec3 h2 = rgb2hsv(cl);
    h2.x = fract(h2.x + u_hslHueShift / 360.0 + 1.0);
    h2.y = clamp(h2.y * u_hslSat / 100.0, 0.0, 1.0);
    vec3 cc = hsv2rgb(h2);
    cc *= exp2(u_hslExposure);
    cc = (cc - 0.5) * (1.0 + u_hslContrast / 100.0 * 0.8) + 0.5;
    cc *= vec3(1.0 + 0.25 * u_hslTemp / 100.0, 1.0 - 0.25 * u_hslTint / 100.0, 1.0 - 0.25 * u_hslTemp / 100.0);
    c = mix(c, cc, key);
    if (u_hslShowMask > 0.5) c = mix(vec3(0.5), cl, key);
  }
  if (abs(u_vigAmount) > 0.001) {
    vec2 d = v_uv - 0.5;
    float aspect = u_size.x / u_size.y;
    float r = u_vigRoundness / 100.0;
    d.x *= mix(1.0, aspect, max(r, 0.0));
    d *= 1.0 + max(-r, 0.0);
    float dist = length(d) * 1.4142;
    float mid = u_vigMidpoint / 100.0;
    float fe = max(0.01, u_vigFeather / 100.0);
    float v = smoothstep(mid - fe * 0.5, mid + fe * 0.5, dist);
    float amt = u_vigAmount / 100.0;
    if (amt < 0.0) c *= 1.0 + amt * v; else c = mix(c, vec3(1.0), amt * v);
  }
  c = clamp(c, 0.0, 1.0);
  o = vec4(c * a, a);
}`;

const BLUR_SHADER = `
uniform float u_blurriness;
uniform float u_dimensions;
uniform vec2 u_dir;
void main() {
  float r = u_blurriness * u_srcScale * 0.5;
  bool skip = (u_dimensions > 0.5 && u_dimensions < 1.5 && u_dir.y > 0.5) || (u_dimensions > 1.5 && u_dir.x > 0.5);
  if (r < 0.5 || skip) { o = texture(u_tex, v_uv); return; }
  vec2 px = u_dir / u_size;
  float sigma = r * 0.5;
  float stp = max(1.0, (r * 1.5) / 32.0);
  vec4 acc = vec4(0.0);
  float ws = 0.0;
  for (int i = -32; i <= 32; i++) {
    float x = float(i) * stp;
    float w = exp(-(x * x) / (2.0 * sigma * sigma));
    acc += texture(u_tex, v_uv + px * x) * w;
    ws += w;
  }
  o = acc / ws;
}`;

export const EFFECTS = {
  lumetri: {
    name: 'Lumetri Color', group: 'Color Correction', category: 'video',
    params: [
      { key: 'temperature', label: 'Temperature', min: -100, max: 100, default: 0, section: 'Basic Correction' },
      { key: 'tint', label: 'Tint', min: -100, max: 100, default: 0, section: 'Basic Correction' },
      { key: 'exposure', label: 'Exposure', min: -4, max: 4, step: 0.05, default: 0, section: 'Basic Correction' },
      { key: 'contrast', label: 'Contrast', min: -100, max: 100, default: 0, section: 'Basic Correction' },
      { key: 'highlights', label: 'Highlights', min: -100, max: 100, default: 0, section: 'Basic Correction' },
      { key: 'shadows', label: 'Shadows', min: -100, max: 100, default: 0, section: 'Basic Correction' },
      { key: 'whites', label: 'Whites', min: -100, max: 100, default: 0, section: 'Basic Correction' },
      { key: 'blacks', label: 'Blacks', min: -100, max: 100, default: 0, section: 'Basic Correction' },
      { key: 'saturation', label: 'Saturation', min: 0, max: 200, default: 100, section: 'Basic Correction' },
      { key: 'lut', label: 'Look (LUT)', type: 'lut', default: '', animatable: false, section: 'Creative' },
      { key: 'lutIntensity', label: 'Intensity', min: 0, max: 100, default: 100, section: 'Creative' },
      { key: 'faded', label: 'Faded Film', min: 0, max: 100, default: 0, section: 'Creative' },
      { key: 'sharpen', label: 'Sharpen', min: 0, max: 100, default: 0, section: 'Creative' },
      { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, default: 0, section: 'Creative' },
      { key: 'hslEnable', label: 'HSL Secondary', type: 'bool', default: false, animatable: false, section: 'HSL Secondary' },
      { key: 'hslShowMask', label: 'Show Mask', type: 'bool', default: false, animatable: false, section: 'HSL Secondary' },
      { key: 'hslHue', label: 'Hue', min: 0, max: 360, default: 30, section: 'HSL Secondary' },
      { key: 'hslHueRange', label: 'Hue Range', min: 0, max: 180, default: 40, section: 'HSL Secondary' },
      { key: 'hslSatMin', label: 'Min Saturation', min: 0, max: 100, default: 15, section: 'HSL Secondary' },
      { key: 'hslLumMin', label: 'Min Luminance', min: 0, max: 100, default: 0, section: 'HSL Secondary' },
      { key: 'hslLumMax', label: 'Max Luminance', min: 0, max: 100, default: 100, section: 'HSL Secondary' },
      { key: 'hslSoft', label: 'Softness', min: 0, max: 100, default: 30, section: 'HSL Secondary' },
      { key: 'hslHueShift', label: 'Hue Shift', min: -180, max: 180, default: 0, section: 'HSL Secondary' },
      { key: 'hslSat', label: 'Saturation', min: 0, max: 200, default: 100, section: 'HSL Secondary' },
      { key: 'hslExposure', label: 'Exposure', min: -2, max: 2, step: 0.02, default: 0, section: 'HSL Secondary' },
      { key: 'hslContrast', label: 'Contrast', min: -100, max: 100, default: 0, section: 'HSL Secondary' },
      { key: 'hslTemp', label: 'Temperature', min: -100, max: 100, default: 0, section: 'HSL Secondary' },
      { key: 'hslTint', label: 'Tint', min: -100, max: 100, default: 0, section: 'HSL Secondary' },
      { key: 'curves', label: 'Curves', type: 'curves', default: { m: [0, 0, 1, 1], r: [0, 0, 1, 1], g: [0, 0, 1, 1], b: [0, 0, 1, 1], hs: [] }, animatable: false, section: 'Curves' },
      { key: 'wShadows', label: 'Shadow Tint', type: 'point', min: -1, max: 1, default: [0, 0], section: 'Color Wheels' },
      { key: 'wShadowsL', label: 'Shadow Lum', min: -100, max: 100, default: 0, section: 'Color Wheels' },
      { key: 'wMids', label: 'Midtone Tint', type: 'point', min: -1, max: 1, default: [0, 0], section: 'Color Wheels' },
      { key: 'wMidsL', label: 'Midtone Lum', min: -100, max: 100, default: 0, section: 'Color Wheels' },
      { key: 'wHighs', label: 'Highlight Tint', type: 'point', min: -1, max: 1, default: [0, 0], section: 'Color Wheels' },
      { key: 'wHighsL', label: 'Highlight Lum', min: -100, max: 100, default: 0, section: 'Color Wheels' },
      { key: 'vigAmount', label: 'Vignette Amount', min: -100, max: 100, default: 0, section: 'Vignette' },
      { key: 'vigMidpoint', label: 'Midpoint', min: 0, max: 100, default: 50, section: 'Vignette' },
      { key: 'vigRoundness', label: 'Roundness', min: -100, max: 100, default: 0, section: 'Vignette' },
      { key: 'vigFeather', label: 'Feather', min: 0, max: 100, default: 50, section: 'Vignette' },
    ],
    shader: LUMETRI_SHADER,
  },
  brightnessContrast: {
    name: 'Brightness & Contrast', group: 'Color Correction', category: 'video',
    params: [
      { key: 'brightness', label: 'Brightness', min: -100, max: 100, default: 0 },
      { key: 'contrastBC', label: 'Contrast', min: -100, max: 100, default: 0 },
    ],
    shader: `uniform float u_brightness, u_contrastBC;
void main(){ vec4 s=texture(u_tex,v_uv); vec3 c=unp(s);
 c += u_brightness/100.0*0.5; c = (c-0.5)*(1.0+u_contrastBC/100.0)+0.5;
 o=vec4(clamp(c,0.0,1.0)*s.a,s.a);}`,
  },
  blackWhite: {
    name: 'Black & White', group: 'Image Control', category: 'video', params: [],
    shader: `void main(){ vec4 s=texture(u_tex,v_uv); vec3 c=unp(s); o=vec4(vec3(luma(c))*s.a,s.a);}`,
  },
  tint: {
    name: 'Tint', group: 'Color Correction', category: 'video',
    params: [
      { key: 'mapBlack', label: 'Map Black To', type: 'color', default: '#000000' },
      { key: 'mapWhite', label: 'Map White To', type: 'color', default: '#ffffff' },
      { key: 'amount', label: 'Amount to Tint', min: 0, max: 100, default: 100 },
    ],
    shader: `uniform vec3 u_mapBlack, u_mapWhite; uniform float u_amount;
void main(){ vec4 s=texture(u_tex,v_uv); vec3 c=unp(s); vec3 t=mix(u_mapBlack,u_mapWhite,luma(c));
 o=vec4(mix(c,t,u_amount/100.0)*s.a,s.a);}`,
  },
  leaveColor: {
    name: 'Leave Color', group: 'Color Correction', category: 'video',
    params: [
      { key: 'keep', label: 'Color To Leave', type: 'color', default: '#ff0000' },
      { key: 'amountDecolor', label: 'Amount to Decolor', min: 0, max: 100, default: 100 },
      { key: 'tol', label: 'Tolerance', min: 0, max: 100, default: 25 },
      { key: 'edge', label: 'Edge Softness', min: 0, max: 100, default: 10 },
    ],
    shader: `uniform vec3 u_keep; uniform float u_amountDecolor, u_tol, u_edge;
void main(){ vec4 s=texture(u_tex,v_uv); vec3 c=unp(s);
 vec3 h=rgb2hsv(c); vec3 kh=rgb2hsv(u_keep); float dh=abs(h.x-kh.x); dh=min(dh,1.0-dh);
 float tol=u_tol/100.0*0.5; float m=smoothstep(tol, tol+u_edge/100.0*0.3+0.001, dh);
 vec3 g=vec3(luma(c)); c=mix(c,g,m*u_amountDecolor/100.0); o=vec4(c*s.a,s.a);}`,
  },
  invert: {
    name: 'Invert', group: 'Channel', category: 'video',
    params: [{ key: 'blend', label: 'Blend With Original', min: 0, max: 100, default: 0 }],
    shader: `uniform float u_blend;
void main(){ vec4 s=texture(u_tex,v_uv); vec3 c=unp(s); o=vec4(mix(1.0-c,c,u_blend/100.0)*s.a,s.a);}`,
  },
  posterize: {
    name: 'Posterize', group: 'Stylize', category: 'video',
    params: [{ key: 'levels', label: 'Level', min: 2, max: 32, step: 1, default: 6 }],
    shader: `uniform float u_levels;
void main(){ vec4 s=texture(u_tex,v_uv); vec3 c=unp(s); float l=max(2.0,floor(u_levels));
 c=floor(c*l)/(l-1.0); o=vec4(clamp(c,0.0,1.0)*s.a,s.a);}`,
  },
  noise: {
    name: 'Noise', group: 'Stylize', category: 'video',
    params: [
      { key: 'amountNoise', label: 'Amount of Noise', min: 0, max: 100, default: 10 },
      { key: 'colorNoise', label: 'Color Noise', type: 'bool', default: true, animatable: false },
    ],
    shader: `uniform float u_amountNoise, u_colorNoise;
void main(){ vec4 s=texture(u_tex,v_uv); vec3 c=unp(s); vec2 p=floor(v_uv*u_size)+fract(u_time*13.17)*100.0;
 vec3 n = u_colorNoise>0.5 ? vec3(hash(p),hash(p+3.1),hash(p+7.7)) : vec3(hash(p));
 c += (n-0.5)*u_amountNoise/100.0; o=vec4(clamp(c,0.0,1.0)*s.a,s.a);}`,
  },
  gaussianBlur: {
    name: 'Gaussian Blur', group: 'Blur & Sharpen', category: 'video',
    params: [
      { key: 'blurriness', label: 'Blurriness', min: 0, max: 500, default: 20 },
      { key: 'dimensions', label: 'Blur Dimensions', type: 'select', options: ['Horizontal and Vertical', 'Horizontal', 'Vertical'], default: 0, animatable: false },
    ],
    shader: BLUR_SHADER,
    passes: [[1, 0], [0, 1]],
  },
  directionalBlur: {
    name: 'Directional Blur', group: 'Blur & Sharpen', category: 'video',
    params: [
      { key: 'angle', label: 'Direction', min: -360, max: 360, default: 0 },
      { key: 'blurLength', label: 'Blur Length', min: 0, max: 300, default: 20 },
    ],
    shader: `uniform float u_angle, u_blurLength;
void main(){ float L=u_blurLength*u_srcScale; if(L<0.5){o=texture(u_tex,v_uv);return;}
 float a=radians(u_angle); vec2 d=vec2(sin(a),cos(a))/u_size*L; vec4 acc=vec4(0.0);
 for(int i=0;i<48;i++){ float t=float(i)/47.0-0.5; acc+=texture(u_tex,v_uv+d*t);} o=acc/48.0;}`,
  },
  sharpen: {
    name: 'Sharpen', group: 'Blur & Sharpen', category: 'video',
    params: [{ key: 'sharpAmount', label: 'Sharpen Amount', min: 0, max: 200, default: 25 }],
    shader: `uniform float u_sharpAmount;
void main(){ vec2 px=1.0/u_size; vec4 s=texture(u_tex,v_uv); vec3 c=unp(s);
 vec3 n=unp(texture(u_tex,v_uv+vec2(px.x,0.0)))+unp(texture(u_tex,v_uv-vec2(px.x,0.0)))+unp(texture(u_tex,v_uv+vec2(0.0,px.y)))+unp(texture(u_tex,v_uv-vec2(0.0,px.y)));
 c += (c-n*0.25)*u_sharpAmount/25.0; o=vec4(clamp(c,0.0,1.0)*s.a,s.a);}`,
  },
  mosaic: {
    name: 'Mosaic', group: 'Stylize', category: 'video',
    params: [
      { key: 'hBlocks', label: 'Horizontal Blocks', min: 1, max: 1000, step: 1, default: 40 },
      { key: 'vBlocks', label: 'Vertical Blocks', min: 1, max: 1000, step: 1, default: 24 },
    ],
    shader: `uniform float u_hBlocks, u_vBlocks;
void main(){ vec2 b=vec2(max(1.0,u_hBlocks),max(1.0,u_vBlocks)); vec2 uv=(floor(v_uv*b)+0.5)/b; o=texture(u_tex,uv);}`,
  },
  ultraKey: {
    name: 'Ultra Key', group: 'Keying', category: 'video',
    params: [
      { key: 'keyColor', label: 'Key Color', type: 'color', default: '#00ff00' },
      { key: 'tolerance', label: 'Tolerance', min: 0, max: 100, default: 35 },
      { key: 'softness', label: 'Softness', min: 0, max: 100, default: 15 },
      { key: 'spill', label: 'Spill Suppression', min: 0, max: 100, default: 60 },
      { key: 'choke', label: 'Choke', min: 0, max: 100, default: 0 },
    ],
    shader: `uniform vec3 u_keyColor; uniform float u_tolerance, u_softness, u_spill, u_choke;
vec2 chroma(vec3 c){ return vec2(dot(c,vec3(-0.1146,-0.3854,0.5)), dot(c,vec3(0.5,-0.4542,-0.0458))); }
void main(){ vec4 s=texture(u_tex,v_uv); vec3 c=unp(s);
 float d=distance(chroma(c),chroma(u_keyColor));
 float tol=u_tolerance/100.0*0.35; float soft=u_softness/100.0*0.3+0.002;
 float al=smoothstep(tol,tol+soft,d);
 al=clamp((al-u_choke/100.0*0.5)/(1.0-u_choke/100.0*0.5),0.0,1.0);
 float sp=u_spill/100.0;
 if(u_keyColor.g>=u_keyColor.r && u_keyColor.g>=u_keyColor.b){ c.g=mix(c.g,min(c.g,(c.r+c.b)*0.5),sp);}
 else if(u_keyColor.b>=u_keyColor.r){ c.b=mix(c.b,min(c.b,(c.r+c.g)*0.5),sp);}
 else { c.r=mix(c.r,min(c.r,(c.g+c.b)*0.5),sp);}
 float a=s.a*al; o=vec4(c*a,a);}`,
  },
  crop: {
    name: 'Crop', group: 'Transform', category: 'video',
    params: [
      { key: 'left', label: 'Left', min: 0, max: 100, default: 0 },
      { key: 'top', label: 'Top', min: 0, max: 100, default: 0 },
      { key: 'right', label: 'Right', min: 0, max: 100, default: 0 },
      { key: 'bottom', label: 'Bottom', min: 0, max: 100, default: 0 },
      { key: 'feather', label: 'Edge Feather', min: 0, max: 200, default: 0 },
    ],
    shader: `uniform float u_left,u_top,u_right,u_bottom,u_feather;
void main(){ vec4 s=texture(u_tex,v_uv); vec2 f=vec2(max(u_feather*u_srcScale,0.001))/u_size;
 float x=v_uv.x, y=1.0-v_uv.y;
 float m=smoothstep(u_left/100.0, u_left/100.0+f.x, x)*(1.0-smoothstep(1.0-u_right/100.0-f.x,1.0-u_right/100.0,x))
        *smoothstep(u_top/100.0,u_top/100.0+f.y,y)*(1.0-smoothstep(1.0-u_bottom/100.0-f.y,1.0-u_bottom/100.0,y));
 o=s*m;}`,
  },
  hFlip: {
    name: 'Horizontal Flip', group: 'Transform', category: 'video', params: [],
    shader: `void main(){ o=texture(u_tex,vec2(1.0-v_uv.x,v_uv.y)); }`,
  },
  vFlip: {
    name: 'Vertical Flip', group: 'Transform', category: 'video', params: [],
    shader: `void main(){ o=texture(u_tex,vec2(v_uv.x,1.0-v_uv.y)); }`,
  },
  dropShadow: {
    name: 'Drop Shadow', group: 'Perspective', category: 'video',
    params: [
      { key: 'shadowColor', label: 'Shadow Color', type: 'color', default: '#000000' },
      { key: 'shadowOpacity', label: 'Opacity', min: 0, max: 100, default: 60 },
      { key: 'direction', label: 'Direction', min: -360, max: 360, default: 135 },
      { key: 'distance', label: 'Distance', min: 0, max: 500, default: 15 },
      { key: 'softness', label: 'Softness', min: 0, max: 300, default: 20 },
      { key: 'shadowOnly', label: 'Shadow Only', type: 'bool', default: false, animatable: false },
    ],
    pad: (p) => (p.distance || 0) + (p.softness || 0) * 1.2 + 2,
    shader: `uniform vec3 u_shadowColor; uniform float u_shadowOpacity, u_direction, u_distance, u_softness, u_shadowOnly;
void main(){
  vec4 s = texture(u_tex, v_uv);
  float a = radians(u_direction);
  vec2 off = vec2(sin(a), -cos(a)) * u_distance * u_srcScale / u_size;
  float r = u_softness * u_srcScale;
  float acc = 0.0, ws = 0.0;
  for (int i = 0; i < 48; i++) {
    float fi = float(i);
    float rr = sqrt((fi + 0.5) / 48.0) * r;
    float th = fi * 2.39996;
    vec2 d = vec2(cos(th), sin(th)) * rr / u_size;
    float w = r > 0.5 ? exp(-2.0 * (rr * rr) / max(1.0, r * r)) : 1.0;
    acc += texture(u_tex, v_uv - off + d).a * w;
    ws += w;
    if (r < 0.5) break;
  }
  float sa = acc / ws * u_shadowOpacity / 100.0;
  vec4 sh = vec4(u_shadowColor * sa, sa);
  o = u_shadowOnly > 0.5 ? sh * (1.0 - s.a) : s + sh * (1.0 - s.a);
}`,
  },
  glow: {
    name: 'Glow', group: 'Stylize', category: 'video',
    params: [
      { key: 'threshold', label: 'Glow Threshold', min: 0, max: 100, default: 60 },
      { key: 'radius', label: 'Glow Radius', min: 0, max: 300, default: 30 },
      { key: 'intensity', label: 'Glow Intensity', min: 0, max: 400, default: 100 },
      { key: 'glowColor', label: 'Glow Color', type: 'color', default: '#ffffff' },
    ],
    pad: (p) => (p.radius || 0) + 2,
    shader: `uniform float u_threshold, u_radius, u_intensity; uniform vec3 u_glowColor;
void main(){
  vec4 s = texture(u_tex, v_uv);
  float r = u_radius * u_srcScale;
  vec3 acc = vec3(0.0); float ws = 0.0;
  float thr = u_threshold / 100.0;
  for (int i = 0; i < 64; i++) {
    float fi = float(i);
    float rr = sqrt((fi + 0.5) / 64.0) * r;
    float th = fi * 2.39996;
    vec4 c = texture(u_tex, v_uv + vec2(cos(th), sin(th)) * rr / u_size);
    vec3 cu = unp(c);
    float b = max(0.0, luma(cu) - thr) / max(0.001, 1.0 - thr);
    float w = exp(-2.0 * (rr * rr) / max(1.0, r * r));
    acc += cu * b * c.a * w;
    ws += w;
  }
  vec3 g = acc / ws * u_glowColor * (u_intensity / 100.0) * 2.0;
  float ga = clamp(luma(g), 0.0, 1.0);
  o = vec4(min(s.rgb + g * (1.0 - s.a * 0.0), vec3(1.0)), max(s.a, ga));
}`,
  },
  stroke: {
    name: 'Stroke', group: 'Stylize', category: 'video',
    params: [
      { key: 'strokeColor', label: 'Color', type: 'color', default: '#ffffff' },
      { key: 'strokeSize', label: 'Size', min: 0, max: 100, default: 6 },
      { key: 'strokeOpacity', label: 'Opacity', min: 0, max: 100, default: 100 },
    ],
    pad: (p) => (p.strokeSize || 0) + 2,
    shader: `uniform vec3 u_strokeColor; uniform float u_strokeSize, u_strokeOpacity;
void main(){
  vec4 s = texture(u_tex, v_uv);
  float r = u_strokeSize * u_srcScale;
  float m = s.a;
  for (int i = 0; i < 64; i++) {
    float fi = float(i);
    float th = fi * 0.0981748;
    for (int k = 1; k <= 3; k++) {
      vec2 d = vec2(cos(th), sin(th)) * r * float(k) / 3.0 / u_size;
      m = max(m, texture(u_tex, v_uv + d).a);
    }
  }
  float sa = clamp(m, 0.0, 1.0) * u_strokeOpacity / 100.0;
  o = s + vec4(u_strokeColor * sa, sa) * (1.0 - s.a);
}`,
  },
  lensDistortion: {
    name: 'Lens Distortion', group: 'Distort', category: 'video',
    params: [
      { key: 'curvature', label: 'Curvature', min: -100, max: 100, default: -30 },
      { key: 'lensZoom', label: 'Zoom', min: 50, max: 200, default: 100 },
    ],
    shader: `uniform float u_curvature, u_lensZoom;
void main(){
  vec2 c = v_uv - 0.5;
  c.x *= u_size.x / u_size.y;
  float r2 = dot(c, c);
  float k = -u_curvature / 100.0 * 0.6;
  vec2 d = c * (1.0 + k * r2) / (u_lensZoom / 100.0);
  d.x /= u_size.x / u_size.y;
  vec2 uv = d + 0.5;
  o = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(u_tex, uv);
}`,
  },
  chromaticAberration: {
    name: 'Chromatic Aberration', group: 'Stylize', category: 'video',
    params: [
      { key: 'caAmount', label: 'Amount', min: 0, max: 100, default: 8 },
      { key: 'caRadial', label: 'Radial', type: 'bool', default: true, animatable: false },
      { key: 'caAngle', label: 'Direction', min: -360, max: 360, default: 0 },
    ],
    shader: `uniform float u_caAmount, u_caRadial, u_caAngle;
void main(){
  vec2 dir;
  if (u_caRadial > 0.5) dir = (v_uv - 0.5) * 2.0;
  else { float a = radians(u_caAngle); dir = vec2(cos(a), sin(a)); }
  vec2 off = dir * u_caAmount * u_srcScale / u_size;
  vec4 g = texture(u_tex, v_uv);
  vec4 r = texture(u_tex, v_uv + off);
  vec4 b = texture(u_tex, v_uv - off);
  float a = max(g.a, max(r.a, b.a));
  o = vec4(r.r, g.g, b.b, a);
}`,
  },
  waveWarp: {
    name: 'Wave Warp', group: 'Distort', category: 'video',
    params: [
      { key: 'waveHeight', label: 'Wave Height', min: 0, max: 300, default: 10 },
      { key: 'waveWidth', label: 'Wave Width', min: 4, max: 2000, default: 80 },
      { key: 'waveDir', label: 'Direction', min: -360, max: 360, default: 90 },
      { key: 'waveSpeed', label: 'Wave Speed', min: -20, max: 20, default: 1 },
    ],
    pad: (p) => (p.waveHeight || 0) + 1,
    shader: `uniform float u_waveHeight, u_waveWidth, u_waveDir, u_waveSpeed;
void main(){
  float a = radians(u_waveDir);
  vec2 along = vec2(sin(a), -cos(a));
  vec2 perp = vec2(-along.y, along.x);
  vec2 px = v_uv * u_size;
  float ph = dot(px, along) / max(1.0, u_waveWidth * u_srcScale) * 6.2831853 - u_time * u_waveSpeed * 6.2831853;
  vec2 uv = (px + perp * sin(ph) * u_waveHeight * u_srcScale) / u_size;
  o = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(u_tex, uv);
}`,
  },
  findEdges: {
    name: 'Find Edges', group: 'Stylize', category: 'video',
    params: [
      { key: 'edgeInvert', label: 'Invert', type: 'bool', default: true, animatable: false },
      { key: 'edgeBlend', label: 'Blend With Original', min: 0, max: 100, default: 0 },
    ],
    shader: `uniform float u_edgeInvert, u_edgeBlend;
float L(vec2 o2){ return luma(unp(texture(u_tex, v_uv + o2 / u_size))); }
void main(){
  vec4 s = texture(u_tex, v_uv);
  float gx = -L(vec2(-1,-1)) - 2.0*L(vec2(-1,0)) - L(vec2(-1,1)) + L(vec2(1,-1)) + 2.0*L(vec2(1,0)) + L(vec2(1,1));
  float gy = -L(vec2(-1,-1)) - 2.0*L(vec2(0,-1)) - L(vec2(1,-1)) + L(vec2(-1,1)) + 2.0*L(vec2(0,1)) + L(vec2(1,1));
  float e = clamp(length(vec2(gx, gy)), 0.0, 1.0);
  if (u_edgeInvert > 0.5) e = 1.0 - e;
  vec3 c = mix(vec3(e), unp(s), u_edgeBlend / 100.0);
  o = vec4(c * s.a, s.a);
}`,
  },
  filmGrain: {
    name: 'Film Grain', group: 'Stylize', category: 'video',
    params: [
      { key: 'grainAmount', label: 'Amount', min: 0, max: 100, default: 25 },
      { key: 'grainSize', label: 'Grain Size', min: 1, max: 8, step: 0.1, default: 1.5 },
      { key: 'grainShadows', label: 'Shadow Emphasis', min: 0, max: 100, default: 50 },
    ],
    shader: `uniform float u_grainAmount, u_grainSize, u_grainShadows;
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
void main(){
  vec4 s = texture(u_tex, v_uv);
  vec3 c = unp(s);
  vec2 p = v_uv * u_size / max(0.5, u_grainSize * u_srcScale) + floor(u_time * 24.0) * 17.31;
  float n = (vnoise(p) + vnoise(p * 2.1 + 3.7) * 0.5) / 1.5 - 0.5;
  float L = luma(c);
  float w = mix(1.0, 1.0 - L * 0.8, u_grainShadows / 100.0);
  c += n * u_grainAmount / 100.0 * 0.5 * w;
  o = vec4(clamp(c, 0.0, 1.0) * s.a, s.a);
}`,
  },
  warpStabilizer: {
    name: 'Warp Stabilizer', group: 'Distort', category: 'video', stab: true,
    params: [
      { key: 'stabData', label: 'Analysis', type: 'stabdata', default: null, animatable: false },
      { key: 'smoothness', label: 'Smoothness', min: 0, max: 100, default: 50, animatable: false, suffix: ' %' },
      { key: 'stabMethod', label: 'Method', type: 'select', options: ['Position, Scale, Rotation', 'Position'], default: 0, animatable: false },
      { key: 'stabCrop', label: 'Framing', type: 'select', options: ['Stabilize, Crop, Auto-scale', 'Stabilize Only'], default: 0, animatable: false },
      { key: 'extraScale', label: 'Additional Scale', min: 100, max: 200, default: 100, animatable: false, suffix: ' %' },
    ],
    shader: `uniform vec4 u_stab; uniform float u_stabZoom, u_stabOn;
void main(){
  if (u_stabOn < 0.5) { o = texture(u_tex, v_uv); return; }
  vec2 p = vec2((v_uv.x - 0.5) * u_size.x, (0.5 - v_uv.y) * u_size.y) / u_srcScale / u_stabZoom;
  vec2 q = vec2(u_stab.x * p.x - u_stab.y * p.y + u_stab.z, u_stab.y * p.x + u_stab.x * p.y + u_stab.w);
  vec2 uv = vec2(q.x * u_srcScale / u_size.x + 0.5, 0.5 - q.y * u_srcScale / u_size.y);
  o = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(u_tex, uv);
}`,
  },
  mirror: {
    name: 'Mirror', group: 'Distort', category: 'video',
    params: [{ key: 'mirrorMode', label: 'Mode', type: 'select', options: ['Left → Right', 'Right → Left', 'Top → Bottom', 'Bottom → Top'], default: 0, animatable: false }],
    shader: `uniform float u_mirrorMode;
void main(){ vec2 uv=v_uv; int m=int(u_mirrorMode+0.5);
 if(m==0 && uv.x>0.5) uv.x=1.0-uv.x; if(m==1 && uv.x<0.5) uv.x=1.0-uv.x;
 if(m==2 && uv.y<0.5) uv.y=1.0-uv.y; if(m==3 && uv.y>0.5) uv.y=1.0-uv.y; o=texture(u_tex,uv);}`,
  },
};

// Ses efektleri: önizlemede Web Audio düğümleri, dışa aktarmada FFmpeg filtreleri (bkz. audioFxFilters)
// Parametreler animasyonsuz (FFmpeg tarafında sabit filtre).
export const AUDIO_EFFECTS = {
  gain: {
    name: 'Amplify', group: 'Amplitude and Compression', category: 'audio',
    params: [{ key: 'gainDb', label: 'Gain', min: -40, max: 24, step: 0.1, default: 0, animatable: false, suffix: ' dB' }],
  },
  compressor: {
    name: 'Dynamics (Compressor)', group: 'Amplitude and Compression', category: 'audio',
    params: [
      { key: 'threshold', label: 'Threshold', min: -60, max: 0, step: 0.5, default: -20, animatable: false, suffix: ' dB' },
      { key: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.1, default: 4, animatable: false },
      { key: 'attack', label: 'Attack', min: 0.1, max: 1000, step: 0.5, default: 10, animatable: false, suffix: ' ms' },
      { key: 'release', label: 'Release', min: 10, max: 3000, step: 1, default: 150, animatable: false, suffix: ' ms' },
      { key: 'makeup', label: 'Make-up Gain', min: 0, max: 24, step: 0.1, default: 0, animatable: false, suffix: ' dB' },
    ],
  },
  eq: {
    name: '3-Band Equalizer', group: 'Filter and EQ', category: 'audio',
    params: [
      { key: 'lowGain', label: 'Low Gain', min: -24, max: 24, step: 0.1, default: 0, animatable: false, suffix: ' dB' },
      { key: 'lowFreq', label: 'Low Frequency', min: 20, max: 1000, step: 1, default: 200, animatable: false, suffix: ' Hz' },
      { key: 'midGain', label: 'Mid Gain', min: -24, max: 24, step: 0.1, default: 0, animatable: false, suffix: ' dB' },
      { key: 'midFreq', label: 'Mid Frequency', min: 100, max: 10000, step: 1, default: 1000, animatable: false, suffix: ' Hz' },
      { key: 'midQ', label: 'Mid Q', min: 0.1, max: 10, step: 0.01, default: 1, animatable: false },
      { key: 'highGain', label: 'High Gain', min: -24, max: 24, step: 0.1, default: 0, animatable: false, suffix: ' dB' },
      { key: 'highFreq', label: 'High Frequency', min: 1000, max: 20000, step: 10, default: 5000, animatable: false, suffix: ' Hz' },
    ],
  },
  highpass: {
    name: 'Highpass', group: 'Filter and EQ', category: 'audio',
    params: [{ key: 'freq', label: 'Cutoff', min: 20, max: 5000, step: 1, default: 100, animatable: false, suffix: ' Hz' }],
  },
  lowpass: {
    name: 'Lowpass', group: 'Filter and EQ', category: 'audio',
    params: [{ key: 'freq', label: 'Cutoff', min: 200, max: 20000, step: 10, default: 8000, animatable: false, suffix: ' Hz' }],
  },
  delay: {
    name: 'Delay', group: 'Delay and Echo', category: 'audio',
    params: [
      { key: 'delayMs', label: 'Delay', min: 1, max: 2000, step: 1, default: 300, animatable: false, suffix: ' ms' },
      { key: 'feedback', label: 'Feedback', min: 0, max: 90, step: 1, default: 35, animatable: false, suffix: ' %' },
      { key: 'mix', label: 'Mix', min: 0, max: 100, step: 1, default: 35, animatable: false, suffix: ' %' },
    ],
  },
  reverb: {
    name: 'Reverb', group: 'Reverb', category: 'audio',
    params: [
      { key: 'roomSize', label: 'Room Size', min: 10, max: 100, step: 1, default: 50, animatable: false, suffix: ' %' },
      { key: 'decay', label: 'Decay', min: 0, max: 90, step: 1, default: 55, animatable: false, suffix: ' %' },
      { key: 'mix', label: 'Mix', min: 0, max: 100, step: 1, default: 25, animatable: false, suffix: ' %' },
    ],
  },
  dehum: {
    name: 'DeHum', group: 'Noise Reduction / Restoration', category: 'audio',
    params: [
      { key: 'humFreq', label: 'Frequency', type: 'select', options: ['50 Hz', '60 Hz'], default: 0, animatable: false },
      { key: 'harmonics', label: 'Harmonics', min: 1, max: 6, step: 1, default: 3, animatable: false },
    ],
  },
  denoise: {
    name: 'DeNoise', group: 'Noise Reduction / Restoration', category: 'audio', offline: true,
    params: [
      { key: 'nrAmount', label: 'Amount', min: 0, max: 100, step: 1, default: 50, animatable: false, suffix: ' %' },
      { key: 'autoFloor', label: 'Auto Noise Floor', type: 'bool', default: true, animatable: false },
      { key: 'noiseFloor', label: 'Noise Floor', min: -80, max: -20, step: 1, default: -40, animatable: false, suffix: ' dB' },
    ],
  },
  deesser: {
    name: 'DeEsser', group: 'Noise Reduction / Restoration', category: 'audio', offline: true,
    params: [
      { key: 'essIntensity', label: 'Intensity', min: 0, max: 100, step: 1, default: 50, animatable: false, suffix: ' %' },
      { key: 'essMax', label: 'Max Reduction', min: 0, max: 100, step: 1, default: 50, animatable: false, suffix: ' %' },
      { key: 'essTone', label: 'Tone', min: 0, max: 100, step: 1, default: 50, animatable: false, suffix: ' %' },
    ],
  },
  channel: {
    name: 'Channel', group: 'Channels', category: 'audio',
    params: [{ key: 'mode', label: 'Mode', type: 'select', options: ['Fill Left with Right', 'Fill Right with Left', 'Swap Channels', 'Mono'], default: 3, animatable: false }],
  },
};

export const AUDIO_EFFECT_GROUPS = ['Amplitude and Compression', 'Filter and EQ', 'Delay and Echo', 'Reverb', 'Noise Reduction / Restoration', 'Channels'];

// Reverb tap'leri (oda boyutuna göre ms) — önizleme ve dışa aktarma aynı tap'leri kullanır
export function reverbTaps(roomSize, decay, mix) {
  const base = [23, 37, 53, 71, 89, 109, 131, 157, 181, 211, 241, 277, 313, 353];
  const k = 0.4 + (roomSize / 100) * 1.6;
  const out = [];
  base.forEach((ms, i) => {
    const g = (mix / 100) * Math.pow(decay / 100, i * 0.45) * 0.55;
    if (g > 0.004) out.push([ms * k, Math.min(1, g)]);
  });
  return out;
}

export function humFreqs(fx) {
  const f0 = Number(fx.params.humFreq?.v ?? 0) === 1 ? 60 : 50;
  const n = Math.max(1, Math.round(fx.params.harmonics?.v ?? 3));
  return Array.from({ length: n }, (_, i) => f0 * (i + 1));
}

export function effectDef(type) {
  return EFFECTS[type] || AUDIO_EFFECTS[type] || null;
}

function fxVal(fx, key) {
  const def = AUDIO_EFFECTS[fx.type];
  const p = fx.params[key];
  const pd = def.params.find((x) => x.key === key);
  return p ? p.v : pd.default;
}

// Dışa aktarma için FFmpeg -af parçaları
// stage: 'offline' (önce, kaynak hızında) | 'realtime' (hız/ters çevirmeden sonra) | undefined (hepsi)
export function audioFxFilters(effects, stage) {
  const out = [];
  for (const fx of effects || []) {
    if (!fx.enabled || !AUDIO_EFFECTS[fx.type]) continue;
    if (stage === 'offline' && !AUDIO_EFFECTS[fx.type].offline) continue;
    if (stage === 'realtime' && AUDIO_EFFECTS[fx.type].offline) continue;
    const v = (k) => Number(fxVal(fx, k));
    switch (fx.type) {
      case 'gain': out.push(`volume=${v('gainDb').toFixed(2)}dB`); break;
      case 'compressor':
        out.push(`acompressor=threshold=${Math.pow(10, v('threshold') / 20).toFixed(6)}:ratio=${v('ratio')}:attack=${v('attack')}:release=${v('release')}:makeup=${Math.max(1, Math.pow(10, v('makeup') / 20)).toFixed(4)}:knee=2`);
        break;
      case 'eq':
        out.push(`bass=g=${v('lowGain')}:f=${v('lowFreq')}:t=s:w=1`);
        out.push(`equalizer=f=${v('midFreq')}:t=q:w=${v('midQ')}:g=${v('midGain')}`);
        out.push(`treble=g=${v('highGain')}:f=${v('highFreq')}:t=s:w=1`);
        break;
      case 'highpass': out.push(`highpass=f=${v('freq')}:p=2:t=q:w=0.707`); break;
      case 'lowpass': out.push(`lowpass=f=${v('freq')}:p=2:t=q:w=0.707`); break;
      case 'delay': {
        const d = v('delayMs'), fb = v('feedback') / 100, mix = v('mix') / 100;
        const taps = [1, 2, 3, 4, 5, 6].filter((k, i) => i === 0 || Math.pow(fb, i) * mix > 0.01);
        if (mix > 0) out.push(`aecho=1:1:${taps.map((k) => (d * k).toFixed(1)).join('|')}:${taps.map((k, i) => Math.min(1, mix * Math.pow(fb, i)).toFixed(4)).join('|')}`);
        break;
      }
      case 'reverb': {
        const taps = reverbTaps(v('roomSize'), v('decay'), v('mix'));
        if (taps.length) out.push(`aecho=1:1:${taps.map((x) => x[0].toFixed(1)).join('|')}:${taps.map((x) => x[1].toFixed(4)).join('|')}`);
        break;
      }
      case 'dehum':
        for (const f of humFreqs(fx)) out.push(`bandreject=f=${f}:t=q:w=30`);
        break;
      case 'denoise':
        {
          // otomatik: klibin en sessiz bölümlerinden ölçülen taban (audioTools.ensureNoiseFloor)
          const auto = fx.params.autoFloor ? !!fx.params.autoFloor.v : true;
          const nf = auto && fx.params.measuredFloor ? fx.params.measuredFloor.v : v('noiseFloor');
          out.push(`afftdn=nr=${(1 + v('nrAmount') * 0.4).toFixed(1)}:nf=${Math.max(-80, Math.min(-20, Math.round(nf)))}`);
        }
        break;
      case 'deesser':
        out.push(`deesser=i=${(v('essIntensity') / 100).toFixed(2)}:m=${(v('essMax') / 100).toFixed(2)}:f=${(v('essTone') / 100).toFixed(2)}:s=o`);
        break;
      case 'channel': {
        const m = v('mode');
        const map = ['c0=c1|c1=c1', 'c0=c0|c1=c0', 'c0=c1|c1=c0', 'c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1'][m] || 'c0=c0|c1=c1';
        out.push(`pan=stereo|${map}`);
        break;
      }
    }
  }
  return out;
}

// Efekt panelindeki klasör sırası
export const EFFECT_GROUPS = ['Color Correction', 'Image Control', 'Blur & Sharpen', 'Keying', 'Transform', 'Perspective', 'Distort', 'Stylize', 'Channel'];

export const TRANSITION_HEADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_p;
uniform vec2 u_size;
vec4 A(vec2 uv){ return texture(u_a, uv); }
vec4 B(vec2 uv){ return texture(u_b, uv); }
bool inside(vec2 uv){ return uv.x>=0.0 && uv.x<=1.0 && uv.y>=0.0 && uv.y<=1.0; }
`;

export const TRANSITIONS = {
  crossDissolve: { name: 'Cross Dissolve', group: 'Dissolve', category: 'video', shader: `void main(){ o=mix(A(v_uv),B(v_uv),u_p); }` },
  additiveDissolve: {
    name: 'Additive Dissolve', group: 'Dissolve', category: 'video',
    shader: `void main(){ o=clamp(A(v_uv)*min(1.0,2.0*(1.0-u_p))+B(v_uv)*min(1.0,2.0*u_p),0.0,1.0); }`,
  },
  filmDissolve: {
    name: 'Film Dissolve', group: 'Dissolve', category: 'video',
    shader: `void main(){ vec4 a=A(v_uv), b=B(v_uv); vec4 m=mix(pow(a,vec4(2.2)),pow(b,vec4(2.2)),u_p); o=pow(m,vec4(1.0/2.2)); }`,
  },
  dipToBlack: {
    name: 'Dip to Black', group: 'Dissolve', category: 'video',
    shader: `void main(){ vec4 k=vec4(0.0,0.0,0.0,1.0); o = u_p<0.5 ? mix(A(v_uv),k,u_p*2.0) : mix(k,B(v_uv),(u_p-0.5)*2.0); }`,
  },
  dipToWhite: {
    name: 'Dip to White', group: 'Dissolve', category: 'video',
    shader: `void main(){ vec4 k=vec4(1.0); o = u_p<0.5 ? mix(A(v_uv),k,u_p*2.0) : mix(k,B(v_uv),(u_p-0.5)*2.0); }`,
  },
  wipeRight: {
    name: 'Wipe (Left to Right)', group: 'Wipe', category: 'video',
    shader: `void main(){ float e=0.01; float x=v_uv.x; float m=smoothstep(x-e,x+e,u_p*(1.0+2.0*e)-e); o=mix(A(v_uv),B(v_uv),m); }`,
  },
  wipeLeft: {
    name: 'Wipe (Right to Left)', group: 'Wipe', category: 'video',
    shader: `void main(){ float e=0.01; float x=1.0-v_uv.x; float m=smoothstep(x-e,x+e,u_p*(1.0+2.0*e)-e); o=mix(A(v_uv),B(v_uv),m); }`,
  },
  wipeDown: {
    name: 'Wipe (Top to Bottom)', group: 'Wipe', category: 'video',
    shader: `void main(){ float e=0.01; float x=1.0-v_uv.y; float m=smoothstep(x-e,x+e,u_p*(1.0+2.0*e)-e); o=mix(A(v_uv),B(v_uv),m); }`,
  },
  wipeUp: {
    name: 'Wipe (Bottom to Top)', group: 'Wipe', category: 'video',
    shader: `void main(){ float e=0.01; float x=v_uv.y; float m=smoothstep(x-e,x+e,u_p*(1.0+2.0*e)-e); o=mix(A(v_uv),B(v_uv),m); }`,
  },
  barnDoors: {
    name: 'Barn Doors', group: 'Wipe', category: 'video',
    shader: `void main(){ float e=0.01; float x=abs(v_uv.x-0.5)*2.0; float m=smoothstep(x-e,x+e,u_p*(1.0+2.0*e)-e); o=mix(A(v_uv),B(v_uv),m); }`,
  },
  irisRound: {
    name: 'Iris Round', group: 'Iris', category: 'video',
    shader: `void main(){ vec2 d=(v_uv-0.5)*vec2(u_size.x/u_size.y,1.0); float maxd=length(vec2(u_size.x/u_size.y,1.0)*0.5);
 float r=u_p*(maxd+0.02); float m=1.0-smoothstep(r-0.01,r+0.01,length(d)); o=mix(A(v_uv),B(v_uv),m); }`,
  },
  irisBox: {
    name: 'Iris Box', group: 'Iris', category: 'video',
    shader: `void main(){ vec2 d=abs(v_uv-0.5)*2.0; float x=max(d.x,d.y); float e=0.01; float m=smoothstep(x-e,x+e,u_p*(1.0+2.0*e)-e); o=mix(A(v_uv),B(v_uv),m); }`,
  },
  slideLeft: {
    name: 'Slide (from Right)', group: 'Slide', category: 'video',
    shader: `void main(){ float x=v_uv.x; o = x>=1.0-u_p ? B(vec2(x-(1.0-u_p),v_uv.y)) : A(v_uv); }`,
  },
  slideRight: {
    name: 'Slide (from Left)', group: 'Slide', category: 'video',
    shader: `void main(){ float x=v_uv.x; o = x<=u_p ? B(vec2(x+1.0-u_p,v_uv.y)) : A(v_uv); }`,
  },
  pushLeft: {
    name: 'Push (to Left)', group: 'Slide', category: 'video',
    shader: `void main(){ float x=v_uv.x; o = x<1.0-u_p ? A(vec2(x+u_p,v_uv.y)) : B(vec2(x-(1.0-u_p),v_uv.y)); }`,
  },
  pushRight: {
    name: 'Push (to Right)', group: 'Slide', category: 'video',
    shader: `void main(){ float x=v_uv.x; o = x>u_p ? A(vec2(x-u_p,v_uv.y)) : B(vec2(x+1.0-u_p,v_uv.y)); }`,
  },
  pushUp: {
    name: 'Push (Up)', group: 'Slide', category: 'video',
    shader: `void main(){ float y=v_uv.y; o = y>u_p ? A(vec2(v_uv.x,y-u_p)) : B(vec2(v_uv.x,y+1.0-u_p)); }`,
  },
  crossZoom: {
    name: 'Cross Zoom', group: 'Zoom', category: 'video',
    shader: `void main(){ vec2 c=vec2(0.5); float s=smoothstep(0.0,1.0,u_p);
 vec4 a=A(c+(v_uv-c)/(1.0+3.0*s)); vec4 b=B(c+(v_uv-c)/(1.0+3.0*(1.0-s)));
 o=mix(a,b,smoothstep(0.35,0.65,u_p)); }`,
  },
  spin: {
    name: 'Spin', group: 'Zoom', category: 'video',
    shader: `void main(){
  float asp = u_size.x / u_size.y;
  vec2 c = v_uv - 0.5; c.x *= asp;
  float t = u_p < 0.5 ? u_p * 2.0 : (1.0 - u_p) * 2.0;
  t = t * t * (3.0 - 2.0 * t);
  float ang = (u_p < 0.5 ? 1.0 : -1.0) * t * 3.14159;
  float sc = 1.0 + t * 2.0;
  vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * c * sc;
  q.x /= asp; q += 0.5;
  vec4 col = u_p < 0.5 ? A(q) : B(q);
  o = inside(q) ? col : vec4(0.0, 0.0, 0.0, 1.0);
}`,
  },
  blurDissolve: {
    name: 'Blur Dissolve', group: 'Dissolve', category: 'video',
    shader: `void main(){
  float r = sin(u_p * 3.14159) * 0.025;
  vec4 a = vec4(0.0), b = vec4(0.0);
  for (int i = 0; i < 32; i++) {
    float fi = float(i);
    float rr = sqrt((fi + 0.5) / 32.0) * r;
    float th = fi * 2.39996;
    vec2 d = vec2(cos(th) * u_size.y / u_size.x, sin(th)) * rr;
    a += A(v_uv + d); b += B(v_uv + d);
  }
  o = mix(a, b, smoothstep(0.2, 0.8, u_p)) / 32.0;
}`,
  },
  zoomBlur: {
    name: 'Zoom Blur', group: 'Zoom', category: 'video',
    shader: `void main(){
  vec2 c = vec2(0.5);
  float st = sin(u_p * 3.14159) * 0.35;
  float m = smoothstep(0.35, 0.65, u_p);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 24; i++) {
    float s = 1.0 - float(i) / 24.0 * st;
    vec2 uv = c + (v_uv - c) * s;
    acc += mix(A(uv), B(uv), m);
  }
  o = acc / 24.0;
}`,
  },
  whipPan: {
    name: 'Whip Pan', group: 'Slide', category: 'video',
    shader: `vec4 P(float x, float y, float e){ return x < 1.0 - e ? A(vec2(x + e, y)) : B(vec2(x - (1.0 - e), y)); }
void main(){
  float e = u_p * u_p * (3.0 - 2.0 * u_p);
  float bw = sin(u_p * 3.14159) * 0.25;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 24; i++) {
    float x = v_uv.x + (float(i) / 23.0 - 0.5) * bw;
    acc += P(fract(x), v_uv.y, e);
  }
  o = acc / 24.0;
}`,
  },
  lightLeak: {
    name: 'Light Leak', group: 'Dissolve', category: 'video',
    shader: `void main(){
  vec4 col = mix(A(v_uv), B(v_uv), smoothstep(0.3, 0.7, u_p));
  float k = sin(u_p * 3.14159);
  vec2 c1 = vec2(-0.3 + u_p * 1.6, 0.3);
  vec2 c2 = vec2(1.2 - u_p * 1.4, 0.8);
  vec2 asp = vec2(u_size.x / u_size.y, 1.0);
  float l1 = exp(-dot((v_uv - c1) * asp, (v_uv - c1) * asp) * 3.0);
  float l2 = exp(-dot((v_uv - c2) * asp, (v_uv - c2) * asp) * 5.0);
  vec3 leak = vec3(1.0, 0.55, 0.18) * l1 + vec3(1.0, 0.25, 0.35) * l2;
  vec3 rgb = col.rgb + leak * k * 1.4 + vec3(k * k * 0.35);
  o = vec4(min(rgb, vec3(1.0)), max(col.a, k));
}`,
  },
  glitch: {
    name: 'Glitch', group: 'Stylize', category: 'video',
    shader: `float h1(float n){ return fract(sin(n * 91.345) * 47453.5453); }
void main(){
  float k = sin(u_p * 3.14159);
  float seed = floor(u_p * 18.0);
  float row = floor(v_uv.y * 24.0);
  float shift = (h1(row + seed * 7.0) - 0.5) * 0.2 * k * step(0.55, h1(row * 3.1 + seed));
  vec2 uv = vec2(fract(v_uv.x + shift), v_uv.y);
  bool useB = u_p > 0.5 ? h1(seed + 3.0) > 0.15 : h1(seed + 5.0) > 0.85;
  float sp = 0.012 * k;
  vec4 r = useB ? B(uv + vec2(sp, 0.0)) : A(uv + vec2(sp, 0.0));
  vec4 g = useB ? B(uv) : A(uv);
  vec4 b = useB ? B(uv - vec2(sp, 0.0)) : A(uv - vec2(sp, 0.0));
  o = vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
}`,
  },
  // Ses geçişleri
  constantPower: { name: 'Constant Power', group: 'Crossfade', category: 'audio' },
  constantGain: { name: 'Constant Gain', group: 'Crossfade', category: 'audio' },
  exponentialFade: { name: 'Exponential Fade', group: 'Crossfade', category: 'audio' },
};

// Ses geçiş eğrileri: p 0..1 -> [çıkan, giren] kazanç
export function audioTransitionGains(type, p) {
  p = Math.min(1, Math.max(0, p));
  switch (type) {
    case 'constantGain': return [1 - p, p];
    case 'exponentialFade': return [Math.pow(1 - p, 2.5), Math.pow(p, 2.5)];
    case 'constantPower':
    default: return [Math.cos(p * Math.PI / 2), Math.sin(p * Math.PI / 2)];
  }
}

export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'add', 'darken', 'lighten', 'difference', 'softLight', 'hardLight', 'colorDodge', 'colorBurn', 'subtract'];
