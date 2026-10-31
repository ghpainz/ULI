// Maske yardımcıları (Efekt Kontrolleri ve Program monitörü ortak kullanır)
import { store } from './store.js';
import { createMask } from './model.js';

// owner: 'clip' (opaklık maskeleri) veya efekt id'si
export function maskList(clip, owner, create = false) {
  if (!clip) return null;
  if (owner === 'clip') {
    if (!clip.masks && create) clip.masks = [];
    return clip.masks || null;
  }
  const fx = (clip.effects || []).find((x) => x.id === owner);
  if (!fx) return null;
  if (!fx.masks && create) fx.masks = [];
  return fx.masks || null;
}

export function findMask(clip, owner, maskId) {
  const list = maskList(clip, owner);
  return list ? list.find((m) => m.id === maskId) || null : null;
}

export function selectedMask() {
  const sm = store.ui.selectedMask;
  const seq = store.seq;
  if (!sm || !seq) return null;
  const clip = seq.clips[sm.clipId];
  const mask = findMask(clip, sm.owner, sm.maskId);
  return mask ? { clip, mask, owner: sm.owner } : null;
}

export function addMask(clipId, owner, type, sw, sh) {
  let created = null;
  store.commit('Add Mask', (p) => {
    const c = p.sequences[p.activeSequenceId].clips[clipId];
    const list = maskList(c, owner, true);
    if (!list) return false;
    created = createMask(type, sw, sh, list.length);
    list.push(created);
  });
  if (!created) return null;
  store.ui.selectedMask = { clipId, owner, maskId: created.id };
  store.ui.maskPen = type === 'pen' ? { clipId, owner, maskId: created.id } : null;
  store.emit('selection');
  return created;
}

export function removeMask(clipId, owner, maskId) {
  store.commit('Delete Mask', (p) => {
    const c = p.sequences[p.activeSequenceId].clips[clipId];
    const list = maskList(c, owner);
    if (!list) return false;
    const i = list.findIndex((m) => m.id === maskId);
    if (i < 0) return false;
    list.splice(i, 1);
  });
  if (store.ui.selectedMask && store.ui.selectedMask.maskId === maskId) store.ui.selectedMask = null;
  if (store.ui.maskPen && store.ui.maskPen.maskId === maskId) store.ui.maskPen = null;
  store.emit('selection');
}
