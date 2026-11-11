// Efekt hazır ayarları: yerleşik renk görünümleri (look) ve hareket ön ayarları, kullanıcı ön ayarları
import { store } from './store.js';
import { t } from './i18n.js';
import { uid } from './util.js';
import { createEffect } from './model.js';
import { effectDef } from './effectsDef.js';
import { settings, saveSettings } from './settings.js';
import { toast } from './ui/dialogs.js';

// renk tekerleği değeri: ton açısı (derece) ve şiddet
const W = (deg, k) => [Math.cos((deg * Math.PI) / 180) * k, Math.sin((deg * Math.PI) / 180) * k];
const L = (params) => ({ type: 'lumetri', params });

export const PRESET_GROUPS = ['Looks', 'Film', 'Portrait', 'Travel', 'Food', 'Night', 'Black & White', 'Retro', 'Stylized Looks', 'Motion Presets'];

export const PRESETS = {
  lookTealOrange: { name: 'Cinematic Teal & Orange', group: 'Looks', effects: [L({ contrast: 20, highlights: -10, saturation: 110, wShadows: W(195, 0.35), wHighs: W(30, 0.3) })] },
  lookWarmSunset: { name: 'Warm Sunset', group: 'Looks', effects: [L({ temperature: 35, tint: 8, saturation: 115, wHighs: W(30, 0.25), vigAmount: -20 })] },
  lookGoldenHour: { name: 'Golden Hour', group: 'Looks', effects: [L({ temperature: 40, highlights: 10, wHighs: W(45, 0.3), vigAmount: -15 })] },
  lookCoolBlue: { name: 'Cool Blue', group: 'Looks', effects: [L({ temperature: -30, contrast: 10, saturation: 90, wShadows: W(240, 0.3) })] },
  lookMoody: { name: 'Moody Dark', group: 'Looks', effects: [L({ exposure: -0.4, contrast: 25, saturation: 70, shadows: -20, wShadows: W(200, 0.2), vigAmount: -35 })] },
  lookBrightAiry: { name: 'Bright & Airy', group: 'Looks', effects: [L({ exposure: 0.3, contrast: -15, shadows: 25, saturation: 90, faded: 15, temperature: 5 })] },
  lookVibrant: { name: 'Vibrant Pop', group: 'Looks', effects: [L({ vibrance: 50, saturation: 125, contrast: 15 })] },
  lookMatte: { name: 'Matte Film', group: 'Looks', effects: [L({ faded: 50, contrast: -5, saturation: 85 })] },
  lookSummer: { name: 'Summer', group: 'Looks', effects: [L({ temperature: 20, vibrance: 35, exposure: 0.15 })] },
  lookWinter: { name: 'Winter', group: 'Looks', effects: [L({ temperature: -40, saturation: 70, exposure: 0.15, faded: 10 })] },
  lookBleach: { name: 'Bleach Bypass', group: 'Looks', effects: [L({ saturation: 45, contrast: 45, highlights: 15 })] },
  lookBW: { name: 'Black & White Film', group: 'Looks', effects: [L({ saturation: 0, contrast: 30 }), { type: 'filmGrain', params: { grainAmount: 25 } }] },
  lookNoir: { name: 'Noir', group: 'Looks', effects: [L({ saturation: 0, contrast: 60, blacks: -20, vigAmount: -40 })] },
  lookVintage: { name: 'Vintage', group: 'Stylized Looks', effects: [L({ faded: 40, saturation: 75, temperature: 15, contrast: -10, wShadows: W(30, 0.15), vigAmount: -30 }), { type: 'filmGrain', params: { grainAmount: 20 } }] },
  lookCyberpunk: { name: 'Cyberpunk', group: 'Stylized Looks', effects: [L({ tint: 40, contrast: 25, saturation: 130, wShadows: W(270, 0.4), wHighs: W(330, 0.35) })] },
  lookMatrix: { name: 'Green Matrix', group: 'Stylized Looks', effects: [L({ tint: -40, saturation: 70, contrast: 25, wMids: W(120, 0.3) })] },
  lookSepia: { name: 'Sepia', group: 'Stylized Looks', effects: [{ type: 'colorMap', params: { cmMode: 4, cmMix: 85 } }] },
  lookDreamy: { name: 'Dreamy Glow', group: 'Stylized Looks', effects: [L({ faded: 20, exposure: 0.1 }), { type: 'glow', params: { threshold: 50, radius: 40, intensity: 80 } }] },
  lookRetroVhs: { name: 'Retro VHS', group: 'Stylized Looks', effects: [L({ saturation: 120 }), { type: 'vhs', params: {} }] },
  lookOldFilm: { name: 'Old Film', group: 'Stylized Looks', effects: [{ type: 'oldFilm', params: {} }] },
  lookNightVision: { name: 'Night Vision', group: 'Stylized Looks', effects: [{ type: 'colorMap', params: { cmMode: 1 } }] },
  lookThermal: { name: 'Thermal Camera', group: 'Stylized Looks', effects: [{ type: 'colorMap', params: { cmMode: 0 } }] },
  lookComic: { name: 'Comic Book', group: 'Stylized Looks', effects: [{ type: 'cartoon', params: { ctLevels: 5, ctEdges: 80 } }, { type: 'halftone', params: { htMode: 1, htSize: 5 } }] },
  // ---- Film
  filmKodak: { name: 'Kodak Warm', group: 'Film', effects: [L({ temperature: 18, tint: 4, contrast: 12, faded: 18, saturation: 105, wShadows: W(20, 0.12), wHighs: W(40, 0.15) }), { type: 'filmGrain', params: { grainAmount: 14 } }] },
  filmFuji: { name: 'Fuji Green', group: 'Film', effects: [L({ temperature: -6, tint: -14, contrast: 10, faded: 15, saturation: 95, wShadows: W(160, 0.2), wHighs: W(60, 0.08) }), { type: 'filmGrain', params: { grainAmount: 12 } }] },
  filmPortra: { name: 'Portra 400', group: 'Film', effects: [L({ temperature: 10, contrast: -8, shadows: 15, faded: 22, saturation: 88, vibrance: 10, wHighs: W(35, 0.12) })] },
  filmCinestill: { name: 'CineStill 800T', group: 'Film', effects: [L({ temperature: -25, contrast: 15, saturation: 110, wShadows: W(210, 0.25), wHighs: W(15, 0.15) }), { type: 'glow', params: { threshold: 70, radius: 25, intensity: 80, glowColor: '#ff5a3c' } }] },
  filmEktar: { name: 'Ektar Vivid', group: 'Film', effects: [L({ saturation: 135, contrast: 20, vibrance: 30, temperature: 6 })] },
  filmVelvia: { name: 'Velvia', group: 'Film', effects: [L({ saturation: 150, contrast: 30, blacks: -10, wMids: W(140, 0.08) })] },
  filmExpired: { name: 'Expired Film', group: 'Film', effects: [L({ faded: 40, tint: 18, temperature: 12, saturation: 80, wShadows: W(300, 0.15), vigAmount: -25 }), { type: 'filmGrain', params: { grainAmount: 30 } }] },
  // ---- Portre
  portraitSoft: { name: 'Soft Skin', group: 'Portrait', effects: [L({ exposure: 0.15, contrast: -12, highlights: -10, shadows: 18, saturation: 92, temperature: 8, faded: 10 })] },
  portraitPeach: { name: 'Peach', group: 'Portrait', effects: [L({ temperature: 15, tint: 10, wHighs: W(20, 0.18), saturation: 95, exposure: 0.1 })] },
  portraitRosy: { name: 'Rosy', group: 'Portrait', effects: [L({ tint: 18, temperature: 6, wMids: W(350, 0.1), vibrance: 15 })] },
  portraitGolden: { name: 'Golden Skin', group: 'Portrait', effects: [L({ temperature: 25, wMids: W(40, 0.12), contrast: 8 })] },
  portraitClean: { name: 'Clean Bright', group: 'Portrait', effects: [L({ exposure: 0.25, whites: 15, blacks: 5, saturation: 98, contrast: 5 })] },
  portraitMoody: { name: 'Moody Portrait', group: 'Portrait', effects: [L({ exposure: -0.2, contrast: 20, saturation: 70, wShadows: W(200, 0.2), vigAmount: -35 })] },
  // ---- Gezi / doğa
  travelLush: { name: 'Lush Green', group: 'Travel', effects: [L({ vibrance: 40, saturation: 110, wMids: W(120, 0.1), contrast: 10 })] },
  travelOcean: { name: 'Ocean Blue', group: 'Travel', effects: [L({ temperature: -18, vibrance: 35, wHighs: W(190, 0.12), contrast: 12 })] },
  travelDesert: { name: 'Desert', group: 'Travel', effects: [L({ temperature: 30, tint: 6, contrast: 15, faded: 10, wMids: W(35, 0.15) })] },
  travelAutumn: { name: 'Autumn', group: 'Travel', effects: [L({ temperature: 28, saturation: 115, wMids: W(25, 0.2), wShadows: W(10, 0.1) })] },
  travelSpring: { name: 'Spring', group: 'Travel', effects: [L({ exposure: 0.15, vibrance: 30, tint: -6, faded: 8 })] },
  travelSunset: { name: 'Sunset Glow', group: 'Travel', effects: [L({ temperature: 35, tint: 12, wHighs: W(15, 0.25) }), { type: 'glow', params: { threshold: 65, radius: 35, intensity: 60, glowColor: '#ffb070' } }] },
  travelAlpine: { name: 'Alpine', group: 'Travel', effects: [L({ temperature: -12, contrast: 18, highlights: -15, vibrance: 20, sharpen: 20 })] },
  // ---- Yemek
  foodFresh: { name: 'Fresh', group: 'Food', effects: [L({ exposure: 0.15, vibrance: 35, contrast: 10, temperature: 4 })] },
  foodDelicious: { name: 'Delicious', group: 'Food', effects: [L({ temperature: 16, saturation: 120, contrast: 14, wMids: W(30, 0.1) })] },
  foodCafe: { name: 'Cafe Tone', group: 'Food', effects: [L({ temperature: 12, faded: 20, contrast: -5, saturation: 85, wShadows: W(30, 0.12) })] },
  foodPop: { name: 'Pop Colors', group: 'Food', effects: [L({ saturation: 140, vibrance: 30, contrast: 18 })] },
  // ---- Gece
  nightNeon: { name: 'Neon Night', group: 'Night', effects: [L({ tint: 25, temperature: -15, contrast: 25, saturation: 130, wShadows: W(260, 0.3), wHighs: W(320, 0.25) })] },
  nightBlueHour: { name: 'Blue Hour', group: 'Night', effects: [L({ temperature: -35, exposure: 0.1, contrast: 10, wShadows: W(225, 0.2) })] },
  nightMoon: { name: 'Moonlight', group: 'Night', effects: [L({ temperature: -40, saturation: 45, exposure: -0.15, contrast: 15, vigAmount: -30 })] },
  nightCity: { name: 'City Lights', group: 'Night', effects: [L({ contrast: 22, saturation: 115, highlights: -20, wHighs: W(35, 0.2) }), { type: 'glow', params: { threshold: 70, radius: 30, intensity: 70 } }] },
  nightSodium: { name: 'Sodium Street', group: 'Night', effects: [L({ temperature: 40, tint: 8, saturation: 85, contrast: 20, wShadows: W(200, 0.15) })] },
  // ---- Siyah-beyaz
  bwHighKey: { name: 'High Key BW', group: 'Black & White', effects: [L({ saturation: 0, exposure: 0.4, contrast: -10, shadows: 25 })] },
  bwLowKey: { name: 'Low Key BW', group: 'Black & White', effects: [L({ saturation: 0, exposure: -0.3, contrast: 45, blacks: -25, vigAmount: -45 })] },
  bwSelenium: { name: 'Selenium', group: 'Black & White', effects: [L({ contrast: 25 }), { type: 'duotone', params: { dtShadow: '#1d1424', dtHighlight: '#efe6dc', dtMix: 80 } }] },
  bwCyanotype: { name: 'Cyanotype', group: 'Black & White', effects: [L({ contrast: 15 }), { type: 'duotone', params: { dtShadow: '#0b2545', dtHighlight: '#cfe8ff', dtMix: 100 } }] },
  bwSepiaRich: { name: 'Rich Sepia', group: 'Black & White', effects: [L({ contrast: 15 }), { type: 'colorMap', params: { cmMode: 4, cmMix: 100 } }] },
  bwSilver: { name: 'Silver Grain', group: 'Black & White', effects: [L({ saturation: 0, contrast: 30 }), { type: 'filmGrain', params: { grainAmount: 35 } }] },
  // ---- Retro
  retro70s: { name: '70s', group: 'Retro', effects: [L({ temperature: 22, faded: 35, saturation: 85, wShadows: W(30, 0.15), wHighs: W(50, 0.15) }), { type: 'filmGrain', params: { grainAmount: 20 } }] },
  retro80s: { name: '80s Pop', group: 'Retro', effects: [L({ saturation: 130, tint: 15, contrast: 15, wHighs: W(320, 0.15) }), { type: 'chromaticAberration', params: { caAmount: 3 } }] },
  retro90s: { name: '90s Camcorder', group: 'Retro', effects: [L({ saturation: 115, sharpen: 30 }), { type: 'vhs', params: { vhsAmount: 45 } }] },
  retroPolaroid: { name: 'Polaroid', group: 'Retro', effects: [L({ faded: 35, temperature: 10, tint: -8, contrast: -10, wShadows: W(180, 0.12), vigAmount: -20 })] },
  retroLomo: { name: 'Lomo', group: 'Retro', effects: [L({ contrast: 35, saturation: 130, vigAmount: -60, wShadows: W(240, 0.15) })] },
  retroCross: { name: 'Cross Process', group: 'Retro', effects: [L({ tint: -15, contrast: 25, saturation: 120, wShadows: W(240, 0.25), wHighs: W(60, 0.25) })] },
  retroDusty: { name: 'Dusty', group: 'Retro', effects: [L({ faded: 30, saturation: 70, temperature: 8 }), { type: 'oldFilm', params: { ofSepia: 20, ofScratches: 20, ofDust: 30, ofFlicker: 15 } }] },
  motionHandheld: { name: 'Handheld Camera', group: 'Motion Presets', effects: [{ type: 'cameraShake', params: { shakeAmount: 6, shakeSpeed: 2, shakeRot: 0.4, shakeZoom: 103 } }] },
  motionEarthquake: { name: 'Earthquake', group: 'Motion Presets', effects: [{ type: 'cameraShake', params: { shakeAmount: 60, shakeSpeed: 18, shakeRot: 3, shakeZoom: 115 } }] },
  motionBeat120: { name: 'Beat Zoom (120 BPM)', group: 'Motion Presets', effects: [{ type: 'zoomPunch', params: { punchInterval: 0.5, punchAmount: 12, punchDecay: 10 } }] },
  motionKbIn: { name: 'Slow Zoom In', group: 'Motion Presets', effects: [{ type: 'kenBurns', params: { kbStart: 100, kbEnd: 120, kbPanX: 0, kbDur: 6 } }] },
  motionKbOut: { name: 'Slow Zoom Out', group: 'Motion Presets', effects: [{ type: 'kenBurns', params: { kbStart: 125, kbEnd: 100, kbPanX: 0, kbDur: 6 } }] },
  motionPanRight: { name: 'Slow Pan Right', group: 'Motion Presets', effects: [{ type: 'kenBurns', params: { kbStart: 118, kbEnd: 118, kbPanX: 100, kbDur: 6 } }] },
  motionCinemaBars: { name: 'Cinematic Bars 2.39:1', group: 'Motion Presets', effects: [{ type: 'letterbox', params: { lbAspect: 0 } }] },
  motionGlitchBurst: { name: 'Glitch Burst', group: 'Motion Presets', effects: [{ type: 'glitchFx', params: { glAmount: 70, glSpeed: 14 } }, { type: 'chromaticAberration', params: { caAmount: 6 } }] },
};

