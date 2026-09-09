// Layer 1: screenpipe/pii-image-redactor (rfdetr) — detects PII text regions directly
// in a screenshot. Input must be letterboxed (not stretched) to 512x512, or accuracy
// drops sharply — this was a real bug found during testing, not a style choice.

const PII_CLASSES = [
  'private_person', 'private_email', 'private_phone', 'private_address',
  'private_url', 'private_company', 'private_repo', 'private_handle',
  'private_channel', 'private_id', 'private_date', 'secret',
];
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const CONF_THRESH = 0.30;
const INPUT_SIZE = 512;

export async function loadPiiSession(ort, modelUrl) {
  try {
    return await ort.InferenceSession.create(modelUrl, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
  } catch (e) {
    return await ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  }
}

/**
 * @param {import('onnxruntime-web')} ort
 * @param {*} session  result of loadPiiSession()
 * @param {HTMLImageElement|HTMLCanvasElement} img
 */
export async function detectPii(ort, session, img) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const scale = INPUT_SIZE / Math.max(W, H);
  const newW = Math.round(W * scale), newH = Math.round(H * scale);
  const padX = Math.floor((INPUT_SIZE - newW) / 2), padY = Math.floor((INPUT_SIZE - newH) / 2);

  const off = document.createElement('canvas');
  off.width = INPUT_SIZE; off.height = INPUT_SIZE;
  const octx = off.getContext('2d');
  octx.fillStyle = 'black';
  octx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  octx.drawImage(img, padX, padY, newW, newH);
  const imgData = octx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;

  const n = INPUT_SIZE * INPUT_SIZE;
  const chw = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const r = imgData[i * 4] / 255, g = imgData[i * 4 + 1] / 255, b = imgData[i * 4 + 2] / 255;
    chw[i] = (r - MEAN[0]) / STD[0];
    chw[n + i] = (g - MEAN[1]) / STD[1];
    chw[2 * n + i] = (b - MEAN[2]) / STD[2];
  }
  const inputTensor = new ort.Tensor('float32', chw, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const t0 = performance.now();
  const outputs = await session.run({ [session.inputNames[0]]: inputTensor });
  const time = performance.now() - t0;

  const dets = outputs['dets'].data;
  const labels = outputs['labels'].data;
  const numQueries = outputs['dets'].dims[1];
  const numClasses = outputs['labels'].dims[2];

  const results = [];
  for (let q = 0; q < numQueries; q++) {
    let maxScore = -Infinity, maxClass = -1;
    for (let c = 0; c < Math.min(12, numClasses); c++) {
      const score = 1 / (1 + Math.exp(-labels[q * numClasses + c]));
      if (score > maxScore) { maxScore = score; maxClass = c; }
    }
    if (maxScore > CONF_THRESH) {
      const cx = dets[q * 4], cy = dets[q * 4 + 1], w = dets[q * 4 + 2], h = dets[q * 4 + 3];
      results.push({
        source: 'pii',
        label: PII_CLASSES[maxClass],
        score: maxScore,
        x1: ((cx - w / 2) * INPUT_SIZE - padX) / scale,
        y1: ((cy - h / 2) * INPUT_SIZE - padY) / scale,
        x2: ((cx + w / 2) * INPUT_SIZE - padX) / scale,
        y2: ((cy + h / 2) * INPUT_SIZE - padY) / scale,
      });
    }
  }
  return { results, time };
}
