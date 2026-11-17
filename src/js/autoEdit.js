// Şablonla otomatik kurgu (CapCut tarzı): seçili video/fotoğraflar + isteğe bağlı müzik → vuruşlara göre kesilmiş,
// geçişli, renk görünümlü, başlıklı yeni bir sekans. Sonuç sıradan bir zaman çizelgesidir; her şey sonradan düzenlenebilir.
import { store } from './store.js';
import { t } from './i18n.js';
import { el, nodePath } from './util.js';
import { app } from './appContext.js';
import { modal, toast, selectEl } from './ui/dialogs.js';
import { drawThumb, THUMB_W, THUMB_H } from './fxPreview.js';
import { createSequence, createEffect } from './model.js';
import * as E from './editing.js';
import { presetById, presetEffects } from './presets.js';
import { makeTemplate, layerBounds } from './graphics.js';
import { stickerLayers } from './stickers.js';
import { detectBeats } from './beats.js';

// cut: kesme başına hedef süre (sn) — müzik varsa en yakın vuruş katına yuvarlanır
// trans: geçiş listesi (sırayla), transEvery: kaç kesmede bir geçiş, transSec: geçiş süresi
export const AUTO_TEMPLATES = [
  {
    id: 'montage', icon: '⚡', previewFx: [{ type: 'zoomPunch', params: { punchAmount: 20 } }], name: 'Fast Montage', desc: 'Cuts on every beat, flash transitions, beat zoom, vivid colors',
    cut: 0.5, minCut: 0.3, trans: ['flashWhite', 'crossZoom', 'whipPan'], transEvery: 3, transSec: 0.25,
    look: 'lookVibrant', beatZoom: true, title: 'kineticTitle', fit: 'fill',
  },
  {
    id: 'cinematic', icon: '🎬', previewFx: [{ type: 'letterbox', params: null }], name: 'Cinematic', desc: 'Long shots, slow dissolves, film look, black bars, elegant title',
    cut: 2.4, minCut: 1.5, trans: ['filmDissolve', 'crossDissolve', 'dipToBlack'], transEvery: 1, transSec: 0.8,
    look: 'filmKodak', anim: 'zoomSlow', bars: true, title: 'title', fit: 'fill', endFade: true,
  },
  {
    id: 'vlog', icon: '✈️', previewFx: [], name: 'Vlog / Travel', desc: 'Smooth zoom and slide transitions, warm summer colors, lower-third caption',
    cut: 1.4, minCut: 0.8, trans: ['smoothZoomIn', 'slideLeft', 'whipPan', 'smoothZoomOut'], transEvery: 2, transSec: 0.4,
    look: 'lookSummer', anim: 'zoomSlow', title: 'lowerThird', fit: 'fill', endFade: true,
  },
  {
    id: 'glitch', icon: '👾', previewFx: [{ type: 'glitchFx', params: { glAmount: 80 } }, { type: 'chromaticAberration', params: { caAmount: 8 } }], name: 'Glitch / Dark', desc: 'Fast cuts, glitch and RGB transitions, neon night look, glitch title',
    cut: 0.5, minCut: 0.3, trans: ['glitch', 'rgbSplitSlide', 'pixelateTrans'], transEvery: 2, transSec: 0.25,
    look: 'nightNeon', glitchEvery: 3, title: 'glitchTitle', fit: 'fill',
  },
  {
    id: 'party', icon: '🎉', previewFx: [{ type: 'glow', params: null }], name: 'Party / Celebration', desc: 'Bouncy text, heart and star wipes, colorful stickers, bright colors',
    cut: 1, minCut: 0.5, trans: ['heartWipe', 'starWipe', 'flashWhite', 'smoothZoomIn'], transEvery: 2, transSec: 0.4,
    look: 'lookBrightAiry', anim: 'pulse', title: 'bounceText', stickers: ['🎉', '🥳', '✨', '🎈', '❤️'], fit: 'fill',
  },
];