export function userPresets() {
  return settings.userPresets || [];
}

export function presetById(id) {
  if (PRESETS[id]) return { id, ...PRESETS[id] };
  const u = userPresets().find((p) => p.id === id);
  return u ? { ...u, group: 'My Presets', user: true } : null;
}

// Ön ayarın efektlerini gerçek efekt nesnelerine çevir
export function presetEffects(preset) {
  const out = [];
  for (const e of preset.effects) {
    const def = effectDef(e.type);
    if (!def) continue;
    const fx = createEffect(e.type);
    for (const [k, v] of Object.entries(e.params || {})) {
      if (!fx.params[k]) continue;
      if (v && typeof v === 'object' && 'v' in v) fx.params[k] = structuredClone(v);
      else fx.params[k].v = structuredClone(v);
    }
    out.push(fx);
  }
  return out;
}

export function applyPreset(clipIds, id) {
  const preset = presetById(id);
  if (!preset || !store.seq) return;
  const targets = clipIds.map((cid) => store.seq.clips[cid]).filter((c) => c && c.type === 'video');
  if (!targets.length) { toast(t('Video effects can only be applied to video clips'), 'error'); return; }
  store.commit('Apply Preset', (p) => {
    const s = p.sequences[p.activeSequenceId];
    for (const c0 of targets) {
      const c = s.clips[c0.id];
      if (c) c.effects.push(...presetEffects(preset));
    }
  });
}

