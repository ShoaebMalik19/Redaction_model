// Layer 2: SCRFD-500m face detector (2.3MB, Apache-2.0). Standard SCRFD decode:
// 3 anchor strides, distance-to-box-edges regression scaled by stride.

const INPUT_SIZE = 640;
const STRIDES = [8, 16, 32];
const NUM_ANCHORS = 2;
const CONF_THRESH = 0.5;
const NMS_THRESH = 0.4;

export async function loadFaceSession(ort, modelUrl) {
  try {
    return await ort.InferenceSession.create(modelUrl, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
  } catch (e) {
    return await ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  }
}

function iou(a, b) {
  const ix1 = Math.max(a.x1, b.x1), iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2), iy2 = Math.min(a.y2, b.y2);
  const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  return inter / (areaA + areaB - inter);
}

export async function detectFaces(ort, session, img) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const scale = INPUT_SIZE / Math.max(W, H);
  const newW = Math.round(W * scale), newH = Math.round(H * scale);

  const off = document.createElement('canvas');
  off.width = INPUT_SIZE; off.height = INPUT_SIZE;
  const octx = off.getContext('2d');
  octx.fillStyle = 'black';
  octx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  octx.drawImage(img, 0, 0, newW, newH);
  const imgData = octx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;

  const n = INPUT_SIZE * INPUT_SIZE;
  const chw = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    chw[i] = (imgData[i * 4] - 127.5) / 128.0;
    chw[n + i] = (imgData[i * 4 + 1] - 127.5) / 128.0;
    chw[2 * n + i] = (imgData[i * 4 + 2] - 127.5) / 128.0;
  }
  const inputTensor = new ort.Tensor('float32', chw, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const t0 = performance.now();
  const outputs = await session.run({ [session.inputNames[0]]: inputTensor });
  const time = performance.now() - t0;

  let candidates = [];
  for (const stride of STRIDES) {
    const score = outputs[`score_${stride}`].data;
    const bbox = outputs[`bbox_${stride}`].data;
    const gridSize = INPUT_SIZE / stride;
    let idx = 0;
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        for (let a = 0; a < NUM_ANCHORS; a++) {
          const s = score[idx];
          if (s > CONF_THRESH) {
            const cx = x * stride, cy = y * stride;
            const l = bbox[idx * 4], t = bbox[idx * 4 + 1], r = bbox[idx * 4 + 2], b = bbox[idx * 4 + 3];
            candidates.push({
              score: s,
              x1: (cx - l * stride) / scale, y1: (cy - t * stride) / scale,
              x2: (cx + r * stride) / scale, y2: (cy + b * stride) / scale,
            });
          }
          idx++;
        }
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of candidates) {
    if (kept.every((k) => iou(c, k) < NMS_THRESH)) kept.push(c);
  }

  const results = kept.map((k) => ({ source: 'face', label: 'face', score: k.score, x1: k.x1, y1: k.y1, x2: k.x2, y2: k.y2 }));
  return { results, time };
}