export const ASPECTS = [
  ['16:9', 1920, 1080, 'YouTube'], ['9:16', 1080, 1920, 'TikTok / Reels / Shorts'], ['1:1', 1080, 1080, 'Instagram'], ['4:5', 1080, 1350, 'Instagram'],
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Kesme noktaları (sn): müzik varsa vuruşlardan, yoksa düzenli aralıkla
export function cutPoints(tpl, length, beats) {
  const pts = [0];
  if (beats && beats.length > 3) {
    const period = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
    const every = Math.max(1, Math.round(tpl.cut / period));
    // ilk vuruştan itibaren her "every" vuruşta bir kes (en kısa kesme sınırına uyarak)
    let last = 0;
    for (let i = every; i < beats.length; i += every) {
      const b = beats[i];
      if (b >= length - tpl.minCut * 0.5) break;
      if (b - last >= tpl.minCut) { pts.push(b); last = b; }
    }
  } else {
    for (let x = tpl.cut; x < length - tpl.minCut * 0.5; x += tpl.cut) pts.push(x);
  }
  pts.push(length);
  return pts;
}

// Yazıyı karenin içine sığdır (dikey biçimde başlıklar taşmasın): soldan hizalılar sol kenardan, ortalılar her iki yandan
function fitText(L, W) {
  if (L.type !== 'text') return;
  for (let i = 0; i < 14; i++) {
    const b = layerBounds(L);
    if (!b || (b.x >= W * 0.04 && b.x + b.w <= W * 0.96)) break;
    L.size *= 0.9;
    if (L.tracking) L.tracking *= 0.9;
  }
}

function titleGraphic(id, W, H, title, subtitle) {
  const g = makeTemplate(id, W, H);
  const texts = g.layers.filter((L) => L.type === 'text');
  if (texts[0]) texts[0].text = title;
  if (texts[1]) {
    if (subtitle) texts[1].text = subtitle;
    else g.layers = g.layers.filter((L) => L !== texts[1]);
  }
  // şablonlar 16:9 için tasarlandı: dar biçimlerde soldan hizalı öğeleri (alt bant) kenara yaklaştır
  const fx = Math.min(1, W / (H * 16 / 9));
  if (fx < 1) for (const L of g.layers) if (L.align === 'left' || (L.type !== 'text' && L.x < W * 0.3)) L.x *= fx;
  for (const L of g.layers) fitText(L, W);
  return g;
}

// Planı hesapla (saf fonksiyon; test edilebilir): hangi medya, hangi kaynak aralığı, nerede
export function planSegments(medias, points, fps) {
  const vis = medias.filter((m) => m.type === 'image' || m.hasVideo);
  const uses = new Map(vis.map((m) => [m.id, 0]));
  const segs = [];
  // her medyanın kaç kez kullanılacağını önce say (kaynak içinde kullanım yerlerini yaymak için)
  const order = [];
  for (let i = 0; i + 1 < points.length; i++) order.push(vis[i % vis.length]);
  const total = new Map(vis.map((m) => [m.id, order.filter((x) => x === m).length]));
  for (let i = 0; i + 1 < points.length; i++) {
    const want = points[i + 1] - points[i];
    let m = order[i];
    // bu kesme için yeterince uzun olmayan videoyu atla
    if (m.type !== 'image' && (m.duration || 0) < want) {
      const alt = vis.find((x) => x.type === 'image' || (x.duration || 0) >= want);
      if (alt) m = alt;
    }
    const k = uses.get(m.id) || 0;
    uses.set(m.id, k + 1);
    let inSec = 0;
    if (m.type !== 'image') {
      const D = m.duration || want;
      const margin = Math.min(0.3, D * 0.05);
      const room = Math.max(0, D - 2 * margin - want);
      const n = Math.max(1, total.get(m.id) || 1);
      inSec = margin + room * ((k % n) + 0.5) / n;
      inSec = clamp(inSec, 0, Math.max(0, D - want));
    }
    const start = Math.round(points[i] * fps);
    const end = Math.round(points[i + 1] * fps);
    segs.push({ media: m, inSec, start, duration: Math.max(1, end - start) });
  }
  return segs;
}

// opts: { mediaIds, musicId, templateId, aspect, title, subtitle, length (sn | 'music') }
export async function buildAutoEdit(opts) {
  const p = store.project;
  const tpl = AUTO_TEMPLATES.find((x) => x.id === opts.templateId) || AUTO_TEMPLATES[0];
  const medias = opts.mediaIds.map((id) => p.media[id]).filter((m) => m && (m.type === 'image' || m.hasVideo));
  if (!medias.length) throw new Error(t('Select at least one video or photo'));
  const music = opts.musicId ? p.media[opts.musicId] : null;
  const asp = ASPECTS.find((a) => a[0] === opts.aspect) || ASPECTS[0];
  const [W, H] = [asp[1], asp[2]];
  const fps = 30;
  // süre
  const visDur = medias.reduce((a, m) => a + (m.type === 'image' ? 3 : m.duration || 0), 0);
  let length = opts.length === 'music' && music ? music.duration : +opts.length || 30;
  if (music) length = Math.min(length, music.duration || length);
  length = Math.max(2, Math.min(length, Math.max(visDur, 5) * 3));
  // vuruşlar
  let beats = null, bpm = 0;
  if (music && music.path) {
    try {
      const r = await detectBeats(music.path, 0, Math.min(length + 1, music.duration || length + 1));
      if (r.beats.length > 3) { beats = r.beats; bpm = r.bpm; }
    } catch (e) { console.warn('beat detection failed', e); }
  }
  const points = cutPoints(tpl, length, beats);
  const segs = planSegments(medias, points, fps);
  const total = segs.length ? segs[segs.length - 1].start + segs[segs.length - 1].duration : Math.round(length * fps);

  const seq = createSequence({ name: t(tpl.name) + ' ' + asp[0], width: W, height: H, fps, videoTracks: 3, audioTracks: 2, binId: medias[0].binId || 'root' });
  const look = presetById(tpl.look);
  const transF = Math.round(tpl.transSec * fps);
  store.commit(t('Auto Edit with Template'), (pr) => {
    pr.sequences[seq.id] = seq;
    const s = pr.sequences[seq.id];
    const vids = [];
    segs.forEach((g, i) => {
      const m = pr.media[g.media.id];
      const keepAudio = !music && m.hasAudio && m.type !== 'image';
      const ids = E.placeMedia(pr, s, m, { start: g.start, vTrack: 0, aTrack: keepAudio ? 0 : null, mode: 'overwrite', inSec: g.inSec, outSec: g.inSec + g.duration / fps, duration: g.duration });
      const c = s.clips[ids[0]];
      vids.push(c);
      // kareyi doldur (ya da sığdır)
      if (m.width && m.height) {
        const k = tpl.fit === 'fill' ? Math.max(W / m.width, H / m.height) : Math.min(W / m.width, H / m.height);
        c.props.scale = { v: Math.round(k * 1000) / 10, kf: null };
        c.props.position = { v: [W / 2, H / 2], kf: null };
        if (tpl.fit !== 'fill') c.bgFill = { mode: 'blur', color: '#000000', blur: 40, dim: 20 };
      }
      if (look) c.effects.push(...presetEffects(look));
      if (tpl.beatZoom) {
        const z = createEffect('zoomPunch');
        if (z.params.punchInterval) z.params.punchInterval.v = beats ? clamp(60 / (bpm || 120), 0.25, 2) : tpl.cut;
        if (z.params.punchAmount) z.params.punchAmount.v = 8;
        c.effects.push(z);
      }
      if (tpl.glitchEvery && i % tpl.glitchEvery === tpl.glitchEvery - 1) {
        const gfx = createEffect('glitchFx');
        if (gfx.params.glAmount) gfx.params.glAmount.v = 55;
        c.effects.push(gfx);
      }
      if (tpl.anim) c.anim = { combo: { type: tpl.anim, speed: tpl.anim === 'pulse' ? 1 : 0.6, amount: tpl.anim === 'pulse' ? 40 : 100 } };
    });
    // geçişler (kesmenin iki yanındaki kliplerin süresine göre sınırlı)
    let ti = 0;
    for (let i = 1; i < vids.length; i++) {
      if (i % tpl.transEvery !== 0) continue;
      const a = vids[i - 1], b = vids[i];
      const d = Math.min(transF, 2 * Math.min(a.duration, b.duration) - 2);
      if (d < 4) continue;
      b.transIn = { type: tpl.trans[ti % tpl.trans.length], duration: d };
      ti++;
    }
    const last = vids[vids.length - 1];
    if (tpl.endFade && last) last.transOut = { type: 'dipToBlack', duration: Math.min(Math.round(fps * 0.8), last.duration) };
    // sinematik bantlar: tüm edit boyunca ayar katmanı
    if (tpl.bars && W > H * 1.2) { // bantlar yalnız yatay biçimde anlamlı (dikeyde görüntüyü yok eder)
      const adj = E.placeSynthetic(s, 'adjustment', { start: 0, duration: total, track: 2, name: t('Cinematic Bars') });
      const lb = createEffect('letterbox');
      adj.effects.push(lb);
    }
    // başlık
    if (opts.title) {
      const g = titleGraphic(tpl.title, W, H, opts.title, opts.subtitle || '');
      E.placeSynthetic(s, 'graphic', { start: Math.round(fps * 0.2), duration: Math.min(total - Math.round(fps * 0.2), Math.round(fps * 3)), track: 1, name: t('Title'), graphic: g });
    }
    // çıkartmalar
    if (tpl.stickers) {
      const n = Math.min(4, Math.floor(total / (fps * 4)));
      for (let i = 0; i < n; i++) {
        const start = Math.round(fps * (4 + i * 4));
        const layers = stickerLayers('emoji', tpl.stickers[i % tpl.stickers.length], W, H);
        for (const L of layers) { L.x = W * (i % 2 ? 0.78 : 0.22); L.y = H * (i % 2 ? 0.25 : 0.72); L.size *= 0.7; }
        E.placeSynthetic(s, 'graphic', { start, duration: Math.min(Math.round(fps * 1.6), Math.max(1, total - start)), track: 2, name: t('Sticker'), graphic: { layers } });
      }
    }
    // müzik: A1, sonunda yumuşak kısılma
    if (music) {
      const ids = E.placeMedia(pr, s, pr.media[music.id], { start: 0, vTrack: null, aTrack: 0, mode: 'overwrite', inSec: 0, outSec: total / fps, duration: total });
      const a = s.clips[ids[0]];
      if (a) a.transOut = { type: 'constantPower', duration: Math.min(Math.round(fps * 1.5), a.duration) };
    }
  });
  return { sequenceId: seq.id, cuts: segs.length, bpm: Math.round(bpm), length: total / fps, beatSynced: !!beats };
}

export function suggestTitle(medias) {
  const m = medias[0];
  return m ? nodePath.basename(m.name, nodePath.extname(m.name)) : '';
}

// ---- Pencere ----
export async function autoEditDialog(mediaIds = []) {
  const p = store.project;
  const all = Object.values(p.media);
  let picked = mediaIds.map((id) => p.media[id]).filter(Boolean);
  let visual = picked.filter((m) => m.type === 'image' || m.hasVideo);
  if (!visual.length) visual = all.filter((m) => m.type === 'image' || m.hasVideo);
  if (!visual.length) { toast(t('Import some videos or photos first'), 'warn'); return null; }
  const audios = all.filter((m) => m.type === 'audio' || (m.hasAudio && !m.hasVideo));
  const preMusic = picked.find((m) => m.type === 'audio' || (m.hasAudio && !m.hasVideo)) || null;

  let tplId = AUTO_TEMPLATES[0].id, aspect = '16:9';
  const cards = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', marginBottom: '12px' } });
  const descEl = el('div', { style: { color: 'var(--text-dim)', fontSize: '11px', minHeight: '16px', margin: '-4px 0 10px' } });
  const selectTpl = (id) => {
    tplId = id;
    for (const c of cards.children) c.classList.toggle('primary', c.dataset.id === id);
    const tp = AUTO_TEMPLATES.find((x) => x.id === id);
    descEl.textContent = t(tp.desc);
  };
  for (const tp of AUTO_TEMPLATES) {
    const cv = el('canvas', { width: THUMB_W, height: THUMB_H, style: { width: '100%', borderRadius: '3px', display: 'block' } });
    const pr = presetById(tp.look);
    try { drawThumb(cv, { kind: 'preset', effects: [...(pr ? pr.effects : []), ...(tp.previewFx || [])] }, 0.5); } catch (e) { /* önizleme yoksa boş kalır */ }
    const g2 = cv.getContext('2d');
    g2.font = Math.round(THUMB_H * 0.42) + 'px "Segoe UI Emoji"';
    g2.textAlign = 'right'; g2.textBaseline = 'top';
    g2.shadowColor = 'rgba(0,0,0,0.6)'; g2.shadowBlur = 6;
    g2.fillText(tp.icon || '', THUMB_W - 6, 4);
    const card = el('button', { style: { padding: '5px', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }, title: t(tp.desc) }, cv, el('b', { text: t(tp.name), style: { fontSize: '11px' } }));
    card.dataset.id = tp.id;
    card.addEventListener('click', () => selectTpl(tp.id));
    cards.appendChild(card);
  }
  selectTpl(tplId);
  const aspBtns = el('div', { style: { display: 'flex', gap: '6px' } });
  for (const [id, w, h, hint] of ASPECTS) {
    const box = el('div', { style: { width: (w >= h ? 22 : (22 * w) / h) + 'px', height: (w >= h ? (22 * h) / w : 22) + 'px', border: '2px solid currentColor', borderRadius: '2px' } });
    const b = el('button', { style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px' }, title: t(hint) }, box, el('span', { text: id }));
    b.dataset.id = id;
    b.addEventListener('click', () => { aspect = id; for (const x of aspBtns.children) x.classList.toggle('primary', x.dataset.id === id); });
    aspBtns.appendChild(b);
  }
  aspBtns.children[0].classList.add('primary');
  const musicSel = selectEl([{ value: '', label: t('No music (keep the clips\' own sound)') }, ...audios.map((m) => ({ value: m.id, label: m.name }))], preMusic ? preMusic.id : (audios[0]?.id || ''));
  const lenSel = selectEl([
    { value: 'music', label: t('Whole song') }, { value: '15', label: '15 ' + t('sec') }, { value: '30', label: '30 ' + t('sec') }, { value: '60', label: '60 ' + t('sec') },
  ], '30');
  const titleIn = el('input', { type: 'text', value: '', placeholder: t('e.g. Summer 2026'), style: { width: '100%' } });
  const subIn = el('input', { type: 'text', value: '', placeholder: t('optional'), style: { width: '100%' } });
  const row = (label, c) => el('div', { style: { display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: '8px', margin: '6px 0' } }, el('span', { text: label }), c);
  const body = el('div', {}, cards, descEl,
    row(t('Format'), aspBtns), row(t('Music'), musicSel), row(t('Length'), lenSel), row(t('Title'), titleIn), row(t('Subtitle'), subIn),
    el('div', { text: t('{n} video(s)/photo(s) will be used. The result is a normal sequence: you can change anything afterwards.', { n: visual.length }), style: { color: 'var(--text-dim)', fontSize: '11px', marginTop: '8px' } }));
  const r = await modal({ title: t('Auto Edit with Template'), body, width: 760, buttons: [
    { label: t('Cancel'), value: null },
    { label: t('Create Edit'), primary: true, onClick: () => ({ templateId: tplId, aspect, musicId: musicSel.value || null, length: lenSel.value, title: titleIn.value.trim(), subtitle: subIn.value.trim() }) },
  ] });
  if (!r) return null;
  if (r.length === 'music' && !r.musicId) r.length = '30';
  toast(r.musicId ? t('Analyzing the music and building the edit...') : t('Building the edit...'));
  try {
    const res = await buildAutoEdit({ ...r, mediaIds: visual.map((m) => m.id) });
    app.commands.openSequence(res.sequenceId);
    toast(t('Edit ready: {n} cuts', { n: res.cuts }) + (res.beatSynced ? ' · ' + res.bpm + ' BPM' : ''), 'success');
    return res;
  } catch (e) {
    console.error(e);
    toast(e.message, 'error');
    return null;
  }
}