// Klipteki efektlerden kullanıcı ön ayarı kaydet
export function saveUserPreset(name, effects) {
  const list = userPresets().slice();
  const id = uid('pre');
  list.push({ id, name, effects: effects.map((fx) => ({ type: fx.type, params: structuredClone(fx.params) })) });
  settings.userPresets = list;
  saveSettings();
  return id;
}

export function deleteUserPreset(id) {
  settings.userPresets = userPresets().filter((p) => p.id !== id);
  removeFavorite('preset:' + id);
  saveSettings();
}

// Klip animasyonu uygula. spec: 'in:zoomIn' | 'out:fade' | 'combo:rock'
export function applyClipAnim(clipIds, spec) {
  const [kind, type] = spec.split(':');
  const targets = clipIds.map((id) => store.seq?.clips[id]).filter((c) => c && c.type === 'video' && c.kind !== 'adjustment');
  if (!targets.length) { toast(t('Video effects can only be applied to video clips'), 'error'); return; }
  store.commit('Apply Animation', (p) => {
    const s = p.sequences[p.activeSequenceId];
    for (const c0 of targets) {
      const c = s.clips[c0.id];
      c.anim = structuredClone(c.anim || {});
      const maxD = Math.max(0.1, c.duration / s.fps / (kind === 'combo' ? 1 : 2));
      if (kind === 'combo') c.anim.combo = { type, speed: 1, amount: 100 };
      else c.anim[kind] = { type, dur: Math.min(kind === 'in' ? c.anim.in?.dur || 0.5 : c.anim.out?.dur || 0.5, maxD) };
    }
  });
}

// Favoriler: 'effect:type' | 'transition:type' | 'preset:id'
export function favorites() { return settings.fxFavorites || []; }
export function isFavorite(key) { return favorites().includes(key); }
export function toggleFavorite(key) {
  const f = favorites();
  settings.fxFavorites = f.includes(key) ? f.filter((x) => x !== key) : [...f, key];
  saveSettings();
}
function removeFavorite(key) { settings.fxFavorites = favorites().filter((x) => x !== key); }
