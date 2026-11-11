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

export const PRESET_GROUPS = ['Looks', 'Stylized Looks', 'Motion Presets'];

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
