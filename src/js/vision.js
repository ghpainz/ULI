// Yapay zekâ görüntü araçları (MediaPipe, tamamen bu bilgisayarda çalışır):
// kişi maskesi (arka plan silme) ve yüz algılama (otomatik dikey çevirme).
// Kütüphane ve modeller kurulumla gelir: uli://vendor/mp/... ve uli://vendor/models/...

const QUALITY = {
  0: { file: 'selfie_segmenter.tflite', multiclass: false },
};

let libP = null;
function lib() {
  if (!libP) {
    libP = import('uli://vendor/mp/vision_bundle.mjs').then(async (mp) => ({ mp, fileset: await mp.FilesetResolver.forVisionTasks('uli://vendor/mp/wasm') }));
    libP.catch(() => { libP = null; });
  }
  return libP;
}

// GPU ile oluşturmayı dener, olmazsa işlemciyle
async function create(Cls, modelFile, extra) {
  const { fileset } = await lib();
  const opts = (delegate) => ({ baseOptions: { modelAssetPath: 'uli://vendor/models/' + modelFile, delegate }, runningMode: 'IMAGE', ...extra });
  try { return await Cls.createFromOptions(fileset, opts('GPU')); } catch (e) { return Cls.createFromOptions(fileset, opts('CPU')); }
}

const seg = {}; // kalite -> { p: Promise, s: ImageSegmenter }
export function segmenterReady(q = 0) { return !!seg[q]?.s; }
// Yakın çekim modeli (selfie) + tam boy / uzak çekim için poz modeli (kişi maskesi verir)
let pose = null;
export function ensureSegmenter(q = 0) {
  if (!seg[q]) {
    const Q = QUALITY[q] || QUALITY[0];
    seg[q] = { s: null, p: null };
    seg[q].p = lib().then(async ({ mp }) => {
      const s = await create(mp.ImageSegmenter, Q.file, { outputConfidenceMasks: true, outputCategoryMask: false });
      try { pose = await create(mp.PoseLandmarker, 'pose_landmarker_full.task', { outputSegmentationMasks: true, numPoses: 3 }); } catch (e) { console.warn('pose model', e); }
      return s;
    })
      .then((s) => { seg[q].s = s; return s; })
      .catch((e) => { delete seg[q]; throw e; });
  }
  return seg[q].p;
}

// ImageData (üstten alta satırlar) -> kişi olasılığı Float32Array (aynı boyut) ya da null (henüz hazır değil)
export function personMask(q, imageData) {
  const s = seg[q]?.s;
  if (!s) return null;
  let out = null;
  s.segment(imageData, (res) => {
    const masks = res.confidenceMasks || [];
    if (!masks.length) return;
    const multi = (QUALITY[q] || QUALITY[0]).multiclass;
    if (multi || masks.length === 1) {
      // çok sınıflı: 0 = arka plan; tek maske: kişi olasılığı
      const m = masks[0].getAsFloat32Array();
      out = new Float32Array(m.length);
      if (multi) for (let i = 0; i < m.length; i++) out[i] = 1 - m[i]; else out.set(m);
    } else {
      out = Float32Array.from(masks[1].getAsFloat32Array());
    }
    for (const m of masks) m.close?.();
  });
  // yakın çekim modeli kişiyi pek bulamadıysa (uzak / tam boy çekim) poz modelinin maskesini ekle
  if (out && pose) {
    let cov = 0;
    for (let i = 0; i < out.length; i++) if (out[i] > 0.5) cov++;
    if (cov < out.length * 0.08) {
      const r = pose.detect(imageData);
      for (const mk of r.segmentationMasks || []) {
        const a = mk.getAsFloat32Array();
        if (a.length === out.length) for (let i = 0; i < a.length; i++) if (a[i] > out[i]) out[i] = a[i];
        mk.close?.();
      }
    }
  }
  return out;
}

let faceP = null, face = null;
export function ensureFaceDetector() {
  if (!faceP) {
    faceP = lib().then(({ mp }) => create(mp.FaceDetector, 'blaze_face_full_range.tflite', { minDetectionConfidence: 0.5 })).then((f) => { face = f; return f; });
    faceP.catch(() => { faceP = null; });
  }
  return faceP;
}
// Yüzler: [{ x, y, w, h, score }] (piksel, görüntü boyutunda)
export function detectFaces(image) {
  if (!face) return [];
  const r = face.detect(image);
  return (r.detections || []).map((d) => ({ x: d.boundingBox.originX, y: d.boundingBox.originY, w: d.boundingBox.width, h: d.boundingBox.height, score: d.categories?.[0]?.score ?? 0 }));
}
